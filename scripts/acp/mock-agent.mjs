#!/usr/bin/env node
/**
 * A small ACP v1 agent over stdio, for testing the harness.
 *
 * It needs no model, no key, and no configuration. It implements the required
 * methods: initialize, session/new, session/prompt, session/cancel, and the
 * session/update notifications. It asks the client for permission before a
 * tool runs.
 *
 * `--variant <name>` makes it deliberately wrong, so the harness can prove
 * that it detects the fault:
 *   default         a conforming agent
 *   trap-auth       advertises terminal auth only for clientCapabilities.auth.terminal
 *   no-auth         advertises no auth methods
 *   auth-required   session/new returns -32000
 *   no-tool         never emits a tool call
 *   no-plan         never emits a plan update
 *   no-permission   never asks for permission
 *   ignore-cancel   ignores session/cancel and finishes with end_turn
 *   noisy           writes one non-JSON line to stdout on each prompt
 *   crash-on-pipe   throws on a closed stdout pipe, with a stack trace
 *   truncate-last   cuts the last frame when stdin closes
 */
import { createInterface } from 'node:readline';

// A client that closes its read end is a clean shutdown, not a crash.
process.stdout.on('error', (error) => {
  if (VARIANT === 'crash-on-pipe') throw error;
  if (error?.code === 'EPIPE') process.exit(0);
  throw error;
});

const ARGV = process.argv.slice(2);
function option(name) {
  const index = ARGV.indexOf(name);
  return index >= 0 ? ARGV[index + 1] : undefined;
}
const VARIANT = option('--variant') ?? 'default';
const CANCELLED = Symbol('cancelled');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...parts) {
  process.stderr.write(`[mock-acp] ${parts.join(' ')}\n`);
}
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}
function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

const sessions = new Map();
let sessionCounter = 0;
let toolCallCounter = 0;
const pendingClientCalls = new Map();
let clientCallCounter = 0;

function callClient(method, params) {
  const id = `mock-${++clientCallCounter}`;
  return new Promise((resolve, reject) => {
    pendingClientCalls.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function terminalMethod() {
  return {
    id: 'plato-login',
    name: 'Log in from the terminal',
    description: 'Run the agent with --login and sign in interactively.',
    type: 'terminal',
    args: ['--login'],
    _meta: { 'terminal-auth': true },
  };
}

function authMethodsFor(params) {
  if (VARIANT === 'no-auth') return [];
  if (VARIANT === 'trap-auth') {
    // The trap: only the newer capability spelling is understood.
    const modern = params?.clientCapabilities?.auth?.terminal === true;
    return modern ? [terminalMethod()] : [];
  }
  return [terminalMethod()];
}

function handleInitialize(message) {
  respond(message.id, {
    protocolVersion: 1,
    agentCapabilities: {},
    agentInfo: { name: 'plato-acp-mock', title: 'Plato ACP mock agent', version: '1.0.0' },
    authMethods: authMethodsFor(message.params),
  });
}

function handleSessionNew(message) {
  if (VARIANT === 'auth-required') {
    respondError(message.id, -32000, 'Authentication required');
    return;
  }
  if (typeof message.params?.cwd !== 'string' || message.params.cwd.length === 0) {
    respondError(message.id, -32602, 'session/new requires a cwd string');
    return;
  }
  const id = `mock-sess-${++sessionCounter}`;
  sessions.set(id, { id, running: false, cancelled: false, cancelWaiters: new Set() });
  respond(message.id, { sessionId: id });
}

function cancelSession(params) {
  if (VARIANT === 'ignore-cancel') return;
  const session = sessions.get(params?.sessionId);
  if (!session) return;
  session.cancelled = true;
  for (const waiter of session.cancelWaiters) waiter();
  session.cancelWaiters.clear();
}

function awaitPermission(session, promise) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      session.cancelWaiters.delete(onCancel);
      resolve(value);
    };
    const onCancel = () => settle(CANCELLED);
    session.cancelWaiters.add(onCancel);
    promise.then(
      (value) => settle(value),
      // A client that cannot answer denies the tool; it does not cancel the run.
      () => settle({ error: true }),
    );
  });
}

