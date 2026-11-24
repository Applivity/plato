/**
 * W1 — `plato --acp`: the Agent Client Protocol v1, phase 1.
 *
 * COVERAGE NOTE (check us against the spec from here).
 *
 * Shapes follow `schema/v1/schema.json` from the `@agentclientprotocol/sdk`
 * 2.10.0 tarball, not the prose pages and not memory. Where prose and schema
 * disagreed while this was written, the schema won.
 *
 * Implemented:
 *  - `initialize` — protocolVersion 1, agentInfo, agentCapabilities (no
 *    loadSession), and one authMethod of type `terminal` with args ["--login"].
 *    The method is advertised UNCONDITIONALLY: the registry validator advertises
 *    the legacy `clientCapabilities.terminal` / `_meta["terminal-auth"]`, not
 *    `clientCapabilities.auth.terminal`, and a method that is never gated cannot
 *    fail the capability-shape check. Nothing about our login needs the gate.
 *  - `session/new` — cwd (absolute) becomes the workspace root; returns a
 *    session id. `auth_required` (-32000) when no provider is configured.
 *  - `session/prompt` — one run through the CLI's `executeTask`; streams
 *    `session/update` notifications: `agent_message_chunk`, `tool_call`,
 *    `tool_call_update`, and `plan` (from `todo_write`). Returns a stop reason.
 *  - `session/cancel` — notification; cancels the run's RunController, answers
 *    a pending `session/request_permission` as `cancelled`, and the prompt
 *    returns `cancelled`.
 *  - Agent → client `session/request_permission` with allow_once / allow_always
 *    / reject_once, so approvals become the client's cards.
 *
 * Deliberately not done in phase 1 (phase 2 owns the list):
 *  - `session/load`, `session/list`, `session/resume`, `session/delete`,
 *    `session/close`, modes, config options, slash commands.
 *  - `authenticate`: a `terminal` method MUST NOT be passed to it, so there is
 *    nothing for it to do.
 *  - MCP servers sent in `session/new` are accepted and ignored (stderr note).
 *    Only the CLI's own configured MCP servers start, through executeTask.
 *  - Image and embedded-resource prompt blocks: `promptCapabilities` advertises
 *    them false. Text and `resource_link` are supported (baseline).
 *  - `ask_user`, `reveal_protected` and the "stuck" ask have no ACP surface
 *    without elicitation, so they fail closed: a question gets the standard
 *    "user is not available" sentence, a protected file stays hidden, and a run
 *    that looks stuck stops instead of looping unattended.
 *  - One run per process. A second `session/prompt` while one is live is
 *    refused with -32600 rather than queued: two concurrent runs in one
 *    process have never been exercised in the CLI (the TUI allows one), and a
 *    silent queue would hide that.
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import {
  RunController,
  toolWords,
  type ApprovalRequest,
  type LoopResult,
} from '@applivity/plato-core';
import { loadConfig, type PlatoConfig } from '../config.js';
import {
  executeTask,
  toolTarget,
  type ExecuteOptions,
  type RunSink,
  type ToolEvent,
} from '../host.js';
import type { Env } from '../paths.js';
import { VERSION } from '../version.js';
import {
  AUTH_REQUIRED,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JsonRpcConnection,
  RESOURCE_NOT_FOUND,
  RpcFailure,
  type ConnectionIo,
} from './jsonrpc.js';

const PROTOCOL_VERSION = 1;

/** The sentence the one-shot host also uses when nobody can answer a question. */
const NO_USER =
  'The user is not available to answer. Continue with your best judgment, or stop and explain what you need.';

export interface AcpOptions {
  env?: Env;
  /** Injected by tests; the real host assembly otherwise. */
  execute?: (
    options: ExecuteOptions,
    sink: RunSink,
    controller: RunController,
  ) => Promise<LoopResult>;
  /**
   * `runAcp` owns SIGINT/SIGTERM so the protocol is closed by us, not by a
   * default handler. Tests pass false.
   */
  signals?: boolean;
  /** Injected by tests; `process.exit` otherwise. */
  exit?: (code: number) => void;
}

