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
  MODEL_CATALOG,
  PROVIDER_PRESETS,
  fetchModelIds,
  renderMarkdown,
  McpServer,
  loadMcpConfig,
  ObserverAgent,
} from '@applivity/plato-core';
import type { DigestEntry } from '@applivity/plato-core';
import type { ApprovalRequest, Mode } from '@applivity/plato-core';
import { chatHtml } from './webview.js';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const LEGACY_KEY = 'plato.anthropicApiKey'; // pre-0.3.0 anthropic slot

interface ConnectionConfig {
  id: string;
  kind: 'anthropic' | 'openai';
  baseUrl?: string;
  /** Selected models (the chat dropdown). */
  models?: string[];
  /** Full fetched pool (picker source; selection never shrinks it). */
  allModels?: string[];
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
      list.push({ id, kind, baseUrl, models, allModels });
    }
  }
  return list;
}

/** Reads plato.connections and seeds the built-in defaults (D26a). */
function readConnections(): ConnectionConfig[] {
  const list = rawUserConnections();
  const ids = new Set(list.map((c) => c.id));
  if (!ids.has('anthropic')) {
    list.unshift({
      id: 'anthropic',
      kind: 'anthropic',
      // Sensible starting set; Refresh models replaces it with live data.
      models: MODEL_CATALOG.filter((e) => e.id.startsWith('claude')).map(
        (e) => e.id,
      ),
    });
  }
  if (!ids.has('openai')) {
    list.push({
      id: 'openai',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: MODEL_CATALOG.filter((e) => !e.id.startsWith('claude')).map(
        (e) => e.id,
      ),
    });
  }
  return list;
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

class ChatHost {
  private mode: Mode = 'act';
  private readonly sessionWrites = new Set<string>();
  private readonly sessionApprovals = new Set<string>();
  private controller = new RunController();
  private pendingApproval: PendingResolve | null = null;
  private replyBuffer = '';
  private running = false;
  private modelOverride: string | null = null;
  private readonly log: Entry[];

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly ctx: vscode.ExtensionContext,
  ) {
    this.log = ctx.workspaceState.get<Entry[]>(LOG_KEY, []);
    this.panel.webview.onDidReceiveMessage(
      async (m: { type?: string; [k: string]: unknown }) => {
        if (m.type === 'mode' && typeof m.value === 'string') {
          this.mode = m.value as Mode;
          this.sessionWrites.clear();
          this.sessionApprovals.clear();
          this.send('notice', `Mode: ${this.mode}`);
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
          void this.panel.webview.postMessage({
            type: 'history',
            runs: this.listRuns(),
            chats: this.sessions().map((s) => ({
              id: s.id,
              title: s.title,
              ts: s.ts,
              count: s.log.filter((e) => e.k === 'msg').length,
            })),
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
            const decorated = this.log.map((e) =>
              e.k === 'msg' && e.cls === 'bot'
                ? { ...e, html: renderMarkdown(e.text) }
                : e,
            );
            void this.panel.webview.postMessage({
              type: 'restore',
              log: decorated,
              model: this.effectiveModel(),
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
        if (m.type === 'ask' && typeof m.text === 'string') {
          this.push({ k: 'msg', cls: 'you', who: 'You', text: m.text });
          void this.run(m.text);
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
          void panel.webview.postMessage({
            type: 'restore',
            log: decorated,
            model: this.effectiveModel(),
          });
        }
      },
    );
  }

  private send(type: string, text?: unknown): void {
    void this.panel.webview.postMessage({ type, text });
  }

  // ---- Settings surface (D27) -------------------------------------------

  /** Builds and posts the settings snapshot; secrets never leave the host. */
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
      ...(flash ? { flash } : {}),
    });
    this.postModelState();
  }

  /** True when the effective model supports reasoning (D28 phase 2). */
  private reasoningCapable(): boolean {
    const parts = splitModelRef(this.effectiveModel());
    return parts ? modelSupportsReasoning(parts.model) : false;
  }

  /** Posts grouped dropdown + reasoning state in one payload. */
  private postModelState(): void {
    void this.panel.webview.postMessage({
      type: 'models',
      items: this.modelItems(),
      reasoningCapable: this.reasoningCapable(),
      reasoning: vscode.workspace
        .getConfiguration('plato')
        .get<string>('reasoning', 'off'),
    });
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
      const models = await fetchModelIds({
        kind: conn.kind,
        apiKey,
        baseUrl:
          conn.kind === 'openai'
            ? conn.baseUrl ?? 'https://api.openai.com/v1'
            : conn.baseUrl ?? undefined,
      });
      const user = rawUserConnections();
      let entry = user.find((u) => u.id === connId);
      if (!entry) {
        entry = { id: connId, kind: conn.kind };
        user.push(entry);
      }
      entry.models = models;
      entry.allModels = models; // full pool; selection edits never shrink it
      await vscode.workspace.getConfiguration('plato').update(
        'connections',
        user,
        vscode.ConfigurationTarget.Global,
      );
      void this.sendSettings(`Found ${models.length} models for ${connId}.`);
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
    const first = msgs.find((e) => e.k === 'msg' && e.cls === 'you');
    const sessions = this.sessions();
    sessions.unshift({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: ((first && first.k === 'msg' ? first.text : '') || 'Chat')
        .slice(0, 80),
      ts: new Date().toISOString(),
      log: [...this.log],
    });
    await this.ctx.workspaceState.update(
      SESSIONS_KEY,
      sessions.slice(0, SESSIONS_MAX),
    );
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
    this.sessionWrites.clear();
    this.sessionApprovals.clear();
    this.pendingApproval = null;
    this.replyBuffer = '';
    await this.panel.webview.postMessage({ type: 'restore', log: [] });
  }

  /** Session override, else the plato.model workspace setting. */
  private effectiveModel(): string {
    return (
      this.modelOverride ??
      vscode.workspace
        .getConfiguration('plato')
        .get<string>('model', 'anthropic:claude-sonnet-4-5')
    );
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

  /** Dropdown entries grouped by provider (D29); only connections that
 *  have a model set appear — fetched lists are the source of truth. */
  private modelItems(): { value: string; label: string; group: string }[] {
    const items: { value: string; label: string; group: string }[] = [];
    for (const c of readConnections()) {
      for (const m of c.models ?? []) {
        items.push({ value: `${c.id}:${m}`, label: m, group: c.id });
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

  private async run(task: string): Promise<void> {
    // Resolve the composite ref to a connection profile (D26a).
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
    const started = Date.now();
    let toolsUsed = 0;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.send('error', 'Open a folder before asking Plato.');
      return;
    }
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
    // Observer-AI v1 (D30): optional second model steering the coder.
    let observer: ObserverAgent | null = null;
    if (vscode.workspace.getConfiguration('plato').get('observer.enable', false)) {
      const oRef =
        vscode.workspace
          .getConfiguration('plato')
          .get<string>('observer.model', '') || ref;
      const oParts = splitModelRef(oRef);
      const oConn = oParts
        ? readConnections().find((c) => c.id === oParts.connectionId)
        : undefined;
      const oKey = oConn
        ? (await this.ctx.secrets.get(`plato.providers.${oConn.id}.apiKey`)) ??
          (oConn.id === 'anthropic'
            ? await this.ctx.secrets.get(LEGACY_KEY)
            : undefined)
        : undefined;
      if (oConn && oKey) {
        observer = new ObserverAgent(
          createProvider(oConn.kind, {
            apiKey: oKey,
            baseUrl: oConn.kind === 'openai' ? oConn.baseUrl : undefined,
          }),
          {
            model: oRef,
            role: vscode.workspace
              .getConfiguration('plato')
              .get('observer.role', ''),
            guidance: true, // D30b: guidance tier always on
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
        );
        const digest: DigestEntry[] = [];
        let observing = true;
        bus.on((e) => {
          if (e.type === 'tool-event') {
            digest.push({
              kind: 'tool',
              text: `${e.tool} ${e.phase}${e.ok === false ? ' (error)' : ''}`,
            });
          } else if (e.type === 'text') {
            observer?.noteText(e.text);
          } else if (e.type === 'turn-started' && observing) {
            if (e.turn > 1 && !observer?.exhausted) {
              observing = false; // one decision at a time; re-armed below
              void observer
                ?.observe(task, digest)
                .then((a) => {
                  if (a.action === 'guidance') {
                    this.controller.sendGuidance(a.message);
                    this.send('notice', `[observer] guidance: ${a.message}`);
                  } else if (a.action === 'pause') {
                    this.controller.pause();
                    this.send('notice', '[observer] paused the run');
                  } else if (a.action === 'cancel') {
                    this.controller.cancel();
                    this.send('notice', '[observer] cancelled the run');
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  observing = true;
                });
            }
          }
        });
      } else {
        this.send(
          'notice',
          'Observer enabled but its model/key is unavailable — continuing without it.',
        );
      }
    }
    this.controller = new RunController();
    this.running = true;
    try {
      const result = await runAgentLoop({
        root,
        task,
        approve: (req) => this.approve(req),
        getMode: () => this.mode,
        bus,
        controller: this.controller,
        provider: createProvider(conn.kind, {
          apiKey,
          baseUrl:
            conn.kind === 'openai'
              ? conn.baseUrl ?? 'https://api.openai.com/v1'
              : undefined,
        }),
        model: ref,
        ...(parts && modelSupportsReasoning(parts.model)
          ? { reasoning: this.reasoningFor() }
          : {}),
        history: this.historyFor(),
        mcpServers,
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
            ? 'stopped at turn cap'
            : result.reason === 'cancelled'
              ? 'cancelled'
              : '',
        secs: Math.max(1, Math.round((Date.now() - started) / 1000)),
        tools: toolsUsed,
        tok: fmtTokens(result.inputTokens + result.outputTokens),
        cost: result.costUsd > 0 ? `\u2248$${result.costUsd.toFixed(4)}` : '',
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
