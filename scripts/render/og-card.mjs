/**
 * The social card — 1200 × 630, generated rather than drawn by hand.
 *
 * The card that shipped on 2026-10-23 had its footer baked into pixels:
 * "VS Code & terminal". The Visual Studio host arrived five days later and the
 * card could not know it. Nothing in the HTML could be grepped to find the
 * staleness, and nothing warned anyone. This script exists so that the claim
 * lives in a string in this file, where a search finds it and a re-run fixes
 * it. (The same rule as D49co, applied to text inside an image.)
 *
 *   node scripts/render/og-card.mjs [--out <file>]
 *
 * Default output: tmp/og/og.png. The website copies it to assets/og.png.
 *
 * The right half is not a mock: it is the product's own webview, drawn by
 * scripts/render/plib.mjs with the same markup, CSS and drawing code the
 * extension ships. The left half is the site's own type: Newsreader for the
 * headline, IBM Plex Sans for the subhead, IBM Plex Mono for the footer.
 *
 * Alt text the page should carry (og:image:alt), so a stale image fails
 * loudly against an auditable description:
 *   "The Plato social card: 'Plato does the work. Philosophers keep it
 *    honest.' above the address plato.applivity.com and the line 'By
 *   Applivity · VS Code, Visual Studio & the terminal', beside the chat
 *    panel mid-task in Duo mode with a philosopher's guidance notice."
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolvePlaywright, prepareHtml, TMP_DIR, REPO_ROOT, join } from './harness.mjs';

// plib is NOT imported: its module body launches a second browser and keeps the
// process alive after the card is written. The two values needed are cheap.
const core = await import('../../packages/core/dist/src/index.js');
const TOOL_WORDS_MSG = { type: 'tool-words', words: core.toolWordsForView() };
const html = () => readFileSync(join(TMP_DIR, 'wv.html'), 'utf8');

// --banner draws the 3:1 X profile banner instead of the 1200 x 630 card.
// Same composition, re-laid-out: every text pixel inside the central
// 1200 x 400 that a phone crops to, and nothing in the bottom-left where
// the avatar circle sits. It is a SEPARATE file on purpose — assets/og.png
// is also the site's social card and index.html declares its geometry.
const BANNER = process.argv.includes('--banner');

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  if (i >= 0) return process.argv[i + 1];
  return join(TMP_DIR, 'og', BANNER ? 'x-banner.png' : 'og.png');
})();
const WORK = join(TMP_DIR, 'og');
mkdirSync(WORK, { recursive: true });

// The one string that goes stale. Change the hosts here, re-run, done.
const HOSTS = 'VS Code, Visual Studio & the terminal';
// The banner's own host row: a glyph and its word per host, middle dots between
// pairs. Vendor icons are not an option — Microsoft's brand page forbids using
// or redrawing the VS Code mark to promote another product — so these three are
// drawn from scratch as line marks on one 16-unit grid, one stroke weight, one
// corner radius. Each suggests a host without depicting any product: a split
// pane with a text cursor, a window with a raised tab and a docked side pane,
// and a prompt caret with a block cursor. Each mark carries one accent, taken
// from the banner's own palette; labels stay neutral so the eye goes mark, then
// word. The terminal accent is the site's pale ice, not a third saturated hue,
// so the row reads as a set and not as a warning light.
const HOST_MARKS = [
  {
    label: 'VS Code',
    accent: '#3FC1D4',
    marks: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>'
      + '<path d="M8.5 2.5v11"/>'
      + '<path d="M3.9 5.4h1.6M3.9 10.6h1.6M4.7 5.4v5.2"/>',
  },
  {
    // The raised tab is the silhouette: an editor pane and an IDE differ at
    // small size by outline, not by interior lines, which turn to mush.
    label: 'Visual Studio',
    accent: '#D9A441',
    marks: '<rect x="0.5" y="3" width="15" height="10.5" rx="1.4"/>'
      + '<path d="M9.8 3V1.4h4.2V3M9.8 3v10.5"/>',
  },
  {
    label: 'terminal',
    accent: '#CFE9EC',
    marks: '<path d="M3 4.6 6.8 8 3 11.4"/>'
      + '<path d="M9.2 10.2h3.6" style="stroke-width:2"/>',
  },
];
const SITE = 'plato.applivity.com';
// The mark: the website's tile when its working tree is beside this repo,
// otherwise the extension's own source mark. Override with PLATO_OG_OWL.
const OWL = process.env['PLATO_OG_OWL']
  ?? (existsSync('/Users/ai/Desktop/plato-website/assets/owl-tile.svg')
    ? '/Users/ai/Desktop/plato-website/assets/owl-tile.svg'
    : join(REPO_ROOT, 'packages/vscode/media/plato.svg'));
const MODEL = 'anthropic:claude-sonnet-4-5';
const MODEL_LABEL = 'Claude Sonnet 4.5';

if (!existsSync(join(TMP_DIR, 'wv.html'))) { prepareHtml(); }
const { chromium } = await import(resolvePlaywright());
const browser = await chromium.launch();

// --- the panel: the real webview, mid-run, in Duo --------------------------
const THEME = `
:root {
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --vscode-editor-font-family: Menlo, Monaco, "Courier New", monospace;
  --vscode-editor-background: #1F1F1F;
  --vscode-editor-foreground: #CCCCCC;
  --vscode-foreground: #CCCCCC;
  --vscode-descriptionForeground: #9D9D9D;
  --vscode-focusBorder: #0078D4;
  --vscode-button-background: #0078D4;
  --vscode-button-foreground: #FFFFFF;
  --vscode-button-hoverBackground: #026EC1;
  --vscode-button-secondaryBackground: #313131;
  --vscode-button-secondaryForeground: #CCCCCC;
  --vscode-input-background: #313131;
  --vscode-input-foreground: #CCCCCC;
  --vscode-input-border: #3C3C3C;
  --vscode-editorWidget-background: #202020;
  --vscode-editorWidget-border: #454545;
  --vscode-editorWidget-foreground: #CCCCCC;
  --vscode-textCodeBlock-background: #2B2B2B;
  --vscode-textLink-foreground: #4daafc;
  --vscode-errorForeground: #F85149;
  --vscode-editorWarning-foreground: #CCA700;
  --vscode-testing-iconPassed: #73c991;
  --vscode-charts-blue: #4daafc;
  --vscode-list-hoverBackground: #2A2D2E;
}
`;

const TASK = 'Add a retry with backoff to the upload call in src/upload.ts, and update its tests.';

const LOG = [
  { k: 'msg', cls: 'you', who: 'You', text: TASK },
  { k: 'tool', tool: 'read_file', phase: 'done' },
];

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const panel = await (async () => {
  // The panel is always CAPTURED at 780x488, whatever the layout: that is the
  // height at which the whole exchange fits, including the philosopher's
  // guidance. The banner only DISPLAYS it smaller, so it must not re-capture
  // at its own size or the guidance falls below the fold.
  const ctx = await browser.newContext({ viewport: { width: 780, height: 488 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message)));
  await p.route('**/*', (r) => (r.request().url().endsWith('/plato.html')
    ? r.fulfill({ contentType: 'text/html', body: html() }) : r.abort()));
  await p.addInitScript(() => {
    window.acquireVsCodeApi = () => ({ postMessage: () => {} });
  });
  await p.goto('http://localhost/plato.html');
  await p.waitForFunction(() => !!document.getElementById('gear'));
  await p.addStyleTag({ content: THEME });
  await post(p, TOOL_WORDS_MSG);
  await post(p, {
    type: 'models',
    hasConnections: true,
    items: [{ value: MODEL, label: MODEL_LABEL, maxContext: 200000 }],
    // The chip is drawn from this, exactly as the host sends it.
    orchestration: 'duo',
    duo: { name: 'Diogenes' },
    compaction: { mode: 'auto', threshold: 0.8 },
  });
  await post(p, { type: 'restore', log: LOG, title: 'Retry the upload call', mode: 'edit', model: MODEL, hasConnections: true });
  // A live run: send from the composer so the controls really appear.
  await p.evaluate((t) => {
    const q = document.getElementById('q');
    q.value = t;
    q.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Go ahead.');
  await p.evaluate(() => document.getElementById('go').click());
  await p.waitForTimeout(250);
  for (const tool of ['read_file', 'apply_diff', 'apply_diff', 'read_file']) {
    await post(p, { type: 'tool', tool, phase: 'done' });
  }
  await post(p, {
    type: 'md',
    text: 'The retry goes at the call site, so the body is never rebuilt between attempts.\n',
  });
  await post(p, {
    type: 'notice',
    text: '[Diogenes] guidance: One call site. Keep withRetry beside upload().',
    meta: { color: '#d9a441' },
  });
  await post(p, { type: 'tool', tool: 'apply_diff', phase: 'pending' });
  await p.waitForTimeout(8000);
  await p.evaluate(() => { const l = document.getElementById('log'); if (l) l.scrollTop = 0; });
  await p.waitForTimeout(300);
  const file = join(WORK, 'panel.png');
  await p.screenshot({ path: file });
  await ctx.close();
  if (errors.length) { throw new Error('panel page error: ' + errors.join('; ')); }
  return file;
})();

