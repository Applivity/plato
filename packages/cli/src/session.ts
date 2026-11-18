import {
  IdleFold,
  RunController,
  createProvider,
  digestToolCall,
  estimateTokens,
  historyTokens,
  inboundTask,
  parseModelRef,
  planFold,
  recentWorkBlock,
  shouldAutoCompact,
  toolLine as logToolLine,
  toolWords,
  type ApprovalRequest,
  type ChatProvider,
  type Mode,
  type OutsidePathCard,
  type StuckRequest,
} from '@applivity/plato-core';
import {
  chatRowsFromHistory,
  foldConversation,
  historyFromRows,
  requestHistory,
  resolveContextWindowInfo,
  type ChatRow,
  type ContextWindowInfo,
  type FoldCause,
} from './compaction.js';
import { COMMANDS, slashText } from './completion.js';
import { loadConfig, saveConfig, type ConnectionConfig, type PlatoConfig, type Team } from './config.js';
import { HostError } from './errors.js';
import { connectionNeedsKey, resolveKey } from './keys.js';
import { applyUndo, planUndo } from '@applivity/plato-core';
import {
  createSession,
  listSessions,
  loadSession,
  saveSession as persistSession,
  titleFor,
  type StoredSession,
} from './sessions.js';
import { relativeTime } from './history.js';
import { compactTokens } from './format/terminal.js';
import { connectionModels, modelRefs } from './modelList.js';
import type {
  InboundMessage,
  LiveSession,
  ReceiveResult,
  RunOrigin,
  RunOriginPeer,
  SessionDescription,
} from '@applivity/plato-core';
import {
  executeTask,
  undoDir,
  reasonText,
  summary,
  toolLine,
  toolTarget,
  type AskQuestion,
  type AskRequest,
  type ExecuteOptions,
  type RunSink,
} from './host.js';
import type { ObserverEvent, ObserverSpec } from './team.js';
import type { Env } from './paths.js';

/**
 * The interactive session: the pure view state the terminal renders, plus the
 * card promises the run awaits. It holds no React and no terminal I/O, so the
 * whole card and command path is testable without a TTY (D49bw principle 5).
 */
export interface SessionOptions {
  root: string;
  config: PlatoConfig;
  env: Env;
  mode?: Mode;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: number;
  provider?: ChatProvider;
  observerProvider?: (spec: ObserverSpec) => ChatProvider | null;
  /** A saved conversation to resume. */
  stored?: StoredSession;
  /**
   * The context window to plan a fold against. Absent, the connection's
   * advertised value is used, and 128k when it advertises nothing. Injected by
   * the fold tests so a small conversation can cross a real threshold.
   */
  maxContext?: number;
  /** Called when a queued `/exit` runs; the terminal owns leaving. */
  onExit?: () => void;
  /** Injected by the idle-fold tests; production uses an hour and 200k tokens. */
  idle?: {
    afterMs?: number;
    minTokens?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
  };
}

export type RowKind = 'user' | 'assistant' | 'tool' | 'notice' | 'error' | 'inbound';

/**
 * What Ctrl+O shows for a tool row. Only facts the session has: the row's own
 * words, the full target (the one-line row shortens it), when it began, how
 * long it took, and how it ended. Tool output is never stored, so it is never
 * shown.
 */
export interface ToolDetail {
  tool: string;
  /** The tool's words, e.g. "running a command". */
  doing: string;
  /** The call's target, unabbreviated, when it named one. */
  target?: string;
  requestedAt?: number;
  startedAt?: number;
  endedAt?: number;
  /** running, done, failed, refused, or declined. */
  outcome: string;
  reason?: string;
  /** Rebuilt from the saved log: its timing was never stored. */
  fromLog?: boolean;
}

export interface Row {
  id: number;
  kind: RowKind;
  text: string;
  detail?: ToolDetail;
}

/** A saved conversation as the picker shows it: the name can be long, the id stays. */
export interface ResumeChoice {
  id: string;
  title: string;
  /** "3m ago · 12 turns · ~34k"; enough to tell two conversations apart. */
  meta: string;
}

export interface SessionStatus {
  model: string;
  mode: Mode;
  team: Team;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  /** What the run is doing now: the tool's own words. */
  activity?: string;
  /** When the run started, so the terminal can tick the elapsed seconds. */
  startedAt?: number;
  /** The history the next request carries, as estimated tokens. */
  contextTokens: number;
  /** The window the fold measures against; absent until it is resolved. */
  contextWindow?: number;
  /**
   * True when `contextWindow` is the fallback, not a number the connection or
   * the user supplied. The line shows it as `~131k`, never as a fact.
   */
  contextWindowApprox?: boolean;
  /** True when the next run would fold: the history is at the threshold. */
  contextDue?: boolean;
  /**
   * The current run's output and input tokens so far, from provider usage
   * events. The status line divides the output by the run's elapsed time for
   * a live rate, and adds both to the conversation's running totals.
   */
  runOutputTokens?: number;
  runInputTokens?: number;
  /** The last completed run's output tokens, for its kept rate. */
  lastRunOutputTokens?: number;
  /** The last completed run's wall time, for its kept duration. */
  lastRunMs?: number;
  /**
   * The cold-start step the run is waiting on — `checking the model…`,
   * `starting tools…` — and when it began. The terminal keeps a step quiet
   * until it has lasted a second.
   */
  waiting?: string;
  waitingSince?: number;
}

export interface ApprovalCard {
  kind: 'approval';
  tool: string;
  preview?: string;
  options: string[];
  selected: number;
}

export interface QuestionCard {
  kind: 'question';
  header?: string;
  question: string;
  context?: string;
  /** The model's choices. The row after these is "type your own answer". */
  options: string[];
  multiple: boolean;
  recommended?: string;
  selected: number;
  toggled: boolean[];
  freeText: boolean;
  text: string;
  index: number;
  total: number;
}

export interface StuckCard {
  kind: 'stuck';
  message: string;
  options: string[];
  selected: number;
}

export interface RevealCard {
  kind: 'reveal';
  protectedPath: string;
  options: string[];
  selected: number;
}

/** D49cb: the model asked for another mode, and only the user's yes changes it. */
export interface ModeCard {
  kind: 'mode';
  current: Mode;
  mode: Mode;
  reason: string;
  options: string[];
  selected: number;
}

/**
 * A path outside the project — read or write. Core supplies the three answers
 * and their hints; the session remembers the wider one in memory only.
 */
export interface OutsideCard {
  kind: 'outside';
  title: string;
  lines: string[];
  why: string;
  options: string[];
  selected: number;
}

/** `/resume`: this workspace's saved conversations, ready to switch to. */
export interface ResumeCard {
  kind: 'resume';
  title: string;
  /** The card machinery moves by `options`; each is a choice's title. */
  options: string[];
  selected: number;
  choices: ResumeChoice[];
}

export type Card =
  | ApprovalCard
  | QuestionCard
  | StuckCard
  | RevealCard
  | ModeCard
  | OutsideCard
  | ModelCard
  | ResumeCard;

/** The model picker: each choice is a `connection:model`, plus one way in. */
export interface ModelCard {
  kind: 'model';
  title: string;
  notes: string[];
  options: string[];
  selected: number;
}

export interface ObserverView {
  name: string;
  color: string;
  state: string;
  last?: string;
}

export interface ViewState {
  rows: Row[];
  streaming: string;
  card: Card | null;
  status: SessionStatus;
  observers: ObserverView[];
  running: boolean;
  /**
   * D49bm (terminal): `requested` is Esc heard and the pause asked for;
   * `parked` is the run actually waiting at a safe point. They are different
   * facts, and the hint line must not claim the second while only the first is
   * true — a tool already running cannot be stopped mid-write.
   */
  pause: 'none' | 'requested' | 'parked';
  /** The setup screen has the terminal until it finishes. */
  setup: boolean;
}

/** `/help`, built from the menu's table so the two can never disagree (D49cd). */
const HELP_WIDTH = Math.max(...COMMANDS.map((command) => slashText(command).length)) + 2;
const KEY_WIDTH = 10;
/**
 * Commands that may act while a run is live. A WHITELIST, not a blacklist: a
 * command added later is refused by default. The old queue-then-run path hid
 * this class of problem by deferring everything, which made `/undo` safe by
 * accident — it must not put files back while the run is writing them, and
 * `/resume` must not switch the conversation out from under the run.
 */
