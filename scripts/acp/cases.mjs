/**
 * The ACP v1 cases. Each one starts a fresh agent process, so one failure
 * cannot contaminate the next.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssertionError,
  Skip,
  assert,
  assertArray,
  assertInteger,
  assertNonEmptyString,
  assertObject,
  assertOneOf,
  show,
} from './lib/harness.mjs';
import { isolatedEnv } from './lib/env.mjs';

export const STOP_REASONS = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'];
export const PERMISSION_KINDS = ['allow_once', 'allow_always', 'reject_once', 'reject_always'];

const CLIENT_INFO = {
  name: 'plato-acp-harness',
  title: 'Plato ACP harness',
  version: '1.0.0',
};

/** What a current client sends: the newer terminal-auth spelling. */
export function modernInit() {
  return {
    protocolVersion: 1,
    clientCapabilities: { auth: { terminal: true } },
    clientInfo: CLIENT_INFO,
  };
}

/**
 * What the registry validator sends: the legacy hints only. The `_meta` hint is
 * at the params root, as ACP defines it.
 */
export function legacyInit() {
  return {
    protocolVersion: 1,
    clientCapabilities: {
      terminal: true,
      fs: { readTextFile: false, writeTextFile: false },
    },
    _meta: { 'terminal-auth': true },
    clientInfo: { name: 'acp-registry-validator', version: '0.0.0' },
  };
}

function makeDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function describeChildExit(exit) {
  if (exit?.error) return `failed to start: ${exit.error.message}`;
  if (exit?.signal) return `killed by ${exit.signal}`;
  return `code ${exit?.code}`;
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function openSession(client, cwd) {
  let result;
  try {
    result = await client.request(
      'session/new',
      { cwd, mcpServers: [] },
      { timeoutMs: 30_000 },
    );
  } catch (error) {
    if (error?.name === 'RpcError' && error.code === -32000) {
      throw new Skip(
        'session/new answered auth_required (-32000); that is expected while no model is configured',
      );
    }
    throw error;
  }
  assertNonEmptyString(result?.sessionId, 'session/new result.sessionId');
  return result.sessionId;
}

async function initialize(client, params = modernInit()) {
  return await client.request('initialize', params, { timeoutMs: 20_000 });
}

function textPrompt(text) {
  return [{ type: 'text', text }];
}

/** The first case. */
async function caseInitialize(context) {
  const client = await context.open();
  const result = await initialize(client);

  assertInteger(result.protocolVersion, 'result.protocolVersion');
  assert(
    result.protocolVersion === 1,
    `result.protocolVersion must be 1 for a v1 client; got ${show(result.protocolVersion)}`,
  );
  assertObject(result.agentCapabilities, 'result.agentCapabilities');
  assertObject(result.agentInfo, 'result.agentInfo');
  assertNonEmptyString(result.agentInfo.name, 'result.agentInfo.name');
  assertNonEmptyString(result.agentInfo.version, 'result.agentInfo.version');
  assertArray(result.authMethods, 'result.authMethods');
  assert(
    result.authMethods.length > 0,
    'result.authMethods is empty; the registry requires at least one method',
  );

  context.note(
    `protocol v${result.protocolVersion}, agent ${result.agentInfo.name} ${result.agentInfo.version}, ` +
      `${result.authMethods.length} auth method(s)`,
  );
}

/** The registry validator's own rule, with the validator's legacy hints. */
async function caseRegistryAuth(context) {
  const client = await context.open();
  const result = await initialize(client, legacyInit());

  assertArray(result.authMethods, 'result.authMethods');
  const accepted = result.authMethods.filter(
    (method) =>
      method !== null &&
      typeof method === 'object' &&
      (method.type === undefined || method.type === 'agent' || method.type === 'terminal'),
  );
  assert(
    accepted.length > 0,
    'no auth method has type "agent" or "terminal" (a missing type counts as "agent"). ' +
      `Methods: ${show(result.authMethods)}. ` +
      'The client sent only the legacy hints clientCapabilities.terminal and ' +
      '_meta["terminal-auth"]. An agent that checks only clientCapabilities.auth.terminal fails here.',
  );

  const chosen = accepted[0];
  assertNonEmptyString(chosen.id, 'the accepted method id');
  assertNonEmptyString(chosen.name, 'the accepted method name');
  context.note(`legacy hints accepted; method ${show(chosen.id)}, type ${chosen.type ?? 'agent'}`);
}

/** session/new, or an explicit auth_required, which is acceptable. */
async function caseNewSession(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-session-');
  try {
    const sessionId = await openSession(client, dir);
    context.note(`session ${sessionId}`);
  } finally {
    removeDir(dir);
  }
}

/** One prompt streams text and a tool call, then returns a stop reason. */
async function casePromptStreams(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-prompt-');
  writeFileSync(join(dir, 'probe.txt'), 'hello from the harness\n');
  try {
    client.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      return {
        outcome: {
          outcome: 'selected',
          optionId: pickOption(params, 'allow', 'permission request'),
        },
      };
    });
    const sessionId = await openSession(client, dir);
    const result = await client.request(
      'session/prompt',
      {
        sessionId,
        prompt: textPrompt(
          'Read the file probe.txt in the working directory and tell me what it contains. Then stop.',
        ),
      },
      { timeoutMs: context.promptTimeoutMs },
    );

    const updates = client.updatesFor(sessionId);
    const kinds = updates.map((update) => update?.sessionUpdate).filter(Boolean);
    const textChunks = updates.filter(
      (update) =>
        update?.sessionUpdate === 'agent_message_chunk' &&
        update.content?.type === 'text' &&
        typeof update.content.text === 'string' &&
        update.content.text.length > 0,
    );
    assert(
      textChunks.length > 0,
      `no agent_message_chunk with text arrived. Updates seen: ${show(kinds)}`,
    );

    const toolUpdates = updates.filter(
      (update) =>
        (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') &&
        typeof update.toolCallId === 'string' &&
        update.toolCallId.length > 0,
    );
    assert(
      toolUpdates.length > 0,
      `no tool_call or tool_call_update arrived. Updates seen: ${show(kinds)}`,
    );

    if (context.expectPlan) {
      const plans = updates.filter(
        (update) =>
          update?.sessionUpdate === 'plan' &&
          Array.isArray(update.entries) &&
          update.entries.length > 0,
      );
      assert(
        plans.length > 0,
        `no plan update with entries arrived. Updates seen: ${show(kinds)}`,
      );
    }

    assertOneOf(result.stopReason, STOP_REASONS, 'session/prompt result.stopReason');
    context.note(
      `${textChunks.length} text chunk(s), ${toolUpdates.length} tool update(s), ` +
        `stopReason ${result.stopReason}`,
    );
  } finally {
    removeDir(dir);
  }
}

