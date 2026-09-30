import { prepareHtml, resolvePlaywright, TMP_DIR, join, readFileSync } from './harness.mjs';

// D49ba: the view is a plain script with no imports, so the tool-word table and
// the approval copy reach it from the HOST — which, in these suites, is this
// file. They are imported from core's BUILT output rather than restated, because
// a second copy of a table is the fault the table exists to fix. `tsc -b` runs
// before every render run, so the built output is current.
const core = await import('../../packages/core/dist/src/index.js');
export const toolWordsForView = core.toolWordsForView;
export const approvalHeading = core.approvalHeading;
export const approvalAllowAll = core.approvalAllowAll;
export const approvalAnswered = core.approvalAnswered;
export const approvalAnsweredSession = core.approvalAnsweredSession;

/** The message the host sends at ready. Every suite that draws tool words needs it. */
export const TOOL_WORDS_MSG = { type: 'tool-words', words: core.toolWordsForView() };

const { chromium } = await import(resolvePlaywright());

// One build per RUN. run.mjs prepares once, up front, and exports
// PLATO_RENDER_PREPARED=1 so the six child processes do not each rebuild.
// A suite run on its own (node scripts/render/core.mjs) still prepares itself.
if (process.env['PLATO_RENDER_PREPARED'] !== '1') { prepareHtml(); }

export const HTML_PATH = join(TMP_DIR, 'wv.html');
export function html() { return readFileSync(HTML_PATH, 'utf8'); }

const CONNS = [{ id: 'litellm', kind: 'openai', baseUrl: 'https://ai.applivity.com/llm/v1', models: new Array(9).fill('m'), all: new Array(9).fill('m'), keyStatus: 'set', builtin: false }];
const BASE = {
  type: 'settings', open: true, modelItems: [], presets: [], connections: CONNS,
  defaultModel: '', workers: { noRoot: false, plato: 'global', agentsFile: null },
  orchestration: { mode: 'solo', personas: [], colors: [], roleMaxChars: 1000, duo: {}, academy: { available: false, name: '', members: [], error: '' } },
  compaction: { mode: 'auto', threshold: 0.8 },
  // D49bc: the built-in protected names, as the host sends them — taken from
  // core so a suite cannot pass against a list the product no longer has.
  secrets: { builtin: [...core.SECRET_DENYLIST], extra: [], allow: [] },
};
export const S = (over) => ({ ...BASE, ...(over || {}) });

// --- Academy fixtures (used by the core + narrow suites) ------------------
export const PERSONAS = [
  { id: 'aristotle', name: 'Aristotle', epithet: 'the empiricist', role: 'You judge only from evidence in the digest. Flag claims made without verification, conclusions drawn without observation, and changes the worker did not re-check after applying. Cite the specific tool event or reply text that concerns you.' },
  { id: 'pythagoras', name: 'Pythagoras', epithet: 'the geometer', role: 'You check structure, symmetry, and correctness: types, counts, invariants, repeated patterns. Intervene when the numbers do not add up — mismatched lists, off-by-one logic, inconsistent shapes.' },
  { id: 'thales', name: 'Thales', epithet: 'the first look', role: 'You do a light first-pass review. Flag only clear, obvious mistakes.' },
  { id: 'diogenes', name: 'Diogenes', epithet: 'the Cynic', role: 'You are blunt and economical.' },
  { id: 'heraclitus', name: 'Heraclitus', epithet: 'the watcher of change', role: 'You watch what is changing.' },
];
export const COLOR_IDS = ['violet', 'blue', 'teal', 'amber', 'rose'];
export const COLOR_HEX = ['#b48ad4', '#7fa8d9', '#5fb3a1', '#d9a441', '#d98a9e'];
const MODEL = 'anthropic:claude-sonnet-4-5';
const members = (n) => PERSONAS.slice(0, n).map((p, i) => ({
  name: p.name, kind: 'philosopher', model: MODEL, role: p.role, persona: p.id,
  color: COLOR_IDS[i], guidance: true, pause: false, cancel: false, maxInterventions: 5,
}));
/** The mode+count payload the older suites expect: S('academy', 3). */
export const academyS = (mode, n) => S({
  modelItems: [{ value: MODEL, label: 'Claude Sonnet 4.5' }], defaultModel: MODEL,
  orchestration: {
    mode, personas: PERSONAS,
    colors: COLOR_IDS.map((id, i) => ({ id, hex: COLOR_HEX[i] })),
    roleMaxChars: 1000,
    duo: { source: 'default', name: '', error: '', philosopher: { persona: 'aristotle', name: '', role: '', model: '', color: 'violet', pause: false, cancel: false, maxInterventions: 5 } },
    academy: { available: true, name: 'Lyceum', error: '', members: members(n) },
  },
});