const RUN_SAFE_COMMANDS = new Set(['/help', '/queue', '/sessions', '/compact']);
export const SESSION_HELP = [
  'Commands',
  ...COMMANDS.map(
    (command) => `  ${slashText(command).padEnd(HELP_WIDTH)}${command.summary}`,
  ),
  '',
  'Keys',
  `  ${'Esc'.padEnd(KEY_WIDTH)}pause the run; press Esc again to stop it`,
  `  ${'Enter'.padEnd(KEY_WIDTH)}steer the run; /queue <text> waits for the next run`,
  `  ${'/continue'.padEnd(KEY_WIDTH)}resume a paused run; with text, send it and resume`,
  `  ${'Alt+Enter'.padEnd(KEY_WIDTH)}start a new line in the composer`,
  `  ${'Ctrl+C'.padEnd(KEY_WIDTH)}stop the run`,
  '',
  'A paused run does not survive Plato exiting.',
].join('\n');

function approvalKey(request: ApprovalRequest): string {
  if (request.host !== undefined) {
    return `${request.tool}:${request.host}`;
  }
  const path = request.args['path'];
  return typeof path === 'string' ? `${request.tool}:${path}` : request.tool;
}

/** How a tool call ended, in one word, from the event or the saved phase. */
function toolOutcome(phase: string | undefined, ok: boolean | undefined): string {
  if (phase === 'done') {
    return ok === false ? 'failed' : 'done';
  }
  if (phase === 'refused' || phase === 'declined') {
    return phase;
  }
  return phase ?? 'done';
}

/** A saved tool row's detail: what was recorded, and nothing that was not. */
function toolDetailFromLog(entry: ChatRow): ToolDetail {
  const tool = entry.tool ?? 'tool';
  return {
    tool,
    doing: toolWords(tool).doing,
    outcome: toolOutcome(entry.phase, entry.ok),
    fromLog: true,
  };
}

/** The view rows for a log, as both the constructor and `/resume` build them. */
function rowsFromLog(log: readonly ChatRow[]): Row[] {
  const rows: Row[] = [];
  for (const entry of log) {
    if (entry.k === 'msg' && entry.cls === 'you') {
      rows.push({ id: rows.length + 1, kind: 'user', text: entry.text ?? '' });
    } else if (entry.k === 'msg' && entry.cls === 'bot') {
      rows.push({ id: rows.length + 1, kind: 'assistant', text: entry.text ?? '' });
    } else if (entry.k === 'msg' && entry.cls === 'in') {
      rows.push({ id: rows.length + 1, kind: 'inbound', text: entry.text ?? '' });
    } else if (entry.k === 'tool') {
      rows.push({
        id: rows.length + 1,
        kind: 'tool',
        text: logToolLine(entry) ?? '',
        detail: toolDetailFromLog(entry),
      });
    }
  }
  return rows;
}

/** The line `/sessions` and `/resume` agree on: name, age, turns, size. */
function conversationFacts(stored: StoredSession, now = Date.now()): {
  title: string;
  meta: string;
} {
  const history =
    stored.history.length > 0 ? stored.history : historyFromRows(stored.log ?? []);
  const turns = history.filter((entry) => entry.role === 'user').length;
  const tokens = historyTokens(chatRowsFromHistory(history));
  const parts = [
    relativeTime(stored.updatedAt, now),
    `${turns} ${turns === 1 ? 'turn' : 'turns'}`,
    `~${compactTokens(tokens)}`,
  ].filter((part) => part.length > 0);
  return {
    title: stored.title || titleFor(history) || '(untitled)',
    meta: parts.join(' · '),
  };
}

export class Session {
  private config: PlatoConfig;
  private readonly base: SessionOptions;
  private state: ViewState;
  private readonly listeners = new Set<() => void>();
  private pending: ((value: unknown) => void) | null = null;
  private controller: RunController | null = null;
  /**
   * D49bm (terminal): the pause state the hint line reads. A pause request
   * holds the streamed text back so the screen stops advancing at once; the
   * held text lands when the run resumes or ends, never twice.
   */
  private pause: 'none' | 'requested' | 'parked' = 'none';
  private heldStreaming: string | null = null;
  /** The worker's model call is in flight; a pause waits for its answer type. */
  private modelCallInFlight = false;
  /** The paused response has tool calls; apply the pause after the card's gate. */
  private pauseAfterToolEvent = false;
  /** The last run ended on Stop, so `/continue` must not pretend to resume it. */
  private lastRunStopped = false;
  private readonly remembered = new Set<string>();
  private modeRequestsThisRun = 0;
  private nextRow = 1;
  /** D49cq: the shared transport, attached by the interactive host. */
  private live: LiveSession | undefined;
  /** How the host asks "is the user halfway through a prompt?". */
  private editorIsEmpty: (() => boolean) | undefined;
  /** Messages that arrived while a run, a card, or an edit was in the way. */
  private readonly pendingInbound: InboundMessage[] = [];
  /** Lines the user typed during a run; they run in order when it ends. */
  private readonly queuedLines: string[] = [];
  /** The task of the current (or last) run, for the registry summary. */
  private lastTask = '';
  /** The tool call in flight, so Ctrl+O can say when it started and how long it took. */
  private openTool: { tool: string; requestedAt: number; startedAt?: number } | null = null;

  mode: Mode;
  model: string;
  /**
   * The conversation as ROWS: messages, tool digests, and the summary a fold
   * wrote. The model's request and the saved session are both derived from it —
   * a fold changes what is sent, never what the user can read (D49aa).
   */
  log: ChatRow[];
  sessionId: string;
  private createdAt: string;
  /** One fold at a time; an idle clock and a run end must not race. */
  private folding = false;
  /** Resolved once per model; a fold and a request must agree on the window. */
  private window: Promise<ContextWindowInfo> | null = null;
  /** "Allow for this session" covers every outside path, read or write. */
  private outsideAllowed = false;
  /** "Stopping after this step." is said once per run, however often asked. */
  private stopNoticed = false;
  /** The pending approval was answered with Esc: deny, and stop the run. */
  private approvalStopped = false;
  /** Resolves when the setup screen finishes, so `/model add` can wait. */
  private setupResolve: ((result: { saved: boolean; model?: string }) => void) | null = null;
  /** The host's way to report how an ask was answered (D49aq). */
  private reportApprovalCard:
    | ((tool: string, via: 'shown' | 'session-memory' | 'session-approval') => void)
    | undefined;
  private readonly idleFold: IdleFold;

  /** The flat pairs the session store and the title read. */
  get history(): { role: 'user' | 'assistant'; text: string }[] {
    return historyFromRows(this.log);
  }

  /** The conversation's own name, as the session list and registry show it. */
  get title(): string {
    return titleFor(this.history);
  }

  /** The workspace the composer completes files from. */
  get root(): string {
    return this.base.root;
  }

  /** The search setting; `@` completion follows the same rule (R2-3). */
  get respectGitignore(): boolean {
    return this.config.respectGitignore;
  }

  constructor(options: SessionOptions) {
    this.base = options;
    const stored = options.stored;
    this.mode = options.mode ?? stored?.mode ?? options.config.mode;
    this.model = options.model ?? stored?.model ?? options.config.model;
    const team = stored?.team ?? options.config.team;
    this.config = {
      ...options.config,
      mode: this.mode,
      model: this.model,
      team,
    };
    this.log = stored?.log ?? chatRowsFromHistory(stored?.history ?? []);
    const fresh = createSession(this.model, this.mode, team);
    this.sessionId = stored?.id ?? fresh.id;
    this.createdAt = stored?.createdAt ?? fresh.createdAt;
    const rows = rowsFromLog(this.log);
    this.nextRow = rows.length + 1;
    this.state = {
      rows,
      streaming: '',
      card: null,
      status: {
        model: this.model,
        mode: this.mode,
        team,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        turns: 0,
        contextTokens: historyTokens(this.log),
      },
      observers: [],
      running: false,
      pause: 'none',
      setup: false,
    };
    this.idleFold = new IdleFold({
      enabled: () => this.config.compactionIdle === true,
      tokens: () => historyTokens(this.log),
      busy: () => this.state.running || this.state.card !== null || this.folding,
      fold: async () => {
        await this.foldNow('idle');
      },
      ...(options.idle?.afterMs === undefined ? {} : { afterMs: options.idle.afterMs }),
      ...(options.idle?.minTokens === undefined
        ? {}
        : { minTokens: options.idle.minTokens }),
      ...(options.idle?.setTimer === undefined ? {} : { setTimer: options.idle.setTimer }),
      ...(options.idle?.clearTimer === undefined
        ? {}
        : { clearTimer: options.idle.clearTimer }),
    });
    this.scheduleIdleFold();
    // The window is what the fold will use, so the status line reads the same
    // promise. A connection that cannot answer falls back to the fold default.
    void this.contextWindowInfo()
      .then((info) => {
        this.update({
          status: {
            ...this.state.status,
            contextWindow: info.window,
            contextWindowApprox: info.approximate,
          },
        });
        this.refreshUsage();
      })
      .catch(() => {
        // The fold has the same fallback; no number is worse than a wrong one.
      });
  }