function pickOption(params, mode, label) {
  assertArray(params?.options, `${label} options`);
  assert(params.options.length > 0, `${label} has no options`);
  const prefix = mode === 'allow' ? 'allow' : 'reject';
  const option = params.options.find(
    (candidate) => typeof candidate?.kind === 'string' && candidate.kind.startsWith(prefix),
  );
  assert(
    option !== undefined,
    `${label} offered no ${prefix} option; kinds: ${show(params.options.map((candidate) => candidate?.kind))}`,
  );
  assertNonEmptyString(option.optionId, `${label} optionId`);
  return option.optionId;
}

function validatePermissionRequest(params, sessionId, label) {
  assertObject(params, `${label} params`);
  assert(
    params.sessionId === sessionId,
    `${label} sessionId ${show(params.sessionId)} does not match ${sessionId}`,
  );
  assertObject(params.toolCall, `${label} toolCall`);
  assertNonEmptyString(params.toolCall.toolCallId, `${label} toolCall.toolCallId`);
  assertArray(params.options, `${label} options`);
  for (const [index, option] of params.options.entries()) {
    assertNonEmptyString(option?.optionId, `${label} options[${index}].optionId`);
    assertNonEmptyString(option?.name, `${label} options[${index}].name`);
    assertOneOf(option?.kind, PERMISSION_KINDS, `${label} options[${index}].kind`);
  }
}

