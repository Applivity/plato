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
  .hrow { display:flex; align-items:center; gap:8px; width:100%; }
  .hrow .brand { font-weight:600; font-size:12.5px; letter-spacing:.02em; }
  .hrow .label { color:var(--pl-muted); font-size:11px; text-transform:uppercase;
                 letter-spacing:.08em; }
  .hrow .spacer { flex:1; }
  /* D39: model picker trigger (replaces the native #msel). Looks like
     a text link with a small caret, opens a custom popover. */
  #modelBtn { display:inline-flex; align-items:center; gap:5px;
              background:transparent; border:1px solid transparent;
              color:var(--vscode-editor-foreground);
              font-family:inherit; font-size:12.5px; font-weight:500;
              padding:3px 8px; border-radius:5px; cursor:pointer;
              max-width:420px; }
  #modelBtn:hover { background:rgba(128,128,128,.08); }
  #modelBtn .caret { color:var(--pl-muted); flex:none; }
  #modelBtn-label, .model-btn-label { white-space:nowrap; overflow:hidden;
                                      text-overflow:ellipsis; }
  /* D39: paired history + settings nav, right side of the header. */
  .headnav { margin-left:auto; display:inline-flex; gap:2px; padding:2px;
             border:1px solid var(--pl-border); border-radius:999px; }
  /* D39g: square hit areas, centered icons, and a highlighted state
     for whichever nav page is open (history / settings). */
  #hist, #gear { display:inline-flex; align-items:center; justify-content:center;
                 width:24px; height:20px; padding:0; border:none;
                 border-radius:999px; background:transparent; cursor:pointer;
                 color:var(--pl-muted);
                 transition:color .1s, background .1s; }
  #hist:hover, #gear:hover { color:var(--vscode-editor-foreground);
                             background:rgba(128,128,128,.1); }
  body.show-history #hist, body.show-settings #gear {
                 color:var(--vscode-editor-foreground);
                 background:rgba(128,128,128,.14); }
  /* D39: status row under the model row - new-chat, compaction status,
     orchestration chip, run-status indicator. Compact pill is no longer
     a button; the right-side nav is now history+settings paired. */
  .hstatus { font-size:11px; color:var(--pl-muted); gap:10px; align-items:center; }
  .hstatus .hstatus-spacer { flex:1; }
  /* D39g: one shared chip style for the status-row buttons (#new and
     #orchChip). Same muted/bordered color language as .bar-btn, but
     pill-shaped so the status row reads as chips instead of form
     controls. Identical metrics keep the two controls level. */
  #new, .orch-chip {
             font-family:inherit; display:inline-flex; align-items:center;
             background:transparent; border:1px solid var(--pl-border);
             border-radius:999px; padding:2px 10px; font-size:11px;
             line-height:1.4; cursor:pointer; color:var(--pl-muted);
             transition:color .1s, border-color .1s, background .1s; }
  #new:hover, .orch-chip:hover {
             color:var(--vscode-editor-foreground);
             border-color:var(--vscode-focusBorder, #6a6a6a);
             background:rgba(128,128,128,.08); }
  .icn { width:14px; height:14px; fill:none; stroke:currentColor;
         stroke-width:2; stroke-linecap:round; stroke-linejoin:round;
         vertical-align:-2px; }
  /* D39b: reasoning select stays a native <select> (the options list is
   short and OS-handled) but the trigger is restyled to look like a
   sibling of #modelBtn - same text-link style, no background fill.
   Keeps the same hover and spacing so the header reads as a single
   row of pickers. */
  #rsel { font-family:inherit; font-size:12px; padding:3px 6px;
          border-radius:5px; border:1px solid transparent;
          background:transparent; color:var(--vscode-editor-foreground);
          cursor:pointer; outline:none; }
  #rsel:hover { background:rgba(128,128,128,.08); }
  #rsel[hidden] { display:none; }
  /* D39g: the duplicate #new rule that overrode the one above (pill
     radius vs 4px) is gone - #new is defined once, in the .hstatus
     chip block. */
  /* D39b: chat log grows to fill available space; the footer (now
     two rows) takes its own intrinsic height. The textbox grows
     vertically up to 220px (was 160px) and the textbox itself is
     taller by default (rows=3, min-height 56px was 44px) so the
     user has more room to think before reaching the cap. */
  #log { flex:1; overflow-y:auto; padding:10px 14px; min-height:0; }
  /* D39b: #pp and #cx are now styled by .bar-btn (matches the other
     controls in the composer-bar). The old 44px-tall square styling
     is gone. */
  #pp[hidden], #cx[hidden] { display:none; }
  #pp:disabled, #cx:disabled { opacity:.45; cursor:default; }
  /* D39b: footer is now a two-row stack - textarea on top, controls
     on bottom (in .composer-bar with its own top border). The footer
     itself no longer needs the right-side send button column. */
  footer { display:flex; flex-direction:column; gap:0;
           padding:8px 12px 8px;
           border-top:1px solid var(--pl-border);
           background:var(--vscode-editor-background); }
  /* D39e: textarea-wrap holds the textarea + the context ring as
     an overlay. The ring is positioned absolute in the top-left
     corner; the textarea's padding-left reserves room for it. */
  .textarea-wrap { position:relative; }
  #q { width:100%; flex:1; resize:none; min-height:56px; max-height:220px;
       padding:9px 38px 9px 11px; font-family:var(--vscode-font-family);
       font-size:13px; line-height:1.5; border-radius:6px;
       border:1px solid var(--pl-border); outline:none;
       background:var(--vscode-input-background);
       color:var(--vscode-input-foreground); }
  #q { border-width:1.5px; }
  #q:focus { border-color:inherit; box-shadow:none; outline:none; }
  /* D39e: the textbox border tracks the active mode (1.5px) and
     thickens a hair on focus. The footer bottom padding is
     8px (was 4px) so the border doesn't crowd the bar's top
     divider line. */
  footer.mode-plan #q { border-color:#9575cd; }
  footer.mode-edit #q { border-color:#4a9eff; }
  footer.mode-act  #q { border-color:#e08a3c; }
  footer.mode-auto #q { border-color:#3bba6a; }
  footer.mode-plan #q:focus,
  footer.mode-edit #q:focus,
  footer.mode-act  #q:focus,
  footer.mode-auto #q:focus { border-color:inherit;
                               box-shadow:inset 0 0 0 1px currentColor; }
  /* #go is now styled by .btn-send (with per-mode color). The old
     44x44 square styling is gone; the send button is a normal
     pill that lives in .composer-bar. */
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
  .card button:disabled { opacity: 0.5; cursor: not-allowed; }
  .card button.no { background:var(--vscode-button-secondaryBackground,
                                    #3a3d41);
                    color:var(--vscode-button-secondaryForeground, #ddd); }
  .q-form { padding: 4px 10px; display:flex; flex-direction:column; gap:12px; }
  .q-progress { font-size:11px; color:var(--pl-muted); padding:2px 0; }
  .q-block { display:flex; flex-direction:column; gap:6px; }
  .q-title { font-weight:600; font-size:12px; color:var(--vscode-foreground); }
  .q-context { font-size:11.5px; color:var(--pl-muted); line-height:1.4; margin-bottom:2px; }
  .q-options { display:flex; flex-direction:column; gap:4px; }
  .q-option { display:flex; align-items:flex-start; gap:8px; padding:6px 8px;
              background:var(--vscode-editorWidget-background, rgba(128,128,128,.12));
              border:1px solid transparent; border-radius:4px; cursor:pointer; }
  .q-option:hover { background:var(--vscode-list-hoverBackground, rgba(128,128,128,.2)); }
  .q-option.selected { border-color:var(--vscode-focusBorder); background:var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.3)); }
  .q-radio { margin-top:2px; width:12px; height:12px; border-radius:50%; border:1px solid var(--pl-muted); flex-shrink:0; }
  .q-option.selected .q-radio { border-color:var(--pl-accent); background:var(--pl-accent); }
  .q-text { font-size:12px; line-height:1.3; }
  .q-custom-row { padding-top:4px; padding-bottom:4px; }
  .q-custom-row input { width:100%; padding:6px; background:var(--vscode-input-background);
                        color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border);
                        border-radius:3px; outline:none; }
  .q-custom-row input:focus { border-color:var(--vscode-focusBorder); }
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
  body.show-settings #obs, body.show-settings footer,
  body.show-settings #statusbar { display:none !important; }
  #settingsPage { display:none; }
  body.show-settings #settingsPage { display:flex; flex-direction:column;
                                     height:100vh; }
  body.show-history header:not(.shead), body.show-history #log,
  body.show-history #obs, body.show-history footer,
  body.show-history #statusbar { display:none !important; }
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
  header.shead { padding:18px 24px 14px; gap:8px; border-bottom:1px solid var(--pl-border);
                  display:flex; align-items:baseline; }
  header.shead .stitle { font-size:18px; font-weight:600;
                         color:var(--vscode-editor-foreground); }
  header.shead .sback { background:transparent; border:none; padding:0;
                        color:var(--pl-muted); cursor:pointer; font-size:12.5px;
                        font-family:inherit; }
  header.shead .sback:hover { color:var(--vscode-editor-foreground);
                              text-decoration:underline; }
  header.shead .sback::before { content:'\u2190\u00a0'; opacity:.7; }
  /* --- Settings page (D38: full rewrite) --- */
  #sbody { flex:1; overflow-y:auto; padding:24px 20px; }
  #sbody .wrap { max-width:720px; margin:0 auto; }
  .shead2 { margin:0 0 6px; font-size:11px; font-weight:600;
            text-transform:uppercase; letter-spacing:.1em;
            color:var(--pl-muted); }
  .shead3 { margin:0 0 10px; font-size:14px; font-weight:600; }
  .shead2 + .shelp { margin:0 0 14px; font-size:12px; color:var(--pl-muted);
                     line-height:1.45; }
  .sec { margin-bottom:28px; }
  /* Section blocks (Orchestration + Context). */
  .sblock { border:1px solid var(--pl-border); border-radius:8px;
            padding:16px 18px; background:var(--vscode-editorWidget-background,
                                               rgba(128,128,128,.04)); }
  .sblock .row { display:flex; align-items:center; gap:10px; }
  .sblock .row + .row { margin-top:10px; }
  .sblock label { font-size:12.5px; color:var(--vscode-editor-foreground);
                  min-width:140px; }
  .sblock select, .sblock input[type=range] {
      flex:1; padding:5px 8px; font-size:12.5px; border-radius:4px;
      border:1px solid var(--pl-border);
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground); outline:none; }
  .sblock input[type=range] { padding:0; height:6px; }
  .sblock .liveval { font-size:11.5px; color:var(--pl-muted);
                     min-width:80px; text-align:right; font-variant-numeric:tabular-nums; }
  /* Mode picker cards. */
  .modes { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; }
  .mcard { border:1px solid var(--pl-border); border-radius:8px;
           padding:12px 14px; cursor:pointer; background:transparent;
           transition:border-color .12s, background .12s; }
  .mcard:hover { border-color:var(--vscode-focusBorder, #6a6a6a); }
  .mcard.on { border-color:var(--vscode-focusBorder, #6a9bd1);
              background:rgba(106,155,209,.10); }
  .mcard .mtitle { font-weight:600; font-size:13.5px; margin-bottom:3px; }
  .mcard .mdesc { font-size:11.5px; color:var(--pl-muted);
                  line-height:1.4; }
  /* Academy status block. */
  .astat { margin-top:14px; padding:10px 12px; border-radius:6px;
           border:1px solid var(--pl-border); }
  .astat .aok { color:var(--vscode-testing-iconPassed,#73c991);
                font-size:12px; }
  .astat .aerr { color:var(--vscode-testing-iconFailed,#f14c4c);
                 font-size:12px; }
  .astat .note { font-size:11.5px; color:var(--pl-muted); margin-top:4px; }
  /* Duo sub-block (only rendered when mode === 'duo'). */
  .duo { margin-top:14px; padding-top:14px;
         border-top:1px solid var(--pl-border); }
  .duo .grid { display:grid; grid-template-columns:150px 1fr; gap:10px 12px;
               align-items:center; }
  .duo .grid label { font-size:12.5px; min-width:0; }
  .duo .pdesc { grid-column:1 / -1; font-size:11.5px; color:var(--pl-muted);
                line-height:1.5; margin-top:-2px; }
  .duo .toggles { grid-column:2; display:flex; gap:16px; flex-wrap:wrap; }
  .duo .tog { display:flex; align-items:center; gap:6px; font-size:12px; }
  .duo .tog input { margin:0; }
  /* Connection cards. */
  .conn-list { display:flex; flex-direction:column; gap:10px; }
  .conn { border:1px solid var(--pl-border); border-radius:8px;
          padding:12px 14px; background:transparent; }
  .conn .row1 { display:flex; align-items:center; gap:10px; }
  .conn .cid { font-weight:600; font-size:13.5px; }
  .conn .ckind { font-size:10.5px; color:var(--pl-muted);
                 border:1px solid var(--pl-border); border-radius:10px;
                 padding:1px 8px; text-transform:lowercase; }
  .conn .cstat { margin-left:auto; display:inline-flex; align-items:center;
                 gap:5px; font-size:11.5px; color:var(--pl-muted);
                 padding:2px 9px; border-radius:10px;
                 border:1px solid var(--pl-border); }
  .conn .cstat.set { color:var(--vscode-testing-iconPassed,#73c991);
                     border-color:rgba(115,201,145,.35); }
  .conn .cstat.miss { color:var(--vscode-testing-iconFailed,#f14c4c);
                      border-color:rgba(241,76,76,.35); }
  .conn .cstat .dot { width:7px; height:7px; border-radius:50%;
                      background:currentColor; }
  .conn .cbase { font-size:11.5px; color:var(--pl-muted);
                 word-break:break-all; margin-top:6px; }
  .conn .crow { display:flex; align-items:center; gap:8px;
                margin-top:10px; flex-wrap:wrap; }
  /* Model multi-select inside a connection card. */
  .conn .picker { margin-top:10px; border:1px solid var(--pl-border);
                  border-radius:6px; overflow:hidden; }
  .conn .picker > summary { cursor:pointer; padding:7px 11px; font-size:12px;
                           color:var(--pl-muted); list-style:none;
                           display:flex; align-items:center; gap:6px; }
  .conn .picker > summary::-webkit-details-marker { display:none; }
  .conn .picker > summary::before { content:'\u25B8'; font-size:9px; }
  .conn .picker[open] > summary::before { content:'\u25BE'; }
  .conn .picker > summary:hover { color:var(--vscode-editor-foreground); }
  .conn .modellist { display:grid; grid-template-columns:1fr 1fr;
                     gap:1px 10px; padding:8px 11px;
                     max-height:220px; overflow-y:auto;
                     background:var(--vscode-input-background); }
  .conn .mopt { display:flex; align-items:center; gap:7px;
                padding:3px 4px; cursor:pointer; font-size:12px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .conn .mopt:hover { background:var(--vscode-list-hoverBackground,
                                       rgba(128,128,128,.12)); }
  .conn .mopt input { margin:0; flex:none; }
  .conn .mopt span { overflow:hidden; text-overflow:ellipsis; }
  .conn .mbtns { grid-column:1 / -1; display:flex; gap:8px; margin-top:8px;
                 padding-top:8px; border-top:1px solid var(--pl-border); }
  /* Add-connection card: the prominent CTA. */
  .add-card { border:1px dashed var(--pl-border); border-radius:8px;
              padding:16px 18px; margin-top:14px;
              background:rgba(128,128,128,.03); }
  .add-card .add-title { font-size:13px; font-weight:600; margin-bottom:12px; }
  .add-card .grid { display:grid; grid-template-columns:130px 1fr;
                    gap:10px 12px; align-items:center; }
  .add-card label { font-size:12px; color:var(--pl-muted); }
  .add-card input, .add-card select { padding:6px 9px; font-size:12.5px;
                                      border-radius:4px;
                                      border:1px solid var(--pl-border);
                                      background:var(--vscode-input-background);
                                      color:var(--vscode-input-foreground);
                                      outline:none; width:100%; }
  .add-card .actions { margin-top:14px; display:flex; gap:8px;
                       align-items:center; }
  .add-card .err { color:var(--vscode-testing-iconFailed,#f14c4c);
                   font-size:11.5px; margin-top:8px; }
  /* Button taxonomy (D38): primary / secondary / ghost / danger-icon. */
  .btn { font-family:inherit; cursor:pointer; border-radius:5px;
         padding:5px 12px; font-size:12px; line-height:1.4;
         transition:background .1s, border-color .1s, color .1s; }
  .btn-primary { background:var(--vscode-button-background);
                 color:var(--vscode-button-foreground); border:1px solid transparent; }
  .btn-primary:hover { background:var(--vscode-button-hoverBackground); }
  .btn-secondary { background:transparent;
                   color:var(--vscode-editor-foreground);
                   border:1px solid var(--pl-border); }
  .btn-secondary:hover { border-color:var(--vscode-focusBorder,#6a6a6a);
                         background:rgba(128,128,128,.06); }
  .btn-ghost { background:transparent; border:none; padding:5px 8px;
               color:var(--pl-muted); }
  .btn-ghost:hover { color:var(--vscode-editor-foreground);
                     text-decoration:underline; }
  .btn-icon-danger { background:transparent; border:1px solid transparent;
                     color:var(--pl-muted); padding:3px 7px; border-radius:4px;
                     font-size:11.5px; }
  .btn-icon-danger:hover { color:var(--vscode-testing-iconFailed,#f14c4c);
                           border-color:rgba(241,76,76,.35); }
  .note { font-size:11.5px; color:var(--pl-muted); margin-top:4px;
          line-height:1.45; }
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
  .md-table { margin:.6em 0; overflow-x:auto; }
  .md-table table { border-collapse:collapse; font-size:12px; }
  .md-table th, .md-table td { border:1px solid var(--pl-border);
             padding:4px 9px; vertical-align:top; }
  .md-table th { background:var(--vscode-editorWidget-background,
                               rgba(128,128,128,.12)); font-weight:600; }
  .team-card { margin:.5em 0; padding:7px 10px; border:1px solid var(--pl-border);
               border-radius:5px; font-size:11.5px; }
  .team-card .team-name { font-weight:600; margin-bottom:4px; }
  .team-card .team-member { display:flex; gap:8px; align-items:baseline;
                            padding:1px 0; }
  .team-card .tm-name { font-weight:600; min-width:70px; }
  .team-card .tm-kind { font-size:10px; padding:1px 6px; border-radius:8px;
                        text-transform:uppercase; letter-spacing:.04em; }
  .team-card .tm-kind.is-coder { background:rgba(70,130,180,.2); }
  .team-card .tm-kind.is-observer { background:rgba(140,100,180,.2); }
  .team-card .tm-model { color:var(--pl-muted); }
  .team-card .tm-tier { font-size:10px; color:var(--pl-muted);
                        border:1px solid var(--pl-border); border-radius:8px;
                        padding:0 5px; }
  details.sec { border:1px solid var(--pl-border); border-radius:5px;
                margin-bottom:10px; }
  details.sec > summary { padding:7px 10px; cursor:pointer; font-weight:600;
                          font-size:12px; user-select:none; list-style:none; }
  details.sec > summary::before { content:'\\25B8 '; display:inline-block;
                   transition:transform .1s; }
  details.sec[open] > summary::before { transform:rotate(90deg); }
  details.sec .secbody { padding:0 10px 10px; }
  .mrow { display:flex; gap:8px; margin:6px 0; }
  .mcard { flex:1; border:1px solid var(--pl-border); border-radius:5px;
           padding:8px 10px; cursor:pointer; }
  .mcard:hover { border-color:var(--vscode-focusBorder, #666); }
  .mcard.on { border-color:var(--vscode-focusBorder, #666);
              background:var(--vscode-editorWidget-background,
                              rgba(128,128,128,.12)); }
  .mcard .mtitle { font-weight:600; font-size:12px; }
  .mcard .mdesc { font-size:10.5px; color:var(--pl-muted); margin-top:2px; }
  .astat { margin:6px 0; }
  .astat .aok { font-size:11.5px; padding:5px 8px;
                border:1px solid var(--pl-border); border-radius:4px; }
  .astat .aerr { font-size:11.5px; padding:5px 8px; border-radius:4px;
                 border:1px solid var(--vscode-inputValidation-errorBorder, #f66);
                 color:var(--vscode-errorForeground, #f66); }
  .pdesc { font-size:11px; color:var(--pl-muted); font-style:italic;
           margin:4px 0 8px; padding:6px 8px; border-left:2px solid var(--pl-border); }
  /* D39g: #orchChip now shares the status-row chip style with #new
     (see the .hstatus block) - the old 10.5px one-off chip rule is
     gone. */
  /* Pinned run-status bar (Claude-code style): sits between the scrollable
     #log and the footer, so it is ALWAYS visible during a run — content
     scrolling below never buries it. Hidden otherwise & on settings/history. */
  #statusbar { display:flex; align-items:center; gap:8px; padding:5px 14px;
               border-top:1px solid var(--pl-border);
               font-size:12px; font-style:italic; color:var(--pl-muted);
               background:var(--vscode-editor-background); }
  #statusbar[hidden] { display:none; }
  #statusbar .pdot { width:8px; height:8px; border-radius:50%; flex:none;
               background:var(--vscode-focusBorder, #4a9eff);
               animation:platoPulse 1.1s ease-in-out infinite; }
  @keyframes platoPulse { 0%,100% { opacity:.2; transform:scale(.8); }
                          50% { opacity:1; transform:scale(1.15); } }
  #statusbar .dots::after { content:''; animation:platoDots 1.5s steps(4,end) infinite; }
  @keyframes platoDots { 0%{content:''} 25%{content:'.'} 50%{content:'..'} 75%{content:'...'} }
  #statusbar .sbtn { margin-left:auto; font-style:normal; font-size:11px;
               padding:2px 10px; border-radius:4px; cursor:pointer; border:none;
               background:var(--vscode-button-secondaryBackground,#3a3d41);
               color:var(--vscode-button-secondaryForeground,#ddd); }
  /* D39: drop #mctx (the "ctx 200.0k" label next to the model
     dropdown). Per-model context windows are still shown in the
     dropdown options themselves; the run's *current* context is the
     ring's job, not a label. */
  /* D40: the compact status pill is gone — the context ring's tooltip
     is the one compaction control. In its place (left of the status
     row): the conversation title chip, model-generated, hover reveals
     a pencil; click turns it into an inline input. */
  .ctitle { display:inline-flex; align-items:center; gap:5px;
            max-width:300px; padding:2px 10px;
            border:1px solid transparent; border-radius:999px;
            font-size:11px; line-height:1.4; color:var(--pl-muted);
            cursor:text; transition:color .1s, border-color .1s, background .1s; }
  .ctitle[hidden] { display:none; }
  .ctitle:hover { color:var(--vscode-editor-foreground);
                  border-color:var(--pl-border);
                  background:rgba(128,128,128,.08); }
  .ctitle #chatTitleText { white-space:nowrap; overflow:hidden;
                           text-overflow:ellipsis; }
  .ctitle .ctitle-edit { width:11px; height:11px; flex:none; opacity:0;
                         transition:opacity .1s; }
  .ctitle:hover .ctitle-edit { opacity:.7; }
  #chatTitleInput { font-family:inherit; font-size:11px; padding:2px 10px;
                    border:1px solid var(--vscode-focusBorder, #6a6a6a);
                    border-radius:999px; width:220px;
                    background:var(--vscode-input-background);
                    color:var(--vscode-input-foreground); outline:none; }
  #chatTitleInput[hidden] { display:none; }
  /* D39e: ring sits as a 24px overlay in the top-left corner of the
     textarea. The tooltip opens UPWARD into the chat-log area, so
     the user can read it without it covering typed text. */
  .ring-wrap { position:absolute; top:9px; right:9px;
               width:24px; height:24px; pointer-events:auto;
               z-index:2; }
  #contextRing { width:24px; height:24px; display:block; cursor:help; }
  #contextRing .track { fill:none; stroke:var(--pl-border); stroke-width:3; }
  #contextRing .fill { fill:none; stroke:var(--vscode-focusBorder, #4a9eff);
                       stroke-width:3; stroke-linecap:round;
                       transform:rotate(-90deg); transform-origin:50% 50%;
                       transition:stroke-dashoffset .25s ease,
                                  stroke .2s ease; }
  #contextRing.warn .fill { stroke:var(--vscode-editorWarning-foreground, #cca700); }
  #contextRing.crit .fill { stroke:var(--vscode-testing-iconFailed, #f14c4c); }
  #contextRing.unknown .fill { stroke:var(--pl-muted); opacity:.4; }
  #contextRing .label { font-size:8.5px; fill:var(--pl-muted);
                        font-family:var(--vscode-font-family);
                        text-anchor:middle; dominant-baseline:central; }
  /* D39e: opens UPWARD and is RIGHT-anchored because the ring lives
     in the textarea's top-right corner (same as D37's overlay).
     Centering would push half the 240px panel off the right edge. */
  #contextBreakdown { display:none; position:absolute;
                      right:-4px; bottom:36px;
                      min-width:240px; max-width:320px;
                      background:var(--vscode-editorWidget-background, #252526);
                      border:1px solid var(--pl-border); border-radius:6px;
                      padding:8px 10px; font-size:11.5px; z-index:5;
                      box-shadow:0 4px 14px rgba(0,0,0,.35);
                      color:var(--vscode-foreground); }
  .runitem.current { border-left:2px solid var(--pl-accent); }
  .runitem.current .rt::after { content:' \u2192'; color:var(--pl-accent); }
  /* D38b: keep the breakdown open while the cursor is on the ring OR
     the breakdown itself - the breakdown is now interactive (segmented
     control, range slider, button) so the user must be able to move
     their cursor into it. */
  .ring-wrap:hover #contextBreakdown,
  .ring-wrap:focus-within #contextBreakdown,
  #contextBreakdown:hover,
  #contextBreakdown:focus-within { display:block; }
  #contextBreakdown h4 { margin:0 0 4px; font-size:11px; color:var(--pl-muted);
                         text-transform:uppercase; letter-spacing:.06em; }
  #contextBreakdown .row { display:flex; justify-content:space-between; gap:10px;
                           padding:1px 0; }
  #contextBreakdown .row .lbl { color:var(--pl-muted); }
  #contextBreakdown .row .val { font-variant-numeric:tabular-nums; }
  #contextBreakdown .note { margin-top:5px; font-size:10.5px;
                            color:var(--pl-muted); font-style:italic; }
  /* D38b: compact controls live inside the ring's tooltip. */
  #contextBreakdown .ctxsep { height:1px; background:var(--pl-border);
                              margin:8px 0 6px; }
  #contextBreakdown .ctxctl-row { display:flex; align-items:center;
                                  gap:8px; padding:3px 0; }
  #contextBreakdown .ctxctl-row .lbl { font-size:11px;
                                       color:var(--pl-muted);
                                       min-width:62px; }
  #contextBreakdown .ctxseg { display:inline-flex; border:1px solid var(--pl-border);
                              border-radius:4px; overflow:hidden; }
  #contextBreakdown .ctxseg button { background:transparent; border:none;
                                     color:var(--pl-muted); cursor:pointer;
                                     font-size:11px; padding:3px 9px;
                                     font-family:inherit; }
  #contextBreakdown .ctxseg button + button { border-left:1px solid var(--pl-border); }
  #contextBreakdown .ctxseg button.on { background:var(--vscode-button-background);
                                        color:var(--vscode-button-foreground); }
  #contextBreakdown #ctxb-thr { flex:1; padding:0; height:4px; }
  #contextBreakdown #ctxb-thr-live { font-variant-numeric:tabular-nums;
                                     font-size:11px; min-width:38px;
                                     text-align:right; }
  #contextBreakdown #ctxb-cnow { font-size:11px; }
  /* D39b: the composer is now two rows. Top row = textarea. Bottom
     row = controls, with a visible 1px divider so it reads as a
     distinct toolbar (Claude Code pattern). All controls live in
     this one row, with explicit slots: left = mode picker (and
     future commands/attachments land next to it), center = ring,
     right = pause/cancel + send. */
  .composer-bar { display:flex; align-items:center; gap:10px;
                  padding:6px 6px 4px; margin-top:-1px;
                  border-top:1px solid var(--pl-border);
                  position:relative; min-height:36px; }
  .composer-bar .bar-spacer { flex:1; }
  .composer-bar .future-attach { display:inline-flex; gap:4px; min-width:0; }
  .bar-btn { font-family:inherit; font-size:11.5px; padding:4px 10px;
             border:1px solid var(--pl-border); border-radius:4px;
             background:transparent; color:var(--pl-muted); cursor:pointer; }
  .bar-btn:hover { color:var(--vscode-editor-foreground);
                   border-color:var(--vscode-focusBorder, #6a6a6a); }
  /* Cancel is destructive - red text. */
  #cx.bar-btn { color:var(--vscode-testing-iconFailed, #f14c4c); }
  #cx.bar-btn:hover { color:var(--vscode-testing-iconFailed, #f14c4c);
                      border-color:rgba(241,76,76,.35); }
  /* D39: mode picker trigger. Color hints at the active mode. */
  #modeBtn { display:inline-flex; align-items:center; gap:6px;
             background:transparent; border:1px solid transparent;
             color:var(--vscode-editor-foreground);
             font-family:inherit; font-size:12px; font-weight:500;
             padding:4px 8px; border-radius:5px; cursor:pointer; }
  #modeBtn:hover { background:rgba(128,128,128,.08); }
  #modeBtn .mode-icn { width:15px; height:15px; fill:none;
                        stroke:currentColor; stroke-width:2.2;
                        stroke-linecap:round; stroke-linejoin:round; }
  #modeBtn .caret { color:var(--pl-muted); flex:none; }
  /* D39c: four distinct hues - plan=green, edit=amber, act=red,
     auto=purple. No two modes are the same color. */
  #modeBtn.mode-plan { color:#7c4dbf; }
  #modeBtn.mode-edit { color:#4a9eff; }
  #modeBtn.mode-act  { color:#b8651a; }
  #modeBtn.mode-auto { color:#1a8a4a; }
  /* Send button: same four-color palette, with readable text colors
     on each. */
  .btn-send { display:inline-flex; align-items:center; gap:6px;
              padding:5px 14px; border-radius:5px; border:1px solid transparent;
              font-family:inherit; font-size:12px; font-weight:600;
              cursor:pointer; color:#fff;
              transition:background .12s, transform .04s, box-shadow .12s; }
  .btn-send:active { transform:translateY(1px); }
  .btn-send:hover { filter:brightness(1.08);
                    box-shadow:0 1px 4px rgba(0,0,0,.25); }
  .btn-send[disabled] { opacity:.5; cursor:default; }
  .btn-send .btn-send-icn { width:14px; height:14px; fill:none;
                             stroke:currentColor; stroke-width:2.2;
                             stroke-linecap:round; stroke-linejoin:round; }
  .btn-send.mode-plan { background:#9575cd; color:#fff; }
  .btn-send.mode-edit { background:#4a9eff; color:#fff; }
  .btn-send.mode-act  { background:#e08a3c; color:#3a1f00; }
  .btn-send.mode-auto { background:#3bba6a; color:#0d2a18; }
  /* D39: shared popover styles for the model picker and the mode
     picker. The body attaches the popover to a fixed-position wrapper
     right under the trigger. */
  .popover { display:none; position:fixed; z-index:50;
             min-width:240px; max-width:360px; max-height:340px;
             background:var(--vscode-editorWidget-background, #252526);
             border:1px solid var(--pl-border); border-radius:6px;
             box-shadow:0 6px 20px rgba(0,0,0,.4);
             padding:6px; font-size:12px;
             color:var(--vscode-foreground);
             flex-direction:column; }
  .popover.open { display:flex; }
  .popover-search { display:flex; align-items:center; padding:0 4px 6px;
                    border-bottom:1px solid var(--pl-border); margin-bottom:4px; }
  .popover-search input { flex:1; background:transparent; border:none;
                          outline:none; color:var(--vscode-foreground);
                          font:inherit; padding:4px 4px; }
  .popover-list { overflow-y:auto; max-height:280px; }
  .popover-group-label { font-size:10.5px; text-transform:uppercase;
                         letter-spacing:.08em; color:var(--pl-muted);
                         padding:6px 8px 2px; }
  .popover-row { display:flex; align-items:center; gap:8px;
                 padding:5px 8px; border-radius:4px; cursor:pointer;
                 font-size:12px; }
  .popover-row:hover, .popover-row.active {
                 background:var(--vscode-list-hoverBackground,
                                 rgba(128,128,128,.12)); }
  .popover-row .pr-name { flex:1; white-space:nowrap;
                          overflow:hidden; text-overflow:ellipsis; }
  .popover-row .pr-meta { color:var(--pl-muted); font-size:11px;
                          font-variant-numeric:tabular-nums; }
  .popover-row .pr-check { color:var(--vscode-focusBorder, #4a9eff);
                           font-size:11px; width:10px; flex:none; }
  /* Mode picker popover rows: icon + name + 1-line explainer. */
  .mp-row { display:grid; grid-template-columns:18px 1fr;
            gap:6px 10px; align-items:start; padding:7px 8px;
            border-radius:5px; cursor:pointer; }
  .mp-row:hover, .mp-row.active { background:var(--vscode-list-hoverBackground,
                                                   rgba(128,128,128,.12)); }
  .mp-row .mp-icn { width:18px; height:18px; margin-top:1px;
                     fill:none; stroke:currentColor; stroke-width:2.2;
                     stroke-linecap:round; stroke-linejoin:round; }
  .mp-row .mp-name { font-size:12.5px; font-weight:600; }
  .mp-row .mp-desc { grid-column:2; font-size:11.5px; color:var(--pl-muted);
                     line-height:1.45; margin-top:3px; }
  /* D39c: popover icons match the picker/send palette. The popover
     uses a chip background behind the icon so it reads at a glance
     even in dim themes. */
  .mp-row .mp-icn { padding:3px; border-radius:5px; }
  .mp-row.mode-plan .mp-icn { color:#7c4dbf; background:rgba(149,117,205,.16); }
  .mp-row.mode-edit .mp-icn { color:#4a9eff; background:rgba(74,158,255,.14); }
  .mp-row.mode-act  .mp-icn { color:#b8651a; background:rgba(224,138,60,.14); }
  .mp-row.mode-auto .mp-icn { color:#1a8a4a; background:rgba(59,186,106,.12); }
  .mp-row.active.mode-plan .mp-icn { color:#fff; background:#9575cd; }
  .mp-row.active.mode-edit .mp-icn { color:#fff; background:#4a9eff; }
  .mp-row.active.mode-act  .mp-icn { color:#3a1f00; background:#e08a3c; }
  .mp-row.active.mode-auto .mp-icn { color:#0d2a18; background:#3bba6a; }
</style>
</head>
<body>
<header>
  <div class="hrow htop">
    <span class="brand">Plato</span>
    <button id="modelBtn" class="model-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="model-btn-label">loading…</span>
      <svg class="caret" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <select id="rsel" title="Reasoning effort (supported models only)" hidden></select>
    <div class="headnav">
      <button id="hist" title="History">
        <svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
      <button id="gear" title="Settings">
        <svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  </div>
  <div class="hrow hstatus">
    <span id="chatTitle" class="ctitle" hidden title="Conversation title — click to edit">
      <span id="chatTitleText"></span>
      <svg class="icn ctitle-edit" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
    </span>
    <input id="chatTitleInput" hidden spellcheck="false" />
    <span class="hstatus-spacer"></span>
    <button id="orchChip" class="orch-chip" title="Orchestration mode — click to change">&#9679; solo</button>
    <button id="new" title="Start a new chat (clears this conversation)">＋ new</button>
    <span id="st"></span>
  </div>
</header>
<div id="log"></div>
<div id="statusbar" hidden></div>
<footer style="position:relative;">
  <div class="textarea-wrap">
    <textarea id="q" rows="3" placeholder="Describe the change… (Enter to send, Shift+Enter for newline)"></textarea>
    <div class="ring-wrap" tabindex="0" aria-label="Context usage">
      <svg id="contextRing" viewBox="0 0 28 28" class="unknown" tabindex="0">
        <circle class="track" cx="14" cy="14" r="11"></circle>
        <circle class="fill" cx="14" cy="14" r="11"
                stroke-dasharray="69.115" stroke-dashoffset="69.115"></circle>
        <text class="label" x="14" y="14">--</text>
      </svg>
      <div id="contextBreakdown" role="tooltip">
        <h4>Context</h4>
        <div class="row"><span class="lbl">total</span><span class="val" id="ctxb-total">--</span></div>
        <div class="row"><span class="lbl">system</span><span class="val" id="ctxb-system">--</span></div>
        <div class="row"><span class="lbl">user</span><span class="val" id="ctxb-user">--</span></div>
        <div class="row"><span class="lbl">assistant</span><span class="val" id="ctxb-assistant">--</span></div>
        <div class="row"><span class="lbl">tool</span><span class="val" id="ctxb-tool">--</span></div>
        <div class="row"><span class="lbl">max</span><span class="val" id="ctxb-max">--</span></div>
        <div class="row"><span class="lbl">last request</span><span class="val" id="ctxb-last">--</span></div>
        <div class="note" id="ctxb-note">estimate, ~4 chars/token</div>
        <div class="ctxsep"></div>
        <h4>Compaction</h4>
        <div class="ctxctl-row">
          <span class="lbl">Mode</span>
          <div class="ctxseg" id="ctxb-seg">
            <button type="button" data-mode="auto">Auto</button>
            <button type="button" data-mode="manual">Manual</button>
          </div>
        </div>
        <div class="ctxctl-row" id="ctxb-thr-row">
          <span class="lbl">Threshold</span>
          <input id="ctxb-thr" type="range" min="0.5" max="0.95" step="0.05" />
          <span class="val" id="ctxb-thr-live">80%</span>
        </div>
        <div class="ctxctl-row" id="ctxb-cnow-row" hidden>
          <span class="lbl"></span>
          <button type="button" id="ctxb-cnow" class="btn btn-secondary">Compact now</button>
        </div>
      </div>
    </div>
  </div>
  <div class="composer-bar">
    <span class="bar-spacer"></span>
    <button id="pp" class="bar-btn" title="Pause at the next safe point" hidden>Pause</button>
    <button id="cx" class="bar-btn" title="Stop after the current tool call" hidden>Cancel</button>
    <div class="future-attach" aria-hidden="true"></div>
    <button id="modeBtn" class="mode-btn mode-act" type="button" aria-haspopup="listbox" aria-expanded="false">
      <svg class="mode-icn" id="modeBtnIcn" viewBox="0 0 24 24" aria-hidden="true"></svg>
      <span class="mode-btn-label" id="modeBtnLabel">act</span>
      <svg class="caret" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button id="go" class="btn-send mode-act" type="button" title="Send">
      <svg class="btn-send-icn" id="goIcn" viewBox="0 0 24 24" aria-hidden="true"></svg>
      <span class="btn-send-label">Send</span>
    </button>
  </div>
</footer>
<div id="settingsPage">
  <header class="shead">
    <span class="stitle">Plato Settings</span>
    <button id="sback" class="sback" type="button">All settings</button>
  </header>
  <div id="sbody"></div>
</div>
<div id="historyPage">
  <header class="shead">
    <span class="stitle" id="htitle">History</span>
    <button id="hback" class="sback" type="button">Back to chat</button>
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
  // D37 state. The caption + ring + pill all read from here.
  let lastMaxContext = null;
  let lastThreshold = 0.8;
  let lastModelMaxContext = null;
  let compactPending = false;
  vsapi.postMessage({ type: 'ready' });

  // D37 helpers -----------------------------------------------------------
  const RING_CIRC = 2 * Math.PI * 11; // matches the SVG r=11
  function fmtTok(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '--';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function setRing(pct) {
    const ring = document.getElementById('contextRing');
    const fill = ring.querySelector('.fill');
    const lbl = ring.querySelector('.label');
    ring.classList.remove('warn', 'crit', 'unknown');
    if (pct == null || !Number.isFinite(pct)) {
      ring.classList.add('unknown');
      fill.setAttribute('stroke-dashoffset', String(RING_CIRC));
      lbl.textContent = '?';
      return;
    }
    const clamped = Math.max(0, Math.min(1, pct));
    fill.setAttribute('stroke-dashoffset', String(RING_CIRC * (1 - clamped)));
    lbl.textContent = Math.round(clamped * 100) + '%';
    if (clamped >= 0.9) ring.classList.add('crit');
    else if (clamped >= 0.7) ring.classList.add('warn');
  }
  function applyContext(c) {
    if (typeof c.maxContext === 'number') {
      lastMaxContext = c.maxContext;
    } else if (c.maxContext === null) {
      lastMaxContext = null;
    }
    const pct =
      typeof lastMaxContext === 'number' && lastMaxContext > 0
        ? c.total / lastMaxContext
        : null;
    setRing(pct);
    // Breakdown.
    const put = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmtTok(v);
    };
    put('ctxb-total', c.total);
    put('ctxb-system', c.system);
    put('ctxb-user', c.user);
    put('ctxb-assistant', c.assistant);
    put('ctxb-tool', c.tool);
    put('ctxb-max', typeof lastMaxContext === 'number' ? lastMaxContext : null);
    const last = document.getElementById('ctxb-last');
    if (last) {
      last.textContent =
        typeof c.lastInputTokens === 'number'
          ? fmtTok(c.lastInputTokens)
          : '--';
    }
  }
  function applyCompaction(c) {
    if (!c) return;
    const mode = c.mode === 'manual' ? 'manual' : 'auto';
    lastThreshold = typeof c.threshold === 'number' ? c.threshold : 0.8;
    const btn = document.getElementById('compactBtn');
    // D40: the compact status pill is gone (redundant with the ring's
    // tooltip); only the ring's tooltip controls stay in sync here.
    {
      // D38b: also reflect in the ring's tooltip controls.
      const seg = document.getElementById('ctxb-seg');
      if (seg) {
        for (const b of Array.from(seg.querySelectorAll('button'))) {
          b.classList.toggle('on', b.dataset.mode === mode);
        }
      }
      const thrRow = document.getElementById('ctxb-thr-row');
      if (thrRow) { thrRow.hidden = mode !== 'auto'; }
      const cnowRow = document.getElementById('ctxb-cnow-row');
      if (cnowRow) { cnowRow.hidden = mode !== 'manual'; }
      const thr = document.getElementById('ctxb-thr');
      const thrLive = document.getElementById('ctxb-thr-live');
      if (thr) { thr.value = String(lastThreshold); }
      if (thrLive) {
        thrLive.textContent = Math.round(lastThreshold * 100) + '%';
      }
    }
    if (btn) {
      btn.dataset.mode = mode;
    }
  }
  function updateModelCaption() {
    // D39: the "ctx 200.0k" label is gone. The model button now shows
    // just the bare model name. We keep this hook so callers (the
    // picker's selection handler, the models message handler) can
    // request a label refresh; the implementation is a no-op now.
  }
  function requestCompact() {
    if (!busy) {
      // No active run: nothing to compact. Surface a tiny hint.
      return;
    }
    vsapi.postMessage({ type: 'request-compact' });
    compactPending = true;
    const btn = document.getElementById('compactBtn');
    if (btn) {
      btn.dataset.busy = 'true';
    }
    setTimeout(() => {
      compactPending = false;
      if (btn) btn.dataset.busy = 'false';
    }, 1500);
  }
  // -----------------------------------------------------------------------

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

  // Pinned run-status bar (Claude-code style). Lives in #statusbar between
  // #log and the footer, so it is ALWAYS visible during a run — future tool
  // summaries and streamed text scroll in #log below, never bury it.
  let statusEl = null, statusTextEl = null;
  function setStatus(text) {
    const bar = document.getElementById('statusbar');
    if (!bar) return;
    if (!statusEl) {
      bar.hidden = false;
      const d = document.createElement('span');
      d.className = 'pdot';
      const t = document.createElement('span');
      t.className = 'stext';
      bar.appendChild(d);
      bar.appendChild(t);
      statusEl = bar;
      statusTextEl = t;
    }
    if (statusTextEl) statusTextEl.textContent = text;
  }
  function clearStatus() {
    const bar = document.getElementById('statusbar');
    if (bar) {
      bar.hidden = true;
      bar.textContent = '';
    }
    statusEl = null;
    statusTextEl = null;
  }

  // D39: modes live in a popover (#modePicker) anchored under
  // #modeBtn. The popover is built once and re-rendered on each
  // open (cheap). Selecting fires the same mode postMessage.
  // Mode icons are inline SVGs to avoid an extra round-trip.
  // D39c: mode icons are now visible at a glance (thicker strokes,
  // filled backgrounds). Each mode has a distinct hue so the user
  // can tell them apart at a glance, and the same icon shows up on
  // the send button so the action's consequence is reinforced.
  // The four colors form a clear escalation:
  //   plan = green  (calm, read-only)
  //   edit = amber  (caution, files being written)
  //   act  = red    (full power, shell + writes)
  //   auto = purple (hands-off, AI drives)
  const MODE_ICONS = {
    plan: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    act:  '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const MODE_DESCS = {
    plan: 'Read-only. Plato can look at files and answer questions, but never modifies anything on disk or runs shell.',
    edit: 'File edits via diff approval cards. Plato can read and propose changes; shell access is denied.',
    act:  'Shell + writes. Every action is gated by an approval card. Full power, every step.',
    auto: 'No approval clicks. Plato runs end-to-end on its own. A hard turn cap is the only backstop.',
  };
  function setMode(m) {
    m = (m === 'plan' || m === 'edit' || m === 'act' || m === 'auto') ? m : 'act';
    mode = m;
    const btn = document.getElementById('modeBtn');
    const lbl = document.getElementById('modeBtnLabel');
    const icn = document.getElementById('modeBtnIcn');
    const send = document.getElementById('go');
    const sendIcn = document.getElementById('goIcn');
    const footer = document.querySelector('footer');
    if (btn) {
      btn.classList.remove('mode-plan', 'mode-edit', 'mode-act', 'mode-auto');
      btn.classList.add('mode-' + m);
    }
    if (lbl) { lbl.textContent = m; }
    if (icn) { icn.innerHTML = MODE_ICONS[m] || ''; }
    if (send) {
      send.classList.remove('mode-plan', 'mode-edit', 'mode-act', 'mode-auto');
      send.classList.add('mode-' + m);
    }
    if (sendIcn) { sendIcn.innerHTML = MODE_ICONS[m] || ''; }
    // D39c: textbox border tracks the active mode so the user gets
    // a second visual cue of what their next send will do.
    if (footer) {
      footer.classList.remove('mode-plan', 'mode-edit', 'mode-act', 'mode-auto');
      footer.classList.add('mode-' + m);
    }
  }
  setMode(mode);

  // --- D39: popover helper. position:fixed wrapper so it escapes any
  // overflow:hidden ancestor; we compute left/top from the trigger.
  const openPopover = (pop, trigger, opts) => {
    pop.classList.add('open');
    document.body.appendChild(pop);
    const r = trigger.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left, top;
    if (opts && opts.up) {
      top = r.top - ph - 6;
      left = r.left + r.width / 2 - pw / 2;
    } else {
      top = r.bottom + 6;
      left = r.left + r.width / 2 - pw / 2;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    if (top + ph > vh - 8) { top = vh - ph - 8; }
    if (top < 8) { top = 8; }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    if (opts && opts.focus) { opts.focus.focus(); }
  };
  const closePopover = (pop) => {
    pop.classList.remove('open');
    if (pop.parentNode) { pop.parentNode.removeChild(pop); }
  };
  // Click-outside + Esc-to-close.
  document.addEventListener('mousedown', (e) => {
    for (const pop of document.querySelectorAll('.popover.open')) {
      if (pop.contains(e.target)) { continue; }
      const trig = pop.dataset.trigger;
      if (trig && document.getElementById(trig) &&
          document.getElementById(trig).contains(e.target)) { continue; }
      closePopover(pop);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const pop of document.querySelectorAll('.popover.open')) {
        closePopover(pop);
        const trig = pop.dataset.trigger;
        if (trig) { document.getElementById(trig)?.focus(); }
      }
    }
  });

  // --- D39: mode picker popover.
  const modePop = document.createElement('div');
  modePop.className = 'popover';
  modePop.dataset.trigger = 'modeBtn';
  modePop.setAttribute('role', 'listbox');
  const modeBtn = document.getElementById('modeBtn');
  const renderModePop = () => {
    modePop.textContent = '';
    for (const m of ['plan', 'edit', 'act', 'auto']) {
      const row = el('div', 'mp-row mode-' + m);
      row.dataset.mode = m;
      row.setAttribute('role', 'option');
      if (m === mode) { row.classList.add('active'); row.setAttribute('aria-selected', 'true'); }
      const icn = document.createElement('svg');
      icn.className = 'mp-icn';
      icn.setAttribute('viewBox', '0 0 24 24');
      icn.innerHTML = MODE_ICONS[m];
      const name = el('div', 'mp-name', m);
      const desc = el('div', 'mp-desc', MODE_DESCS[m]);
      row.appendChild(icn);
      row.appendChild(name);
      row.appendChild(desc);
      row.addEventListener('click', () => {
        setMode(m);
        closePopover(modePop);
        vsapi.postMessage({ type: 'mode', value: m });
        modeBtn.focus();
      });
      modePop.appendChild(row);
    }
  };
  modeBtn.addEventListener('click', () => {
    if (modePop.classList.contains('open')) {
      closePopover(modePop);
      return;
    }
    renderModePop();
    openPopover(modePop, modeBtn, { up: true });
  });

  // --- D39: model picker popover.
  // Replaces the native #msel. State lives in closure vars; the
  // popover is rebuilt on the models postMessage and on open.
  const modelPop = document.createElement('div');
  modelPop.className = 'popover';
  modelPop.dataset.trigger = 'modelBtn';
  modelPop.setAttribute('role', 'listbox');
  const modelBtn = document.getElementById('modelBtn');
  const modelBtnLabel = modelBtn.querySelector('.model-btn-label');
  let currentModel = '';
  let currentModelLabel = '';
  let currentModelMaxCtx = null;
  let lastModelItems = [];
  const fmtCtx = (n) => {
    if (typeof n === 'number' && n > 0) {
      if (n >= 1000) { return Math.round(n / 1000) + 'k'; }
      return String(n);
    }
    return null;
  };
  const setModelSelected = (value, label, maxCtx) => {
    currentModel = value;
    currentModelLabel = label;
    currentModelMaxCtx = maxCtx;
    modelBtnLabel.textContent = label || (value ? value : 'select model');
  };
  const renderModelPop = () => {
    modelPop.textContent = '';
    const search = el('div', 'popover-search');
    const sinput = el('input');
    sinput.type = 'text';
    sinput.placeholder = 'Search models\u2026';
    search.appendChild(sinput);
    modelPop.appendChild(search);
    const list = el('div', 'popover-list');
    modelPop.appendChild(list);
    const items = lastModelItems || [];
    const filtered = [];
    for (const it of items) {
      const label = String(it.label || it.value || '');
      const hay = (label + ' ' + String(it.group || '')).toLowerCase();
      if (sinput.value && !hay.includes(sinput.value.toLowerCase())) { continue; }
      filtered.push(it);
    }
    let lastGroup = null;
    for (const it of filtered) {
      const g = String(it.group || '');
      if (g !== lastGroup) {
        list.appendChild(el('div', 'popover-group-label', g));
        lastGroup = g;
      }
      const value = String(it.value || '');
      const label = String(it.label || value);
      const max = it.maxContext;
      const row = el('div', 'popover-row');
      row.dataset.value = value;
      row.setAttribute('role', 'option');
      const name = el('span', 'pr-name', label);
      const meta = el('span', 'pr-meta',
        fmtCtx(max) ? '\u00b7 ' + fmtCtx(max) : '\u00b7 ctx unknown');
      const check = el('span', 'pr-check', value === currentModel ? '\u2713' : '');
      row.appendChild(check);
      row.appendChild(name);
      row.appendChild(meta);
      if (value === currentModel) {
        row.classList.add('active');
        row.setAttribute('aria-selected', 'true');
      }
      row.addEventListener('click', () => {
        setModelSelected(value, label, max);
        vsapi.postMessage({ type: 'model', value });
        closePopover(modelPop);
        modelBtn.focus();
      });
      list.appendChild(row);
    }
    if (filtered.length === 0) {
      list.appendChild(el('div', 'popover-row',
        sinput.value ? 'No matches' : 'No models'));
    }
    // Fallback row: if the current model isn't in the list (e.g.
    // connection offline, custom model), still show it so the user
    // can see what's selected.
    if (currentModel &&
        !items.some((it) => String(it.value || '') === currentModel)) {
      const row = el('div', 'popover-row');
      row.dataset.value = currentModel;
      const name = el('span', 'pr-name', currentModelLabel || currentModel);
      const meta = el('span', 'pr-meta', '\u00b7 offline');
      const check = el('span', 'pr-check', '\u2713');
      row.appendChild(check);
      row.appendChild(name);
      row.appendChild(meta);
      row.classList.add('active');
      row.setAttribute('aria-selected', 'true');
      row.style.opacity = '.7';
      row.addEventListener('click', () => {
        closePopover(modelPop);
        modelBtn.focus();
      });
      list.appendChild(row);
    }
    sinput.addEventListener('input', () => renderModelPop());
    sinput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        const first = list.querySelector('.popover-row');
        if (first && first.dataset.value) { first.click(); }
        e.preventDefault();
      } else if (e.key === 'Escape') {
        closePopover(modelPop);
        modelBtn.focus();
      }
    });
  };
  modelBtn.addEventListener('click', () => {
    if (modelPop.classList.contains('open')) {
      closePopover(modelPop);
      return;
    }
    renderModelPop();
    openPopover(modelPop, modelBtn, { up: false });
    const sinput = modelPop.querySelector('input');
    if (sinput) { sinput.focus(); }
  });



  document.getElementById('go').addEventListener('click', ask);
  document.getElementById('new').addEventListener('click', () => {
    vsapi.postMessage({ type: 'newChat' });
  });

  // D40: conversation title — model-generated by the host; the user
  // can rename it by clicking the chip (hover shows the pencil).
  // D40b: the chip stays hidden until a real title exists — on an
  // empty chat an inert "New chat" chip would read as a button.
  const ctitleEl = document.getElementById('chatTitle');
  const ctitleText = document.getElementById('chatTitleText');
  const ctitleInput = document.getElementById('chatTitleInput');
  function setTitle(t) {
    const v = (t || '').trim();
    ctitleText.textContent = v;
    // If the inline editor is open, only refresh the text and let
    // endTitleEdit restore visibility.
    if (ctitleInput.hidden) {
      ctitleEl.hidden = !v;
    }
  }
  function startTitleEdit() {
    if (!ctitleInput.hidden) return;
    ctitleEl.hidden = true;
    ctitleInput.hidden = false;
    ctitleInput.value = ctitleText.textContent;
    ctitleInput.focus();
    ctitleInput.select();
  }
  function endTitleEdit(commit) {
    if (ctitleInput.hidden) return;
    ctitleInput.hidden = true;
    ctitleEl.hidden = false;
    if (commit) {
      const v = ctitleInput.value.trim();
      if (v && v !== ctitleText.textContent) {
        vsapi.postMessage({ type: 'rename', value: v });
      }
    }
  }
  ctitleEl.addEventListener('click', startTitleEdit);
  ctitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      endTitleEdit(true);
    } else if (e.key === 'Escape') {
      endTitleEdit(false);
    }
  });
  ctitleInput.addEventListener('blur', () => endTitleEdit(true));

  // Settings page (D27).
  const gear = document.getElementById('gear');
  gear.addEventListener('click', () => {
    vsapi.postMessage({ type: 'openSettings' });
  });
  document.getElementById('sback').addEventListener('click', () => {
    document.body.classList.remove('show-settings');
    vsapi.postMessage({ type: 'settings-closed' });
  });

  // Orchestration chip (D32e): always shows the active mode; one click to
  // Settings → Orchestration.
  const orchChip = document.getElementById('orchChip');
  orchChip.addEventListener('click', () => {
    vsapi.postMessage({ type: 'openSettings' });
  });
  function syncOrchChip(o) {
    const mode = o.mode || 'solo';
    if (mode === 'academy') {
      const nm = o.academy && o.academy.name ? ':' + o.academy.name : '';
      orchChip.textContent = '\u2727 academy' + nm;
    } else if (mode === 'duo') {
      const p = (o.personas || []).find((x) => x.id === (o.persona || 'aristotle'));
      orchChip.textContent = '\u25D0 duo' + (p ? ' \u00b7 ' + p.name : '');
    } else {
      orchChip.textContent = '\u25CF solo';
    }
  }

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
        // D42: the first entry is the live conversation - clicking it
        // just returns to the chat, same as the Back button.
        const isCurrent = !!c.current;
        item.appendChild(el('div', 'rm',
          String(c.ts || '').replace('T', ' ').slice(0, 19)
          + ' \u00b7 ' + c.count + ' messages \u00b7 '
          + (isCurrent ? 'current chat \u00b7 click to open' : 'click to resume')));
        if (isCurrent) {
          item.classList.add('current');
          item.addEventListener('click', () => {
            document.body.classList.remove('show-history');
          });
        } else {
          item.addEventListener('click', () => {
            vsapi.postMessage({ type: 'resumeChat', id: c.id });
          });
        }
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
  function sbtn(label, fn, variant) {
    // D38: variant is one of 'primary' | 'secondary' | 'ghost' | 'danger'
    // (defaults to 'secondary'). The class matches the .btn-* taxonomy.
    const cls = 'btn btn-' + (variant || 'secondary');
    const b = el('button', cls, label);
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
    syncOrchChip(d.orchestration || {});

    // D38: max-width centered wrap so the page reads at a consistent
    // width on wide panels. All section appends go inside this wrap.
    const wrap = el('div', 'wrap');
    body.appendChild(wrap);

    // Top-of-page flash banner so the user sees confirmation of a
    // settings write (e.g. "Philosopher updated - applies from the
    // next run.").
    if (d.flash) {
      const f = el('div', 'note');
      f.style.padding = '8px 12px';
      f.style.marginBottom = '16px';
      f.style.border = '1px solid var(--pl-border)';
      f.style.borderRadius = '6px';
      f.style.background = 'rgba(128,128,128,.05)';
      f.textContent = String(d.flash);
      wrap.appendChild(f);
    }

    // ---- 1. Providers (collapsed, auto-opens when zero providers) ----
    // D38b: count user-managed connections only (built-ins are
    // reachable through the Add presets, not as cards).
    const userConns = (d.connections || []).filter((c) => !c.builtin);
    const sec1Det = document.createElement('details');
    sec1Det.className = 'sec';
    sec1Det.appendChild(el('summary', null,
      'Providers  \u2014  ' + userConns.length + ' configured'));
    const sec1Body = el('div', 'secbody');
    sec1Det.appendChild(sec1Body);
    wrap.appendChild(sec1Det);
    if (userConns.length === 0) {
      sec1Det.open = true;
    }
    sec1Body.appendChild(el('h2', 'shead2', 'Providers'));
    sec1Body.appendChild(el('p', 'shelp',
      'Where Plato goes. Each provider has its own API key, base URL, and model list. Keys are stored in SecretStorage and never displayed.'));

    const list = el('div', 'conn-list');
    // D38b: built-in providers (anthropic, openai) are reachable only
    // through the "+ Add a provider" presets, not as cards here. The
    // list shows only connections the user actually manages.
    for (const c of d.connections || []) {
      if (c.builtin) { continue; }
      const card = el('div', 'conn');
      const r1 = el('div', 'row1');
      r1.appendChild(el('span', 'cid', c.id));
      r1.appendChild(el('span', 'ckind', String(c.kind)));
      const statClass = c.keyStatus === 'set' ? 'cstat set' : 'cstat miss';
      const statText = c.keyStatus === 'set' ? 'Ready' : 'No key';
      const stat = el('span', statClass);
      stat.appendChild(el('span', 'dot'));
      stat.appendChild(document.createTextNode(statText));
      r1.appendChild(stat);
      card.appendChild(r1);
      if (c.baseUrl) {
        card.appendChild(el('div', 'cbase', String(c.baseUrl)));
      }
      const pool = c.all || c.models || [];
      const selected = new Set(c.models || []);
      if (pool.length > 0) {
        const det = document.createElement('details');
        det.className = 'picker';
        det.appendChild(el('summary', null,
          'Models \u2014 ' + selected.size + ' of ' + pool.length + ' active'));
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
        const okB = sbtn('OK', () => {
          const chosen = Array.from(box.querySelectorAll('input'))
            .filter((i) => i.checked)
            .map((i) => String(i.value));
          vsapi.postMessage({
            type: 'settings-models', connId: c.id, models: chosen,
          });
          det.querySelector('summary').textContent =
            'Models \u2014 ' + chosen.length + ' of ' + pool.length + ' active';
          det.open = false;
        }, 'primary');
        const cancelB = sbtn('Cancel', () => {
          for (const cb of Array.from(box.querySelectorAll('input'))) {
            cb.checked = selected.has(String(cb.value));
          }
          det.open = false;
        }, 'secondary');
        const rowBtns = el('div', 'mbtns');
        rowBtns.appendChild(okB);
        rowBtns.appendChild(cancelB);
        box.appendChild(rowBtns);
        det.appendChild(box);
        card.appendChild(det);
      } else {
        card.appendChild(el('div', 'note',
          'No models yet - set a key and use Refresh to fetch the model list.'));
      }
      const crow = el('div', 'crow');
      if (c.keyStatus !== 'set') {
        crow.appendChild(sbtn('Set key', () => {
          vsapi.postMessage({ type: 'settings-key', connId: c.id });
        }, 'primary'));
      } else {
        crow.appendChild(sbtn('Set key', () => {
          vsapi.postMessage({ type: 'settings-key', connId: c.id });
        }, 'secondary'));
      }
      const refresh = sbtn('\u21BB Refresh models', () => {
        vsapi.postMessage({ type: 'settings-fetch', connId: c.id });
      }, 'secondary');
      refresh.disabled = Boolean(c.keyStatus !== 'set');
      crow.appendChild(refresh);
      // D38b: built-ins are no longer rendered as cards, so every card
      // here is user-managed. Always show Delete.
      crow.appendChild(sbtn('Delete', () => {
        vsapi.postMessage({ type: 'settings-delete', connId: c.id });
      }, 'danger'));
      card.appendChild(crow);
      list.appendChild(card);
    }
    sec1Body.appendChild(list);

    // Add-connection card: prominent CTA at the END of Providers.
    const addCard = el('div', 'add-card');
    addCard.appendChild(el('div', 'add-title',
      '\uFF0B  Add a provider'));
    const add = document.createElement('form');
    add.id = 'addForm';
    add.addEventListener('submit', (e) => { e.preventDefault(); });
    const grid = el('div', 'grid');
    const presetRow = el('div');
    presetRow.style.gridColumn = '1 / -1';
    presetRow.style.display = 'grid';
    presetRow.style.gridTemplateColumns = '130px 1fr';
    presetRow.style.gap = '10px 12px';
    presetRow.style.alignItems = 'center';
    const ppick = sel([
      { value: '', label: '\u2014 or enter a custom endpoint \u2014' },
      ...(d.presets || []).map((p) => ({ value: p.value, label: p.label })),
    ]);
    presetRow.appendChild(el('label', null, 'Start from preset'));
    presetRow.appendChild(ppick);
    grid.appendChild(presetRow);
    const fkind = sel([
      { value: 'openai', label: 'OpenAI-compatible' },
      { value: 'anthropic', label: 'Anthropic native' },
    ]);
    fkind.value = 'openai';
    grid.appendChild(el('label', null, 'API style'));
    grid.appendChild(fkind);
    const fbase = el('input');
    fbase.placeholder = 'Base URL (e.g. http://localhost:4000/v1)';
    grid.appendChild(el('label', null, 'Base URL'));
    grid.appendChild(fbase);
    const fkey = el('input');
    fkey.type = 'password';
    fkey.placeholder = 'API key';
    fkey.autocomplete = 'off';
    grid.appendChild(el('label', null, 'API key'));
    grid.appendChild(fkey);
    ppick.addEventListener('change', () => {
      const pre = (d.presets || []).find((p) => p.value === ppick.value);
      if (pre) {
        fkind.value = String(pre.kind);
        fbase.value = String(pre.baseUrl);
      }
    });
    add.appendChild(grid);
    add.appendChild(el('div', 'note',
      'Models are fetched automatically from this URL after adding.'));
    const actions = el('div', 'actions');
    actions.appendChild(sbtn('Add connection', () => {
      const base = fbase.value.trim();
      if (!base) { return; }
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
        fkey.value = '';
      } catch (err) {
        const f = el('div', 'err');
        f.textContent = 'Add failed: ' + String(err);
        add.appendChild(f);
      }
    }, 'primary'));
    add.appendChild(actions);
    addCard.appendChild(add);
    sec1Body.appendChild(addCard);
    sec1Body.appendChild(el('div', 'note',
      'Connections are stored in your VS Code settings under plato.connections. Keys live in SecretStorage and are never displayed.'));


    // ---- 2. Orchestration (always-open) ----
    const orch = d.orchestration || {};
    const secO = el('div', 'sec');
    secO.appendChild(el('h2', 'shead2', 'Orchestration'));
    secO.appendChild(el('p', 'shelp',
      'How Plato is staffed. Applies from the next run. The mode decides - a stray academy.yaml never takes over a run.'));
    const oblock = el('div', 'sblock');
    const MODES = [
      { id: 'solo', label: 'Solo', desc: 'Plato alone. No philosopher watching.' },
      { id: 'duo', label: 'Duo', desc: 'Plato + one philosopher steering the run.' },
      { id: 'academy', label: 'Academy', desc: 'Council from .plato/academy.yaml - one worker, up to 3 philosophers.' },
    ];
    const modeRow = el('div', 'modes');
    for (const mode of MODES) {
      const card = el('div', 'mcard' + (orch.mode === mode.id ? ' on' : ''));
      card.addEventListener('click', () => {
        vsapi.postMessage({ type: 'set-orchestration', mode: mode.id });
      });
      card.appendChild(el('div', 'mtitle', mode.label));
      card.appendChild(el('div', 'mdesc', mode.desc));
      modeRow.appendChild(card);
    }
    oblock.appendChild(modeRow);

    // Academy status block (D33): parsed, error, or nothing.
    const st = orch.academy || {};
    const stBox = el('div', 'astat');
    if (st.available) {
      stBox.appendChild(el(
        'div', 'aok',
        '\u2713 .plato/academy.yaml: "' + (st.name || 'unnamed') + '" \u2014 ' +
          (st.members || []).map((mm) => mm.name + ' (' + mm.kind + ')').join(', '),
      ));
      stBox.appendChild(sbtn('Open academy.yaml', () => {
        vsapi.postMessage({ type: 'open-academy' });
      }, 'ghost'));
    } else if (st.error) {
      stBox.appendChild(el('div', 'aerr', String(st.error)));
      if (!st.legacy) {
        stBox.appendChild(sbtn('Create example', () => {
          vsapi.postMessage({ type: 'create-academy' });
        }, 'secondary'));
      }
    } else {
      stBox.appendChild(el(
        'div', 'note',
        'No .plato/academy.yaml yet - create the example to start a council.',
      ));
      stBox.appendChild(sbtn('Create example', () => {
        vsapi.postMessage({ type: 'create-academy' });
      }, 'secondary'));
    }
    oblock.appendChild(stBox);

    // D38: Duo sub-block only renders when mode === 'duo'. Replaces
    // the old top-level "Duo - philosopher" details that was appearing
    // in all three modes.
    if (orch.mode === 'duo') {
      const duo = el('div', 'duo');
      const personas = orch.personas || [];
      const obs = d.observer || {};
      const grid = el('div', 'grid');

      const pSel = sel(
        personas.map((p) => ({ value: p.id, label: p.name + ' \u2014 ' + p.epithet })),
        String(orch.persona || 'aristotle'),
      );
      const pDesc = el('div', 'pdesc');
      const syncPDesc = () => {
        const p = personas.find((x) => x.id === pSel.value);
        pDesc.textContent = p ? p.role : '';
      };
      syncPDesc();
      pSel.addEventListener('change', () => {
        syncPDesc();
        vsapi.postMessage({ type: 'set-duo-persona', persona: pSel.value });
      });
      grid.appendChild(el('label', null, 'Philosopher'));
      grid.appendChild(pSel);
      grid.appendChild(pDesc);

      const oSel = sel(
        [{ value: '', label: '(same as worker)' }, ...(d.modelItems || [])],
        String(obs.model || ''),
      );
      const pTog = document.createElement('input');
      pTog.type = 'checkbox';
      pTog.checked = Boolean(obs.pause);
      const cTog = document.createElement('input');
      cTog.type = 'checkbox';
      cTog.checked = Boolean(obs.cancel);
      const mCap = el('input');
      mCap.type = 'number';
      mCap.min = '1';
      mCap.max = '50';
      mCap.value = String(obs.maxInterventions ?? 5);
      mCap.style.width = '64px';
      mCap.style.padding = '2px 6px';
      mCap.style.fontSize = '12px';
      const sendObs = () => {
        vsapi.postMessage({
          type: 'set-observer', enable: true, model: oSel.value,
          pause: pTog.checked, cancel: cTog.checked,
          maxInterventions: Number(mCap.value),
        });
      };
      oSel.addEventListener('change', sendObs);
      pTog.addEventListener('change', sendObs);
      cTog.addEventListener('change', sendObs);
      mCap.addEventListener('change', sendObs);
      grid.appendChild(el('label', null, 'Philosopher model'));
      grid.appendChild(oSel);

      const togWrap = el('div', 'toggles');
      const pLbl = el('label', 'tog', 'May pause runs');
      pLbl.insertBefore(pTog, pLbl.firstChild);
      togWrap.appendChild(pLbl);
      const cLbl = el('label', 'tog', 'May cancel runs');
      cLbl.insertBefore(cTog, cLbl.firstChild);
      togWrap.appendChild(cLbl);
      const mCapLbl = el('label', 'tog', 'Max/run');
      mCapLbl.appendChild(mCap);
      togWrap.appendChild(mCapLbl);
      grid.appendChild(el('label', null, 'Behavior'));
      grid.appendChild(togWrap);

      duo.appendChild(grid);
      duo.appendChild(el('div', 'note',
        'Guidance is always allowed; pause/cancel need the toggles. The persona role prompt can be overridden in settings.json (plato.observer.role).'));
      oblock.appendChild(duo);
    }

    secO.appendChild(oblock);
    wrap.appendChild(secO);


    // ---- 3. Context (compaction) (collapsed) ----
    const ctxInfo = d.compaction || { mode: 'auto', threshold: 0.8 };
    const secCtxDet = document.createElement('details');
    secCtxDet.className = 'sec';
    secCtxDet.appendChild(el('summary', null, 'Context  \u2014  compaction'));
    const ctxBody = el('div', 'secbody');
    secCtxDet.appendChild(ctxBody);
    wrap.appendChild(secCtxDet);
    ctxBody.appendChild(el('h2', 'shead2', 'Context'));
    ctxBody.appendChild(el('p', 'shelp',
      'How Plato manages the conversation window. There is no off - the run always manages its context. The Compact button in the chat header is always available as a manual override.'));
    const ctxBlock = el('div', 'sblock');
    const modeRow2 = el('div', 'row');
    const modeSel = sel(
      [
        { value: 'auto', label: 'Auto (at threshold)' },
        { value: 'manual', label: 'Manual (Compact button only)' },
      ],
      ctxInfo.mode === 'manual' ? 'manual' : 'auto',
    );
    modeSel.addEventListener('change', (e) => {
      vsapi.postMessage({ type: 'set-compaction-mode', mode: e.target.value });
    });
    modeRow2.appendChild(el('label', null, 'Compaction'));
    modeRow2.appendChild(modeSel);
    ctxBlock.appendChild(modeRow2);
    const thrRow = el('div', 'row');
    const thrInput = el('input');
    thrInput.type = 'range';
    thrInput.min = '0.5';
    thrInput.max = '0.95';
    thrInput.step = '0.05';
    thrInput.value = String(ctxInfo.threshold ?? 0.8);
    const thrLive = el('span', 'liveval',
      Math.round((ctxInfo.threshold ?? 0.8) * 100) + '% of context');
    thrInput.addEventListener('input', () => {
      thrLive.textContent = Math.round(Number(thrInput.value) * 100)
        + '% of context';
    });
    thrInput.addEventListener('change', () => {
      vsapi.postMessage({
        type: 'set-compaction-threshold',
        value: Number(thrInput.value),
      });
    });
    thrRow.appendChild(el('label', null, 'Auto threshold'));
    thrRow.appendChild(thrInput);
    thrRow.appendChild(thrLive);
    ctxBlock.appendChild(thrRow);
    ctxBody.appendChild(ctxBlock);

    scroll();
  }
  // Reasoning select (D39: model picker is now a popover; the
  // reasoning select is the only native dropdown left in the header).
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
  rsel.addEventListener('change', () => {
    vsapi.postMessage({ type: 'set-reasoning', value: rsel.value });
  });
  // D39: #compactBtn is gone - "Compact now" is in the ring's
  // tooltip (D38b). The Compact button in the composer was removed
  // entirely; the requestCompact() function still exists and is
  // called from the ring's tooltip.
  // D38b: ring's tooltip is now a control surface for compaction.
  // The handlers live on the elements (not delegated) and post the
  // same set-compaction-mode / set-compaction-threshold messages
  // the Settings page uses - no new message types.
  const ctxSeg = document.getElementById('ctxb-seg');
  if (ctxSeg) {
    for (const b of Array.from(ctxSeg.querySelectorAll('button'))) {
      b.addEventListener('click', () => {
        const next = b.dataset.mode === 'manual' ? 'manual' : 'auto';
        vsapi.postMessage({ type: 'set-compaction-mode', mode: next });
        applyCompaction({ mode: next, threshold: lastThreshold });
      });
    }
  }
  const ctxThr = document.getElementById('ctxb-thr');
  const ctxThrLive = document.getElementById('ctxb-thr-live');
  if (ctxThr && ctxThrLive) {
    ctxThr.addEventListener('input', () => {
      ctxThrLive.textContent =
        Math.round(Number(ctxThr.value) * 100) + '%';
    });
    ctxThr.addEventListener('change', () => {
      const v = Number(ctxThr.value);
      vsapi.postMessage({ type: 'set-compaction-threshold', value: v });
      lastThreshold = v;
    });
  }
  const ctxCnow = document.getElementById('ctxb-cnow');
  if (ctxCnow) {
    ctxCnow.addEventListener('click', () => requestCompact());
  }
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
    setStatus('Plato is thinking');
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
        syncOrchChip({
          mode: m.orchestration,
          academy: m.academy,
          persona: m.persona,
          personas: [],
        });
        // D37: header caption + compaction state.
        applyCompaction(m.compaction);
        // D39: model picker popover data. Preserve the user's current
        // selection across rebuilds; if the new pool doesn't contain
        // the value, renderModelPop shows it as an "offline" fallback
        // row.
        lastModelItems = m.items || [];
        // Find the selected item in the new pool to refresh the label
        // and maxContext; otherwise keep the previous selection.
        const preserved = currentModel;
        const match = lastModelItems.find(
          (it) => String(it.value || '') === preserved);
        if (match) {
          setModelSelected(String(match.value), String(match.label),
                           match.maxContext);
        } else if (preserved) {
          // Off-line selection - keep closure state, label stays.
          setModelSelected(preserved, currentModelLabel, currentModelMaxCtx);
        } else if (lastModelItems.length > 0) {
          // First-time / restore: pick the first item as default.
          const first = lastModelItems[0];
          setModelSelected(String(first.value), String(first.label),
                           first.maxContext);
        }
        // Reasoning control (D28 phase 2): visible only for capable models.
        rsel.hidden = !m.reasoningCapable;
        if (typeof m.reasoning === 'string') {
          rsel.value = m.reasoning;
        }
        // If the popover is currently open, re-render it to reflect
        // the new pool.
        if (modelPop.classList.contains('open')) { renderModelPop(); }
        break;
      }
      case 'context': applyContext(m); break;
      case 'context-compacted': {
        // Force a brief animation by re-applying; the user already sees
        // the chat-log notice that the host pushes.
        applyContext({
          maxContext: lastMaxContext,
          total: m.afterTokens,
          system: 0,
          user: 0,
          assistant: 0,
          tool: 0,
        });
        break;
      }
      case 'settings': showSettings(m); break;
      case 'history': showHistory(m); break; // D42b: pass the full payload (m.runs dropped m.chats)
      case 'run': showRun(m); break;
      case 'title': setTitle(String(m.text || '')); break;
      case 'restore':
        document.body.classList.remove('show-settings', 'show-history');
        render(m.log);
        // D40: restore the conversation title with the log.
        if (typeof m.title === 'string') setTitle(m.title);
        // D39: restore the chat's prior model selection. If the value
        // is in the current pool, setModelSelected will refresh the
        // label and maxContext; otherwise it stays as a closure var
        // and renderModelPop will show it as an "offline" fallback.
        if (typeof m.model === 'string' && m.model) {
          const found = lastModelItems.find(
            (it) => String(it.value || '') === m.model);
          if (found) {
            setModelSelected(String(found.value), String(found.label),
                             found.maxContext);
          } else {
            setModelSelected(m.model, m.model, null);
          }
        }
        break;
      case 'md': flushToolBuffer(); streamHtml(String(m.text || '')); lastAct = 'writing'; refreshChip(); setStatus('writing'); break;
      case 'turn': {
        // Turn boundary: commit the ongoing stream into a finished block so
        // the next turn and any intervening notices/logos land in order.
        const el = document.getElementById('streaming');
        if (el) { el.removeAttribute('id'); }
        streaming = false;
        break;
      }
      case 'notice': flushToolBuffer(); addMsg('sys', 'Plato', m.text); break;
      case 'team': flushToolBuffer(); showTeam(m); break;
      case 'tool':
        // Only completed calls count; pending/denied phases stay in the chip.
        if (m.phase === 'done') {
          toolBuffer.push({ tool: m.tool, phase: m.phase });
          scheduleToolFlush();
        }
        lastAct = String(m.tool);
        refreshChip();
        setStatus('using ' + m.tool);
        break;
      case 'approval':
        flushToolBuffer();
        showCard(m);
        lastAct = 'waiting for you';
        refreshChip();
        setStatus('waiting for your approval');
        break;
      case 'user-question':
        flushToolBuffer();
        lastAct = 'awaiting your answer';
        refreshChip();
        setStatus('awaiting your answer');
        showUserQuestion(m);
        break;
      case 'done': {
        flushToolBuffer();
        finish();
        const i = m.text || {};
        const line = '\u2713 done in ' + (i.secs ?? '?') + 's \u00b7 '
          + (i.tools === 1 ? '1 tool call' : (i.tools ?? 0) + ' tool calls')
          + (i.tok ? ' \u00b7 ' + i.tok : '')
          + (i.cost ? ' \u00b7 ' + i.cost : '')
          + (i.obs ? ' \u00b7 ' + i.obs : '')
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
    clearStatus();
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

  // D31h: read-only team display. The yaml is the source of truth.
  function showTeam(m) {
    const card = document.createElement('div');
    card.className = 'team-card';
    const h = document.createElement('div');
    h.className = 'team-name';
    h.textContent = 'Team ' + (m.name || 'unnamed');
    card.appendChild(h);
    for (const mem of m.members || []) {
      const row = document.createElement('div');
      row.className = 'team-member';
      const left = document.createElement('span');
      left.className = 'tm-name';
      left.textContent = mem.name;
      const kind = document.createElement('span');
      kind.className = 'tm-kind ' + (mem.kind === 'worker' ? 'is-coder' : 'is-observer');
      kind.textContent = mem.kind;
      const model = document.createElement('span');
      model.className = 'tm-model';
      model.textContent = mem.model;
      row.appendChild(left);
      row.appendChild(kind);
      row.appendChild(model);
      for (const t of mem.tiers || []) {
        const tier = document.createElement('span');
        tier.className = 'tm-tier';
        tier.textContent = t;
        row.appendChild(tier);
      }
      card.appendChild(row);
    }
    log.appendChild(card);
    scroll();
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
    clearStatus();
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

  // D34/D35: question card — one question at a time (stepper); the last
  // option is always "Others" (free-text) for a custom answer.
  function showUserQuestion(m) {
    const questions = Array.isArray(m.questions) ? m.questions : [];
    if (questions.length === 0) return;

    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3');
    h.textContent = questions.length > 1
      ? 'Plato has a few questions'
      : 'Plato has a question';
    card.appendChild(h);

    const answers = new Array(questions.length).fill('');
    const body = document.createElement('div');
    body.className = 'q-form';
    card.appendChild(body);
    let idx = 0;

    function render() {
      body.textContent = '';
      const q = questions[idx];
      const options = Array.isArray(q.options) ? [...q.options] : [];
      options.push('Others'); // always allow a custom answer

      if (questions.length > 1) {
        const prog = document.createElement('div');
        prog.className = 'q-progress';
        prog.textContent = 'Question ' + (idx + 1) + ' of ' + questions.length;
        body.appendChild(prog);
      }

      const block = document.createElement('div');
      block.className = 'q-block';

      const qh = document.createElement('div');
      qh.className = 'q-title';
      qh.textContent = String(q.question || '');
      block.appendChild(qh);

      if (q.context) {
        const ctx = document.createElement('div');
        ctx.className = 'q-context';
        ctx.textContent = String(q.context);
        block.appendChild(ctx);
      }

      const optsDiv = document.createElement('div');
      optsDiv.className = 'q-options';

      const customRow = document.createElement('div');
      customRow.className = 'q-custom-row';
      customRow.style.display = 'none';
      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.placeholder = 'Type your answer\u2026';
      customRow.appendChild(customInput);

      const prev = answers[idx] || '';
      const prevIsOption = options.indexOf(prev) !== -1;

      options.forEach((opt) => {
        const isCustom = opt === 'Others';
        const row = document.createElement('div');
        row.className = 'q-option';
        const circle = document.createElement('div');
        circle.className = 'q-radio';
        const text = document.createElement('div');
        text.className = 'q-text';
        text.textContent = String(opt) + (opt === q.recommended ? ' (recommended)' : '');
        row.appendChild(circle);
        row.appendChild(text);

        // Restore a prior answer when navigating Back.
        const selectedNow = isCustom ? (!prevIsOption && prev !== '') : (prev === opt);
        if (selectedNow) row.classList.add('selected');
        if (isCustom && selectedNow) {
          customInput.value = prev;
          customRow.style.display = 'block';
        }

        row.addEventListener('click', () => {
          Array.from(optsDiv.querySelectorAll('.q-option')).forEach((r) =>
            r.classList.remove('selected'),
          );
          row.classList.add('selected');
          if (isCustom) {
            customRow.style.display = 'block';
            customInput.focus();
            answers[idx] = customInput.value.trim();
          } else {
            customRow.style.display = 'none';
            answers[idx] = String(opt);
          }
          updateNext();
        });
        optsDiv.appendChild(row);
      });

      customInput.addEventListener('input', () => {
        answers[idx] = customInput.value.trim();
        updateNext();
      });

      block.appendChild(optsDiv);
      block.appendChild(customRow);
      body.appendChild(block);

      const act = document.createElement('div');
      act.className = 'actions';
      if (questions.length > 1 && idx > 0) {
        const back = document.createElement('button');
        back.className = 'no';
        back.textContent = '\u2190 Back';
        back.addEventListener('click', () => {
          idx -= 1;
          render();
        });
        act.appendChild(back);
      }

      const next = document.createElement('button');
      const isLast = idx === questions.length - 1;
      next.textContent = isLast ? 'Submit answers' : 'Next \u2192';
      next.disabled = !answers[idx];
      function updateNext() {
        next.disabled = !answers[idx];
      }
      next.addEventListener('click', () => {
        if (next.disabled) return;
        if (isLast) {
          vsapi.postMessage({ type: 'user-answer', answers });
          card.remove();
          questions.forEach((qq, i) =>
            addMsg('you', 'You', String(qq.question) + ': ' + answers[i]),
          );
          clearStatus();
        } else {
          idx += 1;
          render();
        }
      });
      act.appendChild(next);
      body.appendChild(act);
    }

    log.appendChild(card);
    render();
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
