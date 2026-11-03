import { join } from 'node:path';
import {
  AgentBus,
  RunController,
  TranscriptWriter,
  createProvider,
  createVault,
  modelSupportsReasoning,
  parseModelRef,
  runAgentLoop,
  seedVault,
  type ApprovalRequest,
  type ChatProvider,
  type LoopResult,
  type Mode,
  type ReasoningConfig,
  type RunEndReason,
  type SessionPeer,
  type SendOutcome,
  type StuckRequest,
  loadImageAttachment,
  looksLikeImage,
  toolWords,
} from '@applivity/plato-core';
import { type PlatoConfig } from './config.js';
import {
  createObservers,
  observerSpecs,
  observerSummary,
  watchObservers,
  type ObserverEvent,
  type ObserverSpec,
} from './team.js';
import { HostError } from './errors.js';
import { saveSession, type StoredSession } from './sessions.js';
import { startMcpServers } from './mcp.js';
import { connectionNeedsKey, resolveKey } from './keys.js';
import { modelPool } from './models.js';
import { platoHome, projectKey, runsDir, type Env } from './paths.js';
export { runsDir };
export { projectKey };
import type { CliInput, Streams } from './io.js';
import type { Prompter } from './prompt.js';

export type OutputFormat = 'text' | 'json' | 'stream-json';

export interface AskQuestion {
  question: string;
  header?: string;
  context?: string;
  options: string[];
  recommended?: string;
  multiple?: boolean;
}

export interface AskRequest {
  questions: AskQuestion[];
}

export interface ToolEvent {
  tool: string;
  phase: string;
  ok?: boolean;
  reason?: string;
  /**
   * The call's arguments. The trace reads ONE identifying value out of them
   * (a path, a pattern, a command); nothing here is written to the transcript,
   * which has always dropped the arguments.
   */
  args?: Record<string, unknown>;
}

/**
 * What a host does with the loop's asks. The one-shot host answers them on the
 * streams; the interactive host answers them with cards. Both drive the same
 * `executeTask`, so the engine sees one host contract (D49bw).
 */
export interface RunSink {
  textDelta(textSoFar: string): void;
  textCommitted(text: string): void;
  tool(event: ToolEvent): void;
  approve(request: ApprovalRequest): Promise<boolean>;
  askUser(request: AskRequest): Promise<string[]>;
  stuck(request: StuckRequest): Promise<{ action: 'continue' | 'stop'; guidance?: string }>;
  reveal(protectedPath: string): Promise<boolean>;
  notice(text: string): void;
  /** The observer strip and the closing observer line. */
  observer?(event: ObserverEvent): void;
  /**
   * The model asked for a mode (D49cb). Draw the card and, on a yes, apply the
   * mode through the session. `current` is the mode in force when the request
   * arrived. The note is the tool result the model reads.
   *
   * A sink without this does not offer the tool at all: a request that cannot
   * be answered must not be advertised.
   */
  requestMode?(request: {
    mode: Mode;
    reason: string;
    current: Mode;
  }): Promise<{ ok: boolean; note: string }>;
}

export interface ExecuteOptions {
  root: string;
  task: string;
  mode: Mode;
  /**
   * The mode the running loop reads at every tool call. Absent, the run-start
   * `mode` above is used, which cannot change mid-run.
   */
  getMode?: () => Mode;
  config: PlatoConfig;
  env: Env;
  /** Set only when the command line named one; a config model fails as config. */
  model?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
  fetchImpl?: typeof fetch;
  now?: number;
  /** Injected by the scripted runs; built from the connection otherwise. */
  provider?: ChatProvider;
  /** Injected by the scripted runs; builds a real philosopher otherwise. */
  observerProvider?: (spec: ObserverSpec) => ChatProvider | null;
  /** D49cq: live sessions this run may list and message. */
  sessions?: {
    list: () => Promise<SessionPeer[]>;
    send: (to: string, text: string) => Promise<SendOutcome>;
  };
  /** D49cq: `'session'` when another session sent this task (depth 1). */
  origin?: 'user' | 'session';
}