/** The permission request arrives, and the harness answers it both ways. */
async function casePermissionBothWays(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-permission-');
  try {
    let mode = 'allow';
    const requests = [];
    client.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      requests.push({ mode, params });
      return { outcome: { outcome: 'selected', optionId: pickOption(params, mode, 'permission request') } };
    });

    const allowSession = await openSession(client, dir);
    const allowResult = await client.request(
      'session/prompt',
      {
        sessionId: allowSession,
        prompt: textPrompt(
          'Create a file named probe-write.txt in the working directory containing the word hello, then tell me what you did.',
        ),
      },
      { timeoutMs: context.promptTimeoutMs },
    );
    const allowRequest = requests.find((entry) => entry.mode === 'allow');
    assert(
      allowRequest !== undefined,
      'no session/request_permission arrived for the first prompt. If the run auto-approved the write, the permission bridge is not exercised.',
    );
    validatePermissionRequest(allowRequest.params, allowSession, 'allow permission request');
    assertOneOf(allowResult.stopReason, STOP_REASONS, 'first prompt result.stopReason');

    mode = 'reject';
    const rejectSession = await openSession(client, dir);
    const rejectResult = await client.request(
      'session/prompt',
      {
        sessionId: rejectSession,
        prompt: textPrompt(
          'Create a file named probe-write.txt in the working directory containing the word hello, then tell me what you did.',
        ),
      },
      { timeoutMs: context.promptTimeoutMs },
    );
    const rejectRequest = requests.find((entry) => entry.mode === 'reject');
    assert(
      rejectRequest !== undefined,
      'no session/request_permission arrived for the second prompt',
    );
    validatePermissionRequest(rejectRequest.params, rejectSession, 'reject permission request');
    assertOneOf(rejectResult.stopReason, STOP_REASONS, 'second prompt result.stopReason');

    const kinds = [
      ...new Set(
        [...allowRequest.params.options, ...rejectRequest.params.options].map(
          (option) => option.kind,
        ),
      ),
    ];
    context.note(
      `allow and reject both answered; offered ${kinds.join(', ')}; ` +
        `stop reasons ${allowResult.stopReason} and ${rejectResult.stopReason}`,
    );
  } finally {
    removeDir(dir);
  }
}

/** session/cancel during a run ends it with stopReason "cancelled". */
async function caseCancel(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-cancel-');
  try {
    client.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      return {
        outcome: {
          outcome: 'selected',
          optionId: pickOption(params, 'allow', 'permission request'),
        },
      };
    });
    const sessionId = await openSession(client, dir);
    const started = Date.now();
    const prompt = client.request(
      'session/prompt',
      {
        sessionId,
        prompt: textPrompt('Count slowly from 1 to 1000, one number per line. Do not use tools.'),
      },
      { timeoutMs: context.promptTimeoutMs },
    );

    try {
      await client.waitForNotification(
        (notification) =>
          notification.method === 'session/update' && notification.params?.sessionId === sessionId,
        30_000,
      );
    } catch {
      const result = await prompt;
      throw new AssertionError(
        `the run ended with ${show(result?.stopReason)} before any session/update arrived, ` +
          'so cancellation could not be delivered mid-run',
      );
    }

    client.notify('session/cancel', { sessionId });
    const result = await prompt;
    assertOneOf(result.stopReason, STOP_REASONS, 'session/prompt result.stopReason');
    assert(
      result.stopReason === 'cancelled',
      `session/cancel did not end the run: stopReason is ${show(result.stopReason)} ` +
        `(first update after ${Date.now() - started}ms)`,
    );
    context.note(`cancelled ${Date.now() - started}ms after the prompt started`);
  } finally {
    removeDir(dir);
  }
}

/** Every stdout line is a JSON-RPC message. */
async function caseStdoutPurity(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-purity-');
  writeFileSync(join(dir, 'probe.txt'), 'hello from the harness\n');
  let sessionId = null;
  try {
    try {
      sessionId = await openSession(client, dir);
    } catch (error) {
      // No session means no prompt to exercise; stdout purity is still checked.
      if (!(error instanceof Skip) && error?.name !== 'RpcError') throw error;
    }
    if (sessionId !== null) {
      try {
        await client.request(
          'session/prompt',
          {
            sessionId,
            prompt: textPrompt('Read probe.txt and say what it contains.'),
          },
          { timeoutMs: context.promptTimeoutMs },
        );
      } catch (error) {
        // An error response is still a valid JSON-RPC message.
        if (error?.name !== 'RpcError') throw error;
      }
    }
  } finally {
    removeDir(dir);
  }

  assert(client.lineCount > 0, 'the agent wrote nothing to stdout');
  assert(
    client.violations.length === 0,
    `stdout carried ${client.violations.length} non-JSON-RPC line(s):\n` +
      client.violations.map((violation) => `  [${violation.reason}] ${violation.line}`).join('\n'),
  );
  context.note(
    `${client.lineCount} stdout line(s), all JSON-RPC ` +
      `(${sessionId === null ? 'init and session attempt' : 'init, session, prompt'})`,
  );
}