  /** Stable identities, because `useSyncExternalStore` compares them. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ViewState => this.state;

  private update(partial: Partial<ViewState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** The status fields that depend on how full the conversation is. */
  private statusFor(tokens: number): SessionStatus {
    const window = this.state.status.contextWindow;
    const due =
      window !== undefined && shouldAutoCompact(tokens, window, this.config.compactionThreshold);
    return {
      ...this.state.status,
      contextTokens: tokens,
      ...(due ? { contextDue: true } : { contextDue: false }),
    };
  }

  /** Recomputes the share from the log and whatever is streaming now. */
  private refreshUsage(): void {
    const tokens =
      historyTokens(this.log) +
      (this.state.streaming.length === 0 ? 0 : estimateTokens(this.state.streaming));
    this.update({ status: this.statusFor(tokens) });
  }

  private append(kind: RowKind, text: string, detail?: ToolDetail): void {
    if (text.length === 0) {
      return;
    }
    this.update({
      rows: [
        ...this.state.rows,
        { id: this.nextRow, kind, text, ...(detail === undefined ? {} : { detail }) },
      ],
    });
    this.nextRow += 1;
  }

  addNotice(text: string): void {
    this.append('notice', text);
  }

  /**
   * The cold-start step in progress (R2-4). One phrase at a time; the TUI
   * renders it only after it has lasted a second, so a quick start says
   * nothing. Repeating the same step keeps its original clock.
   */
  private noteWait(text: string | undefined): void {
    if (!this.state.running) {
      return;
    }
    if (text === undefined) {
      if (this.state.status.waiting === undefined) {
        return;
      }
      this.update({
        status: {
          ...this.state.status,
          waiting: undefined,
          waitingSince: undefined,
        },
      });
      return;
    }
    if (this.state.status.waiting === text) {
      return;
    }
    this.update({
      status: { ...this.state.status, waiting: text, waitingSince: Date.now() },
    });
  }

  get connections(): ConnectionConfig[] {
    return this.config.connections;
  }

  /**
   * D49cq: the interactive host attaches the transport before the first run.
   * Absent (plain mode, `-p`, tests), both session tools stay off.
   */
  setLive(live: LiveSession): void {
    this.live = live;
  }

  /** D49cq: the TUI tells the session whether a prompt is half-written. */
  setEditorProbe(editorIsEmpty: () => boolean): void {
    this.editorIsEmpty = editorIsEmpty;
  }

  /** `/model add`: the App draws the setup screen until this resolves. */
  async startSetup(): Promise<void> {
    const result = await new Promise<{ saved: boolean; model?: string }>((resolve) => {
      this.setupResolve = resolve;
      this.update({ setup: true });
    });
    if (result.saved && result.model !== undefined) {
      this.append('notice', `Saved. Using ${result.model}.`);
    }
  }

  /** The setup screen is done: reload what it wrote and give the terminal back. */
  finishSetup(result: { saved: boolean; model?: string }): void {
    this.update({ setup: false });
    const resolve = this.setupResolve;
    this.setupResolve = null;
    if (result.saved) {
      this.reloadConfig();
    } else {
      this.append('notice', 'Setup cancelled; nothing changed.');
    }
    resolve?.(result);
  }

  /** After setup: the connections and the model on disk are the live ones. */
  reloadConfig(): void {
    const config = loadConfig(this.base.env);
    this.config = { ...config, mode: this.mode, team: this.config.team };
    if (config.model.length > 0 && config.model !== this.model) {
      this.model = config.model;
      this.window = null;
      this.update({
        status: { ...this.statusFor(historyTokens(this.log)), model: this.model },
      });
    }
  }

  /** The environment the setup screen reads and writes. */
  setupEnv(): Env {
    return this.base.env;
  }

  /** What the registry publishes about this session (D49cq). */
  describe(): SessionDescription {
    const title = titleFor(this.history);
    const task = this.lastTask.replace(/\s+/g, ' ').trim();
    const state = `${this.mode}${this.state.running ? ', busy' : ''}`;
    const summary = task.length === 0 ? `No task yet (${state})` : `${task} (${state})`;
    return {
      name: title.length === 0 ? 'Plato CLI' : title,
      summary: summary.length > 160 ? `${summary.slice(0, 157)}…` : summary,
      busy: this.state.running,
      cwd: this.base.root,
    };
  }

  /**
   * D49cq: one message from another session.
   *
   * It is delivered as a RUN whose task carries the provenance header, never as
   * the user's own words. If a run, a card, or a half-written prompt is in the
   * way, it queues: none of those may be displaced or swallowed.
   */
  async receive(message: InboundMessage): Promise<ReceiveResult> {
    const row = `↳ from ${message.from.name} [${message.from.id}]: ${message.text}`;
    const typing = this.editorIsEmpty !== undefined && !this.editorIsEmpty();
    if (this.state.running || this.state.card !== null || typing || this.pendingInbound.length > 0) {
      this.pendingInbound.push(message);
      this.append('notice', `${row} — queued`);
      return 'queued';
    }
    this.append('inbound', row);
    void this.submit(
      inboundTask(message),
      message.reply ? 'reply' : 'session',
      { id: message.from.id, name: message.from.name },
    );
    return 'started';
  }

  /**
   * A line typed while a run is in progress. It waits here, in the same order
   * it was typed, and the run end takes it through the path a typed line takes:
   * a command runs as a command, anything else becomes the next run. The
   * composer keeps whatever draft the user is writing; this queue never touches
   * it.
   */
  queueLine(text: string): void {
    const line = text.trim();
    if (line.length === 0) {
      return;
    }
    this.queuedLines.push(line);
    this.append('notice', `Queued: ${line}`);
    if (!this.state.running && this.state.card === null) {
      queueMicrotask(() => this.drainQueue());
    }
  }

  /**
   * One item at a time, and the user's own lines before peer messages. A
   * command returns at once and the next item goes; a sentence becomes a run,
   * and `submit`'s own end starts the drain again.
   */
  private drainQueue(): void {
    if (this.state.running || this.state.card !== null) {
      return;
    }
    const line = this.queuedLines.shift();
    if (line !== undefined) {
      void this.runQueued(line);
      return;
    }
    this.drainInbound();
  }

  private async runQueued(line: string): Promise<void> {
    if (line.startsWith('/') && !line.includes('\n')) {
      const outcome = await this.handleCommand(line);
      if (outcome === 'exit') {
        this.base.onExit?.();
        return;
      }
      queueMicrotask(() => this.drainQueue());
      return;
    }
    // The same path a typed line takes: the App's submit, without its editor.
    await this.submit(line);
  }

  /** Starts queued peer messages one run at a time, when nothing is in the way. */
  private drainInbound(): void {
    if (this.state.running || this.pendingInbound.length === 0) {
      return;
    }
    if (this.editorIsEmpty !== undefined && !this.editorIsEmpty()) {
      return;
    }
    const next = this.pendingInbound.shift();
    if (next === undefined) return;
    this.append(
      'inbound',
      `↳ from ${next.from.name} [${next.from.id}]: ${next.text}`,
    );
    void this.submit(
      inboundTask(next),
      next.reply ? 'reply' : 'session',
      { id: next.from.id, name: next.from.name },
    );
  }

