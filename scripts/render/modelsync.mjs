import { prepareHtml, resolvePlaywright, TMP_DIR, join, readFileSync } from './harness.mjs';
const { chromium } = await import(resolvePlaywright());

const html = readFileSync(join(TMP_DIR, 'wv.html'), 'utf8');
const ITEMS = [
  { value: 'anthropic:claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'openai:gpt-5', label: 'GPT-5' },
];
const P = [{ id: 'aristotle', name: 'Aristotle', epithet: 'the empiricist', role: 'R1' }];
const M = [{ name: 'Aristotle', kind: 'philosopher', model: 'anthropic:claude-sonnet-4-5', role: 'R1', persona: 'aristotle', color: 'violet', guidance: true, pause: false, cancel: false, maxInterventions: 5 }];
const D = { source: 'default', name: '', error: '', philosopher: { persona: 'aristotle', name: '', role: '', model: '', color: 'violet', pause: false, cancel: false, maxInterventions: 5 } };
const models = (eff) => ({
  type: 'models', hasConnections: true, items: ITEMS, effectiveModel: eff,
  reasoningCapable: true, reasoning: 'off', orchestration: 'duo', duo: D,
  academy: { available: true, name: 'Lyceum', error: '', members: M },
  compaction: { mode: 'auto', threshold: 0.8 },
});
const settings = (mode) => ({
  type: 'settings', modelItems: ITEMS, defaultModel: 'anthropic:claude-sonnet-4-5',
  connections: [], presets: [],
  workers: { noRoot: false, plato: 'global', agentsFile: null },
  orchestration: { mode, personas: P, colors: [{ id: 'violet', hex: '#b48ad4' }], roleMaxChars: 1000, duo: D, academy: { available: true, name: 'Lyceum', error: '', members: M } },
  compaction: { mode: 'auto', threshold: 0.8 },
});

const b = await chromium.launch();
let fail = 0;
const check = (n, ok, x) => { if (ok) { console.log('OK  ', n); } else { fail++; console.log('FAIL', n, JSON.stringify(x)); } };

for (const echo of ['legacy', 'authoritative']) {
  for (const mode of ['duo', 'academy']) {
    const p = await b.newPage({ viewport: { width: 620, height: 1400 } });
    await p.route('**/*', (r) => (r.request().url().endsWith('/plato.html')
      ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort()));
    await p.addInitScript(() => {
      window.__posted = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__posted.push(m); } });
    });
    await p.goto('http://localhost/plato.html');
    await p.waitForFunction(() => !!document.getElementById('gear'));
    const echoOf = (eff) => { const m = models(eff); if (echo === 'legacy') { delete m.effectiveModel; } return m; };
    await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), echoOf('anthropic:claude-sonnet-4-5'));
    await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), settings(mode));
    await p.waitForTimeout(280);
    const tag = echo + '/' + mode;

    const before = await p.evaluate(() => (document.querySelector('.doer-model') || {}).value);
    check(tag + ': starts at the effective model', before === 'anthropic:claude-sonnet-4-5', before);

    await p.evaluate(() => {
      const s = document.querySelector('.doer-model');
      s.value = 'openai:gpt-5';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForTimeout(120);
    const posted = await p.evaluate(() => (window.__posted || []).filter((m) => m.type === 'model'));
    check(tag + ': posted the new model', posted.length === 1 && posted[0].value === 'openai:gpt-5', posted);

    await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), echoOf('openai:gpt-5'));
    await p.waitForTimeout(180);
    const afterDoer = await p.evaluate(() => document.querySelector('.doer-model').value);
    check(tag + ': doer select HOLDS the new model after the host echo', afterDoer === 'openai:gpt-5', afterDoer);
    const composerLabel = await p.evaluate(() => document.querySelector('.model-btn-label').textContent);
    check(tag + ': composer label followed the doer select', composerLabel === 'GPT-5', composerLabel);

    if (echo === 'authoritative') {
      await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), echoOf('anthropic:claude-sonnet-4-5'));
      await p.waitForTimeout(160);
      const adopted = await p.evaluate(() => document.querySelector('.doer-model').value);
      check(tag + ': adopts a host-authoritative model', adopted === 'anthropic:claude-sonnet-4-5', adopted);
    }
    await p.close();
  }
}
console.log(fail === 0 ? '\nPASS: model sync' : '\nFAIL: ' + fail);
await b.close();