/** initialize answers with no configuration and an empty HOME. */
async function caseEmptyHome(context) {
  const home = makeDir('plato-acp-home-');
  const client = await context.open({ env: isolatedEnv(home) });
  try {
    const result = await client.request('initialize', modernInit(), { timeoutMs: 30_000 });
    assertInteger(result.protocolVersion, 'result.protocolVersion');
    assertObject(result.agentInfo, 'result.agentInfo');
    assertNonEmptyString(result.agentInfo.name, 'result.agentInfo.name');
    context.note('answered initialize with an empty HOME and no provider credentials');
  } finally {
    await client.stop();
    removeDir(home);
  }
}

/**
 * The hand-written framing must echo ids, must not answer notifications, and
 * must survive a malformed line. This is case 9, added at the manager's request.
 */
async function callUnknownMethod(client, id, label) {
  try {
    await client.callWithId(id, 'harness/unknown-method', {}, { timeoutMs: 8_000 });
    throw new AssertionError(`${label}: an unknown method returned a result instead of an error`);
  } catch (error) {
    if (error instanceof AssertionError) throw error;
    if (error?.name === 'RpcError' && error.code === -32601) return;
    const unknownIds = client.violations.filter((violation) =>
      violation.reason.startsWith('response for unknown id'),
    );
    if (unknownIds.length > 0) {
      throw new AssertionError(
        `${label}: the agent did not echo the id exactly. Lines: ${unknownIds
          .map((violation) => violation.line)
          .join(' | ')}`,
      );
    }
    throw error;
  }
}

async function caseFramingRobustness(context) {
  const client = await context.open();
  await initialize(client);

  await callUnknownMethod(client, 'harness-string-id', 'a string request id');
  await callUnknownMethod(client, 900001, 'a numeric request id');

  const beforeNotification = client.lines.length;
  client.notify('session/cancel', { sessionId: 'no-such-session' });
  await callUnknownMethod(client, 'after-notification', 'a request after a notification');
  const stray = client.lines
    .slice(beforeNotification)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((message) => message !== null && message.id !== 'after-notification');
  assert(
    stray.length === 0,
    `the agent answered a notification or wrote an extra message: ${stray.map((message) => show(message)).join(' | ')}`,
  );

  const beforeGarbage = client.lines.length;
  client.sendRaw('this line is not JSON-RPC');
  await callUnknownMethod(client, 'after-garbage', 'a valid request after a malformed line');
  const afterGarbage = client.lines
    .slice(beforeGarbage)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((message) => message !== null);
  for (const message of afterGarbage) {
    const isAnswer = message.id === 'after-garbage';
    const isParseError =
      message.id === null &&
      (message.error?.code === -32700 || message.error?.code === -32600);
    assert(
      isAnswer || isParseError,
      `after a malformed line the agent wrote an unexpected message: ${show(message)}`,
    );
  }
  assert(client.exit === null, `the agent died after a malformed line: ${show(client.exit)}`);

  context.note(
    'string id, numeric id, notification, and malformed line handled; the agent stayed alive',
  );
}

/**
 * One run per process: a second session/prompt while one is live is refused
 * with -32600, not queued.
 */
async function caseConcurrentPrompt(context) {
  const client = await context.open();
  await initialize(client);
  const dir = makeDir('plato-acp-concurrent-');
  try {
    client.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      return {
        outcome: {
          outcome: 'selected',
          optionId: pickOption(params, 'allow', 'permission request'),
        },
      };
    });
    const sessionId = await openSession(client, dir);
    const first = client.request(
      'session/prompt',
      { sessionId, prompt: textPrompt('Write the probe file.') },
      { timeoutMs: context.promptTimeoutMs },
    );

    await client.waitForNotification(
      (notification) =>
        notification.method === 'session/update' && notification.params?.sessionId === sessionId,
      30_000,
    );

    let secondError = null;
    try {
      await client.request(
        'session/prompt',
        { sessionId, prompt: textPrompt('A second prompt during the first.') },
        { timeoutMs: 10_000 },
      );
    } catch (error) {
      secondError = error;
    }
    assert(
      secondError !== null,
      'a second session/prompt during a run returned a result; the agent must refuse it with -32600',
    );
    assert(
      secondError.name === 'RpcError' && secondError.code === -32600,
      `the second prompt failed with code ${show(secondError.code)} (${secondError.message}); expected -32600`,
    );

    client.notify('session/cancel', { sessionId });
    const result = await first;
    assertOneOf(result.stopReason, STOP_REASONS, 'first prompt result.stopReason');
    context.note(
      `the second prompt was refused with -32600; the first ended ${result.stopReason}`,
    );
  } finally {
    removeDir(dir);
  }
}

