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
  TeamConfigError,
  legacyConfigAtRoot,
  isSecretPath,
  loadProjectFile,
  slashCommand,
  slashMenu,
  modeForRun,
  needsGitContext,
  PERSONAS,
  findPersona,
} from '@applivity/plato-core';
import type { DigestEntry } from '@applivity/plato-core';
import type { TeamMember } from '@applivity/plato-core';
import type { ApprovalRequest, Mode } from '@applivity/plato-core';
import type { SlashCommandId } from '@applivity/plato-core';
import { chatHtml } from './webview.js';
import { isAbsolute, join, relative } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

const LEGACY_KEY = 'plato.anthropicApiKey'; // pre-0.3.0 anthropic slot

// D44a hard caps (spec: constants in v1, settings later). The per-file cap
// follows loadProjectFile's char semantics — 200 KB measured in characters.
const MAX_ATTACH_FILES = 20;
const MAX_ATTACH_BYTES = 200 * 1024;
const MAX_GIT_CHARS = 60_000;

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
  | { k: 'card-done'; title: string; preview: string };

/** D44a: per-run context a slash command or attachment adds to a run. */
interface RunCtx {
  /** The picked slash command id, if the message began as one. */
  cmd?: SlashCommandId;
  /** Root-relative pending attachment paths; content is read at run start. */
  attach?: string[];
}