  /**
   * D49cq (amended): `origin` is where the task came from. A `'session'` run may
   * send one reply back to `originFrom`; a `'reply'` run may not send at all.
   */
  async submit(
    task: string,
    origin: RunOrigin = 'user',
    originFrom?: RunOriginPeer,
  ): Promise<void> {
    if (this.state.running) {
      return;
    }
    // D49dl: a new message cancels a pending idle fold. The clock starts again
    // when this run ends.
    this.idleFold.cancel();
    // The log BEFORE this task: the request carries what was said and done up
    // to now, and the loop adds this task as its opening user turn.
    const before = this.log;
    // D49cq: an inbound run already has its `↳ from …` row. The provenance
    // wrapper is what the MODEL reads; printing it again as a user turn would
    // show the receiving user words they never typed.
    if (origin === 'user') {
      this.append('user', task);
      this.log.push({ k: 'msg', cls: 'you', text: task });
    }
    this.lastTask = task;
    this.stopNoticed = false;
    this.pause = 'none';
    this.heldStreaming = null;
    this.modelCallInFlight = false;
    this.pauseAfterToolEvent = false;
    this.lastRunStopped = false;
    this.update({
      running: true,
      streaming: '',
      pause: 'none',
      observers: [],
      status: {
        ...this.statusFor(historyTokens(this.log)),
        activity: undefined,
        startedAt: Date.now(),
        runOutputTokens: 0,
        runInputTokens: 0,
      },
    });
    this.live?.refresh();
    this.modeRequestsThisRun = 0;
    const controller = new RunController({
      // `onPark` is the loop's own account of the run, and the only one that
      // can say "parked" honestly: a request is not a park.
      onPark: (parked) => this.handlePark(parked),
    });
    this.controller = controller;

    // The first wait is the model list, asked for before the loop is built.
    this.noteWait('checking the model…');
    const maxContext = await this.contextWindow();
    const contextPlan = requestHistory(
      before,
      maxContext,
      this.config.compactionThreshold,
    );
    if (contextPlan.omitted > 0) {
      this.append(
        'notice',
        `${contextPlan.omitted} older messages were left out of this request to fit ` +
          "the model's context. The full conversation is still in the transcript.",
      );
    }
    // D49dn: after a summary, show the model the CURRENT state of the work the
    // summary can no longer show. Built fresh here; absent before a fold.
    const block = await recentWorkBlock(before, { root: this.base.root });
    if (block !== null) {
      contextPlan.turns.push({ role: 'user', text: block });
    }

    const options: ExecuteOptions = {
      root: this.base.root,
      task,
      mode: this.mode,
      // The loop reads this at every tool call, so a mode the user approves on
      // the card reaches the very next one in the SAME run (D49cb).
      getMode: () => this.mode,
      config: this.config,
      env: this.base.env,
      model: this.model,
      fetchImpl: this.base.fetchImpl,
      now: this.base.now,
      provider: this.base.provider,
      observerProvider: this.base.observerProvider,
      onModelCall: (phase, hasToolUse) => this.noteModelCall(phase, hasToolUse),
      ...(this.live === undefined
        ? {}
        : {
            sessions: {
              list: () => this.live!.list(),
              send: (to: string, text: string, sendOptions?: { reply?: boolean }) =>
                this.live!.send(to, text, sendOptions),
            },
          }),
      ...(origin === 'user' ? {} : { origin }),
      ...(originFrom === undefined ? {} : { originFrom }),
      ...(contextPlan.turns.length === 0 ? {} : { history: contextPlan.turns }),
    };

    try {
      const result = await executeTask(options, this.sink(), controller);
      // `/continue` reads this after the run: a stopped run is over, and saying
      // so is kinder than claiming a pause that no longer exists.
      this.lastRunStopped = result.reason === 'cancelled';
      this.log.push({ k: 'msg', cls: 'bot', text: result.finalText });
      this.update({
        status: {
          ...this.statusFor(historyTokens(this.log)),
          turns: this.state.status.turns + result.turns,
          inputTokens: this.state.status.inputTokens + result.inputTokens,
          outputTokens: this.state.status.outputTokens + result.outputTokens,
          costUsd: this.state.status.costUsd + result.costUsd,
        },
      });
      if (result.reason === 'cancelled' && this.state.streaming.length > 0) {
        // What had arrived stays on screen; the log keeps only the final
        // answer, so the next request cannot resend a half turn.
        this.append('assistant', this.state.streaming);
        this.append('notice', 'Stopped — the answer above is what had arrived.');
      }
      if (result.reason !== 'complete') {
        this.append('notice', `Run ended: ${reasonText(result.reason)}.`);
        if (result.stuckNote !== undefined) {
          this.append('notice', result.stuckNote);
        }
      }
      this.append('notice', summary(result));
      this.save();
    } catch (error) {
      const message = error instanceof HostError ? error.message : (error as Error).message;
      this.append('error', message);
    } finally {
      this.controller = null;
      // The pause is live process state only; when the run is over there is
      // nothing left to park or resume.
      this.pause = 'none';
      this.heldStreaming = null;
      this.modelCallInFlight = false;
      this.pauseAfterToolEvent = false;
      const startedAt = this.state.status.startedAt;
      const runMs = startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
      const runOutput = this.state.status.runOutputTokens;
      this.update({
        running: false,
        streaming: '',
        pause: 'none',
        status: {
          ...this.statusFor(historyTokens(this.log)),
          // The line keeps the finished run's rate and wall time when it is
          // idle: the at-a-glance copy of the run summary.
          ...(runMs === undefined ? {} : { lastRunMs: runMs }),
          ...(runOutput === undefined ? {} : { lastRunOutputTokens: runOutput }),
          runOutputTokens: 0,
          runInputTokens: 0,
          activity: undefined,
          startedAt: undefined,
          waiting: undefined,
          waitingSince: undefined,
        },
      });
      this.live?.refresh();
      // D44d amended: the size fold runs after the run, then the idle clock
      // starts. Both read the user's settings at fire time, so neither can run
      // against a conversation the user has changed.
      await this.afterRun();
      // After the run has fully settled: deliver anything that queued behind it.
      queueMicrotask(() => this.drainQueue());
    }
  }

  cancel(): void {
    // A card is a promise the loop is parked on. Esc answers it from the TUI,
    // but a cancel can arrive from anywhere, and the loop has nothing that can
    // interrupt the wait — so an unanswered card would outlive the cancel. The
    // safe answer is the default one: No for the approval, Stay for the mode.
    const card = this.state.card;
    if (card !== null) {
      this.settle(
        card.kind === 'question' ? '' : card.kind === 'outside' ? 2 : 0,
      );
    }
    // A stop that will wait for a long tool must say so at once, and only once.
    // A run parked at a gate has nothing left to finish, so it stops now.
    if (card === null && this.state.running && !this.stopNoticed && this.pause !== 'parked') {
      this.stopNoticed = true;
      this.append('notice', 'Stopping after this step.');
    }
    // Text held back by the pause has arrived; a stop must not also swallow it.
    this.flushHeld();
    this.pause = 'none';
    this.pauseAfterToolEvent = false;
    this.update({ pause: 'none' });
    this.controller?.cancel();
  }

  /**
   * Esc with no card and no menu in the way. The first press asks for a pause;
   * a press that finds a pause already asked for (or landed) stops the run,
   * which is what the hint line says it does. Ctrl+C always stops.
   */
  escapeDuringRun(): void {
    if (!this.state.running) {
      return;
    }
    if (this.pause !== 'none') {
      this.cancel();
      return;
    }
    this.requestPause();
  }

  /** Asks the loop to park at its next safe point. Never touches a card. */
  private requestPause(): void {
    if (!this.state.running || this.state.card !== null) {
      return;
    }
    this.pause = 'requested';
    this.update({ pause: 'requested' });
    // A model call in flight may be about to raise an approval card. Pausing
    // now would park at the between-tools gate, BEFORE that card, and hold back
    // the one thing the run is waiting on. The response tells us whether a card
    // is coming; a pause during a tool can land at once.
    if (!this.modelCallInFlight) {
      this.controller?.pause();
    }
  }