/** A client that closes its read end must not make the agent crash. */
async function caseClosedPipe(context) {
  const client = await context.open();
  await initialize(client);

  client.closeReadPipe();
  client.sendRaw(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'after-close',
      method: 'initialize',
      params: modernInit(),
    }),
  );

  const exit = await client.waitForExit(5_000);
  assert(exit !== null, 'the agent did not exit within 5s after the client closed the stdout pipe');
  assert(
    exit.signal === null || exit.signal === undefined,
    `the agent was killed by ${exit.signal} after the client closed the stdout pipe`,
  );
  assert(
    exit.code === 0 || exit.code === 1,
    `the agent exited with code ${exit.code} after the client closed the stdout pipe; ` +
      'a clean close is code 0 or 1, not a crash',
  );
  assert(
    !/Unhandled 'error' event/.test(client.stderr),
    `the agent crashed after the stdout pipe closed:\n${client.stderr.slice(-2_000)}`,
  );
  assert(
    !/\n\s+at /.test(client.stderr),
    `the agent printed a stack trace after the stdout pipe closed:\n${client.stderr.slice(-2_000)}`,
  );
  const stderrLines = client.stderr.split('\n').filter((line) => line.trim().length > 0);
  assert(
    stderrLines.length <= 2,
    `the agent wrote ${stderrLines.length} stderr lines after the pipe closed; one line is enough:\n` +
      client.stderr.slice(-2_000),
  );
  context.note(
    `the agent closed with code ${exit.code} and ${stderrLines.length} stderr line(s), no stack trace`,
  );
}

/** A request sent just before stdin closes must still get its whole response. */
async function caseLastFrame(context) {
  const child = context.raw();
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.on('error', (error) => {
    spawnError = error;
  });

  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'last-frame',
        method: 'initialize',
        params: modernInit(),
      })}\n`,
    );
    child.stdin.end();
  } catch (error) {
    throw new AssertionError(`could not send the last request: ${error.message}`);
  }

  const exit = await waitForChildExit(child, 5_000);
  assert(spawnError === null, `the agent failed to start: ${spawnError?.message ?? ''}`);
  assert(
    exit !== null,
    `the agent did not exit within 5s after stdin closed${stderr ? `; stderr:\n${stderr.slice(-1_000)}` : ''}`,
  );
  assert(
    exit.code === 0,
    `the agent exited with ${describeChildExit(exit)} after stdin closed`,
  );
  assert(
    stdout.length > 0,
    `the agent wrote nothing to stdout before exiting${stderr ? `; stderr:\n${stderr.slice(-1_000)}` : ''}`,
  );
  assert(
    stdout.endsWith('\n'),
    `the last frame did not end with a newline; stdout was: ${show(stdout)}`,
  );

  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const messages = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      throw new AssertionError(`a stdout line was cut or not JSON: ${show(line)}`);
    }
  }
  const answer = messages.find((message) => message && message.id === 'last-frame');
  assert(
    answer !== undefined,
    `the initialize response was cut on shutdown; stdout was: ${show(stdout)}`,
  );
  assert(
    answer.result !== undefined,
    `the last frame was an error, not a result: ${show(answer)}`,
  );
  context.note(`the last response arrived whole before exit (${lines.length} line(s))`);
}

export function buildCases() {
  return [
    { id: 1, title: 'initialize handshake', run: caseInitialize },
    { id: 2, title: 'registry auth rule (legacy hints)', run: caseRegistryAuth },
    { id: 3, title: 'session/new returns a session id', run: caseNewSession },
    { id: 4, title: 'prompt streams text and a tool call', run: casePromptStreams },
    { id: 5, title: 'permission is answered both ways', run: casePermissionBothWays },
    { id: 6, title: 'cancel ends the run', run: caseCancel },
    { id: 7, title: 'stdout is JSON-RPC only', run: caseStdoutPurity },
    { id: 8, title: 'empty HOME answers initialize', run: caseEmptyHome },
    { id: 9, title: 'framing survives ids and bad input', run: caseFramingRobustness },
    { id: 10, title: 'a concurrent prompt is refused', run: caseConcurrentPrompt },
    { id: 11, title: 'a closed stdout pipe exits cleanly', run: caseClosedPipe },
    { id: 12, title: 'the last frame survives stdin close', run: caseLastFrame },
  ];
}
