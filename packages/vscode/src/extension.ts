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
  createProvider,
  splitModelRef,
  modelSupportsReasoning,
  PROVIDER_PRESETS,
  fetchModelPool,
  maxContextFor,
  renderMarkdown,
  McpServer,
  loadMcpConfig,
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
  loadProjectFile,
  loadImageAttachment,
  looksLikeImage,
  DEFAULT_PLATO_BODY,
  slashCommand,
  slashMenu,
  COMPACT_SYSTEM_PROMPT,
  compactMaxTokensFor,
  PERSONAS,
  PHILOSOPHER_COLORS,
  ROLE_MAX_CHARS,
  colorHex,
  describeError,
} from '@applivity/plato-core';
import type { DigestEntry } from '@applivity/plato-core';
import type { TeamMember } from '@applivity/plato-core';
import type { DuoPhilosopher } from '@applivity/plato-core';
import type { ApprovalRequest, Mode, ImageMime } from '@applivity/plato-core';
import { chatHtml } from './webview.js';
import { isAbsolute, join, relative } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
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

export function activate(ctx: vscode.ExtensionContext): void {
  // One chat panel per window; re-running the command reveals it instead
  // of spawning a blank second one.
  let live: vscode.WebviewPanel | undefined;
  let host: ChatHost | undefined;

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
        if (live === panel) {
          // D41: archive on close so History fills without New Chat.
          void host?.dispose();
          live = undefined;
          host = undefined;
        }
      });
      live = panel;
      panel.webview.html = chatHtml();
      host = new ChatHost(panel, ctx);
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
const TITLE_KEY = 'plato.chatTitle';
const SESSIONS_KEY = 'plato.chatSessions';
const SESSIONS_MAX = 30;

interface StoredChat {
  id: string;
  title: string;
  ts: string;
  log: Entry[];
}

/**
 * Persisted chat entries. The log lives in workspaceState (survives
 * window reloads and restarts); the webview renders whatever it is given.
 */
type Entry =
  | { k: 'msg'; cls: string; who: string; text: string }
  | { k: 'tool'; tool: string; phase: string }
  | { k: 'card-open'; tool: string; preview: string }
  | { k: 'card-done'; title: string; preview: string }
  /** D44d: a folded conversation summary, standing in for trimmed turns. */
  | { k: 'compact'; text: string };

/** D44a: per-run context attachments add to a run. */
interface RunCtx {
  /** Root-relative pending attachment paths; content is read at run start. */
  attach?: string[];
  /** D49o: root-relative image paths, read as BYTES at run start. */
  images?: string[];
}

