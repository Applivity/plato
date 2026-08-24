/**
 * Plato VS Code shell. Thin by contract (ARCHITECTURE.md): commands,
 * SecretStorage, webview host. Logic lives in @applivity/plato-core.
 */
import * as vscode from 'vscode';
import { runSinglePrompt } from '@applivity/plato-core';

const SECRET_KEY = 'plato.anthropicApiKey';

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.setApiKey', async () => {
      const input = await vscode.window.showInputBox({
        prompt:
          'Anthropic API key (stored in VS Code SecretStorage, never in settings or files)',
        password: true,
        ignoreFocusOut: true,
      });
      if (input && input.trim().length > 0) {
        await ctx.secrets.store(SECRET_KEY, input.trim());
        void vscode.window.showInformationMessage(
          'Plato: API key stored in SecretStorage.'
        );
      }
    })
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('plato.openChat', async () => {
      const panel = vscode.window.createWebviewPanel(
        'platoChat',
        'Plato Chat',
        vscode.ViewColumn.Beside,
        { enableScripts: true, localResourceRoots: [] }
      );
      panel.webview.html = chatHtml(panel.webview);

      // Streamed answers flow core -> here -> webview via postMessage.
      const send = (type: string, text: string) =>
        void panel.webview.postMessage({ type, text });

      panel.webview.onDidReceiveMessage(async (m) => {
        if (m?.type !== 'ask') {
          return;
        }
        const apiKey = await ctx.secrets.get(SECRET_KEY);
        if (!apiKey) {
          const set = await vscode.window.showErrorMessage(
            'Plato needs an Anthropic API key first.',
            'Set API Key'
          );
          if (set === 'Set API Key') {
            await vscode.commands.executeCommand('plato.setApiKey');
          }
          return;
        }
        const folders = vscode.workspace.workspaceFolders;
        const root = folders?.[0]?.uri.fsPath;
        if (!root) {
          void vscode.window.showErrorMessage(
            'Open a folder before asking Plato.'
          );
          return;
        }
        try {
          await runSinglePrompt({ workspaceRoot: root, prompt: m.text }, apiKey, (d) =>
            send('delta', d)
          ).then((full) => send('done', full));
        } catch (err) {
          // Never echo raw provider errors; they can embed request hints.
          send('error', 'Provider request failed. Check the API key and network.');
        }
      });
    })
  );
}

export function deactivate() {}

function chatHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Plato</title>
<style>
  body { margin:0; padding:12px; font-family:var(--vscode-font-family);
         color:var(--vscode-editor-foreground); display:flex;
         flex-direction:column; height:calc(100vh - 24px); box-sizing:border-box; }
  #log { flex:1; overflow-y:auto; white-space:pre-wrap; line-height:1.5; }
  #bar { display:flex; gap:8px; margin-top:8px; }
  #q { flex:1; padding:6px 8px; background:var(--vscode-input-background);
       color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); }
  button { padding:6px 14px; background:var(--vscode-button-background);
           color:var(--vscode-button-foreground); border:none; cursor:pointer; }
  .hint { opacity:.7; font-size:.9em; margin-bottom:8px; }
</style>
</head>
<body>
<div id="log"><div class="hint">Ask about the current workspace. Set your Anthropic key with "Plato: Set Anthropic API Key" once.</div></div>
<div id="bar">
  <input id="q" type="text" placeholder="e.g. What does this project do?" />
  <button id="go">Send</button>
</div>
<script nonce="${nonce}">
  const vsapi = acquireVsCodeApi();
  const log = document.getElementById('log');
  const q = document.getElementById('q');
  document.getElementById('go').addEventListener('click', ask);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ask(); } });

  function ask() {
    const text = q.value.trim();
    if (!text) { return; }
    append('You', text);
    q.value = '';
    vsapi.postMessage({ type: 'ask', text });
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'delta') { stream(m.text); }
    else if (m.type === 'done') { finish(m.text.length ? '' : '(empty answer)'); }
    else if (m.type === 'error') { finish(); append('Error', m.text); }
  });

  let streaming = false;
  function stream(delta) {
    streaming = true;
    let el = document.getElementById('streaming');
    if (!el) { el = append('Plato', ''); el.id = 'streaming'; }
    el.textContent += delta;
    log.scrollTop = log.scrollHeight;
  }
  function finish(notes) {
    if (streaming || notes) {
      let el = document.getElementById('streaming');
      if (!el) { el = append('Plato', ''); }
      if (notes) { el.textContent += notes; }
      el.removeAttribute('id');
    }
    streaming = false;
    log.scrollTop = log.scrollHeight;
  }
  function append(who, text) {
    const div = document.createElement('div');
    div.textContent = who + ': ' + text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
</script>
</body>
</html>`;
}

function getNonce(): string {
  let n = '';
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    n += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return n;
}