/** `~/.plato` state is shared with the extension (D49bw). */
export function undoDir(root: string, env: Env = process.env): string {
  return join(platoHome(env), 'undo', projectKey(root));
}

/** D49n: the extension's cap, applied to attached images. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export interface ImageMentions {
  images: { mime: import('@applivity/plato-core').ImageMime; data: string }[];
  rejected: { path: string; reason: string }[];
}

/**
 * `@path` mentions that name an image. The type is sniffed from the bytes, so
 * a text file renamed to `.png` is rejected rather than silently attached as
 * mojibake. A mention that is not image-shaped is left as text.
 */
export async function imageMentions(task: string, root: string): Promise<ImageMentions> {
  const images: ImageMentions['images'] = [];
  const rejected: ImageMentions['rejected'] = [];
  const seen = new Set<string>();

  for (const match of task.matchAll(/@([^\s@]+)/g)) {
    const rel = match[1] ?? '';
    if (rel.length === 0 || seen.has(rel) || !looksLikeImage(rel)) {
      continue;
    }
    seen.add(rel);
    const loaded = await loadImageAttachment(rel, root, MAX_IMAGE_BYTES);
    if (loaded.ok) {
      images.push({ mime: loaded.image.mime, data: loaded.image.data });
    } else {
      rejected.push({ path: rel, reason: loaded.reason });
    }
  }
  return { images, rejected };
}

export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function summary(result: LoopResult): string {
  const cost = result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : '';
  return `${result.turns} ${result.turns === 1 ? 'turn' : 'turns'} · ${formatCount(
    result.inputTokens,
  )} in · ${formatCount(result.outputTokens)} out${cost}`;
}

export function reasonText(reason: RunEndReason): string {
  switch (reason) {
    case 'complete':
      return 'complete';
    case 'cap':
      return 'the output token cap was reached';
    case 'cancelled':
      return 'cancelled';
    case 'stuck':
      return 'stopped because it looked stuck';
  }
}

/**
 * The one value that says WHICH call this was: the file, the pattern, the
 * command. A path is what a reader needs to follow a run; `read_file` alone
 * says only that something was read.
 *
 * A tool with no such value returns null rather than falling back to its first
 * string — `write_file`'s other string is the file's content, and `todo_write`'s
 * is the plan. Tools not listed here (ask_user, MCP) are named by what they do.
 */
function toolTarget(event: ToolEvent): string | null {
  const args = event.args;
  if (args === undefined) {
    return null;
  }
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  switch (event.tool) {
    case 'read_file':
    case 'write_file':
    case 'apply_diff':
      return text(args['path']);
    case 'list_dir':
      return text(args['path']) ?? 'the workspace';
    case 'grep': {
      const pattern = text(args['pattern']);
      const scope = text(args['glob']);
      if (pattern === null) return null;
      return scope === null ? pattern : `${pattern} in ${scope}`;
    }
    case 'glob':
      return text(args['pattern']);
    case 'shell':
      return text(args['command']);
    case 'git':
      return text(args['verb']);
    case 'bash_output':
    case 'kill_shell':
      return text(args['id']);
    case 'web_fetch':
      return text(args['url']);
    case 'apply_patch': {
      const patches = args['patches'];
      if (!Array.isArray(patches)) return null;
      const paths = patches
        .map((patch) =>
          typeof patch === 'object' && patch !== null
            ? text((patch as Record<string, unknown>)['path'])
            : null,
        )
        .filter((path): path is string => path !== null);
      if (paths.length === 0) return null;
      const shown = paths.slice(0, 3).join(', ');
      return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
    }
    default:
      return null;
  }
}

/**
 * A target on one line and short enough to leave room for the prefix and the
 * terminal. A command's start says what it is; a path's END does, so a long one
 * keeps its tail.
 */
export const TARGET_LIMIT = 60;