  /**
   * The model call's edges. A response with no tools is followed by the
   * final-answer gate, so the pause lands there. A response with tools is
   * followed by the between-tools gate and then the card; the pause waits for
   * the tool event, which core emits after that gate, so the card still opens
   * and the pause lands after it is answered.
   */
  private noteModelCall(phase: 'start' | 'end', hasToolUse?: boolean): void {
    if (phase === 'start') {
      this.modelCallInFlight = true;
      return;
    }
    this.modelCallInFlight = false;
    if (this.pause !== 'requested' || this.controller === null) {
      return;
    }
    if (hasToolUse === true) {
      this.pauseAfterToolEvent = true;
      return;
    }
    this.controller.pause();
  }

  /**
   * The loop's account of the run. `true` means it is really waiting; `false`
   * means it is running again (or never parked). A request is not a park.
   */
  private handlePark(parked: boolean): void {
    if (this.controller === null) {
      return;
    }
    this.pause = parked ? 'parked' : 'none';
    this.update({ pause: this.pause });
  }

  /**
   * Resumes a parked run. Only `/continue` reaches this; Enter never does.
   */
  private resumeRun(): void {
    if (!this.state.running || this.pause === 'none') {
      return;
    }
    this.controller?.resume();
    this.pause = 'none';
    this.pauseAfterToolEvent = false;
    this.update({ pause: 'none' });
    this.flushHeld();
  }

  /**
   * A line typed while a run is going: it steers THIS run, whether the run is
   * running or parked. The controller holds it until the loop's next safe point;
   * a parked run therefore keeps it until `/continue` resumes. It never starts a
   * run and never resumes one — `/queue <text>` defers, `/continue` resumes.
   */
  guide(text: string): void {
    const line = text.trim();
    if (!this.state.running || line.length === 0 || this.controller === null) {
      return;
    }
    this.controller.sendGuidance(line);
    this.append('user', line);
  }

  /**
   * `/continue` — the terminal's resume command, and never a way to start a
   * run. Bare, it resumes; with text it sends that text as guidance FIRST, so
   * the model reads it before it takes another step. Idle, it says what is
   * true: nothing is paused, or the last run was stopped and is over.
   */
  continueRun(text = ''): void {
    const line = text.trim();
    if (!this.state.running) {
      this.append(
        'notice',
        this.lastRunStopped
          ? 'The last run was stopped; there is nothing to continue.'
          : 'Nothing is paused.',
      );
      return;
    }
    // A requested pause that has not landed is still a pause the user can take
    // back, so `/continue` cancels it rather than saying it does not exist.
    if (this.pause === 'none') {
      this.append('notice', 'Nothing is paused.');
      return;
    }
    if (line.length > 0) {
      // Send first, then resume: the loop drains the note at the gate it wakes
      // from, so the model reads it before it takes another step.
      this.guide(line);
    }
    this.resumeRun();
  }

  /**
   * Puts the text that arrived while the screen was held back on screen. The
   * loop has already received it; this is the view catching up, once.
   */
  private flushHeld(): void {
    const held = this.heldStreaming;
    this.heldStreaming = null;
    if (held === null || held.length <= this.state.streaming.length) {
      return;
    }
    this.update({
      streaming: held,
      status: this.statusFor(historyTokens(this.log) + estimateTokens(held)),
    });
  }

  cycleMode(): void {
    const order: Mode[] = ['plan', 'edit', 'auto'];
    const at = order.indexOf(this.mode);
    this.setMode(order[(at + 1) % order.length] ?? 'edit');
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.config = { ...this.config, mode };
    this.update({ status: { ...this.state.status, mode } });
    this.live?.refresh();
    this.persist();
  }

  setModel(ref: string): boolean {
    if (parseModelRef(ref, this.config.connections.map((c) => c.id)) === null) {
      this.append('error', `'${ref}' is not connection:model for a configured connection.`);
      return false;
    }
    this.model = ref;
    this.config = { ...this.config, model: ref };
    // A different model may hold a different window, so the next fold re-reads
    // the connection's advertised value.
    this.window = null;
    this.update({ status: { ...this.state.status, model: ref } });
    this.persist();
    return true;
  }

  private persist(): void {
    try {
      saveConfig(this.config, this.base.env);
    } catch (error) {
      this.append('error', `Could not save the config: ${(error as Error).message}`);
    }
  }

  private save(): boolean {
    try {
      persistSession(this.base.root, this.base.env, {
        id: this.sessionId,
        title: '',
        createdAt: this.createdAt,
        updatedAt: new Date().toISOString(),
        model: this.model,
        mode: this.mode,
        team: this.config.team,
        history: this.history,
        log: this.log,
      });
      return true;
    } catch (error) {
      this.append('error', `Could not save the session: ${(error as Error).message}`);
      return false;
    }
  }

  /** The window a fold and a request plan against; resolved once per model. */
  private contextWindow(): Promise<number> {
    return this.contextWindowInfo().then((info) => info.window);
  }

  /** The same number, with whether the endpoint actually supplied it. */
  private contextWindowInfo(): Promise<ContextWindowInfo> {
    if (this.base.maxContext !== undefined) {
      return Promise.resolve({ window: this.base.maxContext, approximate: false });
    }
    if (this.window === null) {
      this.window = this.resolveWindow();
    }
    return this.window;
  }

  private async resolveWindow(): Promise<ContextWindowInfo> {
    return await resolveContextWindowInfo({
      config: this.config,
      model: this.model,
      env: this.base.env,
      ...(this.base.fetchImpl === undefined ? {} : { fetchImpl: this.base.fetchImpl }),
      ...(this.base.now === undefined ? {} : { now: this.base.now }),
    });
  }

  /** The provider a fold calls, through the same connection the run uses. */
  private async foldProvider(): Promise<ChatProvider | null> {
    if (this.base.provider !== undefined) {
      return this.base.provider;
    }
    const parts = parseModelRef(
      this.model,
      this.config.connections.map((connection) => connection.id),
    );
    if (parts === null) return null;
    const connection = this.config.connections.find(
      (entry) => entry.id === parts.connectionId,
    );
    if (connection === undefined) return null;
    const resolved = await resolveKey(connection, { env: this.base.env });
    if (resolved === null && connectionNeedsKey(connection)) {
      this.append(
        'notice',
        `No key for ${connection.id}; the conversation cannot be compacted.`,
      );
      return null;
    }
    return createProvider(connection.kind, {
      apiKey: resolved?.key ?? '',
      ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
      ...(this.base.fetchImpl === undefined ? {} : { fetchImpl: this.base.fetchImpl }),
    });
  }

  /** After every run: fold at the user's threshold, then start the idle clock. */
  private async afterRun(): Promise<void> {
    try {
      await this.foldNow('auto');
    } catch {
      // A fold is never a reason for a completed run to look failed. The next
      // run end tries again.
    }
    this.scheduleIdleFold();
  }

  private scheduleIdleFold(): void {
    if (!this.config.compactionIdle) {
      this.idleFold.cancel();
      return;
    }
    this.idleFold.schedule();
  }

  /**
   * One fold. `manual` is `/compact` while idle, `idle` is the setting, `auto`
   * is the size threshold. The rows stay; the notice names the cause.
   */
  private async foldNow(cause: FoldCause, focus = ''): Promise<void> {
    if (this.folding || this.state.running) return;
    const maxContext = await this.contextWindow();
    const threshold = this.config.compactionThreshold;
    // The automatic trigger is the only one gated by size; checking it here
    // avoids building a provider for a conversation nowhere near the line.
    if (
      cause === 'auto' &&
      planFold(this.log, { maxContext, threshold, manual: false }) === null
    ) {
      return;
    }
    const provider = await this.foldProvider();
    if (provider === null) return;
    this.folding = true;
    try {
      const outcome = await foldConversation({
        rows: this.log,
        provider,
        model: this.model,
        maxContext,
        threshold,
        cause,
        ...(focus.length === 0 ? {} : { focus }),
      });
      this.log = outcome.rows;
      this.update({ status: this.statusFor(historyTokens(this.log)) });
      if (outcome.folded) {
        if (outcome.notice !== null) this.append('notice', outcome.notice);
        this.save();
        return;
      }
      if (outcome.notice !== null) {
        this.append('notice', outcome.notice);
      } else if (cause === 'manual') {
        this.append(
          'notice',
          `Conversation is at ${outcome.share}% of this model's context — ` +
            'nothing to compact yet.',
        );
      }
    } catch {
      // A failed fold leaves the log untouched. The user asked for one only
      // when they typed `/compact`, so only then is there something to say.
      if (cause === 'manual') {
        this.append('notice', 'Compaction failed — try again in a moment.');
      }
    } finally {
      this.folding = false;
    }
  }