// --- the card --------------------------------------------------------------
const panelB64 = execFileSync('base64', ['-i', panel], { encoding: 'utf8' }).replace(/\s+/g, '');

// Geometry for the two layouts. The card's numbers are the shipped ones and
// must not move; the banner's keep every text pixel inside x 150-1350,
// y 50-450 and leave the bottom-left clear for the avatar circle.
const L = BANNER
  ? {
      W: 1500, H: 500,
      glow: 'radial-gradient(900px 620px at 0% 0%, #112027 0%, rgba(12,17,19,0) 66%)',
      brand: { left: 170, top: 54, img: 34, font: 24 },
      headline: { left: 168, top: 124, size: 44, line: 48 },
      // The banner has no sub-headline: the headline makes the claim and the
      // panel shows the interruption. The card keeps its own (below).
      sub: null,
      // The host row is the banner's third visual element, so it is built at
      // display size. Its width is bounded on the right by the chat panel at
      // x 700: a row that ran past that would be painted under it.
      hosts: { left: 170, top: 319, size: 23, glyph: 40, gap: 8, dot: 8 },
      // 640x400 keeps the capture's 780x488 aspect and sits inside x<=1350.
      panel: { left: 700, top: 50, w: 640, h: 400 },
      foot: null,
      url: true,
    }
  : {
      W: 1200, H: 630,
      glow: 'radial-gradient(700px 520px at 0% 0%, #112027 0%, rgba(12,17,19,0) 66%)',
      brand: { left: 56, top: 52, img: 38, font: 26 },
      headline: { left: 57, top: 136, size: 56, line: 60 },
      sub: { left: 60, top: 396, width: 452, size: 19.5, line: 27 },
      panel: { left: 519, top: 128, w: 598, h: 374 },
      foot: { left: 60, top: 548 },
      hosts: null,
      url: false,
    };