export function shortTarget(target: string, limit = TARGET_LIMIT): string {
  const flat = target.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) {
    return flat;
  }
  const head = Math.floor((limit - 1) * 0.35);
  return `${flat.slice(0, head)}…${flat.slice(-(limit - 1 - head))}`;
}

export function toolLine(event: ToolEvent): string | null {
  const doing = toolWords(event.tool).doing;
  const target = toolTarget(event);
  const which = target === null ? '' : `: ${shortTarget(target)}`;
  if (event.phase === 'requested') {
    return null;
  }
  if (event.phase === 'allowed') {
    return `→ ${doing}${which}`;
  }
  if (event.phase === 'done') {
    // A call that worked is confirmed without repeating the target; a call that
    // failed says which one failed.
    return event.ok === false ? `✗ ${doing}${which}` : `✓ ${doing}`;
  }
  const why =
    event.phase === 'refused' && event.reason ? ` (${event.reason})` : ` (${event.phase})`;
  return `✗ ${doing}${which}${why}`;
}

export async function executeTask(
  options: ExecuteOptions,
  sink: RunSink,
  controller: RunController = new RunController(),
): Promise<LoopResult> {
  const { config, env } = options;
  const getMode = options.getMode ?? (() => options.mode);
  const ref = options.model ?? config.model;
  const ids = config.connections.map((connection) => connection.id);
  const parts = parseModelRef(ref, ids);
  if (parts === null) {
    const hint = ref.includes(':')
      ? `Run 'plato auth login ${ref.split(':')[0] ?? ''}' to add that connection, or set "model" in the config.`
      : 'A model is "connection:model", for example "anthropic:claude-sonnet-4-5".';
    throw new HostError(`the model '${ref}' is not available. ${hint}`, options.model !== undefined);
  }
  const connection = config.connections.find((c) => c.id === parts.connectionId);
  if (connection === undefined) {
    throw new HostError(`no connection named '${parts.connectionId}'.`);
  }

  const key = await resolveKey(connection, { env });
  if (key === null && connectionNeedsKey(connection)) {
    throw new HostError(
      `no key for ${connection.id}. Run 'plato auth login ${connection.id}'.`,
    );
  }

  // Core cannot know a connection's limits; the discovered pool is the only
  // source (D49bf). A failed fetch is not a failed run.
  let advertised: { context?: number; maxOutput?: number } | undefined;
  try {
    const pool = await modelPool(connection, {
      env,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    const entry = pool.pool.find((model) => model.id === parts.model);
    if (entry !== undefined) {
      advertised = {
        ...(entry.maxContext === undefined ? {} : { context: entry.maxContext }),
        ...(entry.maxOutput === undefined ? {} : { maxOutput: entry.maxOutput }),
      };
    }
  } catch {
    // The run proceeds with unknown limits, which core answers with 128k.
  }

  const reasoning: ReasoningConfig | undefined =
    config.reasoning !== 'off' && modelSupportsReasoning(parts.model)
      ? { effort: config.reasoning }
      : undefined;

  const vault = createVault();
  try {
    await seedVault(options.root, vault);
  } catch {
    // A protected file that cannot be read is skipped, never fatal (D49bc).
  }

  const bus = new AgentBus();
  const writer = new TranscriptWriter(runsDir(options.root, env), {
    task: options.task,
    root: options.root,
  });
  writer.attach(bus);
  // The loop tells the user things too — a stopped background shell, a failed
  // compaction, a result in a `.gitignore` path. Those arrive as `notice`
  // events, and before this nothing in either CLI host was listening to them.
  bus.on((event) => {
    if (event.type === 'notice') {
      sink.notice(event.text);
    }
  });
  // D49cb: the loop mints the run id, so the mode record events wait for its
  // header rather than guessing an id of their own.
  let currentRunId = '';
  bus.on((event) => {
    if (event.type === 'run-started') {
      currentRunId = event.runId;
    }
  });
  const requestMode = sink.requestMode;

  const specs = observerSpecs(config.team, ref, platoHome(env));
  const { handles, skipped } = await createObservers(specs, {
    config,
    env,
    fetchImpl: options.fetchImpl,
    provider: options.observerProvider,
  });
  for (const skip of skipped) {
    sink.notice(`[${skip.name}] observer unavailable — ${skip.reason}`);
    sink.observer?.({ type: 'unavailable', name: skip.name, ref: skip.ref, reason: skip.reason });
  }
  for (const handle of handles) {
    sink.notice(`[${handle.name}] watching — ${handle.ref}`);
  }
  watchObservers(
    handles,
    { bus, controller, task: options.task },
    {
      event: (event) => sink.observer?.(event),
      notice: (text) => sink.notice(text),
    },
  );

  const attached = await imageMentions(options.task, options.root);
  for (const skip of attached.rejected) {
    sink.notice(`Image @${skip.path} not attached — ${skip.reason}`);
  }
  const mcp = await startMcpServers(env, options.mode, (text) => sink.notice(text));

  let result: LoopResult;
  try {
    result = await runAgentLoop({
      root: options.root,
      task: options.task,
      // The worker is told which watchers actually started, so its account of
      // the team matches the one the user sees.
      team: { mode: config.team, watchers: handles.map((handle) => handle.name) },
      ...(attached.images.length === 0 ? {} : { images: attached.images }),
      getMode,
      approve: (request) => sink.approve(request),
      provider:
        options.provider ??
        createProvider(connection.kind, {
          apiKey: key?.key ?? '',
          baseUrl: connection.baseUrl,
          fetchImpl: options.fetchImpl,
        }),
      model: ref,
      ...(advertised === undefined ? {} : { advertised }),
      ...(reasoning === undefined ? {} : { reasoning }),
      bus,
      controller,
      onText: (text) => sink.textCommitted(text),
      onTextDelta: (textSoFar) => sink.textDelta(textSoFar),
      onToolEvent: (event) => sink.tool(event),
      askUser: (request) => sink.askUser(request),
      onStuckAsk: (request) => sink.stuck(request),
      respectGitignore: config.respectGitignore,
      revealProtected: (rel) => sink.reveal(rel),
      secretVault: vault,
      undoStore: { dir: undoDir(options.root, env) },
      globalConfigDir: platoHome(env),
      cache: true,
      compact: { mode: 'auto', threshold: config.compactionThreshold },
      ...(mcp.servers.length === 0 ? {} : { mcpServers: mcp.servers }),
      ...(options.history === undefined ? {} : { history: options.history }),
      // D49cq: the registry and the delivery live in the CLI's live session;
      // a host without one keeps both tools off.
      ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      // Passing this is what offers `request_mode` to the model and adds the
      // prompt paragraph; a host without it keeps the prose fallback (D49cb).
      ...(requestMode === undefined
        ? {}
        : {
            requestMode: async (request: { mode: Mode; reason: string }) => {
              const current = getMode();
              const result = await requestMode({ ...request, current });
              if (currentRunId !== '') {
                bus.emit({
                  type: 'mode-requested',
                  runId: currentRunId,
                  from: current,
                  to: request.mode,
                  approved: result.ok,
                });
                if (result.ok) {
                  bus.emit({
                    type: 'mode-changed',
                    runId: currentRunId,
                    from: current,
                    to: request.mode,
                    at: new Date().toISOString(),
                    via: 'request',
                  });
                }
              }
              return result;
            },
          }),
    });
  } finally {
    mcp.stop();
    writer.close();
  }

  const observerLine = observerSummary(handles);
  if (observerLine !== undefined) {
    sink.observer?.({ type: 'done', text: observerLine });
  }
  return result;
}

export interface RunIo extends Streams {
  input: CliInput;
  /** Present only when the input is a terminal. */
  prompter?: Prompter;
}

export interface TaskOptions extends ExecuteOptions {
  outputFormat: OutputFormat;
  io: RunIo;
  /** The conversation this run belongs to, saved after it ends. */
  session?: StoredSession;
}

const NO_USER =
  'The user is not available to answer. Continue with your best judgment, or stop and explain what you need.';

export function createStreamSink(io: RunIo, format: OutputFormat): RunSink {
  const wantsText = format === 'text';
  let shown = '';
  let notedNoTerminal = false;
  let notedPromptClosed = false;

  const noteNoTerminal = (): void => {
    if (!notedNoTerminal) {
      notedNoTerminal = true;
      io.err(
        'No terminal to ask for approval; the call was refused. ' +
          'Run with --mode auto to allow tool calls unattended.\n',
      );
    }
  };

  // A prompt that cannot be read — a closed stdin, a terminal that went away —
  // is an answer nobody gave, so the caller fails closed on null.
  const ask = async (prompt: string): Promise<string | null> => {
    if (io.prompter === undefined) {
      return null;
    }
    try {
      return await io.prompter.ask(prompt);
    } catch {
      if (!notedPromptClosed) {
        notedPromptClosed = true;
        io.err('The input closed before an answer came; the run treats that as No.\n');
      }
      return null;
    }
  };

  return {
    textDelta(soFar) {
      if (format === 'stream-json') {
        if (!soFar.startsWith(shown)) {
          shown = '';
        }
        if (soFar.length > shown.length) {
          io.out(`${JSON.stringify({ type: 'text.delta', text: soFar.slice(shown.length) })}\n`);
          shown = soFar;
        }
        return;
      }
      if (!wantsText) {
        return;
      }
      if (!soFar.startsWith(shown)) {
        if (shown.length > 0) {
          io.out('\n');
        }
        shown = '';
      }
      if (soFar.length > shown.length) {
        io.out(soFar.slice(shown.length));
        shown = soFar;
      }
    },
    textCommitted(text) {
      if (wantsText) {
        if (text.length > shown.length && text.startsWith(shown)) {
          io.out(text.slice(shown.length));
        } else if (shown.length === 0 && text.length > 0) {
          io.out(text);
        }
        io.out('\n');
        shown = '';
        return;
      }
      if (format === 'stream-json' && text.length > 0) {
        io.out(`${JSON.stringify({ type: 'text', text })}\n`);
      }
    },
    tool(event) {
      if (format === 'stream-json') {
        io.out(
          `${JSON.stringify({
            type: 'tool',
            tool: event.tool,
            phase: event.phase,
            ...(event.ok === undefined ? {} : { ok: event.ok }),
            ...(event.reason === undefined ? {} : { reason: event.reason }),
          })}\n`,
        );
        return;
      }
      const line = toolLine(event);
      if (line !== null) {
        io.err(`${line}\n`);
      }
    },
    async approve(request) {
      if (request.preview !== undefined && request.preview.length > 0) {
        io.err(`\n${request.preview}\n`);
      }
      if (io.prompter === undefined) {
        noteNoTerminal();
        return false;
      }
      const answer = await ask(`Allow ${request.tool}? [y/N] `);
      return answer !== null && /^(y|yes)$/i.test(answer.trim());
    },
    async askUser(request) {
      if (io.prompter === undefined) {
        return request.questions.map(() => NO_USER);
      }
      const answers: string[] = [];
      for (const question of request.questions) {
        io.err(
          `\n${question.header !== undefined ? `${question.header}: ` : ''}${question.question}\n`,
        );
        if (question.context !== undefined) {
          io.err(`${question.context}\n`);
        }
        question.options.forEach((option, index) => {
          const marker = option === question.recommended ? ' (recommended)' : '';
          io.err(`  ${index + 1}. ${option}${marker}\n`);
        });
        const prompt =
          question.multiple === true
            ? 'Choose one or more by number, comma-separated, or type an answer: '
            : question.options.length > 0
              ? 'Choose a number, or type an answer: '
              : 'Answer: ';
        const read = await ask(prompt);
        if (read === null) {
          answers.push(NO_USER);
          continue;
        }
        const raw = read.trim();
        if (question.multiple === true) {
          const picks = raw
            .split(',')
            .map((part) => Number.parseInt(part.trim(), 10))
            .filter(
              (pick) => Number.isInteger(pick) && pick >= 1 && pick <= question.options.length,
            );
          answers.push(
            picks.length > 0
              ? picks.map((pick) => question.options[pick - 1] ?? '').join('; ')
              : raw,
          );
        } else {
          const pick = Number.parseInt(raw, 10);
          answers.push(
            Number.isInteger(pick) && pick >= 1 && pick <= question.options.length
              ? (question.options[pick - 1] ?? '')
              : raw.length > 0
                ? raw
                : (question.recommended ?? ''),
          );
        }
      }
      return answers;
    },
    async stuck(request) {
      const what =
        request.kind === 'repeat'
          ? `${request.call ?? 'the same call'} repeated ${request.count} times`
          : `no progress for ${request.count} turns`;
      io.err(`\nPlato looks stuck: ${what}.\n`);
      if (io.prompter === undefined) {
        io.err('Stopping the run because there is no terminal to ask.\n');
        return { action: 'stop' };
      }
      const answer = await ask('Continue with guidance, or stop? [c/s] ');
      if (answer === null || /^s/i.test(answer.trim())) {
        return { action: 'stop' };
      }
      const guidance = (await ask('Guidance (optional): '))?.trim() ?? '';
      return guidance.length > 0 ? { action: 'continue', guidance } : { action: 'continue' };
    },
    async reveal(rel) {
      const answer = await ask(
        `Show ${rel} with its secret values replaced by placeholders? [y/N] `,
      );
      return answer !== null && /^(y|yes)$/i.test(answer.trim());
    },
    notice(text) {
      io.err(`${text}\n`);
    },
    observer(event) {
      if (event.type === 'done') {
        io.err(`${event.text}\n`);
      }
    },
  };
}

export async function runTask(options: TaskOptions): Promise<number> {
  const { io } = options;
  const controller = new RunController();
  let interrupts = 0;
  const onSigint = (): void => {
    interrupts += 1;
    if (interrupts === 1) {
      io.err('\nCancelling at the next safe point. Press Ctrl+C again to exit.\n');
      controller.cancel();
    } else {
      process.exit(130);
    }
  };
  process.on('SIGINT', onSigint);

  if (options.outputFormat === 'stream-json') {
    io.out(
      `${JSON.stringify({
        type: 'start',
        model: options.model ?? options.config.model,
        mode: options.mode,
      })}\n`,
    );
  }

  let result: LoopResult;
  try {
    result = await executeTask(options, createStreamSink(io, options.outputFormat), controller);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`plato: ${message}\n`);
    if (options.outputFormat !== 'text') {
      io.out(`${JSON.stringify({ type: 'error', message })}\n`);
    }
    return error instanceof HostError && error.usage ? 2 : 1;
  } finally {
    process.off('SIGINT', onSigint);
  }

  if (options.session !== undefined) {
    options.session.history.push(
      { role: 'user', text: options.task },
      { role: 'assistant', text: result.finalText },
    );
    options.session.model = options.model ?? options.config.model;
    options.session.mode = options.mode;
    options.session.team = options.config.team;
    try {
      saveSession(options.root, options.env, options.session);
    } catch (error) {
      io.err(`plato: could not save the session: ${(error as Error).message}\n`);
    }
  }

  if (options.outputFormat === 'text') {
    if (result.reason !== 'complete') {
      io.err(`Run ended: ${reasonText(result.reason)}.\n`);
      if (result.stuckNote !== undefined) {
        io.err(`${result.stuckNote}\n`);
      }
    }
    io.err(`${summary(result)}\n`);
  } else {
    io.out(
      `${JSON.stringify({
        type: 'result',
        model: options.model ?? options.config.model,
        mode: options.mode,
        reason: result.reason,
        finalText: result.finalText,
        turns: result.turns,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        cacheReadTokens: result.cacheReadTokens,
        ...(result.truncated === true ? { truncated: true } : {}),
        ...(result.stuckNote === undefined ? {} : { stuckNote: result.stuckNote }),
      })}\n`,
    );
  }

  return result.reason === 'complete' ? 0 : 1;
}
