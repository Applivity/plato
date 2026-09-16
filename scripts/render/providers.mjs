import { b, check, page, openAll, S, counters, checkPageClean, checkSections } from './plib.mjs';

const MDL = 'a:b';
const ACAD = S({
  orchestration: {
    mode: 'academy',
    personas: [{ id: 'aristotle', name: 'Aristotle', epithet: 'e', role: 'R' }],
    colors: [{ id: 'violet', hex: '#b48ad4' }], roleMaxChars: 1000, duo: {},
    academy: { available: true, name: 'Lyceum', error: '', members: [{ name: 'Aristotle', kind: 'philosopher', model: MDL, role: 'R', persona: 'aristotle', color: 'violet', guidance: true, pause: false, cancel: false, maxInterventions: 5 }] },
  },
});

// 0. The page must render cleanly: every section present, no uncaught errors.
// A silent appendChild failure used to abort showSettings, killing Context and
// the section restore, and NOTHING in the harness noticed.
for (const w of [420, 900]) {
  const p = await page(w, S());
  await openAll(p);
  await checkSections(p, 'w=' + w);
  checkPageClean(p, 'w=' + w);
  await p.close();
}
// 0b. "Add connection" must not close the section (D47k). The host replies with
// a fresh settings payload, exactly like Set key / Refresh models, so the same
// preserve-and-restore has to cover this third door into the same re-render.
{
  const p = await page(720, S({ connections: [] }));
  const state = () => p.evaluate(() => [...document.querySelectorAll('details.sec')]
    .map((d) => ({ t: d.querySelector('summary').textContent.trim(), open: d.open })));
  await p.evaluate(() => {
    const d = document.querySelector('details.sec');
    d.open = true;
    const sel = d.querySelector('.add-card select');
    if (sel) { sel.value = 'openai'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    const inputs = [...d.querySelectorAll('.add-card input')];
    const url = inputs.find((i) => /Base URL|http/i.test(i.placeholder || ''));
    if (url) { url.value = 'https://api.example.com/v1'; }
    const key = inputs.find((i) => i.type === 'password');
    if (key) { key.value = 'sk-test'; }
  });
  await p.waitForTimeout(150);
  const before = await state();
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.add-card .btn')].find((x) => /Add connection/.test(x.textContent));
    btn.click();
  });
  await p.waitForTimeout(150);
  const posted = await p.evaluate(() => (window.__posted || []).filter((m) => m.type === 'settings-add').length);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), S());
  await p.waitForTimeout(340);
  const after = await state();
  check('add connection: the form posted settings-add', posted === 1, posted);
  check('add connection: Providers stays OPEN',
    before.find((x) => /Providers/.test(x.t)).open === true
    && after.find((x) => /Providers/.test(x.t)).open === true, { before, after });
  await p.close();
}



// 1. Delete is a labelled button on ONE line, at every width.
for (const w of [420, 560, 720, 900]) {
  const p = await page(w, S());
  await openAll(p);
  const r = await p.evaluate(() => {
    const d = [...document.querySelectorAll('.conn .crow .btn')].find((x) => /Delete/.test(x.textContent));
    if (!d) { return null; }
    const cs = getComputedStyle(d);
    const box = d.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height), lineH: parseFloat(cs.lineHeight), nowrap: cs.whiteSpace, text: d.textContent, cls: d.className };
  });
  check('w=' + w + ' Delete is a labelled button, not the 24px icon', r && r.w >= 50, r);
  check('w=' + w + ' Delete stays on ONE line', r && r.h <= r.lineH * 2.2 && r.nowrap === 'nowrap', r);
  check('w=' + w + ' Delete does not carry btn-icon', r && !/btn-icon/.test(r.cls), r && r.cls);
  await p.close();
}

// 2. The Remove icon must STILL be the 24px square (the other danger shape).
{
  const p = await page(720, ACAD);
  const r = await p.evaluate(() => {
    const x = document.querySelector('.mrow .btn-danger');
    if (!x) { return null; }
    const box = x.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height), text: x.textContent, cls: x.className };
  });
  check('Remove icon is still a 24px square with an X glyph',
    r && r.w === 24 && r.h === 24 && r.text === '\u2715' && /btn-icon/.test(r.cls), r);
  await p.close();
}

// 3. A re-render must NOT close an open section (the Set key / Refresh bug).
{
  const p = await page(720, S());
  await p.evaluate(() => { document.querySelector('details.sec').open = true; });
  await p.waitForTimeout(150);
  const state = () => p.evaluate(() => [...document.querySelectorAll('details.sec')]
    .map((d) => ({ t: d.querySelector('summary').textContent.trim(), open: d.open })));
  const before = await state();
  // The host replies to settings-key / settings-fetch with a fresh payload.
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), S());
  await p.waitForTimeout(340);
  const after = await state();
  const pb = before.find((x) => /Providers/.test(x.t));
  const pa = after.find((x) => /Providers/.test(x.t));
  check('Providers stays OPEN across a re-render', pb.open === true && pa.open === true, { before, after });
  check('a section left CLOSED stays closed', after.find((x) => /Context/.test(x.t)).open === false, after);
  await p.close();
}

// 4. First render still applies the defaults (no providers -> Providers opens).
{
  const p = await page(720, S({ connections: [] }));
  const r = await p.evaluate(() => [...document.querySelectorAll('details.sec')]
    .map((d) => ({ t: d.querySelector('summary').textContent.trim(), open: d.open })));
  check('first run with no providers still opens Providers', r.find((x) => /Providers/.test(x.t)).open === true, r);
  await p.close();
}

// 5. Delete needs TWO clicks: the first arms, the second deletes.
{
  const p = await page(720, S());
  await openAll(p);
  const clickDel = async () => {
    await p.evaluate(() => {
      const d = [...document.querySelectorAll('.conn .crow .btn')].find((x) => /Delete|Confirm/.test(x.textContent));
      d.click();
    });
    await p.waitForTimeout(140);
  };
  await clickDel();
  const armed = await p.evaluate(() => {
    const d = [...document.querySelectorAll('.conn .crow .btn')].find((x) => /Delete|Confirm/.test(x.textContent));
    return { text: d.textContent, armed: d.classList.contains('is-armed'), posted: (window.__posted || []).filter((m) => m.type === 'settings-delete').length };
  });
  check('first click ARMS without deleting', armed.armed === true && /Confirm/.test(armed.text) && armed.posted === 0, armed);
  await clickDel();
  const done = await p.evaluate(() => ({
    text: ([...document.querySelectorAll('.conn .crow .btn')].find((x) => /Delete|Confirm/.test(x.textContent)) || {}).textContent,
    posted: (window.__posted || []).filter((m) => m.type === 'settings-delete').length,
  }));
  check('second click actually deletes', done.posted === 1 && done.text === 'Delete', done);
  await p.close();
}

console.log(counters.fail === 0 ? '\nPASS: providers row' : '\nFAIL: ' + counters.fail);
await b.close();
