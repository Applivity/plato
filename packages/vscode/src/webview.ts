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
  .headnav { margin-left:auto; display:inline-flex; gap:6px; padding:3px;
             border:1px solid var(--pl-border); border-radius:999px; }
  /* D39g: square hit areas, centered icons, and a highlighted state
     for whichever nav page is open (history / settings).
     D42c: wider hit areas + bigger gap - the two icons sat ~26px apart
     center-to-center, close enough to mis-click. */
  #hist, #gear { display:inline-flex; align-items:center; justify-content:center;
                 width:28px; height:22px; padding:0; border:none;
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
  /* D43: empty first-run state — the composer is replaced by a friendly
     explainer + CTA until a provider exists. #log and footer stay hidden
     (both are display:flex by author CSS, so [hidden] alone is not enough). */
  #log[hidden] { display:none; }
  footer[hidden] { display:none; }
  #emptyState { flex:1; display:flex; align-items:center;
                justify-content:center; padding:24px; }
  #emptyState[hidden] { display:none; }
  .empty-card { max-width:340px; text-align:center; }
  .empty-card .empty-logo { width:34px; height:34px; margin:0 0 10px;
                            fill:none; stroke:var(--pl-muted); stroke-width:1.6;
                            stroke-linecap:round; stroke-linejoin:round; }
  .empty-card h3 { margin:0 0 8px; font-size:14px; font-weight:600; }
  .empty-card p { margin:0 0 16px; font-size:12px; line-height:1.6;
                  color:var(--pl-muted); }
  #emptyCta { font-size:12.5px; }
  /* D45a-2: the empty state can stack a second card (project rules) under
     the connect-provider card. */
  #emptyState { flex-direction:column; gap:14px; }
  #projCard { border:1px solid var(--pl-border); border-radius:10px;
              padding:18px 20px; }
  #projCard[hidden] { display:none; }
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
                      border-left:2px solid var(--vscode-charts-blue,#4aa3df);
                      display:inline-block; }
  /* Leading label so the chip reads as a tool summary, not stray text. */
  .msg.tool-summary::before { content:'tools '; opacity:.6; }
  .msg .who { display:block; font-size:10px; letter-spacing:.08em;
              text-transform:uppercase; color:var(--pl-muted);
              margin-bottom:2px; }
  .msg.you { border-left:2px solid var(--pl-accent); padding-left:8px; }
  .msg.bot  { border-left:2px solid var(--pl-border); padding-left:8px; }
  .msg.sys, .msg.tool { color:var(--pl-muted); font-size:12px; }
  /* D47f: a philosopher notice is tinted with that philosopher's colour, so
     two of them speaking in a row are told apart at a glance. */
  .msg.philosopher { border-left:2px solid var(--accent,var(--pl-border));
                     padding-left:8px; color:var(--pl-muted); font-size:12px; }
  .msg.philosopher .pdot { display:inline-block; width:7px; height:7px;
                           border-radius:50%; margin-right:6px;
                           background:var(--accent,var(--pl-muted));
                           vertical-align:middle; }
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
  @keyframes pulse { 0%,100% { opacity:.25; } 50% { opacity:1; } }
  .msg.fin { border-left:2px solid var(--vscode-testing-iconPassed,#73c991);
             padding-left:8px; color:var(--pl-muted); font-size:12px; }
  body.show-settings header:not(.shead), body.show-settings #log,
  body.show-settings #obs, body.show-settings footer,
  body.show-settings #statusbar, body.show-settings #emptyState { display:none !important; }
  #settingsPage { display:none; }
  body.show-settings #settingsPage { display:flex; flex-direction:column;
                                     height:100vh; }
  body.show-history header:not(.shead), body.show-history #log,
  body.show-history #obs, body.show-history footer,
  body.show-history #statusbar, body.show-history #emptyState { display:none !important; }
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
  /* D47i: the section header bar names the section, so .shelp is no longer a
     sibling of an in-body title. It states the section's purpose at the top of
     the body, and needs its own spacing. */
  .secbody > .shelp, .shelp { margin:0 0 14px; font-size:12px;
                     color:var(--pl-muted); line-height:1.45; }
  .secbody > .shelp:last-child { margin-bottom:0; }
  .sec { margin-bottom:28px; }
  /* Section blocks (Orchestration + Context). */
  /* D47i: the section BODY is the container now (the nested .sblock is gone, so
     all three sections share one depth). These rules keep their D47h safety
     properties, retargeted to .secbody. */
  .secbody { min-width:0; overflow-wrap:anywhere; }
  /* D47h: a flex row must be allowed to shrink below its content's natural
     width, or a long child (a model ref, a state sentence) pushes the whole
     block past the panel edge. */
  .secbody .row { display:flex; align-items:center; gap:10px;
                 flex-wrap:wrap; min-width:0; }
  .secbody .row + .row { margin-top:10px; }
  .secbody .row > * { min-width:0; }
  /* D47h: min-width:140px was applied to EVERY label in the block, which forced
     the box wider than a narrow panel (the D47b switch-track trap again). It is
     now a floor that can yield. */
  .secbody .row label { font-size:12.5px; color:var(--vscode-editor-foreground);
                  min-width:0; flex:0 1 140px; }
  .secbody select, .secbody input[type=range] {
      flex:1; padding:5px 8px; font-size:12.5px; border-radius:4px;
      border:1px solid var(--pl-border);
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground); outline:none; }
  .secbody input[type=range] { padding:0; height:6px; }
  .secbody .liveval { font-size:11.5px; color:var(--pl-muted);
                     min-width:80px; text-align:right; font-variant-numeric:tabular-nums; }
  /* Mode picker cards. D47h: auto-fit, not a fixed 3-column grid — at a narrow
     editor column (~290px of content) three fixed columns gave each card ~62px
     of text, so the descriptions crammed and were clipped. auto-fit collapses
     to ONE column when there is no room and still lays out three when wide.
     D47i: the floor is min(190px, 100%) — a bare 190px minimum still overflows
     a container narrower than that. */
  .modes { display:grid;
           grid-template-columns:repeat(auto-fit, minmax(min(190px, 100%), 1fr));
           gap:10px; }
  .mcard { border:1px solid var(--pl-border); border-radius:8px;
           padding:12px 14px; cursor:pointer; background:transparent;
           transition:border-color .12s, background .12s; min-width:0; }
  .mcard:hover { border-color:var(--vscode-focusBorder, #6a6a6a); }
  .mcard.on { border-color:var(--vscode-focusBorder, #6a9bd1);
              background:rgba(106,155,209,.10); }
  .mcard .mtitle { font-weight:600; font-size:13.5px; margin-bottom:3px; }
  .mcard .mdesc { font-size:11.5px; color:var(--pl-muted);
                  line-height:1.4; overflow-wrap:anywhere; }
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
  /* D47: config-editor look — controls share the select styling, and the
     small round "?" buttons carry tooltips (native title is stripped). */
  .duo .dhead { display:flex; align-items:center; gap:8px; margin:6px 0 2px; }
  .duo .dt { font-size:12.5px; font-weight:600; }
  .duo .dsp { flex:1; }
  .duo .help, .help { flex:none; width:16px; height:16px; padding:0; line-height:14px;
               border-radius:50%; border:1px solid var(--pl-border);
               background:transparent; color:var(--pl-muted);
               font-size:9.5px; cursor:help; text-align:center;
               font-family:inherit; }
  .duo .help:hover, .help:hover { color:var(--vscode-editor-foreground);
                     border-color:var(--vscode-focusBorder,#6a6a6a); }
  .duo .fld { margin-top:14px; }
  .duo .fld > label { display:flex; align-items:center; gap:6px;
                      font-size:11.5px; color:var(--pl-muted); margin-bottom:5px; }
  .duo .ctl { padding:6px 9px; font-size:12.5px; font-family:inherit;
              border-radius:4px; border:1px solid var(--pl-border);
              background:var(--vscode-input-background);
              color:var(--vscode-input-foreground); outline:none; }
  .duo .fld select.ctl, .duo .fld textarea.ctl,
  .duo .fld input.ctl { width:100%; box-sizing:border-box; }
  .duo textarea.ctl { line-height:1.5; resize:none; overflow-y:auto; }
  .duo input[type=number].ctl { width:64px; padding:3px 6px; }
  /* D47f: the name is an inline identity control, not a form field — it sits
     next to the colour dot and grows with its text, so the header reads as a
     title line instead of a grey disabled box. */
  .duo .mrow .mhead input.mname { flex:0 1 auto; min-width:60px; max-width:60%;
               background:transparent; border-color:transparent; font-weight:600;
               font-size:13px; padding-left:2px; }
  .duo .mrow .mhead input.mname:hover { border-color:var(--pl-border); }
  .duo .mrow .mhead input.mname:focus { border-color:var(--vscode-focusBorder,#6a6a6a);
               background:var(--vscode-input-background); }
  /* D47g: the Role box is auto-fitted to its text plus one line in JS. The
     height the text needs depends on the PANEL WIDTH, so no fixed min-height
     can be right (64px hid ~2.5 lines at a 420px panel). min-height is a
     3-line floor; max-height stops a pasted essay from owning the page. */
  .duo .mrow textarea.ctl.rolearea { min-height:64px; max-height:300px; }
  /* The character counter sits at the far right of the Role label row, so it
     never moves when the box grows (a counter under the box would). */
  .duo .fld > label .ccount { margin-left:auto; flex:none;
               font-variant-numeric:tabular-nums; }
  .duo .fld > label .ccount.is-warn { color:var(--vscode-charts-yellow,#cca700); }
  .duo .fld > label .ccount.is-full { color:var(--vscode-testing-iconFailed,#f14c4c); }
  .duo .beh { display:inline-flex; align-items:center; gap:6px; }
  .duo .toggles { display:flex; gap:14px; flex-wrap:wrap; }
  /* Member cards (D47f): the SAME card is used by Duo and Academy — header is
     the identity line (colour dot + display name + Remove), body is
     Persona / Role / Model / Powers. The accent colour comes from the member's
     own color field, set via the --accent custom property in JS. */
  .duo .mrow { display:block; border:1px solid var(--pl-border); border-radius:6px;
               padding:10px 12px; margin:10px 0;
               border-left:3px solid var(--accent,var(--pl-border)); }
  .duo .mrow .mhead { display:flex; gap:8px; align-items:center; }
  .duo .mrow .mhead input.ctl { flex:1 1 auto; min-width:0; }
  .duo .mrow .mhead select.ctl { width:auto; }
  .duo .mrow .fld { margin-top:10px; }
  .duo .mrow .fld > label { margin-bottom:4px; }
  .duo .mrow .mrow-head select.ctl { width:auto; }
  .duo > .note { margin-top:16px; }
  .duo .dhead { min-height:26px; }
  /* The colour dot: one per philosopher, identical in the Settings card, the
     chat notices, and the run-start team card. */
  .duo .cdot { flex:none; width:10px; height:10px; border-radius:50%;
               background:var(--accent,var(--pl-muted)); }
  /* D47c: Academy editor layout. The council is the identity of the whole
     block, so its name sits in the header next to the title; each member card
     leads with a colour dot + name and pushes Remove to the far right, so a
     destructive action never sits between two inputs.
     D47h: the header WRAPS, so a long action label ("Open ACADEMY.yaml")
     moves to a second line instead of running off the panel edge. */
  .duo .dhead { flex-wrap:wrap; row-gap:6px; }
  .duo .dhead .btn { flex:none; white-space:nowrap; }
  .duo .dhead .dname { flex:0 1 200px; min-width:110px; }
  .duo .dhead .dcount { flex:none; font-size:11.5px; color:var(--pl-muted);
                        font-variant-numeric:tabular-nums; }
  .duo .subhead { display:flex; align-items:center; gap:8px;
                  margin:2px 0 6px; font-size:11.5px; color:var(--pl-muted); }
  /* D47e: Plato (the doer) model control — one session-wide value, shown in
     Duo and Academy as well as the composer picker. */
  .duo .doer-row { display:flex; align-items:center; gap:8px;
                   margin:8px 0 2px; flex-wrap:wrap; row-gap:4px; }
  .duo .doer-label { flex:none; font-size:12px; font-weight:600; }
  .duo .doer-model { flex:0 1 240px; min-width:140px; }
  .duo .mhead { display:flex; align-items:center; gap:8px; }
  .duo .mhead .mname { flex:1 1 auto; min-width:0; }
  .duo .mhead .mspacer { flex:1 1 auto; }
  .duo .mkind { flex:none; font-size:10px; font-weight:600;
                letter-spacing:.06em; text-transform:uppercase;
                padding:2px 7px; border-radius:10px;
                border:1px solid var(--pl-border); color:var(--pl-muted); }
  .duo .mrow .btn-danger { flex:none; }
  .duo .mhead .btn { flex:none; white-space:nowrap; }
  .duo .starter { display:flex; align-items:flex-start; gap:8px;
                  margin:10px 0; padding:8px 10px; border-radius:6px;
                  border:1px dashed var(--pl-border);
                  font-size:11.5px; color:var(--pl-muted); line-height:1.5; }
  .duo .starter.warn { border-style:solid;
                       border-color:var(--vscode-charts-yellow,#cca700);
                       color:var(--vscode-editor-foreground); }
  .duo .listfoot { display:flex; align-items:center; gap:10px;
                   margin-top:12px; }
  .duo .listfoot .lcount { font-size:11.5px; color:var(--pl-muted);
                           font-variant-numeric:tabular-nums; }
  /* D47b: powers are switch toggles, spaced so each '?' tooltip sits with
     its own control. The min-width:0 reset is required: the .sblock label
     rule (above) sets min-width:140px on every label in a section block,
     and the switch label matches it — width alone cannot shrink a
     min-width box, so the track (position:absolute inset:0) stretched
     into a 140px bar. */
  .duo .toggles { display:flex; align-items:center; gap:20px; flex-wrap:wrap; }
  .duo .sw { position:relative; width:28px !important; height:16px !important;
             min-width:0 !important; flex:none !important;
             display:inline-block !important;
             cursor:pointer; vertical-align:middle; }
  .duo .sw input { position:absolute; inset:0; width:100%; height:100%;
                   margin:0; opacity:0; cursor:pointer; }
  .duo .sw .tk { position:absolute; inset:0; border-radius:16px;
                 background:rgba(128,128,128,.35); transition:background .15s; }
  .duo .sw .tk::after { content:''; position:absolute; top:2px; left:2px;
                        width:12px; height:12px; border-radius:50%;
                        background:#fff; border:1px solid rgba(0,0,0,.15);
                        box-shadow:0 1px 1.5px rgba(0,0,0,.25);
                        transition:left .15s; }
  .duo .sw input:checked + .tk { background:var(--vscode-button-background,#0e639c); }
  .duo .sw input:checked + .tk::after { left:14px; }
  .duo .sw input:focus-visible + .tk { box-shadow:0 0 0 2px var(--vscode-focusBorder,#6a6a6a); }
  .duo .swtxt { font-size:12px; }
  /* Plato block in Orchestration (D45a-3/D45a-4): project-file state + actions.
     D47h: these rows wrap. The state text is long ("Using the global default
     (~/.plato/PLATO.md)") and used to crush the Open button onto two lines at a
     narrow width; now the button keeps its label and drops to its own line. */
  .workers-head { margin-top:18px; }
  .workers .pf { margin-top:14px; padding-top:12px;
                 border-top:1px solid var(--pl-border); }
  .workers .pline { display:flex; align-items:center; gap:10px;
                    min-height:28px; flex-wrap:wrap; }
  .workers .pname { font-size:12.5px; font-weight:600; min-width:110px; }
  .workers .pst { font-size:11.5px; color:var(--pl-muted);
                  min-width:0; overflow-wrap:anywhere; }
  .workers .spacer { flex:1 1 0; min-width:0; }
  /* An action in a wrapping row must never be squeezed or broken. */
  .workers .pline .btn { flex:none; white-space:nowrap; }
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
  /* D47i: the action row. Delete was jammed against Refresh (measured: an
     identical 8px gap between Set key/Refresh and Refresh/Delete, so the
     destructive action read as part of the same group). Delete is now pushed
     to the far right behind a divider, so the eye groups Set key + Refresh and
     reads Delete as a separate, destructive action. */
  .conn .crow { display:flex; align-items:center; gap:8px;
                margin-top:10px; flex-wrap:wrap; }
  .conn .crow .crow-fill { flex:1 1 0; min-width:0; }
  .conn .crow .crow-sep { flex:none; width:1px; height:18px;
                background:var(--pl-border); margin:0 4px; }
  .conn .crow .btn-danger { margin-left:0; }
  /* D47l: the inline key field. Hidden until "Set key" is pressed, so the
     card's resting state is unchanged. It matches the Add-provider inputs. */
  .conn .keyrow { display:flex; align-items:center; gap:8px;
                  margin-top:8px; flex-wrap:wrap; }
  .conn .keyrow[hidden] { display:none; }
  .conn .keyrow .keyinput { flex:1 1 200px; min-width:0;
                  padding:6px 9px; font-size:12.5px; font-family:inherit;
                  border-radius:4px; border:1px solid var(--pl-border);
                  background:var(--vscode-input-background);
                  color:var(--vscode-input-foreground); outline:none; }
  .conn .keyrow .keyinput:focus {
                  border-color:var(--vscode-focusBorder,#6a6a6a); }
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
  /* D49t: ONE model per line, name over its context window. Two columns of bare
     names truncated long ids to "openrouter-dots-studio/dots-3-no…" and said
     nothing about size; stacked, the name gets the full width and the window
     rides underneath. The list scrolls, because a provider can return hundreds. */
  .conn .modellist { display:block; padding:8px 11px;
                     max-height:280px; overflow-y:auto;
                     background:var(--vscode-input-background); }
  .conn .mopt { display:flex; align-items:flex-start; gap:7px;
                padding:4px; cursor:pointer; font-size:12px; }
  .conn .mopt:hover { background:var(--vscode-list-hoverBackground,
                                       rgba(128,128,128,.12)); }
  .conn .mopt input { margin:0; flex:none; margin-top:2px; }
  .conn .mopt .mopt-text { flex:1; min-width:0; display:flex;
                           flex-direction:column; gap:1px; }
  .conn .mopt .mopt-name { white-space:nowrap; overflow:hidden;
                           text-overflow:ellipsis; }
  .conn .mopt .mopt-sub { color:var(--pl-muted); font-size:10.5px;
                          font-variant-numeric:tabular-nums;
                          white-space:nowrap; overflow:hidden;
                          text-overflow:ellipsis; }
  .conn .mopt span { overflow:hidden; text-overflow:ellipsis; }
  .conn .mbtns { grid-column:1 / -1; display:flex; gap:8px; margin-top:8px;
                 padding-top:8px; border-top:1px solid var(--pl-border); }
  /* Add-connection card: the prominent CTA. */
  .add-card { border:1px dashed var(--pl-border); border-radius:8px;
              padding:16px 18px; margin-top:14px;
              background:rgba(128,128,128,.03); }
  .onboard-card { border:1px solid var(--pl-accent); border-radius:8px;
                  padding:14px 16px; margin-bottom:14px;
                  background:rgba(74,158,255,.06); }
  .onboard-card .onboard-title { font-size:13px; font-weight:600;
                                 margin-bottom:6px; }
  .onboard-card .onboard-body { margin:0; font-size:12px; line-height:1.55;
                                color:var(--pl-muted); }
  .add-card .add-title { font-size:13px; font-weight:600; margin-bottom:12px; }
  /* D47i: the add-provider grid used a fixed 130px label column, so a narrow
     panel crushed the inputs ("— or ent", "Base URL ("). auto-fit collapses it
     to one column with the labels above their inputs. The floor is
     min(220px, 100%) and NOT a bare 220px: auto-fit still honours a fixed
     minimum inside a smaller container, which overflowed by 28px at 300px. */
  .add-card .grid { display:grid;
                    grid-template-columns:repeat(auto-fit, minmax(min(220px, 100%), 1fr));
                    gap:10px 12px; align-items:center; }
  .add-card .grid > label { min-width:0; }
  .add-card label { font-size:12px; color:var(--pl-muted); }
  .add-card input, .add-card select { padding:6px 9px; font-size:12.5px;
                                      border-radius:4px;
                                      border:1px solid var(--pl-border);
                                      background:var(--vscode-input-background);
                                      color:var(--vscode-input-foreground);
                                      outline:none; width:100%; }
  .add-card .actions { margin-top:14px; display:flex; gap:8px;
                       align-items:center; flex-wrap:wrap; }
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
  /* D47g/D47j: TWO danger shapes, because one class cannot be both.
     D47g sized .btn-danger as a 24px square for the philosopher Remove icon,
     but sbtn('Delete', ..., 'danger') renders a TEXT label in the same class —
     measured, Delete became 24px wide with white-space:normal and wrapped to
     "Del/ete" at EVERY width. The icon and the labelled button are now distinct
     classes; sbtn picks the shape from the label it was given. */
  .btn-danger { background:transparent; border:1px solid var(--pl-border);
                color:var(--pl-muted); }
  .btn-danger:hover { color:var(--vscode-testing-iconFailed,#f14c4c);
                      border-color:rgba(241,76,76,.45);
                      background:rgba(241,76,76,.12); }
  .btn-danger:focus-visible { outline:1px solid var(--vscode-focusBorder,#6a6a6a);
                              outline-offset:1px; }
  /* The icon form: a small square with a real hit area, never a text label. */
  .btn-danger.btn-icon { display:inline-flex; align-items:center;
                justify-content:center; width:24px; height:24px; padding:0;
                border-color:transparent; font-size:14px; line-height:1; }
  /* A wall, not a dead click. NOT the native disabled attribute — that
     suppresses mouse events, so the tooltip could never explain the reason. */
  .btn-danger.btn-icon.is-off, .btn-danger.btn-icon.is-off:hover {
                color:var(--pl-muted); opacity:.35; cursor:default;
                border-color:transparent; background:transparent; }
  .btn.is-off, .btn.is-off:hover { opacity:.45; cursor:default;
                border-color:var(--pl-border); background:transparent; }
  /* A labelled button never breaks its own label. */
  .btn-danger:not(.btn-icon) { white-space:nowrap; flex:none; }
  /* D47j: the armed state of a two-step destructive button. Filled red so the
     second click is unmistakably the confirming one. */
  .btn-danger.is-armed,
  .btn-danger.is-armed:hover {
                background:var(--vscode-testing-iconFailed,#f14c4c);
                border-color:var(--vscode-testing-iconFailed,#f14c4c);
                color:#fff; }
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
  /* D47f: the same colour as the Settings card and the notices. */
  .team-card .tdot { display:inline-block; width:8px; height:8px;
                     border-radius:50%; margin-right:6px;
                     background:var(--accent,var(--pl-muted)); flex:none; }
  .team-card .tm-model { color:var(--pl-muted); }
  .team-card .tm-tier { font-size:10px; color:var(--pl-muted);
                        border:1px solid var(--pl-border); border-radius:8px;
                        padding:0 5px; }
  /* D47i: ONE section shell for every panel on the Settings page. Before this,
     Providers and Context were DETAILS sections (1px border, 5px radius) while
     Orchestration was a bare DIV with NO border at all - measured, it was the
     only section with no frame, which is why it read as a different kind of
     panel. All three now share this shell. */
  details.sec, .sec-static { border:1px solid var(--pl-border);
                border-radius:8px; margin-bottom:10px;
                background:var(--vscode-editorWidget-background,
                                           rgba(128,128,128,.03));
                overflow:hidden; }
  /* The header bar: taller than the old 29px strip, with its own background and
     a divider when open, so it reads as a title you can click, not a caption. */
  details.sec > summary, .sec-static > .sechead {
                display:flex; align-items:center; gap:8px;
                padding:9px 12px; font-weight:600;
                font-size:12.5px; user-select:none; list-style:none;
                background:var(--vscode-editorWidget-background,
                           rgba(128,128,128,.07));
                border-bottom:1px solid transparent; }
  details.sec > summary { cursor:pointer; }
  details.sec[open] > summary { border-bottom-color:var(--pl-border); }
  /* The disclosure marker: a real control with a hit area, not a 13px glyph. */
  details.sec > summary::before, .sec-static > .sechead::before {
                content:'\\25B8'; flex:none; width:16px; height:16px;
                display:inline-flex; align-items:center; justify-content:center;
                font-size:16px; line-height:1; color:var(--pl-muted);
                transition:transform .12s; }
  details.sec[open] > summary::before { transform:rotate(90deg); }
  details.sec > summary:hover, .sec-static > .sechead:hover {
                background:rgba(128,128,128,.11); }
  details.sec > summary:focus-visible, .sec-static > .sechead:focus-visible {
                outline:1px solid var(--vscode-focusBorder,#6a6a6a);
                outline-offset:-1px; }
  /* Orchestration is intentionally always-open, so its marker states that
     instead of pretending to toggle. */
  .sec-static > .sechead { cursor:default; }
  .sec-static > .sechead::before { transform:rotate(90deg); opacity:.55; }
  details.sec .secbody, .sec-static > .secbody { padding:12px 14px 14px; }
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
  /* D49t: the run's elapsed time lives HERE, in the status the user is already
     reading, instead of a second chip up in the header. One place to look while
     Plato works. */
  #statusbar .selapsed { font-style:normal; font-size:11px; margin-left:auto;
               font-variant-numeric:tabular-nums; }
  #statusbar.done { color:var(--vscode-testing-iconPassed, #73c991); }
  #statusbar.done .pdot { animation:none;
               background:var(--vscode-testing-iconPassed, #73c991); }
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
  /* D42d: hover shows the info breakdown only; the compaction controls
     are pinned-state only (click the ring). */
  .ring-wrap:not(.pinned):hover #contextBreakdown,
  .ring-wrap.pinned #contextBreakdown,
  .ring-wrap:focus-within #contextBreakdown,
  #contextBreakdown:hover,
  #contextBreakdown:focus-within { display:block; }
  #contextBreakdown #ctxb-compaction { display:none; }
  .ring-wrap.pinned #contextBreakdown #ctxb-compaction { display:block; }
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
  /* D42d: the display:flex above overrides the UA's [hidden] rule, so
     the threshold / compact-now rows never disappeared. Reinstate it. */
  #contextBreakdown .ctxctl-row[hidden] { display:none; }
  #contextBreakdown .ctxctl-row .lbl { font-size:11px;
                                       color:var(--pl-muted);
                                       min-width:62px; }
  #contextBreakdown .ctxseg { display:inline-flex; flex:1; border:1px solid var(--pl-border);
                              border-radius:4px; overflow:hidden; }
  #contextBreakdown .ctxseg button { background:transparent; border:none; flex:1;
                                     text-align:center;
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
  #contextBreakdown #ctxb-cnow { flex:0 0 auto; display:inline-flex;
                                align-items:center; justify-content:center;
                                width:26px; height:24px; font-size:11px;
                                padding:0; border-radius:4px;
                                line-height:1; white-space:nowrap; }
  #contextBreakdown #ctxb-cnow svg { flex:0 0 auto; display:block; }
  /* D42e: the Compact-now button sits directly under the Manual half
     of the mode switch - right-aligned, half the control column's
     width, same metrics as the segment buttons, so it reads as the
     action for Manual mode. */
  #contextBreakdown .cnow-wrap { position:relative; flex:1; display:flex;
                                 justify-content:flex-end; }
  /* D42h: custom tooltip - the webview strips native title tooltips,
     so hover the icon shows a styled bubble above it. */
  #ctxb-tt { position:fixed; z-index:9999; pointer-events:none; display:none;
             background:var(--vscode-editorWidget-background,#252526);
             color:var(--vscode-editorWidget-foreground,#cccccc);
             border:1px solid var(--vscode-editorWidget-border,#454545);
             padding:3px 8px; border-radius:4px; font-size:11px;
             box-shadow:0 2px 8px rgba(0,0,0,.3); white-space:nowrap; }
  #ctxb-tt.show { display:block; }
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
  .composer-bar .bar-left { display:inline-flex; align-items:center;
                            gap:2px; min-width:0; }
  .composer-bar .bar-spacer { flex:1; }
  .composer-bar .future-attach { display:inline-flex; gap:4px; min-width:0; }
  /* D44c: the far-left composer cluster — the / command button and the
     paperclip — sits under the chat box's left edge. */
  .cmd-btn { display:inline-flex; align-items:center; justify-content:center;
             width:24px; height:24px; padding:0; border:none; border-radius:4px;
             background:transparent; color:var(--pl-muted); cursor:pointer; }
  .cmd-btn:hover { color:var(--vscode-editor-foreground);
                   background:rgba(128,128,128,.08); }
  .clip-btn { display:inline-flex; align-items:center; justify-content:center;
              width:24px; height:24px; padding:0; border:none; border-radius:4px;
              background:transparent; color:var(--pl-muted); cursor:pointer; }
  .clip-btn:hover { color:var(--vscode-editor-foreground);
                    background:rgba(128,128,128,.08); }
  .clip-btn[disabled] { opacity:.4; cursor:default; }
  /* D44a: attachment chips get their own row between the textarea and the
     composer bar. [hidden] is author-overridden so it needs the explicit
     rule to actually hide the row. */
  .attach-row { display:flex; flex-wrap:wrap; gap:4px 6px;
                padding:2px 10px 8px; }
  .attach-row[hidden] { display:none; }
  .attach-chip { display:inline-flex; align-items:center; gap:5px;
                 max-width:100%; padding:2px 5px 2px 9px; border-radius:10px;
                 border:1px solid var(--pl-border);
                 background:rgba(128,128,128,.09);
                 font-size:11px; color:var(--vscode-editor-foreground); }
  .attach-chip .ac-name { white-space:nowrap; overflow:hidden;
                          text-overflow:ellipsis; max-width:260px; }
  /* D49o: the image marker. A glyph, not a thumbnail — see addChip. */
  .attach-chip .ac-img { flex:none; font-size:10px; opacity:.75; }
  .attach-chip .ac-x { display:inline-flex; align-items:center;
                       justify-content:center; width:16px; height:16px;
                       margin:0; padding:0; border:none; border-radius:50%;
                       background:transparent; color:var(--pl-muted);
                       cursor:pointer; font-size:13px; line-height:1; }
  .attach-chip .ac-x:hover { color:var(--vscode-testing-iconFailed, #f14c4c);
                             background:rgba(241,76,76,.16); }
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
  /* D49t: model rows are one model per line — the name, with its context window
     as a subtitle. Inline meta read as a second column and cramped as the list
     grew; stacked, the list scrolls without anything being cut short. */
  .popover-row.model-row { align-items:flex-start; padding:6px 8px; }
  .popover-row.model-row .pr-check { line-height:16px; }
  .popover-row .pr-text { flex:1; min-width:0; display:flex;
                          flex-direction:column; gap:1px; }
  .popover-row .pr-text .pr-name { flex:none; }
  .popover-row .pr-sub { color:var(--pl-muted); font-size:10.5px;
                         white-space:nowrap; overflow:hidden;
                         text-overflow:ellipsis;
                         font-variant-numeric:tabular-nums; }
  /* D44c: command-menu rows are two-line — label + usage on the first
     line, the command's one-line description beneath. */
  .popover-row.slash-row { flex-wrap:wrap; gap:0 8px; padding:6px 8px; }
  .popover-row.slash-row .pr-sub { flex-basis:100%; font-size:11px;
                                   color:var(--pl-muted); margin-top:2px;
                                   white-space:nowrap; overflow:hidden;
                                   text-overflow:ellipsis; }
  /* D44d: banner where older turns were folded into a summary. */
  .msg.compact { display:block; margin:3px 0 5px; padding:8px 10px;
                 border-left:2px solid var(--pl-border);
                 background:rgba(128,128,128,.06); }
  .msg.compact .cc-head { font-size:10.5px; text-transform:uppercase;
                          letter-spacing:.06em; color:var(--pl-muted);
                          margin-bottom:4px; }
  .msg.compact .cc-body { font-size:12px; line-height:1.5;
                          white-space:pre-wrap; color:var(--vscode-foreground); }
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
  </div>
</header>
<div id="log"></div>
<div id="emptyState" hidden>
  <div class="empty-card">
    <svg class="empty-logo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    <h3>Connect your first provider</h3>
    <p>Plato signs in to a provider when it answers — Anthropic, OpenAI,
       OpenRouter, or any compatible endpoint. Your API key stays in
       VS Code&rsquo;s secure storage.</p>
    <button id="emptyCta" class="btn-send mode-act" type="button">Connect a provider</button>
  </div>
  <div class="empty-card" id="projCard" hidden>
    <h3>Set up this project&rsquo;s rules</h3>
    <p>This project has no PLATO.md yet. Plato ships a bundled default that
       tunes how Plato behaves &mdash; create the file to make it yours.
       Your AGENTS.md or CLAUDE.md stays yours on top.</p>
    <button id="projCta" class="btn btn-secondary" type="button">Create PLATO.md</button>
  </div>
</div>
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
        <div id="ctxb-compaction">
          <div class="ctxsep"></div>
          <h4>Compaction</h4>
          <div class="ctxctl-row" id="ctxb-thr-row">
            <span class="lbl">Threshold</span>
            <input id="ctxb-thr" type="range" min="0.5" max="0.95" step="0.05" />
            <span class="val" id="ctxb-thr-live">80%</span>
          </div>
          <div class="ctxctl-row" id="ctxb-cnow-row">
            <span class="lbl"></span>
            <div class="cnow-wrap">
              <button type="button" id="ctxb-cnow" class="btn btn-secondary"
                      title="Compact now" aria-label="Compact now">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round"
                     stroke-linejoin="round" aria-hidden="true">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"></path>
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3"></path>
                  <path d="M3 16h3a2 2 0 0 1 2 2v3"></path>
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div id="ctxb-tt">Compact now</div>
      </div>
    </div>
  </div>
  <div class="attach-row" id="attachRow" hidden></div>
  <div class="composer-bar">
    <div class="bar-left">
      <button id="cmds" class="cmd-btn" type="button" title="Commands (/…)"
              aria-label="Commands">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <line x1="8" y1="5" x2="16" y2="19"></line>
        </svg>
      </button>
      <div class="future-attach">
        <button id="clip" class="clip-btn" type="button" title="Attach files"
                aria-label="Attach files">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
      </div>
    </div>
    <span class="bar-spacer"></span>
    <button id="pp" class="bar-btn" title="Pause at the next safe point" hidden>Pause</button>
    <button id="cx" class="bar-btn" title="Stop after the current tool call" hidden>Cancel</button>
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
  // D37 state. The caption + ring + pill all read from here.
  let lastMaxContext = null;
  let lastThreshold = 0.8;
  let lastModelMaxContext = null;
  // D43: no provider connected yet — drives the empty composer state.
  let hasConnections = true;
  // D45a-2: null = not asked yet; true = no project rule file exists, so the
  // "Set up this project's rules" card shows under the connect card.
  let projMissing = null;
  vsapi.postMessage({ type: 'ready' });

  // D37 helpers -----------------------------------------------------------
  const RING_CIRC = 2 * Math.PI * 11; // matches the SVG r=11
  function fmtTok(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '--';
    // D49t: a million is 1M, not 1000k. Beyond 999,999 the industry reading
    // switches unit, and "1000k" makes the reader do the arithmetic.
    if (n >= 1000000) return (+(n / 1000000).toFixed(1)) + 'M';
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
    // D44d: compaction is always auto at the threshold — Manual is gone.
    // The threshold slider and Compact-now are always shown and stay in
    // sync with the host payload.
    if (!c) return;
    lastThreshold = typeof c.threshold === 'number' ? c.threshold : 0.8;
    const thr = document.getElementById('ctxb-thr');
    const thrLive = document.getElementById('ctxb-thr-live');
    if (thr) { thr.value = String(lastThreshold); }
    if (thrLive) {
      thrLive.textContent = Math.round(lastThreshold * 100) + '%';
    }
  }
  function updateModelCaption() {
    // D39: the "ctx 200.0k" label is gone. The model button now shows
    // just the bare model name. We keep this hook so callers (the
    // picker's selection handler, the models message handler) can
    // request a label refresh; the implementation is a no-op now.
  }
  function requestCompact() {
    // D44d: works whenever — mid-run it force-compacts the live run, idle
    // it folds the older turns into a summary (the host decides).
    vsapi.postMessage({ type: 'request-compact' });
  }
  // -----------------------------------------------------------------------

  // Pinned run-status bar (Claude-code style). Lives in #statusbar between
  // #log and the footer, so it is ALWAYS visible during a run — future tool
  // summaries and streamed text scroll in #log below, never bury it.
  //
  // D49t: the run's elapsed time lives HERE too. It used to be a second chip up
  // in the header beside Solo / new, which meant reading two places to answer
  // one question ("what is Plato doing, and how long has it been?"). The bar
  // now carries both: the status text, and the seconds ticking on the right.
  let statusEl = null, statusTextEl = null, statusElapsedEl = null;
  function ensureStatusBar() {
    const bar = document.getElementById('statusbar');
    if (!bar) return null;
    if (!statusEl) {
      bar.hidden = false;
      const d = document.createElement('span');
      d.className = 'pdot';
      const t = document.createElement('span');
      t.className = 'stext';
      const e = document.createElement('span');
      e.className = 'selapsed';
      bar.appendChild(d);
      bar.appendChild(t);
      bar.appendChild(e);
      statusEl = bar;
      statusTextEl = t;
      statusElapsedEl = e;
    }
    return statusEl;
  }
  function setStatus(text) {
    const bar = ensureStatusBar();
    if (!bar || !statusTextEl) return;
    bar.classList.remove('done');
    statusTextEl.textContent = text;
  }
  function clearStatus() {
    const bar = document.getElementById('statusbar');
    if (bar) {
      bar.hidden = true;
      bar.textContent = '';
      bar.classList.remove('done');
    }
    statusEl = null;
    statusTextEl = null;
    statusElapsedEl = null;
  }

  /** Sets the status line and dismisses the elapsed slot together. */
  function chipOn(txt, doneKind) {
    const bar = ensureStatusBar();
    if (!bar || !statusTextEl) return;
    if (statusElapsedEl) statusElapsedEl.textContent = '';
    bar.classList.toggle('done', Boolean(doneKind));
    statusTextEl.textContent = txt;
  }
  function chipOff() {
    clearStatus();
  }
  function refreshChip() {
    if (!busy || !runT0) { return; }
    // The bar must be up even before any setStatus has fired, or the timer
    // would tick into a hidden element.
    const bar = ensureStatusBar();
    if (!bar) return;
    if (statusElapsedEl) {
      statusElapsedEl.textContent =
        Math.floor((Date.now() - runT0) / 1000) + 's';
    }
  }
  setInterval(refreshChip, 1000);

  // D43: swap the composer for the friendly empty state while no
  // provider is connected. Driven by the hasConnections signal that
  // every models/restore payload now carries; sendSettings() reposts
  // models after each connection change, so Add/Delete stay in sync.
  function applyEmptyState(has) {
    has = Boolean(has);
    if (hasConnections === has) { return; }
    hasConnections = has;
    const footer = document.querySelector('footer');
    const empty = document.getElementById('emptyState');
    const logEl = document.getElementById('log');
    const modelLabel = document.querySelector('#modelBtn .model-btn-label');
    if (footer) { footer.hidden = !has; }
    if (empty) { empty.hidden = has; }
    if (logEl) { logEl.hidden = !has; }
    if (!has && modelLabel) { modelLabel.textContent = 'connect a provider'; }
    // Reconnect: the models payload already refreshed the label; only
    // fall back to the last known selection label if it exists.
    if (has && modelLabel && currentModelLabel) {
      modelLabel.textContent = currentModelLabel;
    }
    // D45a-2: while the empty composer is showing, ask once whether any
    // project rule file exists (drives the secondary card). Re-ask each time
    // the empty state reappears so a file created meanwhile is respected.
    if (has) {
      projMissing = null;
    } else if (projMissing === null) {
      vsapi.postMessage({ type: 'proj-files' });
    }
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
    // D44c: leftEdge anchors the popover's left edge to the trigger's left
    // (the command menu floats above the textarea's top-left); the default
    // centers it, which the model/mode pickers rely on.
    const edgeLeft = !!(opts && opts.leftEdge);
    const side = edgeLeft ? r.left + 2 : r.left + r.width / 2 - pw / 2;
    if (opts && opts.up) {
      top = r.top - ph - 6;
      left = side;
    } else {
      top = r.bottom + 6;
      left = side;
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
      // D49t: switch unit past 999,999 — 1M, never 1000k.
      if (n >= 1000000) { return Math.round(n / 1000000) + 'M'; }
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
    // D47e: the doer rows in Duo/Academy show the same value as the composer —
    // one session-wide model, two views of it.
    for (const fn of doerRowPaints) { fn(); }
  };
  // Registered by doerRow(); each paints its label from currentModel/Label.
  const doerRowPaints = [];
  /**
   * D47e: a model control for Plato (the doer) inside a mode block. It posts
   * the same {type:'model'} message as the composer picker, so both views stay
   * synced by construction — there is no second stored value.
   */
  const doerRow = (intro) => {
    const row = el('div', 'doer-row');
    row.appendChild(el('span', 'doer-label', "Plato\u2019s model")); // D47f: was 'Plato — the doer'
    const selEl = el('select', 'ctl doer-model');
    const paint = () => {
      selEl.textContent = '';
      const items = lastModelItems.slice();
      if (currentModel && !items.some((it) => String(it.value) === currentModel)) {
        items.push({ value: currentModel, label: currentModelLabel || currentModel });
      }
      for (const it of items) {
        const o = el('option', null, String(it.label || it.value));
        o.value = String(it.value);
        selEl.appendChild(o);
      }
      selEl.value = currentModel;
    };
    paint();
    doerRowPaints.push(paint);
    selEl.addEventListener('change', () => {
      // D47h FIX: update the ONE shared value before posting, exactly as the
      // composer popover does (setModelSelected + post). Previously this only
      // posted, so the shared value kept the old model; the host accepted the
      // new one and posted its state back, whose preserve logic then re-applied
      // that stale value and the select snapped back. Writing the shared value
      // here makes the host echo a no-op paint of the new value.
      const chosen = selEl.value;
      const item = lastModelItems.find(
        (it) => String(it.value || '') === chosen);
      setModelSelected(
        chosen,
        item ? String(item.label || chosen) : (currentModelLabel || chosen),
        item ? item.maxContext : null,
      );
      vsapi.postMessage({ type: 'model', value: chosen });
    });
    row.appendChild(selEl);
    row.appendChild(iHelp(intro + ' Shared with this chat and every mode; '
      + 'change it here or in the composer - it is the same setting.'));
    return row;
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
      // D49t: one model per row, name over its context window. The window used
      // to sit inline beside the name, which reads as a second column and gets
      // cramped as the list grows; as a subtitle it stays legible and the list
      // scrolls. The row is a MODIFIER on the shared popover row so the mode and
      // slash pickers keep their own layout.
      const row = el('div', 'popover-row model-row');
      row.dataset.value = value;
      row.setAttribute('role', 'option');
      const text = el('span', 'pr-text');
      const name = el('span', 'pr-name', label);
      const ctx = fmtCtx(max);
      const sub = el('span', 'pr-sub',
        ctx ? ctx + ' context' : 'context unknown');
      const check = el('span', 'pr-check', value === currentModel ? '\u2713' : '');
      text.appendChild(name);
      text.appendChild(sub);
      row.appendChild(check);
      row.appendChild(text);
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
      const row = el('div', 'popover-row model-row');
      row.dataset.value = currentModel;
      const text = el('span', 'pr-text');
      const name = el('span', 'pr-name', currentModelLabel || currentModel);
      const sub = el('span', 'pr-sub', 'not in the fetched list');
      const check = el('span', 'pr-check', '\u2713');
      text.appendChild(name);
      text.appendChild(sub);
      row.appendChild(check);
      row.appendChild(text);
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
    if (!hasConnections) {
      // D43: no models exist yet — take the user to onboarding instead
      // of an empty picker.
      requestSettings();
      return;
    }
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
    // D44a: a fresh chat drops any chips. The host's newChat resets
    // pendingAttachments and pendingHistory, so no attach-clear is needed.
    clearChips();
    vsapi.postMessage({ type: 'newChat' });
  });
  // D43: the empty state's CTA opens Settings → Providers (which
  // auto-opens the section when zero providers exist, D38b).
  document.getElementById('emptyCta').addEventListener('click', () => {
    requestSettings();
  });
  // D45a-2: the secondary card's CTA materializes PLATO.md from the bundled
  // default. Hide the card optimistically; the host opens the new file.
  const projCta = document.getElementById('projCta');
  if (projCta) {
    projCta.addEventListener('click', () => {
      const pc = document.getElementById('projCard');
      if (pc) { pc.hidden = true; }
      projMissing = false;
      vsapi.postMessage({ type: 'plato-open', from: 'empty' });
    });
  }

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
  //
  // D49v: asking for Settings is a REQUEST, and only a reply to one may move
  // the view — the host marks that payload. It sends a settings payload after
  // any connection change too, and every one of those used to call showSettings,
  // so the chat could be yanked away mid-click.
  function requestSettings() {
    vsapi.postMessage({ type: 'openSettings' });
  }
  const gear = document.getElementById('gear');
  gear.addEventListener('click', () => {
    requestSettings();
  });
  document.getElementById('sback').addEventListener('click', () => {
    document.body.classList.remove('show-settings');
    vsapi.postMessage({ type: 'settings-closed' });
  });

  // Orchestration chip (D32e): always shows the active mode; one click to
  // Settings → Orchestration.
  const orchChip = document.getElementById('orchChip');
  orchChip.addEventListener('click', () => {
    requestSettings();
  });
  function syncOrchChip(o) {
    const mode = o.mode || 'solo';
    if (mode === 'academy') {
      const nm = o.academy && o.academy.name ? ':' + o.academy.name : '';
      orchChip.textContent = '\u2727 academy' + nm;
    } else if (mode === 'duo') {
      const nm = o.duo && o.duo.name ? ' \u00b7 ' + o.duo.name : '';
      orchChip.textContent = '\u25D0 duo' + nm;
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
    if (n >= 1000000) return (+(n / 1000000).toFixed(1)) + 'M';
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
        'No runs recorded yet. Every Plato run is transcribed to ~/.plato/runs/ automatically.',
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
  // D47j: a glyph-only label means an ICON button (square, no text metrics);
  // a word means a labelled button that must never break its own label. The
  // danger variant alone cannot express both — that is how Delete became a
  // 24px box and wrapped to "Del/ete".
  const isGlyphLabel = (s) => s.length > 0 && s.length <= 2
    && !/[\w\s]/.test(s);
  function sbtn(label, fn, variant) {
    // D38: variant is one of 'primary' | 'secondary' | 'ghost' | 'danger'.
    // (defaults to 'secondary'). D47g: 'danger' maps to the class the CSS
    // actually defines (.btn-danger); it previously emitted .btn-danger while
    // the stylesheet defined .btn-icon-danger, so the variant had NO rule and
    // the browser painted its default white button.
    let cls = 'btn btn-' + (variant || 'secondary');
    if (variant === 'danger' && isGlyphLabel(String(label))) {
      cls += ' btn-icon';
    }
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

  // D47: settings info tooltips — native title tooltips don't render in the
  // webview, so the round "?" buttons show a styled bubble next to the cursor.
  let tipEl = null;
  function tipEnsure() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.style.position = 'fixed';
      tipEl.style.zIndex = '9999';
      tipEl.style.pointerEvents = 'none';
      tipEl.style.display = 'none';
      tipEl.style.maxWidth = '280px';
      tipEl.style.padding = '7px 11px';
      tipEl.style.borderRadius = '6px';
      tipEl.style.fontSize = '11.5px';
      tipEl.style.lineHeight = '1.5';
      tipEl.style.whiteSpace = 'pre-line';
      tipEl.style.background = 'var(--vscode-editorWidget-background,#252526)';
      tipEl.style.color = 'var(--vscode-editorWidget-foreground,#cccccc)';
      tipEl.style.border = '1px solid var(--vscode-editorWidget-border,#454545)';
      tipEl.style.boxShadow = '0 2px 10px rgba(0,0,0,.35)';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  // Position under the hovered control (its own '?'), flipping up when it
  // would overflow the bottom edge — never spilling toward the next option.
  function tipPos(e) {
    const el0 = tipEnsure();
    const tw = el0.offsetWidth;
    const th = el0.offsetHeight;
    let x;
    let y;
    const r = e.currentTarget && typeof e.currentTarget.getBoundingClientRect === 'function'
      ? e.currentTarget.getBoundingClientRect()
      : null;
    if (r) {
      x = r.left + (r.width / 2) - (tw / 2);
      y = r.bottom + 8;
      if (y + th > window.innerHeight - 8) { y = r.top - th - 8; }
    } else {
      x = e.clientX + 16;
      y = e.clientY + 18;
    }
    if (x + tw > window.innerWidth - 8) { x = Math.max(8, window.innerWidth - tw - 8); }
    if (x < 8) { x = 8; }
    el0.style.left = x + 'px';
    el0.style.top = y + 'px';
  }
  function tipShow(e, text) {
    const el0 = tipEnsure();
    el0.textContent = text;
    el0.style.display = 'block';
    tipPos(e);
  }
  function tipMove(e) {
    if (!tipEl || tipEl.style.display === 'none') { return; }
    tipPos(e);
  }
  function tipHide() {
    if (tipEl) { tipEl.style.display = 'none'; }
  }
  function iHelp(text) {
    const b = el('button', 'help', '?');
    b.type = 'button';
    b.addEventListener('mouseenter', (ev) => tipShow(ev, text));
    b.addEventListener('mousemove', tipMove);
    b.addEventListener('mouseleave', tipHide);
    b.addEventListener('focus', (ev) => tipShow(ev, text));
    b.addEventListener('blur', tipHide);
    return b;
  }

  // --- D47f: philosopher colours. -----------------------------------------
  // The palette arrives with the settings payload (this webview has no
  // imports). A member's colour is STORED in the yaml, so it never shifts when
  // another philosopher is removed.
  let colorPalette = [];
  const setColorPalette = (list) => {
    colorPalette = Array.isArray(list) ? list.slice() : [];
  };
  const colorHex = (id) => {
    const hit = colorPalette.find((c) => c.id === id);
    return hit ? hit.hex : '';
  };
  /** The first palette colour no member holds, so a new one is always distinct. */
  const firstUnusedColor = (used) => {
    const taken = {};
    for (const u of used) { if (u) { taken[u] = true; } }
    for (const c of colorPalette) { if (!taken[c.id]) { return c.id; } }
    return colorPalette.length ? colorPalette[used.length % colorPalette.length].id : '';
  };
  /** One colour dot, used by the Settings card and the team card. */
  const colorDot = (cls, hex) => {
    const d = el('span', cls);
    if (hex) { d.style.background = hex; }
    return d;
  };

  // --- D47g: role cap + auto-fitting Role box. ----------------------------
  // The cap mirrors ROLE_MAX_CHARS in core — this webview cannot import it, so
  // the host sends the number and the parser enforces the same one. The box
  // also cannot TYPE an over-long role (maxlength), so the UI can never write
  // a file the parser would then reject.
  let roleMax = 1000;
  const setRoleMax = (n) => { if (typeof n === 'number' && n > 0) { roleMax = n; } };

  /** Collapse to one line — the yaml cannot hold a role across lines.
   *  NOTE: this file is a template literal, so the regex needs a DOUBLE
   *  backslash. A single one is eaten by the literal and compiles to /s+/,
   *  which matches the letter s and silently does nothing (D47g bug). */
  const oneLine = (s) => String(s).replace(/\\s+/g, ' ').trim();

  /**
   * Fit the Role box to its text plus ONE line, so there is always breathing
   * room at the bottom without an empty line in the value. Must re-run when
   * the panel width changes: the same text needs more lines in a narrow panel,
   * which is exactly how a fixed min-height clipped real roles.
   *
   * Measured with a hidden MIRROR of the same text, not the textarea's own
   * scrollHeight: a textarea reports scrollHeight rounded up generously (5.01
   * lines for text that needs 4), which rounded the box to a whole extra line.
   * The mirror uses the resolved font, so it is exact.
   */
  const fitRole = (t) => {
    if (!t.isConnected) { return; }
    const cs = getComputedStyle(t);
    const lh = parseFloat(cs.lineHeight) || 18.75;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    let mirror = t.__mirror;
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.pointerEvents = 'none';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordBreak = 'break-word';
      mirror.style.top = '0';
      mirror.style.left = '0';
      document.body.appendChild(mirror);
      t.__mirror = mirror;
    }
    mirror.style.font = cs.font;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.lineHeight = cs.lineHeight;
    // clientWidth is the content width; the textarea reserves its own scrollbar.
    mirror.style.width = Math.max(20, t.clientWidth) + 'px';
    mirror.textContent = t.value.length > 0 ? t.value : (t.placeholder || ' ');
    const textH = mirror.getBoundingClientRect().height;
    const lines = Math.max(1, Math.round(textH / lh));
    // Exactly ONE spare line below the text.
    t.style.height = ((lines + 1) * lh + padT + padB + border) + 'px';
  };
  // One observer for the whole settings page: a fit is only needed when the
  // WIDTH changes (the box's own height change must not re-trigger it).
  const roleBoxes = [];
  let roleLastW = 0;
  const fitAllRoles = () => { for (const t of roleBoxes) { if (t.isConnected) { fitRole(t); } } };

  /** The "n / max" counter that lives at the right of a field label row. */
  const charCount = (box) => {
    const c = el('span', 'ccount');
    const paint = () => {
      const n = box.value.length;
      c.textContent = n + ' / ' + roleMax;
      c.classList.toggle('is-full', n >= roleMax);
      c.classList.toggle('is-warn', n < roleMax && n >= roleMax * 0.9);
    };
    paint();
    return { node: c, paint };
  };

  /** A card that fits its own text and one line, plus the fill-size helper. */
  const sizeNameInput = (nIn) => {
    const fit = () => { nIn.style.width = Math.max(6, nIn.value.length + 2) + 'ch'; };
    fit();
    nIn.addEventListener('input', fit);
    return fit;
  };

  /**
   * D47f: ONE philosopher card, shared by Duo and Academy so the two panels
   * cannot drift apart. The header is the identity line — colour dot + display
   * name + Remove (kept far right, never between two inputs) — and the body is
   * Persona, Role, Model, Powers in that order in both modes.
   *
   * The helpers object supplies lab and beh, which are defined later in this
   * function; they are passed in rather than captured so this builder stays
   * hoist-safe. onPersona receives the two inputs it may refill, so each mode
   * keeps its own save semantics without duplicating the layout.
   */
  const philosopherCard = (opts, helpers) => {
    const { lab, beh } = helpers;
    const {
      hex, name, namePlaceholder, canRemove, onRename, onRemove, removeTip,
      personaOptions, personaValue, onPersona, onRoleDraft,
      roleLabel, roleHelp, rolePlaceholder,
      modelOptions, modelValue, modelLabel, modelHelp, onModel,
      pause, onPause, pauseLabel,
      cancel, onCancel, cancelLabel,
      maxInterventions, onMax, capHelp,
      powersHelp,
    } = opts;

    const card = el('div', 'mrow');
    if (hex) { card.style.setProperty('--accent', hex); }

    // Header: identity.
    const top = el('div', 'mhead');
    top.appendChild(colorDot('cdot', hex));
    const nIn = el('input');
    nIn.type = 'text';
    nIn.className = 'ctl mname';
    nIn.value = name;
    nIn.placeholder = namePlaceholder;
    // Size the inline name to its text so the header reads as a title line.
    sizeNameInput(nIn);
    nIn.addEventListener('change', () => onRename(nIn.value.trim()));
    top.appendChild(nIn);
    // D47g: Remove is DRAWN at both walls (was: hidden at the floor), so the
    // layout never reflows when the count crosses 2. At the floor it is
    // aria-disabled rather than natively disabled — a native disabled button
    // emits no mouse events, so its tooltip could never explain the reason.
    const removeBtn = sbtn('\u2715', () => {
      if (removeBtn.classList.contains('is-off')) { return; }
      onRemove();
    }, 'danger');
    removeBtn.setAttribute('aria-label', 'Remove philosopher');
    removeBtn.setAttribute('title', '');
    removeBtn.addEventListener('mouseenter', (ev) => tipShow(ev, removeTip));
    removeBtn.addEventListener('mousemove', tipMove);
    removeBtn.addEventListener('mouseleave', tipHide);
    removeBtn.addEventListener('focus', (ev) => tipShow(ev, removeTip));
    removeBtn.addEventListener('blur', tipHide);
    if (!canRemove) {
      removeBtn.classList.add('is-off');
      removeBtn.setAttribute('aria-disabled', 'true');
    }
    // Always rendered; Duo's single philosopher is not a bounded list, so it
    // opts out with showRemove: false.
    if (opts.showRemove !== false) {
      top.appendChild(el('span', 'mspacer'));
      top.appendChild(removeBtn);
    }
    card.appendChild(top);

    // Persona.
    const pSel = sel(personaOptions, personaValue);
    pSel.className = 'ctl';
    const fldP = el('div', 'fld');
    fldP.appendChild(lab('Persona', 'A preset: it supplies the default display name and role prompt. Pick one, then edit the role below to shape it.'));
    fldP.appendChild(pSel);
    card.appendChild(fldP);

    // Role. D47g: capped, counted, and fitted to its own text plus one line.
    const rIn = document.createElement('textarea');
    rIn.className = 'ctl rolearea';
    rIn.value = opts.role;
    rIn.placeholder = rolePlaceholder;
    rIn.maxLength = roleMax; // the UI cannot exceed the parser's cap
    const cc = charCount(rIn);
    const repaintRole = () => { cc.paint(); fitRole(rIn); };
    // Keystrokes change both the counter and the height the text needs.
    rIn.addEventListener('input', repaintRole);
    // Whitespace is folded on save (the yaml holds one line), so fold it here
    // too — the box then shows exactly what will be stored.
    rIn.addEventListener('change', () => {
      const v = oneLine(rIn.value);
      if (v !== rIn.value) { rIn.value = v; }
      onRoleDraft(v);
      repaintRole();
    });
    roleBoxes.push(rIn);
    const fldR = el('div', 'fld');
    fldR.appendChild(lab(roleLabel, roleHelp, cc.node));
    fldR.appendChild(rIn);
    card.appendChild(fldR);
    // Fit after the card is in the DOM (scrollHeight is 0 while detached).
    requestAnimationFrame(repaintRole);

    // Model.
    const mSel = sel(modelOptions, modelValue);
    mSel.className = 'ctl';
    mSel.addEventListener('change', () => onModel(mSel.value));
    const fldM = el('div', 'fld');
    fldM.appendChild(lab(modelLabel, modelHelp));
    fldM.appendChild(mSel);
    card.appendChild(fldM);

    // Powers.
    const tr = el('div', 'toggles');
    tr.appendChild(beh(pause, pauseLabel, 'Allow this philosopher to pause a run at a safe point until you resume.', onPause));
    tr.appendChild(beh(cancel, cancelLabel, 'Allow this philosopher to stop a run (after the in-flight tool) when it is going wrong.', onCancel));
    const capWrap = el('div', 'beh');
    const capLbl = el('label', 'tog', 'Max interventions');
    const capIn = el('input');
    capIn.type = 'number';
    capIn.className = 'ctl';
    capIn.min = '0';
    capIn.max = '50';
    capIn.value = String(maxInterventions);
    capIn.addEventListener('change', () => onMax(Number(capIn.value) || 5));
    capLbl.appendChild(capIn);
    capWrap.appendChild(capLbl);
    capWrap.appendChild(iHelp(capHelp));
    tr.appendChild(capWrap);
    const fldB = el('div', 'fld');
    fldB.appendChild(lab('Powers', powersHelp));
    fldB.appendChild(tr);
    card.appendChild(fldB);

    // Wire the persona picker last so it can refill the controls above it.
    pSel.addEventListener('change', () => onPersona(pSel.value, { nIn, rIn }));

    return card;
  };

  // D47j: a full re-render used to close every section the user had opened, so
  // clicking "Set key", "Refresh models" or "Add connection" collapsed Providers
  // out from under them (all three end in a fresh settings payload). The
  // open/closed state of the sections, plus the scroll position, is now
  // preserved across renders.
  //
  // D47k: the key must be STABLE, not the summary text. Providers' summary
  // embeds a live count ("Providers  —  1 configured"), so adding a connection
  // changed the label and the restore missed — the section still collapsed.
  // Each section now carries a fixed data-sec id.
  let settingsScroll = null;
  const openSectionIds = () => {
    const set = new Set();
    for (const d of document.querySelectorAll('#sbody .sec')) {
      const id = d.getAttribute('data-sec');
      if (d.open && id) { set.add(id); }
    }
    return set;
  };

  function showSettings(d) {
    // Capture the UI state BEFORE wiping the body, so a re-render is invisible.
    const wasOpen = document.body.classList.contains('show-settings')
      ? openSectionIds()
      : null;
    if (wasOpen) {
      const sb = document.getElementById('sbody');
      settingsScroll = sb ? sb.scrollTop : null;
    }
    document.body.classList.add('show-settings');
    // D47f: the palette arrives with the payload; nothing here can import core.
    setColorPalette((d.orchestration && d.orchestration.colors) || []);
    // D47g: same for the role cap — one number, enforced by the parser too.
    setRoleMax(d.orchestration && d.orchestration.roleMaxChars);
    // Rebuild the fit list: cards from the previous render are gone.
    roleBoxes.length = 0;
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
    // D47k: a STABLE id for the across-render open/closed restore. The summary
    // text cannot be used — it embeds the live connection count.
    sec1Det.setAttribute('data-sec', 'providers');
    sec1Det.appendChild(el('summary', null,
      'Providers  \u2014  ' + userConns.length + ' configured'));
    const sec1Body = el('div', 'secbody');
    sec1Det.appendChild(sec1Body);
    wrap.appendChild(sec1Det);
    if (userConns.length === 0) {
      sec1Det.open = true;
    }
    // D47i: the header bar names the section, so the in-body title is gone;
    // only the explanation stays, matching Orchestration and Context.
    sec1Body.appendChild(el('p', 'shelp',
      'Where Plato goes. Each provider has its own API key, base URL, and model list. Keys are stored in SecretStorage and never displayed.'));

    // D43: onboarding card on first run — nothing is pre-configured.
    if (userConns.length === 0) {
      const oc = el('div', 'onboard-card');
      oc.appendChild(el('div', 'onboard-title',
        '✦  Connect your first provider'));
      oc.appendChild(el('p', 'onboard-body',
        'Plato has nothing configured yet. Pick a preset below or enter a custom endpoint, then set your API key. Keys stay in VS Code secure storage and never touch the repo.'));
      sec1Body.appendChild(oc);
    }

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
        const ctxMap = c.ctx || {};
        for (const mid of pool) {
          const key = String(mid);
          const lbl = el('label', 'mopt', null);
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = key;
          cb.checked = selected.has(key);
          // D49t: the name gets the whole line and the window sits beneath it,
          // the same shape the composer's picker uses.
          const text = el('span', 'mopt-text');
          text.appendChild(el('span', 'mopt-name', key));
          const ctxN = fmtCtx(ctxMap[key]);
          text.appendChild(el('span', 'mopt-sub',
            ctxN ? ctxN + ' context' : 'context unknown'));
          lbl.appendChild(cb);
          lbl.appendChild(text);
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
      // D47l: the key is entered INLINE, exactly like "Add a provider". It used
      // to open a native VS Code input box, which took focus out of the panel
      // (the section then re-rendered and appeared to collapse), and it gave the
      // same action two different surfaces. One pattern now covers both.
      const keyRow = el('div', 'keyrow');
      const keyInput = el('input');
      keyInput.type = 'password';
      keyInput.className = 'ctl keyinput';
      keyInput.placeholder = c.keyStatus === 'set'
        ? 'Replace API key\u2026'
        : 'Paste the API key\u2026';
      keyInput.autocomplete = 'off';
      keyInput.setAttribute('aria-label', 'API key for ' + c.id);
      const keySave = sbtn('Save key', () => {
        const v = keyInput.value.trim();
        if (v.length === 0) { return; }
        vsapi.postMessage({ type: 'settings-set-key', connId: c.id, apiKey: v });
        // Never keep the secret in the DOM after it is sent.
        keyInput.value = '';
      }, c.keyStatus === 'set' ? 'secondary' : 'primary');
      const keyCancel = sbtn('Cancel', () => {
        keyInput.value = '';
        keyRow.hidden = true;
      }, 'secondary');
      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); keySave.click(); }
        if (e.key === 'Escape') { e.preventDefault(); keyCancel.click(); }
      });
      const setKeyBtn = sbtn('Set key', () => {
        keyRow.hidden = !keyRow.hidden;
        if (!keyRow.hidden) { keyInput.focus(); }
      }, c.keyStatus === 'set' ? 'secondary' : 'primary');
      setKeyBtn.setAttribute('aria-expanded', 'false');
      setKeyBtn.addEventListener('click', () => {
        setKeyBtn.setAttribute('aria-expanded', keyRow.hidden ? 'false' : 'true');
      });
      crow.appendChild(setKeyBtn);
      const refresh = sbtn('\u21BB Refresh models', () => {
        vsapi.postMessage({ type: 'settings-fetch', connId: c.id });
      }, 'secondary');
      refresh.disabled = Boolean(c.keyStatus !== 'set');
      crow.appendChild(refresh);
      // D47i: push Delete away from the primary actions and separate it with a
      // rule, so the destructive action is not read as part of the same group.
      crow.appendChild(el('span', 'crow-fill'));
      crow.appendChild(el('span', 'crow-sep'));
      // D38b: built-ins are no longer rendered as cards, so every card
      // here is user-managed. Always show Delete.
      // D47j: Delete destroys a connection AND its stored key, so it is a
      // two-step button: the first click arms it, the second confirms. A native
      // confirm dialog is avoided — it blocks the whole webview. The row is
      // re-rendered in place, so the layout (and the section's open state) is
      // untouched, and the armed state reverts on blur or after a timeout.
      const del = sbtn('Delete', () => undefined, 'danger');
      let armed = false;
      let armTimer = null;
      const disarm = () => {
        armed = false;
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
        del.textContent = 'Delete';
        del.classList.remove('is-armed');
      };
      del.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Confirm delete';
          del.classList.add('is-armed');
          armTimer = setTimeout(disarm, 6000);
          return;
        }
        disarm();
        vsapi.postMessage({ type: 'settings-delete', connId: c.id });
      });
      del.addEventListener('blur', disarm);
      del.setAttribute('aria-label',
        'Delete this provider and its stored key (asks once to confirm)');
      crow.appendChild(del);
      card.appendChild(crow);
      // D47l: the inline key field lives under the action row and is hidden
      // until "Set key" is pressed, so the card's resting state is unchanged.
      keyRow.hidden = true;
      keyRow.appendChild(keyInput);
      keyRow.appendChild(keySave);
      keyRow.appendChild(keyCancel);
      card.appendChild(keyRow);
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
    // D47i: this was a hard-coded '130px 1fr' set in JS, so it ignored the
    // responsive .add-card .grid rule and crushed the select to 78px at a
    // 300px panel. auto-fit collapses it like the rest of the card, and the
    // floor is min(220px, 100%) so it cannot overflow a narrower container.
    presetRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))';
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
    const fbaseLbl = el('label', null, 'Base URL');
    const fbase = el('input');
    fbase.placeholder = 'Base URL (e.g. http://localhost:4000/v1)';
    grid.appendChild(fbaseLbl);
    grid.appendChild(fbase);
    const fkey = el('input');
    fkey.type = 'password';
    fkey.placeholder = 'API key';
    fkey.autocomplete = 'off';
    grid.appendChild(el('label', null, 'API key'));
    grid.appendChild(fkey);
    ppick.addEventListener('change', () => {
      const pre = (d.presets || []).find((p) => p.value === ppick.value);
      // D43: the OpenAI/Anthropic endpoints are fixed by the preset —
      // hide the URL field for those two; the preset's own baseUrl
      // still rides the submit (fbase keeps its value while hidden).
      // Every other preset and custom endpoints show the editable field.
      const fixed = pre && (pre.value === 'openai' || pre.value === 'anthropic');
      fbaseLbl.hidden = Boolean(fixed);
      fbase.hidden = Boolean(fixed);
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
    // D47i: Orchestration uses the SAME section shell as Providers and Context,
    // so the page reads as one surface. It stays permanently open (founder
    // decision — the mode cards and the council are the point of the panel), so
    // it is a div with a non-toggling .sechead instead of a <details>.
    const secO = el('div', 'sec sec-static');
    secO.setAttribute('data-sec', 'orchestration');
    const secOHead = el('div', 'sechead');
    secOHead.appendChild(el('span', null, 'Orchestration'));
    secO.appendChild(secOHead);
    const secOBody = el('div', 'secbody');
    secO.appendChild(secOBody);
    wrap.appendChild(secO);
    // The header bar already names the section, so the in-body title is gone;
    // only the explanation stays.
    secOBody.appendChild(el('p', 'shelp',
      'How Plato is staffed. Applies from the next run. The mode decides - a stray ACADEMY.yaml never takes over a run.'));
    // D47i: no nested .sblock — the section body IS the container now, so all
    // three sections share one nesting depth instead of two different ones.
    const oblock = secOBody;
    const MODES = [
      { id: 'solo', label: 'Solo', desc: 'Plato alone. No philosopher watching.' },
      { id: 'duo', label: 'Duo', desc: 'Plato + one philosopher steering the run.' },
      { id: 'academy', label: 'Academy', desc: 'Plato + a council of philosophers.' },
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

    // D45a-3: the worker is the one doer in every arrangement, so its
    // project-file block lives in Orchestration (shown for the active mode),
    // not as a separate top-level section. PLATO.md + AGENTS.md/CLAUDE.md
    // always join when present — there is no include opt-out.
    const w = d.workers || { noRoot: true, plato: 'default', agentsFile: null };
    const wh = el('h3', 'shead3 workers-head', 'Plato — project files');
    // D47f: the explainer moved behind a "?" so the block leads with state.
    wh.appendChild(iHelp(
      'A project PLATO.md overrides the global default; with neither, Plato ' +
      'uses the bundled default. Creating one writes that default so the file ' +
      'starts where the shipped role leaves off. Your AGENTS.md / CLAUDE.md ' +
      'stays yours.'));
    oblock.appendChild(wh);
    const wBlock = el('div', 'workers');
    if (w.noRoot) {
      wBlock.appendChild(el('div', 'note',
        'Open a workspace folder to see the project-file state.'));
    } else {
      const pf = el('div', 'pf');
      const pline = el('div', 'pline');
      pline.appendChild(el('span', 'pname', 'PLATO.md'));
      pline.appendChild(el('span', 'pst',
        w.plato === 'project'
          ? 'Custom — this project'
          : w.plato === 'global'
            ? 'Using the global default (~/.plato/PLATO.md)'
            : 'Using the bundled default'));
      pline.appendChild(el('span', 'spacer'));
      pline.appendChild(w.plato === 'project'
        ? sbtn('Open PLATO.md', () => {
            vsapi.postMessage({ type: 'plato-open', from: 'settings' });
          }, 'secondary')
        : sbtn('Create PLATO.md', () => {
            vsapi.postMessage({ type: 'plato-open', from: 'settings' });
          }, 'secondary'));
      pf.appendChild(pline);
      const aline = el('div', 'pline');
      aline.appendChild(el('span', 'pname', 'AGENTS.md'));
      aline.appendChild(el('span', 'pst',
        w.agentsFile
          ? w.agentsFile + ' present'
          : 'Not present — Plato reads it when it exists.'));
      pf.appendChild(aline);
      wBlock.appendChild(pf);
    }
    oblock.appendChild(wBlock);

    // D47: Duo + Academy are edited entirely here. The yaml file is the
    // single store: every control change posts the whole model (save-duo /
    // save-academy), the host validates + writes it, and re-pushes state.
    // ACADEMY.yaml only shows in Academy mode; duo only in Duo (D45a-4).
    const lab = (text, help, trail) => {
      const l = el('label', null, text);
      if (help) { l.appendChild(iHelp(help)); }
      // D47g: an optional trailing node (the Role character counter) rides the
      // label row, so it never moves when the box below it grows.
      if (trail) { l.appendChild(trail); }
      return l;
    };
    const beh = (checked, text, help, on) => {
      const w = el('div', 'beh');
      const sw = el('label', 'sw');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = checked;
      const tk = el('span', 'tk');
      sw.appendChild(c);
      sw.appendChild(tk);
      c.addEventListener('change', () => on(c.checked));
      w.appendChild(sw);
      w.appendChild(el('span', 'swtxt', text));
      if (help) { w.appendChild(iHelp(help)); }
      return w;
    };

    if (orch.mode === 'academy') {
      const acBox = el('div', 'duo');
      const defModel = String(d.defaultModel || '');
      // Academy members each need their own model ref (no "(same as Plato)"
      // empty option — the parser requires a <conn>:<model> per member).
      let acadModelOptions = (d.modelItems || []).slice();
      if (defModel && !acadModelOptions.some((o) => String(o.value) === defModel)) {
        acadModelOptions = [{ value: defModel, label: defModel }].concat(acadModelOptions);
      }
      const st = orch.academy || {};
      const members = (Array.isArray(st.members) ? st.members : []).map((mem) => ({
        name: String(mem.name || ''),
        kind: mem.kind === 'philosopher' ? 'philosopher' : 'worker',
        model: String(mem.model || ''),
        role: String(mem.role || ''),
        persona: String(mem.persona || ''),
        color: String(mem.color || ''),
        // D47d: guidance is always on, matching Duo (duo.ts hard-codes it).
        // A philosopher with every power off could never act — a costly noop.
        guidance: true,
        pause: Boolean(mem.pause),
        cancel: Boolean(mem.cancel),
        maxInterventions: typeof mem.maxInterventions === 'number' ? mem.maxInterventions : 5,
      }));

      // D47e: the doer is implicit (Duo parity) — the editor shows only
      // philosophers. A starter council seeds two; there is no worker member,
      // so nothing can silently override the doer.
      // Persona: same seed semantics as Duo (D47b) — picking one refills the
      // name/role only while they still equal the previous persona's default.
      // Declared before the seed below, which resolves each persona's role.
      const personaOf = (id) => (orch.personas || []).find((p) => p.id === id) || null;
      const isStarter = members.length === 0;
      const seedDefaultPhilosophers = () => {
        const have = new Set(members.map((x) => x.name));
        for (const id of ['aristotle', 'pythagoras']) {
          if (have.has(id)) continue;
          const p = personaOf(id);
          members.push({
            name: p ? p.name : id, kind: 'philosopher', model: defModel,
            // D47f: seed the role and powers too, so the created file is a
            // complete spec and no field reads blank when it is re-opened.
            role: p ? p.role : '', persona: id, guidance: true, pause: false,
            cancel: false, maxInterventions: 5,
            color: firstUnusedColor(members.map((x) => x.color)),
          });
          have.add(id);
        }
      };
      if (members.filter((x) => x.kind === 'philosopher').length < 2) {
        seedDefaultPhilosophers();
      }
      // D47f: a real default so the field is never a blank box — the starter
      // council is already named, like duo's philosopher is already Aristotle.
      let cname = String(st.name || '') || (isStarter ? 'Lyceum' : '');
      let nameSeq = 1;
      const uniqueName = (base) => {
        if (!members.some((x) => x.name === base)) return base;
        for (let k = nameSeq; k < 1000; k++) {
          const cand = base + '-' + k;
          if (!members.some((x) => x.name === cand)) return cand;
        }
        return base + '-' + (nameSeq++);
      };
      const save = () => {
        vsapi.postMessage({
          type: 'save-academy',
          name: cname.trim(),
          members: members.map((mi) => {
            const o = { name: mi.name, kind: mi.kind, model: mi.model };
            // D47f: store the role the card shows (the persona's, unless it was
            // hand-edited) and the colour, so the file is a complete spec and
            // re-opening it never shows a blank Role field.
            const p = (orch.personas || []).find((x) => x.id === mi.persona);
            const effRole = mi.role || (p ? p.role : '');
            if (effRole) o.role = effRole;
            if (mi.kind === 'philosopher') {
              if (mi.persona) o.persona = mi.persona;
              if (mi.color) o.color = mi.color;
              o.guidance = mi.guidance;
              o.pause = mi.pause;
              o.cancel = mi.cancel;
              o.maxInterventions = mi.maxInterventions;
            }
            return o;
          }),
        });
      };

      // Source-of-truth status tucks behind the "?" next to the title.
      let srcTxt;
      if (st.error) {
        srcTxt = '~/.plato/ACADEMY.yaml has an error (' + st.error + ') - the next change here repairs it.';
      } else if (st.available) {
        srcTxt = 'Editing ~/.plato/ACADEMY.yaml - every change saves it. '
          + 'Plato is the doer; philosophers watch, guide, and may pause or cancel.';
      } else {
        srcTxt = 'No ~/.plato/ACADEMY.yaml yet - changes here create it. '
          + 'A council starts with Plato plus two philosophers.';
      }
      const head = el('div', 'dhead');
      head.appendChild(el('span', 'dt', 'Academy'));

      // Council name is the block's identity, so it sits right after the
      // title. "Lyceum" is the Greek school where a council deliberated.
      const nameIn = el('input');
      nameIn.type = 'text';
      nameIn.className = 'ctl dname';
      // D47f: the starter council is named out of the box; the placeholder
      // repeats the suggestion for a council that was cleared by hand.
      nameIn.value = cname;
      nameIn.placeholder = 'Lyceum';
      nameIn.title = 'Optional. Shown in the header chip when Academy is active.';
      nameIn.addEventListener('change', () => {
        cname = nameIn.value;
        save();
      });
      head.appendChild(nameIn);
      head.appendChild(iHelp(srcTxt));
      head.appendChild(el('span', 'dsp'));
      head.appendChild(sbtn('Open ACADEMY.yaml', () => {
        vsapi.postMessage({ type: 'open-academy' });
      }, 'secondary'));
      acBox.appendChild(head);

      // D47e: the doer is implicit. One control, two views — this row and the
      // composer picker are the same session-wide setting.
      acBox.appendChild(doerRow(
        'The model Plato (the doer) runs on in Academy.'));
      if (isStarter) {
        const b = el('div', 'starter');
        b.textContent = 'No ACADEMY.yaml yet - this is a starter council '
          + '(Aristotle + Pythagoras). Your first change saves it to '
          + '~/.plato/ACADEMY.yaml.';
        acBox.appendChild(b);
      }

      const countEl = el('span', 'dcount', '');
      const paintCount = () => {
        const p = members.filter((x) => x.kind === 'philosopher').length;
        countEl.textContent = p + (p === 1 ? ' philosopher' : ' philosophers');
      };
      paintCount();

      const listEl = el('div');
      const acadPersonaOpts = [{ value: '', label: 'custom (no persona)' }]
        .concat((orch.personas || []).map((p) => ({
          value: p.id, label: p.name + ' - ' + p.epithet,
        })));

      const pushRow = (mi) => {
        // D47f: one shared card builder, identical in Duo and Academy.
        const cur = personaOf(mi.persona);
        const rowOpts = acadModelOptions.some((o) => String(o.value) === mi.model)
          ? acadModelOptions
          : acadModelOptions.concat([{ value: mi.model, label: mi.model }]);
        // D47d: a council keeps at least two philosophers. Rather than disabling
        // Remove (a greyed button invites a click that does nothing), the
        // control is simply not rendered at the floor; the footer states why.
        // D47g: Remove is drawn on EVERY card so the layout never reflows when
        // the count crosses the floor; at 2 it is aria-disabled with a tooltip.
        const canRemove = members.filter((x) => x.kind === 'philosopher').length > 2;
        listEl.appendChild(philosopherCard({
          removeTip: canRemove
            ? 'Remove this philosopher from the council.'
            : 'A council keeps at least two philosophers.',
          hex: colorHex(mi.color),
          name: mi.name,
          namePlaceholder: 'philosopher name',
          canRemove,
          onRename: (v) => { mi.name = v; save(); },
          onRemove: () => {
            const i = members.indexOf(mi);
            if (i >= 0) { members.splice(i, 1); }
            save();
          },
          personaOptions: acadPersonaOpts,
          personaValue: mi.persona || '',
          onPersona: (id, ctl) => {
            const prev = personaOf(mi.persona);
            const next = personaOf(id);
            if (next) {
              if (!mi.role || (prev && mi.role === prev.role)) {
                mi.role = next.role;
                ctl.rIn.value = next.role;
              }
              if (!mi.name || (prev && mi.name === prev.name)) {
                mi.name = next.name;
                ctl.nIn.value = next.name;
              }
            }
            mi.persona = id;
            save();
          },
          role: mi.role || (cur ? cur.role : ''),
          onRoleDraft: (v) => { mi.role = v; save(); },
          roleLabel: 'Role',
          roleHelp: 'Extra instructions for this philosopher, appended to its system prompt.',
          rolePlaceholder: 'role prompt',
          modelOptions: rowOpts,
          modelValue: mi.model,
          modelLabel: 'Model',
          modelHelp: 'Which model this philosopher runs on. Required.',
          onModel: (v) => { mi.model = v; save(); },
          pause: mi.pause,
          onPause: (v) => { mi.pause = v; save(); },
          pauseLabel: 'May pause',
          cancel: mi.cancel,
          onCancel: (v) => { mi.cancel = v; save(); },
          cancelLabel: 'May cancel',
          maxInterventions: mi.maxInterventions,
          onMax: (v) => { mi.maxInterventions = v; save(); },
          capHelp: 'Intervention budget per run for this philosopher (guidance counts). Guidance is always on.',
          powersHelp: 'What this philosopher may do to the run. Guidance is always on, so a philosopher can always speak.',
        }, { lab, beh }));
      };
      // Only philosophers render; the worker (Plato) is implicit, as in Duo.
      members.filter((x) => x.kind === 'philosopher').forEach(pushRow);
      acBox.appendChild(listEl);

      const foot = el('div', 'listfoot');
      const nPhil = () => members.filter((x) => x.kind === 'philosopher').length;
      const addBtn = sbtn('Add philosopher', () => {
        // D47f: default to the first UNUSED persona, so a new philosopher always
        // has a role, a name and a colour — never a blank, actionless card.
        const used = new Set(members.map((x) => x.persona));
        const pick = (orch.personas || []).find((p) => !used.has(p.id)) ||
          (orch.personas || [])[0] || null;
        const p = pick ? personaOf(pick.id) : null;
        members.push({
          name: uniqueName(p ? p.name : 'philosopher'), kind: 'philosopher',
          model: defModel,
          role: p ? p.role : '',
          persona: p ? p.id : '',
          guidance: true, pause: false, cancel: false,
          maxInterventions: 5,
          color: firstUnusedColor(members.map((x) => x.color)),
        });
        save();
      }, 'secondary');
      const capEl = el('span', 'lcount', '');
      const paintFoot = () => {
        // D47g: a permanent statement of the range, never a narration of a
        // control (the old 'remove is available'). The reason a control is off
        // lives in that control's own tooltip and in this line.
        const n = nPhil();
        capEl.textContent = n + ' of 5 philosophers \u00b7 minimum 2';
        addBtn.disabled = n >= 5;
      };
      paintFoot();
      foot.appendChild(addBtn);
      foot.appendChild(capEl);
      acBox.appendChild(foot);
      acBox.appendChild(el('div', 'note',
        'Plato is the doer; each philosopher needs its own model. A council '
        + 'keeps 2 to 5 philosophers, and every philosopher can always speak.'));
      oblock.appendChild(acBox);
    }

    if (orch.mode === 'duo') {
      const duo = el('div', 'duo');
      const dSt = orch.duo || {};
      const raw = dSt.philosopher || {};
      const personas = orch.personas || [];
      const m = {
        persona: String(raw.persona || 'aristotle'),
        name: String(raw.name || ''),
        role: String(raw.role || ''),
        model: String(raw.model || ''),
        color: String(raw.color || ''),
        pause: Boolean(raw.pause),
        cancel: Boolean(raw.cancel),
        maxInterventions: typeof raw.maxInterventions === 'number' ? raw.maxInterventions : 5,
      };
      const personaOf = (id) => personas.find((x) => x.id === id) || null;
      const pn = () => { const p = personaOf(m.persona); return p ? p.name : ''; };
      const pr = () => { const p = personaOf(m.persona); return p ? p.role : ''; };
      const effName = () => (m.name && m.name.trim().length ? m.name : pn());
      const effRole = () => (m.role && m.role.trim().length ? m.role : pr());
      const save = () => {
        vsapi.postMessage({
          type: 'save-duo',
          philosopher: {
            persona: m.persona,
            // Store the effective values — what the form shows — so DUO.yaml
            // reads as a complete spec and the role text is never missing.
            name: effName(),
            role: effRole(),
            model: m.model,
            // D47f: duo's philosopher takes palette slot 1 unless chosen.
            color: m.color || firstUnusedColor([]),
            pause: m.pause,
            cancel: m.cancel,
            maxInterventions: m.maxInterventions,
          },
        });
      };

      let srcTxt;
      if (dSt.error) {
        srcTxt = '~/.plato/DUO.yaml has an error (' + dSt.error + ') - the next change here repairs it.';
      } else if (dSt.source === 'file') {
        srcTxt = 'Editing ~/.plato/DUO.yaml - every change saves it.';
      } else {
        srcTxt = 'No DUO.yaml yet - this is the built-in default (Aristotle). Any change here - or Open DUO.yaml - creates the file.';
      }
      const head = el('div', 'dhead');
      head.appendChild(el('span', 'dt', 'Duo'));
      head.appendChild(iHelp(srcTxt));
      head.appendChild(el('span', 'dsp'));
      head.appendChild(sbtn('Open DUO.yaml', () => {
        vsapi.postMessage({ type: 'open-duo' });
      }, 'secondary'));
      duo.appendChild(head);

      // D47e: the same doer control as Academy — one session-wide model.
      duo.appendChild(doerRow(
        'The model Plato (the doer) runs on in Duo.'));

      // D47f: the SAME card as Academy (one philosophy, one member). Duo keeps
      // its "(same as Plato)" model option — that behaviour difference is
      // deliberate and documented; only the layout is unified.
      const modelOptions = [{ value: '', label: '(same as Plato)' }].concat(d.modelItems || []);
      const duoOpts = modelOptions.some((o) => String(o.value) === m.model)
        ? modelOptions
        : modelOptions.concat([{ value: m.model, label: m.model }]);
      const pOpts = personas.map((p) => ({ value: p.id, label: p.name + ' - ' + p.epithet }));
      duo.appendChild(philosopherCard({
        hex: colorHex(m.color || firstUnusedColor([])),
        name: effName(),
        namePlaceholder: 'display name',
        canRemove: false,
        // Duo has exactly one philosopher (not a bounded list), so it has no
        // Remove button at all.
        showRemove: false,
        onRename: (v) => {
          m.name = (v && v !== pn()) ? v : '';
          save();
        },
        onRemove: () => undefined,
        removeTip: '',
        personaOptions: pOpts,
        personaValue: m.persona,
        onPersona: (id, ctl) => {
          const oldP = personaOf(m.persona);
          m.persona = id;
          // Only a real hand-edit survives a persona change: a blank value — or
          // one still equal to the previous persona's default (DUO.yaml now
          // bakes the effective text) — follows the new persona.
          if (!m.name || !m.name.trim().length || (oldP && m.name === oldP.name)) {
            m.name = '';
            ctl.nIn.value = effName();
          }
          if (!m.role || !m.role.trim().length || (oldP && m.role === oldP.role)) {
            m.role = '';
            ctl.rIn.value = effRole();
          }
          save();
        },
        role: effRole(),
        onRoleDraft: (v) => {
          m.role = (v && v !== pr()) ? v : '';
          save();
        },
        roleLabel: 'Role',
        roleHelp: 'The text the philosopher steers by. Starts from the persona role; edit it to make it your own.',
        rolePlaceholder: 'role prompt',
        modelOptions: duoOpts,
        modelValue: m.model,
        modelLabel: 'Model',
        modelHelp: 'Which model the philosopher runs on. Empty uses the same model as Plato.',
        onModel: (v) => { m.model = v; save(); },
        pause: m.pause,
        onPause: (v) => { m.pause = v; save(); },
        pauseLabel: 'May pause runs',
        cancel: m.cancel,
        onCancel: (v) => { m.cancel = v; save(); },
        cancelLabel: 'May cancel runs',
        maxInterventions: m.maxInterventions,
        onMax: (v) => { m.maxInterventions = v; save(); },
        capHelp: 'The most times this philosopher may act in one run. Guidance notes, pauses, and cancels each count as one. Lower it for a quieter guide.',
        powersHelp: 'What the philosopher is allowed to do to the run.',
      }, { lab, beh }));

      duo.appendChild(el('div', 'note',
        'Guidance is always allowed. Editing the role or display name replaces the persona defaults; clearing them restores the persona.'));
      oblock.appendChild(duo);
    }

    // D47j: this block used to end with secO.appendChild(oblock) followed by
    // wrap.appendChild(secO). Since D47i, oblock IS secOBody and secO is
    // already in the tree, so the appendChild threw "The new child element
    // contains the parent" and aborted the rest of showSettings — which killed
    // the section-preservation restore and the whole Context section.


    // ---- 3. Context (compaction) (collapsed) ----
    const ctxInfo = d.compaction || { mode: 'auto', threshold: 0.8 };
    const secCtxDet = document.createElement('details');
    secCtxDet.className = 'sec';
    secCtxDet.setAttribute('data-sec', 'context');
    secCtxDet.appendChild(el('summary', null, 'Context  \u2014  compaction'));
    const ctxBody = el('div', 'secbody');
    secCtxDet.appendChild(ctxBody);
    wrap.appendChild(secCtxDet);
    ctxBody.appendChild(el('p', 'shelp',
      'Plato compacts automatically once the conversation outgrows the threshold. /compact, or the ring Compact-now button, forces it whenever you want.'));
    // D47i: the header bar names the section; no nested .sblock (see Orchestration).
    const ctxBlock = ctxBody;
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
    // (D47j: no ctxBody.appendChild(ctxBlock) here — ctxBlock IS ctxBody, so
    // that appendChild threw the same "contains the parent" error.)

    // D47j/D47k: restore what the user had open, then their scroll position, so
    // a re-render caused by an action is invisible. Keyed by the stable
    // data-sec id, never the summary text (which carries a live count).
    if (wasOpen) {
      for (const sec of wrap.querySelectorAll('.sec')) {
        const id = sec.getAttribute('data-sec');
        if (!id) { continue; }
        // An always-open section has no "open" property to set; skip it.
        if (sec.tagName === 'DETAILS') { sec.open = wasOpen.has(id); }
      }
      const sb = document.getElementById('sbody');
      if (sb && settingsScroll !== null) { sb.scrollTop = settingsScroll; }
      settingsScroll = null;
    }

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
  // D42d: hover = info only. Clicking the ring pins the full panel
  // (info + compaction controls) open until the ring is clicked
  // again, an outside click lands, or Esc is pressed. Clicks inside
  // the tooltip never toggle the pin (slider drags must not close it).
  const ringWrap = document.querySelector('.ring-wrap');
  if (ringWrap) {
    ringWrap.addEventListener('click', (e) => {
      if (e.target && e.target.closest('#contextBreakdown')) {
        return;
      }
      ringWrap.classList.toggle('pinned');
    });
    document.addEventListener('mousedown', (e) => {
      if (!ringWrap.classList.contains('pinned')) {
        return;
      }
      if (e.target && e.target.closest('.ring-wrap')) {
        return;
      }
      ringWrap.classList.remove('pinned');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ringWrap.classList.contains('pinned')) {
        ringWrap.classList.remove('pinned');
      }
    });
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
  const ctxbTT = document.getElementById('ctxb-tt');
  if (ctxCnow) {
    ctxCnow.addEventListener('click', () => requestCompact());
    // D42h: native title tooltips don't render in the webview, so a
    // custom bubble follows the cursor while hovering the button.
    ctxCnow.addEventListener('mouseenter', () => {
      ctxbTT.classList.add('show');
    });
    ctxCnow.addEventListener('mouseleave', () => {
      ctxbTT.classList.remove('show');
    });
    ctxCnow.addEventListener('mousemove', (e) => {
      // D42i: draw left-center of the cursor so it never clips at
      // VS Code's right edge; clamp within the viewport.
      ctxbTT.style.left =
        Math.max(6, e.clientX - ctxbTT.offsetWidth - 10) + 'px';
      ctxbTT.style.top =
        Math.max(6, e.clientY - ctxbTT.offsetHeight / 2) + 'px';
    });
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
    refreshChip();
  });
  cx.addEventListener('click', () => {
    if (!busy || cx.disabled) { return; }
    cx.disabled = true;
    pp.disabled = true;
    refreshChip();
    vsapi.postMessage({ type: 'cancel' });
  });

  // --- D44c: real slash commands + paperclip attachment -------------------
  // The reserved .future-attach slot (D39) hosts the paperclip, far-left of
  // the composer next to the / command button. Commands are real host
  // actions: picking a row (or a leading '/compact' + Enter) posts slash-run
  // and the host executes it immediately — nothing is inserted into the
  // composer. Attached files render as chips that mirror the host's
  // authoritative pendingAttachments.
  const attachRow = document.getElementById('attachRow');
  const clipBtn = document.getElementById('clip');
  const cmdsBtn = document.getElementById('cmds');
  const slashPop = document.createElement('div');
  slashPop.className = 'popover';
  slashPop.dataset.trigger = 'q';
  slashPop.setAttribute('role', 'listbox');
  let slashCommands = [];       // slash-meta rows from the host
  let slashRows = [];           // rendered rows for keyboard cycling
  let slashActiveIdx = -1;
  let slashRendered = null;     // key last rendered (t'/'b' + filter)
  let slashButtonMode = false;  // menu opened by the / button, not a token

  // The webview script is one giant template literal, so inner regexes must
  // never carry an escaped '/' or '\' (the re-escaped gate text would not
  // parse). Token detection is therefore pure string logic.
  const isTokCh = (ch) => typeof ch === 'string' && ch.length > 0 &&
    ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
     (ch >= '0' && ch <= '9') || ch === '-');
  function slashTokenAt() {
    const up = q.value.slice(0, q.selectionStart);
    const nxt = q.value[q.selectionStart];
    if (nxt && /[A-Za-z0-9]/.test(nxt)) { return null; } // caret mid-word
    // A valid token is a '/word' that ENDS at the caret. Walk back over the
    // token chars to the '/' and confirm it starts at a word boundary.
    let i = up.length - 1;
    while (i >= 0 && isTokCh(up[i])) { i -= 1; }
    if (i < 0 || up[i] !== '/') { return null; }
    const start = i;
    if (start > 0 && isTokCh(up[start - 1])) { return null; } // foo/bar
    return { start: start, wordEnd: up.length };
  }
  // A known command at the very start of the value ('/compact', bare or with
  // trailing text). Ids come from the host's table so this stays in sync.
  function leadingCmd(raw) {
    if (raw.charAt(0) !== '/') { return null; }
    for (const c of slashCommands) {
      const tok = '/' + c.id;
      if (raw.indexOf(tok) !== 0) { continue; }
      const after = raw.charAt(tok.length);
      if (after === '' || !/[A-Za-z0-9]/.test(after)) { return tok; }
    }
    return null;
  }
  function renderCmdPop(filter) {
    slashPop.textContent = '';
    slashRows = [];
    slashActiveIdx = -1;
    for (const c of slashCommands) {
      if (filter && c.id.indexOf(filter) !== 0) { continue; }
      const row = el('div', 'popover-row slash-row');
      row.setAttribute('role', 'option');
      row.dataset.id = c.id;
      row.appendChild(el('span', 'pr-name', c.label));
      row.appendChild(el('span', 'pr-meta', c.usage));
      row.appendChild(el('span', 'pr-sub', c.blurb));
      row.addEventListener('click', () => { runSlash(c.id); });
      slashPop.appendChild(row);
      slashRows.push(row);
    }
  }
  function cycleSlash(dir) {
    if (slashRows.length === 0) { return; }
    if (slashActiveIdx >= 0) { slashRows[slashActiveIdx].classList.remove('active'); }
    slashActiveIdx = (slashActiveIdx + dir + slashRows.length) % slashRows.length;
    slashRows[slashActiveIdx].classList.add('active');
  }
  function closeCmdPop() {
    slashRows = [];
    slashActiveIdx = -1;
    slashRendered = null;
    slashButtonMode = false;
    if (slashPop.classList.contains('open')) { closePopover(slashPop); }
  }
  // What the menu should show right now: a '/…' token under the caret (typed,
  // prefix filter) or the /-button's full list on an untouched box. Returns
  // null when no command menu is wanted (close).
  function desiredCmd() {
    const trimmed = q.value.trim();
    const hit = trimmed ? slashTokenAt() : null;
    if (hit) {
      const body = q.value.slice(hit.start, hit.wordEnd).slice(1).toLowerCase();
      const match = body === '' ||
        slashCommands.some((c) => c.id.indexOf(body) === 0);
      if (match) { return { filter: body, viaToken: true }; }
    } else if (slashButtonMode) {
      return { filter: '', viaToken: false };
    }
    return null;
  }
  // Open the menu or refresh its filter. When the state is unchanged and the
  // menu is already up, do NOT re-render — re-rendering on every keyup was
  // snapping the highlight back to the first row and breaking the Arrow keys.
  function syncCmdPop() {
    const d = desiredCmd();
    if (d === null) { closeCmdPop(); return; }
    const key = (d.viaToken ? 't' : 'b') + d.filter;
    if (slashPop.classList.contains('open') && slashRendered === key) { return; }
    slashButtonMode = !d.viaToken;
    renderCmdPop(d.filter);
    if (slashRows.length > 0) { slashRows[0].classList.add('active'); slashActiveIdx = 0; }
    slashRendered = key;
    const w = Math.min(q.clientWidth, 560);
    slashPop.style.width = w + 'px';
    slashPop.style.maxWidth = w + 'px';
    // Re-anchor every time (open or refresh): row height changes as the
    // filter narrows, so the top edge needs recomputing against the textarea.
    openPopover(slashPop, q, { up: true, leftEdge: true });
  }
  // Run a picked command: hand it to the host now. Only a box that actually
  // holds '/command' text is cleared — a prose draft opened via the / button
  // is left intact so running a command never eats the user's message.
  function runSlash(id) {
    if (!slashCommands.some((c) => c.id === id)) { return; }
    closeCmdPop();
    if (q.value.trim() && q.value.charAt(0) === '/') { q.value = ''; }
    q.focus();
    vsapi.postMessage({ type: 'slash-run', id: id });
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  // Attachment chips (UI mirror only - the host stays authoritative).
  //
  // D49o: an image chip is a GLYPH plus its size, not a thumbnail. A thumbnail
  // would mean posting the whole file as a data: URI — there is no resize
  // anywhere in the pipeline — so a 3 MB screenshot would become a 4 MB
  // message to render a 16px box, and it would need img-src in the CSP. The
  // name and the size are what the user actually checks before sending.
  function addChip(a) {
    const path = String(a.path || '');
    const chip = el('div', 'attach-chip');
    if (a.image) {
      const glyph = el('span', 'ac-img', '▣');
      glyph.title = 'image';
      chip.appendChild(glyph);
    }
    const name = el('span', 'ac-name',
      a.image && a.size ? path + '  ' + fmtBytes(Number(a.size)) : path);
    const x = document.createElement('button');
    x.className = 'ac-x';
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + path);
    x.textContent = '×';
    x.addEventListener('click', () => {
      if (chip.parentNode) { chip.parentNode.removeChild(chip); }
      if (!attachRow.hasChildNodes()) { attachRow.hidden = true; }
      vsapi.postMessage({ type: 'attach-remove', path: path });
    });
    chip.appendChild(name);
    chip.appendChild(x);
    attachRow.appendChild(chip);
    attachRow.hidden = false;
  }
  function clearChips() {
    attachRow.textContent = '';
    attachRow.hidden = true;
  }
  // q: live command menu + empty-wipe cleanup. A send clears chips locally
  // only; attach-clear is posted solely here (no-send wipe), so attachments
  // that rode in on an ask are never double-cleared.
  q.addEventListener('input', () => {
    slashButtonMode = false;
    if (!q.value.trim()) {
      clearChips();
      vsapi.postMessage({ type: 'attach-clear' });
    }
    syncCmdPop();
  });
  q.addEventListener('keyup', syncCmdPop);
  q.addEventListener('click', syncCmdPop);
  // The / button opens the full menu. stopPropagation on mousedown keeps the
  // global click-outside handler from pre-closing it before this click runs.
  cmdsBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  cmdsBtn.addEventListener('click', () => {
    if (slashPop.classList.contains('open')) { closeCmdPop(); return; }
    slashButtonMode = true;
    syncCmdPop();
    q.focus();
  });
  clipBtn.addEventListener('click', () => {
    if (busy) { return; }
    vsapi.postMessage({ type: 'attach' });
  });

  q.addEventListener('keydown', (e) => {
    if (slashPop.classList.contains('open')) {
      // While the command menu is up, the arrows move the highlight and
      // Enter/Tab runs the highlighted command; nothing reaches ask().
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cycleSlash(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const active = slashPop.querySelector('.popover-row.active');
        if (active && active.dataset.id) { runSlash(active.dataset.id); }
        return;
      }
      if (e.key === 'Escape') { return; } // global handler closes + refocuses
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });

  function ask() {
    if (!hasConnections) {
      // D43: nothing to send to yet — route to provider onboarding.
      requestSettings();
      return;
    }
    const raw = q.value;
    if (!raw.trim()) { return; }
    // D44c: a message that starts with a known command runs it NOW (idle or
    // mid-run) instead of sending text — commands are real host actions.
    const lead = leadingCmd(raw);
    if (lead) { runSlash(lead.slice(1)); return; }
    if (busy) { sendGuidance(); return; }
    const text = raw.trim();
    addMsg('you', 'You', text);
    clearChips();           // local only - the host consumes on ask
    q.value = '';
    busy = true;
    runT0 = Date.now();
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
    const parts = Array.from(counts.entries())
      .map((p) => p[0] + ' \u00d7 ' + p[1]);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const text = total + (total === 1 ? ' tool call \u00b7 ' : ' tool calls \u00b7 ')
      + parts.join(' \u00b7 ');
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
          duo: m.duo,
          academy: m.academy,
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
        // D47h: the host is authoritative when it names the effective model.
        // The webview's own closure state is only a cache; without this the
        // panel can show a value the run is not using (e.g. the doer select
        // echoing a value the host rejected).
        if (typeof m.effectiveModel === 'string' && m.effectiveModel.length > 0
            && m.effectiveModel !== currentModel) {
          const authoritative = lastModelItems.find(
            (it) => String(it.value || '') === m.effectiveModel);
          setModelSelected(
            m.effectiveModel,
            authoritative ? String(authoritative.label) : m.effectiveModel,
            authoritative ? authoritative.maxContext : null,
          );
        }
        // Reasoning control (D28 phase 2): visible only for capable models.
        rsel.hidden = !m.reasoningCapable;
        if (typeof m.reasoning === 'string') {
          rsel.value = m.reasoning;
        }
        // If the popover is currently open, re-render it to reflect
        // the new pool.
        if (modelPop.classList.contains('open')) { renderModelPop(); }
        // D43: keep the empty composer state in sync with the
        // connection count (fallback: infer from the pool).
        applyEmptyState(typeof m.hasConnections === 'boolean'
          ? m.hasConnections : lastModelItems.length > 0);
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
      case 'settings':
        // D49u: keep the chat-side connection flag in step with the provider
        // list. It used to be set ONLY by the models/restore payloads, so adding
        // a provider left it stale at false — and the model button routes to
        // Settings when it believes there are none, which bounced the user
        // straight back out of the chat they had just returned to.
        if (Array.isArray(m.connections)) {
          applyEmptyState(m.connections.length > 0);
        }
        // D49v: render it if the page is already open (a refresh), or if the
        // host says this payload ANSWERS a request to see it. Any other settings
        // payload is a background refresh, and moving the view for one is how
        // the chat used to get yanked away mid-click right after a provider was
        // added — a model fetch finishing late is enough to do it.
        if (m.open === true || document.body.classList.contains('show-settings')) {
          showSettings(m);
        }
        break;
      case 'history': showHistory(m); break; // D42b: pass the full payload (m.runs dropped m.chats)
      case 'run': showRun(m); break;
      case 'title': setTitle(String(m.text || '')); break;
      case 'slash-meta': slashCommands = m.commands || []; break;
      case 'proj-files': {
        // D45a-2: empty-composer answer — noRoot or a present rule file hides
        // the secondary "Set up this project's rules" card.
        projMissing = m.noRoot ? false : !m.present;
        const pc = document.getElementById('projCard');
        if (pc) { pc.hidden = !projMissing; }
        break;
      }
      case 'attach-result':
        for (const a of m.accepted || []) { addChip(a); }
        for (const r of m.rejected || []) {
          addMsg('sys', 'Plato', 'Attachment refused: ' + r.path + ' — ' + r.error);
        }
        break;
      case 'restore':
        document.body.classList.remove('show-settings', 'show-history');
        render(m.log);
        // D40: restore the conversation title with the log.
        if (typeof m.title === 'string') setTitle(m.title);
        // D39: restore the chat's prior model selection. If the value
        // is in the current pool, setModelSelected will refresh the
        // label and maxContext; otherwise it stays as a closure var
        // and renderModelPop will show it as an "offline" fallback.
        // D43: with no connections there is nothing to restore — the
        // models payload already set the "connect a provider" label.
        if (typeof m.model === 'string' && m.model && hasConnections) {
          const found = lastModelItems.find(
            (it) => String(it.value || '') === m.model);
          if (found) {
            setModelSelected(String(found.value), String(found.label),
                             found.maxContext);
          } else {
            setModelSelected(m.model, m.model, null);
          }
        }
        // D43: empty-composer state rides the same restore payload.
        applyEmptyState(typeof m.hasConnections === 'boolean'
          ? m.hasConnections : true);
        break;
      case 'md': flushToolBuffer(); streamHtml(String(m.text || '')); refreshChip(); setStatus('writing'); break;
      case 'turn': {
        // Turn boundary: commit the ongoing stream into a finished block so
        // the next turn and any intervening notices/logos land in order.
        const el = document.getElementById('streaming');
        if (el) { el.removeAttribute('id'); }
        streaming = false;
        break;
      }
      case 'notice': {
        flushToolBuffer();
        // D47f: a philosopher notice carries its colour, so [aristotle] and
        // [pythagoras] in the log are told apart at a glance.
        const hex = m.meta && m.meta.color ? String(m.meta.color) : '';
        const div = addMsg(hex ? 'philosopher' : 'sys', 'Plato', m.text);
        if (hex) {
          div.style.setProperty('--accent', hex);
          div.querySelector('.who').textContent = '';
          div.insertBefore(colorDot('pdot', hex), div.firstChild);
        }
        break;
      }
      case 'team': flushToolBuffer(); showTeam(m); break;
      case 'tool':
        // Only completed calls count; pending/denied phases stay in the chip.
        if (m.phase === 'done') {
          toolBuffer.push({ tool: m.tool, phase: m.phase });
          scheduleToolFlush();
        }
        refreshChip();
        setStatus('using ' + m.tool);
        break;
      case 'approval':
        flushToolBuffer();
        showCard(m);
        refreshChip();
        setStatus('waiting for your approval');
        break;
      case 'user-question':
        flushToolBuffer();
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
      case 'compact': addCompactBanner(t.text); break;
    }
  }

  // D44d: a fold replaced older turns with a summary; show it as a banner.
  function addCompactBanner(text) {
    const div = document.createElement('div');
    div.className = 'msg compact';
    const head = document.createElement('div');
    head.className = 'cc-head';
    head.textContent = 'Earlier conversation compacted';
    const body = document.createElement('div');
    body.className = 'cc-body';
    body.textContent = text;
    div.appendChild(head);
    div.appendChild(body);
    log.appendChild(div);
    scroll();
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
      if (mem.color) { row.style.setProperty('--accent', String(mem.color)); }
      const left = document.createElement('span');
      left.className = 'tm-name';
      if (mem.color) { left.appendChild(colorDot('tdot', String(mem.color))); }
      // textContent-style append keeps the name adjacent to the dot.
      left.appendChild(document.createTextNode(mem.name));
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
    // D49p: an approval covers one host, so the card says which. "Approve all
    // web_fetch" would read as covering every future host, which is exactly
    // what it must not do.
    const what = typeof m.host === 'string' && m.host ? m.host : m.tool;
    const yes = document.createElement('button');
    yes.textContent = 'Allow once';
    const all = document.createElement('button');
    all.textContent = 'Approve all requests to ' + what + ' this session';
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
      vsapi.postMessage({
        type: 'approve-all',
        tool: m.tool,
        sessionKey: m.sessionKey,
      });
      actions.remove();
      h.textContent = h.textContent.replace('?', ' — approved for session');
      addMsg('you', 'You', '[approved all requests to ' + what + ' this session]');
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

  // D47g: a Role box fits its text plus one line, and the lines the text needs
  // depend on the PANEL WIDTH. Watching width only (not size) is essential:
  // a fit changes the box's own height, and a size-observer would loop on it.
  let roleFitW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === roleFitW) { return; }
    roleFitW = window.innerWidth;
    fitAllRoles();
  });

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
