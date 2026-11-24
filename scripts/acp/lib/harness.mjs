/**
 * Case runner and assertions for the ACP harness.
 *
 * A case is `{ id, title, run(ctx) }`. `ctx.open()` starts an agent process;
 * the runner stops every process the case started, even after a failure.
 * Non-JSON-RPC lines on stdout fail the case, whichever case was running.
 */
import { killAgent } from './client.mjs';

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Ends a case as skipped, not failed. */
export class Skip extends Error {
  constructor(message) {
    super(message);
    this.name = 'Skip';
  }
}

export function assert(condition, message) {
  if (!condition) throw new AssertionError(message);
}

export function show(value, limit = 300) {
  if (typeof value === 'string') {
    return value.length <= limit ? JSON.stringify(value) : `${JSON.stringify(value.slice(0, limit))}...`;
  }
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return String(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

export function assertObject(value, label) {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object; got ${show(value)}`,
  );
}

export function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array; got ${show(value)}`);
}

export function assertString(value, label) {
  assert(typeof value === 'string', `${label} must be a string; got ${show(value)}`);
}

export function assertNonEmptyString(value, label) {
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${label} must be a non-empty string; got ${show(value)}`,
  );
}

export function assertInteger(value, label) {
  assert(
    typeof value === 'number' && Number.isInteger(value),
    `${label} must be an integer; got ${show(value)}`,
  );
}

export function assertOneOf(value, allowed, label) {
  assert(allowed.includes(value), `${label} must be one of ${allowed.join(', ')}; got ${show(value)}`);
}

export function createContext({ clientFactory, promptTimeoutMs, expectPlan = false }) {
  const clients = [];
  const rawChildren = [];
  const context = {
    promptTimeoutMs,
    expectPlan,
    detail: '',
    note(text) {
      this.detail = text;
    },
    skip(text) {
      throw new Skip(text);
    },
    async open(options = {}) {
      const client = await clientFactory(options);
      clients.push(client);
      return client;
    },
    /**
     * Start the agent as a bare child process, for transport-level cases that
     * must control the pipes directly. The factory supplies `raw`.
     */
    raw(options = {}) {
      if (typeof clientFactory.raw !== 'function') {
        throw new Error('this agent factory cannot start a raw process');
      }
      const child = clientFactory.raw(options);
      rawChildren.push(child);
      return child;
    },
  };
  return {
    context,
    clients,
    async cleanup() {
      await Promise.all(clients.map((client) => client.stop().catch(() => {})));
      for (const child of rawChildren) killAgent(child);
    },
  };
}

/** Run one case with a hard time limit. Cleanup is the caller's job. */
export async function runCase(definition, context, { timeoutMs }) {
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => definition.run(context)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`case timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { status: 'pass', detail: context.detail, ms: Date.now() - started };
  } catch (error) {
    const ms = Date.now() - started;
    if (error instanceof Skip) return { status: 'skip', detail: error.message, ms };
    if (error instanceof AssertionError) return { status: 'fail', detail: error.message, ms };
    if (error?.name === 'RpcError') {
      return {
        status: 'fail',
        detail: `agent returned a JSON-RPC error: ${error.message}${error.data === undefined ? '' : ` data: ${show(error.data)}`}`,
        ms,
      };
    }
    return {
      status: 'fail',
      detail: `${error?.name === 'Error' ? '' : `${error?.name}: `}${error?.message ?? String(error)}`,
      ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatViolations(violations) {
  return (
    `stdout carried ${violations.length} non-JSON-RPC line(s):\n` +
    violations
      .slice(0, 20)
      .map((violation) => `  [${violation.reason}] ${violation.line}`)
      .join('\n')
  );
}

/**
 * Start a fresh agent, run the case, stop the agent, and apply the global
 * stdout rule. The returned result is what the report prints.
 */
export async function evaluateCase(definition, clientFactory, options) {
  const { context, clients, cleanup } = createContext({
    clientFactory,
    promptTimeoutMs: options.promptTimeoutMs,
    expectPlan: options.expectPlan === true,
  });
  let result;
  try {
    result = await runCase(definition, context, { timeoutMs: options.caseTimeoutMs });
  } finally {
    await cleanup();
  }

  const violations = clients.flatMap((client) => client.violations);
  if (violations.length > 0) {
    const detail = formatViolations(violations);
    if (result.status === 'pass') result = { status: 'fail', detail, ms: result.ms };
    else if (!String(result.detail).includes('non-JSON-RPC')) {
      result.detail = [result.detail, detail].filter(Boolean).join('\n');
    }
  }

  result.stderr = clients
    .map((client) => client.stderr.trim())
    .filter((text) => text.length > 0)
    .join('\n');
  result.violations = violations;
  result.notes = clients.flatMap((client) => client.notes);
  return result;
}

function dots(title, width = 58) {
  if (title.length >= width) return title;
  return `${title} ${'.'.repeat(width - title.length)}`;
}

export function printResult(definition, result) {
  const mark = result.status.toUpperCase().padEnd(4);
  console.log(`  ${dots(`${definition.id}. ${definition.title}`)} ${mark}`);
  if (result.detail) {
    for (const line of String(result.detail).split('\n')) console.log(`      ${line}`);
  }
  // The client's own timeout and exit errors already carry the stderr tail.
  if (result.status === 'fail' && result.stderr && !String(result.detail).includes('stderr:')) {
    const lines = result.stderr.split('\n').slice(-20);
    console.log('      stderr (last 20 lines):');
    for (const line of lines) console.log(`        ${line}`);
  }
}

export function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const result of results) counts[result.status]++;
  return counts;
}

export function firstLine(text) {
  return String(text ?? '').split('\n')[0];
}