const CARD = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${L.W}px; height: ${L.H}px; overflow: hidden; position: relative;
    background: #0C1113; color: #EEF1F0;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .glow { position: absolute; inset: 0; background: ${L.glow}; }
  .brand {
    position: absolute; left: ${L.brand.left}px; top: ${L.brand.top}px;
    display: flex; align-items: center; gap: 12px;
  }
  .brand img { width: ${L.brand.img}px; height: ${L.brand.img}px; display: block; }
  .brand span { font-family: "Newsreader", Georgia, serif; font-size: ${L.brand.font}px; letter-spacing: -0.01em; }
  .brand .url {
    font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12.5px;
    color: #7E8F92; letter-spacing: 0; margin-left: 6px;
  }
  .headline {
    position: absolute; left: ${L.headline.left}px; top: ${L.headline.top}px;
    font-family: "Newsreader", Georgia, serif; font-weight: 400;
    font-size: ${L.headline.size}px; line-height: ${L.headline.line}px; letter-spacing: -0.022em;
  }
  .headline em { font-style: italic; color: #3FC1D4; }
  .sub {
    position: absolute; left: ${L.sub ? L.sub.left : 0}px; top: ${L.sub ? L.sub.top : 0}px; width: ${L.sub ? L.sub.width : 0}px;
    font-size: ${L.sub ? L.sub.size : 0}px; line-height: ${L.sub ? L.sub.line : 0}px; color: #B9C6C8;
  }
  .panel {
    position: absolute; left: ${L.panel.left}px; top: ${L.panel.top}px;
    width: ${L.panel.w}px; height: ${L.panel.h}px;
    border-radius: 7px; overflow: hidden;
    box-shadow: 0 30px 70px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.05);
  }
  .panel img { display: block; width: ${L.panel.w}px; height: ${L.panel.h}px; }
  .foot {
    position: absolute; left: ${L.foot ? L.foot.left : 0}px; top: ${L.foot ? L.foot.top : 0}px;
    display: flex; align-items: center;
    gap: 10px; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px;
    color: #7E8F92;
  }
  .pill {
    background: #CFE9EC; color: #0B6A78; padding: 6px 10px; border-radius: 4px;
    font-size: 12.5px; letter-spacing: .01em;
  }
  .sep { color: #4A5A5E; }
  .hosts {
    position: absolute; left: ${L.hosts ? L.hosts.left : 0}px; top: ${L.hosts ? L.hosts.top : 0}px;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    font-size: ${L.hosts ? L.hosts.size : 0}px; line-height: 1; letter-spacing: .015em; color: #A9B8BB;
    display: ${L.hosts ? 'flex' : 'none'}; align-items: center;
  }
  .hosts .host { display: inline-flex; align-items: center; white-space: nowrap; }
  .hosts svg {
    width: ${L.hosts ? L.hosts.glyph : 0}px; height: ${L.hosts ? L.hosts.glyph : 0}px;
    margin-right: ${L.hosts ? L.hosts.gap : 0}px; display: block;
    fill: none; stroke: currentColor; stroke-width: 1.2;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .hosts .dot { color: #3FC1D4; padding: 0 ${L.hosts ? L.hosts.dot : 0}px; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="brand"><img src="data:image/svg+xml;base64,${Buffer.from(await readFile(OWL)).toString('base64')}"><span>Plato</span>${
    L.url ? `<span class="url">${SITE}</span>` : ''
  }</div>
  <div class="headline">Plato does the<br>work.<br><em>Philosophers</em> keep it<br>honest.</div>
  ${L.sub ? '<div class="sub">A second reader goes over every step as it happens and can interrupt, pause, or stop the run.</div>' : ''}
  <div class="hosts">${HOST_MARKS.map((h) => `<span class="host"><svg viewBox="0 0 16 16" aria-hidden="true" style="color:${h.accent}">${h.marks}</svg>${h.label}</span>`).join('<span class="dot">·</span>')}</div>
  <div class="panel"><img src="data:image/png;base64,${panelB64}"></div>
  ${
    L.foot
      ? `<div class="foot"><span class="pill">${SITE}</span><span class="sep">·</span><span>By Applivity</span><span class="sep">·</span><span>${HOSTS}</span></div>`
      : ''
  }
</body></html>`;

const ctx = await browser.newContext({ viewport: { width: L.W, height: L.H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.setContent(CARD, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() => ({
  serif: document.fonts.check('64px Newsreader'),
  sans: document.fonts.check('20px "IBM Plex Sans"'),
  mono: document.fonts.check('13px "IBM Plex Mono"'),
}));
if (!fonts.serif || !fonts.sans || !fonts.mono) {
  throw new Error('web fonts did not load: ' + JSON.stringify(fonts));
}
const big = join(WORK, BANNER ? 'x-banner@2x.png' : 'og@2x.png');
await page.screenshot({ path: big });
await browser.close();

// Supersample to the exact size the OG tags (or X) declare.
mkdirSync(dirname(OUT), { recursive: true });
execFileSync('sips', ['-z', String(L.H), String(L.W), big, '--out', OUT], { stdio: 'ignore' });
const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', OUT], { encoding: 'utf8' });
if (!new RegExp(`pixelWidth: ${L.W}`).test(dims) || !new RegExp(`pixelHeight: ${L.H}`).test(dims)) {
  throw new Error('wrong size: ' + dims);
}
console.log('wrote', OUT, `${L.W}x${L.H}`);
if (L.foot) console.log('footer:', `${SITE} · By Applivity · ${HOSTS}`);
else console.log('banner: host row', HOST_MARKS.map((h) => h.label).join(' · '), `(${L.hosts.left},${L.hosts.top})`);
