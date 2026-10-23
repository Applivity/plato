/**
 * Plato VS Code shell — thin by contract (ARCHITECTURE.md): commands,
 * SecretStorage, webview host. Logic lives in @applivity/plato-core.
 */
import * as vscode from 'vscode';
import {
  runAgentLoop,
  AgentBus,
  TranscriptWriter,
  RunController,
  type RunEndReason,
  createProvider,
  splitModelRef,
  modelSupportsReasoning,
  PROVIDER_PRESETS,
  fetchModelPool,
  resolveMaxContext,
  resolveOfferedModels,
  pickEffectiveModel,
  renderMarkdown,
  McpServer,
  loadMcpConfig,
  parseMcpConfig,
  withServerDisabled,
  EMPTY_MCP_CONFIG,
  applyFold,
  isMessageRow,
  lastSummaryIndex,
  planFold,
  requestFromLog,
  tailPairs,
  digestToolCall,
  buildFoldPrompt,
  parseTodos,
  unfinishedPlanNote,
  type RefusalReason,
  type TodoItem,
  ObserverAgent,
  loadTeamConfig,
  parseTeamConfig,
  TeamConfigError,
  loadDuoConfig,
  DuoConfigError,
  parseDuoConfig,
  defaultDuoPhilosopher,
  duoObserverSpec,
  defaultAcademyMembers,
  emitTeamConfig,
  emitDuoConfig,
  isSecretPath,
  isWriteTool,
  createVault,
  configureSecrets,
  type SecretVault,
  // D49bc: the protected-file list is the owner's, and the panel is where they
  // own it (D45c). The built-in names are shown, and the entries are validated
  // in core — an entry that would silently match nothing is refused there.
  SECRET_DENYLIST,
  protectNameError,
  allowPathError,
  revealCard,
  type RevealCard,
  formatDiagnostics,
  stuckCard,
  type StuckCard,
  type StuckRequest,
  writePathsOf,
  loadProjectFile,
  loadImageAttachment,
  looksLikeImage,
  DEFAULT_PLATO_BODY,
  slashCommand,
  slashMenu,
  // D49bo: the queue rule lives in core so it can be tested without a host.
  nextQueued,
  COMPACT_SYSTEM_PROMPT,
  compactMaxTokensFor,
  PERSONAS,
  PHILOSOPHER_COLORS,
  ROLE_MAX_CHARS,
  colorHex,
  describeError,
  // D49ay: transcripts are compressed when old and deleted only on request.
  isRunFileName,
  runFilesIn,
  readRunText,
  sweepRuns,
  // D49ba: what an approval card says — the situation, not the tool's name.
  approvalAllowAll,
  approvalAnswered,
  approvalAnsweredSession,
  approvalHeading,
  // D49ba: what a tool is called where the user reads about it.
  toolWordsForView,
  // D49ax: undo is Plato's own copies of what it replaced.
  applyUndo,
  planUndo,
  sweepDeadProjects,
  sweepProject,
  undoCard,
  undoNothingText,
  undoResultText,
} from '@applivity/plato-core';
import type { UndoCard, UndoPlan, UndoResult, UndoScope } from '@applivity/plato-core';
import type { DigestEntry } from '@applivity/plato-core';
import type { TeamMember } from '@applivity/plato-core';
import type { DuoPhilosopher } from '@applivity/plato-core';
import type { ApprovalRequest, Mode, ImageMime } from '@applivity/plato-core';
import {
  EditorDiagnostics,
  describeDiagLook,
  type DiagSnapshot,
} from './diagnostics.js';
import { chatHtml } from './webview.js';
import { isAbsolute, join, relative } from 'node:path';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const LEGACY_KEY = 'plato.anthropicApiKey'; // pre-0.3.0 anthropic slot

// D44a attachment hard caps (constants in v1, settings later). The per-file
// cap follows loadProjectFile's char semantics — 200 KB measured in chars.
const MAX_ATTACH_FILES = 20;
const MAX_ATTACH_BYTES = 200 * 1024;
/**
 * D49o: images get their own cap, measured on RAW bytes. The text cap above is
 * in chars and meaningless here — and measuring base64 instead would refuse
 * files comfortably inside the limit, since encoding inflates by ~33%.
 */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// D44d: cross-message memory fold cadence. A run's context is the running
// conversation summary + the raw recent tail; when the tail grows past
// AUTO_FOLD_AT pairs the oldest are folded into the summary, keeping the
// newest KEEP_AFTER_FOLD pairs verbatim. MAX_TAIL_PAIRS is a safety cap on
// historyFor when a fold is skipped (run in progress etc.).
const KEEP_AFTER_FOLD = 12;
const AUTO_FOLD_AT = 26;
const MAX_TAIL_PAIRS = 60;

/** D49t: how long a connection's discovered model metadata stays trusted. */
const POOL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface ConnectionPoolEntry {
  id: string;
  /** Provider-advertised context window, if the /models payload had it. */
  maxContext?: number;
  maxOutput?: number;
}

interface ConnectionConfig {
  id: string;
  kind: 'anthropic' | 'openai';
  baseUrl?: string;
  /** Selected models (the chat dropdown). */
  models?: string[];
  /** Full fetched pool (picker source; selection never shrinks it). */
  allModels?: string[];
  /** D37: per-model metadata (maxContext etc.) from the fetched pool. */
  pool?: ConnectionPoolEntry[];
  /** D49t: when `pool` was fetched (ms epoch), so a stale one can refresh. */
  pooledAt?: number;
}

/** Parses ONLY user-defined entries from plato.connections (no seeds). */
function rawUserConnections(): ConnectionConfig[] {
  const raw = vscode.workspace.getConfiguration('plato').get<unknown>(
    'connections',
    [],
  );
  const list: ConnectionConfig[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw as Record<string, unknown>[]) {
      const id = typeof row['id'] === 'string' ? row['id'] : '';
      const kind =
        row['kind'] === 'anthropic'
          ? ('anthropic' as const)
          : row['kind'] === 'openai'
            ? ('openai' as const)
            : null;
      if (!id || !kind) {
        continue;
      }
      const baseUrl = typeof row['baseUrl'] === 'string' ? row['baseUrl'] : undefined;
      const models = Array.isArray(row['models'])
        ? (row['models'] as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : undefined;
      const allModels = Array.isArray(row['allModels'])
        ? (row['allModels'] as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : undefined;
      const rawPool = row['pool'];
      const pool: ConnectionPoolEntry[] | undefined = Array.isArray(rawPool)
        ? (rawPool as unknown[])
            .map((r): ConnectionPoolEntry | null => {
              if (typeof r !== 'object' || r === null) {
                return null;
              }
              const rec = r as Record<string, unknown>;
              if (typeof rec['id'] !== 'string') {
                return null;
              }
              const out: ConnectionPoolEntry = { id: rec['id'] };
              if (typeof rec['maxContext'] === 'number') {
                out.maxContext = rec['maxContext'];
              }
              if (typeof rec['maxOutput'] === 'number') {
                out.maxOutput = rec['maxOutput'];
              }
              return out;
            })
            .filter((e): e is ConnectionPoolEntry => e !== null)
        : undefined;
      list.push({ id, kind, baseUrl, models, allModels, pool });
    }
  }
  return list;
}

/** Reads plato.connections (D26a; no built-in seeds since D43). */
function readConnections(): ConnectionConfig[] {
  return rawUserConnections();
}

/** Exact token facts beat estimated dollars (D26c). */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}

/**
 * D46: Plato's own home folder, the same on every platform because `homedir()`
 * and `join` are. On Windows that is `C:\Users\<name>\.plato` — no `~` is ever
 * expanded by hand, and no path is built from a string with a separator in it.
 */
function homePlatoDir(): string {
  return join(homedir(), '.plato');
}

/**
 * D49ax: reclaim the undo stores of projects that no longer exist.
 *
 * Once per activation, off any path the user waits on. Nothing else would ever
 * collect these: no window will open a deleted folder again to sweep its own
 * store. Failing here costs a disk read and nothing else, so it never throws.
 */
function reclaimDeadProjects(): void {
  try {
    sweepDeadProjects(join(homePlatoDir(), 'undo'));
  } catch {
    // A missing or unreadable store folder is not an error.
  }
}

/**
 * D49bb: hand the owner's protected-file settings to core.
 *
 * `isSecretPath` is a predicate called from eight places, including the walker
 * that builds the first prompt, so the policy is module state set here rather
 * than an argument threaded through every caller. Only the setting keys are read
 * here; the matching rules live in core, where they are tested.
 */
function applySecretPolicy(): void {
  const cfg = vscode.workspace.getConfiguration('plato');
  configureSecrets({
    extra: readStringList(cfg, 'secrets.protect'),
    allow: readStringList(cfg, 'secrets.allow'),
  });
}

/** A settings value that must be a list of strings; anything else reads as none. */
function readStringList(cfg: vscode.WorkspaceConfiguration, key: string): string[] {
  const v = cfg.get<unknown>(key);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

export function activate(ctx: vscode.ExtensionContext): void {
  // One chat panel per window; re-running the command reveals it instead
  // of spawning a blank second one.
  let live: vscode.WebviewPanel | undefined;
  let host: ChatHost | undefined;
  // D49bq: the activity-bar list re-reads the stored chats when it is shown, and
  // once the panel has closed — which is when a conversation is archived.
  const chatsChanged = new vscode.EventEmitter<void>();

  setTimeout(reclaimDeadProjects, 0);

  // D49bb: the protected list is the owner's. Read once at activation and again
  // whenever the settings change, because a user who has just taken
  // `local.properties` off the list should not have to reload the window to be
  // believed.
  applySecretPolicy();
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('plato.secrets')) applySecretPolicy();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'plato.setApiKey',
      async (connectionArg?: string) => {
        const ids = readConnections().map((c) => c.id);
        // D43: nothing to attach a key to before the first connection.
        if (ids.length === 0) {
          void vscode.window.showInformationMessage(
            'No providers connected yet — add one in the Plato chat panel (⚙ Settings → Providers) first.',
          );
          return;
        }
        const pick =
          connectionArg && ids.includes(connectionArg)
            ? connectionArg
            : await vscode.window.showQuickPick(ids, {
                placeHolder: 'Which connection is this key for?',
              });
        if (!pick) {
          return;
        }
        const input = await vscode.window.showInputBox({
          prompt: `${pick} API key (stored in VS Code SecretStorage, never in settings or files)`,
          password: true,
          ignoreFocusOut: true,
        });
        if (input && input.trim().length > 0) {
          await ctx.secrets.store(`plato.providers.${pick}.apiKey`, input.trim());
          if (pick === 'anthropic') {
            // Keep the legacy slot in sync for pre-0.3.0 fallbacks.
            await ctx.secrets.store(LEGACY_KEY, input.trim());
          }
          void vscode.window.showInformationMessage(
            `Plato: ${pick} API key stored.`,
          );
        }
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.manageKeys', async () => {
      const conns = readConnections();
      // D43: nothing to manage before the first connection.
      if (conns.length === 0) {
        const open = await vscode.window.showInformationMessage(
          'No providers connected yet — add one first.',
          'Open Settings',
        );
        if (open) {
          await vscode.commands.executeCommand('plato.openChat');
        }
        return;
      }
      const pick = await vscode.window.showQuickPick(
        conns.map((c) => ({
          label: c.id,
          description: `${c.kind}${c.baseUrl ? ' · ' + c.baseUrl : ''}`,
          connId: c.id,
        })),
        { placeHolder: 'Manage API key for which connection?' },
      );
      if (!pick) {
        return;
      }
      const slot = `plato.providers.${pick.connId}.apiKey`;
      const has = (await ctx.secrets.get(slot)) !== undefined;
      const action = await vscode.window.showQuickPick(['Set key'], {
        placeHolder: `Key status for ${pick.connId}: ${
          has ? '\u25CF set' : '\u25CB missing'
        }`,
      });
      if (action === 'Set key') {
        await vscode.commands.executeCommand('plato.setApiKey', pick.connId);
      }
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.openChat', () => {
      if (live) {
        live.reveal(vscode.ViewColumn.Beside);
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'platoChat',
        'Plato Chat',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          // Keep the DOM (and chat log) when the tab is hidden.
          retainContextWhenHidden: true,
        },
      );
      panel.onDidDispose(() => {
        if (live !== panel) {
          return;
        }
        const closing = host;
        live = undefined;
        host = undefined;
        // D41: archive on close so History fills without New Chat. The sidebar
        // row list is only right once that archive has landed.
        void (async () => {
          await closing?.dispose();
          chatsChanged.fire();
        })();
      });
      live = panel;
      panel.webview.html = chatHtml();
      host = new ChatHost(panel, ctx);
      // D49ay: housekeeping, once per window. Compresses any transcript that has
      // aged out; never deletes one.
      host.sweepTranscripts();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.newChat', async () => {
      if (host) {
        await host.newChat();
        return;
      }
      // No panel yet: drop any stored conversation, then open fresh.
      await ctx.workspaceState.update(LOG_KEY, []);
      await vscode.commands.executeCommand('plato.openChat');
    }),
  );

  // D49bq: the activity-bar launcher. It opens the panel; it is not the panel.
  const chats = new PlatoChatsProvider(ctx, chatsChanged);
  const tree = vscode.window.createTreeView('plato.chats', {
    treeDataProvider: chats,
  });
  // The stored list changes while the view is hidden — a chat is archived when
  // the panel closes — so re-read it every time the view is shown.
  tree.onDidChangeVisibility((e) => {
    if (e.visible) {
      chatsChanged.fire();
    }
  });
  // The provider itself owns nothing to release.
  ctx.subscriptions.push(tree, chatsChanged);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.resumeChat', async (id?: unknown) => {
      if (typeof id !== 'string') {
        return;
      }
      if (!live) {
        await vscode.commands.executeCommand('plato.openChat');
      }
      await host?.resumeSession(id);
    }),
  );
}

type PendingResolve = (v: boolean) => void;

const LOG_KEY = 'plato.chatLog';
const LOG_MAX = 400;
/**
 * D49j: how often the in-progress reply is re-rendered. `renderMarkdown`
 * re-parses the WHOLE buffer, so posting per fragment is quadratic; a trailing
 * throttle caps it at ~20 posts/second, which still reads as live typing.
 */
const STREAM_THROTTLE_MS = 50;
/**
 * D49aq: what a cancelled question resolves to, one per question asked.
 *
 * The run is being cancelled, so the answer's content does not matter — but the
 * loop maps the array across the questions it asked, and a short array would put
 * `undefined` in the model's history. The text says plainly what happened, since
 * the model reads it as a tool result before the run unwinds.
 */
const CANCELLED_ANSWER = '(the run was cancelled before this was answered)';
const TITLE_KEY = 'plato.chatTitle';
const SESSIONS_KEY = 'plato.chatSessions';
const SESSIONS_MAX = 30;
/** D49bj: the mode outlives the panel, like the title and the log. */
const MODE_KEY = 'plato.chatMode';
const MODES: readonly Mode[] = ['plan', 'edit', 'auto'];

interface StoredChat {
  id: string;
  title: string;
  ts: string;
  log: Entry[];
}

/** A short "when" for the sidebar rows. The exact minute stops mattering fast. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return d.toLocaleDateString();
}

/**
 * D49bq: the activity-bar launcher — Plato's presence beside Git, Search and
 * Extensions.
 *
 * A TREE, not a second webview: it takes the theme's colours for free, carries
 * no script surface, and every row is a command, so nothing here is reachable
 * only by clicking. It lists the two ways into the chat and the chats that are
 * already stored.
 *
 * It is deliberately NOT the chat itself. The conversation stays an editor tab,
 * because the run controls are built on the panel lifecycle (D49bn) — see that
 * decision for the alternative that was left open.
 */
class PlatoChatsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly changed: vscode.EventEmitter<void>,
  ) {}

  // A getter, not a field: the emitter is a constructor parameter property, and
  // field initializers run before the constructor body assigns it.
  get onDidChangeTreeData(): vscode.Event<void> {
    return this.changed.event;
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  getChildren(el?: vscode.TreeItem): vscode.TreeItem[] {
    // Every row is a leaf: there is nothing to expand.
    if (el !== undefined) {
      return [];
    }
    const rows: vscode.TreeItem[] = [
      this.action('Open Chat', 'plato.openChat', 'comment-discussion'),
      this.action('New Chat', 'plato.newChat', 'add'),
    ];
    for (const s of this.sessions().slice(0, 12)) {
      const row = new vscode.TreeItem(
        s.title && s.title.trim().length > 0 ? s.title : 'Untitled chat',
        vscode.TreeItemCollapsibleState.None,
      );
      row.description = whenLabel(s.ts);
      row.iconPath = new vscode.ThemeIcon('history');
      row.command = {
        command: 'plato.resumeChat',
        title: 'Open this chat',
        arguments: [s.id],
      };
      rows.push(row);
    }
    return rows;
  }

  private sessions(): StoredChat[] {
    return this.ctx.workspaceState.get<StoredChat[]>(SESSIONS_KEY, []);
  }

  private action(label: string, command: string, icon: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}

/**
 * D49bg: one question from `ask_user`, as the shell needs it — to draw the card
 * now, and to draw it AGAIN after a reload.
 *
 * `multiple` is here because a restored card that lost it would show circles
 * where the live card showed boxes, which silently changes what the user thinks
 * they may pick. The flag was already arriving at runtime; the type was just
 * narrower than the value, so the shell was the one place that could not see it.
 */
interface AskQuestion {
  question: string;
  header?: string;
  context?: string;
  options: string[];
  recommended?: string;
  multiple?: boolean;
}

/**
 * Persisted chat entries. The log lives in workspaceState (survives
 * window reloads and restarts); the webview renders whatever it is given.
 */
type Entry =
  | { k: 'msg'; cls: string; who: string; text: string }
  /**
   * D49ag: `digest` is what the call WAS FOR (see `digestToolCall`), `ok`
   * whether it worked. Without them this row recorded only that something ran,
   * so a fold summarising the row could not say what the run had done — and
   * neither could the next run's model, whose memory is derived from this log.
   */
  | {
      k: 'tool';
      tool: string;
      phase: string;
      digest?: string;
      ok?: boolean;
      /** D49as: set only on phase 'refused' — which guard stopped the call. */
      reason?: RefusalReason;
    }
  /**
   * D49ba: `heading` and `allowAll` are the card's own words, built in core.
   * They travel with the row so a reloaded card reads the same as the live
   * one — and so nothing downstream has to compose copy from a tool name.
   */
  | { k: 'card-open'; tool: string; preview: string; heading?: string; allowAll?: string }
  /**
   * D49aw: a stuck run asked the user. Recorded so a reload rebuilds the card —
   * without this the question would vanish from the screen while the run was
   * still waiting for the answer, which is the "left hanging" case exactly. A
   * click on an old card is harmless: the host ignores an answer when nothing is
   * pending.
   */
  | ({ k: 'stuck-open' } & StuckCard)
  /**
   * D49ax: /undo found something it could put back and is asking. Recorded for
   * the same reason as the stuck card above — a reload must rebuild the question
   * rather than lose it. The plan itself is NOT stored: it must be recomputed
   * against the files as they are now, because the whole safety rule is that a
   * file changed since Plato wrote it is refused.
   */
  | ({ k: 'undo-open' } & UndoCard)
  /** D49ax: the undo ran and was reported. Closes the card on a reload too. */
  | { k: 'undo-done' }
  /**
   * D49bc: a protected file Plato cannot mask is being offered in full. Recorded
   * for the same reason as the other two — the host is parked on the answer, so
   * a reload that lost the card would leave a run waiting for a click that can
   * no longer be made.
   */
  | ({ k: 'reveal-open' } & RevealCard)
  | { k: 'reveal-done' }
  /**
   * D49bg: the question card, recorded for exactly the reason the four cards
   * above are — the host is parked on the answer with nothing else able to
   * interrupt it, so a reload that lost the card would leave a run waiting for a
   * click that can no longer be made. It was the last parked card still missing
   * from this union.
   */
  | { k: 'question-open'; questions: AskQuestion[] }
  /** D49bg: the questions were answered or the run was cancelled — closes it. */
  | { k: 'question-done' }
  /**
   * D49cb: the model's mode request, recorded for the same reason as the five
   * cards above — the host is parked on the answer. The reason is stored here
   * because the card is rebuilt from this row; it is model prose, which the chat
   * log already holds for every reply, and it stays out of the transcript.
   */
  | { k: 'mode-open'; current: Mode; mode: Mode; reason: string }
  /** D49cb: answered, or the run was cancelled — closes the card on a reload. */
  | { k: 'mode-done' }
  | { k: 'card-done'; title: string; preview: string }
  /** D44d: the model's memory boundary — a fold replaced older turns with this. */
  | { k: 'compact'; text: string }
  /**
   * D49ah: the agent's plan, as it stood at that moment in the run. A row rather
   * than a floating panel because the transcript is already the record of what
   * happened in order — a run that replans three times should show three plans,
   * and a reload should rebuild the last one from the log rather than from
   * memory the shell does not keep.
   */
  | { k: 'todo'; todos: TodoItem[] }
  /**
   * D49aa: the display cap dropped rows. The transcript may be bounded; it may
   * not lose a row without saying so. `lostSummary` is true when the cap took
   * the summary itself, which is the model's memory and not just the display.
   */
  | { k: 'trim'; dropped: number; lostSummary: boolean };

/** D44a: per-run context attachments add to a run. */
interface RunCtx {
  /** Root-relative pending attachment paths; content is read at run start. */
  attach?: string[];
  /** D49o: root-relative image paths, read as BYTES at run start. */
  images?: string[];
}

class ChatHost {
  // D49ak: `edit` is the default — it replaced `act`, and it is the middle of
  // the three modes (plan looks, edit asks, auto does not).
  //
  // D49bj: a default only until the constructor reads the stored one back. The
  // mode is the user's own setting, and losing it on a reload is what the model
  // picker's own decision (D49x) already refused to accept for the model.
  private mode: Mode = 'edit';
  private readonly sessionWrites = new Set<string>();
  private readonly sessionApprovals = new Set<string>();
  /**
   * D49bc: protected files the user chose to show IN FULL this session.
   *
   * Session state, like the two sets above, and for the same reason: the answer
   * `Show it this session` is a session-long decision, and asking again on the
   * next read would be the nuisance this whole decision exists to remove. It
   * dies with the panel, so the next session asks once more.
   */
  private readonly revealedPaths = new Set<string>();
  private controller = new RunController();
  private pendingApproval: PendingResolve | null = null;
  /** D49bc: the run is parked on a reveal card until this is answered. */
  private pendingReveal: PendingResolve | null = null;
  private pendingQuestion: ((answers: string[]) => void) | null = null;
  /**
   * D49aq: how many questions the open card is asking, so cancelling it can
   * resolve with one answer per question rather than a short array the loop
   * would pad with `undefined`.
   */
  private pendingQuestionCount = 0;
  /**
   * D49bg: the questions the open card is asking, kept so the answer can be
   * written into the log as the exchange it was. The count above is not enough —
   * a row saying the user answered cannot say WHAT they answered.
   */
  private openQuestions: AskQuestion[] = [];
  /**
   * D49aw: the stuck card's answer. Cancel must resolve this too — a run waiting
   * on the card is waiting with nothing else able to interrupt it, which is the
   * same trap `pendingQuestion` fell into (D49aq).
   */
  private pendingStuck:
    | ((a: { action: 'continue' | 'stop'; guidance?: string }) => void)
    | null = null;
  /**
   * D49aq: the current run's bus, so an approval path can say on the record
   * what it did with an ask — a card drawn or a session memory answering. Only
   * the HOST knows which, and the loop's `approval-requested` says neither.
   * Null outside a run, which is also when there is no ask to report.
   */
  private runBus: AgentBus | null = null;
  /**
   * D49bj: the live run's id, so a mode switch made mid-run can be filed against
   * it. The loop mints the id, so this only exists between `run-started` and the
   * end of the run — empty string outside one, which is exactly when there is no
   * record to write to.
   */
  private currentRunId = '';
  /**
   * D49ca: mode switches made while no run was live, waiting for the next run
   * to name. A transcript is per run and is opened by `run-started`, so there
   * is no file to write to at the moment of the click — but the next record
   * must still say the mode changed, and when.
   */
  private pendingModeChanges: { from: Mode; to: Mode; at: string; via: 'picker' | 'request' }[] = [];
  /**
   * D49cb: the mode card's answer. The loop awaits it through `requestMode`;
   * null means no card is open. Cancel resolves it FALSE — the safe answer, the
   * same rule every parked card follows.
   */
  private pendingModeRequest: ((allow: boolean) => void) | null = null;
  /**
   * D49cb: how many times the model has asked this run. A deny is an answer,
   * and asking again with a new sentence is how a model gets around the
   * repetition bound — a small cap ends it without counting anything the user
   * did. The card is still the gate; this only stops a nag.
   */
  private modeRequestsThisRun = 0;
  private replyBuffer = '';
  /**
   * D49j: the current turn's text as it arrives, and the pending throttle
   * timer. This is a PREVIEW, never a source of truth — a committed block
   * supersedes it. It exists only so the reply can be shown while it is
   * written instead of after the whole turn lands.
   */
  private streamPreview = '';
  private streamTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** D49bn: the panel was closed. Nothing may start after this. */
  private disposed = false;
  /** D49bn: the live run, so `dispose()` can wait for it to unwind. */
  private runPromise: Promise<void> | null = null;
  /**
   * D49bm: the difference between "the user asked to pause" and "the run is
   * parked". `pause()` only records the request — the loop may never reach a
   * gate, because a turn that returns no tool calls ends the run — so the two
   * are genuinely different states and the button must not conflate them.
   */
  private pauseRequested = false;
  /** D49bm: whether the run parked at least once, for the closing line. */
  private pauseEverParked = false;
  /**
   * D49bm: a control asked for before the run was under way.
   *
   * The run controls are in the VIEW's gift — they appear the instant `ask` is
   * posted — but the host spends real time getting to `running = true`: it reads
   * the key, fills the model pool and starts MCP servers, the last of which can
   * take twenty seconds. A click in that window used to be dropped in silence,
   * which is the same class of defect as the button that lied — the user asked,
   * and nothing anywhere said the ask was never heard. Held here and applied the
   * moment the run exists.
   *
   * Cancel matters most: losing it means Plato starts the run the user just
   * asked it to stop.
   */
  private pendingPause = false;
  private pendingCancel = false;
  /**
   * D49bo: messages to send as the next task, in order. Deliberately in memory
   * only: a reload kills the run too, and a restored non-empty queue would
   * either sit there forever or start a run nobody asked for the moment the
   * panel opened.
   */
  private queue: string[] = [];
  /**
   * D49bo: set when a run ended for a reason that must not hand the queue on —
   * a cancel, a stuck run, or a failure. It stays set until the user asks for
   * the queue to continue, so one cancel cannot be quietly undone.
   */
  private queueHeld = false;
  /**
   * D49bo: true from the moment a run is STARTED until it has fully unwound.
   *
   * **`running` is not this flag, and using it as one was a real defect.**
   * `running` is set only once the host has finished preparing — reading the key,
   * filling the model pool, starting MCP servers, the last of which allows twenty
   * seconds — and anything that may start a run has to refuse for that whole
   * span. It did not: a `/queue` arriving in that window found `running` false,
   * drained the queue, and started a **second run alongside the one still being
   * prepared**. The two then shared one controller, one webview and one runs
   * directory, and the queued task raced the real one to the wire. Caught by
   * real-model case 30 as **1 failure in 10** — the queued run's transcript
   * carried the EARLIER timestamp and the run took two minutes instead of forty
   * seconds — and diagnosed from that evidence rather than by guessing, which is
   * the whole reason the diagnostic below exists.
   */
  private runInFlight = false;
  /**
   * D49bo: how the last run ended, or null when it failed or never reached its
   * result. Read by the queue's advance, which runs after the run has unwound and
   * so cannot see the local that held it.
   */
  private lastRunEnd: RunEndReason | null = null;
  private modelOverride: string | null = null;
  // D49aa: not readonly — a fold REPLACES the array with one that keeps every
  // row plus the summary, which is clearer than splicing a new list into the old.
  private log: Entry[];
  /** D40: model-generated (or user-renamed) conversation title. */
  private chatTitle: string;
  /** D40: once the user renames, the generator never overwrites. */
  private titleManuallySet = false;
  /** D41: a title call is in flight — don't double-fire. */
  private titleInFlight = false;
  /** D41: log length at the last archive; only archive what's new. */
  private archivedUpTo = 0;
  /** D44a: root-relative paths awaiting send; host-authoritative. */
  private pendingAttachments: string[] = [];
  /** D49o: attached images, kept apart from text so they never enter the task. */
  private pendingImages: string[] = [];
  /** D44c: /history-imported conversation awaiting the next run. */
  private pendingHistory: { title: string; text: string } | null = null;
  /** D44d: a cross-message fold (summary call + log rewrite) is in flight. */
  private folding = false;
  /** D47: watchers on the ~/.plato config files (armed once Settings opens). */
  private homeWatchers: vscode.FileSystemWatcher[] = [];
  /** D47: ms of the last home-file write — swallows our own watcher echoes. */
  private lastHomeWrite = 0;
  /**
   * D49bt: what each MCP server did on the LAST run, so Settings can report it
   * without spawning anything. MCP servers live only for the length of a run —
   * built at the top of `run()` and stopped in its `finally` — so between runs
   * there is no live state to read, and this map is the whole of what the panel
   * is entitled to claim. A server absent from it has not run yet.
   */
  private mcpLastRun = new Map<string, { tools: number; error: string }>();
  /**
   * D49av: the editor's own view of the files Plato writes. One per chat panel,
   * because it remembers which files a language server has ever reported on —
   * "nobody has looked" is not "nothing is wrong", and only a subscription that
   * outlives a single run can tell them apart.
   */
  private readonly editorDiag = new EditorDiagnostics(() => {
    // D49av: after a file has been shown to wake a language server, the
    // conversation goes back in front. Naming it is what makes that reliable —
    // closing the tab we opened was not, and a backgrounded chat is a chat the
    // user (and the field harness) can no longer reach.
    this.panel.reveal(undefined, true);
  });
  /** D49av: what was known before the write in flight — see `onToolEvent`. */
  private pendingDiag: DiagSnapshot | null = null;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly ctx: vscode.ExtensionContext,
  ) {
    this.log = ctx.workspaceState.get<Entry[]>(LOG_KEY, []);
    // D40: the conversation title survives reloads with the log.
    this.chatTitle = ctx.workspaceState.get<string>(TITLE_KEY, '');
    // D49bj: and the mode survives them too. Validated on the way in because
    // this value comes off disk — the picker is the only writer and offers only
    // the three, but a stored file is a boundary, and an unrecognised value
    // would otherwise reach the permission table and deny every tool.
    const storedMode = ctx.workspaceState.get<string>(MODE_KEY, 'edit');
    this.mode = MODES.find((m) => m === storedMode) ?? 'edit';
    this.panel.webview.onDidReceiveMessage(
      async (m: { type?: string; [k: string]: unknown }) => {
        if (m.type === 'mode' && typeof m.value === 'string') {
          // D49bj validated the STORED value because it comes off disk. This
          // message is the other boundary that reaches the permission table, and
          // an unrecognised value falls through `decide` as `auto` — a
          // permission it never earned. Accept only the three the picker offers.
          const next = MODES.find((x) => x === m.value);
          if (next === undefined) return;
          this.applyMode(next, 'picker');
          return;
        }
        // D49cb: the answer to the model's mode request. Only `true` approves,
        // so a malformed message can never switch the permission table.
        if (m.type === 'mode-request-answer') {
          const resolve = this.pendingModeRequest;
          this.pendingModeRequest = null;
          // Closes the card on a replay, whether the answer was yes or no.
          if (resolve !== null) this.push({ k: 'mode-done' });
          resolve?.(m.allow === true);
          // The view has already marked its card answered; this clears the
          // status line and keeps the dismissal in one place, as every card does.
          this.send('mode-request-done');
          return;
        }
        // D40: user renamed the conversation title from the header chip.
        if (m.type === 'rename' && typeof m.value === 'string') {
          const v = m.value.trim().slice(0, 80);
          this.chatTitle = v;
          this.titleManuallySet = true;
          await this.ctx.workspaceState.update(TITLE_KEY, v);
          this.send('title', v);
          return;
        }
        if (m.type === 'model' && typeof m.value === 'string') {
          // D49x: an ENABLED model, not merely a known connection. The composer
          // and the Duo/Academy doer selects are the only model controls in the
          // product, and both offer this exact list, so a value outside it did
          // not come from a click.
          if (this.isSelectable(m.value)) {
            this.modelOverride = m.value;
            // D49x: the picker is the only in-product way to choose a model, so
            // its choice is a preference and must outlive the panel. It used to
            // live in memory alone, and every reload reverted to `plato.model` —
            // a setting with no UI — which is how a deselected model reappeared.
            await vscode.workspace
              .getConfiguration('plato')
              .update('model', m.value, vscode.ConfigurationTarget.Global);
            void this.panel.webview.postMessage({
              type: 'notice',
              text: `Model set to ${m.value}`,
            });
            // Capability may have changed with the model (D28 phase 2).
            this.postModelState();
          } else {
            this.send('error', `Model "${m.value}" is not enabled for any connection`);
          }
          return;
        }
        if (m.type === 'approve') {
          const resolve = this.pendingApproval;
          this.pendingApproval = null;
          const ok = m.value === 'yes';
          resolve?.(ok);
          this.push({
            k: 'msg',
            cls: 'you',
            who: 'You',
            text: ok ? '[allowed]' : '[denied]',
          });
          return;
        }
        if (m.type === 'approve-all' && typeof m.tool === 'string') {
          // D49p: the webview echoes back the key the card was opened with, so a
          // host-scoped approval is remembered against that host and not the
          // tool as a whole.
          const key =
            typeof m.sessionKey === 'string' && m.sessionKey.length > 0
              ? m.sessionKey
              : m.tool;
          this.sessionApprovals.add(key);
          // The waiting card must resolve too — the loop is blocked on it.
          const resolve = this.pendingApproval;
          this.pendingApproval = null;
          resolve?.(true);
          // D49ba: the key is internal ("web_fetch:example.com") and "approved"
          // had no actor. The notice's real job is to answer "why was there no
          // card?" — and the call it is about is named on the row right below it.
          this.send('notice', 'Plato will not ask about this again this session.');
          return;
        }
        if (m.type === 'newChat') {
          void this.newChat();
          return;
        }
        // Observer controls (D25f): effective at the loop's safe points.
        if (m.type === 'guidance' && typeof m.text === 'string') {
          if (this.running && m.text.trim().length > 0) {
            this.controller.sendGuidance(m.text);
            this.push({
              k: 'msg',
              cls: 'you',
              who: 'You',
              text: `[guide] ${m.text}`,
            });
          }
          return;
        }
        if (m.type === 'pause') {
          // D49bm: record the REQUEST. The button is not told the run is paused
          // here — only the loop's own park signal says that, because the loop
          // may never reach a safe point.
          this.pauseRequested = true;
          if (this.running) this.controller.pause();
          else this.pendingPause = true;
          return;
        }
        if (m.type === 'resume') {
          this.pauseRequested = false;
          // A click before the run started takes the request back with it.
          this.pendingPause = false;
          if (this.running) this.controller.resume();
          return;
        }
        // D49aw: the answer to a stuck card. "Keep going" carries whatever the
        // user typed, and their words go back into the conversation — the same
        // treatment the composer's own guidance gets.
        if (m.type === 'stuck-answer') {
          const resolve = this.pendingStuck;
          this.pendingStuck = null;
          const guidance = typeof m.guidance === 'string' ? m.guidance.trim() : '';
          const action = m.value === 'stop' ? 'stop' : 'continue';
          if (action === 'continue' && guidance.length > 0) {
            this.push({ k: 'msg', cls: 'you', who: 'You', text: `[guide] ${guidance}` });
          }
          resolve?.({
            action,
            ...(action === 'continue' && guidance.length > 0 ? { guidance } : {}),
          });
          return;
        }
        if (m.type === 'cancel') {
          if (this.running) {
            // D49bi: release the cards first, so cancel takes effect now. This is
            // the SAME code an observer's cancel runs — see `releaseParkedCards`.
            this.releaseParkedCards();
            this.controller.cancel();
          } else {
            // D49bm: the same window the pause can fall into, and worse if it is
            // lost — the user asked Plato to stop and it would start regardless.
            this.pendingCancel = true;
          }
          return;
        }
        if (m.type === 'openSettings') {
          this.ensureHomeWatch();
          void this.sendSettings(undefined, true);
          return;
        }
        if (m.type === 'openHistory') {
          this.sendHistory();
          return;
        }
        if (m.type === 'openRun' && typeof m.file === 'string') {
          this.openRun(m.file);
          return;
        }
        // D49ay: the only two ways a transcript is ever removed, and both are
        // the user asking. The sweep compresses and never deletes.
        if (m.type === 'deleteRun' && typeof m.file === 'string') {
          this.deleteRun(m.file);
          return;
        }
        if (m.type === 'deleteAllRuns') {
          this.deleteAllRuns();
          return;
        }
        if (m.type === 'resumeChat' && typeof m.id === 'string') {
          await this.resumeSession(m.id);
          return;
        }
        if (m.type === 'settings-add' && typeof m.connId === 'string') {
          try {
            // Auto-unique the derived id instead of erroring (D29 UX).
            let id = m.connId;
            const taken = new Set(rawUserConnections().map((u) => u.id.toLowerCase()));
            let n = 2;
            while (taken.has(id.toLowerCase())) {
              id = `${m.connId}-${n}`;
              n += 1;
            }
            const ok = await this.addConnection({
              id,
              kind: m.kind === 'anthropic' ? 'anthropic' : 'openai',
              baseUrl:
                typeof m.baseUrl === 'string' && m.baseUrl.length > 0
                  ? m.baseUrl
                  : undefined,
            });
            if (ok) {
              // Inline key from the form (D29c): transient pass-through.
              if (
                typeof m.apiKey === 'string' &&
                m.apiKey.trim().length > 0
              ) {
                await this.ctx.secrets.store(
                  `plato.providers.${id}.apiKey`,
                  m.apiKey.trim(),
                );
                if (id === 'anthropic') {
                  await this.ctx.secrets.store(LEGACY_KEY, m.apiKey.trim());
                }
                await this.fetchAndStoreModels(id);
              } else {
                void this.sendSettings(
                  'Connection added \u2014 use Set key to enable it.',
                );
              }
            }
          } catch (e) {
            void this.sendSettings(
              'Add failed \u2014 ' +
                (e instanceof Error ? e.message : String(e)),
            );
          }
          return;
        }
        if (m.type === 'settings-key' && typeof m.connId === 'string') {
          await this.promptForKey(m.connId);
          void this.sendSettings();
          return;
        }
        // D47l: the in-panel key path (the Set key button). Stores the key and
        // refreshes, mirroring the inline field in "Add a provider". The value
        // arrives once and is never echoed back to the webview.
        if (
          m.type === 'settings-set-key' &&
          typeof m.connId === 'string' &&
          typeof m.apiKey === 'string'
        ) {
          const key = m.apiKey.trim();
          if (key.length === 0) {
            void this.sendSettings('Key not saved \u2014 it was empty.');
            return;
          }
          await this.ctx.secrets.store(
            `plato.providers.${m.connId}.apiKey`,
            key,
          );
          if (m.connId === 'anthropic') {
            await this.ctx.secrets.store(LEGACY_KEY, key);
          }
          // The key may unblock the model list, so refresh it like Add does.
          void this.fetchAndStoreModels(m.connId);
          return;
        }
        // D49bz: the gear's switch. It writes the CONTRIBUTED setting, not a
        // second copy, and then re-pushes the payload so the switch shows what
        // was stored rather than what was clicked.
        if (m.type === 'settings-respect-gitignore') {
          await this.setRespectGitignore(m.value === true);
          return;
        }
        if (m.type === 'settings-fetch' && typeof m.connId === 'string') {
          void this.fetchAndStoreModels(m.connId);
          return;
        }
        if (m.type === 'settings-clear' && typeof m.connId === 'string') {
          await this.ctx.secrets.delete(
            `plato.providers.${m.connId}.apiKey`,
          );
          void this.sendSettings();
          return;
        }
        if (m.type === 'settings-delete' && typeof m.connId === 'string') {
          await vscode.workspace.getConfiguration('plato').update(
            'connections',
            rawUserConnections().filter((u) => u.id !== m.connId),
            vscode.ConfigurationTarget.Global,
          );
          void this.sendSettings();
          return;
        }
        if (
          m.type === 'set-default-model' &&
          typeof m.value === 'string'
        ) {
          await vscode.workspace.getConfiguration('plato').update(
            'model',
            m.value,
            vscode.ConfigurationTarget.Global,
          );
          this.modelOverride = null;
          void this.sendSettings();
          return;
        }
        if (m.type === 'set-reasoning' && typeof m.value === 'string') {
          await vscode.workspace.getConfiguration('plato').update(
            'reasoning',
            m.value,
            vscode.ConfigurationTarget.Global,
          );
          return;
        }
        // D49bc: the Protected files section. Add and remove only — the entries
        // themselves are validated in core, where the matcher is, so an entry
        // that could never match is refused with a reason instead of being saved
        // as a silent no-op.
        if (
          (m.type === 'secrets-add-name' || m.type === 'secrets-add-allow') &&
          typeof m.value === 'string'
        ) {
          const protect = m.type === 'secrets-add-name';
          const key = protect ? 'secrets.protect' : 'secrets.allow';
          const bad = protect ? protectNameError(m.value) : allowPathError(m.value);
          if (bad !== null) {
            void this.sendSettings(bad);
            return;
          }
          const value = m.value.trim();
          const next = this.secretSetting(key);
          if (!next.includes(value)) next.push(value);
          await this.setSecretSetting(key, next);
          return;
        }
        if (
          (m.type === 'secrets-remove-name' || m.type === 'secrets-remove-allow') &&
          typeof m.value === 'string'
        ) {
          const key = m.type === 'secrets-remove-name' ? 'secrets.protect' : 'secrets.allow';
          await this.setSecretSetting(
            key,
            this.secretSetting(key).filter((s) => s !== m.value),
          );
          return;
        }
        if (m.type === 'set-orchestration' && typeof m.mode === 'string') {
          const mode =
            m.mode === 'duo' || m.mode === 'academy' ? m.mode : 'solo';
          // D47: let the mode switch even when Academy has no ACADEMY.yaml —
          // the Academy block's council editor creates it on the first edit.
          // The run-time guard (run()) still blocks actually running Academy
          // without a council.
          await vscode.workspace
            .getConfiguration('plato')
            .update(
              'orchestration',
              mode,
              vscode.ConfigurationTarget.Global,
            );
          void this.sendSettings(
            `Orchestration: ${mode} — applies from the next run.`,
          );
          return;
        }
        // D47: the Settings editors persist the WHOLE model to yaml. Validate
        // by emitting + re-parsing so the error text matches the parsers'; an
        // invalid model never overwrites a good file. Missing file? The first
        // edit materializes it (edits create it).
        if (m.type === 'save-duo' && typeof m.philosopher === 'object' && m.philosopher !== null) {
          try {
            const raw = m.philosopher as Record<string, unknown>;
            const phil: DuoPhilosopher = {
              persona: typeof raw['persona'] === 'string' ? raw['persona'] : '',
            };
            if (typeof raw['name'] === 'string' && raw['name'].trim().length > 0) {
              phil.name = raw['name'].trim();
            }
            if (typeof raw['role'] === 'string' && raw['role'].trim().length > 0) {
              phil.role = raw['role'].trim();
            }
            if (typeof raw['model'] === 'string' && raw['model'].trim().length > 0) {
              phil.model = raw['model'].trim();
            }
            if (typeof raw['color'] === 'string' && raw['color'].trim().length > 0) {
              phil.color = raw['color'].trim();
            }
            if (typeof raw['pause'] === 'boolean') {
              phil.pause = raw['pause'];
            }
            if (typeof raw['cancel'] === 'boolean') {
              phil.cancel = raw['cancel'];
            }
            if (typeof raw['maxInterventions'] === 'number') {
              phil.maxInterventions = Math.max(0, Math.round(raw['maxInterventions']));
            }
            const body = emitDuoConfig({ philosopher: phil });
            parseDuoConfig(body); // loud: unknown persona / bad fields never write
            await this.writeHomeFile('DUO.yaml', body);
            this.ensureHomeWatch();
            void this.sendSettings('Duo philosopher saved — applies from the next run.');
          } catch (e) {
            void this.sendSettings(
              `DUO.yaml not saved — ${e instanceof Error ? e.message : 'error'}`,
            );
          }
          return;
        }
        if (m.type === 'save-academy' && Array.isArray(m.members)) {
          try {
            const members: TeamMember[] = (
              m.members as Record<string, unknown>[]
            ).map((raw) => {
              if (
                typeof raw['name'] !== 'string' ||
                typeof raw['model'] !== 'string'
              ) {
                throw new TeamConfigError('each member needs name and model');
              }
              const mem: TeamMember = {
                name: raw['name'].trim(),
                model: raw['model'].trim(),
                kind: 'philosopher',
              };
              if (typeof raw['role'] === 'string' && raw['role'].trim().length > 0) {
                mem.role = raw['role'].trim();
              }
              if (typeof raw['persona'] === 'string' && raw['persona'].trim().length > 0) {
                mem.persona = raw['persona'].trim();
              }
              if (typeof raw['color'] === 'string' && raw['color'].trim().length > 0) {
                mem.color = raw['color'].trim();
              }
              if (typeof raw['guidance'] === 'boolean') {
                mem.guidance = raw['guidance'];
              }
              if (typeof raw['pause'] === 'boolean') {
                mem.pause = raw['pause'];
              }
              if (typeof raw['cancel'] === 'boolean') {
                mem.cancel = raw['cancel'];
              }
              if (typeof raw['maxInterventions'] === 'number') {
                mem.maxInterventions = Math.max(0, Math.round(raw['maxInterventions']));
              }
              return mem;
            });
            const body = emitTeamConfig({
              name: typeof m.name === 'string' ? m.name.trim() : '',
              members,
            });
            parseTeamConfig(body); // exactly-one-worker / at-most-5 / model shape
            await this.writeHomeFile('ACADEMY.yaml', body);
            this.ensureHomeWatch();
            void this.sendSettings('Academy saved — applies from the next run.');
          } catch (e) {
            void this.sendSettings(
              `ACADEMY.yaml not saved — ${e instanceof Error ? e.message : 'error'}`,
            );
          }
          return;
        }
        if (m.type === 'open-duo') {
          const file = vscode.Uri.file(join(this.homePlatoDir(), 'DUO.yaml'));
          try {
            await vscode.workspace.fs.stat(file);
            void vscode.window.showTextDocument(file);
          } catch {
            // No file yet: Open materializes the built-in default so the
            // button always lands on a real, editable DUO.yaml (with the
            // persona's role text written out, not a bare persona stub).
            const dflt = defaultDuoPhilosopher();
            const persona = PERSONAS.find((p) => p.id === dflt.persona);
            try {
              const body = emitDuoConfig({
                philosopher: {
                  persona: dflt.persona,
                  name: persona ? persona.name : undefined,
                  role: persona ? persona.role : undefined,
                  pause: false,
                  cancel: false,
                  maxInterventions: 5,
                },
              });
              await this.writeHomeFile('DUO.yaml', body);
              this.ensureHomeWatch();
              void this.sendSettings();
              void vscode.window.showTextDocument(file);
            } catch (e) {
              void this.sendSettings(
                `DUO.yaml could not be created — ${
                  e instanceof Error ? e.message : 'error'
                }`,
              );
            }
          }
          return;
        }
        if (m.type === 'open-academy') {
          const file = vscode.Uri.file(join(this.homePlatoDir(), 'ACADEMY.yaml'));
          try {
            await vscode.workspace.fs.stat(file);
            void vscode.window.showTextDocument(file);
          } catch {
            // No file yet: Open materializes the starter council (Plato +
            // Aristotle + Pythagoras) so the button always lands on a real,
            // editable ACADEMY.yaml — parity with open-duo. D47d: at least
            // two philosophers by default.
            try {
              const body = emitTeamConfig({
                name: '',
                members: defaultAcademyMembers(this.effectiveModel()),
              });
              parseTeamConfig(body); // must satisfy exactly-one-worker etc.
              await this.writeHomeFile('ACADEMY.yaml', body);
              this.ensureHomeWatch();
              void this.sendSettings();
              void vscode.window.showTextDocument(file);
            } catch (e) {
              void this.sendSettings(
                `ACADEMY.yaml could not be created — ${
                  e instanceof Error ? e.message : 'error'
                }`,
              );
            }
          }
          return;
        }
        if (m.type === 'open-mcp') {
          const file = vscode.Uri.file(join(this.homePlatoDir(), 'mcp.json'));
          try {
            await vscode.workspace.fs.stat(file);
            void vscode.window.showTextDocument(file);
          } catch {
            // No file yet: Open materializes an empty mcpServers map so the
            // button always lands on a real, editable file. Unlike the council
            // there is no honest starter server to invent — the schema supplies
            // the field help instead of a commented example, which JSON cannot
            // carry.
            try {
              parseMcpConfig(EMPTY_MCP_CONFIG); // must re-read as a valid config
              await this.writeHomeFile('mcp.json', EMPTY_MCP_CONFIG);
              this.ensureHomeWatch();
              void this.sendSettings();
              void vscode.window.showTextDocument(file);
            } catch (e) {
              void this.sendSettings(
                `mcp.json could not be created — ${
                  e instanceof Error ? e.message : 'error'
                }`,
              );
            }
          }
          return;
        }
        if (
          m.type === 'set-mcp-disabled' &&
          typeof m.name === 'string' &&
          typeof m.disabled === 'boolean'
        ) {
          try {
            const file = vscode.Uri.file(join(this.homePlatoDir(), 'mcp.json'));
            const text = Buffer.from(
              await vscode.workspace.fs.readFile(file),
            ).toString('utf8');
            const body = withServerDisabled(text, m.name, m.disabled);
            parseMcpConfig(body); // never write what will not read back
            await this.writeHomeFile('mcp.json', body);
            this.ensureHomeWatch();
            // D49bt: same wording as the council — a toggle mid-run must not
            // imply it changed the run already going.
            void this.sendSettings(
              `${m.name} ${m.disabled ? 'disabled' : 'enabled'} — applies from the next run.`,
            );
          } catch (e) {
            void this.sendSettings(
              `mcp.json not saved — ${
                e instanceof Error ? e.message : 'error'
              }`,
            );
          }
          return;
        }
        // D45a-3: open-or-create PLATO.md (Settings row and the empty-composer
        // card both land here). Project files always join when present — the
        // includeProjectRules opt-out was removed (file presence is the switch).
        // The from:'settings' sender stays on the Settings page and wants a
        // flash there; the empty card / /system-prompt get a chat notice.
        if (m.type === 'plato-open') {
          await this.openPlato(m.from === 'settings' ? 'settings' : 'chat');
          return;
        }
        // D45a-2: the webview asks once when its empty state appears whether
        // any project rule file exists (drives the secondary empty card).
        if (m.type === 'proj-files') {
          const root = this.workspaceRoot();
          const present =
            root !== null &&
            ((await this.existsAt(root, 'PLATO.md')) ||
              (await this.existsAt(root, 'AGENTS.md')) ||
              (await this.existsAt(root, 'CLAUDE.md')));
          void this.panel.webview.postMessage({
            type: 'proj-files',
            noRoot: root === null,
            present,
          });
          return;
        }
        // D44d: compaction is always auto at the threshold — Manual is gone.
        // The threshold slider posts set-compaction-threshold; the Compact
        // button posts request-compact (force the live run). Both share the
        // run-side state.
        if (
          m.type === 'set-compaction-threshold' &&
          typeof m.value === 'number'
        ) {
          // Clamp to the same range the loop uses; the settings page
          // also enforces this via the slider.
          const t = Math.max(0.5, Math.min(0.95, m.value));
          await vscode.workspace.getConfiguration('plato').update(
            'compaction.threshold',
            t,
            vscode.ConfigurationTarget.Global,
          );
          this.postModelState();
          return;
        }
        if (m.type === 'request-compact') {
          // Mid-run: force the live run to compact. Idle: fold the older
          // turns into a summary (same as /compact).
          if (this.running) {
            this.requestCompactNow();
          } else {
            await this.foldNow();
          }
          return;
        }
        if (m.type === 'user-answer' && Array.isArray(m.answers)) {
          const resolve = this.pendingQuestion;
          // A reloaded transcript can leave an old card clickable, and this used
          // to be harmless: the answer went nowhere. It is not harmless any more,
          // because the echo below would write an exchange into the log that
          // never happened — so an answer with nothing pending is dropped.
          if (resolve === null) return;
          this.pendingQuestion = null;
          this.pendingQuestionCount = 0;
          const answers = m.answers.map(String);
          // D49bg: the question and the answer are part of the conversation, so
          // they go into the log rather than living only in the view. A reload
          // used to drop both, and a fold summarised a run in which the user
          // appeared to have said nothing at all — the same fault D49ag fixed for
          // tool rows. The wording matches the view's own echo exactly, so a
          // reloaded transcript reads like the live one.
          for (let i = 0; i < this.openQuestions.length; i += 1) {
            const q = this.openQuestions[i]!;
            this.push({
              k: 'msg',
              cls: 'you',
              who: 'You',
              text: `${q.question}: ${answers[i] ?? ''}`,
            });
          }
          this.openQuestions = [];
          this.push({ k: 'question-done' });
          resolve?.(answers);
          return;
        }
        // ---- D44a/D44c: paperclip attachment + real slash commands --------
        if (m.type === 'attach') {
          await this.openAttachmentPicker();
          return;
        }
        if (m.type === 'attach-remove' && typeof m.path === 'string') {
          this.pendingAttachments = this.pendingAttachments.filter(
            (p) => p !== m.path,
          );
          this.pendingImages = this.pendingImages.filter((p) => p !== m.path);
          return;
        }
        if (m.type === 'attach-clear') {
          this.pendingAttachments = [];
          this.pendingImages = [];
          return;
        }
        // D44c: real commands execute in the host — no text expansion.
        // D49bo: `text` carries what followed the command, which only /queue
        // reads today. The four older commands ignore it, exactly as before.
        if (m.type === 'slash-run' && typeof m.id === 'string') {
          await this.runCommand(m.id, typeof m.text === 'string' ? m.text : '');
          return;
        }
        if (m.type === 'queue-remove' && typeof m.index === 'number') {
          this.queue.splice(m.index, 1);
          this.postQueue();
          return;
        }
        // The user asking the held queue to continue. Only this clears the hold:
        // a cancel, a stuck run or a failure must not be quietly undone by the
        // next run that happens to end cleanly.
        if (m.type === 'queue-start') {
          this.queueHeld = false;
          this.postQueue();
          this.advanceQueue();
          return;
        }
        // D49ax: the undo card's two answers. No pending resolver is kept, so an
        // answer to a card the host is no longer showing is inert rather than
        // dangerous — the same rule the stuck card follows.
        if (m.type === 'undo-apply') {
          // D49ax's two levels: the whole request, or the single last write.
          this.applyUndoNow(m.scope === 'last' ? 'last' : 'request');
          return;
        }
        if (m.type === 'undo-dismiss') {
          void this.panel.webview.postMessage({ type: 'undo-done' });
          return;
        }
        // D49bc: the answer to the reveal card. Only `true` shows the file, so a
        // malformed message can never be read as consent.
        if (m.type === 'reveal-answer') {
          const resolve = this.pendingReveal;
          this.pendingReveal = null;
          resolve?.(m.allow === true);
          return;
        }
        if (m.type === 'ask' && typeof m.text === 'string') {
          // consume now
          const attach = this.pendingAttachments.splice(0);
          const images = this.pendingImages.splice(0);
          this.push({ k: 'msg', cls: 'you', who: 'You', text: m.text });
          this.startRun(m.text, { attach, images });
          return;
        }
        // The webview asks for the log once its script is live; posting
        // earlier races page load and the message is dropped.
        if (m.type === 'ready') {
          // Decorate bot entries with host-rendered markdown for the
          // restore path (D25a); raw text stays the stored truth.
          const decorated = this.log.map((e) =>
            e.k === 'msg' && e.cls === 'bot'
              ? { ...e, html: renderMarkdown(e.text) }
              : e,
          );
          this.postModelState();
          this.postSlashMeta();
          void panel.webview.postMessage({
            type: 'restore',
            log: decorated,
            hasConnections: readConnections().length > 0,
            model: this.effectiveModel(),
            title: this.chatTitle,
            // D49bj: the view cannot guess this one. It starts at its own
            // default (`edit`) and so would disagree with a stored mode on every
            // reload, which is how a choice made before the reload disappeared.
            mode: this.mode,
            // D49bo: the queue is host-authoritative, and this host can outlive
            // a webview reload — so the view is told what is waiting rather than
            // keeping its own copy that would drift.
            queue: this.queue,
            queueHeld: this.queueHeld,
          });
        }
      },
    );
  }

  /**
   * D49cb: the model's one sanctioned way to ask for a different mode.
   *
   * The change happens HERE and only after the card is answered, so the model
   * cannot switch anything — it can ask. The note is the tool result it reads:
   * a yes names the mode now in force, which is what ends the stale belief a
   * run otherwise carries until its next refused call.
   */
  private async requestMode(req: {
    mode: Mode;
    reason: string;
  }): Promise<{ ok: boolean; note: string }> {
    const from = this.mode;
    if (req.mode === from) {
      return { ok: false, note: `request_mode: Plato is already in ${from} mode.` };
    }
    if (this.pendingModeRequest !== null) {
      return { ok: false, note: 'request_mode: a mode request is already open. Wait for the user.' };
    }
    if (this.modeRequestsThisRun >= 3) {
      return {
        ok: false,
        note: 'request_mode: the user has answered three mode requests this run. Do not ask again; say in one sentence what you would do if the mode allowed it.',
      };
    }
    this.modeRequestsThisRun += 1;
    const allow = await this.askModeRequest({ mode: req.mode, reason: req.reason });
    this.runBus?.emit({
      type: 'mode-requested',
      runId: this.currentRunId,
      from,
      to: req.mode,
      approved: allow,
    });
    if (!allow) {
      // The card is gone; the conversation keeps the decision. Without this a
      // reload loses the fact that Plato asked at all.
      const declined = `Plato asked to switch to ${req.mode} — the user declined.`;
      this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: declined });
      // D49bz's rule: a notice that is persisted but never posted appears only
      // after a reload. The user must see the answer now.
      this.send('notice', declined);
      return {
        ok: false,
        note: `The user declined. Plato is still in ${from} mode. Do not ask again for ${req.mode} in this run; say in one sentence what you would do if it were permitted, and continue with what this mode allows.`,
      };
    }
    this.applyMode(req.mode, 'request');
    return {
      ok: true,
      note: `The user approved. Plato is now in ${this.mode} mode. Continue the task.`,
    };
  }

  /** Draws the mode card and resolves with the user's answer. */
  private askModeRequest(req: { mode: Mode; reason: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingModeRequest = resolve;
      // Recorded BEFORE the promise, as the question card's row is, so a reload
      // rebuilds the card the host is still waiting on.
      this.push({ k: 'mode-open', current: this.mode, mode: req.mode, reason: req.reason });
      void this.panel.webview.postMessage({
        type: 'mode-request',
        current: this.mode,
        mode: req.mode,
        reason: req.reason,
      });
    });
  }

  /**
   * D49cb: the one place the mode changes, whether the user picked it or
   * approved the model's request. Returns whether it actually changed.
   *
   * A click on the row already in force is NOT a switch, so it writes no line
   * and records no event — a record that invented a change would be worse than
   * a silent no-op.
   */
  private applyMode(next: Mode, via: 'picker' | 'request'): boolean {
    const from = this.mode;
    if (next === from) return false;
    this.mode = next;
    this.sessionWrites.clear();
    this.sessionApprovals.clear();
    // D49bj: the choice outlives the panel, as the model choice does.
    void this.ctx.workspaceState.update(MODE_KEY, next);
    // D49cb: a switch the MODEL asked for changes host state without a click in
    // this view, so the picker has to be told. Without this message the chip
    // still read `plan` while the permission table was `edit` — the same silent
    // disagreement D49bj removed for reloads, through a different door. A picker
    // click sends it too; setMode is idempotent, so the echo costs nothing.
    this.send('mode-state', next);
    // D49ca: the line says when the change takes effect. The mode is read at
    // every tool decision, so a live run picks it up at its next call — but a
    // card already on screen keeps its verdict, and an idle click starts
    // nothing. D49cb adds the third case: a request the user approved is a
    // different story from the user's own click, and the line says so.
    const live = this.runBus !== null && this.currentRunId !== '';
    const line = via === 'request'
      ? `Mode: ${next} — the user approved Plato's request.`
      : live
        ? `Mode: ${next} — applies from the next tool call.`
        : `Mode: ${next} — applies from your next message.`;
    // D49bj: the switch is part of the conversation's story, so it is WRITTEN
    // DOWN and not only shown. The same push-then-send pair the stuck nudge
    // uses: one line live, one on replay.
    this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: line });
    // D49ca: the run's own record is a structured event, not a notice. Between
    // runs the transcript does not exist yet, so the change waits for the next
    // one and is emitted after its header.
    const at = new Date().toISOString();
    if (live) {
      this.runBus?.emit({
        type: 'mode-changed',
        runId: this.currentRunId,
        from,
        to: next,
        at,
        via,
      });
    } else {
      this.pendingModeChanges.push({ from, to: next, at, via });
    }
    this.send('notice', line);
    return true;
  }

  private send(type: string, text?: unknown, meta?: Record<string, unknown>): void {
    try {
      void this.panel.webview.postMessage({
        type,
        text,
        // D47f: optional extras (e.g. a philosopher notice's colour) ride beside
        // `text` so existing handlers that read only `text` are unaffected.
        ...(meta ? { meta } : {}),
      });
    } catch {
      // D49bn: the panel can be GONE while the host still has things to say —
      // closing the tab is exactly when that happens, because the teardown sends
      // as it releases cards. Posting to a disposed webview throws, and letting
      // that escape abandons the teardown halfway: `dispose()` never reached its
      // `cancel()`, so the run it was stopping kept going. Found by field case
      // 28, which reported the run as `complete` while the panel-close notice sat
      // right there in the same transcript.
    }
  }

  // ---- D44a/D44c: paperclip attachment + real slash commands ------------

  private postSlashMeta(): void {
    // D49ba: the tool-word table travels with the menu, for the same reason — the
    // view is a plain script with no imports, and one table beats two.
    void this.panel.webview.postMessage({
      type: 'tool-words',
      words: toolWordsForView(),
    });
    void this.panel.webview.postMessage({
      type: 'slash-meta',
      commands: slashMenu(),
    });
  }

  private workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  /** D46: Plato's own home folder (`~/.plato`) — personal state + config, never committed. */
  private homePlatoDir(): string {
    return homePlatoDir();
  }

  /** D46: stable per-project key for invisible home state (transcripts). */
  private projectKey(root: string): string {
    return createHash('sha1').update(root).digest('hex').slice(0, 8);
  }

  /** Stat-only existence probe — never reads a body (a giant PLATO.md must not be slurped). */
  private async existsAt(root: string, rel: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(vscode.Uri.file(root), rel));
      return true;
    } catch {
      return false;
    }
  }

  /** Stat-only probe for an absolute path (home files, e.g. ~/.plato/PLATO.md). */
  private async existsAbs(absPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
      return true;
    } catch {
      return false;
    }
  }

  /** D47: atomic writer for Plato's home config files (creates ~/.plato). */
  private async writeHomeFile(name: string, body: string): Promise<void> {
    const dir = this.homePlatoDir();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(join(dir, name)),
      Buffer.from(body, 'utf8'),
    );
    this.lastHomeWrite = Date.now();
  }

  /**
   * D47: live yaml→UI sync — the raw-yaml surface is "Open file, edit there",
   * so a watcher on the two config files re-reads + re-pushes the Settings
   * state whenever the file changes externally. Armed lazily (idempotent),
   * only once ~/.plato exists (a save creates it, then arms); disposed with
   * the panel. Events within 500ms of our own write are the save echo.
   */
  private ensureHomeWatch(): void {
    if (this.homeWatchers.length > 0) {
      return;
    }
    const dir = this.homePlatoDir();
    const arm = () => {
      if (this.homeWatchers.length > 0) {
        return;
      }
      const refresh = () => {
        if (Date.now() - this.lastHomeWrite < 500) {
          return;
        }
        void this.sendSettings();
      };
      for (const name of ['DUO.yaml', 'ACADEMY.yaml', 'mcp.json']) {
        const w = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(dir), name),
        );
        w.onDidChange(refresh);
        w.onDidCreate(refresh);
        w.onDidDelete(refresh);
        this.homeWatchers.push(w);
      }
    };
    void vscode.workspace.fs.stat(vscode.Uri.file(dir)).then(
      arm,
      () => { /* no ~/.plato yet — the first save creates it, then arms */ },
    );
  }

  /**
   * D46: read-only project-file state for the Settings → Orchestration worker
   * block. Stat-only. `plato` reports which PLATO.md layer is in effect:
   * project file, the global ~/.plato default, or the bundled default.
   */
  private async workersState(): Promise<{
    noRoot: boolean;
    plato: 'project' | 'global' | 'default';
    agentsFile: 'AGENTS.md' | 'CLAUDE.md' | null;
  }> {
    const root = this.workspaceRoot();
    if (root === null) {
      return { noRoot: true, plato: 'default', agentsFile: null };
    }
    const plato = (await this.existsAt(root, 'PLATO.md'))
      ? 'project'
      : (await this.existsAbs(join(this.homePlatoDir(), 'PLATO.md')))
        ? 'global'
        : 'default';
    const agentsFile = (await this.existsAt(root, 'AGENTS.md'))
      ? 'AGENTS.md'
      : (await this.existsAt(root, 'CLAUDE.md'))
        ? 'CLAUDE.md'
        : null;
    return { noRoot: false, plato, agentsFile };
  }

  /**
   * D45a-2: the single open-or-create action behind /system-prompt, the
   * Settings → Workers row, and the empty-composer card. Opens PLATO.md when
   * it exists; otherwise materializes it from the bundled default so the
   * operator's on-disk copy starts exactly where the shipped in-memory role
   * leaves off. AGENTS.md / CLAUDE.md are never written.
   */
  private async openPlato(feedback: 'settings' | 'chat'): Promise<void> {
    const root = this.workspaceRoot();
    if (root === null) {
      this.send('notice', 'Open a workspace folder before using /system-prompt.');
      return;
    }
    const file = vscode.Uri.joinPath(vscode.Uri.file(root), 'PLATO.md');
    let created = false;
    try {
      await vscode.workspace.fs.stat(file);
    } catch {
      try {
        await vscode.workspace.fs.writeFile(
          file,
          Buffer.from(DEFAULT_PLATO_BODY, 'utf8'),
        );
        created = true;
      } catch (e) {
        const why = e instanceof Error ? e.message : 'error';
        if (feedback === 'settings') {
          void this.sendSettings(`Could not create PLATO.md — ${why}`);
        } else {
          this.send('error', `Could not create PLATO.md — ${why}`);
        }
        return;
      }
    }
    if (created) {
      if (feedback === 'settings') {
        void this.sendSettings(
          'PLATO.md created from the bundled default — edit it to tune the worker prompt.',
        );
      } else {
        this.send(
          'notice',
          'Created PLATO.md from the bundled default — edit it to tune the worker prompt. It joins your AGENTS.md/CLAUDE.md, which stay yours.',
        );
      }
    }
    void vscode.window.showTextDocument(file);
  }

  /** True when `raw` resolves to a root-relative path inside `root`. */
  private relWithinRoot(root: string, raw: string): string | null {
    const absolute = raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw);
    let rel: string;
    if (absolute) {
      rel = relative(root, raw);
      // relative() yields '../…' or an absolute path when outside the root.
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    } else {
      rel = raw;
      if (rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) return null;
    }
    return rel;
  }

  /**
   * Validate + collect attached files. The deny-list and caps are checked at
   * attach time so refusals surface immediately; content is re-read at send.
   */
  private async attachFiles(
    root: string,
    paths: string[],
  ): Promise<{
    accepted: { path: string; image?: boolean; size?: number }[];
    rejected: { path: string; error: string }[];
  }> {
    const accepted: { path: string; image?: boolean; size?: number }[] = [];
    const rejected: { path: string; error: string }[] = [];
    for (const raw of paths) {
      const rel = this.relWithinRoot(root, raw);
      if (rel === null) {
        rejected.push({ path: raw, error: 'outside the workspace' });
        continue;
      }
      if (isSecretPath(rel)) {
        rejected.push({ path: rel, error: 'on the secret deny-list' });
        continue;
      }
      if (this.pendingAttachments.includes(rel)) continue; // already attached
      if (this.pendingImages.includes(rel)) continue;

      // D49o: validated HERE, not at send time, so a bad image is refused while
      // the user is still looking at the picker. The bytes are re-read at send,
      // which is what the text attachments already do.
      if (looksLikeImage(rel)) {
        if (
          this.pendingAttachments.length + this.pendingImages.length >=
          MAX_ATTACH_FILES
        ) {
          rejected.push({
            path: rel,
            error: `over the ${MAX_ATTACH_FILES}-file cap`,
          });
          continue;
        }
        const img = await loadImageAttachment(rel, root, MAX_IMAGE_BYTES);
        if (!img.ok) {
          // Offered as an image, so it must BE one. No silent fall back to the
          // text path — that would attach a corrupt PNG as mojibake.
          rejected.push({ path: rel, error: img.reason });
          continue;
        }
        this.pendingImages.push(rel);
        accepted.push({ path: rel, image: true, size: img.image.bytes });
        continue;
      }

      const r = await loadProjectFile(rel, root, MAX_ATTACH_BYTES);
      if (!r.found) {
        const why =
          r.source === 'too-big'
            ? 'larger than 200 KB'
            : r.source === 'missing'
              ? 'file not found'
              : r.source === 'io'
                ? r.error
                : 'unreadable';
        rejected.push({ path: rel, error: why });
        continue;
      }
      if (this.pendingAttachments.length >= MAX_ATTACH_FILES) {
        rejected.push({ path: rel, error: `over the ${MAX_ATTACH_FILES}-file cap` });
        continue;
      }
      this.pendingAttachments.push(rel);
      accepted.push({ path: rel });
    }
    return { accepted, rejected };
  }

  /**
   * D49o: read the pending images fresh, as bytes. A file that has become
   * unreadable or unsupported since it was attached is skipped rather than
   * failing the run — the user asked for a reply, not for an error about a
   * screenshot.
   */
  private async loadRunImages(
    paths: string[],
    root: string,
  ): Promise<{ mime: ImageMime; data: string }[]> {
    const out: { mime: ImageMime; data: string }[] = [];
    for (const rel of paths) {
      const r = await loadImageAttachment(rel, root, MAX_IMAGE_BYTES);
      if (r.ok) out.push({ mime: r.image.mime, data: r.image.data });
    }
    return out;
  }

  private async openAttachmentPicker(): Promise<void> {
    const root = this.workspaceRoot();
    if (root === null) {
      this.send('error', 'Open a folder before attaching files.');
      return;
    }
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: 'Attach',
      defaultUri: vscode.Uri.file(root),
    });
    if (picks === undefined || picks.length === 0) return;
    const { accepted, rejected } = await this.attachFiles(
      root,
      picks.map((p) => p.fsPath),
    );
    void this.panel.webview.postMessage({ type: 'attach-result', accepted, rejected });
  }

  /** /compact and the ring's Compact-now share one force-compact path. */
  private requestCompactNow(): void {
    if (!this.running) {
      this.send('notice', 'No active run — a run must be in progress to compact.');
      return;
    }
    this.controller.requestCompact();
    this.send('notice', 'Plato will compact the conversation at the next safe point.');
  }

  /** D44c/D44d: dispatch a real command to its host action. */
  private async runCommand(id: string, text = ''): Promise<void> {
    if (slashCommand(id) === undefined) {
      this.send('notice', 'Unknown command: /' + id);
      return;
    }
    // D49bo: the only command that takes text. The message is held, not sent —
    // and when nothing is running there is nothing to wait for, so it goes at
    // once through the same advance path every other start uses.
    if (id === 'queue') {
      const msg = text.trim();
      if (msg.length === 0) {
        this.send(
          'notice',
          'Type the message you want to queue — /queue <message> — or put it in the box and pick Queue.',
        );
        return;
      }
      this.queue.push(msg);
      this.postQueue();
      this.advanceQueue();
      return;
    }
    if (id === 'compact') {
      // Mid-run /compact force-compacts the live run; idle it folds the
      // older turns of the conversation into a running summary.
      if (this.running) {
        this.requestCompactNow();
      } else {
        await this.foldNow();
      }
      return;
    }
    if (id === 'history') {
      await this.importHistory();
    }
    // D45a-2: /system-prompt opens the project's PLATO.md, creating it from
    // the bundled default when absent — the worker prompt is on the file.
    if (id === 'system-prompt') {
      await this.openPlato('chat');
    }
    if (id === 'undo') {
      this.offerUndo();
    }
  }

  /**
   * D49ax: work out what can be put back, and ask.
   *
   * Nothing is undone here. This reads the store and the workspace, draws what
   * the answer would be — including what it CANNOT do and why — and leaves the
   * decision to a click. A refusal is never silent: a run that half-undoes and
   * says nothing is how a user loses trust in the whole feature.
   */
  private offerUndo(): void {
    const dir = this.undoDir();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (dir === null || root === undefined) {
      this.send('notice', 'Open a folder before using /undo.');
      return;
    }
    const plan = planUndo(dir, root, 'request');
    if (plan === null) {
      this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: undoNothingText() });
      this.send('notice', undoNothingText());
      return;
    }
    // D49az: the narrower action's target, so its button can NAME the file.
    // "Just the last change" made the user work out both the scope and which file
    // it meant; a label with the path in it cannot be misread.
    const last = planUndo(dir, root, 'last');
    const lastRel = last !== null && last.restore.length === 1 ? last.restore[0]!.rel : null;
    const card = undoCard(plan, lastRel);
    if (card === null) {
      // Everything was refused. Say so now rather than drawing a card whose only
      // button would fail.
      this.settleUndo(plan, { id: plan.id, applied: [], failed: [], redoId: null });
      return;
    }
    // The row is written BEFORE the card is posted, so a reload rebuilds it —
    // the same rule every other card in this panel follows.
    this.push({ k: 'undo-open', ...card });
    void this.panel.webview.postMessage({ type: 'undo', ...card });
  }

  /**
   * The user confirmed. **The plan is made again, here, from the files as they
   * are now.**
   *
   * Holding the plan from the card would be the obvious thing and it is Kilo
   * Code's bug: the user reads the card, edits a file, clicks, and the old copy
   * goes back over their work. The card is a description of a moment; the guard
   * has to be evaluated at the moment the write happens. Anything that changed
   * in between is refused, and the report says so.
   */
  private applyUndoNow(scope: UndoScope): void {
    const dir = this.undoDir();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (dir === null || root === undefined) return;
    const plan = planUndo(dir, root, scope);
    if (plan === null) {
      this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: undoNothingText() });
      this.send('notice', undoNothingText());
      return;
    }
    this.settleUndo(plan, applyUndo(dir, root, plan));
    // Housekeeping straight after: an undo writes its redo into the same store,
    // so this is the moment its size is most likely to matter.
    this.sweepTranscripts();
  }

  /** The report, shared by the two paths above so they cannot drift apart. */
  private settleUndo(plan: UndoPlan, result: UndoResult): void {
    const text = undoResultText(plan, result, this.lastRequestCommands());
    this.push({ k: 'msg', cls: 'sys', who: 'Plato', text });
    this.push({ k: 'undo-done' });
    this.send('notice', text);
    void this.panel.webview.postMessage({ type: 'undo-done' });
  }

  /**
   * D49ax: the commands the last request ran, which undo cannot cover.
   *
   * Read from the log rather than remembered, so a reloaded window still names
   * them: the log is the record of what happened, and a caveat that vanishes on
   * reload is worse than no caveat. "The last request" is everything after the
   * user's most recent message.
   */
  private lastRequestCommands(): string[] {
    let start = 0;
    for (let i = this.log.length - 1; i >= 0; i -= 1) {
      const e = this.log[i];
      if (e !== undefined && e.k === 'msg' && e.cls === 'you') {
        start = i;
        break;
      }
    }
    const out: string[] = [];
    for (const e of this.log.slice(start)) {
      if (e.k === 'tool' && e.tool === 'shell' && e.digest !== undefined) {
        out.push(e.digest);
      }
    }
    return out;
  }

  /** /history: pick an archived chat and stage its transcript as context. */
  private async importHistory(): Promise<void> {
    const chats = this.sessions().filter((s) => s.id !== '__current__');
    if (chats.length === 0) {
      this.send('notice', 'No archived conversations yet.');
      return;
    }
    const items = chats.map((s) => {
      const when = new Date(s.ts);
      const whenLabel = Number.isNaN(when.getTime()) ? s.ts : when.toLocaleString();
      const msgs = s.log.filter((e) => e.k === 'msg').length;
      return {
        label: s.title && s.title.trim().length > 0 ? s.title : 'Untitled chat',
        description: whenLabel + ' · ' + msgs + ' messages',
        id: s.id,
      };
    });
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Import a past conversation as context',
      matchOnDescription: true,
    });
    if (pick === undefined) return;
    const chat = this.sessions().find((s) => s.id === pick.id);
    if (chat === undefined) return;
    this.pendingHistory = {
      title: pick.label,
      text: this.condenseTranscript(chat.log),
    };
    this.send(
      'notice',
      '[context: ' + pick.label + '] loaded — will accompany your next message.',
    );
  }

  /** Condense an archived log to role-prefixed text the model can read. */
  private condenseTranscript(log: Entry[]): string {
    // Keep the most recent messages (the tail of the conversation), newest
    // considered first but emitted oldest-first, until the char budget bites.
    const msgs = log.filter(
      (e): e is Extract<Entry, { k: 'msg' }> =>
        e.k === 'msg' && (e.cls === 'you' || e.cls === 'bot'),
    ).slice(-80);
    const lines: string[] = [];
    let chars = 0;
    const cap = 32_000;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const e = msgs[i];
      if (e === undefined) break;
      const line = (e.cls === 'you' ? '[user] ' : '[assistant] ') + e.text;
      if (chars + line.length > cap) break;
      lines.push(line);
      chars += line.length;
    }
    return lines.reverse().join('\n');
  }

  // ---- D44d: cross-message memory fold -----------------------------------

  /** Resolve connection + apiKey + model ref for an idle (fold) call. */
  private async resolveTurnTargets(): Promise<{
    conn: ConnectionConfig;
    apiKey: string;
    ref: string;
  } | null> {
    const ref = this.effectiveModel();
    const parts = splitModelRef(ref);
    const conn = parts
      ? readConnections().find((c) => c.id === parts.connectionId) ?? null
      : null;
    if (conn === null) return null;
    let apiKey = await this.ctx.secrets.get(`plato.providers.${conn.id}.apiKey`);
    if (!apiKey && conn.id === 'anthropic') {
      apiKey = await this.ctx.secrets.get(LEGACY_KEY);
    }
    return apiKey ? { conn, apiKey, ref } : null;
  }

  /** Index of the last compact entry in the log, or -1. */
  private lastCompactIndex(): number {
    return lastSummaryIndex(this.log);
  }

  /**
   * D49aa: apply the display cap, and leave a row saying what it cost. The cap
   * used to splice the front off in silence, which was survivable only while a
   * fold cleared the log often enough to keep it under the limit — with the fold
   * no longer deleting anything, this is the one place rows can still leave.
   */
  private recordTrim(max: number): void {
    const drop = this.log.length - max;
    if (drop <= 0) return;
    const gone = this.log.splice(0, drop);
    const lostSummary = gone.some((e) => e.k === 'compact');
    const head = this.log[0];
    if (head !== undefined && head.k === 'trim') {
      head.dropped += drop;
      head.lostSummary = head.lostSummary || lostSummary;
      return;
    }
    this.log.unshift({ k: 'trim', dropped: drop, lostSummary });
  }

  /** Number of raw you/bot pairs sitting after the last summary. */
  private tailPairCount(): number {
    return tailPairs(this.log);
  }

  /**
   * Fold the raw tail down to KEEP_AFTER_FOLD pairs: summarise everything older
   * (plus any prior summary) into a single compact entry, WRITTEN into the log.
   * The rows it accounts for stay where they are (D49aa) — a fold changes what
   * the model is sent, never what the user can read. Returns true on a fold.
   */
  private async foldTail(
    conn: ConnectionConfig,
    apiKey: string,
    ref: string,
  ): Promise<boolean> {
    const c = this.lastCompactIndex();
    const prior =
      c >= 0 && this.log[c]!.k === 'compact' ? this.log[c]!.text : null;
    const plan = planFold(this.log, KEEP_AFTER_FOLD);
    if (plan === null) return false;
    const older = plan.covered;
    // D49ag: the count the user is TOLD stays a count of exchanges. `covered`
    // now also carries the tool rows, and "Summary added for 47 earlier
    // messages" would be a lie when 40 of them were tool calls.
    const foldCount = older.filter(isMessageRow).length;

    // D49ag: the prompt is built in core, where it is tested — the shell has no
    // unit tests, and this is the half that decides whether a fold records the
    // work or only the model's narration of it.
    const prompt = buildFoldPrompt(prior, older);
    const provider = createProvider(conn.kind, {
      apiKey,
      baseUrl: conn.baseUrl,
    });
    const res = await provider.completeTurn({
      model: ref,
      system: COMPACT_SYSTEM_PROMPT,
      tools: [],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      maxTokens: compactMaxTokensFor(ref),
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .trim();
    if (text.length === 0) return false;

    // D49aa: the summary is WRITTEN, never swapped in. The rows it accounts for
    // stay in the log, so the transcript the user scrolls is unaffected by a
    // fold — and `historyFor` already treats the newest summary row as the
    // boundary of the model's memory. Clearing the log here is what deleted the
    // founder's conversation the moment a run ended.
    this.log = applyFold(
      this.log,
      plan,
      { k: 'compact', text } as Entry,
    );
    if (this.log.length > LOG_MAX) {
      this.recordTrim(LOG_MAX);
    }
    await this.ctx.workspaceState.update(LOG_KEY, this.log);
    // A fold grew the log: let the next archive snapshot it instead of being
    // skipped by the growth guard.
    this.archivedUpTo = 0;
    const decorated = this.log.map((e) =>
      e.k === 'msg' && e.cls === 'bot'
        ? { ...e, html: renderMarkdown(e.text) }
        : e,
    );
    void this.panel.webview.postMessage({
      type: 'restore',
      log: decorated,
      hasConnections: readConnections().length > 0,
      model: this.effectiveModel(),
      title: this.chatTitle,
    });
    // D49aa: the count is what it is, but the old wording — "Compacted N earlier
    // messages into a summary" — now describes something that did NOT happen: the
    // founder read it directly above the very messages it implied were gone.
    const label = foldCount === 1 ? 'message' : 'messages';
    this.send(
      'notice',
      'Summary added for ' + foldCount + ' earlier ' + label
        + '. Nothing was removed.',
    );
    return true;
  }

  /** /compact while idle: fold the tail, or say there is nothing to fold. */
  private async foldNow(): Promise<void> {
    if (this.folding) return;
    const targets = await this.resolveTurnTargets();
    if (targets === null) {
      this.send('notice', 'Connect a provider before compacting.');
      return;
    }
    this.folding = true;
    try {
      const folded = await this.foldTail(
        targets.conn,
        targets.apiKey,
        targets.ref,
      );
      if (!folded) {
        this.send('notice', 'Conversation is short — nothing to compact yet.');
      }
    } catch {
      this.send('notice', 'Compaction failed — try again in a moment.');
    } finally {
      this.folding = false;
    }
  }

  /**
   * After a run finishes, fold the tail once it outgrows AUTO_FOLD_AT pairs
   * (down to KEEP_AFTER_FOLD). Fire-and-forget: never runs while a run or an
   * approval/question is pending, and a failure is silently retried later.
   */
  private scheduleAutoFold(
    conn: ConnectionConfig,
    apiKey: string,
    ref: string,
  ): void {
    setTimeout(() => {
      void (async () => {
        if (this.running || this.folding) return;
        if (
          this.pendingApproval !== null ||
          this.pendingQuestion !== null ||
          this.pendingStuck !== null
        ) {
          return;
        }
        if (this.tailPairCount() < AUTO_FOLD_AT) return;
        this.folding = true;
        try {
          await this.foldTail(conn, apiKey, ref);
        } catch {
          // Leave the log untouched; the next completed run retries.
        } finally {
          this.folding = false;
        }
      })();
    }, 0);
  }

  /** The model-visible task: user text + attached files, read fresh. */
  private async buildModelTask(task: string, ctx: RunCtx, root: string): Promise<string> {
    let out = task;
    for (const rel of ctx.attach ?? []) {
      const r = await loadProjectFile(rel, root, MAX_ATTACH_BYTES);
      if (r.found) {
        out += '\n\n[attachment: ' + rel + ']\n```\n' + r.body + '\n```';
      }
    }
    return out;
  }

  // ---- Settings surface (D27) -------------------------------------------

  /**
   * D49bi: answer every card the run is parked on, so a cancel takes effect now.
   *
   * **Four cards park a run** — approval, question, stuck and reveal — and each
   * one holds a promise the loop is `await`ing with nothing else able to
   * interrupt it. Until this existed the release lived inline in the user's own
   * Cancel button, so **only the button could do it**: an observer in
   * `duo`/`academy` calling `cancel()` set the abort flag and left the run
   * parked on a card it could not answer. Both callers now run this, which is
   * the whole reason it is a method.
   *
   * The **undo** card is deliberately absent: it keeps no resolver, because it is
   * raised between runs rather than from inside one, so there is nothing to
   * release. Every answer given here is the SAFE one — a denial, a cancelled
   * answer, a stop, and a refusal to show a file — so releasing cannot approve
   * something the user never saw.
   *
   * Guarded per card rather than assumed, because both callers can arrive and the
   * second must be inert: each resolver is nulled before it is called, and the
   * log row is written only when a question was actually open.
   */
  private releaseParkedCards(): void {
    // Unblock a waiting approval, so cancel takes effect now.
    const r = this.pendingApproval;
    this.pendingApproval = null;
    r?.(false);
    // D49aq: and unblock a waiting QUESTION, which cancel used to miss. The loop
    // awaits the answer with nothing that can interrupt it, so with a question
    // card on screen Cancel did nothing at all — the run stayed blocked until the
    // user answered it, which is the one moment they are least likely to want to.
    // One answer per question, so the loop's per-question mapping does not read
    // `undefined`.
    const q = this.pendingQuestion;
    this.pendingQuestion = null;
    const n = this.pendingQuestionCount;
    this.pendingQuestionCount = 0;
    q?.(Array.from({ length: n }, () => CANCELLED_ANSWER));
    // D49bg: the card is closed in the LOG as well as on screen — but only when
    // one was open, or every ordinary cancel would add a row saying a question
    // had been closed that was never asked. No echo rows either: the user
    // answered nothing, and a row saying they did would be the transcript lying
    // about what happened.
    if (q !== null) {
      this.openQuestions = [];
      this.push({ k: 'question-done' });
    }
    this.send('question-done');
    // D49aw: the stuck card, for the same reason — the loop is parked on this
    // promise, and Cancel has to mean cancel.
    const s = this.pendingStuck;
    this.pendingStuck = null;
    s?.({ action: 'stop' });
    this.send('stuck-done');
    // D49bc: and the reveal card. The loop is parked on this one too, and "no" is
    // the safe answer — the file is not shown.
    const rv = this.pendingReveal;
    this.pendingReveal = null;
    rv?.(false);
    this.send('reveal-done');
    // D49cb: and the mode card. The loop is parked on it through `requestMode`,
    // and "no" is the safe answer — the permission table does not change.
    const mr = this.pendingModeRequest;
    this.pendingModeRequest = null;
    if (mr !== null) this.push({ k: 'mode-done' });
    mr?.(false);
    this.send('mode-request-done');
  }

  /** D34: ask_user — posts stacked question cards (one per question). */
  private askUser(req: { questions: AskQuestion[] }): Promise<string[]> {
    // D49bg: the row is written BEFORE the promise, as the stuck card's is, so a
    // reload rebuilds the card the host is still waiting on.
    this.push({ k: 'question-open', questions: req.questions });
    this.openQuestions = req.questions;
    return new Promise((resolve) => {
      this.pendingQuestion = resolve;
      // D49aq: remembered so a cancel can resolve with one answer per question.
      this.pendingQuestionCount = req.questions.length;
      void this.panel.webview.postMessage({
        type: 'user-question',
        questions: req.questions,
      });
    });
  }
  /**
   * D49v: `open` marks the payload sent IN REPLY TO a request to see Settings.
   * Every other settings payload is a background refresh, and the webview must
   * not move the view for one — the host sends them after any connection
   * change, including a model fetch that lands a network round trip after the
   * user has already gone back to the chat.
   */
  /**
   * D49bz: writes the .gitignore switch to the target that already holds a
   * value — the folder or workspace override if there is one, otherwise the
   * user settings. Writing Global while a workspace override exists would
   * change nothing visible and read as a broken switch.
   */
  private async setRespectGitignore(value: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('plato');
    const current = cfg.inspect<boolean>('search.respectGitignore');
    const hasFolder = (vscode.workspace.workspaceFolders ?? []).length > 0;
    const target =
      current?.workspaceFolderValue !== undefined && hasFolder
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : current?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
    // `update` resolving is not the configuration having changed: a payload
    // built immediately afterwards can still read the old value, and the switch
    // then re-renders in the state the user just clicked away from. Wait for the
    // change event (bounded) before the panel re-reads.
    const applied = new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      };
      const sub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('plato.search.respectGitignore')) done();
      });
      const timer = setTimeout(done, 1000);
    });
    try {
      await cfg.update('search.respectGitignore', value, target);
    } catch (e) {
      void this.sendSettings(
        'Could not save the search setting — ' +
          (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    await applied;
    void this.sendSettings();
  }

  private async sendSettings(flash?: string, open = false): Promise<void> {
    const userRaw = new Set(rawUserConnections().map((u) => u.id));
    const connections = [];
    for (const c of readConnections()) {
      const keyStatus =
        (await this.ctx.secrets.get(`plato.providers.${c.id}.apiKey`)) !==
        undefined
          ? 'set'
          : 'missing';
      // D49t: the per-model context windows, so the Settings list can show them
      // as a subtitle. Resolved through the SAME rule as the run and the
      // composer picker, so no two surfaces can quote different numbers. Only
      // models with a known window appear; absence is what makes the UI say
      // "context unknown" instead of inventing a figure.
      const poolByName = new Map(
        (c.pool ?? []).map((p) => [p.id, p] as const),
      );
      const ctx: Record<string, number> = {};
      // D49z: one offered list, the same one the run and the composer picker
      // see. It was two fields — a ticked subset and the fetched pool — until
      // the tick boxes went.
      const offered = resolveOfferedModels(c.allModels, c.models);
      for (const mid of offered) {
        const n = resolveMaxContext(poolByName.get(mid)?.maxContext);
        if (n !== null) ctx[mid] = n;
      }
      connections.push({
        id: c.id,
        kind: c.kind,
        baseUrl: c.baseUrl ?? '',
        models: offered,
        ctx,
        keyStatus,
        builtin: !userRaw.has(c.id),
      });
    }
    void this.panel.webview.postMessage({
      type: 'settings',
      open,
      connections,
      defaultModel: this.effectiveModel(),
      modelItems: this.modelItems(),
      reasoning: vscode.workspace
        .getConfiguration('plato')
        .get<string>('reasoning', 'off'),
      // D49bz: the same value the Settings editor shows, so the gear's switch
      // and the editor's checkbox can never disagree — one setting, two doors.
      respectGitignore: vscode.workspace
        .getConfiguration('plato')
        .get<boolean>('search.respectGitignore', false),
      presets: PROVIDER_PRESETS.map((p) => ({
        value: p.id,
        label: p.label,
        kind: p.kind,
        baseUrl: p.baseUrl,
      })),
      orchestration: {
        mode: vscode.workspace
          .getConfiguration('plato')
          .get<'solo' | 'duo' | 'academy'>('orchestration', 'solo'),
        personas: PERSONAS.map((p) => ({
          id: p.id,
          name: p.name,
          epithet: p.epithet,
          role: p.role,
        })),
        // D47f: the philosopher colour palette. The webview is a plain
        // template literal with no imports, so the ids + hexes ride along.
        colors: PHILOSOPHER_COLORS.map((c) => ({ id: c.id, hex: c.hex })),
        // D47g: the role cap, for the same reason — the parser enforces it,
        // and the box mirrors it with maxlength.
        roleMaxChars: ROLE_MAX_CHARS,
        duo: this.duoStatus(),
        academy: this.academyStatus(),
      },
      workers: await this.workersState(),
      // D49bc: the protected-file lists, so the panel can show and edit them
      // (D45c — a knob that exists only in settings.json is not discoverable).
      // The built-in names ride along to be SHOWN and not edited: removing
      // `.env` everywhere is a silent hole, so the deliberate way to unprotect
      // one is a path on the allow list, where the user can see which file they
      // meant.
      secrets: {
        builtin: [...SECRET_DENYLIST],
        extra: this.secretSetting('secrets.protect'),
        allow: this.secretSetting('secrets.allow'),
      },
      // D49bt: MCP configuration + the last run's outcome. A sibling of
      // `secrets`, deliberately NOT inside `orchestration` — that object is the
      // Duo/Academy block and putting MCP there would say it is staff.
      mcp: this.mcpStatus(),
      ...(flash ? { flash } : {}),
    });
    this.postModelState();
  }

  /** True when the effective model supports reasoning (D28 phase 2). */
  private reasoningCapable(): boolean {
    const parts = splitModelRef(this.effectiveModel());
    return parts ? modelSupportsReasoning(parts.model) : false;
  }

  /** Done-card extras for philosopher health (D33+): unparseable/degraded. */
  private obsExtras(
    observers: { agent: ObserverAgent; name: string }[],
  ): string {
    const parts: string[] = [];
    const unparseable = observers.reduce((s, o) => s + o.agent.parseErrors, 0);
    const degraded = observers.reduce((s, o) => s + o.agent.degraded, 0);
    // Philosopher cost metering (D33+): priced via the model catalog.
    const cost = observers.reduce((s, o) => s + o.agent.costUsd, 0);
    if (unparseable > 0) {
      parts.push(`${unparseable} unparseable`);
    }
    if (degraded > 0) {
      parts.push(`${degraded} tier-blocked`);
    }
    if (cost > 0) {
      parts.push(`\u2248$${cost.toFixed(4)} watching`);
    }
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
  }

  /**
   * D47: Duo state for the Settings editor + header chip. A missing file is
   * NOT an error — the form pre-fills from the built-in default and the first
   * edit materializes ~/.plato/DUO.yaml (edits create it). A present-but-
   * broken file surfaces its parse error and the form pre-fills defaults so
   * the next edit repairs it.
   */
  private duoStatus(): {
    source: 'file' | 'default';
    name: string;
    error: string;
    philosopher: {
      persona: string;
      name: string;
      role: string;
      model: string;
      color: string;
      pause: boolean;
      cancel: boolean;
      maxInterventions: number;
    };
  } {
    let cfg: ReturnType<typeof loadDuoConfig> = null;
    let source: 'file' | 'default' = 'default';
    let error = '';
    try {
      cfg = loadDuoConfig(this.homePlatoDir());
      if (cfg !== null) {
        source = 'file';
      }
    } catch (e) {
      source = 'file'; // the file exists but does not parse
      error = e instanceof Error ? e.message : 'error';
    }
    const raw = cfg !== null ? cfg.philosopher : defaultDuoPhilosopher();
    return {
      source,
      name: duoObserverSpec(raw, '').name,
      error,
      philosopher: {
        persona: raw.persona,
        name: raw.name ?? '',
        role: raw.role ?? '',
        model: raw.model ?? '',
        color: raw.color ?? '',
        pause: raw.pause ?? false,
        cancel: raw.cancel ?? false,
        maxInterventions: raw.maxInterventions ?? 5,
      },
    };
  }

  /** Academy state for the Settings editor (D47): full member detail. */
  private academyStatus(): {
    available: boolean;
    name: string;
    members: {
      name: string;
      kind: string;
      model: string;
      role?: string;
      persona?: string;
      color?: string;
      guidance?: boolean;
      pause?: boolean;
      cancel?: boolean;
      maxInterventions?: number;
    }[];
    error: string;
  } {
    try {
      const team = loadTeamConfig(this.homePlatoDir());
      if (team === null) {
        // Missing file is not an error: the Settings editor pre-seeds a
        // council and the first change creates the file.
        return {
          available: false,
          name: '',
          members: [],
          error: '',
        };
      }
      return {
        available: true,
        name: team.name,
        members: team.members.map((m) => ({
          name: m.name,
          kind: m.kind,
          model: m.model,
          role: m.role ?? '',
          persona: m.persona ?? '',
          color: m.color ?? '',
          guidance: m.guidance ?? true,
          pause: m.pause ?? false,
          cancel: m.cancel ?? false,
          maxInterventions: m.maxInterventions ?? 5,
        })),
        error: '',
      };
    } catch (e) {
      return {
        available: false,
        name: '',
        members: [],
        error: e instanceof Error ? e.message : 'error',
      };
    }
  }

  /**
   * MCP state for the Settings section (D49bt). Mirrors `academyStatus`'s
   * contract exactly: a missing file is NOT an error, a malformed one is.
   *
   * This reports CONFIGURATION plus the outcome of the last run. It deliberately
   * does not start servers — `sendSettings` is not a once-per-open call (it fires
   * on every connection change, model fetch and home-file watcher event), and
   * `McpServer.start` spawns a child process from the user's own config with a
   * 20-second handshake. Rendering a settings page must not execute the user's
   * configured commands, repeatedly, or block on a hung one.
   *
   * `tools: null` is "has not run yet" and `0` is "ran and exposed nothing" —
   * the two are different facts and the panel says so.
   */
  private mcpStatus(): {
    available: boolean;
    servers: {
      name: string;
      disabled: boolean;
      tools: number | null;
      error: string;
    }[];
    error: string;
  } {
    try {
      const cfg = loadMcpConfig(this.homePlatoDir());
      const names = Object.keys(cfg);
      if (names.length === 0) {
        // No file, and an empty file, are the same thing to a user: none
        // configured. Neither is an error.
        return { available: false, servers: [], error: '' };
      }
      return {
        available: true,
        servers: names.map((name) => ({
          name,
          disabled: cfg[name]?.disabled === true,
          tools: this.mcpLastRun.get(name)?.tools ?? null,
          error: this.mcpLastRun.get(name)?.error ?? '',
        })),
        error: '',
      };
    } catch (e) {
      return {
        available: false,
        servers: [],
        error: e instanceof Error ? e.message : 'error',
      };
    }
  }

  /** Posts grouped dropdown + reasoning state in one payload. */
  private postModelState(): void {
    void this.panel.webview.postMessage({
      type: 'models',
      // D43: the webview toggles its empty-composer state from this.
      hasConnections: readConnections().length > 0,
      items: this.modelItems(),
      // D47h: the authoritative model, so the panel cannot drift from what a
      // run would actually use (the composer picker and the Duo/Academy doer
      // rows are all views of this one value).
      effectiveModel: this.effectiveModel(),
      reasoningCapable: this.reasoningCapable(),
      reasoning: vscode.workspace
        .getConfiguration('plato')
        .get<string>('reasoning', 'off'),
      orchestration: vscode.workspace
        .getConfiguration('plato')
        .get<'solo' | 'duo' | 'academy'>('orchestration', 'solo'),
      duo: this.duoStatus(),
      academy: this.academyStatus(),
      // D37: live context UI state.
      compaction: this.compactionState(),
    });
  }

  /**
   * D37: shape used by the webview header pill + settings slider.
   * `mode` defaults to auto so first-time users get the safe default;
   * `threshold` is clamped to [0.5, 0.95] in the loop itself.
   */
  /** D44d: compaction is always auto at the threshold (Manual is gone). */
  private compactionState(): { mode: 'auto' | 'manual'; threshold: number } {
    const cfg = vscode.workspace.getConfiguration('plato');
    const threshold = cfg.get<number>('compaction.threshold', 0.8);
    return {
      mode: 'auto',
      threshold: typeof threshold === 'number' && Number.isFinite(threshold)
        ? threshold
        : 0.8,
    };
  }

  private async addConnection(c: ConnectionConfig): Promise<boolean> {
    if (!/^[a-z0-9_-]+$/i.test(c.id)) {
      this.send('error', 'Connection id may use letters, numbers, - and _ only.');
      return false;
    }
    const user = rawUserConnections();
    if (user.some((u) => u.id.toLowerCase() === c.id.toLowerCase())) {
      this.send('error', `Connection "${c.id}" already exists.`);
      return false;
    }
    user.push(c);
    await vscode.workspace.getConfiguration('plato').update(
      'connections',
      user,
      vscode.ConfigurationTarget.Global,
    );
    return true;
  }

  /** Live model discovery (D28): GET /models, store ids on the profile. */
  private async fetchAndStoreModels(connId: string): Promise<void> {
    const conn = readConnections().find((c) => c.id === connId);
    if (!conn) {
      this.send('error', `Unknown connection "${connId}".`);
      return;
    }
    let apiKey = await this.ctx.secrets.get(
      `plato.providers.${conn.id}.apiKey`,
    );
    if (!apiKey && conn.id === 'anthropic') {
      apiKey = await this.ctx.secrets.get(LEGACY_KEY);
    }
    if (!apiKey) {
      void this.sendSettings(
        'Set the API key first (\u25CB missing), then Fetch models.',
      );
      return;
    }
    try {
      const pool = await fetchModelPool({
        kind: conn.kind,
        apiKey,
        baseUrl:
          conn.kind === 'openai'
            ? conn.baseUrl ?? 'https://api.openai.com/v1'
            : conn.baseUrl ?? undefined,
      });
      const ids = pool.map((p) => p.id);
      const user = rawUserConnections();
      let entry = user.find((u) => u.id === connId);
      if (!entry) {
        entry = { id: connId, kind: conn.kind };
        user.push(entry);
      }
      entry.models = ids;
      entry.allModels = ids; // full pool; selection edits never shrink it
      // D37: persist the rich pool too so the UI can show each model's
      // context window without re-fetching.
      entry.pool = pool.map((p) => {
        const e: ConnectionPoolEntry = { id: p.id };
        if (p.maxContext !== undefined) {
          e.maxContext = p.maxContext;
        }
        if (p.maxOutput !== undefined) {
          e.maxOutput = p.maxOutput;
        }
        return e;
      });
      await vscode.workspace.getConfiguration('plato').update(
        'connections',
        user,
        vscode.ConfigurationTarget.Global,
      );
      void this.sendSettings(`Found ${ids.length} models for ${connId}.`);
    } catch (e) {
      void this.sendSettings(
        'Fetch failed \u2014 ' +
          (e instanceof Error ? e.message : 'unknown error'),
      );
    }
  }

  private sessions(): StoredChat[] {
    return this.ctx.workspaceState.get<StoredChat[]>(SESSIONS_KEY, []);
  }

  /** Archives the current conversation (called before New Chat clears). */
  private async archiveCurrentChat(): Promise<void> {
    const msgs = this.log.filter((e) => e.k === 'msg');
    if (msgs.length === 0) {
      return;
    }
    // D41: skip when nothing new was said since the last archive —
    // closing and reopening the same conversation must not stack
    // duplicate history snapshots.
    if (this.log.length <= this.archivedUpTo) {
      return;
    }
    const first = msgs.find((e) => e.k === 'msg' && e.cls === 'you');
    const sessions = this.sessions();
    sessions.unshift({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      // D40: the model-generated / user-renamed title wins; the first
      // user message is only the fallback.
      title:
        this.chatTitle ||
        ((first && first.k === 'msg' ? first.text : '') || 'Chat').slice(0, 80),
      ts: new Date().toISOString(),
      log: [...this.log],
    });
    await this.ctx.workspaceState.update(
      SESSIONS_KEY,
      sessions.slice(0, SESSIONS_MAX),
    );
    this.archivedUpTo = this.log.length;
  }

  /**
   * D49bq: open a stored conversation in the panel.
   *
   * Shared by the webview's History list and the activity-bar launcher, which is
   * why it is a method rather than inline in the message handler.
   *
   * The run guard is new here, and it is new because the sidebar made this
   * reachable in a state the webview never offered it in: replacing the log
   * under a live run feeds the model a different conversation, while the run's
   * own events keep landing in the panel. Refusing is the only honest answer.
   */
  async resumeSession(id: string): Promise<void> {
    if (this.running) {
      this.send(
        'notice',
        'A run is active — wait for it to finish before opening another conversation.',
      );
      return;
    }
    const s = this.sessions().find((x) => x.id === id);
    if (!s) {
      return;
    }
    this.log.length = 0;
    this.log.push(...s.log.slice(-LOG_MAX));
    await this.ctx.workspaceState.update(LOG_KEY, this.log);
    // D40: resuming adopts the archived session's title.
    this.chatTitle = s.title || '';
    await this.ctx.workspaceState.update(TITLE_KEY, this.chatTitle);
    // D41: the resumed content is already in History — only
    // messages sent from here on should archive again.
    this.archivedUpTo = this.log.length;
    const decorated = this.log.map((e) =>
      e.k === 'msg' && e.cls === 'bot' ? { ...e, html: renderMarkdown(e.text) } : e,
    );
    void this.panel.webview.postMessage({
      type: 'restore',
      log: decorated,
      hasConnections: readConnections().length > 0,
      model: this.effectiveModel(),
      title: this.chatTitle,
    });
    this.postModelState();
  }

  /**
   * D41: archive the conversation when the panel closes, so History
   * lists past chats even without an explicit New Chat. The log itself
   * stays persisted, so reopening the panel continues the conversation.
   */
  async dispose(): Promise<void> {
    // D49bn: the panel is the run's only supervisor — the buttons, the cards and
    // the log all live in it. Closing it used to leave the run going with
    // nothing able to see or stop it: it kept calling tools and writing files,
    // and the first write in `edit` parked on a card nobody could answer, for
    // good. Closing the panel now stops the run.
    this.disposed = true;
    if (this.running) {
      // `releaseParkedCards` first, exactly as the Cancel button does: the loop
      // is parked on a promise that only an answer can resolve.
      this.releaseParkedCards();
      this.controller.cancel();
    }
    // The record of WHY is written by the run itself, in its `finally` — see the
    // note there. From here it cannot be: a run still being prepared has no bus
    // yet, and a bus notice emitted before the first `run-started` is dropped
    // for having no file to land in, which is exactly the silence this is meant
    // to remove.
    this.editorDiag.dispose();
    for (const w of this.homeWatchers) {
      w.dispose();
    }
    this.homeWatchers = [];
    // The cancelled run pushes its last rows and closes its writer on the way
    // out, so archiving before it finishes would persist a log about to change.
    await this.runPromise;
    await this.archiveCurrentChat();
  }

  /**
   * Prior conversation for LLM context. D44d: instead of a hard "last 12
   * pairs, drop the rest", the context is the running conversation summary
   * (if a fold has happened) followed by the raw tail since it — the fold
   * cadence keeps that tail bounded. MAX_TAIL_PAIRS is only a safety cap.
   */
  private historyFor(): { role: 'user' | 'assistant'; text: string }[] {
    // Exclude the entry for the task being sent now.
    return requestFromLog(this.log.slice(0, -1), MAX_TAIL_PAIRS);
  }

  // ---- Transcript replay (M3) -------------------------------------------

  private runsDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? join(this.homePlatoDir(), 'runs', this.projectKey(root)) : null;
  }

  /**
   * D49ax: this project's undo store, beside the run records.
   *
   * One folder the user can open, inspect and delete by hand — an extension that
   * quietly keeps a copy of their source on disk owes them that. Deleting it
   * loses undo history and nothing else; Plato recreates it.
   */
  private undoDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? join(this.homePlatoDir(), 'undo', this.projectKey(root)) : null;
  }

  /**
   * D49bb: the session's secret map.
   *
   * It lives on the HOST and not on the run, and that is the whole point: a
   * value masked in one run has to stay masked in the next, or the model reads
   * it straight back out of a file the previous run copied it into. It is never
   * written to disk — it holds real secret values, and the transcript is the one
   * file in this product that would turn into a secret-bearing artifact if it
   * ever reached one.
   */
  private secretVault: SecretVault = createVault();

  /**
   * D49ay: compress transcripts that have aged out, at the two moments that cost
   * the user nothing — when the panel opens, and when a run ends.
   *
   * The work is off the hot path by construction: nothing here runs while a
   * model is being waited on. It never throws. `sweepRuns` is written not to,
   * and this is the belt for the braces, because housekeeping that can stop a
   * panel from opening is a worse bug than the disk usage it prevents.
   *
   * D49ax's undo store is swept on the same two occasions, and for the same
   * reason: it is bounded either way, so there is never a moment when the user
   * has to think about it.
   */
  sweepTranscripts(): void {
    const dir = this.runsDir();
    if (dir) {
      try {
        sweepRuns(dir);
      } catch {
        // Nothing to do and nothing to say: the files are exactly as they were.
      }
    }
    const store = this.undoDir();
    if (store) {
      try {
        sweepProject(store);
      } catch {
        // Same contract: housekeeping never fails the thing it is attached to.
      }
    }
  }

  /**
   * D49ay: delete one transcript, or all of them.
   *
   * These are the ONLY two paths in Plato that remove a transcript, and both are
   * the user asking. The automatic sweep compresses instead, because a
   * transcript is the only record of what a run did — see `retention.ts`.
   *
   * `file` arrives from the webview, so it is validated by the same rule that
   * governs reading one. No separator and no `..` survives `isRunFileName`, so
   * the unlink can only ever name a file inside the runs directory.
   */
  private deleteRun(file: string): void {
    const dir = this.runsDir();
    if (!dir || !isRunFileName(file)) {
      this.send('error', 'Bad run file.');
      return;
    }
    try {
      rmSync(join(dir, file), { force: true });
    } catch (e) {
      this.send(
        'error',
        'Could not delete run: ' + (e instanceof Error ? e.message : 'error'),
      );
    }
    this.sendHistory();
  }

  private deleteAllRuns(): void {
    const dir = this.runsDir();
    if (!dir) return;
    // `runFilesIn` returns only names that passed the same validation, so every
    // path here is inside `dir`. A file that will not delete does not stop the
    // rest — the user asked for all of them gone.
    for (const f of runFilesIn(dir)) {
      try {
        rmSync(join(dir, f), { force: true });
      } catch {
        // Leave it and carry on; the list that follows shows what remains.
      }
    }
    this.sendHistory();
  }

  /** The History page's payload. Sent on open, and re-sent after a deletion. */
  private sendHistory(): void {
    const chats: {
      id: string;
      title: string;
      ts: string;
      count: number;
      current?: boolean;
    }[] = this.sessions().map((s) => ({
      id: s.id,
      title: s.title,
      ts: s.ts,
      count: s.log.filter((e) => e.k === 'msg').length,
    }));
    // D42: the live conversation is the first History entry so the
    // page is never empty while a chat is open.
    const curMsgs = this.log.filter((e) => e.k === 'msg').length;
    if (curMsgs > 0) {
      const first = this.log.find((e) => e.k === 'msg' && e.cls === 'you');
      chats.unshift({
        id: '__current__',
        title:
          this.chatTitle ||
          ((first && first.k === 'msg' ? first.text : '') || 'Chat').slice(0, 80),
        ts: new Date().toISOString(),
        count: curMsgs,
        current: true,
      });
    }
    void this.panel.webview.postMessage({
      type: 'history',
      runs: this.listRuns(),
      chats,
    });
  }

  private listRuns(): Record<string, unknown>[] {
    const dir = this.runsDir();
    if (!dir) {
      return [];
    }
    // D49ay: `runFilesIn` returns plain and compressed runs in one newest-first
    // list, so a compressed transcript is still a transcript to the user.
    const files = runFilesIn(dir);
    const runs: Record<string, unknown>[] = [];
    for (const f of files) {
      try {
        const lines = readRunText(dir, f)
          .split('\n')
          .filter((l) => l.trim().length > 0);
        const header = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
        const sum: Record<string, unknown> = {
          file: f,
          runId: String(header['runId'] ?? ''),
          task: String(header['task'] ?? ''),
          startedAt: String(header['startedAt'] ?? ''),
        };
        for (const l of lines.slice(1)) {
          const e = JSON.parse(l) as Record<string, unknown>;
          if (e['type'] === 'run-completed') {
            sum['reason'] = e['reason'];
            sum['turns'] = e['turns'];
            sum['inputTokens'] = e['inputTokens'];
            sum['outputTokens'] = e['outputTokens'];
            sum['costUsd'] = e['costUsd'];
          } else if (e['type'] === 'run-failed') {
            sum['reason'] = 'failed';
          }
        }
        runs.push(sum);
      } catch {
        // Corrupt line/file: skip, replay must never break on bad data.
      }
    }
    return runs;
  }

  private openRun(file: string): void {
    if (!isRunFileName(file)) {
      this.send('error', 'Bad run file.');
      return;
    }
    const dir = this.runsDir();
    if (!dir) {
      return;
    }
    try {
      const lines = readRunText(dir, file)
        .split('\n')
        .filter((l) => l.trim().length > 0);
      const events = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .map((e) =>
          e['type'] === 'text'
            ? { ...e, html: renderMarkdown(String(e['text'] ?? '')) }
            : e,
        );
      void this.panel.webview.postMessage({ type: 'run', file, events });
    } catch (e) {
      this.send(
        'error',
        'Could not read run: ' + (e instanceof Error ? e.message : 'error'),
      );
    }
  }

  private async promptForKey(connId: string): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: `${connId} API key (stored in SecretStorage, never displayed)`,
      password: true,
      ignoreFocusOut: true,
    });
    if (input && input.trim().length > 0) {
      await this.ctx.secrets.store(
        `plato.providers.${connId}.apiKey`,
        input.trim(),
      );
      if (connId === 'anthropic') {
        await this.ctx.secrets.store(LEGACY_KEY, input.trim());
      }
    }
  }

  /**
   * D49j: re-render the in-progress reply, at most once per throttle window.
   * Trailing rather than leading — the LAST fragment of a turn is the one that
   * must end up on screen, and a leading throttle would drop it.
   */
  private postStreamSoon(): void {
    if (this.streamTimer !== null) {
      return;
    }
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      this.send('md', renderMarkdown(this.replyBuffer + this.streamPreview));
    }, STREAM_THROTTLE_MS);
  }

  /** Drop a pending repaint; the caller is about to post its own. */
  private cancelStreamTimer(): void {
    if (this.streamTimer !== null) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
  }

  /**
   * D49j: fold streamed-but-uncommitted text into the reply buffer. A turn that
   * ran to completion has none — every block was committed, and committing
   * clears the preview. A turn cut short mid-stream does, and the user watched
   * that text appear, so it is what should be recorded.
   */
  private foldPreview(): void {
    this.cancelStreamTimer();
    if (this.streamPreview.length > 0) {
      this.replyBuffer += this.streamPreview;
      this.streamPreview = '';
    }
  }

  private push(entry: Entry): void {
    this.log.push(entry);
    if (this.log.length > LOG_MAX) {
      this.recordTrim(LOG_MAX);
    }
    void this.ctx.workspaceState.update(LOG_KEY, this.log);
  }

  /**
   * Start a new conversation: confirm, clear the persisted log, reset the
   * per-session write consents (a new chat is a new session, D23), and
   * blank the webview. Refuses while a run is active.
   */
  async newChat(): Promise<void> {
    if (this.running) {
      this.send('notice', 'A run is active — wait for it to finish before starting a new chat.');
      return;
    }
    const pick = await vscode.window.showWarningMessage(
      'Start a new chat? The current conversation will be cleared.',
      { modal: true },
      'New Chat',
    );
    if (pick !== 'New Chat') {
      return;
    }
    await this.archiveCurrentChat();
    this.log.length = 0;
    await this.ctx.workspaceState.update(LOG_KEY, this.log);
    // D40: a new chat gets a fresh title.
    this.chatTitle = '';
    this.titleManuallySet = false;
    this.archivedUpTo = 0;
    await this.ctx.workspaceState.update(TITLE_KEY, '');
    this.sessionWrites.clear();
    this.sessionApprovals.clear();
    // D49bc: a new chat is a new session, so the reveals go with the other two.
    // A file the user agreed to show once is not agreed to for the next chat.
    this.revealedPaths.clear();
    this.pendingAttachments = [];
    this.pendingHistory = null;
    this.pendingApproval = null;
    this.pendingStuck = null;
    this.pendingReveal = null;
    this.replyBuffer = '';
    // D49j: the webview is about to be blanked; a pending repaint would post
    // the old conversation's text into the new one.
    this.streamPreview = '';
    this.cancelStreamTimer();
    await this.panel.webview.postMessage({
      type: 'restore',
      log: [],
      hasConnections: readConnections().length > 0,
      title: '',
    });
  }

  /** The picker's live choice, else the plato.model setting. */
  private preferredModel(): string {
    return (
      this.modelOverride ??
      vscode.workspace
        .getConfiguration('plato')
        .get<string>('model', 'anthropic:claude-sonnet-4-5')
    );
  }

  /**
   * D49x: the model a run uses, which must be one the pickers can offer.
   *
   * The old rule asked only whether the ref's CONNECTION existed, and a model the
   * user had just unchecked satisfied that: the connection was still there. The
   * run then sent a model the key did not allow and got a 403, while the composer
   * showed that model as the current one — the founder's screenshot.
   */
  private effectiveModel(): string {
    return pickEffectiveModel(
      this.modelItems().map((it) => it.value),
      this.preferredModel(),
    );
  }

  /** True when the pickers can offer this ref, i.e. it is an enabled model. */
  private isSelectable(ref: string): boolean {
    return this.modelItems().some((it) => it.value === ref);
  }

  /**
   * D40: conversation title. After the first completed run of a
   * conversation with no title yet, ask the same model (one cheap
   * non-streaming turn, no tools, ~40 output tokens) for a 3-6 word
   * title. Fire and forget: failures are silent and the next run
   * retries; a user rename always wins.
   */
  private async maybeGenerateTitle(
    conn: ConnectionConfig,
    apiKey: string,
    ref: string,
    task: string,
  ): Promise<void> {
    if (this.titleInFlight || this.chatTitle || this.titleManuallySet) {
      return;
    }
    this.titleInFlight = true;
    const firstYou = this.log.find((e) => e.k === 'msg' && e.cls === 'you');
    const seed =
      (firstYou && firstYou.k === 'msg' ? firstYou.text : '') || task;
    const lastBot = [...this.log]
      .reverse()
      .find((e) => e.k === 'msg' && e.cls === 'bot');
    const excerpt =
      lastBot && lastBot.k === 'msg' ? lastBot.text.slice(0, 400) : '';
    try {
      const provider = createProvider(conn.kind, {
        apiKey,
        baseUrl: conn.baseUrl,
      });
      const parts = splitModelRef(ref);
      const res = await provider.completeTurn({
        model: ref,
        system:
          'Write a short conversation title (3-6 words) summarizing the exchange. Reply with the title only: no quotes, no period, no explanation.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `User: ${seed.slice(0, 500)}${
                  excerpt ? `\n\nAssistant: ${excerpt}` : ''
                }`,
              },
            ],
          },
        ],
        tools: [],
        // D42: reasoning models spend tokens thinking before the title —
        // a 120-token budget was eaten whole, leaving content empty.
        maxTokens: 512,
        // D42: when the model supports reasoning, keep it brief but let
        // it think (the Anthropic adapter raises max_tokens above the
        // budget automatically).
        ...(parts && modelSupportsReasoning(parts.model)
          ? { reasoning: { effort: 'low' as const } }
          : {}),
      });
      const raw = res.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join(' ')
        // Some OpenAI-compatible reasoning models emit inline <think>.
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^["'\u201c\u201d]+|["'\u201c\u201d.]+$/g, '')
        .trim()
        .slice(0, 80);
      if (this.chatTitle || this.titleManuallySet) {
        return;
      }
      if (raw) {
        this.chatTitle = raw;
      } else {
        // D42: diagnose why the model gave nothing usable (Extension
        // Host console), then fall back to the prompt's own words.
        console.warn(
          `[plato] title: empty model reply (stop=${res.stopReason}, ` +
            `blocks=${res.content.length}) — using prompt fallback`,
        );
        const STOP = new Set([
          'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'for',
          'with', 'on', 'in', 'at', 'then', 'is', 'are',
        ]);
        const words = seed
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(' ')
          .split(/\s+/);
        while (
          words.length > 1 &&
          STOP.has(
            (words[words.length - 1] ?? '')
              .toLowerCase()
              .replace(/[^a-z]/g, ''),
          )
        ) {
          words.pop();
        }
        const fallback = words.join(' ').slice(0, 40).trim();
        if (!fallback) {
          return;
        }
        this.chatTitle = fallback;
      }
      await this.ctx.workspaceState.update(TITLE_KEY, this.chatTitle);
      this.send('title', this.chatTitle);
    } catch (e) {
      // Diagnostics only (Extension Host console); the UI stays silent.
      console.warn('[plato] title generation failed:', e);
    } finally {
      this.titleInFlight = false;
    }
  }

  /**
   * Dropdown entries grouped by provider (D29); only connections that
   * have a model set appear — fetched lists are the source of truth.
   * D37: also returns the per-model `maxContext` so the header can
   * show "200k ctx" next to the model name.
   */
  private modelItems(): {
    value: string;
    label: string;
    group: string;
    maxContext: number | null;
  }[] {
    const items: {
      value: string;
      label: string;
      group: string;
      maxContext: number | null;
    }[] = [];
    for (const c of readConnections()) {
      const poolByName = new Map(
        (c.pool ?? []).map((p) => [p.id, p] as const),
      );
      // D49z: everything the connection fetched, so the picker cannot show a
      // model the run would refuse — nor hide one it would accept.
      for (const m of resolveOfferedModels(c.allModels, c.models)) {
        const poolEntry = poolByName.get(m);
        // D26c/D49t/D49bf: ONE resolution rule, shared with the run. The window
        // is whatever the CONNECTION advertised — the shipped catalog no longer
        // claims one (D49bf), so the ring the user reads is the same number
        // compaction uses, and when the connection says nothing this is `null`
        // and the UI says "ctx unknown" rather than inventing precision.
        const maxContext = resolveMaxContext(poolEntry?.maxContext);
        items.push({
          value: `${c.id}:${m}`,
          label: m,
          group: c.id,
          maxContext,
        });
      }
    }
    return items;
  }

  /**
   * D49t: ensures a connection's model metadata is present and reasonably
   * fresh, fetching it if not.
   *
   * Discovery used to be an explicit "Fetch models" button, so a connection the
   * user never refreshed had NO advertised limits and the run fell back to 8192
   * — the fault that made the first real runs summarise after three files. This
   * runs before a run starts, bounded by a short timeout so a slow endpoint
   * cannot hold up the work, and swallows every failure: the fallback is still
   * correct, just less informed.
   *
   * A **stale** pool is refreshed too (see POOL_MAX_AGE_MS). A key can be rotated
   * or a model withdrawn on the provider's side, and a cached number that
   * outlives its key is exactly the kind of quiet wrongness this feature exists
   * to remove.
   */
  private async ensureModelPool(
    conn: ConnectionConfig,
    apiKey: string,
  ): Promise<void> {
    const fresh =
      conn.pool !== undefined &&
      conn.pool.length > 0 &&
      conn.pooledAt !== undefined &&
      Date.now() - conn.pooledAt < POOL_MAX_AGE_MS;
    if (fresh) return;
    try {
      const pool = await fetchModelPool({
        kind: conn.kind,
        apiKey,
        baseUrl:
          conn.kind === 'openai'
            ? conn.baseUrl ?? 'https://api.openai.com/v1'
            : conn.baseUrl ?? undefined,
        // A discovery refresh is a nicety, never a reason to stall a run.
        fetchImpl: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
      });
      if (pool.length === 0) return;
      const user = rawUserConnections();
      const entry = user.find((u) => u.id === conn.id);
      if (!entry) return;
      entry.pool = pool.map((p) => {
        const e: ConnectionPoolEntry = { id: p.id };
        if (p.maxContext !== undefined) e.maxContext = p.maxContext;
        if (p.maxOutput !== undefined) e.maxOutput = p.maxOutput;
        return e;
      });
      entry.pooledAt = Date.now();
      await vscode.workspace
        .getConfiguration('plato')
        .update('connections', user, vscode.ConfigurationTarget.Global);
      void this.sendSettings();
    } catch {
      // Offline, refused, or an endpoint that does not answer /models. The
      // capped-and-conservative fallback is what runs next, which is fine.
    }
  }

  /**
   * D49t: the limits the connection advertised for `model`, in the shape the run
   * wants. Undefined when it advertised nothing, so the loop's own resolution
   * takes over rather than receiving zeros.
   */
  private advertisedLimits(
    conn: ConnectionConfig,
    model: string,
  ): { context?: number; maxOutput?: number } | undefined {
    const e = (conn.pool ?? []).find((p) => p.id === model);
    if (!e) return undefined;
    const out: { context?: number; maxOutput?: number } = {};
    if (e.maxContext !== undefined) out.context = e.maxContext;
    if (e.maxOutput !== undefined) out.maxOutput = e.maxOutput;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private reasoningFor():
    | { effort: 'low' | 'medium' | 'high' }
    | undefined {
    const v = vscode.workspace.getConfiguration('plato').get<string>(
      'reasoning',
      'off',
    );
    return v === 'off' ? undefined : { effort: v as 'low' | 'medium' | 'high' };
  }

  /**
   * D49bo: the only way a run is started. One run at a time is enforced HERE
   * rather than assumed — the queue starts a run from the end of another, so a
   * second start would otherwise interleave two runs over one controller and
   * one webview. The promise is kept so `dispose()` can wait for the run it
   * just cancelled to finish unwinding before it archives the chat.
   */
  private startRun(task: string, ctx: RunCtx = {}): void {
    // `runInFlight`, NOT `running` — see the field's note. `running` is false for
    // the whole of a run's preparation, so a second start in that window slipped
    // through and ran two runs at once.
    if (this.runInFlight) return;
    this.runInFlight = true;
    this.runPromise = this.run(task, ctx).finally(() => {
      this.runInFlight = false;
      // D49bo: hand the queue on from HERE, not from inside `run()`. The slot has
      // to be free before the next run may start, and this is the one place that
      // is true for every exit — including the guards that return early, which is
      // why the advance cannot live at the end of the body.
      this.advanceAfterRun();
    });
  }

  /**
   * D49bo: hand the queue on, now that the run has fully unwound — state cleared,
   * writer closed, MCP servers stopped, and the run slot free.
   */
  private advanceAfterRun(): void {
    if (this.disposed || this.queueHeld || this.queue.length === 0) return;
    if (nextQueued(this.queue, this.lastRunEnd) !== null) {
      this.advanceQueue();
    } else {
      // Cancel, stuck, or a failure. The hold is sticky until the user asks for
      // the queue to continue — one cancel must not be quietly undone.
      this.queueHeld = true;
      this.postQueue();
    }
  }

  private async run(task: string, ctx: RunCtx = {}): Promise<void> {
    // D49bm: a control pressed while the host was still preparing. Cancel is
    // checked FIRST and means the run never starts — the user asked it to stop,
    // and starting it anyway is the one answer that cannot be defended.
    if (this.pendingCancel) {
      this.pendingCancel = false;
      this.pendingPause = false;
      this.send('notice', 'Stopped before it started.');
      this.send('done', { note: 'stopped before it started', secs: 0, tools: 0, tok: '', cost: '', obs: '' });
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.send('error', 'Open a folder before asking Plato.');
      return;
    }
    // D43: nothing to run until a provider is connected. The webview
    // hides the composer entirely in this state; guard direct sends.
    if (readConnections().length === 0) {
      this.send('error', 'Connect a provider first — open Settings → Providers.');
      return;
    }
    // Orchestration (D32): the SETTING decides the mode, never file presence.
    const orchestration = vscode.workspace
      .getConfiguration('plato')
      .get<'solo' | 'duo' | 'academy'>('orchestration', 'solo');
    // Academy (D31/D32/D46): the council lives in ~/.plato/ACADEMY.yaml —
    // Plato's global config, not a project file. Validation is loud: a broken
    // file aborts the run before it starts.
    let team: ReturnType<typeof loadTeamConfig> = null;
    try {
      team = loadTeamConfig(this.homePlatoDir());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (orchestration === 'academy') {
        this.send(
          'error',
          e instanceof TeamConfigError
            ? msg
            : `ACADEMY.yaml could not be read — ${msg}`,
        );
        return;
      }
      // Not in Academy mode: a stray/broken ACADEMY.yaml is inert — ignore it
      // (D45a-4: ACADEMY.yaml is only surfaced in Academy mode).
    }
    if (team === null && orchestration === 'academy') {
      this.send(
        'error',
        'Academy mode needs ~/.plato/ACADEMY.yaml — build a council in Settings → Orchestration → Academy (edits create the file), or switch to Solo/Duo.',
      );
      return;
    }
    const useAcademy = orchestration === 'academy' && team !== null;
    if (useAcademy && team) {
      this.send('notice', `Academy "${team.name || 'unnamed'}" active`);
      this.send('team', {
        name: team.name,
        members: team.members.map((m) => ({
          name: m.name,
          kind: m.kind,
          model: m.model,
          color: colorHex(m.color), // D47f: same colour as the Settings card
          tiers:
            m.kind === 'philosopher'
              ? [
                  m.guidance ?? true ? 'guidance' : '',
                  m.pause ?? false ? 'pause' : '',
                  m.cancel ?? false ? 'cancel' : '',
                ].filter(Boolean)
              : [],
        })),
      });
    }
    // Resolve the composite ref to a connection profile (D26a). D47e: Plato is
    // the doer in every mode, so the chat composer's model is the one used —
    // there is no per-council worker model any more.
    const ref = this.effectiveModel();
    const parts = splitModelRef(ref);
    const conn = parts
      ? readConnections().find((c) => c.id === parts.connectionId) ?? null
      : null;
    if (!conn) {
      this.send(
        'error',
        `Unknown connection in "${ref}". Configured: ${readConnections()
          .map((c) => c.id)
          .join(', ')}.`,
      );
      return;
    }
    let apiKey = await this.ctx.secrets.get(
      `plato.providers.${conn.id}.apiKey`,
    );
    if (!apiKey && conn.id === 'anthropic') {
      apiKey = await this.ctx.secrets.get(LEGACY_KEY);
    }
    if (!apiKey) {
      const set = await vscode.window.showErrorMessage(
        `Plato needs an API key for ${conn.id}.`,
        'Set API Key',
      );
      if (set === 'Set API Key') {
        await vscode.commands.executeCommand('plato.setApiKey', conn.id);
      }
      return;
    }
    // D49t: make sure the connection's model metadata exists BEFORE the run
    // resolves its limits. The window and output cap used to be discovered only
    // when the user pressed "Fetch models" — so a connection that was never
    // manually refreshed ran on the 8192 fallback and summarised the
    // conversation after a few files. Best-effort and short: a slow or offline
    // endpoint must not hold up a run, so failures are swallowed and the
    // fallback stands.
    await this.ensureModelPool(conn, apiKey);
    const advertised = parts
      ? this.advertisedLimits(conn, parts.model)
      : undefined;
    this.replyBuffer = '';
    // D49cb: the count is per run. A model may ask once, twice, three times at
    // most; a new request needs a new run.
    this.modeRequestsThisRun = 0;
    // D49j: drop anything the previous run left in the streaming preview, and
    // the pending repaint with it — a timer firing into a fresh run would post
    // the old turn's text over the new one.
    this.streamPreview = '';
    this.cancelStreamTimer();
    // D41: name the conversation from the prompt immediately — the
    // title arrives a second or two into the run, not after it.
    void this.maybeGenerateTitle(conn, apiKey, ref, task);
    const started = Date.now();
    let toolsUsed = 0;
    // D49as: the plan as the run last set it. Empty until the model writes one.
    let lastPlan: TodoItem[] = [];
    // M2: every run is transcribed under ~/.plato/runs/<project-key>/ (D24c,
    // D46) — personal state, never the shared repo.
    const bus = new AgentBus();
    // D49aq: the approval paths report on this bus (see `approval-card`), so
    // hold it for the run. Set before the loop starts and nulled in the finally.
    this.runBus = bus;
    // D49av: the loop mints the runId, and the diagnostics notice needs it. The
    // bus delivers synchronously, so it is set long before the first write.
    // D49bj: kept on the host as well, because a mode switch arrives from the
    // panel rather than from this scope and still has to name the run it landed
    // in.
    let runId = '';
    bus.on((e) => {
      if (e.type === 'run-started') {
        runId = e.runId;
        this.currentRunId = e.runId;
      }
    });
    const writer = new TranscriptWriter(
      join(this.homePlatoDir(), 'runs', this.projectKey(root)),
      { task, root },
    );
    writer.attach(bus);
    // D49ca: a switch made between runs belongs to the next record. The writer
    // is attached above, so the event lands after the header; a switch made
    // while this run was still being PREPARED takes the same path, because no
    // `run-started` exists yet to name before it.
    bus.on((e) => {
      if (e.type !== 'run-started' || this.pendingModeChanges.length === 0) return;
      for (const c of this.pendingModeChanges.splice(0)) {
        bus.emit({
          type: 'mode-changed',
          runId: e.runId,
          from: c.from,
          to: c.to,
          at: c.at,
          via: c.via,
        });
      }
    });
    // MCP servers (D06, D46, D49bt): read from ~/.plato/mcp.json; failures
    // degrade to zero tools for that server, never break the run.
    //
    // D49bt: these go to the screen only, and that is not an oversight. Servers
    // start while the run is being PREPARED — before `run-started` — and the
    // transcript writer drops a notice that arrives before the record it would
    // land in exists (the rule D49bn records). Emitting on the bus as well was
    // tried and is inert; a comment claiming otherwise would be a lie about what
    // the record holds.
    const mcpNotice = (text: string) => {
      this.send('notice', text);
    };
    const mcpServers: McpServer[] = [];
    // D49bt: `plan` denies every MCP tool (modes.ts), so the servers are not
    // started there. Starting them would run the user's configured commands in
    // the one mode that promises to change nothing, and a hung server costs up
    // to 20 seconds before the first turn — all for tools that can never be
    // called in that mode.
    //
    // The last run's outcome is deliberately NOT cleared in plan: nothing ran,
    // so "not run yet" would be a worse answer than the last run that did. A
    // server removed from the config stops appearing regardless, because the
    // panel only reports names the file still has.
    const mcpStartsThisMode = this.mode !== 'plan';
    if (mcpStartsThisMode) {
      this.mcpLastRun = new Map();
    }
    try {
      const cfg = loadMcpConfig(this.homePlatoDir());
      for (const [name, c] of Object.entries(cfg)) {
        if (!mcpStartsThisMode) {
          continue;
        }
        // D49bt: a disabled server is not started and says NOTHING — no notice,
        // not even a failure one. Silence is what "off" has to mean.
        if (c.disabled === true) {
          continue;
        }
        const srv = new McpServer(name, c);
        try {
          await srv.start(20_000);
          mcpServers.push(srv);
          this.mcpLastRun.set(name, { tools: srv.tools.length, error: '' });
          if (srv.tools.length > 0) {
            mcpNotice(`MCP ${name}: ${srv.tools.length} tools available`);
          }
        } catch (e) {
          this.mcpLastRun.set(name, {
            tools: 0,
            error: e instanceof Error ? e.message : 'error',
          });
          mcpNotice(
            `MCP ${name} failed to start — ${
              e instanceof Error ? e.message : 'error'
            }`,
          );
        }
      }
    } catch (e) {
      mcpNotice(
        `mcp.json ignored — ${e instanceof Error ? e.message : 'error'}`,
      );
    }
    // Philosophers (D30 + D32): ACADEMY.yaml members in Academy mode; the
    // Duo philosopher from settings otherwise. Solo = none.
    // Invariant unchanged: philosophers NEVER approve tool calls.
    const obsSpecs: {
      name: string;
      ref: string;
      role: string;
      guidance: boolean;
      pause: boolean;
      cancel: boolean;
      maxInterventions: number;
      /** D47f: identity colour hex, shown with every notice this one emits. */
      hex: string;
    }[] = [];
    if (useAcademy && team) {
      for (const m of team.members) {
        if (m.kind === 'philosopher') {
          obsSpecs.push({
            name: m.name,
            ref: m.model,
            role: m.role ?? '',
            guidance: m.guidance ?? true,
            pause: m.pause ?? false,
            cancel: m.cancel ?? false,
            maxInterventions: m.maxInterventions ?? 5,
            hex: colorHex(m.color),
          });
        }
      }
    } else if (orchestration === 'duo') {
      // D47: ~/.plato/DUO.yaml is the store (edits create it); a missing
      // file runs the built-in default. A broken file aborts loudly, like
      // Academy's — and, like ACADEMY.yaml, it is inert in the other modes
      // because this branch never reads it.
      let duoCfg: ReturnType<typeof loadDuoConfig> = null;
      try {
        duoCfg = loadDuoConfig(this.homePlatoDir());
      } catch (e) {
        this.send(
          'error',
          e instanceof DuoConfigError
            ? e.message
            : `DUO.yaml could not be read — ${
                e instanceof Error ? e.message : 'error'
              }`,
        );
        return;
      }
      obsSpecs.push({
        ...duoObserverSpec(
          duoCfg !== null ? duoCfg.philosopher : defaultDuoPhilosopher(),
          ref,
        ),
        // duoObserverSpec supplies the colour id; the wire wants the hex.
        hex: colorHex(duoObserverSpec(
          duoCfg !== null ? duoCfg.philosopher : defaultDuoPhilosopher(),
          ref,
        ).color),
      });
    }
    const observers: { agent: ObserverAgent; name: string }[] = [];
    let interventionsUsed = 0; // hard cap 5 per run across members (D31d)
    for (const spec of obsSpecs) {
      const oParts = splitModelRef(spec.ref);
      const oConn = oParts
        ? readConnections().find((c) => c.id === oParts.connectionId)
        : undefined;
      const oKey = oConn
        ? (await this.ctx.secrets.get(`plato.providers.${oConn.id}.apiKey`)) ??
          (oConn.id === 'anthropic'
            ? await this.ctx.secrets.get(LEGACY_KEY)
            : undefined)
        : undefined;
      if (!oConn || !oKey) {
        this.send(
          'notice',
          `[${spec.name}] observer unavailable — no model/key for '${spec.ref}'`,
        );
        continue;
      }
      const agent = new ObserverAgent(
        createProvider(oConn.kind, {
          apiKey: oKey,
          baseUrl: oConn.baseUrl,
        }),
        {
          model: spec.ref,
          role: spec.role,
          guidance: spec.guidance,
          pause: spec.pause,
          cancel: spec.cancel,
          maxInterventions: spec.maxInterventions,
        },
      );
      const name = spec.name;
      const noticeMeta = { color: spec.hex }; // D47f: colour-tag every notice
      observers.push({ agent, name });
      const digest: DigestEntry[] = [];
      let observing = true;
      let errNotified = false;
      let parseErrNotified = false;
      this.send('notice', `[${name}] watching — ${spec.ref}`, noticeMeta);
      // Arg summaries in digest entries (D33+): a philosopher steering code
      // needs to see WHICH files/commands are involved, not just tool names.
      const argHint = (args: Record<string, unknown>): string => {
        if (typeof args['path'] === 'string') {
          return ` ${String(args['path']).slice(0, 120)}`;
        }
        if (typeof args['command'] === 'string') {
          return ` ${String(args['command']).slice(0, 120)}`;
        }
        if (typeof args['pattern'] === 'string') {
          return ` /${String(args['pattern']).slice(0, 80)}/`;
        }
        return '';
      };
      bus.on((e) => {
        if (e.type === 'tool-event') {
          digest.push({
            kind: 'tool',
            text: `${e.tool}${e.args ? argHint(e.args as Record<string, unknown>) : ''} ${
              e.phase
            }${e.ok === false ? ' (error)' : ''}`,
          });
        } else if (e.type === 'text') {
          agent.noteText(e.text);
        } else if (e.type === 'turn-started' && observing) {
          if (e.turn > 1 && !agent.exhausted && interventionsUsed < 5) {
            observing = false; // one decision at a time; re-armed below
            void agent
              .observe(task, digest)
              .then((a) => {
                if (agent.lastError !== null && !errNotified) {
                  errNotified = true;
                  this.send(
                    'notice',
                    `[${name}] unavailable — ${agent.lastError}`,
                    noticeMeta,
                  );
                }
                if (agent.parseErrors > 0 && !parseErrNotified) {
                  parseErrNotified = true;
                  this.send(
                    'notice',
                    `[${name}] reply not parseable as JSON (${agent.parseErrors} so far) — try a stronger model or tighten the role prompt`,
                    noticeMeta,
                  );
                }
                if (a.action === 'guidance') {
                  interventionsUsed += 1;
                  this.controller.sendGuidance(a.message);
                  this.send('notice', `[${name}] guidance: ${a.message}`, noticeMeta);
                } else if (a.action === 'pause') {
                  interventionsUsed += 1;
                  this.controller.pause();
                  this.send('notice', `[${name}] paused the run`, noticeMeta);
                } else if (a.action === 'cancel') {
                  interventionsUsed += 1;
                  // D49bi: release the parked cards BEFORE cancelling, exactly as
                  // the user's own Cancel does. Without this the abort flag was
                  // set while the run stayed parked on a card the observer could
                  // not answer, so an observer's cancel only took effect once the
                  // user answered it themselves.
                  this.releaseParkedCards();
                  this.controller.cancel();
                  this.send('notice', `[${name}] cancelled the run`, noticeMeta);
                }
              })
              .catch(() => undefined)
              .finally(() => {
                observing = true;
              });
          }
        }
      });
    }
    // D49bm: the park edges come from the LOOP, not from the click. `pause()`
    // states a request; only `gate()` knows the run has actually stopped, and it
    // may never be reached at all. Relaying a signal to the bus is the pattern
    // this host already uses for the mode switch and the diagnostics look.
    // D49bm: a fresh run starts with no pause history, so the closing line
    // below cannot report a pause that belonged to the run before.
    this.pauseRequested = false;
    this.pauseEverParked = false;
    this.controller = new RunController({
      onPark: (parked) => {
        if (parked) this.pauseEverParked = true;
        const line = parked
          ? 'Plato paused at a safe point.'
          : 'Plato resumed.';
        // The bus notice is what the RECORD keeps and what pushes the scrollback
        // row; the `send` is what draws it live. Both are needed — the listener
        // for `notice` writes the log, it does not render.
        bus.emit({ type: 'notice', runId: this.currentRunId, text: line });
        this.send('notice', line);
        this.send('pause-state', { parked });
      },
    });
    this.running = true;
    // D49bm: a pause asked for before the controller existed. Applied now, so a
    // click during the setup is honoured rather than swallowed.
    if (this.pendingPause) {
      this.pendingPause = false;
      this.pauseRequested = true;
      this.controller.pause();
    }
    // D49bn: the panel closed while this run was still being prepared — before
    // there was a controller for `dispose()` to cancel, and before there was a
    // bus for it to write to. There is no view left to supervise this run, so it
    // stops here; `run()`'s own `finally` says why, once the bus exists.
    if (this.disposed) this.controller.cancel();
    // D37: forward live context + compaction events straight to the
    // webview. The ring + the compact-button + the post-compact notice
    // all read from these.
    bus.on((e) => {
      if (e.type === 'context') {
        void this.panel.webview.postMessage({
          type: 'context',
          runId: e.runId,
          turn: e.turn,
          maxContext: e.maxContext,
          total: e.total,
          system: e.system,
          user: e.user,
          assistant: e.assistant,
          tool: e.tool,
          ...(e.lastInputTokens !== undefined
            ? { lastInputTokens: e.lastInputTokens }
            : {}),
        });
      } else if (e.type === 'context-compacted') {
        void this.panel.webview.postMessage({
          type: 'context-compacted',
          runId: e.runId,
          turn: e.turn,
          mode: e.mode,
          beforeTokens: e.beforeTokens,
          afterTokens: e.afterTokens,
          summaryTokens: e.summaryTokens,
          keptMessages: e.keptMessages,
        });
        // Also surface as a human-readable notice in the chat log so
        // the user can scroll back and see when Plato compacted.
        this.push({
          k: 'msg',
          cls: 'sys',
          who: 'Plato',
          text: `[plato] context compacted (${e.mode}) — ${fmtTokens(
            e.beforeTokens,
          )} \u2192 ${fmtTokens(e.afterTokens)} (summary used ${fmtTokens(
            e.summaryTokens,
          )} tokens)`,
        });
      } else if (e.type === 'notice') {
        // D49bz: a run's own notice — a stopped shell, a stuck nudge, a result in
        // a .gitignore path — was PERSISTED but never posted, so it appeared only
        // after a reload. `context-compacted` above has always done both; this is
        // the same two lines, for every other notice the loop raises.
        this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: e.text });
        this.send('notice', e.text);
      }
    });
    // Chronological reply segmentation (founder UX feedback): the reply was
    // previously streamed as ONE growing block, so a guidance notice or tool
    // summary injected mid-run sat ABOVE later narration that streamed after
    // it — appearing misplaced. Now each turn boundary commits the current
    // segment to a finished message in #log, so notices/tools land BETWEEN
    // turns in true chronological order.
    bus.on((e) => {
      if (e.type === 'turn-started' && e.turn > 1) {
        this.send('turn', {});
        // D49j: a turn cut short mid-stream leaves uncommitted preview text.
        this.foldPreview();
        if (this.replyBuffer.trim().length > 0) {
          this.push({
            k: 'msg',
            cls: 'bot',
            who: 'Plato',
            text: this.replyBuffer,
          });
          this.replyBuffer = '';
        }
      }
    });
    // D49bo: how the run ended, or null when it threw. Read AFTER the try, so a
    // failure is distinguishable from every clean ending — the queue holds on a
    // failure, and the pause line must not be written after a cancel.
    let ended: RunEndReason | null = null;
    // D49bo: cleared per run, so a guard that returns early cannot leave the
    // PREVIOUS run's ending behind for the queue to act on. Null means "no
    // result", which is how a failure and an abandoned start both read — and
    // both must hold the queue.
    this.lastRunEnd = null;
    try {
      let modelTask = await this.buildModelTask(task, ctx, root);
      // D44c: /history-imported context rides this run's task. Consumed here,
      // so an aborted run (the guards above) keeps it for the next attempt.
      if (this.pendingHistory !== null) {
        modelTask +=
          '\n\n[imported conversation: ' + this.pendingHistory.title + ']\n' +
          this.pendingHistory.text;
        this.pendingHistory = null;
      }
      // D49o: images ride the opening user turn as their own channel — never
      // folded into `modelTask`, which is emitted on `run-started` and written
      // verbatim to the transcript.
      const runImages =
        ctx.images && ctx.images.length > 0
          ? await this.loadRunImages(ctx.images, root)
          : [];
      const result = await runAgentLoop({
        root,
        task: modelTask,
        // The worker is told which watchers actually started, so its account of
        // the team matches the one the user sees.
        team: { mode: orchestration, watchers: observers.map((o) => o.name) },
        // D49bz: read per run, not at activation, so a change in Settings
        // applies to the next run without reloading the window. Off by default:
        // an ignored file is found and labelled rather than silently missed.
        respectGitignore: vscode.workspace
          .getConfiguration('plato')
          .get<boolean>('search.respectGitignore', false),
        ...(runImages.length > 0 ? { images: runImages } : {}),
        approve: (req) => this.approve(req),
        getMode: () => this.mode,
        // D49cb: the model can ask; the user's card is what changes anything.
        requestMode: (req) => this.requestMode(req),
        bus,
        controller: this.controller,
        askUser: async (req) => {
          const answer = await this.askUser(req);
          return answer;
        },
        // D49aw: the repetition bound. It reaches the model first (a nudge in
        // the next turn) and only the user if that does not work.
        onStuckAsk: (req) => this.promptStuck(req),
        // D49ax: keep what every write replaced, so the user can put it back.
        // The loop files them under this run's id — that is what makes "undo
        // everything from this request" one action instead of a file list.
        ...(this.undoDir() ? { undoStore: { dir: this.undoDir()! } } : {}),
        // D49bb: a protected file is readable and its values are masked. The
        // vault is what holds those values for the session so a write can put
        // them back and every tool result can be scrubbed of them.
        secretVault: this.secretVault,
        // D49bc: a protected file Plato cannot mask is offered rather than
        // refused, when the file is text. The session memory of the answer lives
        // here, so the question is asked once per file.
        revealProtected: (rel) => this.revealProtected(rel),
        onStuckNudge: (note) => {
          // The user hears about it BEFORE the card, so the pause is never a
          // surprise. Pushed as well as sent, because this is part of the run's
          // story and a reload should keep it.
          this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: note });
          this.send('notice', note);
        },
        provider: createProvider(conn.kind, {
          apiKey,
          baseUrl: conn.baseUrl,
        }),
        model: ref,
        // D49t: what the connection reported about this model. Without it the
        // run assumes 8192 and summarises far too early.
        ...(advertised ? { advertised } : {}),
        // D45a-3: project files (PLATO.md + AGENTS.md/CLAUDE.md) always join
        // the worker prompt when present — the includeProjectRules opt-out was
        // removed. D46: globalConfigDir feeds the ~/.plato/PLATO.md fallback.
        // D47e: no Academy worker role override — the doer's prompt is the same
        // in every mode (project PLATO.md > global PLATO.md > bundled default).
        globalConfigDir: this.homePlatoDir(),
        ...(parts && modelSupportsReasoning(parts.model)
          ? { reasoning: this.reasoningFor() }
          : {}),
        // D49g: the worker prompt and tool schemas are identical on every turn
        // of a run, so mark them cacheable. A no-op for OpenAI, which caches
        // implicitly; on Anthropic it is a straight input-cost saving.
        cache: true,
        history: this.historyFor(),
        mcpServers,
        // D37: context compaction. Mode + threshold come from settings
        // (the header pill toggles mode; the slider sets threshold).
        compact: this.compactionState(),
        // D49p: web_fetch's domain lists. Enforced on every hop.
        // D49j: the reply appears as it is written. The loop hands us the text
        // SO FAR for this turn, so the preview is replaced rather than appended
        // and a retried turn cannot concatenate onto the text it abandoned.
        onTextDelta: (soFar) => {
          this.streamPreview = soFar;
          this.postStreamSoon();
        },
        onText: (t) => {
          // D49j: a committed block is authoritative, so it SUPERSEDES the
          // preview instead of following it — keeping both would show the
          // turn's text twice.
          this.streamPreview = '';
          this.cancelStreamTimer();
          if (t.trim().length > 0) {
            this.replyBuffer += t;
            // Host renders cumulative markdown once per turn (D25a).
            this.send('md', renderMarkdown(this.replyBuffer));
          }
        },
        onToolEvent: (e) => {
          if (e.phase === 'done') {
            toolsUsed += 1;
          }
          // D49av: what the editor knew about the file BEFORE this write. Taken
          // here, on the event immediately before the executor runs, so nothing
          // can move underneath it — the loop's own `requested` fires before the
          // user is even asked on the `ask` path, which could be a minute earlier.
          // One slot is enough: the loop runs a batch of tool calls strictly one
          // at a time, `allowed` then `done` per call, in order.
          if (e.phase === 'allowed' && isWriteTool(e.tool)) {
            this.pendingDiag = this.editorDiag.snapshot(root, e.tool, e.args);
          }
          void this.panel.webview.postMessage({
            type: 'tool',
            tool: e.tool,
            phase: e.phase,
            ok: e.ok,
            // D49as: the guard's reason. Without it the live log can say a call
            // was stopped but not which guard stopped it.
            reason: e.reason,
          });
          // D49as: 'refused' joins the persisted set. The guard's decisions are
          // part of what happened in the run, so a reload must not lose them —
          // and a run the user is watching must show them as they happen.
          if (
            e.phase === 'done' ||
            e.phase === 'denied' ||
            e.phase === 'declined' ||
            e.phase === 'refused'
          ) {
            this.push({
              k: 'tool',
              tool: e.tool,
              phase: e.phase,
              digest: digestToolCall(e.tool, e.args),
              ok: e.ok,
              reason: e.reason,
            });
          }
          // D49ah: the plan is shown as it is set, and recorded so a reload
          // rebuilds it. Parsed with the same reader the tool itself used, so a
          // list the panel draws is a list the runner accepted — never a
          // half-read one.
          // D49as: the newest list is ALSO kept here, so the run's closing line
          // can say when it ended against its own plan. The panel draws every
          // list as it was set; this holds what the run FINISHED with.
          if (e.tool === 'todo_write' && e.phase === 'done') {
            const parsed = parseTodos(e.args['todos']);
            if ('todos' in parsed) {
              lastPlan = parsed.todos;
              this.push({ k: 'todo', todos: parsed.todos });
              void this.panel.webview.postMessage({
                type: 'todo',
                todos: parsed.todos,
              });
            }
          }
        },
        // D49av: the editor's verdict on a file Plato just changed, appended to
        // the result so the model learns in the SAME turn that it broke
        // something. `collect` never throws and returns `undefined`-equivalent
        // states, so a window with no language server simply appends nothing.
        afterToolResult: async (e) => {
          const snap = this.pendingDiag;
          this.pendingDiag = null;
          if (snap === null) return undefined;
          const result = await this.editorDiag.collect(snap, e.signal);
          // The notice is the RECORD: it says whether the editor was asked and
          // what it said. Without it, "the server found nothing" and "the server
          // was never reached" look identical in a transcript — and silence that
          // cannot be told from success is this codebase's oldest lesson.
          bus.emit({ type: 'notice', runId, text: describeDiagLook(result, snap) });
          if (result.kind !== 'found') return undefined;
          const block = formatDiagnostics(result.diagnostics, { root });
          return block.length > 0 ? block : undefined;
        },
      });
      ended = result.reason;
      // D49bo: kept on the host, because the queue's advance runs after this
      // method has returned and cannot see a local.
      this.lastRunEnd = ended;
      // D49j: a run cancelled mid-stream leaves text in the preview that never
      // reached a committed block. Fold it in before the reply is recorded.
      this.foldPreview();
      if (this.replyBuffer.trim().length > 0) {
        this.push({
          k: 'msg',
          cls: 'bot',
          who: 'Plato',
          text: this.replyBuffer,
        });
        this.replyBuffer = '';
      }
      // D49as: the run's own account of how it ended. `unfinishedPlanNote`
      // returns '' for a finished plan and for no plan at all, so this adds a
      // line only where one is earned.
      const endNotes: string[] = [];
      if (result.reason === 'cap') {
        endNotes.push('stopped early — output hit the token cap');
      } else if (result.reason === 'cancelled') {
        endNotes.push('cancelled');
      } else if (result.reason === 'stuck') {
        // D49aw: the sentence is written in core, so the closing line and the
        // record say the same thing — and it names what Plato was actually
        // doing, not "the same call repeated".
        endNotes.push(result.stuckNote ?? 'stopped — the run was repeating itself');
      }
      const unfinished = unfinishedPlanNote(lastPlan);
      if (unfinished !== '') endNotes.push(unfinished);
      // D49ay: the run is over and nobody is waiting, so this is the other free
      // moment to age out transcripts.
      this.sweepTranscripts();
      this.send('done', {
        note: endNotes.join(' · '),
        secs: Math.max(1, Math.round((Date.now() - started) / 1000)),
        tools: toolsUsed,
        tok: fmtTokens(result.inputTokens + result.outputTokens),
        cost: result.costUsd > 0 ? `\u2248$${result.costUsd.toFixed(4)}` : '',
        obs:
          observers.length > 0
            ? `observer ${observers.reduce(
                (s, o) => s + o.agent.checks,
                0,
              )} checks · ${observers.reduce(
                (s, o) => s + o.agent.interventions,
                0,
              )} interventions${this.obsExtras(observers)}`
            : '',
      });
    } catch (e) {
      // D49j: drop the streaming preview. This path has never recorded a
      // partial reply (it reports the failure and stops), so the preview is not
      // folded in — but it must not linger as state the next run would inherit.
      // A user CANCELLED run does record its partial text: it returns normally
      // with `reason === 'cancelled'`, not through here.
      this.streamPreview = '';
      this.cancelStreamTimer();
      // D49d: report what actually failed. This used to be one fixed sentence
      // for a 401, a 429 and a dead socket alike, while the provider's own
      // message — built by the adapter and carried on the error — was discarded
      // here by a bare `catch {}`.
      // D49u: say WHERE the request went and WHICH model it named. A provider
      // error alone cannot distinguish "the key is wrong" from "Plato sent your
      // Anthropic selection to LiteLLM" — and that second case looks identical
      // from the outside. One line makes the mismatch self-evident instead of a
      // mystery.
      const wentTo =
        conn.kind === 'openai'
          ? `${conn.id} (${conn.baseUrl ?? 'https://api.openai.com/v1'})`
          : `${conn.id} (api.anthropic.com)`;
      const text =
        `Sent to ${wentTo} for model "${parts?.model ?? ref}".\n` +
        describeError(e);
      this.send('error', text);
      this.push({ k: 'msg', cls: 'bot', who: 'Error', text });
    } finally {
      // D49bn: closing the panel is what stopped this run — whether the cancel
      // came from `dispose()` while it ran, or from the check above because the
      // panel went while the run was still being prepared. Written HERE, and
      // only here: a run still being prepared has no bus, and a notice emitted
      // before the first `run-started` is dropped for having no file to land in.
      if (this.disposed) {
        bus.emit({
          type: 'notice',
          runId,
          text: 'The chat panel closed, so the run stopped.',
        });
      }
      // D49bm: a pause that was asked for and never honoured. The loop only
      // stops at a safe point, and a turn that returns no tool calls ends the
      // run — so the request can simply run out of run. Without this line the
      // button read "Pausing...", the run ended, and nothing said why the pause
      // never landed. A cancel already narrates itself, so it is not repeated.
      if (this.pauseRequested && !this.pauseEverParked && ended !== 'cancelled') {
        const line = 'The run finished before the pause took effect.';
        bus.emit({ type: 'notice', runId, text: line });
        this.send('notice', line);
      }
      this.running = false;
      // D49aq: cleared with the run, so no later approval can report against a
      // run that has ended.
      this.runBus = null;
      // D49bj: and the id with it, so a mode switch between runs cannot be
      // filed against the run that just ended.
      this.currentRunId = '';
      // D44d: once idle, auto-fold the conversation tail on its cadence.
      this.scheduleAutoFold(conn, apiKey, ref);
      writer.close();
      for (const s of mcpServers) {
        s.stop();
      }
    }
  }

  /**
   * D49bo: start the head of the queue, if nothing is in the way.
   *
   * The single place the queue is drained, so "when does a queued message run?"
   * has one answer: when none is running, none is held, and the panel is open.
   */
  private advanceQueue(): void {
    // `runInFlight`, not `running`: a queued message may NOT start while a run is
    // still being prepared, or two runs share one controller and one webview.
    if (this.disposed || this.runInFlight || this.queueHeld) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.postQueue();
    this.startRun(next, {});
  }

  /** D49bo: the queue is host-authoritative; the view only draws what it is sent. */
  private postQueue(): void {
    void this.panel.webview.postMessage({
      type: 'queue',
      items: this.queue,
      held: this.queueHeld,
    });
  }

  /**
   * D49aq: put on the record what happened to an ask.
   *
   * The loop's `approval-requested` is emitted BEFORE the host is consulted, so
   * it says an ask was RAISED and never that a card was DRAWN. Both session
   * memories here answer without drawing one, so a run can carry two
   * `approval-requested` entries while the user saw a single card — which is
   * what the field-test page's claim ("an `approval-requested` entry per card")
   * got wrong. This is the event that makes the count readable from the file.
   */
  private noteApproval(
    via: 'shown' | 'session-memory' | 'session-approval',
    req: ApprovalRequest,
  ): void {
    this.runBus?.emit({
      type: 'approval-card',
      runId: req.runId,
      tool: req.tool,
      via,
    });
  }

  private async approve(req: ApprovalRequest): Promise<boolean> {
    // D49ak: in `edit`, a write is approve-once-per-file-per-session. This is the
    // half of the old `edit` that survived the merge into it — it is what makes
    // the merged mode quieter than the old `act`, which asked on every single
    // write. A `shell` call is NOT cached here: it asks every time, with the
    // card's own "approve all for this session" as the way to widen it.
    //
    // The tool test and the path list both come from core. They used to be a
    // local pair here, and the local list missed `apply_patch` — see the comment
    // on `isWriteTool`. `paths` is empty for a malformed patch, which falls
    // through to the card without remembering anything.
    if (this.mode === 'edit' && isWriteTool(req.tool)) {
      const paths = writePathsOf(req.tool, req.args);
      if (paths.length > 0 && paths.every((p) => this.sessionWrites.has(p))) {
        this.noteApproval('session-memory', req);
        return true;
      }
      const ok = await this.promptCard(req);
      if (ok) {
        for (const p of paths) {
          this.sessionWrites.add(p);
        }
        if (paths.length > 0) {
          // D49ba: passive, no actor, and "future edits" never said that Plato
          // stops asking. The path list stays, because it is the one part the
          // user needs.
          this.send('notice', `Plato will not ask again before editing ${paths.join(', ')}.`);
        }
      }
      return ok;
    }
    return this.promptCard(req);
  }

  /**
   * D49p: what a session approval is remembered against. For a tool that
   * contacts a host, that is the tool AND the host — an approval covers one
   * host, so "approve all" must not silently cover a different one reached
   * later by a redirect.
   */
  private approvalKey(req: ApprovalRequest): string {
    return req.host !== undefined && req.host.length > 0
      ? `${req.tool}:${req.host}`
      : req.tool;
  }

  /**
   * D49aw: put a stuck run to the user.
   *
   * This is the ONLY card `auto` will ever raise, and that is the point: `auto`
   * means "no card for every write", not "nobody is watching". The alternative
   * — stopping on its own — is silent, and a silent stop cannot be told apart
   * from a finished run. Cline and Roo both pause and ask here for the same
   * reason, and neither aborts.
   *
   * The row is written BEFORE the promise so a reload rebuilds the card: an
   * answer posted to a card the host is no longer waiting on is ignored, so an
   * old card left in the log is inert rather than dangerous.
   */
  private promptStuck(
    req: StuckRequest,
  ): Promise<{ action: 'continue' | 'stop'; guidance?: string }> {
    const card = stuckCard(req);
    this.push({ k: 'stuck-open', ...card });
    return new Promise((resolve) => {
      this.pendingStuck = resolve;
      // The card's own wording goes over the wire verbatim, so the live card and
      // a reloaded one cannot drift apart.
      void this.panel.webview.postMessage({ type: 'stuck', ...card });
    });
  }

  /**
   * D49bc: the owner's two protected-file lists, read and written from the panel.
   *
   * The store stays VS Code settings — the way the composer writes `plato.model`
   * — so the panel and a hand-edited settings.json cannot disagree, and a user
   * who prefers the editor keeps it. Global scope, like every other panel-written
   * setting: the entries are names and workspace-relative paths, and a workspace
   * override still wins for anyone who wants one.
   */
  private secretSetting(key: 'secrets.protect' | 'secrets.allow'): string[] {
    return readStringList(vscode.workspace.getConfiguration('plato'), key);
  }

  private async setSecretSetting(
    key: 'secrets.protect' | 'secrets.allow',
    values: string[],
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration('plato')
      .update(key, values, vscode.ConfigurationTarget.Global);
    // `onDidChangeConfiguration` re-applies the policy to core; this redraws the
    // list. The row appearing IS the confirmation, so success adds no flash.
    void this.sendSettings();
  }

  /**
   * D49bc: may Plato show this protected file in full?
   *
   * The answer is remembered for the session, so the card is drawn ONCE per file
   * however many times a run reads it — the difference between a question and a
   * nuisance. Core decides whether the file is a candidate at all (opaque
   * content never gets here); this decides what the user said.
   */
  private async revealProtected(rel: string): Promise<boolean> {
    if (this.revealedPaths.has(rel)) return true;
    const ok = await this.promptReveal(rel);
    if (ok) this.revealedPaths.add(rel);
    return ok;
  }

  private promptReveal(rel: string): Promise<boolean> {
    const card = revealCard(rel);
    // The row goes into the log BEFORE the promise, so a reload rebuilds the
    // card — an answer to a card the host is no longer waiting on is inert
    // rather than dangerous, the rule the undo and stuck cards both follow.
    this.push({ k: 'reveal-open', ...card });
    return new Promise((resolve) => {
      this.pendingReveal = resolve;
      void this.panel.webview.postMessage({ type: 'reveal', ...card });
    });
  }

  private promptCard(req: ApprovalRequest): Promise<boolean> {
    const key = this.approvalKey(req);
    // Check if this tool (and host) is already approved for this session
    if (this.sessionApprovals.has(key)) {
      // Same fault as the notice below: an internal key as the subject, and no
      // actor. What the user needs to know is why no card appeared.
      this.send('notice', 'Plato did not ask — you already allowed this for the session.');
      this.noteApproval('session-approval', req);
      return Promise.resolve(true);
    }
    this.noteApproval('shown', req);

    // D49ba: the copy goes into the log row as well as the wire, so a reloaded
    // card is rebuilt with the same heading the user first read.
    const heading = approvalHeading(req.tool, req.args);
    const allowAll = approvalAllowAll(req.tool, req.host);
    this.push({
      k: 'card-open',
      tool: req.tool,
      preview: req.preview ?? JSON.stringify(req.args).slice(0, 800),
      heading,
      allowAll,
    });
    return new Promise((resolve) => {
      this.pendingApproval = resolve;
      void this.panel.webview.postMessage({
        type: 'approval',
        tool: req.tool,
        sessionKey: key,
        // D49ba: the copy is built in core, where it is unit-tested, and sent
        // ready to draw. The view used to compose it from `tool`, which is how
        // the card came to read "Approve apply_diff?".
        heading,
        allowAll,
        headingAllowed: approvalAnswered(heading, true),
        headingDenied: approvalAnswered(heading, false),
        headingSession: approvalAnsweredSession(heading),
        ...(req.host !== undefined ? { host: req.host } : {}),
        preview: req.preview ?? JSON.stringify(req.args).slice(0, 800),
      });
    });
  }
}

export function deactivate(): void {}