  /** True when an outside folder was allowed in this session. */
  private async askOutsidePath(
    card: OutsidePathCard,
  ): Promise<'once' | 'session' | 'deny'> {
    if (this.outsideAllowed) {
      this.append('notice', 'Plato did not ask — you allowed outside paths for this session.');
      return 'session';
    }
    // Core owns the labels and the hints; the number is the host's own key.
    const options = card.answers.map(
      (answer, index) => `${index + 1}. ${answer.label} — ${answer.hint}`,
    );
    const choice = await this.present<number>({
      kind: 'outside',
      title: card.title,
      lines: card.lines,
      why: card.why,
      options,
      // Deny is the default: an unanswered card, Enter or Esc must not widen
      // what can be read or written.
      selected: 2,
    });
    const answer = card.answers[choice] ?? card.answers[2];
    if (answer?.choice === 'session') {
      this.outsideAllowed = true;
    }
    return answer?.choice ?? 'deny';
  }

  /**
   * `/resume`: choose this workspace's saved conversation. Esc changes
   * nothing. A switch saves the current conversation first, then loads the
   * chosen one — no model request is made.
   */
  private async pickSession(): Promise<void> {
    const saved = listSessions(this.base.root, this.base.env);
    if (saved.length === 0) {
      this.append('notice', 'No saved conversations to resume.');
      return;
    }
    const now = Date.now();
    const choices: ResumeChoice[] = saved.map((stored) => {
      const facts = conversationFacts(stored, now);
      return {
        id: stored.id,
        title: `${facts.title}${stored.id === this.sessionId ? ' (now)' : ''}`,
        meta: facts.meta,
      };
    });
    const index = await this.present<number>({
      kind: 'resume',
      title: 'Saved conversations',
      options: choices.map((choice) => choice.title),
      selected: 0,
      choices,
    });
    if (index < 0) {
      return;
    }
    const chosen = saved[index];
    if (chosen === undefined) {
      return;
    }
    if (chosen.id === this.sessionId) {
      this.append('notice', 'That is this conversation.');
      return;
    }
    // The current conversation is saved before anything is replaced. If it
    // cannot be saved, the switch does not happen.
    if (!this.save()) {
      return;
    }
    const loaded = loadSession(this.base.root, this.base.env, chosen.id);
    if (loaded === null) {
      this.append(
        'error',
        'Could not load that conversation — the file is missing or unreadable. This one is unchanged.',
      );
      return;
    }
    this.applyStored(loaded);
  }

  /** A window the config already knows, without asking the connection. */
  private configuredWindow(model: string): number | undefined {
    const parts = parseModelRef(
      model,
      this.config.connections.map((connection) => connection.id),
    );
    if (parts === null) {
      return undefined;
    }
    return this.config.connections.find(
      (connection) => connection.id === parts.connectionId,
    )?.contextWindow;
  }

  /**
   * Replace this view with a saved conversation: its rows, title, model, mode
   * and team. Its window is kept only when this session already knows that
   * model's window, or the config supplies one — a switch must not make a
   * request.
   */
  private applyStored(stored: StoredSession): void {
    const model = stored.model.length > 0 ? stored.model : this.model;
    const sameModel = model === this.model;
    const knownWindow = sameModel
      ? this.state.status.contextWindow
      : this.configuredWindow(model);
    const knownApprox = sameModel ? this.state.status.contextWindowApprox : false;

    this.log = stored.log ?? chatRowsFromHistory(stored.history);
    // Fresh ids, never reused: `<Static>` writes an item once and remembers
    // its key, so a loaded conversation must not borrow the ids of the rows
    // already on screen or it would never be drawn.
    const rows = rowsFromLog(this.log).map((row) => ({
      ...row,
      id: this.nextRow++,
    }));
    this.sessionId = stored.id;
    this.createdAt = stored.createdAt;
    this.model = model;
    this.mode = stored.mode;
    this.config = {
      ...this.config,
      model,
      mode: stored.mode,
      team: stored.team,
    };
    this.window = sameModel ? this.window : null;
    this.openTool = null;
    this.outsideAllowed = false;
    this.modeRequestsThisRun = 0;
    const tokens = historyTokens(this.log);
    this.update({
      rows,
      streaming: '',
      card: null,
      observers: [],
      status: {
        model,
        mode: stored.mode,
        team: stored.team,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        turns: 0,
        contextTokens: tokens,
        ...(knownWindow === undefined
          ? {}
          : {
              contextWindow: knownWindow,
              contextWindowApprox: knownApprox === true,
              ...(shouldAutoCompact(
                tokens,
                knownWindow,
                this.config.compactionThreshold,
              )
                ? { contextDue: true }
                : {}),
            }),
      },
    });
    this.idleFold.cancel();
    this.scheduleIdleFold();
    this.live?.refresh();
    // The rows above belong to the conversation just left; this line marks
    // where the loaded one begins.
    const title = this.title.length > 0 ? this.title : '(untitled)';
    this.append('notice', `Resumed “${title}”.`);
  }

  async handleCommand(line: string): Promise<'exit' | 'handled'> {
    const trimmed = line.trim();
    const [name = '', ...rest] = trimmed.split(/\s+/);
    const argument = rest.join(' ');
    // A command typed while the run is live may only act if it is on the safe
    // list. `/continue` is the resume command and is meaningful only when a
    // pause is in effect; with no pause it would change a run that is going.
    if (this.state.running) {
      const allowed =
        RUN_SAFE_COMMANDS.has(name) || (name === '/continue' && this.pause !== 'none');
      if (!allowed) {
        this.append('notice', 'Finish or stop the run first.');
        return 'handled';
      }
    }
    switch (name) {
      case '/help':
        this.append('notice', SESSION_HELP);
        return 'handled';
      case '/exit':
      case '/quit':
        return 'exit';
      case '/continue':
        this.continueRun(argument);
        return 'handled';
      case '/queue': {
        if (argument.trim().length === 0) {
          this.append('notice', 'Nothing queued; write /queue <text>.');
          return 'handled';
        }
        this.queueLine(argument);
        return 'handled';
      }
      case '/mode': {
        if (argument !== 'plan' && argument !== 'edit' && argument !== 'auto') {
          this.append('error', 'Usage: /mode plan|edit|auto');
          return 'handled';
        }
        this.setMode(argument);
        this.append('notice', `Mode: ${argument}.`);
        return 'handled';
      }
      case '/model': {
        if (argument === 'add') {
          await this.addProviderFromSession();
          return 'handled';
        }
        if (argument.length === 0) {
          await this.pickModel();
          return 'handled';
        }
        if (this.setModel(argument)) {
          this.append('notice', `Model: ${argument}.`);
        }
        return 'handled';
      }
      case '/team': {
        if (argument !== 'solo' && argument !== 'duo' && argument !== 'academy') {
          this.append('error', 'Usage: /team solo|duo|academy');
          return 'handled';
        }
        this.config = { ...this.config, team: argument };
        this.update({ status: { ...this.state.status, team: argument } });
        this.persist();
        this.append('notice', `Team: ${argument}.`);
        return 'handled';
      }
      case '/gitignore': {
        const value = argument.toLowerCase();
        if (value !== 'on' && value !== 'off' && value !== 'true' && value !== 'false') {
          this.append('error', 'Usage: /gitignore on|off');
          return 'handled';
        }
        const respectGitignore = value === 'on' || value === 'true';
        this.config = { ...this.config, respectGitignore };
        this.persist();
        this.append(
          'notice',
          respectGitignore
            ? 'Search now skips .gitignore paths.'
            : 'Search now includes .gitignore paths and marks them.',
        );
        return 'handled';
      }
      case '/compact':
        if (this.controller === null) {
          // Idle: a real cross-run fold, the same one the desktop chat makes.
          await this.foldNow('manual', argument);
        } else {
          // Mid-run: the run's own compaction at its next safe point.
          this.controller.requestCompact();
          this.append('notice', 'Compaction requested.');
        }
        return 'handled';
      case '/new': {
        this.log = [];
        this.update({ status: this.statusFor(0) });
        this.idleFold.cancel();
        // A new conversation asks about outside paths again.
        this.outsideAllowed = false;
        const fresh = createSession(this.model, this.mode, this.config.team);
        this.sessionId = fresh.id;
        this.createdAt = fresh.createdAt;
        this.update({ rows: [], streaming: '', card: null });
        this.append('notice', 'New conversation.');
        this.save();
        return 'handled';
      }
      case '/undo': {
        const dir = undoDir(this.base.root, this.base.env);
        const plan = planUndo(dir, this.base.root, 'request');
        if (plan === null) {
          this.append('notice', 'Nothing to undo.');
          return 'handled';
        }
        const result = applyUndo(dir, this.base.root, plan);
        const parts: string[] = [];
        if (result.applied.length > 0) {
          parts.push(
            `${result.applied.length} ${result.applied.length === 1 ? 'file' : 'files'} put back`,
          );
        }
        if (plan.refuse.length > 0) {
          parts.push(
            `${plan.refuse.length} ${plan.refuse.length === 1 ? 'file' : 'files'} refused`,
          );
        }
        if (result.failed.length > 0) {
          parts.push(
            `${result.failed.length} ${result.failed.length === 1 ? 'file' : 'files'} failed`,
          );
        }
        this.append('notice', parts.length > 0 ? `Undo: ${parts.join(', ')}.` : 'Nothing to undo.');
        return 'handled';
      }
      case '/resume':
        await this.pickSession();
        return 'handled';
      case '/sessions': {
        const saved = listSessions(this.base.root, this.base.env);
        if (saved.length === 0) {
          this.append('notice', 'No saved conversations.');
        } else {
          const now = Date.now();
          const lines = saved.slice(0, 10).map((stored) => {
            const facts = conversationFacts(stored, now);
            return `${stored.id}  ${facts.title} · ${facts.meta}`;
          });
          // `/resume` draws this same list; saying so keeps the two from
          // looking like different behaviours.
          this.append(
            'notice',
            ['Saved conversations — /resume opens this same list:', ...lines].join('\n'),
          );
        }
        return 'handled';
      }
      default:
        this.append('error', `Unknown command ${name}. Try /help.`);
        return 'handled';
    }
  }

