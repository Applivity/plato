/**
 * A JSON-RPC 2.0 client over an ACP agent's stdio.
 *
 * It imports nothing from `packages/`. It launches a command and talks to it
 * the way every ACP client does: JSON-RPC 2.0, one message per line, UTF-8,
 * stdout only. Anything on stdout that is not a JSON-RPC message is recorded
 * as a violation; stderr is kept for failure reports.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const MAX_STDOUT_LINES = 5_000;
const MAX_VIOLATIONS = 100;
const MAX_STDERR = 64 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RpcError extends Error {
  constructor(error) {
    const code = error?.code;
    const message = error?.message ?? 'JSON-RPC error';
    super(`${message} (code ${code})`);
    this.name = 'RpcError';
    this.code = code;
    this.data = error?.data;
    this.rpc = error;
  }
}

export class AgentExitError extends Error {
  constructor(message, exit) {
    super(message);
    this.name = 'AgentExitError';
    this.exit = exit;
  }
}

export class RequestTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Split a command string into argv, honoring single and double quotes.
 * Avoids a shell on POSIX, so the agent process can be killed as a group.
 */
export function splitCommand(input) {
  const parts = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current.length > 0) {
        parts.push(current);
        current = '';
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote !== null) throw new Error(`unterminated ${quote} quote in agent command`);
  if (started || current.length > 0) parts.push(current);
  if (parts.length === 0) throw new Error('empty agent command');
  return parts;
}

function describeExit(exit) {
  if (exit.error) return `failed to start: ${exit.error.message}`;
  if (exit.signal) return `killed by ${exit.signal}`;
  return `code ${exit.code}`;
}

/** Start an agent process with the transport's stdio shape. */
export function spawnAgent({ command, argv, cwd, env }) {
  const stdio = ['pipe', 'pipe', 'pipe'];
  if (argv) {
    return spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio,
      detached: process.platform !== 'win32',
    });
  }
  if (process.platform === 'win32') {
    // .cmd launchers such as npx need a shell on Windows.
    return spawn(command, { cwd, env, stdio, shell: true });
  }
  const parts = splitCommand(command);
  return spawn(parts[0], parts.slice(1), {
    cwd,
    env,
    stdio,
    detached: true,
  });
}

