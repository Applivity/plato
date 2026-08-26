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
  #gear { margin-left:auto; font-size:16px; line-height:1;
          padding:3px 10px; border-radius:6px; }
  #new { border:1px solid var(--pl-border); border-radius:10px;
         padding:2px 9px; font-size:12px; cursor:pointer;
         background:transparent; color:var(--pl-muted); }
  #new:hover { border-color:var(--pl-accent); color:var(--vscode-editor-foreground); }
  #log { flex:1; overflow-y:auto; padding:10px 14px; }
  .observer { display:none; gap:6px; padding:6px 10px; align-items:center;
              border-top:1px dashed var(--pl-border); }
  .observer.on { display:flex; }
  .observer #g { flex:1; padding:5px 9px; font-family:var(--vscode-font-family);
                 font-size:12px; border-radius:5px; border:1px solid var(--pl-border);
                 background:var(--vscode-input-background);
                 color:var(--vscode-input-foreground); outline:none; }
  .observer button { padding:5px 10px; cursor:pointer; border:none;
                     border-radius:4px; font-size:11.5px;
                     background:var(--vscode-button-secondaryBackground,#3a3d41);
                     color:var(--vscode-button-secondaryForeground,#ddd); }
  .observer #gsend { background:var(--vscode-button-background);
                     color:var(--vscode-button-foreground); }
  .observer #cx { color:var(--vscode-testing-iconFailed,#f14c4c); }
  .observer button:disabled { opacity:.45; cursor:default; }
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
  .conn .mopt { display:flex; align-items:center; gap:6px;
                padding:2px 4px; cursor:pointer; }
  .conn .mopt:hover { background:var(--vscode-list-hoverBackground,
                                       rgba(128,128,128,.12)); }
  .conn .mopt input { margin:0; }
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
    <button id="gear" title="Settings — connections, keys, defaults">⚙</button>
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
<div id="obs">
  <input id="g" placeholder="Guide Plato mid-run… (injected at the next safe point)">
  <button id="gsend" title="Send guidance">Send</button>
  <button id="pp" title="Pause at the next safe point">Pause</button>
  <button id="cx" title="Stop after the current tool call">Cancel</button>
</div>
<footer>
  <textarea id="q" rows="2" placeholder="Describe the change… (Enter to send, Shift+Enter for newline)"></textarea>
  <button id="go" title="Send">Send</button>
</footer>
<div id="settingsPage">
  <header class="shead">
    <button id="sback">‹ Back</button>
    <span class="label">Plato Settings</span>
  </header>
  <div id="sbody"></div>
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
  const obs = document.getElementById('obs');
  const gear = document.getElementById('gear');
  gear.addEventListener('click', () => {
    vsapi.postMessage({ type: 'openSettings' });
  });
  document.getElementById('sback').addEventListener('click', () => {
    document.body.classList.remove('show-settings');
    vsapi.postMessage({ type: 'settings-closed' });
  });

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
      // Model multi-select (D29): collapsible checkbox list of FETCHED models
      // only — catalog guesses never appear here.
      const pool = c.models || [];
      if (pool.length > 0) {
        const det = document.createElement('details');
        const sum = el('summary', null,
            'Models (' + pool.length + ' selected)');
        det.appendChild(sum);
        const box = el('div', 'modellist');
        for (const mid of pool) {
          const lbl = el('label', 'mopt', null);
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = String(mid);
          cb.checked = true;
          lbl.appendChild(cb);
          lbl.appendChild(el('span', null, String(mid)));
          box.appendChild(lbl);
        }
        box.addEventListener('change', () => {
          const chosen = Array.from(box.querySelectorAll('input:checked'))
            .map((i) => String(i.value));
          vsapi.postMessage({ type: 'settings-models', connId: c.id, models: chosen });
        });
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

    scroll();
  }
  // Model select + observer controls (D25f/D26d).
  const msel = document.getElementById('msel');
  msel.addEventListener('change', () => {
    vsapi.postMessage({ type: 'model', value: msel.value });
  });
  const g = document.getElementById('g');
  const pp = document.getElementById('pp');
  const cx = document.getElementById('cx');
  let paused = false;
  function setObs(on) { obs.classList.toggle('on', on); }
  document.getElementById('gsend').addEventListener('click', sendGuidance);
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendGuidance(); }
  });
  function sendGuidance() {
    const text = g.value.trim();
    if (!text || !busy) { return; }
    vsapi.postMessage({ type: 'guidance', text: text });
    addMsg('you', 'You', '[guide] ' + text);
    g.value = '';
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
    if (busy) { return; }
    const text = q.value.trim();
    if (!text) { return; }
    addMsg('you', 'You', text);
    q.value = '';
    busy = true;
    runT0 = Date.now();
    lastAct = 'thinking';
    refreshChip();
    setObs(true);
    vsapi.postMessage({ type: 'ask', text: text });
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    switch (m.type) {
      case 'models': {
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
        break;
      }
      case 'settings': showSettings(m); break;
      case 'restore':
        render(m.log);
        if (
          typeof m.model === 'string' &&
          Array.from(msel.options).some((o) => o.value === m.model)
        ) {
          msel.value = String(m.model);
        }
        break;
      case 'md': streamHtml(String(m.text || '')); lastAct = 'writing'; refreshChip(); break;
      case 'notice': addMsg('sys', 'Plato', m.text); break;
      case 'tool':
        addMsg('tool', null,
          '<code>' + esc(m.tool) + '</code> ' + esc(m.phase), true);
        lastAct = String(m.tool);
        refreshChip();
        break;
      case 'approval':
        showCard(m);
        lastAct = 'waiting for you';
        refreshChip();
        break;
      case 'done': {
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
    chipOff();
    runT0 = 0;
    scroll();
  }

  function appendEntry(t) {
    switch (t.k) {
      case 'msg':
        if (t.cls === 'bot' && t.html) {
          addMsg('bot', t.who, String(t.html), true);
        } else {
          addMsg(t.cls || 'bot', t.who, String(t.text));
        }
        break;
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
    setObs(false);
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