  private sink(): RunSink {
    return {
      textDelta: (soFar) => {
        // A pause holds the screen where the user stopped it. The text keeps
        // arriving in the background and lands once, on resume or on stop —
        // this is a pause of the run's surface, not a claim about the socket.
        if (this.pause !== 'none') {
          this.heldStreaming = soFar;
          return;
        }
        this.update({
          streaming: soFar,
          status: this.statusFor(historyTokens(this.log) + estimateTokens(soFar)),
        });
      },
      textCommitted: (text) => {
        this.heldStreaming = null;
        this.append('assistant', text);
        this.update({
          streaming: '',
          status: this.statusFor(historyTokens(this.log) + estimateTokens(text)),
        });
      },
      usage: (used) => {
        this.update({
          status: {
            ...this.state.status,
            runOutputTokens: (this.state.status.runOutputTokens ?? 0) + used.outputTokens,
            runInputTokens: (this.state.status.runInputTokens ?? 0) + used.inputTokens,
          },
        });
      },
      tool: (event) => {
        // A pause that was held for a possible approval card lands here: the
        // loop has already passed the gate for this call, so the card (if any)
        // opens first and the pause parks at the next boundary.
        if (this.pauseAfterToolEvent) {
          this.pauseAfterToolEvent = false;
          this.controller?.pause();
        }
        const now = Date.now();
        if (event.phase === 'requested') {
          // The clock starts when the loop asks; execution may begin later,
          // after an approval card, and `allowed` resets it then.
          this.openTool = { tool: event.tool, requestedAt: now };
          return;
        }
        const open = this.openTool?.tool === event.tool ? this.openTool : null;
        // The status line names what the run is doing, in the tool's words.
        if (event.phase === 'allowed') {
          if (open !== null) {
            open.startedAt = now;
          } else {
            this.openTool = { tool: event.tool, requestedAt: now, startedAt: now };
          }
          this.update({
            status: { ...this.state.status, activity: toolWords(event.tool).doing },
          });
        } else if (this.state.status.activity !== undefined) {
          this.update({ status: { ...this.state.status, activity: undefined } });
        }
        // D49ag: the log records what the call was FOR, never its result. The
        // digest is the argument; a later fold and the re-injection block both
        // read it, and neither can see a tool row this run did not write.
        if (
          event.phase === 'done' ||
          event.phase === 'refused' ||
          event.phase === 'declined'
        ) {
          this.log.push({
            k: 'tool',
            tool: event.tool,
            phase: event.phase,
            ...(event.ok === undefined ? {} : { ok: event.ok }),
            digest: digestToolCall(event.tool, event.args ?? {}),
          });
        }
        const line = toolLine(event);
        if (line !== null) {
          const target = toolTarget(event);
          const terminal =
            event.phase === 'done' ||
            event.phase === 'refused' ||
            event.phase === 'declined';
          const started = open?.startedAt ?? (event.phase === 'allowed' ? now : undefined);
          const detail: ToolDetail = {
            tool: event.tool,
            doing: toolWords(event.tool).doing,
            ...(target === null ? {} : { target }),
            ...(open === null ? {} : { requestedAt: open.requestedAt }),
            ...(started === undefined ? {} : { startedAt: started }),
            ...(terminal
              ? { endedAt: now, outcome: toolOutcome(event.phase, event.ok) }
              : { outcome: 'running' }),
            ...(event.reason === undefined ? {} : { reason: event.reason }),
          };
          this.append(
            event.phase === 'done' && event.ok === false ? 'error' : 'tool',
            line,
            detail,
          );
          if (terminal) {
            this.openTool = null;
          }
        }
      },
      approve: (request) => this.askApproval(request),
      askUser: (request) => this.askQuestions(request),
      stuck: (request) => this.askStuck(request),
      reveal: (rel) => this.askReveal(rel),
      outsidePath: (card) => this.askOutsidePath(card),
      notice: (text) => this.append('notice', text),
      bindApprovalCards: (emit) => {
        this.reportApprovalCard = emit;
      },
      observer: (event) => this.observeEvent(event),
      requestMode: (request) => this.askModeChange(request),
      phase: (text) => this.noteWait(text),
    };
  }

  /**
   * D49cb: the model's one sanctioned way to ask for a different mode.
   *
   * The switch happens HERE and only after the card is answered, so the model
   * cannot change anything — it can ask. A yes names the mode now in force,
   * which is the note that ends the stale belief a run otherwise carries.
   */
  private async askModeChange(request: {
    mode: Mode;
    reason: string;
    current: Mode;
  }): Promise<{ ok: boolean; note: string }> {
    if (this.modeRequestsThisRun >= 3) {
      return {
        ok: false,
        note: 'The user has answered three mode requests this run. Do not ask again; say in one sentence what you would do if the mode allowed it.',
      };
    }
    this.modeRequestsThisRun += 1;
    const choice = await this.present<number>({
      kind: 'mode',
      current: request.current,
      mode: request.mode,
      reason: request.reason,
      options: [`Stay in ${request.current}`, `Switch to ${request.mode}`],
      // Stay is the default: an unanswered card must not widen permission.
      selected: 0,
    });
    if (choice !== 1) {
      this.append('notice', `Plato asked to switch to ${request.mode} — the user declined.`);
      return {
        ok: false,
        note: `The user declined. Plato is still in ${request.current} mode. Do not ask again for ${request.mode} in this run; say in one sentence what you would do if it were permitted, and continue with what this mode allows.`,
      };
    }
    this.setMode(request.mode);
    this.append('notice', `Mode: ${request.mode} — the user approved Plato's request.`);
    return {
      ok: true,
      note: `The user approved. Plato is now in ${request.mode} mode. Continue the task.`,
    };
  }

  private observeEvent(event: ObserverEvent): void {
    if (event.type === 'done') {
      this.append('notice', event.text);
      return;
    }
    if (event.type === 'unavailable') {
      this.upsertObserver({ name: event.name, color: 'gray', state: 'unavailable' });
      return;
    }
    if (event.type === 'watching') {
      this.upsertObserver({ name: event.name, color: event.hex, state: 'watching' });
      return;
    }
    this.upsertObserver({
      name: event.name,
      color: event.hex,
      state: event.state,
      ...(event.last === undefined ? {} : { last: event.last }),
    });
  }