/** Kill an agent process and its children, without waiting. */
export function killAgent(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

export class AcpClient {
  /**
   * @param {object} options
   * @param {string} [options.command] a command string, split into argv
   * @param {string[]} [options.argv] an exact argv (wins over command)
   * @param {string} [options.cwd]
   * @param {NodeJS.ProcessEnv} [options.env]
   * @param {number} [options.requestTimeoutMs]
   * @param {string} [options.label] a name for reports
   */
  constructor({
    command,
    argv,
    cwd,
    env,
    requestTimeoutMs = 15_000,
    label = 'agent',
    verbose = false,
  }) {
    if (!command && !argv) throw new Error('AcpClient needs a command or argv');
    this.command = command;
    this.argv = argv;
    this.cwd = cwd ?? process.cwd();
    this.env = env ?? process.env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.label = label;
    this.verbose = verbose;

    this.child = null;
    this.reader = null;
    this.exit = null;
    this.stopPromise = null;

    this.nextId = 1;
    this.pending = new Map();
    this.serverRequestHandlers = [];
    this.notifications = [];
    this.notificationListeners = new Set();
    this.exitListeners = new Set();
    this.exitWaiters = new Set();

    this.lines = [];
    this.lineCount = 0;
    this.violations = [];
    this.protocolErrors = [];
    this.notes = [];
    this.stderr = '';
  }

  start() {
    if (this.child) throw new Error('AcpClient already started');

    this.child = spawnAgent({
      command: this.command,
      argv: this.argv,
      cwd: this.cwd,
      env: this.env,
    });

    const child = this.child;
    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.reader.on('line', (line) => this.#onLine(line));

    child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
      if (this.stderr.length > MAX_STDERR) this.stderr = this.stderr.slice(-MAX_STDERR);
    });
    // EPIPE after the agent exits is expected; the exit event carries the cause.
    child.stdin.on('error', () => {});
    child.on('error', (error) => this.#onExit(null, null, error));
    child.on('exit', (code, signal) => this.#onExit(code, signal));
    return this;
  }

  /** Send a request and wait for its result. */
  request(method, params, options) {
    return this.#call(this.nextId++, method, params, options);
  }

  /**
   * Send a request with a caller-chosen id. Used to prove that the agent
   * echoes the id and its type exactly: a coerced id cannot match the map key.
   */
  callWithId(id, method, params, options) {
    return this.#call(id, method, params, options);
  }

  /** Write one raw line, for malformed-input checks. */
  sendRaw(line) {
    if (!this.child || this.exit) throw new Error('agent is not running');
    const text = line.endsWith('\n') ? line : `${line}\n`;
    if (this.verbose) process.stderr.write(`  [acp -> raw] ${truncate(line, 400)}\n`);
    this.child.stdin.write(text);
  }

  #call(id, method, params, { timeoutMs } = {}) {
    if (this.exit) {
      return Promise.reject(this.#exitError(`agent exited (${describeExit(this.exit)}) before answering ${method}`));
    }
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;

    return new Promise((resolve, reject) => {
      const limit = timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RequestTimeoutError(
            `${method} timed out after ${limit}ms${this.#stderrTail(3)}`,
          ),
        );
      }, limit);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.#write(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** Send a notification. No response is expected. */
  notify(method, params) {
    const message = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    this.#write(message);
  }

  /**
   * Register a handler for requests the agent sends to the client.
   * A handler returns a result, or undefined when it does not handle the method.
   */
  onRequest(handler) {
    this.serverRequestHandlers.push(handler);
  }

  /** Wait for a notification that matches, including ones already received. */
  waitForNotification(predicate, timeoutMs = 5_000) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const cleanupWait = () => {
        clearTimeout(timer);
        this.notificationListeners.delete(onNotification);
        this.exitListeners.delete(onExit);
      };
      const onNotification = (notification) => {
        if (!predicate(notification)) return;
        cleanupWait();
        resolve(notification);
      };
      const onExit = () => {
        cleanupWait();
        reject(
          new AgentExitError(
            `agent exited (${describeExit(this.exit)}) while waiting for a notification${this.#stderrTail(3)}`,
            this.exit,
          ),
        );
      };
      const timer = setTimeout(() => {
        cleanupWait();
        reject(
          new RequestTimeoutError(
            `no matching notification within ${timeoutMs}ms${this.#stderrTail(3)}`,
          ),
        );
      }, timeoutMs);
      this.notificationListeners.add(onNotification);
      this.exitListeners.add(onExit);
    });
  }

  /** The `update` objects for one session, in arrival order. */
  updatesFor(sessionId) {
    return this.notifications
      .filter((n) => n.method === 'session/update' && n.params?.sessionId === sessionId)
      .map((n) => n.params.update);
  }

  /** Close the client's read end of the agent's stdout, as a dying client would. */
  closeReadPipe() {
    this.reader?.close();
    this.child?.stdout?.destroy();
  }

  /** Wait for the agent process to exit. Returns null on timeout. */
  waitForExit(timeoutMs = 5_000) {
    if (this.exit) return Promise.resolve(this.exit);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.exitWaiters.delete(onExit);
        resolve(null);
      }, timeoutMs);
      const onExit = (exit) => {
        clearTimeout(timer);
        resolve(exit);
      };
      this.exitWaiters.add(onExit);
    });
  }

  /** Stop the agent. Safe to call more than once. */
  stop() {
    this.stopPromise ??= this.#stop();
    return this.stopPromise;
  }

  async #stop() {
    const child = this.child;
    if (!child || this.exit) return;
    try {
      child.stdin.end();
    } catch {
      // The pipe may already be closed.
    }
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      await Promise.race([exited, sleep(1_000)]);
      return;
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone.
      }
    }
    const polite = await Promise.race([exited.then(() => true), sleep(1_000).then(() => false)]);
    if (polite) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
    await Promise.race([exited, sleep(500)]);
  }

  #write(message) {
    if (!this.child || this.exit) throw new Error('agent is not running');
    const line = JSON.stringify(message);
    if (this.verbose) process.stderr.write(`  [acp ->] ${truncate(line, 400)}\n`);
    this.child.stdin.write(`${line}\n`);
  }

  #onLine(line) {
    this.lineCount++;
    if (this.lines.length < MAX_STDOUT_LINES) this.lines.push(line);
    if (this.verbose) process.stderr.write(`  [acp <-] ${truncate(line, 400)}\n`);

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#violation(line, 'not JSON');
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      this.#violation(line, 'not a JSON object');
      return;
    }
    if (message.jsonrpc !== '2.0') this.#violation(line, 'missing jsonrpc "2.0"');

    if (typeof message.method === 'string') {
      if (message.id !== undefined && message.id !== null) {
        void this.#handleServerRequest(message);
      } else {
        const notification = {
          method: message.method,
          params: message.params,
          at: Date.now(),
        };
        this.notifications.push(notification);
        for (const listener of this.notificationListeners) listener(notification);
      }
      return;
    }

    // A JSON-RPC parser may answer a malformed line with an error whose id is
    // null. That is a valid JSON-RPC message, not a stdout-purity failure.
    if (message.id === null && message.error !== undefined) {
      this.protocolErrors.push(message.error);
      return;
    }

    if (message.id === undefined || message.id === null) {
      this.#violation(line, 'message has neither method nor id');
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.#violation(line, `response for unknown id ${JSON.stringify(message.id)}`);
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) pending.reject(new RpcError(message.error));
    else pending.resolve(message.result);
  }

  async #handleServerRequest(message) {
    let result;
    let handled = false;
    let failure;
    for (const handler of this.serverRequestHandlers) {
      try {
        const value = await handler(message.method, message.params, message);
        if (value !== undefined) {
          result = value;
          handled = true;
          break;
        }
      } catch (error) {
        failure = error;
        handled = true;
        break;
      }
    }
    if (!handled) {
      this.notes.push(`unhandled agent request: ${message.method}`);
      this.#write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
      return;
    }
    if (failure) {
      this.#write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: failure.rpcCode ?? -32603, message: failure.message ?? 'handler failed' },
      });
      return;
    }
    this.#write({ jsonrpc: '2.0', id: message.id, result: result ?? {} });
  }

  #onExit(code, signal, error = null) {
    if (this.exit) return;
    this.exit = { code, signal, error };
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        this.#exitError(
          `agent exited (${describeExit(this.exit)}) before answering ${pending.method}`,
        ),
      );
    }
    this.pending.clear();
    for (const listener of this.exitListeners) listener();
    this.exitListeners.clear();
    for (const waiter of this.exitWaiters) waiter(this.exit);
    this.exitWaiters.clear();
  }

  #exitError(message) {
    return new AgentExitError(`${message}${this.#stderrTail(5)}`, this.exit);
  }

  #violation(line, reason) {
    if (this.violations.length < MAX_VIOLATIONS) this.violations.push({ line, reason });
  }

  #stderrTail(lines) {
    const tail = this.stderr
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .slice(-lines);
    if (tail.length === 0) return '';
    return `\n  stderr:\n${tail.map((line) => `    ${line}`).join('\n')}`;
  }
}