export const b = await chromium.launch();
export const counters = { fail: 0 };
export const check = (n, ok, x) => {
  if (ok) { console.log('OK  ', n); } else { counters.fail++; console.log('FAIL', n, JSON.stringify(x)); }
};

export async function page(w, payload) {
  const p = await b.newPage({ viewport: { width: w, height: 1700 } });
  // D47j: an uncaught error in showSettings ABORTS the rest of the render, so a
  // page error must fail the run loudly. One silent appendChild-into-its-own-
  // parent killed the Context section and the section restore for a whole pass.
  p.__errors = [];
  p.on('pageerror', (e) => { p.__errors.push(String(e.message)); });
  p.on('console', (m) => { if (m.type() === 'error') { p.__errors.push(m.text()); } });
  await p.route('**/*', (r) => (r.request().url().endsWith('/plato.html')
    ? r.fulfill({ contentType: 'text/html', body: html() }) : r.abort()));
  await p.addInitScript(() => {
    window.__posted = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__posted.push(m); } });
  });
  await p.goto('http://localhost/plato.html');
  await p.waitForFunction(() => !!document.getElementById('gear'));
  if (payload) {
    await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), payload);
    await p.waitForTimeout(320);
  }
  return p;
}
export const openAll = (p) => p.evaluate(() => {
  for (const d of document.querySelectorAll('details.sec')) { d.open = true; }
}).then(() => p.waitForTimeout(180));

/** Every section that must exist on the Settings page. */
export const expectSections = ['Providers', 'Orchestration', 'Context', 'Protected files'];
export const checkPageClean = (p, tag) => {
  check(tag + ': no uncaught page errors', p.__errors.length === 0, p.__errors);
};
export async function checkSections(p, tag) {
  const titles = await p.evaluate(() => [...document.querySelectorAll('#sbody details.sec, #sbody .sec-static')]
    .map((d) => (d.querySelector('summary, .sechead') || {}).textContent.trim()));
  const ok = expectSections.every((want) => titles.some((t) => t.startsWith(want)));
  check(tag + ': every section rendered', ok, titles);
}

/**
 * D49a: end a suite so a failed assertion FAILS THE PROCESS.
 *
 * Before this, `check()` only logged. Every suite ended with a bare
 * `console.log(... PASS/FAIL ...)` and no suite set `process.exitCode`, so a
 * suite printing "FAIL: 12" still exited 0 — and run.mjs, which decides on exit
 * status alone, printed ALL RENDER SUITES PASS. The individual OK/FAIL lines on
 * stdout were the only real signal, and they scroll away.
 *
 * Every suite must end by calling this. Do not close the browser or print the
 * verdict by hand: that is how the two counters diverged in the first place.
 */
export async function finish(tag) {
  console.log(counters.fail === 0
    ? 'PASS: ' + tag
    : 'FAIL: ' + tag + ' — ' + counters.fail + ' assertion(s) failed');
  await b.close();
  process.exitCode = counters.fail === 0 ? 0 : 1;
}