  private upsertObserver(view: ObserverView): void {
    const existing = this.state.observers.find((observer) => observer.name === view.name);
    const merged: ObserverView = {
      ...existing,
      ...view,
      ...(view.last === undefined && existing?.last !== undefined ? { last: existing.last } : {}),
    };
    const others = this.state.observers.filter((observer) => observer.name !== view.name);
    this.update({ observers: [...others, merged] });
  }

  private present<T>(card: Card): Promise<T> {
    return new Promise<T>((resolve) => {
      this.pending = resolve as (value: unknown) => void;
      this.update({ card });
    });
  }

  private settle(value: unknown): void {
    const pending = this.pending;
    this.pending = null;
    this.update({ card: null });
    pending?.(value);
  }

  private askApproval(request: ApprovalRequest): Promise<boolean> {
    const key = approvalKey(request);
    if (this.remembered.has(key)) {
      this.reportApprovalCard?.(request.tool, 'session-memory');
      return Promise.resolve(true);
    }
    const target = request.host !== undefined ? `the host ${request.host}` : 'this file';
    const options = ['No', 'Yes', `Yes, allow ${target} for this session`];
    const doing = toolWords(request.tool).doing;
    this.approvalStopped = false;
    this.reportApprovalCard?.(request.tool, 'shown');
    return this.present<number>({
      kind: 'approval',
      tool: request.tool,
      ...(request.preview === undefined ? {} : { preview: request.preview }),
      options,
      selected: 0,
    }).then((choice) => {
      // The decision is its own row: the tool's line says what it did, and
      // this says what the user answered.
      if (this.approvalStopped) {
        this.append('notice', `Denied and stopped — ${doing}.`);
        return false;
      }
      if (choice === 2) {
        this.remembered.add(key);
      }
      const word =
        choice === 0 ? 'Declined' : choice === 2 ? 'Approved for this session' : 'Approved';
      this.append('notice', `${word} — ${doing}.`);
      return choice !== 0;
    });
  }

  private async askQuestions(request: AskRequest): Promise<string[]> {
    const answers: string[] = [];
    for (let index = 0; index < request.questions.length; index += 1) {
      const question = request.questions[index] as AskQuestion;
      const answer = await this.present<string>({
        kind: 'question',
        ...(question.header === undefined ? {} : { header: question.header }),
        question: question.question,
        ...(question.context === undefined ? {} : { context: question.context }),
        options: [...question.options],
        multiple: question.multiple === true,
        ...(question.recommended === undefined ? {} : { recommended: question.recommended }),
        selected: 0,
        toggled: question.options.map(() => false),
        freeText: false,
        text: '',
        index,
        total: request.questions.length,
      });
      answers.push(answer);
    }
    return answers;
  }

  private async askStuck(
    request: StuckRequest,
  ): Promise<{ action: 'continue' | 'stop'; guidance?: string }> {
    const message =
      request.kind === 'repeat'
        ? `${request.call ?? 'The same call'} repeated ${request.count} times.`
        : `No progress for ${request.count} turns.`;
    const choice = await this.present<number>({
      kind: 'stuck',
      message,
      options: ['Stop', 'Continue'],
      selected: 0,
    });
    return choice === 1 ? { action: 'continue' } : { action: 'stop' };
  }

  /**
   * The model picker: every configured model, the current one marked, and one
   * way to add a provider. A connection that cannot list its models keeps the
   * ones already known, with its own note. Esc changes nothing.
   */
  private async pickModel(): Promise<void> {
    const lists = await connectionModels(this.config, {
      env: this.base.env,
      ...(this.base.fetchImpl === undefined ? {} : { fetchImpl: this.base.fetchImpl }),
    });
    const refs = modelRefs(lists);
    if (!refs.includes(this.model)) {
      refs.unshift(this.model);
    }
    const notes = lists
      .filter((list) => list.note !== undefined)
      .map((list) => `${list.id}: ${list.note ?? ''}`);
    const choice = await this.present<number>({
      kind: 'model',
      title: 'Model',
      notes,
      options: [
        ...refs.map((ref) => `${ref}${ref === this.model ? '  (current)' : ''}`),
        'Add a provider…',
      ],
      selected: Math.max(0, refs.indexOf(this.model)),
    });
    if (choice < 0) {
      return;
    }
    if (choice >= refs.length) {
      await this.addProviderFromSession();
      return;
    }
    const ref = refs[choice];
    if (ref !== undefined && this.setModel(ref)) {
      this.append('notice', `Model: ${ref}.`);
    }
  }

  private async addProviderFromSession(): Promise<void> {
    await this.startSetup();
  }

  private askReveal(protectedPath: string): Promise<boolean> {
    return this.present<number>({
      kind: 'reveal',
      protectedPath,
      options: ['No', 'Yes, show it with values hidden'],
      selected: 0,
    }).then((choice) => choice === 1);
  }

  cardMove(delta: number): void {
    const card = this.state.card;
    if (card === null) {
      return;
    }
    const last = card.kind === 'question' ? card.options.length : card.options.length - 1;
    const selected = Math.max(0, Math.min(last, card.selected + delta));
    this.update({ card: { ...card, selected } });
  }

  cardToggle(): void {
    const card = this.state.card;
    if (card === null || card.kind !== 'question') {
      return;
    }
    if (card.selected >= card.options.length) {
      this.update({ card: { ...card, freeText: true } });
      return;
    }
    if (!card.multiple) {
      return;
    }
    const toggled = [...card.toggled];
    toggled[card.selected] = !toggled[card.selected];
    this.update({ card: { ...card, toggled } });
  }

  cardConfirm(): void {
    const card = this.state.card;
    if (card === null) {
      return;
    }
    if (card.kind !== 'question') {
      this.settle(card.selected);
      return;
    }
    if (card.freeText) {
      const typed = card.text.trim();
      this.settle(typed.length > 0 ? typed : (card.recommended ?? ''));
      return;
    }
    if (card.selected >= card.options.length) {
      this.update({ card: { ...card, freeText: true } });
      return;
    }
    if (card.multiple) {
      const chosen = card.options.filter((_, index) => card.toggled[index] === true);
      this.settle(
        chosen.length > 0 ? chosen.join('; ') : (card.options[card.selected] ?? ''),
      );
      return;
    }
    this.settle(card.options[card.selected] ?? '');
  }

  /**
   * Esc on an approval card is the one press that denies AND stops the run.
   * The card's own No answer keeps its meaning: deny, and the run continues.
   * Ctrl+C still goes through `cardCancel`, which answers safely.
   */
  cardStop(): void {
    const card = this.state.card;
    if (card === null) {
      return;
    }
    if (card.kind !== 'approval') {
      this.cardCancel();
      return;
    }
    this.approvalStopped = true;
    // The decision row is the acknowledgement; the generic stop notice would
    // say the same thing twice.
    this.stopNoticed = true;
    this.settle(0);
    this.controller?.cancel();
  }

  cardCancel(): void {
    const card = this.state.card;
    if (card === null) {
      return;
    }
    if (card.kind === 'question' && card.freeText) {
      this.update({ card: { ...card, freeText: false } });
      return;
    }
    this.settle(
      card.kind === 'question'
        ? ''
        : card.kind === 'outside'
          ? 2
          : card.kind === 'model' || card.kind === 'resume'
            ? -1
            : 0,
    );
  }

  /** A picker line that says an answer was not understood, without closing. */
  cardNotice(text: string): void {
    const card = this.state.card;
    if (card === null || card.kind !== 'model') {
      return;
    }
    this.update({ card: { ...card, notes: [...card.notes, text] } });
  }

  cardType(text: string): void {
    const card = this.state.card;
    if (card === null || card.kind !== 'question' || !card.freeText) {
      return;
    }
    this.update({ card: { ...card, text: card.text + text } });
  }

  cardBackspace(): void {
    const card = this.state.card;
    if (card === null || card.kind !== 'question' || !card.freeText) {
      return;
    }
    this.update({ card: { ...card, text: card.text.slice(0, -1) } });
  }
}
