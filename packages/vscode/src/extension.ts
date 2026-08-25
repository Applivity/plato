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
  parseModelRef,
  modelSupportsReasoning,
  renderMarkdown,
} from '@applivity/plato-core';
import type { ApprovalRequest, Mode } from '@applivity/plato-core';
import { chatHtml } from './webview.js';
import { join } from 'node:path';

const LEGACY_KEY = 'plato.anthropicApiKey'; // pre-0.3.0 anthropic slot

export function activate(ctx: vscode.ExtensionContext): void {
  // One chat panel per window; re-running the command reveals it instead
  // of spawning a blank second one.
  let live: vscode.WebviewPanel | undefined;
  let host: ChatHost | undefined;

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'plato.setApiKey',
      async (providerArg?: string) => {
        const pick =
          providerArg === 'anthropic' || providerArg === 'openai'
            ? providerArg
            : await vscode.window.showQuickPick(['anthropic', 'openai'], {
                placeHolder: 'Which provider is this key for?',
              });
        if (pick !== 'anthropic' && pick !== 'openai') {
          return;
        }
        const input = await vscode.window.showInputBox({
          prompt: `${pick} API key (stored in VS Code SecretStorage, never in settings or files)`,
          password: true,
          ignoreFocusOut: true,
        });
        if (input && input.trim().length > 0) {
          await ctx.secrets.store(
            `plato.providers.${pick}.apiKey`,
            input.trim(),
          );
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
      (m: { type?: string; [k: string]: unknown }) => {
        if (m.type === 'mode' && typeof m.value === 'string') {
          this.mode = m.value as Mode;
          this.sessionWrites.clear();
          this.send('notice', `Mode: ${this.mode}`);
          return;
        }
        if (m.type === 'model' && typeof m.value === 'string') {
          const parsed = parseModelRef(m.value);
          if (parsed) {
            this.modelOverride = m.value;
            void this.panel.webview.postMessage({
              type: 'notice',
              text: `Model set to ${m.value}`,
            });
          } else {
            this.send('error', `Unknown model ref "${m.value}"`);
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
    this.log.length = 0;
    await this.ctx.workspaceState.update(LOG_KEY, this.log);
    this.sessionWrites.clear();
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
    // Resolve the composite model ref and its provider key (D25c/d).
    const ref = this.effectiveModel();
    const parsed = parseModelRef(ref);
    if (!parsed) {
      this.send(
        'error',
        `Bad model "${ref}" — use the provider:model form, e.g. anthropic:claude-sonnet-4-5.`,
      );
      return;
    }
    let apiKey = await this.ctx.secrets.get(
      `plato.providers.${parsed.provider}.apiKey`,
    );
    if (!apiKey && parsed.provider === 'anthropic') {
      apiKey = await this.ctx.secrets.get(LEGACY_KEY);
    }
    if (!apiKey) {
      const set = await vscode.window.showErrorMessage(
        `Plato needs an API key for ${parsed.provider}.`,
        'Set API Key',
      );
      if (set === 'Set API Key') {
        await vscode.commands.executeCommand(
          'plato.setApiKey',
          parsed.provider,
        );
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
    // Fresh inbox per run: a previous run's cancel must not leak forward.
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
        provider: createProvider(parsed.provider, {
          apiKey,
          baseUrl:
            parsed.provider === 'openai'
              ? vscode.workspace.getConfiguration('plato').get<string>(
                  'openAiBaseUrl',
                  'https://api.openai.com/v1',
                )
              : undefined,
        }),
        model: ref,
        ...(modelSupportsReasoning(ref)
          ? { reasoning: this.reasoningFor() }
          : {}),
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
        cost: result.costUsd > 0 ? `$${result.costUsd.toFixed(4)}` : '',
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
