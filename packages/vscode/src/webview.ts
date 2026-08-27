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
  header { flex-direction:column; align-items:stretch; padding:8px 12px 7px;
           gap:6px; }
  .hrow { display:flex; align-items:center; gap:6px; width:100%; }
  .hrow .brand { font-weight:600; font-size:12.5px; letter-spacing:.02em; }
  .hrow .label { color:var(--pl-muted); font-size:11px; text-transform:uppercase;
                 letter-spacing:.08em; }
  .hrow .spacer { flex:1; }
  #msel { flex:1; max-width:420px; font-family:var(--vscode-font-family);
          font-size:11.5px; padding:2px 6px; border-radius:6px;
          border:1px solid var(--pl-border);
          background:var(--vscode-dropdown-background);
          color:var(--vscode-dropdown-foreground); outline:none; }
  #msel optgroup { font-style:normal; color:var(--pl-muted); }
  #msel optgroup option { color:var(--vscode-dropdown-foreground); }
  #gear { margin-left:auto; }
  .icn { width:14px; height:14px; fill:none; stroke:currentColor;
         stroke-width:2; stroke-linecap:round; stroke-linejoin:round;
         vertical-align:-2px; }
  #hist, #gear { font-size:12px; padding:4px 9px; border:1px solid transparent;
                 border-radius:6px; background:transparent; cursor:pointer;
                 color:var(--pl-muted); }
  #hist:hover, #gear:hover { border-color:var(--pl-border);
                             color:var(--vscode-editor-foreground); }
  #rsel { font-family:var(--vscode-font-family); font-size:11px;
          padding:2px 5px; border-radius:6px;
          border:1px solid var(--pl-border);
          background:var(--vscode-dropdown-background);
          color:var(--vscode-dropdown-foreground); outline:none; }
  #rsel[hidden] { display:none; }
  #new { border:1px solid var(--pl-border); border-radius:10px;
         padding:2px 9px; font-size:12px; cursor:pointer;
         background:transparent; color:var(--pl-muted); }
  #new:hover { border-color:var(--pl-accent); color:var(--vscode-editor-foreground); }
  #log { flex:1; overflow-y:auto; padding:10px 14px; }
  #pp, #cx { height:44px; padding:0 14px; border:none; border-radius:6px;
             font-size:12px; cursor:pointer; align-self:flex-end;
             background:var(--vscode-button-secondaryBackground,#3a3d41);
             color:var(--vscode-button-secondaryForeground,#ddd); }
  #pp:hover, #cx:hover { opacity:.85; }
  #cx { color:var(--vscode-testing-iconFailed,#f14c4c); }
  #pp[hidden], #cx[hidden] { display:none; }
  #pp:disabled, #cx:disabled { opacity:.45; cursor:default; }
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
  #go { height:44px; width:44px; padding:0; border:none; border-radius:6px;
        display:inline-flex; align-items:center; justify-content:center;
        cursor:pointer;
        background:var(--vscode-button-background);
        color:var(--vscode-button-foreground); }
  #go:hover { background:var(--vscode-button-hoverBackground,
                               var(--vscode-button-background)); }
  #go:disabled { opacity:.5; cursor:default; }
  .msg { margin:0 0 10px; line-height:1.55; white-space:pre-wrap;
         word-break:break-word; }
  .msg.tool-summary { color:var(--pl-muted); font-size:11px;
                      font-family:var(--vscode-editor-font-family, monospace);
                      background:var(--vscode-textCodeBlock-background, rgba(128,128,128,.09));
                      padding:4px 8px; border-radius:4px;
                      border-left:2px solid var(--pl-border); }
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
  #st { display:none; align-items:center; gap:5px;
        font-size:11px; color:var(--pl-muted); white-space:nowrap; }
  #st.on { display:flex; }
  #st.done { color:var(--vscode-testing-iconPassed, #73c991); }
  #st .dot { width:7px; height:7px; border-radius:50%;
             background:var(--pl-accent); animation:pulse 1.2s infinite; }
  #st.done .dot { animation:none;
                  background:var(--vscode-testing-iconPassed, #73c991); }
  @keyframes pulse { 0%,100% { opacity:.25; } 50% { opacity:1; } }
  .msg.fin { border-left:2px solid var(--vscode-testing-iconPassed,#73c991);
             padding-left:8px; color:var(--pl-muted); font-size:12px; }
  body.show-settings header:not(.shead), body.show-settings #log,
  body.show-settings #obs, body.show-settings footer { display:none !important; }
  #settingsPage { display:none; }
  body.show-settings #settingsPage { display:flex; flex-direction:column;
                                     height:100vh; }
  body.show-history header:not(.shead), body.show-history #log,
  body.show-history #obs, body.show-history footer { display:none !important; }
  #historyPage { display:none; }
  body.show-history #historyPage { display:flex; flex-direction:column;
                                   height:100vh; }
  #hibody { flex:1; overflow-y:auto; padding:12px 14px; }
  .runitem { border:1px solid var(--pl-border); border-radius:6px;
             padding:8px 10px; margin-bottom:8px; cursor:pointer; }
  .runitem:hover { border-color:var(--pl-accent); }
  .runitem .rt { font-weight:600; font-size:12px; word-break:break-word; }
  .runitem .rm { font-size:11px; color:var(--pl-muted); margin-top:2px; }
  .hlabel { padding:8px 12px 6px; }
  header.shead { padding:8px 12px; gap:8px; }
  header.shead button { border:1px solid var(--pl-border); border-radius:6px;
                        background:transparent; color:var(--pl-muted);
                        padding:2px 10px; cursor:pointer; font-size:12px; }
  #sbody { flex:1; overflow-y:auto; padding:12px 14px; }
  .sec { margin-bottom:18px; }
  .sec h4 { margin:.2em 0 .55em; font-size:11px; text-transform:uppercase;
            letter-spacing:.08em; color:var(--pl-muted); }
  .conn { border:1px solid var(--pl-border); border-radius:6px;
          padding:8px 10px; margin-bottom:8px; }
  .conn .row1 { display:flex; align-items:center; gap:6px; }
  .conn .cid { font-weight:600; }
  .conn .ckind { font-size:10px; color:var(--pl-muted);
                 border:1px solid var(--pl-border); border-radius:8px;
                 padding:0 7px; }
  .conn .cstat { margin-left:auto; font-size:11px; }
  .conn .cstat.set { color:var(--vscode-testing-iconPassed,#73c991); }
  .conn .cbase, .conn .cmodels { font-size:11px; color:var(--pl-muted);
                                 word-break:break-all; margin-top:2px; }
  .conn details { margin-top:6px; font-size:11px; }
  .conn summary { cursor:pointer; color:var(--pl-muted);
                  font-size:11.5px; }
  .conn .modellist { display:grid; grid-template-columns:1fr 1fr;
                     gap:1px 10px; margin-top:5px;
                     max-height:220px; overflow-y:auto;
                     border:1px solid var(--pl-border); border-radius:5px;
                     padding:5px 7px;
                     background:var(--vscode-input-background); }
  .conn .mopt { display:flex; align-items:center; gap:6px;
                padding:2px 4px; cursor:pointer; font-size:11px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .conn .mopt:hover { background:var(--vscode-list-hoverBackground,
                                       rgba(128,128,128,.12)); }
  .conn .mopt input { margin:0; flex:none; }
  .conn .mopt span { overflow:hidden; text-overflow:ellipsis; }
  .conn .mbtns { grid-column:1 / -1; display:flex; gap:6px; margin-top:4px; }
  .conn .cbtns { display:flex; gap:6px; margin-top:7px; flex-wrap:wrap; }
  .sbtn { padding:3px 10px; font-size:11.5px; cursor:pointer; border:none;
          border-radius:4px;
          background:var(--vscode-button-secondaryBackground,#3a3d41);
          color:var(--vscode-button-secondaryForeground,#ddd); }
  .sbtn.danger { color:var(--vscode-testing-iconFailed,#f14c4c); }
  #addForm, .prefrow { display:flex; flex-direction:column; gap:6px;
                       border:1px dashed var(--pl-border); border-radius:6px;
                       padding:10px; margin-bottom:10px; }
  #addForm input, #addForm select, .prefrow select {
      padding:5px 8px; font-size:12px; border-radius:4px;
      border:1px solid var(--pl-border);
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground); outline:none; }
  #addForm .frow { display:flex; gap:6px; } #addForm .frow > * { flex:1; }
  .prefrow label { font-size:11px; color:var(--pl-muted); }
  .note { font-size:11px; color:var(--pl-muted); margin-top:4px; }
  .msg.bot p { margin:.35em 0; }
  .msg.bot .md-h { font-weight:600; margin:.7em 0 .25em; line-height:1.3; }
  .msg.bot .md-h1 { font-size:15px; }
  .msg.bot .md-h2 { font-size:14px; }
  .msg.bot .md-h3 { font-size:13px; }
  .msg.bot .md-h4 { font-size:12.5px; }
  .msg.bot ul, .msg.bot ol { margin:.35em 0; padding-left:1.4em; }
  .msg.bot li { margin:.15em 0; }
  .msg.bot blockquote { margin:.4em 0; padding:.1em .8em;
                        border-left:2px solid var(--pl-border);
                        color:var(--pl-muted); }
  .msg.bot blockquote p { margin:.15em 0; }
  .msg.bot code { background:var(--vscode-textCodeBlock-background,
                              rgba(128,128,128,.09));
                  font-family:var(--vscode-editor-font-family,monospace);
                  font-size:12px; padding:1px 4px; border-radius:3px; }
  .msg.bot a { color:var(--vscode-textLink-foreground); }
  .md-code { margin:.5em 0; border:1px solid var(--pl-border);
             border-radius:5px; overflow:hidden; }
  .md-code .md-lang { display:block; padding:3px 9px; font-size:10px;
                      letter-spacing:.06em; text-transform:uppercase;
                      color:var(--pl-muted);
                      background:var(--vscode-editorWidget-background,
                                      rgba(128,128,128,.12)); }
  .md-code pre { margin:0; padding:8px 10px; overflow-x:auto;
                 font-family:var(--vscode-editor-font-family,monospace);
                 font-size:11.5px; line-height:1.5;
                 background:var(--vscode-textCodeBlock-background,
                                rgba(128,128,128,.09)); }
  .md-code pre code { background:none; padding:0; font-size:inherit; }
</style>
</head>
<body>
<header>
  <div class="hrow htop">
    <span class="brand">Plato</span>
    <select id="msel" title="Model for this conversation"></select>
    <select id="rsel" title="Reasoning effort (supported models only)" hidden></select>
    <button id="hist" title="History">
      <svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </button>
    <button id="gear" title="Settings">
      <svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </div>
  <div class="hrow hmodes">
    <span class="label">Mode</span>
    <button data-m="plan" title="Read-only: Plato can look, never touch">plan</button>
    <button data-m="edit" title="File edits via diff approval cards; no shell">edit</button>
    <button data-m="act" class="on" title="Shell + writes; every action needs its own click">act</button>
    <button data-m="auto" title="No approval clicks; hard turn cap is the backstop">auto</button>
    <span class="spacer"></span>
    <button id="new" title="Start a new chat (clears this conversation)">＋</button>
    <span id="st"></span>
  </div>
</header>
<div id="log"></div>
<footer>
  <textarea id="q" rows="2" placeholder="Describe the change… (Enter to send, Shift+Enter for newline)"></textarea>
  <button id="pp" title="Pause at the next safe point" hidden>Pause</button>
  <button id="cx" title="Stop after the current tool call" hidden>Cancel</button>
  <button id="go" title="Send">
    <svg class="icn" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  </button>
</footer>
<div id="settingsPage">
  <header class="shead">
    <button id="sback">‹ Back</button>
    <span class="label">Plato Settings</span>
  </header>
  <div id="sbody"></div>
</div>
<div id="historyPage">
  <header class="shead">
    <button id="hback">‹ Back</button>
    <span class="label" id="htitle">History</span>
  </header>
  <div id="hibody"></div>
</div>
<script nonce="${nonce}">
  const vsapi = acquireVsCodeApi();
  const log = document.getElementById('log');
  const q = document.getElementById('q');
  let mode = 'act';
  let busy = false;
  let streaming = false;
  let runT0 = 0;
  let lastAct = '';
  vsapi.postMessage({ type: 'ready' });

  function chipOn(txt, doneKind) {
    const st = document.getElementById('st');
    st.className = doneKind ? 'on done' : 'on';
    st.innerHTML = '<span class="dot"></span>' + esc(txt);
  }
  function chipOff() {
    const st = document.getElementById('st');
    st.className = '';
    st.textContent = '';
  }
  function refreshChip() {
    if (!busy || !runT0) { return; }
    const s = Math.floor((Date.now() - runT0) / 1000);
    chipOn('working ' + s + 's' + (lastAct ? ' \u00b7 ' + lastAct : ''), false);
  }
  setInterval(refreshChip, 1000);

  for (const b of document.querySelectorAll('header button[data-m]')) {
    if (b.classList.contains('on')) { mode = b.dataset.m; }
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('header button[data-m]')) {
        x.classList.remove('on');
      }
      b.classList.add('on');
      mode = b.dataset.m;
      vsapi.postMessage({ type: 'mode', value: mode });
    });
  }

  document.getElementById('go').addEventListener('click', ask);
  document.getElementById('new').addEventListener('click', () => {
    vsapi.postMessage({ type: 'newChat' });
  });

  // Settings page (D27).
  const gear = document.getElementById('gear');
  gear.addEventListener('click', () => {
    vsapi.postMessage({ type: 'openSettings' });
  });
  document.getElementById('sback').addEventListener('click', () => {
    document.body.classList.remove('show-settings');
    vsapi.postMessage({ type: 'settings-closed' });
  });

  // History / transcript replay (M3).
  const hbody = document.getElementById('hibody');
  const htitle = document.getElementById('htitle');
  let hRuns = [];
  let hChats = [];
  document.getElementById('hist').addEventListener('click', () => {
    vsapi.postMessage({ type: 'openHistory' });
  });
  document.getElementById('hback').addEventListener('click', () => {
    if (htitle.textContent === 'Run detail') {
      showHistory({ runs: hRuns, chats: hChats }); // detail -> list
      return;
    }
    document.body.classList.remove('show-history');
  });

  function kfmt(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  function showHistory(m) {
    hRuns = m.runs || [];
    hChats = m.chats || [];
    const chats = m.chats || [];
    document.body.classList.remove('show-settings');
    document.body.classList.add('show-history');
    htitle.textContent = 'History';
    hbody.textContent = '';
    if (chats.length > 0) {
      const sec = el('div', 'sec');
      sec.appendChild(el('h4', null, 'Chats (resume)'));
      for (const c of chats) {
        const item = el('div', 'runitem');
        item.appendChild(el('div', 'rt', String(c.title || 'Chat')));
        item.appendChild(el('div', 'rm',
          String(c.ts || '').replace('T', ' ').slice(0, 19)
          + ' \u00b7 ' + c.count + ' messages \u00b7 click to resume'));
        item.addEventListener('click', () => {
          vsapi.postMessage({ type: 'resumeChat', id: c.id });
        });
        sec.appendChild(item);
      }
      hbody.appendChild(sec);
    }
    const sec2 = el('div', 'sec');
    sec2.appendChild(el('h4', null, 'Runs'));
    if (hRuns.length === 0) {
      sec2.appendChild(el(
        'div',
        'note',
        'No runs recorded yet. Every Plato run is transcribed to .plato/runs/ automatically.',
      ));
    } else {
      for (const r of hRuns) {
        const item = el('div', 'runitem');
        item.appendChild(el('div', 'rt', String(r.task || '(no task)')));
        const meta = [
          String(r.startedAt || '').replace('T', ' ').slice(0, 19),
          r.reason === 'failed' ? 'failed' : '',
          r.turns != null ? r.turns + ' turns' : '',
          r.inputTokens != null
            ? kfmt(Number(r.inputTokens) + Number(r.outputTokens || 0)) + ' tok'
            : '',
          r.costUsd > 0 ? '\u2248$' + Number(r.costUsd).toFixed(4) : '',
        ].filter(Boolean).join(' \u00b7 ');
        item.appendChild(el('div', 'rm', meta));
        item.addEventListener('click', () => {
          vsapi.postMessage({ type: 'openRun', file: r.file });
        });
        sec2.appendChild(item);
      }
    }
    hbody.appendChild(sec2);
    scroll();
  }

  function showRun(m) {
    document.body.classList.add('show-history');
    htitle.textContent = 'Run detail';
    hbody.textContent = '';
    const evs = m.events || [];
    const meta = [];
    let header = null;
    for (const e of evs) {
      if (e.kind === 'header') { header = e; continue; }
      const line = (cls, txt, asHtml) => {
        const d = el('div', 'msg ' + cls);
        if (asHtml) {
          const body = document.createElement('span');
          body.innerHTML = txt; // host-rendered only (bot markdown)
          d.appendChild(body);
        } else {
          d.textContent = txt;
        }
        hbody.appendChild(d);
      };
      switch (e.type) {
        case 'text':
          line('bot', String(e.html || ''), true);
          break;
        case 'tool-event':
          line('tool',
            String(e.tool) + ' \u2014 ' + String(e.phase)
            + (e.ok === false ? ' (error)' : ''));
          break;
        case 'usage':
          meta.push('turn ' + e.turn + ': '
            + kfmt(Number(e.inputTokens) + Number(e.outputTokens))
            + ' tok'
            + (e.costUsd > 0 ? ' \u00b7 \u2248$' + Number(e.costUsd).toFixed(4) : ''));
          break;
        case 'approval-decided':
          line('you', '[' + (e.allowed ? 'allowed' : 'denied') + ' '
            + String(e.tool) + ']');
          break;
        case 'run-completed': {
          const total = Number(e.inputTokens) + Number(e.outputTokens);
          line('fin', '\u2713 ' + String(e.reason) + ' \u00b7 '
            + e.turns + ' turns \u00b7 ' + kfmt(total) + ' tok'
            + (e.costUsd > 0 ? ' \u00b7 \u2248$' + Number(e.costUsd).toFixed(4) : ''));
          break;
        }
        case 'run-failed':
          line('bot', 'Run failed: ' + String(e.error ?? ''));
          break;
        default:
          break;
      }
    }
    if (meta.length > 0) {
      const d = el('div', 'msg tool');
      d.textContent = meta.join(' \u00b7 ');
      hbody.insertBefore(d, hbody.firstChild);
    }
    if (header) {
      const d = el('div', 'msg you');
      d.textContent = String(header.task || '');
      hbody.insertBefore(d, hbody.firstChild);
    }
    scroll();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  function sbtn(label, fn, danger) {
    const b = el('button', 'sbtn' + (danger ? ' danger' : ''), label);
    b.type = 'button'; // never submit an enclosing form (0.4.2 bug)
    b.addEventListener('click', fn);
    return b;
  }
  function sel(options, value) {
    const s = el('select');
    for (const o of options) {
      const op = el('option', null, o.label);
      op.value = o.value;
      s.appendChild(op);
    }
    if (value) { s.value = value; }
    return s;
  }

  function showSettings(d) {
    document.body.classList.add('show-settings');
    const body = document.getElementById('sbody');
    body.textContent = '';
    if (d.flash) {
      const f = el('div', 'note');
      f.style.padding = '6px 10px';
      f.style.marginBottom = '10px';
      f.style.border = '1px solid var(--pl-border)';
      f.style.borderRadius = '5px';
      f.textContent = String(d.flash);
      body.appendChild(f);
    }

    // Connections
    const sec1 = el('div', 'sec');
    sec1.appendChild(el('h4', null, 'Connections'));
    for (const c of d.connections || []) {
      const card = el('div', 'conn');
      const r1 = el('div', 'row1');
      r1.appendChild(el('span', 'cid', c.id));
      r1.appendChild(el('span', 'ckind', String(c.kind)));
      r1.appendChild(el(
        'span',
        'cstat' + (c.keyStatus === 'set' ? ' set' : ''),
        c.keyStatus === 'set' ? '\u25CF key set' : '\u25CB no key',
      ));
      card.appendChild(r1);
      if (c.baseUrl) { card.appendChild(el('div', 'cbase', String(c.baseUrl))); }
      // Model multi-select (D29): pool = fetched list (never shrinks);
      // OK commits the ticked subset, Cancel reverts.
      const pool = c.all || c.models || [];
      const selected = new Set(c.models || []);
      if (pool.length > 0) {
        const det = document.createElement('details');
        const sum = el('summary', null,
            'Models (' + selected.size + ' of ' + pool.length + ')');
        det.appendChild(sum);
        const box = el('div', 'modellist');
        for (const mid of pool) {
          const lbl = el('label', 'mopt', null);
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = String(mid);
          cb.checked = selected.has(String(mid));
          lbl.appendChild(cb);
          lbl.appendChild(el('span', null, String(mid)));
          box.appendChild(lbl);
        }
        const rowBtns = el('div', 'mbtns');
        const okB = sbtn('OK', () => {
          const chosen = Array.from(box.querySelectorAll('input'))
            .filter((i) => i.checked)
            .map((i) => String(i.value));
          vsapi.postMessage({
            type: 'settings-models',
            connId: c.id,
            models: chosen,
          });
          sum.textContent = 'Models (' + chosen.length + ' of ' + pool.length + ')';
          det.open = false;
        });
        const cancelB = sbtn('Cancel', () => {
          for (const cb of Array.from(box.querySelectorAll('input'))) {
            cb.checked = selected.has(String(cb.value));
          }
          det.open = false;
        });
        rowBtns.appendChild(okB);
        rowBtns.appendChild(cancelB);
        box.appendChild(rowBtns);
        det.appendChild(box);
        card.appendChild(det);
      } else {
        card.appendChild(el(
          'div',
          'cmodels',
          'No models yet \u2014 set a key and use \u21BB Refresh models.',
        ));
      }
      const btns = el('div', 'cbtns');
      btns.appendChild(sbtn('Set key', () => {
        vsapi.postMessage({ type: 'settings-key', connId: c.id });
      }));
      const fb = sbtn('\u21BB Refresh models', () => {
        vsapi.postMessage({ type: 'settings-fetch', connId: c.id });
      });
      fb.disabled = Boolean(c.keyStatus !== 'set');
      btns.appendChild(fb);
      if (!c.builtin) {
        btns.appendChild(sbtn('Delete', () => {
          vsapi.postMessage({ type: 'settings-delete', connId: c.id });
        }, true));
      } else {
        card.appendChild(el('div', 'note', 'Built-in connection.'));
      }
      card.appendChild(btns);
      sec1.appendChild(card);
    }

    // Add-connection form
    const add = el('form', null);
    add.id = 'addForm';
    // A submit would reload the webview and wipe the page (0.4.2 bug).
    add.addEventListener('submit', (e) => { e.preventDefault(); });
    const pfrow = el('div', 'frow');
    const ppick = sel([
      { value: '', label: '\u2500 Start from a provider preset \u2500' },
      ...(d.presets || []).map((p) => ({
        value: p.value,
        label: p.label,
      })),
    ]);
    pfrow.appendChild(ppick);
    add.appendChild(pfrow);
    // No id field (D29): the id is derived from the preset choice, or from
    // the base-URL hostname for custom endpoints — users never see it.
    const fkind = sel([
      { value: 'openai', label: 'OpenAI-compatible' },
      { value: 'anthropic', label: 'Anthropic native' },
    ]);
    fkind.value = 'openai';
    add.appendChild(fkind);
        const fbase = el('input');
    fbase.placeholder = 'Base URL (e.g. http://localhost:4000/v1)';
    add.appendChild(fbase);
    // Key lives in the form (D29c): posted once to the host, stored in
    // SecretStorage, never rendered again — transient pass-through only.
    const fkey = el('input');
    fkey.type = 'password';
    fkey.placeholder = 'API key';
    fkey.autocomplete = 'off';
    add.appendChild(fkey);
    ppick.addEventListener('change', () => {
      const pre = (d.presets || []).find((p) => p.value === ppick.value);
      if (pre) {
        fkind.value = String(pre.kind);
        fbase.value = String(pre.baseUrl);
      }
    });
    add.appendChild(el(
      'div',
      'note',
      'Models are fetched automatically from this URL after adding.',
    ));
    add.appendChild(sbtn('Add connection', () => {
      const base = fbase.value.trim();
      if (!base) { return; }
      // Derive the connection id: preset id, else URL hostname.
      let id = String(ppick.value || '');
      if (!id) {
        try {
          id = new URL(base).hostname.split('.')[0].replace(/[^a-z0-9_-]/gi, '') || 'provider';
        } catch {
          id = 'provider';
        }
      }
      try {
        vsapi.postMessage({
          type: 'settings-add',
          connId: id,
          kind: fkind.value,
          baseUrl: base,
          apiKey: fkey.value,
        });
        fkey.value = ''; // transient: never linger in the DOM
      } catch (err) {
        // Never fail silently (0.5.1 bug was an uncaught webview throw).
        const f = el('div', 'note');
        f.style.padding = '6px 10px';
        f.textContent = 'Add failed: ' + String(err);
        add.appendChild(f);
      }
    }));
    sec1.appendChild(add);
    sec1.appendChild(el(
      'div',
      'note',
      'Connections are stored in your VS Code settings under plato.connections. Keys live in SecretStorage and are never displayed.',
    ));
    body.appendChild(sec1);

    // Preferences
    const sec2 = el('div', 'sec');
    sec2.appendChild(el('h4', null, 'Defaults'));
    const prow1 = el('div', 'prefrow');
    prow1.appendChild(el('label', null, 'Default model'));
    prow1.appendChild(sel(d.modelItems || [], d.defaultModel));
    prow1.lastChild.addEventListener('change', (e) => {
      vsapi.postMessage({ type: 'set-default-model', value: e.target.value });
    });
    sec2.appendChild(prow1);
    const prow2 = el('div', 'prefrow');
    prow2.appendChild(el('label', null, 'Reasoning effort (supported models only)'));
    prow2.appendChild(sel(
      [
        { value: 'off', label: 'off' },
        { value: 'low', label: 'low' },
        { value: 'medium', label: 'medium' },
        { value: 'high', label: 'high' },
      ],
      String(d.reasoning || 'off'),
    ));
    prow2.lastChild.addEventListener('change', (e) => {
      vsapi.postMessage({ type: 'set-reasoning', value: e.target.value });
    });
    sec2.appendChild(prow2);
    body.appendChild(sec2);

    // Observer (D30 UI): second model steering runs.
    const obs = d.observer || {};
    const sec3 = el('div', 'sec');
    sec3.appendChild(el('h4', null, 'Observer'));
    const prow3 = el('div', 'prefrow');
    const enLbl = el('label', 'mopt', 'Enable observer-AI (steers runs; never approves tools)');
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = Boolean(obs.enable);
    enLbl.insertBefore(en, enLbl.firstChild);
    prow3.appendChild(enLbl);
    sec3.appendChild(prow3);
    const prow4 = el('div', 'prefrow');
    prow4.appendChild(el('label', null, 'Observer model (empty = coder model)'));
    const oSel = sel(
      [{ value: '', label: '(same as coder)' }, ...(d.modelItems || [])],
      String(obs.model || ''),
    );
    prow4.appendChild(oSel);
    sec3.appendChild(prow4);
    const prow5 = el('div', 'prefrow');
    const pLbl = el('label', 'mopt', 'May pause runs');
    const pTog = document.createElement('input');
    pTog.type = 'checkbox';
    pTog.checked = Boolean(obs.pause);
    pLbl.insertBefore(pTog, pLbl.firstChild);
    prow5.appendChild(pLbl);
    const cLbl = el('label', 'mopt', 'May cancel runs');
    const cTog = document.createElement('input');
    cTog.type = 'checkbox';
    cTog.checked = Boolean(obs.cancel);
    cLbl.insertBefore(cTog, cLbl.firstChild);
    prow5.appendChild(cLbl);
    const mCap = el('input');
    mCap.type = 'number';
    mCap.min = '1';
    mCap.max = '50';
    mCap.value = String(obs.maxInterventions ?? 5);
    mCap.title = 'Max interventions per run';
    mCap.style.width = '70px';
    prow5.appendChild(el('label', null, 'Max interventions/run'));
    prow5.appendChild(mCap);
    sec3.appendChild(prow5);
    const saveObs = sbtn('Save observer settings', () => {
      vsapi.postMessage({
        type: 'set-observer',
        enable: en.checked,
        model: oSel.value,
        pause: pTog.checked,
        cancel: cTog.checked,
        maxInterventions: Number(mCap.value),
      });
    });
    sec3.appendChild(saveObs);
    sec3.appendChild(el(
      'div',
      'note',
      'Guidance is always allowed when enabled; pause/cancel need the toggles. Cap limits interventions per run.',
    ));
    body.appendChild(sec3);

    scroll();
  }
  // Model select + observer controls (D25f/D26d).
  const msel = document.getElementById('msel');
  const rsel = document.getElementById('rsel');
  rsel.appendChild((() => {
    const s = document.createElement('option');
    s.value = 'off';
    s.textContent = 'reasoning: off';
    return s;
  })());
  for (const v of ['low', 'medium', 'high']) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = 'reasoning: ' + v;
    rsel.appendChild(o);
  }
  msel.addEventListener('change', () => {
    vsapi.postMessage({ type: 'model', value: msel.value });
  });
  rsel.addEventListener('change', () => {
    vsapi.postMessage({ type: 'set-reasoning', value: rsel.value });
  });
  const g = document.getElementById('g');
  const pp = document.getElementById('pp');
  const cx = document.getElementById('cx');
  let paused = false;
  // Unified footer (D29d): while busy, the main input IS the guide box.
  const GUIDE_PLACEHOLDER =
    'Guide Plato mid-run\u2026 (injected at the next safe point)';
  const ASK_PLACEHOLDER = q.placeholder;
  function setRunUi(on) {
    pp.hidden = !on;
    cx.hidden = !on;
    q.placeholder = on ? GUIDE_PLACEHOLDER : ASK_PLACEHOLDER;
  }
  function sendGuidance() {
    const text = q.value.trim();
    if (!text || !busy) { return; }
    vsapi.postMessage({ type: 'guidance', text: text });
    addMsg('you', 'You', '[guide] ' + text);
    q.value = '';
  }
  pp.addEventListener('click', () => {
    if (!busy) { return; }
    paused = !paused;
    vsapi.postMessage({ type: paused ? 'pause' : 'resume' });
    pp.textContent = paused ? 'Resume' : 'Pause';
    lastAct = paused ? 'paused' : 'resuming';
    refreshChip();
  });
  cx.addEventListener('click', () => {
    if (!busy || cx.disabled) { return; }
    cx.disabled = true;
    pp.disabled = true;
    lastAct = 'cancelling';
    refreshChip();
    vsapi.postMessage({ type: 'cancel' });
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });

  function ask() {
    if (busy) { sendGuidance(); return; }
    const text = q.value.trim();
    if (!text) { return; }
    addMsg('you', 'You', text);
    q.value = '';
    busy = true;
    runT0 = Date.now();
    lastAct = 'thinking';
    refreshChip();
    setRunUi(true);
    vsapi.postMessage({ type: 'ask', text: text });
  }

  // Tool calls collapse into one summary line ("read_file × 12 · shell × 2").
  // Only completed calls (phase 'done') are counted, so the line always
  // matches the done card's tool-call count. Consecutive flushes update the
  // same line; any other message ends the chain and the next flush starts a
  // new line.
  let toolBuffer = [];
  let toolFlushTimer = null;
  let summaryLine = null;
  let summaryCounts = new Map();

  function flushToolBuffer() {
    if (toolBuffer.length === 0) return;
    const merging = summaryLine !== null && log.lastElementChild === summaryLine;
    const counts = merging ? summaryCounts : new Map();
    for (const evt of toolBuffer) {
      counts.set(evt.tool, (counts.get(evt.tool) || 0) + 1);
    }
    toolBuffer = [];
    summaryCounts = counts;
    const text = Array.from(counts.entries())
      .map((p) => p[0] + ' \u00d7 ' + p[1])
      .join(' \u00b7 ');
    if (merging) {
      summaryLine.textContent = text;
    } else {
      summaryLine = document.createElement('div');
      summaryLine.className = 'msg tool-summary';
      summaryLine.textContent = text;
      log.appendChild(summaryLine);
    }
    scroll();
  }

  function scheduleToolFlush() {
    if (toolFlushTimer) clearTimeout(toolFlushTimer);
    toolFlushTimer = setTimeout(flushToolBuffer, 500);
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    switch (m.type) {
      case 'models': {
        const current = msel.value;
        msel.textContent = '';
        let og = null;
        for (const it of m.items || []) {
          const g = String(it.group || '');
          if (!og || og.dataset.g !== g) {
            og = document.createElement('optgroup');
            og.label = g;
            og.dataset.g = g;
            msel.appendChild(og);
          }
          const o = document.createElement('option');
          o.value = String(it.value);
          o.textContent = String(it.label);
          og.appendChild(o);
        }
        // Reasoning control (D28 phase 2): visible only for capable models.
        rsel.hidden = !m.reasoningCapable;
        if (typeof m.reasoning === 'string') {
          rsel.value = m.reasoning;
        }
        // Preserve selection across rebuilds; if it's not in the new list
        // (e.g., a manually-typed model), add it as a hidden option so the
        // dropdown still displays it.
        if (current) {
          const inList = Array.from(msel.options).some((o) => o.value === current);
          if (!inList) {
            const o = document.createElement('option');
            o.value = current;
            o.textContent = current;
            o.style.display = 'none';
            msel.appendChild(o);
          }
          msel.value = current;
        }
        break;
      }
      case 'settings': showSettings(m); break;
      case 'history': showHistory(m.runs); break;
      case 'run': showRun(m); break;
      case 'restore':
        document.body.classList.remove('show-settings', 'show-history');
        render(m.log);
        if (
          typeof m.model === 'string' &&
          Array.from(msel.options).some((o) => o.value === m.model)
        ) {
          msel.value = String(m.model);
        }
        break;
      case 'md': flushToolBuffer(); streamHtml(String(m.text || '')); lastAct = 'writing'; refreshChip(); break;
      case 'notice': flushToolBuffer(); addMsg('sys', 'Plato', m.text); break;
      case 'tool':
        // Only completed calls count; pending/denied phases stay in the chip.
        if (m.phase === 'done') {
          toolBuffer.push({ tool: m.tool, phase: m.phase });
          scheduleToolFlush();
        }
        lastAct = String(m.tool);
        refreshChip();
        break;
      case 'approval':
        flushToolBuffer();
        showCard(m);
        lastAct = 'waiting for you';
        refreshChip();
        break;
      case 'done': {
        flushToolBuffer();
        finish();
        const i = m.text || {};
        const line = '\u2713 done in ' + (i.secs ?? '?') + 's \u00b7 '
          + (i.tools === 1 ? '1 tool call' : (i.tools ?? 0) + ' tool calls')
          + (i.tok ? ' \u00b7 ' + i.tok : '')
          + (i.cost ? ' \u00b7 ' + i.cost : '')
          + (i.note ? ' \u2014 ' + i.note : '');
        addMsg('fin', null, line);
        chipOn('\u2713 done in ' + (i.secs ?? '?') + 's', true);
        runT0 = 0;
        break;
      }
      case 'error':
        flushToolBuffer();
        finish();
        chipOff();
        runT0 = 0;
        addMsg('bot', 'Error', m.text);
        break;
    }
  });

  function render(entries) {
    log.textContent = '';
    stick = true;
    for (const t of entries) { appendEntry(t); }
    flushToolBuffer();
    chipOff();
    runT0 = 0;
    scroll();
  }

  function appendEntry(t) {
    // Replay uses the same collapsing rule as live runs: consecutive tool
    // entries merge into one summary line, any other entry ends the chain.
    if (t.k !== 'tool') { flushToolBuffer(); }
    switch (t.k) {
      case 'msg':
        if (t.cls === 'bot' && t.html) {
          addMsg('bot', t.who, String(t.html), true);
        } else {
          addMsg(t.cls || 'bot', t.who, String(t.text));
        }
        break;
      case 'tool':
        if (t.phase === 'done') { toolBuffer.push({ tool: t.tool, phase: t.phase }); }
        break;
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
    return div;
  }

  function streamHtml(html) {
    streaming = true;
    let el = document.getElementById('streaming');
    if (!el) {
      el = addMsg('bot', 'Plato', '');
      el.id = 'streaming';
    }
    el.innerHTML = html; // host-built, escape-first (D25a)
    scroll();
  }

  function finish() {
    const el = document.getElementById('streaming');
    if (el) { el.removeAttribute('id'); }
    streaming = false;
    busy = false;
    setRunUi(false);
    paused = false;
    pp.textContent = 'Pause';
    pp.disabled = false;
    cx.disabled = false;
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
    const all = document.createElement('button');
    all.textContent = 'Approve all ' + m.tool + ' for this session';
    all.className = 'all';
    const no = document.createElement('button');
    no.className = 'no';
    no.textContent = 'Deny';
    yes.addEventListener('click', () => decide(true));
    all.addEventListener('click', () => decideAll());
    no.addEventListener('click', () => decide(false));
    function decide(v) {
      vsapi.postMessage({ type: 'approve', value: v ? 'yes' : 'no' });
      actions.remove();
      h.textContent = h.textContent.replace('?', v ? ' — allowed' : ' — denied');
      addMsg('you', 'You', v ? '[allowed]' : '[denied]');
    }
    function decideAll() {
      vsapi.postMessage({ type: 'approve-all', tool: m.tool });
      actions.remove();
      h.textContent = h.textContent.replace('?', ' — approved for session');
      addMsg('you', 'You', '[approved all ' + m.tool + ' for this session]');
    }
    actions.appendChild(yes);
    actions.appendChild(all);
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

  // Follow new output only while the user is already near the bottom;
  // never yank the view if they scrolled up to read.
  let stick = true;
  log.addEventListener('scroll', () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  });
  function scroll() { if (stick) { log.scrollTop = log.scrollHeight; } }
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
