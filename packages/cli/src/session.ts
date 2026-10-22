import {
  RunController,
  parseModelRef,
  type ApprovalRequest,
  type Mode,
  type StuckRequest,
} from '@applivity/plato-core';
import { COMMANDS, slashText } from './completion.js';
import { saveConfig, type ConnectionConfig, type PlatoConfig, type Team } from './config.js';
import { HostError } from './errors.js';
import { applyUndo, planUndo } from '@applivity/plato-core';
import {
  createSession,
  listSessions,
  saveSession as persistSession,
  type StoredSession,
} from './sessions.js';
import {
  executeTask,
  undoDir,
  reasonText,
  summary,
  toolLine,
  type AskQuestion,
  type AskRequest,
  type ExecuteOptions,
  type RunSink,
} from './host.js';
import type { ObserverEvent, ObserverSpec } from './team.js';
import type { Env } from './paths.js';
import type { ChatProvider } from '@applivity/plato-core';

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
}

export type RowKind = 'user' | 'assistant' | 'tool' | 'notice' | 'error';

export interface Row {
  id: number;
  kind: RowKind;
  text: string;
}

export interface SessionStatus {
  model: string;
  mode: Mode;
  team: Team;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
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

export type Card = ApprovalCard | QuestionCard | StuckCard | RevealCard | ModeCard;

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
}

/** `/help`, built from the menu's table so the two can never disagree (D49cd). */
export const SESSION_HELP = [
  'Commands',
  ...COMMANDS.map((command) => `  ${slashText(command).padEnd(24)}${command.summary}`),
].join('\n');

function approvalKey(request: ApprovalRequest): string {
  if (request.host !== undefined) {
    return `${request.tool}:${request.host}`;
  }
  const path = request.args['path'];
  return typeof path === 'string' ? `${request.tool}:${path}` : request.tool;
}

export class Session {
  private config: PlatoConfig;
  private readonly base: SessionOptions;
  private state: ViewState;
  private readonly listeners = new Set<() => void>();
  private pending: ((value: unknown) => void) | null = null;
  private controller: RunController | null = null;
  private readonly remembered = new Set<string>();
  private modeRequestsThisRun = 0;
  private nextRow = 1;

  mode: Mode;
  model: string;
  history: { role: 'user' | 'assistant'; text: string }[] = [];
  sessionId: string;
  private createdAt: string;

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
    this.history = stored?.history ?? [];
    const fresh = createSession(this.model, this.mode, team);
    this.sessionId = stored?.id ?? fresh.id;
    this.createdAt = stored?.createdAt ?? fresh.createdAt;
    const rows: Row[] = this.history.map((entry, index) => ({
      id: index + 1,
      kind: entry.role,
      text: entry.text,
    }));
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
      },
      observers: [],
      running: false,
    };
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

  private append(kind: RowKind, text: string): void {
    if (text.length === 0) {
      return;
    }
    this.update({ rows: [...this.state.rows, { id: this.nextRow, kind, text }] });
    this.nextRow += 1;
  }

  addNotice(text: string): void {
    this.append('notice', text);
  }

  get connections(): ConnectionConfig[] {
    return this.config.connections;
  }

  async submit(task: string): Promise<void> {
    if (this.state.running) {
      return;
    }
    this.append('user', task);
    this.update({ running: true, streaming: '', observers: [] });
    this.modeRequestsThisRun = 0;
    const controller = new RunController();
    this.controller = controller;

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
      ...(this.history.length === 0 ? {} : { history: this.history }),
    };

    try {
      const result = await executeTask(options, this.sink(), controller);
      this.history.push(
        { role: 'user', text: task },
        { role: 'assistant', text: result.finalText },
      );
      this.update({
        status: {
          ...this.state.status,
          turns: this.state.status.turns + result.turns,
          inputTokens: this.state.status.inputTokens + result.inputTokens,
          outputTokens: this.state.status.outputTokens + result.outputTokens,
          costUsd: this.state.status.costUsd + result.costUsd,
        },
      });
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
      this.update({ running: false, streaming: '' });
    }
  }

  cancel(): void {
    // A card is a promise the loop is parked on. Esc answers it from the TUI,
    // but a cancel can arrive from anywhere, and the loop has nothing that can
    // interrupt the wait — so an unanswered card would outlive the cancel. The
    // safe answer is the default one: No for the approval, Stay for the mode.
    const card = this.state.card;
    if (card !== null) {
      this.settle(card.kind === 'question' ? '' : 0);
    }
    this.controller?.cancel();
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
    this.persist();
  }

  setModel(ref: string): boolean {
    if (parseModelRef(ref, this.config.connections.map((c) => c.id)) === null) {
      this.append('error', `'${ref}' is not connection:model for a configured connection.`);
      return false;
    }
    this.model = ref;
    this.config = { ...this.config, model: ref };
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

  private save(): void {
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
      });
    } catch (error) {
      this.append('error', `Could not save the session: ${(error as Error).message}`);
    }
  }

  async handleCommand(line: string): Promise<'exit' | 'handled'> {
    const trimmed = line.trim();
    const [name = '', ...rest] = trimmed.split(/\s+/);
    const argument = rest.join(' ');
    switch (name) {
      case '/help':
        this.append('notice', SESSION_HELP);
        return 'handled';
      case '/exit':
      case '/quit':
        return 'exit';
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
        if (argument.length === 0) {
          const refs = this.config.connections
            .map((connection) => `${connection.id}:<model>`)
            .join('  ');
          this.append('notice', `Model: ${this.model}${refs.length > 0 ? `\nTry: ${refs}` : ''}`);
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
          this.append('notice', 'Nothing is running.');
        } else {
          this.controller.requestCompact();
          this.append('notice', 'Compaction requested.');
        }
        return 'handled';
      case '/new': {
        this.history = [];
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
      case '/sessions': {
        const saved = listSessions(this.base.root, this.base.env);
        if (saved.length === 0) {
          this.append('notice', 'No saved sessions.');
        } else {
          this.append(
            'notice',
            saved
              .slice(0, 10)
              .map((session) => `${session.id}  ${session.title || '(untitled)'}`)
              .join('\n'),
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
      textDelta: (soFar) => this.update({ streaming: soFar }),
      textCommitted: (text) => {
        this.append('assistant', text);
        this.update({ streaming: '' });
      },
      tool: (event) => {
        if (event.phase === 'requested') {
          return;
        }
        const line = toolLine(event);
        if (line !== null) {
          this.append(event.phase === 'done' && event.ok === false ? 'error' : 'tool', line);
        }
      },
      approve: (request) => this.askApproval(request),
      askUser: (request) => this.askQuestions(request),
      stuck: (request) => this.askStuck(request),
      reveal: (rel) => this.askReveal(rel),
      notice: (text) => this.append('notice', text),
      observer: (event) => this.observeEvent(event),
      requestMode: (request) => this.askModeChange(request),
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
      return Promise.resolve(true);
    }
    const target = request.host !== undefined ? `the host ${request.host}` : 'this file';
    const options = ['No', 'Yes', `Yes, allow ${target} for this session`];
    return this.present<number>({
      kind: 'approval',
      tool: request.tool,
      ...(request.preview === undefined ? {} : { preview: request.preview }),
      options,
      selected: 0,
    }).then((choice) => {
      if (choice === 2) {
        this.remembered.add(key);
      }
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

  cardCancel(): void {
    const card = this.state.card;
    if (card === null) {
      return;
    }
    if (card.kind === 'question' && card.freeText) {
      this.update({ card: { ...card, freeText: false } });
      return;
    }
    this.settle(card.kind === 'question' ? '' : 0);
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