interface ToolCallState {
  id: string;
  name: string;
  started: boolean;
}

interface Session {
  id: string;
  cwd: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  controller: RunController | null;
  /** Answers a pending `session/request_permission` when the turn is cancelled. */
  cancelPermission: (() => void) | null;
  /** Tools the user chose "allow always" for, in this session. */
  alwaysAllow: Set<string>;
  calls: ToolCallState[];
  callSeq: number;
  /** Text already sent in the current turn, to compute deltas. */
  shown: string;
  messageId: string;
  messageSeq: number;
}

export class AcpAgent {
  private readonly conn: JsonRpcConnection;
  private readonly io: ConnectionIo;
  private readonly env: Env;
  private readonly execute: NonNullable<AcpOptions['execute']>;
  private readonly sessions = new Map<string, Session>();
  private active: Session | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    io: ConnectionIo,
    options: AcpOptions = {},
  ) {
    this.conn = new JsonRpcConnection(io);
    this.io = io;
    this.env = options.env ?? process.env;
    this.execute = options.execute ?? executeTask;
  }

  async run(): Promise<void> {
    this.conn.onRequest('initialize', (params) => this.initialize(params));
    this.conn.onRequest('session/new', (params) => this.newSession(params));
    this.conn.onRequest('session/prompt', (params) => this.prompt(params));
    this.conn.onNotification('session/cancel', (params) => this.cancel(params));
    await this.conn.start();
    // stdin closed: the client is gone. Stop whatever is still running so the
    // process can exit without a provider call holding it open.
    this.stop();
    if (this.inflight !== null) {
      await Promise.race([this.inflight, delay(2_000)]);
    }
  }

  /** Cancels every run and refuses further writes. Safe to call twice. */
  stop(): void {
    for (const session of this.sessions.values()) {
      session.controller?.cancel();
      session.cancelPermission?.();
    }
    this.conn.shutdown();
  }

  private initialize(params: unknown): unknown {
    const request = record(params);
    const requested = request['protocolVersion'];
    if (typeof requested !== 'number' || !Number.isInteger(requested)) {
      throw new RpcFailure(INVALID_PARAMS, 'protocolVersion must be an integer');
    }
    return {
      // Say 1 whatever the client asked for: 1 is the latest this agent speaks.
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
      agentInfo: { name: 'plato', title: 'Plato', version: VERSION },
      authMethods: [
        {
          type: 'terminal',
          id: 'plato-login',
          name: 'Sign in with a provider',
          description:
            'Runs the Plato setup in a terminal. Exit status 0 means the login succeeded.',
          // Appended to `plato --acp`, which makes `plato --acp --login`.
          args: ['--login'],
          _meta: { 'terminal-auth': { command: 'plato', args: ['auth', 'login'] } },
        },
      ],
    };
  }

  private newSession(params: unknown): unknown {
    const request = record(params);
    const cwd = request['cwd'];
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
      throw new RpcFailure(INVALID_PARAMS, 'cwd must be an absolute path');
    }
    const config = this.config();
    if (config.connections.length === 0) {
      throw new RpcFailure(
        AUTH_REQUIRED,
        "No provider is configured. Run 'plato auth login' to add one, then start a new session.",
      );
    }
    const servers = request['mcpServers'];
    if (Array.isArray(servers) && servers.length > 0) {
      this.io.err(
        "plato acp: session/new carried MCP servers; phase 1 uses the CLI's own MCP configuration instead.\n",
      );
    }
    const session: Session = {
      id: randomUUID(),
      cwd,
      history: [],
      controller: null,
      cancelPermission: null,
      alwaysAllow: new Set(),
      calls: [],
      callSeq: 0,
      shown: '',
      messageId: '',
      messageSeq: 0,
    };
    this.sessions.set(session.id, session);
    return { sessionId: session.id };
  }

  private async prompt(params: unknown): Promise<unknown> {
    const request = record(params);
    const sessionId = request['sessionId'];
    if (typeof sessionId !== 'string') {
      throw new RpcFailure(INVALID_PARAMS, 'sessionId must be a string');
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new RpcFailure(RESOURCE_NOT_FOUND, `no session '${sessionId}'`);
    }
    if (this.active !== null) {
      throw new RpcFailure(
        INVALID_REQUEST,
        'another session/prompt is still running; Plato runs one turn at a time',
      );
    }
    const task = promptText(request['prompt']);
    const config = this.config();
    if (config.connections.length === 0) {
      throw new RpcFailure(
        AUTH_REQUIRED,
        "No provider is configured. Run 'plato auth login' to add one.",
      );
    }

    const controller = new RunController();
    session.controller = controller;
    session.shown = '';
    session.messageId = '';
    this.active = session;
    const work = this.runPrompt(session, task, config, controller);
    this.inflight = work.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await work;
    } finally {
      this.active = null;
      this.inflight = null;
      session.controller = null;
      session.cancelPermission = null;
    }
  }

  private async runPrompt(
    session: Session,
    task: string,
    config: PlatoConfig,
    controller: RunController,
  ): Promise<{ stopReason: string }> {
    const sink = this.sink(session);
    let result: LoopResult;
    try {
      result = await this.execute(
        {
          root: session.cwd,
          task,
          mode: config.mode,
          config,
          env: this.env,
          ...(session.history.length === 0 ? {} : { history: session.history }),
        },
        sink,
        controller,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RpcFailure(INTERNAL_ERROR, message);
    }
    // The next prompt in this session continues this conversation, the same way
    // `plato -p -c` continues one: plain text pairs, which is all core keeps.
    session.history.push({ role: 'user', text: task });
    if (result.finalText.trim().length > 0) {
      session.history.push({ role: 'assistant', text: result.finalText });
    }
    if (session.shown.length > 0) {
      // Close the streamed message so the next turn starts a new one.
      session.messageId = '';
      session.shown = '';
    }
    return { stopReason: stopReasonOf(result) };
  }

  private cancel(params: unknown): void {
    const request = record(params);
    const sessionId = request['sessionId'];
    if (typeof sessionId !== 'string') {
      return;
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.controller?.cancel();
    session.cancelPermission?.();
  }

  private config(): PlatoConfig {
    try {
      return loadConfig(this.env);
    } catch (error) {
      throw new RpcFailure(
        INTERNAL_ERROR,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Sends one `session/update` notification. */
  private update(session: Session, update: Record<string, unknown>): void {
    this.conn.notify('session/update', { sessionId: session.id, update });
  }

  private sink(session: Session): RunSink {
    // The sink is a plain object, so `this` inside its methods is the object.
    const agent = this;
    const update = (value: Record<string, unknown>): void => agent.update(session, value);
    const chunk = (text: string): void => {
      if (text.length === 0) {
        return;
      }
      if (session.messageId === '') {
        session.messageSeq += 1;
        session.messageId = `m${session.messageSeq}`;
      }
      update({
        sessionUpdate: 'agent_message_chunk',
        messageId: session.messageId,
        content: { type: 'text', text },
      });
    };

    return {
      textDelta(soFar) {
        const delta = soFar.startsWith(session.shown) ? soFar.slice(session.shown.length) : soFar;
        session.shown = soFar;
        chunk(delta);
      },
      textCommitted(text) {
        // A provider that does not stream delivers its text only here; a
        // streamed one has already sent it, and this sends just the remainder.
        if (text.startsWith(session.shown) && text.length > session.shown.length) {
          chunk(text.slice(session.shown.length));
        }
        session.shown = '';
        session.messageId = '';
      },
      tool(event) {
        agent.toolEvent(session, event);
      },
      async approve(request) {
        return await agent.approve(session, request);
      },
      async askUser(request) {
        return request.questions.map(() => NO_USER);
      },
      async stuck() {
        // No card to draw without elicitation: stop rather than loop.
        return { action: 'stop' as const };
      },
      async reveal() {
        return false;
      },
      notice(text) {
        // Not protocol: ACP has no notice update, and model transcript should
        // not read like the agent said it. The client's stderr is the log.
        agent.io.err(`[plato] ${text}\n`);
      },
    };
  }

  private toolEvent(session: Session, event: ToolEvent): void {
    const target = toolTarget(event);
    const doing = toolWords(event.tool).doing;
    const title = target === null ? capitalise(doing) : `${capitalise(doing)}: ${target}`;

    if (event.phase === 'requested') {
      this.announce(session, event, title);
      return;
    }

    // A denied or refused call emits no `requested` event, but the client still
    // needs a tool call to attach the failure to. Announce it, then fail it.
    const call =
      takeCall(session, event.tool, event.phase === 'allowed') ??
      this.announce(session, event, title);
    if (event.phase === 'allowed') {
      this.update(session, { sessionUpdate: 'tool_call_update', toolCallId: call.id, status: 'in_progress' });
      if (event.tool === 'todo_write') {
        const plan = planOf(event.args);
        if (plan !== null) {
          this.update(session, { sessionUpdate: 'plan', entries: plan });
        }
      }
      return;
    }

    const status = event.phase === 'done' && event.ok !== false ? 'completed' : 'failed';
    this.update(session, {
      sessionUpdate: 'tool_call_update',
      toolCallId: call.id,
      status,
      ...(status === 'failed' ? { title: `${title} (${event.phase})` } : {}),
    });
  }

  /** Emits `tool_call` (pending) and remembers it for the updates that follow. */
  private announce(session: Session, event: ToolEvent, title: string): ToolCallState {
    session.callSeq += 1;
    const call: ToolCallState = { id: `call-${session.callSeq}`, name: event.tool, started: false };
    session.calls.push(call);
    const locations = locationsOf(session, event);
    this.update(session, {
      sessionUpdate: 'tool_call',
      toolCallId: call.id,
      title,
      name: event.tool,
      kind: kindOf(event.tool),
      status: 'pending',
      ...(event.args === undefined ? {} : { rawInput: event.args }),
      ...(locations === undefined ? {} : { locations }),
    });
    return call;
  }

  private async approve(session: Session, request: ApprovalRequest): Promise<boolean> {
    const key = request.host === undefined ? request.tool : `${request.tool} ${request.host}`;
    if (session.alwaysAllow.has(key)) {
      return true;
    }
    const call = session.calls.find((entry) => entry.name === request.tool && !entry.started);
    const toolCallId = call?.id ?? `permission-${request.tool}`;
    let settle: ((value: { outcome: { outcome: string } }) => void) | null = null;
    session.cancelPermission = (): void => {
      settle?.({ outcome: { outcome: 'cancelled' } });
    };
    const response = new Promise<{ outcome: { outcome: string } }>((resolveResponse) => {
      const answer = (value: { outcome: { outcome: string } }): void => {
        settle = null;
        resolveResponse(value);
      };
      settle = answer;
      this.conn
        .request('session/request_permission', {
          sessionId: session.id,
          toolCall: {
            toolCallId,
            title: `${capitalise(toolWords(request.tool).doing)}: ${targetOf(request)}`,
            kind: kindOf(request.tool),
            status: 'pending',
            rawInput: request.args,
            ...(request.preview === undefined || request.preview.length === 0
              ? {}
              : { content: [{ type: 'content', content: { type: 'text', text: request.preview } }] }),
          },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow-always', name: `Always allow ${request.tool}`, kind: 'allow_always' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        })
        .then(
          (value) => answer(permissionOutcome(value)),
          // A failed call (the connection closed, the client refused) is not an
          // approval. Fail closed.
          () => answer({ outcome: { outcome: 'cancelled' } }),
        );
    });
    const outcome = await response;
    session.cancelPermission = null;
    if (outcome.outcome.outcome !== 'selected') {
      return false;
    }
    const optionId = (outcome.outcome as { optionId?: unknown }).optionId;
    if (optionId === 'allow-always') {
      session.alwaysAllow.add(key);
      return true;
    }
    return optionId === 'allow-once';
  }
}

/** `plato --acp`: serve until stdin closes. */
export async function runAcp(io: ConnectionIo, options: AcpOptions = {}): Promise<number> {
  const agent = new AcpAgent(io, options);
  const exit = options.exit ?? ((code: number): void => process.exit(code));
  const detach: (() => void)[] = [];
  const streams = io.streams;

  // A CLOSED PIPE never throws: `process.stdout` emits an asynchronous 'error'
  // event, and with no listener Node turns it into an uncaught exception and a
  // stack trace. Watch both streams and end the server quietly instead.
  const watch = (stream: NodeJS.WritableStream, isOutput: boolean): void => {
    const onError = (error: Error): void => {
      agent.stop();
      if (isOutput) {
        try {
          io.err(`plato acp: output closed — ${error.message}\n`);
        } catch {
          // stderr is gone too; there is nowhere to say so.
        }
      }
      // Nothing more can reach a stream that failed. If the OTHER stream is
      // still open, flush it before exiting so the last frame is not cut.
      exitAfterFlush(isOutput ? null : (streams?.out ?? null), () => exit(1));
    };
    stream.once('error', onError);
    detach.push(() => stream.off('error', onError));
  };
  if (streams !== undefined) {
    watch(streams.out, true);
    watch(streams.err, false);
  }

  if (options.signals !== false) {
    // A mounted UI's signal handlers are not installed here, so these are ours.
    // Cancel first, then exit: the client asked for termination, and a protocol
    // stream cannot carry a farewell it did not ask for.
    const onSignal = (signal: NodeJS.Signals): void => {
      io.err(`plato acp: ${signal} — closing\n`);
      agent.stop();
      exitAfterFlush(streams?.out ?? null, () => exit(signal === 'SIGINT' ? 130 : 143));
    };
    const onInt = (): void => onSignal('SIGINT');
    const onTerm = (): void => onSignal('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    detach.push(() => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    });
  }

  try {
    await agent.run();
  } finally {
    for (const off of detach) off();
  }
  return 0;
}

/**
 * Calls `go` once the frame already queued on `stream` has reached the pipe.
 * `process.exit` in the same tick would otherwise cut it. The empty write's
 * callback runs when everything before it has flushed; the timer is the guard
 * for a stream that never calls back.
 */
function exitAfterFlush(stream: NodeJS.WritableStream | null, go: () => void): void {
  if (stream === null) {
    go();
    return;
  }
  let done = false;
  const finish = (): void => {
    if (done) {
      return;
    }
    done = true;
    clearTimeout(timer);
    go();
  };
  const timer = setTimeout(finish, 1_000);
  timer.unref();
  try {
    stream.write('', finish);
  } catch {
    finish();
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms).unref();
  });
}

function stopReasonOf(result: LoopResult): string {
  switch (result.reason) {
    case 'complete':
      return result.truncated === true ? 'max_tokens' : 'end_turn';
    case 'cap':
      return 'max_tokens';
    case 'cancelled':
      return 'cancelled';
    // "Looks stuck" is the CLI's own stop; the work so far is still an answer.
    case 'stuck':
      return 'end_turn';
  }
}

function kindOf(tool: string): string {
  switch (tool) {
    case 'read_file':
    case 'read_image':
    case 'list_dir':
    case 'bash_output':
      return 'read';
    case 'grep':
    case 'glob':
      return 'search';
    case 'write_file':
    case 'apply_diff':
    case 'apply_patch':
      return 'edit';
    case 'shell':
    case 'git':
    case 'kill_shell':
      return 'execute';
    case 'web_fetch':
      return 'fetch';
    case 'todo_write':
    case 'request_mode':
      return 'think';
    default:
      return 'other';
  }
}

function locationsOf(
  session: Session,
  event: ToolEvent,
): { path: string }[] | undefined {
  const path = event.args?.['path'];
  if (typeof path !== 'string' || path.length === 0) {
    return undefined;
  }
  return [{ path: resolve(session.cwd, path) }];
}

/** The call this event belongs to, or null when no `requested` preceded it. */
function takeCall(session: Session, name: string, started: boolean): ToolCallState | null {
  const match =
    session.calls.find((entry) => entry.name === name && !entry.started) ??
    session.calls.find((entry) => entry.name === name);
  if (match === undefined) {
    return null;
  }
  if (started) {
    match.started = true;
  } else {
    session.calls = session.calls.filter((entry) => entry !== match);
  }
  return match;
}

function planOf(args: unknown): { content: string; priority: string; status: string }[] | null {
  const todos = record(args)['todos'];
  if (!Array.isArray(todos)) {
    return null;
  }
  const entries: { content: string; priority: string; status: string }[] = [];
  for (const todo of todos) {
    const entry = record(todo);
    const content = entry['content'];
    const status = entry['status'];
    if (typeof content !== 'string') {
      continue;
    }
    entries.push({
      content,
      // Core's todo has no priority; ACP requires one. Medium is the honest
      // unfilled value rather than inventing emphasis.
      priority: 'medium',
      status:
        status === 'in_progress' || status === 'completed' || status === 'pending'
          ? status
          : 'pending',
    });
  }
  return entries.length === 0 ? null : entries;
}

function targetOf(request: ApprovalRequest): string {
  const path = request.args['path'];
  if (typeof path === 'string') {
    return path;
  }
  const command = request.args['command'];
  if (typeof command === 'string') {
    return command;
  }
  return request.tool;
}

function promptText(blocks: unknown): string {
  if (!Array.isArray(blocks)) {
    throw new RpcFailure(INVALID_PARAMS, 'prompt must be an array of content blocks');
  }
  const parts: string[] = [];
  for (const block of blocks) {
    const value = record(block);
    switch (value['type']) {
      case 'text': {
        if (typeof value['text'] === 'string') {
          parts.push(value['text']);
        }
        break;
      }
      case 'resource_link': {
        const name = typeof value['name'] === 'string' ? value['name'] : 'resource';
        const uri = typeof value['uri'] === 'string' ? value['uri'] : '';
        parts.push(`[resource: ${name}${uri === '' ? '' : ` — ${uri}`}]`);
        break;
      }
      case 'resource': {
        // Not advertised (embeddedContext: false), but a client that sends text
        // anyway gets it inlined rather than silently dropped.
        const resource = record(value['resource']);
        if (typeof resource['text'] === 'string') {
          const uri = typeof resource['uri'] === 'string' ? resource['uri'] : '';
          parts.push(`[${uri === '' ? 'resource' : uri}]\n${resource['text']}`);
        }
        break;
      }
      default:
        // image/audio are not advertised; ignore them rather than fail the turn.
        break;
    }
  }
  const text = parts.join('\n').trim();
  if (text.length === 0) {
    throw new RpcFailure(INVALID_PARAMS, 'the prompt has no text content');
  }
  return text;
}

function permissionOutcome(value: unknown): { outcome: { outcome: string; optionId?: unknown } } {
  const outcome = record(record(value)['outcome']);
  const kind = outcome['outcome'];
  if (kind === 'selected') {
    return { outcome: { outcome: 'selected', optionId: outcome['optionId'] } };
  }
  return { outcome: { outcome: 'cancelled' } };
}