async function runPrompt(message) {
  const session = sessions.get(message.params?.sessionId);
  if (!session) {
    respondError(message.id, -32002, `Unknown session: ${String(message.params?.sessionId)}`);
    return;
  }
  if (!Array.isArray(message.params?.prompt)) {
    respondError(message.id, -32602, 'session/prompt requires a prompt array');
    return;
  }
  if (session.running) {
    respondError(message.id, -32600, 'A turn is already running for this session');
    return;
  }

  session.running = true;
  session.cancelled = false;
  let responded = false;
  const finish = (result) => {
    if (responded) return;
    responded = true;
    respond(message.id, result);
  };
  const finishError = (code, text) => {
    if (responded) return;
    responded = true;
    respondError(message.id, code, text);
  };
  const stopped = () => {
    if (session.cancelled && VARIANT !== 'ignore-cancel') {
      finish({ stopReason: 'cancelled' });
      return true;
    }
    return false;
  };
  const toolCallId = `call_${++toolCallCounter}`;

  try {
    if (VARIANT === 'noisy') {
      // The offending line: valid text, not JSON-RPC.
      process.stdout.write('mock-acp: this line is not a JSON-RPC message\n');
    }

    notify('session/update', {
      sessionId: session.id,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Working on it.' },
      },
    });
    await sleep(80);
    if (stopped()) return;

    if (VARIANT !== 'no-tool') {
      notify('session/update', {
        sessionId: session.id,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: 'Read a file',
          kind: 'read',
          status: 'pending',
        },
      });
      if (VARIANT !== 'no-plan') {
        notify('session/update', {
          sessionId: session.id,
          update: {
            sessionUpdate: 'plan',
            entries: [{ content: 'Read a file', priority: 'medium', status: 'in_progress' }],
          },
        });
      }
      await sleep(80);
      if (stopped()) return;
    }

    let decision = 'allow';
    if (VARIANT !== 'no-permission') {
      const permission = callClient('session/request_permission', {
        sessionId: session.id,
        toolCall: { toolCallId },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
        ],
      });
      const answer = await awaitPermission(session, permission);
      if (answer === CANCELLED) {
        finish({ stopReason: 'cancelled' });
        return;
      }
      if (answer?.outcome?.outcome === 'cancelled') {
        finish({ stopReason: 'cancelled' });
        return;
      }
      if (answer?.outcome?.outcome === 'selected') {
        decision = String(answer.outcome.optionId).startsWith('reject') ? 'reject' : 'allow';
      } else if (answer?.error) {
        decision = 'reject';
      }
      if (stopped()) return;
    }

    if (VARIANT !== 'no-tool') {
      notify('session/update', {
        sessionId: session.id,
        update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' },
      });
      await sleep(120);
      if (stopped()) return;
      notify('session/update', {
        sessionId: session.id,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: decision === 'reject' ? 'failed' : 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: decision === 'reject' ? 'Permission denied.' : 'Read 12 lines.',
              },
            },
          ],
        },
      });
      await sleep(60);
      if (stopped()) return;
    }

    notify('session/update', {
      sessionId: session.id,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Done.' },
      },
    });
    finish({ stopReason: 'end_turn' });
  } catch (error) {
    finishError(-32603, `mock agent failed: ${error?.message ?? String(error)}`);
  } finally {
    session.running = false;
  }
}

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log('malformed input line; answering with a parse error');
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
    return;
  }

  // A response to a request this agent made to the client.
  if (message.method === undefined) {
    const pending = pendingClientCalls.get(message.id);
    if (!pending) return;
    pendingClientCalls.delete(message.id);
    if (message.error !== undefined) pending.reject(message.error);
    else pending.resolve(message.result);
    return;
  }

  // A notification has no id and must not be answered.
  if (message.id === undefined || message.id === null) {
    if (message.method === 'session/cancel') cancelSession(message.params);
    return;
  }

  switch (message.method) {
    case 'initialize':
      handleInitialize(message);
      return;
    case 'session/new':
      handleSessionNew(message);
      return;
    case 'session/prompt':
      void runPrompt(message);
      return;
    case 'authenticate':
      respond(message.id, {});
      return;
    default:
      respondError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

log(`started, variant=${VARIANT}`);
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', handleLine);
reader.on('close', () => {
  if (VARIANT === 'truncate-last') {
    // A deliberately cut frame: valid prefix, no newline, no closing braces.
    process.stdout.write('{"jsonrpc":"2.0","id":"last-frame","result":');
  }
});