class ChatHost {
  private mode: Mode = 'act';
  private readonly sessionWrites = new Set<string>();
  private readonly sessionApprovals = new Set<string>();
  private controller = new RunController();
  private pendingApproval: PendingResolve | null = null;
  private pendingQuestion: ((answers: string[]) => void) | null = null;
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
  private modelOverride: string | null = null;
  private readonly log: Entry[];
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
  /** D47: watchers on ~/.plato/{duo,academy}.yaml (armed once Settings opens). */
  private homeWatchers: vscode.FileSystemWatcher[] = [];
  /** D47: ms of the last home-file write — swallows our own watcher echoes. */
  private lastHomeWrite = 0;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly ctx: vscode.ExtensionContext,
  ) {
    this.log = ctx.workspaceState.get<Entry[]>(LOG_KEY, []);
    // D40: the conversation title survives reloads with the log.
    this.chatTitle = ctx.workspaceState.get<string>(TITLE_KEY, '');
    this.panel.webview.onDidReceiveMessage(
      async (m: { type?: string; [k: string]: unknown }) => {
        if (m.type === 'mode' && typeof m.value === 'string') {
          this.mode = m.value as Mode;
          this.sessionWrites.clear();
          this.sessionApprovals.clear();
          this.send('notice', `Mode: ${this.mode}`);
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
          if (this.resolveConnection(m.value)) {
            this.modelOverride = m.value;
            void this.panel.webview.postMessage({
              type: 'notice',
              text: `Model set to ${m.value}`,
            });
            // Capability may have changed with the model (D28 phase 2).
            this.postModelState();
          } else {
            this.send('error', `Unknown connection in "${m.value}"`);
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
          this.send('notice', `${key} approved for this session`);
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
        if (m.type === 'pause' && this.running) {
          this.controller.pause();
          return;
        }
        if (m.type === 'resume' && this.running) {
          this.controller.resume();
          return;
        }
        if (m.type === 'cancel' && this.running) {
          // Unblock a waiting approval too, so cancel takes effect now.
          const r = this.pendingApproval;
          this.pendingApproval = null;
          r?.(false);
          this.controller.cancel();
          return;
        }
        if (m.type === 'openSettings') {
          this.ensureHomeWatch();
          void this.sendSettings();
          return;
        }
        if (m.type === 'openHistory') {
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
            const first = this.log.find(
              (e) => e.k === 'msg' && e.cls === 'you',
            );
            chats.unshift({
              id: '__current__',
              title:
                this.chatTitle ||
                ((first && first.k === 'msg' ? first.text : '') || 'Chat')
                  .slice(0, 80),
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
          return;
        }
        if (m.type === 'openRun' && typeof m.file === 'string') {
          this.openRun(m.file);
          return;
        }
        if (m.type === 'resumeChat' && typeof m.id === 'string') {
          const s = this.sessions().find((x) => x.id === m.id);
          if (s) {
            this.log.length = 0;
            this.log.push(...s.log.slice(-LOG_MAX));
            void this.ctx.workspaceState.update(LOG_KEY, this.log);
            // D40: resuming adopts the archived session's title.
            this.chatTitle = s.title || '';
            await this.ctx.workspaceState.update(TITLE_KEY, this.chatTitle);
            // D41: the resumed content is already in History — only
            // messages sent from here on should archive again.
            this.archivedUpTo = this.log.length;
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
            this.postModelState();
          }
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
        if (m.type === 'settings-models' && typeof m.connId === 'string') {
          const sel = Array.isArray(m.models)
            ? (m.models as unknown[]).filter(
                (x): x is string => typeof x === 'string',
              )
            : [];
          const user = rawUserConnections();
          const idx = user.findIndex((u) => u.id === m.connId);
          if (idx >= 0 && user[idx]) {
            user[idx].models = sel;
            if (!user[idx].allModels) {
              user[idx].allModels = sel;
            }
          } else {
            user.push({
              id: m.connId,
              kind: 'openai',
              models: sel,
              allModels: sel,
            });
          }
          await vscode.workspace.getConfiguration('plato').update(
            'connections',
            user,
            vscode.ConfigurationTarget.Global,
          );
          // Silent save (D29): refresh only the chat dropdown payload —
          // a full settings re-render would close the open details list.
          this.postModelState();
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
          this.pendingQuestion = null;
          resolve?.(m.answers.map(String));
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
        if (m.type === 'slash-run' && typeof m.id === 'string') {
          await this.runCommand(m.id);
          return;
        }
        if (m.type === 'ask' && typeof m.text === 'string') {
          // consume now
          const attach = this.pendingAttachments.splice(0);
          const images = this.pendingImages.splice(0);
          this.push({ k: 'msg', cls: 'you', who: 'You', text: m.text });
          void this.run(m.text, { attach, images });
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
          });
        }
      },
    );
  }

  private send(type: string, text?: unknown, meta?: Record<string, unknown>): void {
    void this.panel.webview.postMessage({
      type,
      text,
      // D47f: optional extras (e.g. a philosopher notice's colour) ride beside
      // `text` so existing handlers that read only `text` are unaffected.
      ...(meta ? { meta } : {}),
    });
  }

  // ---- D44a/D44c: paperclip attachment + real slash commands ------------

  private postSlashMeta(): void {
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
    return join(homedir(), '.plato');
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
      for (const name of ['DUO.yaml', 'ACADEMY.yaml']) {
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
  private async runCommand(id: string): Promise<void> {
    if (slashCommand(id) === undefined) {
      this.send('notice', 'Unknown command: /' + id);
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
    for (let i = this.log.length - 1; i >= 0; i -= 1) {
      if (this.log[i]!.k === 'compact') return i;
    }
    return -1;
  }

  /** Number of raw you/bot pairs sitting after the last summary. */
  private tailPairCount(): number {
    const c = this.lastCompactIndex();
    const tail = c < 0 ? this.log : this.log.slice(c + 1);
    return tail.filter(
      (e) => e.k === 'msg' && (e.cls === 'you' || e.cls === 'bot'),
    ).length;
  }

  /**
   * Fold the raw tail down to KEEP_AFTER_FOLD pairs: summarise everything
   * older (plus any prior summary) into a single compact entry and trim the
   * trimmed turns from the log. Returns true when a fold happened.
   */
  private async foldTail(
    conn: ConnectionConfig,
    apiKey: string,
    ref: string,
  ): Promise<boolean> {
    const c = this.lastCompactIndex();
    const tailEntries = c < 0 ? this.log : this.log.slice(c + 1);
    const prior =
      c >= 0 && this.log[c]!.k === 'compact' ? this.log[c]!.text : null;
    // Indexes of you/bot pairs within tailEntries, oldest first.
    const pairs: number[] = [];
    for (let i = 0; i < tailEntries.length; i += 1) {
      const e = tailEntries[i]!;
      if (e.k === 'msg' && (e.cls === 'you' || e.cls === 'bot')) pairs.push(i);
    }
    if (pairs.length <= KEEP_AFTER_FOLD) return false;
    const foldCount = pairs.length - KEEP_AFTER_FOLD;
    const boundary = pairs[foldCount]!;
    const older = pairs.slice(0, foldCount).map((i) => tailEntries[i]!);
    const keepEntries = tailEntries.slice(boundary);

    const blocks: string[] = [];
    if (prior !== null) {
      blocks.push('[existing summary of the earlier conversation]\n' + prior);
    }
    for (const e of older) {
      const m = e as Extract<Entry, { k: 'msg' }>;
      blocks.push(
        '--- ' + (m.cls === 'you' ? 'USER' : 'ASSISTANT') + ' ---\n' + m.text,
      );
    }
    const provider = createProvider(conn.kind, {
      apiKey,
      baseUrl:
        conn.kind === 'openai'
          ? conn.baseUrl ?? 'https://api.openai.com/v1'
          : undefined,
    });
    const res = await provider.completeTurn({
      model: ref,
      system: COMPACT_SYSTEM_PROMPT,
      tools: [],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Summarise the following conversation so the assistant can continue without it. Be terse and fact-only.\n\n' +
                blocks.join('\n\n'),
            },
          ],
        },
      ],
      maxTokens: compactMaxTokensFor(ref),
    });
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .trim();
    if (text.length === 0) return false;

    this.log.length = 0;
    this.log.push({ k: 'compact', text } as Entry, ...keepEntries);
    if (this.log.length > LOG_MAX) {
      this.log.splice(0, this.log.length - LOG_MAX);
    }
    await this.ctx.workspaceState.update(LOG_KEY, this.log);
    // A fold rewrote (and shrank) the log: let the next archive snapshot the
    // folded conversation instead of being skipped by the growth guard.
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
    this.send(
      'notice',
      'Compacted ' + foldCount + ' earlier messages into a summary.',
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
        if (this.pendingApproval !== null || this.pendingQuestion !== null) {
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

  /** D34: ask_user — posts stacked question cards (one per question). */
  private askUser(req: {
    questions: {
      question: string;
      context?: string;
      options: string[];
      recommended?: string;
    }[];
  }): Promise<string[]> {
    return new Promise((resolve) => {
      this.pendingQuestion = resolve;
      void this.panel.webview.postMessage({
        type: 'user-question',
        questions: req.questions,
      });
    });
  }
  private async sendSettings(flash?: string): Promise<void> {
    const userRaw = new Set(rawUserConnections().map((u) => u.id));
    const connections = [];
    for (const c of readConnections()) {
      const keyStatus =
        (await this.ctx.secrets.get(`plato.providers.${c.id}.apiKey`)) !==
        undefined
          ? 'set'
          : 'missing';
      connections.push({
        id: c.id,
        kind: c.kind,
        baseUrl: c.baseUrl ?? '',
        models: c.models ?? [],
        // Picker pool: fetched list when present, else the selection.
        all: c.allModels && c.allModels.length > 0 ? c.allModels : (c.models ?? []),
        keyStatus,
        builtin: !userRaw.has(c.id),
      });
    }
    void this.panel.webview.postMessage({
      type: 'settings',
      connections,
      defaultModel: this.effectiveModel(),
      modelItems: this.modelItems(),
      reasoning: vscode.workspace
        .getConfiguration('plato')
        .get<string>('reasoning', 'off'),
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
  /**
   * D49p: the domain lists `web_fetch` enforces. `deny` wins over `allow`, and an
   * empty `allow` list permits any public host. Read from settings so the lists
   * can change without a rebuild — **the panel UI for editing them does not exist
   * yet** (D49q), so today they are config-only, which is a deliberate interim
   * state rather than the D45c "UI first" rule being met.
   */
  private netState(): { allow: string[]; deny: string[] } {
    const cfg = vscode.workspace.getConfiguration('plato');
    const list = (key: string): string[] => {
      const v = cfg.get<unknown>(key, []);
      return Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
    };
    return { allow: list('net.allow'), deny: list('net.deny') };
  }

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
   * D41: archive the conversation when the panel closes, so History
   * lists past chats even without an explicit New Chat. The log itself
   * stays persisted, so reopening the panel continues the conversation.
   */
  async dispose(): Promise<void> {
    for (const w of this.homeWatchers) {
      w.dispose();
    }
    this.homeWatchers = [];
    await this.archiveCurrentChat();
  }

  /**
   * Prior conversation for LLM context. D44d: instead of a hard "last 12
   * pairs, drop the rest", the context is the running conversation summary
   * (if a fold has happened) followed by the raw tail since it — the fold
   * cadence keeps that tail bounded. MAX_TAIL_PAIRS is only a safety cap.
   */
  private historyFor(): { role: 'user' | 'assistant'; text: string }[] {
    const base = this.log.slice(0, -1); // exclude the entry for the task being sent now
    let c = -1;
    for (let i = base.length - 1; i >= 0; i -= 1) {
      if (base[i]!.k === 'compact') {
        c = i;
        break;
      }
    }
    const out: { role: 'user' | 'assistant'; text: string }[] = [];
    const compactEntry =
      c >= 0 && base[c]!.k === 'compact' ? base[c] : undefined;
    if (compactEntry !== undefined && compactEntry.k === 'compact') {
      out.push({
        role: 'user',
        text: '[Summary of the earlier conversation]\n' + compactEntry.text,
      });
    }
    const tail = c < 0 ? base : base.slice(c + 1);
    const pairs = tail
      .filter((e): e is Extract<Entry, { k: 'msg' }> =>
        e.k === 'msg' && (e.cls === 'you' || e.cls === 'bot'))
      .slice(-MAX_TAIL_PAIRS);
    for (const e of pairs) {
      out.push({
        role: e.cls === 'you' ? ('user' as const) : ('assistant' as const),
        text: e.text,
      });
    }
    return out;
  }

  // ---- Transcript replay (M3) -------------------------------------------

  private runsDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? join(this.homePlatoDir(), 'runs', this.projectKey(root)) : null;
  }

  private listRuns(): Record<string, unknown>[] {
    const dir = this.runsDir();
    if (!dir) {
      return [];
    }
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
    } catch {
      return [];
    }
    const runs: Record<string, unknown>[] = [];
    for (const f of files) {
      try {
        const lines = readFileSync(join(dir, f), 'utf8')
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
    if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(file) || file.includes('..')) {
      this.send('error', 'Bad run file.');
      return;
    }
    const dir = this.runsDir();
    if (!dir) {
      return;
    }
    try {
      const lines = readFileSync(join(dir, file), 'utf8')
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
      this.log.splice(0, this.log.length - LOG_MAX);
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
    this.pendingAttachments = [];
    this.pendingHistory = null;
    this.pendingApproval = null;
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

  /** Session override, else the plato.model workspace setting. */
  private effectiveModel(): string {
    const configured =
      this.modelOverride ??
      vscode.workspace
        .getConfiguration('plato')
        .get<string>('model', 'anthropic:claude-sonnet-4-5');
    // D43: the built-in seeds are gone — if the configured ref's
    // connection no longer exists, fall back to the first selectable
    // model so the header dropdown and academy example stay coherent.
    if (this.resolveConnection(configured)) {
      return configured;
    }
    return this.modelItems()[0]?.value ?? configured;
  }

  private resolveConnection(ref: string): ConnectionConfig | null {
    const parts = splitModelRef(ref);
    if (!parts) {
      return null;
    }
    return (
      readConnections().find((c) => c.id === parts.connectionId) ?? null
    );
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
        baseUrl:
          conn.kind === 'openai'
            ? conn.baseUrl ?? 'https://api.openai.com/v1'
            : undefined,
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
      for (const m of c.models ?? []) {
        const poolEntry = poolByName.get(m);
        // Catalog wins (D26c stability) when the bare name is known.
        // Otherwise fall back to what the /models payload advertised.
        const maxContext =
          maxContextFor(m) ?? poolEntry?.maxContext ?? null;
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

  private reasoningFor():
    | { effort: 'low' | 'medium' | 'high' }
    | undefined {
    const v = vscode.workspace.getConfiguration('plato').get<string>(
      'reasoning',
      'off',
    );
    return v === 'off' ? undefined : { effort: v as 'low' | 'medium' | 'high' };
  }

  private async run(task: string, ctx: RunCtx = {}): Promise<void> {
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
    this.replyBuffer = '';
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
    // M2: every run is transcribed under ~/.plato/runs/<project-key>/ (D24c,
    // D46) — personal state, never the shared repo.
    const bus = new AgentBus();
    const writer = new TranscriptWriter(
      join(this.homePlatoDir(), 'runs', this.projectKey(root)),
      { task, root },
    );
    writer.attach(bus);
    // MCP servers (D06, D46): read from ~/.plato/mcp.yaml; failures degrade
    // to zero tools for that server, never break the run.
    const mcpServers: McpServer[] = [];
    try {
      const cfg = loadMcpConfig(this.homePlatoDir());
      for (const [name, c] of Object.entries(cfg)) {
        const srv = new McpServer(name, c);
        try {
          await srv.start(20_000);
          mcpServers.push(srv);
          if (srv.tools.length > 0) {
            this.send(
              'notice',
              `MCP ${name}: ${srv.tools.length} tools available`,
            );
          }
        } catch (e) {
          this.send(
            'notice',
            `MCP ${name} failed to start — ${
              e instanceof Error ? e.message : 'error'
            }`,
          );
        }
      }
    } catch (e) {
      this.send(
        'notice',
        `mcp.yaml ignored — ${e instanceof Error ? e.message : 'error'}`,
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
          baseUrl: oConn.kind === 'openai' ? oConn.baseUrl : undefined,
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
    this.controller = new RunController();
    this.running = true;
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
        this.push({ k: 'msg', cls: 'sys', who: 'Plato', text: e.text });
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
        ...(runImages.length > 0 ? { images: runImages } : {}),
        approve: (req) => this.approve(req),
        getMode: () => this.mode,
        bus,
        controller: this.controller,
        askUser: async (req) => {
          const answer = await this.askUser(req);
          return answer;
        },
        provider: createProvider(conn.kind, {
          apiKey,
          baseUrl:
            conn.kind === 'openai'
              ? conn.baseUrl ?? 'https://api.openai.com/v1'
              : undefined,
        }),
        model: ref,
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
        net: this.netState(),
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
          void this.panel.webview.postMessage({
            type: 'tool',
            tool: e.tool,
            phase: e.phase,
            ok: e.ok,
          });
          if (e.phase === 'done' || e.phase === 'denied' || e.phase === 'declined') {
            this.push({ k: 'tool', tool: e.tool, phase: e.phase });
          }
        },
      });
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
      this.send('done', {
        note:
          result.reason === 'cap'
            ? result.truncated
              ? 'stopped early — output hit the token cap'
              : 'stopped at turn cap'
            : result.reason === 'cancelled'
              ? 'cancelled'
              : '',
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
      const text = describeError(e);
      this.send('error', text);
      this.push({ k: 'msg', cls: 'bot', who: 'Error', text });
    } finally {
      this.running = false;
      // D44d: once idle, auto-fold the conversation tail on its cadence.
      this.scheduleAutoFold(conn, apiKey, ref);
      writer.close();
      for (const s of mcpServers) {
        s.stop();
      }
    }
  }

  private async approve(req: ApprovalRequest): Promise<boolean> {
    // edit mode: writes are approve-once-per-session per file (D22c)
    if (this.mode === 'edit' && isWriteTool(req.tool)) {
      const key = String(req.args['path'] ?? '');
      if (this.sessionWrites.has(key)) {
        return true;
      }
      const ok = await this.promptCard(req);
      if (ok) {
        this.sessionWrites.add(key);
        this.send('notice', `Session-approved future edits to ${key}`);
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

  private promptCard(req: ApprovalRequest): Promise<boolean> {
    const key = this.approvalKey(req);
    // Check if this tool (and host) is already approved for this session
    if (this.sessionApprovals.has(key)) {
      this.send('notice', `${key} auto-approved (session approval)`);
      return Promise.resolve(true);
    }

    this.push({
      k: 'card-open',
      tool: req.tool,
      preview: req.preview ?? JSON.stringify(req.args).slice(0, 800),
    });
    return new Promise((resolve) => {
      this.pendingApproval = resolve;
      void this.panel.webview.postMessage({
        type: 'approval',
        tool: req.tool,
        sessionKey: key,
        ...(req.host !== undefined ? { host: req.host } : {}),
        preview: req.preview ?? JSON.stringify(req.args).slice(0, 800),
      });
    });
  }
}

function isWriteTool(tool: string): boolean {
  return tool === 'write_file' || tool === 'apply_diff';
}

export function deactivate(): void {}