class ChatHost {
  private mode: Mode = 'act';
  private readonly sessionWrites = new Set<string>();
  private readonly sessionApprovals = new Set<string>();
  private controller = new RunController();
  private pendingApproval: PendingResolve | null = null;
  private pendingQuestion: ((answers: string[]) => void) | null = null;
  private replyBuffer = '';
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
  /** D44a: active for-the-run mode force (null = none). */
  private forcedMode: Mode | null = null;
  /** D44a: mode to restore when the forced run ends (unless the user overrides). */
  private forcedModePrev: Mode | null = null;

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
          // D44a: a manual mode change mid-run cancels any for-the-run force —
          // never auto-restore over the user's explicit choice.
          this.forcedMode = null;
          this.forcedModePrev = null;
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
          this.sessionApprovals.add(m.tool);
          // The waiting card must resolve too — the loop is blocked on it.
          const resolve = this.pendingApproval;
          this.pendingApproval = null;
          resolve?.(true);
          this.send('notice', `${m.tool} approved for this session`);
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
        if (m.type === 'set-observer') {
          const cfg = vscode.workspace.getConfiguration('plato');
          if (typeof m.enable === 'boolean') {
            await cfg.update(
              'observer.enable',
              m.enable,
              vscode.ConfigurationTarget.Global,
            );
          }
          if (typeof m.model === 'string') {
            await cfg.update(
              'observer.model',
              m.model,
              vscode.ConfigurationTarget.Global,
            );
          }
          if (typeof m.pause === 'boolean') {
            await cfg.update(
              'observer.pause',
              m.pause,
              vscode.ConfigurationTarget.Global,
            );
          }
          if (typeof m.cancel === 'boolean') {
            await cfg.update(
              'observer.cancel',
              m.cancel,
              vscode.ConfigurationTarget.Global,
            );
          }
          if (typeof m.maxInterventions === 'number') {
            await cfg.update(
              'observer.maxInterventions',
              Math.max(1, Math.round(m.maxInterventions)),
              vscode.ConfigurationTarget.Global,
            );
          }
          void this.sendSettings(
            'Observer updated — applies from the next run.',
          );
          return;
        }
        if (m.type === 'set-orchestration' && typeof m.mode === 'string') {
          const mode =
            m.mode === 'duo' || m.mode === 'academy' ? m.mode : 'solo';
          // Loud at selection time too (D32a): Academy needs a valid file.
          if (mode === 'academy') {
            const st = this.academyStatus();
            if (!st.available) {
              void this.sendSettings(
                `Academy not set — ${st.error}`,
              );
              return;
            }
          }
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
        if (m.type === 'set-duo-persona' && typeof m.persona === 'string') {
          if (findPersona(m.persona)) {
            await vscode.workspace
              .getConfiguration('plato')
              .update(
                'duo.persona',
                m.persona,
                vscode.ConfigurationTarget.Global,
              );
          }
          void this.sendSettings('Philosopher updated — applies from the next run.');
          return;
        }
        if (m.type === 'create-academy') {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) {
            return;
          }
          const file = vscode.Uri.joinPath(folder.uri, '.plato', 'academy.yaml');
          try {
            // Pre-fill the worker with the user's current default model so
            // the example is runnable as-is (D33).
            const model = this.effectiveModel();
            const body = this.academyExample(model);
            await vscode.workspace.fs.createDirectory(
              vscode.Uri.joinPath(folder.uri, '.plato'),
            );
            await vscode.workspace.fs.writeFile(
              file,
              Buffer.from(body, 'utf8'),
            );
            void this.sendSettings(
              'academy.yaml created — edit members, then pick Academy.',
            );
            void vscode.window.showTextDocument(file);
          } catch (e) {
            void this.sendSettings(
              `Could not create academy.yaml — ${
                e instanceof Error ? e.message : 'error'
              }`,
            );
          }
          return;
        }
        if (m.type === 'open-academy') {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) {
            return;
          }
          const file = vscode.Uri.joinPath(
            folder.uri,
            '.plato',
            'academy.yaml',
          );
          try {
            await vscode.workspace.fs.stat(file);
            void vscode.window.showTextDocument(file);
          } catch {
            void this.sendSettings('.plato/academy.yaml not found.');
          }
          return;
        }
        // D37: header pill toggle for compaction mode. The Compact
        // button posts `request-compact` instead; both share the same
        // run-side handler below.
        if (m.type === 'set-compaction-mode' && typeof m.mode === 'string') {
          const mode = m.mode === 'manual' ? 'manual' : 'auto';
          await vscode.workspace.getConfiguration('plato').update(
            'compaction.mode',
            mode,
            vscode.ConfigurationTarget.Global,
          );
          this.postModelState();
          return;
        }
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
          if (this.running) {
            this.controller.requestCompact();
            this.send('notice', 'Plato will compact the conversation at the next safe point.');
          }
          return;
        }
        if (m.type === 'user-answer' && Array.isArray(m.answers)) {
          const resolve = this.pendingQuestion;
          this.pendingQuestion = null;
          resolve?.(m.answers.map(String));
          return;
        }
        // ---- D44a: slash commands + file attachment ----
        if (m.type === 'attach') {
          await this.openAttachmentPicker();
          return;
        }
        if (m.type === 'attach-remove' && typeof m.path === 'string') {
          this.pendingAttachments = this.pendingAttachments.filter(
            (p) => p !== m.path,
          );
          return;
        }
        if (m.type === 'attach-clear') {
          this.pendingAttachments = [];
          return;
        }
        if (m.type === 'slash-choose' && typeof m.id === 'string') {
          const cmd = slashCommand(m.id);
          const args = typeof m.args === 'string' ? m.args : '';
          const text = cmd?.expand(args) ?? '';
          // /review args are file paths: they become pending attachments
          // (chips), never echoed in the expansion text.
          const root = this.workspaceRoot();
          const result =
            cmd?.id === 'review' && root !== null
              ? await this.attachFiles(
                  root,
                  args.trim().split(/\s+/).filter(Boolean),
                )
              : { accepted: [], rejected: [] };
          void this.panel.webview.postMessage({
            type: 'slash-expand',
            id: cmd?.id ?? m.id,
            text,
            ...result,
          });
          return;
        }
        if (m.type === 'ask' && typeof m.text === 'string') {
          const cmd =
            typeof m.cmd === 'string' ? (m.cmd as SlashCommandId) : undefined;
          const attach = this.pendingAttachments.splice(0); // consume now
          this.push({ k: 'msg', cls: 'you', who: 'You', text: m.text });
          void this.run(m.text, { cmd, attach });
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

  private send(type: string, text?: unknown): void {
    void this.panel.webview.postMessage({ type, text });
  }

  // ---- D44a: slash commands + paperclip attachment ----------------------

  private postSlashMeta(): void {
    void this.panel.webview.postMessage({
      type: 'slash-meta',
      commands: slashMenu(),
    });
  }

  private workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
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
    accepted: { path: string }[];
    rejected: { path: string; error: string }[];
  }> {
    const accepted: { path: string }[] = [];
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

  /** /commit: a read-only git snapshot the model sees as injected context. */
  private gitSnapshot(root: string): Promise<string> {
    const capture = (args: string[]): Promise<string> =>
      new Promise((resolve) => {
        execFile(
          'git',
          ['-C', root, ...args],
          { maxBuffer: 2 * 1024 * 1024 },
          (err, stdout) => {
            if (err) {
              const msg = String(err.message).split('\n')[0];
              resolve(`git ${args.join(' ')} failed: ${msg}`);
            } else {
              resolve(String(stdout).slice(0, MAX_GIT_CHARS));
            }
          },
        );
      });
    return (async () => {
      const status = await capture(['status', '--porcelain']);
      const diff = await capture(['diff']);
      return (
        '\n\n[host: git status + diff for /commit — read-only snapshot]\n' +
        'git status --porcelain:\n' +
        status +
        '\ngit diff (unstaged):\n' +
        diff
      );
    })();
  }

  /** The model-visible task: user text + attached files + /commit git context. */
  private async buildModelTask(task: string, ctx: RunCtx, root: string): Promise<string> {
    let out = task;
    for (const rel of ctx.attach ?? []) {
      const r = await loadProjectFile(rel, root, MAX_ATTACH_BYTES);
      if (r.found) {
        out += '\n\n[attachment: ' + rel + ']\n```\n' + r.body + '\n```';
      }
    }
    if (needsGitContext(ctx.cmd)) {
      out += await this.gitSnapshot(root);
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
      observer: {
        enable: vscode.workspace
          .getConfiguration('plato')
          .get('observer.enable', false),
        model: vscode.workspace
          .getConfiguration('plato')
          .get('observer.model', ''),
        pause: vscode.workspace
          .getConfiguration('plato')
          .get('observer.pause', false),
        cancel: vscode.workspace
          .getConfiguration('plato')
          .get('observer.cancel', false),
        maxInterventions: vscode.workspace
          .getConfiguration('plato')
          .get('observer.maxInterventions', 5),
      },
      orchestration: {
        mode: vscode.workspace
          .getConfiguration('plato')
          .get<'solo' | 'duo' | 'academy'>('orchestration', 'solo'),
        persona: vscode.workspace
          .getConfiguration('plato')
          .get('duo.persona', 'aristotle'),
        personas: PERSONAS.map((p) => ({
          id: p.id,
          name: p.name,
          epithet: p.epithet,
          role: p.role,
        })),
        academy: this.academyStatus(),
      },
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

  /** Example academy.yaml body for the Create-example button (D33). */
  private academyExample(model: string): string {
    return [
      '# Plato academy (D31/D32/D33). Activate in Settings -> Orchestration -> Academy.',
      '# The worker does the work; philosophers watch and steer. Philosophers NEVER approve tool calls.',
      'academy:',
      '  name: my-academy',
      '',
      'members:',
      '  - name: plato',
      '    model: ' + model,
      '    role: "You fix bugs. Enumerate defects, fix them, re-verify."',
      '    kind: worker',
      '',
      '  - name: aristotle',
      '    kind: philosopher',
      '    model: ' + model,
      '    guidance: true',
      '    pause: false',
      '    cancel: false',
      '    maxInterventions: 3',
      '',
    ].join('\n');
  }

  /** Academy availability for the Settings page (D32/D33): file or error. */
  private academyStatus(): {
    available: boolean;
    name: string;
    members: { name: string; kind: string; model: string }[];
    error: string;
    legacy: boolean;
  } {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return { available: false, name: '', members: [], error: '', legacy: false };
    }
    // D33: configs live in .plato/ — anything at the ROOT is not ours to
    // interpret; ask the user to move it rather than guess.
    const legacy = legacyConfigAtRoot(root);
    if (legacy !== null) {
      return {
        available: false,
        name: '',
        members: [],
        error: `"${legacy}" found at the workspace root — configs moved to .plato/ (D33). Move the file to .plato/academy.yaml${legacy === 'teams.yaml' ? ' (and rename it — it was renamed by D32)' : ''}.`,
        legacy: true,
      };
    }
    try {
      const team = loadTeamConfig(root);
      if (team === null) {
        return {
          available: false,
          name: '',
          members: [],
          error: 'No .plato/academy.yaml yet — create the example below.',
          legacy: false,
        };
      }
      return {
        available: true,
        name: team.name,
        members: team.members.map((m) => ({
          name: m.name,
          kind: m.kind,
          model: m.model,
        })),
        error: '',
        legacy: false,
      };
    } catch (e) {
      return {
        available: false,
        name: '',
        members: [],
        error: e instanceof Error ? e.message : 'error',
        legacy: false,
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
      reasoningCapable: this.reasoningCapable(),
      reasoning: vscode.workspace
        .getConfiguration('plato')
        .get<string>('reasoning', 'off'),
      orchestration: vscode.workspace
        .getConfiguration('plato')
        .get<'solo' | 'duo' | 'academy'>('orchestration', 'solo'),
      academy: this.academyStatus(),
      persona: vscode.workspace
        .getConfiguration('plato')
        .get('duo.persona', 'aristotle'),
      // D37: live context UI state.
      compaction: this.compactionState(),
    });
  }

  /**
   * D37: shape used by the webview header pill + settings slider.
   * `mode` defaults to auto so first-time users get the safe default;
   * `threshold` is clamped to [0.5, 0.95] in the loop itself.
   */
  private compactionState(): { mode: 'auto' | 'manual'; threshold: number } {
    const cfg = vscode.workspace.getConfiguration('plato');
    const mode = cfg.get<'auto' | 'manual' | string>(
      'compaction.mode',
      'auto',
    );
    const threshold = cfg.get<number>('compaction.threshold', 0.8);
    return {
      mode: mode === 'manual' ? 'manual' : 'auto',
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
    await this.archiveCurrentChat();
  }

  /** Prior conversation for LLM context (text pairs, capped). */
  private historyFor(): { role: 'user' | 'assistant'; text: string }[] {
    return this.log
      .slice(0, -1) // exclude the entry for the task being sent now
      .filter((e): e is Extract<Entry, { k: 'msg' }> =>
        e.k === 'msg' && (e.cls === 'you' || e.cls === 'bot'))
      .slice(-12)
      .map((e) => ({
        role: e.cls === 'you' ? ('user' as const) : ('assistant' as const),
        text: e.text,
      }));
  }

  // ---- Transcript replay (M3) -------------------------------------------

  private runsDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? join(root, '.plato', 'runs') : null;
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
    this.pendingApproval = null;
    this.replyBuffer = '';
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
    // Academy (D31/D32): academy.yaml at the root defines the council.
    // Validation is loud — a broken file aborts the run before it starts.
    let team: ReturnType<typeof loadTeamConfig> = null;
    try {
      team = loadTeamConfig(root);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (orchestration === 'academy') {
        this.send(
          'error',
          e instanceof TeamConfigError
            ? msg
            : `academy.yaml could not be read — ${msg}`,
        );
        return;
      }
      // Not in Academy mode: the file is present but inert. Say so once.
      this.send(
        'notice',
        `academy.yaml has a problem but is not active (orchestration: ${orchestration}) — ${msg}`,
      );
    }
    if (team === null && orchestration === 'academy') {
      const legacy = legacyConfigAtRoot(root);
      this.send(
        'error',
        legacy !== null
          ? `"${legacy}" found at the workspace root — configs live in .plato/ (D33). Move it to .plato/academy.yaml${legacy === 'teams.yaml' ? ' (renamed from teams.yaml by D32)' : ''}.`
          : 'Academy mode needs .plato/academy.yaml — create it from Settings → Orchestration → Create example, or switch to Solo/Duo.',
      );
      return;
    }
    if (team !== null && orchestration !== 'academy') {
      this.send(
        'notice',
        `academy.yaml detected but not active (orchestration: ${orchestration}) — switch to Academy in Settings to use it.`,
      );
    }
    const useAcademy = orchestration === 'academy' && team !== null;
    const workerMember: TeamMember | undefined = useAcademy
      ? team?.members.find((m) => m.kind === 'worker')
      : undefined;
    if (useAcademy && team) {
      this.send('notice', `Academy "${team.name || 'unnamed'}" active`);
      this.send('team', {
        name: team.name,
        members: team.members.map((m) => ({
          name: m.name,
          kind: m.kind,
          model: m.model,
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
    // Resolve the composite ref to a connection profile (D26a). The academy
    // worker's model wins over the chat dropdown choice (D31d/e).
    const ref = workerMember?.model ?? this.effectiveModel();
    const parts = splitModelRef(ref);
    const conn = parts
      ? readConnections().find((c) => c.id === parts.connectionId) ?? null
      : null;
    if (!conn) {
      this.send(
        'error',
        `Unknown connection in "${ref}"${
          workerMember ? ` (academy.yaml member '${workerMember.name}')` : ''
        }. Configured: ${readConnections()
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
    // D41: name the conversation from the prompt immediately — the
    // title arrives a second or two into the run, not after it.
    void this.maybeGenerateTitle(conn, apiKey, ref, task);
    const started = Date.now();
    let toolsUsed = 0;
    // M2: every run is transcribed under <root>/.plato/runs/ (D24c).
    const bus = new AgentBus();
    const writer = new TranscriptWriter(join(root, '.plato', 'runs'), {
      task,
      root,
    });
    writer.attach(bus);
    // MCP servers (D06): start from <root>/mcp.yaml; failures degrade
    // to zero tools for that server, never break the run.
    const mcpServers: McpServer[] = [];
    try {
      const cfg = loadMcpConfig(root);
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
    // Philosophers (D30 + D32): academy.yaml members in Academy mode; the
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
          });
        }
      }
    } else if (orchestration === 'duo') {
      const c = vscode.workspace.getConfiguration('plato');
      const personaId = c.get<string>('duo.persona', 'aristotle');
      const persona = findPersona(personaId) ?? PERSONAS[0]!;
      const customRole = c.get('observer.role', '');
      obsSpecs.push({
        name: persona.name,
        ref: c.get<string>('observer.model', '') || ref,
        // A custom role overrides the persona prompt; otherwise the persona
        // IS the role (D32b).
        role: customRole.length > 0 ? customRole : persona.role,
        guidance: true, // D30b: guidance tier always on
        pause: c.get('observer.pause', false),
        cancel: c.get('observer.cancel', false),
        maxInterventions: c.get('observer.maxInterventions', 5),
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
      observers.push({ agent, name });
      const digest: DigestEntry[] = [];
      let observing = true;
      let errNotified = false;
      let parseErrNotified = false;
      this.send('notice', `[${name}] watching — ${spec.ref}`);
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
                  );
                }
                if (agent.parseErrors > 0 && !parseErrNotified) {
                  parseErrNotified = true;
                  this.send(
                    'notice',
                    `[${name}] reply not parseable as JSON (${agent.parseErrors} so far) — try a stronger model or tighten the role prompt`,
                  );
                }
                if (a.action === 'guidance') {
                  interventionsUsed += 1;
                  this.controller.sendGuidance(a.message);
                  this.send('notice', `[${name}] guidance: ${a.message}`);
                } else if (a.action === 'pause') {
                  interventionsUsed += 1;
                  this.controller.pause();
                  this.send('notice', `[${name}] paused the run`);
                } else if (a.action === 'cancel') {
                  interventionsUsed += 1;
                  this.controller.cancel();
                  this.send('notice', `[${name}] cancelled the run`);
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
      // D44a: a slash command may force the mode "for the run". Flip before
      // the loop starts (getMode() reads live per tool decision); restore in
      // the finally unless the user changed the mode mid-run.
      const runMode = modeForRun(ctx.cmd, this.mode);
      if (runMode !== this.mode) {
        this.forcedModePrev = this.mode;
        this.mode = runMode;
        this.forcedMode = runMode;
        void this.panel.webview.postMessage({ type: 'forced-mode', mode: runMode });
      }
      const modelTask = await this.buildModelTask(task, ctx, root);
      const result = await runAgentLoop({
        root,
        task: modelTask,
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
        role: workerMember?.role,
        // D45a: opt-out for the PLATO.md + AGENTS.md layers. Default true;
        // the host reads `plato.worker.includeProjectRules` (workspace
        // setting). The loop calls buildWorkerRole() to assemble the
        // joined worker system prompt.
        includeProjectRules: vscode.workspace
          .getConfiguration('plato')
          .get<boolean>('worker.includeProjectRules', true),
        ...(parts && modelSupportsReasoning(parts.model)
          ? { reasoning: this.reasoningFor() }
          : {}),
        history: this.historyFor(),
        mcpServers,
        // D37: context compaction. Mode + threshold come from settings
        // (the header pill toggles mode; the slider sets threshold).
        compact: this.compactionState(),
        onText: (t) => {
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
    } catch {
      this.send('error', 'Provider request failed. Check the API key and network.');
      this.push({
        k: 'msg',
        cls: 'bot',
        who: 'Error',
        text: 'Provider request failed. Check the API key and network.',
      });
    } finally {
      this.running = false;
      // D44a: lift the for-the-run mode force and restore the prior mode,
      // unless the user changed the mode mid-run (the 'mode' handler then
      // cleared forcedMode and we leave their choice alone).
      if (this.forcedMode !== null) {
        this.mode = this.forcedModePrev as Mode;
        this.forcedMode = null;
        this.forcedModePrev = null;
        void this.panel.webview.postMessage({ type: 'forced-mode', mode: null });
      }
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

  private promptCard(req: ApprovalRequest): Promise<boolean> {
    // Check if this tool is already approved for this session
    if (this.sessionApprovals.has(req.tool)) {
      this.send('notice', `${req.tool} auto-approved (session approval)`);
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
        preview: req.preview ?? JSON.stringify(req.args).slice(0, 800),
      });
    });
  }
}

function isWriteTool(tool: string): boolean {
  return tool === 'write_file' || tool === 'apply_diff';
}

export function deactivate(): void {}
