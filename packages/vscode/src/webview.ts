/**
 * Chat webview HTML. CSP-locked (nonce-gated script, no inline handlers).
 * The log is restored by the host from workspaceState; this file only
 * renders messages and forwards user actions.
 */
export function chatHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Plato</title>
<style>
  :root {
    --pl-border: var(--vscode-input-border, rgba(128,128,128,.35));
    --pl-muted: var(--vscode-descriptionForeground, #999);
    --pl-accent: var(--vscode-focusBorder, #4a90d9);
  }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column;
         font-family:var(--vscode-font-family); font-size:13px;
         color:var(--vscode-editor-foreground);
         background:var(--vscode-editor-background); }
  header { padding:8px 12px 6px; border-bottom:1px solid var(--pl-border);
           display:flex; align-items:center; gap:6px; }
  header .label { color:var(--pl-muted); font-size:11px;
                  text-transform:uppercase; letter-spacing:.08em; }
  header button { border:1px solid transparent; border-radius:10px;
          padding:2px 10px; font-size:11px; cursor:pointer;
          background:transparent; color:var(--pl-muted); }
  header button:hover { border-color:var(--pl-border); }
  header button.on { background:var(--vscode-button-background);
                     color:var(--vscode-button-foreground); }
  #log { flex:1; overflow-y:auto; padding:10px 14px; }
  footer { display:flex; gap:8px; padding:10px 12px;
           border-top:1px solid var(--pl-border);
           background:var(--vscode-editor-background); align-items:flex-end; }
  #q { flex:1; resize:none; min-height:44px; max-height:160px;
       padding:9px 11px; font-family:var(--vscode-font-family);
       font-size:13px; line-height:1.5; border-radius:6px;
       border:1px solid var(--pl-border); outline:none;
       background:var(--vscode-input-background);
       color:var(--vscode-input-foreground); }
  #q:focus { border-color:var(--pl-accent); }
  #go { height:44px; padding:0 18px; border:none; border-radius:6px;
        font-size:13px; cursor:pointer;
        background:var(--vscode-button-background);
        color:var(--vscode-button-foreground); }
  #go:hover { background:var(--vscode-button-hoverBackground,
                               var(--vscode-button-background)); }
  #go:disabled { opacity:.5; cursor:default; }
  .msg { margin:0 0 10px; line-height:1.55; white-space:pre-wrap;
         word-break:break-word; }
  .msg .who { display:block; font-size:10px; letter-spacing:.08em;
              text-transform:uppercase; color:var(--pl-muted);
              margin-bottom:2px; }
  .msg.you { border-left:2px solid var(--pl-accent); padding-left:8px; }
  .msg.bot  { border-left:2px solid var(--pl-border); padding-left:8px; }
  .msg.sys, .msg.tool { color:var(--pl-muted); font-size:12px; }
  .msg.tool code { font-family:var(--vscode-editor-font-family, monospace); }
  .card { margin:6px 0 12px; border:1px solid var(--pl-border);
          border-radius:6px; overflow:hidden; }
  .card h3 { margin:0; padding:7px 10px; font-size:12px; font-weight:600;
             background:var(--vscode-editorWidget-background,
                        rgba(128,128,128,.12)); }
  .card pre { margin:0; padding:8px 10px; max-height:220px; overflow:auto;
              font-family:var(--vscode-editor-font-family, monospace);
              font-size:11.5px; line-height:1.45;
              background:var(--vscode-textCodeBlock-background,
                             rgba(128,128,128,.09)); }
  .card pre span.add { color:var(--vscode-testing-iconPassed, #73c991); }
  .card pre span.del { color:var(--vscode-testing-iconFailed, #f14c4c); }
  .card .actions { display:flex; gap:8px; padding:8px 10px; }
  .card button { padding:4px 16px; cursor:pointer; border:none;
                 border-radius:3px; font-size:12px;
                 background:var(--vscode-button-background);
                 color:var(--vscode-button-foreground); }
  .card button.no { background:var(--vscode-button-secondaryBackground,
                                    #3a3d41);
                    color:var(--vscode-button-secondaryForeground, #ddd); }
</style>
</head>
<body>
<header>
  <span class="label">Mode</span>
  <button data-m="plan" title="Read-only: Plato can look, never touch">plan</button>
  <button data-m="edit" title="File edits via diff approval cards; no shell">edit</button>
  <button data-m="act" class="on" title="Shell + writes; every action needs its own click">act</button>
  <button data-m="auto" title="No approval clicks; hard turn cap is the backstop">auto</button>
</header>
<div id="log"></div>
<footer>
  <textarea id="q" rows="2" placeholder="Describe the change… (Enter to send, Shift+Enter for newline)"></textarea>
  <button id="go" title="Send">Send</button>
</footer>
<script nonce="${nonce}">
  const vsapi = acquireVsCodeApi();
  const log = document.getElementById('log');
  const q = document.getElementById('q');
  let mode = 'act';
  let busy = false;
  let streaming = false;
  vsapi.postMessage({ type: 'ready' });

  for (const b of document.querySelectorAll('header button')) {
    if (b.classList.contains('on')) { mode = b.dataset.m; }
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('header button')) {
        x.classList.remove('on');
      }
      b.classList.add('on');
      mode = b.dataset.m;
      vsapi.postMessage({ type: 'mode', value: mode });
    });
  }

  document.getElementById('go').addEventListener('click', ask);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });

  function ask() {
    if (busy) { return; }
    const text = q.value.trim();
    if (!text) { return; }
    addMsg('you', 'You', text);
    q.value = '';
    busy = true;
    vsapi.postMessage({ type: 'ask', text: text });
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    switch (m.type) {
      case 'restore': render(m.log); break;
      case 'delta': stream(m.text); break;
      case 'notice': addMsg('sys', 'Plato', m.text); break;
      case 'tool': addMsg('tool', null,
        '<code>' + esc(m.tool) + '</code> ' + esc(m.phase), true); break;
      case 'approval': showCard(m); break;
      case 'done':
        finish();
        if (!streaming) { addMsg('sys', 'Plato', '(done' + (m.text ? ' — ' + m.text : '') + ')'); }
        break;
      case 'error':
        finish();
        addMsg('bot', 'Error', m.text);
        break;
    }
  });

  function render(entries) {
    log.textContent = '';
    for (const t of entries) { appendEntry(t); }
    scroll();
  }

  function appendEntry(t) {
    switch (t.k) {
      case 'msg': addMsg(t.cls || 'bot', t.who, String(t.text)); break;
      case 'tool': addMsg('tool', null,
        '<code>' + esc(t.tool) + '</code> ' + esc(t.phase), true); break;
      case 'card-open': showCard(t, false); break;
      case 'card-done': cardDone(t); break;
    }
  }

  function addMsg(cls, who, text, asHtml) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = who || '';
    div.appendChild(w);
    const body = document.createElement('span');
    if (asHtml) { body.innerHTML = text; } else { body.textContent = text; }
    div.appendChild(body);
    log.appendChild(div);
    scroll();
    return body;
  }

  function stream(delta) {
    streaming = true;
    let el = document.getElementById('streaming');
    if (!el) {
      el = addMsg('bot', 'Plato', '');
      el.id = 'streaming';
    }
    el.textContent += delta;
    scroll();
  }

  function finish() {
    const el = document.getElementById('streaming');
    if (el) { el.removeAttribute('id'); }
    streaming = false;
    busy = false;
    scroll();
  }

  function showCard(m, live) {
    // An open card must NOT unlock the input; the run is still active.
    const el = document.getElementById('streaming');
    if (el) { el.removeAttribute('id'); }
    streaming = false;
    const card = document.createElement('div');
    card.className = 'card';

    const h = document.createElement('h3');
    h.textContent = 'Approve ' + m.tool + '?';
    card.appendChild(h);

    const pre = document.createElement('pre');
    pre.innerHTML = diffHtml(String(m.preview));
    card.appendChild(pre);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const yes = document.createElement('button');
    yes.textContent = 'Allow once';
    const no = document.createElement('button');
    no.className = 'no';
    no.textContent = 'Deny';
    yes.addEventListener('click', () => decide(true));
    no.addEventListener('click', () => decide(false));
    function decide(v) {
      vsapi.postMessage({ type: 'approve', value: v ? 'yes' : 'no' });
      actions.remove();
      h.textContent = h.textContent.replace('?', v ? ' — allowed' : ' — denied');
      addMsg('you', 'You', v ? '[allowed]' : '[denied]');
    }
    actions.appendChild(yes);
    actions.appendChild(no);
    card.appendChild(actions);
    log.appendChild(card);
    scroll();
  }

  function cardDone(t) {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3');
    h.textContent = t.title;
    card.appendChild(h);
    const pre = document.createElement('pre');
    pre.innerHTML = diffHtml(String(t.preview));
    card.appendChild(pre);
    log.appendChild(card);
  }

  function diffHtml(preview) {
    return preview.split('\\n').map((line) => {
      const cls = line.startsWith('+') ? ' class="add"'
                : line.startsWith('-') ? ' class="del"' : '';
      return '<span' + cls + '>' + esc(line) + '</span>';
    }).join('\\n');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
  }

  function scroll() { log.scrollTop = log.scrollHeight; }
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
