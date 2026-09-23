import { check, page, openAll, S, checkPageClean, checkSections, finish } from './plib.mjs';

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
// 6. The key is entered INLINE (D47l), not via a native dialog.
{
  const p = await page(720, S());
  await openAll(p);
  const r = await p.evaluate(() => {
    const card = document.querySelector('.conn');
    const row = card.querySelector('.keyrow');
    const input = card.querySelector('.keyrow .keyinput');
    const setBtn = [...card.querySelectorAll('.crow .btn')].find((x) => /Set key/.test(x.textContent));
    return {
      rowExists: !!row,
      hiddenFirst: row.hidden,
      inputType: input ? input.type : null,
      hasSave: !![...card.querySelectorAll('.keyrow .btn')].find((x) => /Save key/.test(x.textContent)),
      hasCancel: !![...card.querySelectorAll('.keyrow .btn')].find((x) => /Cancel/.test(x.textContent)),
      ariaExpanded: setBtn ? setBtn.getAttribute('aria-expanded') : null,
      // The old path must be gone from the card.
      stillPostsNativesettingsKey: null,
    };
  });
  check('key field is hidden until Set key is pressed', r.rowExists && r.hiddenFirst === true, r);
  check('key field is a password input', r.inputType === 'password', r);
  check('the inline row has Save key and Cancel', r.hasSave && r.hasCancel, r);
  check('Set key reports aria-expanded=false initially', r.ariaExpanded === 'false', r);

  // Press Set key -> the row opens, focused.
  await p.evaluate(() => {
    const card = document.querySelector('.conn');
    [...card.querySelectorAll('.crow .btn')].find((x) => /Set key/.test(x.textContent)).click();
  });
  await p.waitForTimeout(150);
  const opened = await p.evaluate(() => {
    const card = document.querySelector('.conn');
    return {
      hidden: card.querySelector('.keyrow').hidden,
      focused: document.activeElement === card.querySelector('.keyrow .keyinput'),
      expanded: [...card.querySelectorAll('.crow .btn')].find((x) => /Set key/.test(x.textContent)).getAttribute('aria-expanded'),
      height: Math.round(card.querySelector('.keyrow').getBoundingClientRect().height),
    };
  });
  check('pressing Set key opens the inline row', opened.hidden === false && opened.height > 20, opened);
  check('the field takes focus', opened.focused === true, opened);
  check('aria-expanded flips to true', opened.expanded === 'true', opened);

  // Type a key and press Enter -> posts settings-set-key, never settings-key.
  await p.evaluate(() => {
    const input = document.querySelector('.conn .keyrow .keyinput');
    input.value = 'sk-live-123';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await p.waitForTimeout(150);
  const sent = await p.evaluate(() => (window.__posted || []).filter((m) => /settings-(set-)?key/.test(m.type)));
  check('Enter posts settings-set-key with the value',
    sent.length === 1 && sent[0].type === 'settings-set-key' && sent[0].connId === 'litellm' && sent[0].apiKey === 'sk-live-123',
    sent);
  check('the native settings-key message is NOT used', !sent.some((m) => m.type === 'settings-key'), sent);
  const cleared = await p.evaluate(() => document.querySelector('.conn .keyrow .keyinput').value);
  check('the field is cleared after sending (secret not left in the DOM)', cleared === '', cleared);

  // Escape closes and clears.
  await p.evaluate(() => {
    const card = document.querySelector('.conn');
    [...card.querySelectorAll('.crow .btn')].find((x) => /Set key/.test(x.textContent)).click();
  });
  await p.waitForTimeout(120);
  await p.evaluate(() => {
    const input = document.querySelector('.conn .keyrow .keyinput');
    input.value = 'typing';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await p.waitForTimeout(120);
  const esc = await p.evaluate(() => {
    const card = document.querySelector('.conn');
    return { hidden: card.querySelector('.keyrow').hidden, value: card.querySelector('.keyrow .keyinput').value };
  });
  check('Escape closes the row and clears the field', esc.hidden === true && esc.value === '', esc);

  // The section must survive the host reply after saving a key.
  await p.evaluate(() => {
    const card = document.querySelector('.conn');
    [...card.querySelectorAll('.crow .btn')].find((x) => /Set key/.test(x.textContent)).click();
  });
  await p.waitForTimeout(120);
  const before = await p.evaluate(() => document.querySelector('details.sec').open);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), S());
  await p.waitForTimeout(340);
  const after = await p.evaluate(() => [...document.querySelectorAll('details.sec')].map((d) => d.open));
  check('Providers stays OPEN after a key save reply', before === true && after[0] === true, { before, after });
  await p.close();
}


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

// 8. The mode picker describes the MODE, not the file behind it. "Academy" used
// to read "(from .plato/ACADEMY.yaml)" — a path in a one-line description the
// user never acts on, and the path is wrong at a glance (it lives in ~/.plato/).
// Assert the requirement: no mode description names a file.
{
  const p = await page(720, ACAD);
  await openAll(p);
  const mods = await p.evaluate(() => [...document.querySelectorAll('.mcard')].map((c) => ({
    title: (c.querySelector('.mtitle') || {}).textContent || '',
    desc: (c.querySelector('.mdesc') || {}).textContent || '',
  })));
  const bad = mods.filter((m) => /\.ya?ml|plato\//i.test(m.desc));
  check('no mode description names a config file', bad.length === 0, bad);
  const acad = mods.find((m) => m.title === 'Academy') || {};
  check('Academy description is the mode, not a path',
    acad.desc === 'Plato + a council of philosophers.', acad);
  await p.close();
}

console.log('');
// D49t: the Settings model list is ONE model per line — name over its context
// window — not two columns of bare, truncated names. This is the list the
// founder was looking at when he reported it unchanged; the composer's picker is
// a different surface and was fixed separately.
{
  const CONN = {
    id: 'litellm', kind: 'openai', baseUrl: 'https://llm.example/v1',
    keyStatus: 'set', builtin: false,
    // D49z: ONE list. Every fetched model is eligible, so there is no ticked
    // subset beside it to disagree with.
    models: [
      'Auto-Act',
      'openrouter-dots-studio/dots-3-note-preview-free',
      'claude-sonnet-5',
      'mystery-model',
    ],
    // Resolved server-side through the same rule the run uses.
    ctx: { 'Auto-Act': 163840, 'openrouter-dots-studio/dots-3-note-preview-free': 1000000, 'claude-sonnet-5': 200000 },
  };
  const p = await page(720, S({ connections: [CONN] }));
  await openAll(p);
  await p.evaluate(() => {
    const d = document.querySelector('.conn .picker');
    if (d) d.open = true;
  });
  await p.waitForTimeout(200);

  const r = await p.evaluate(() => {
    const box = document.querySelector('.conn .modellist');
    const rows = [...document.querySelectorAll('.conn .mopt')];
    const cs = box ? getComputedStyle(box) : null;
    return {
      rows: rows.length,
      columns: cs ? cs.gridTemplateColumns : '(not a grid)',
      display: cs ? cs.display : null,
      // D49z: nothing in this list is a control any more. The tick boxes and
      // their OK/Cancel were the only way a model could be made ineligible.
      boxes: document.querySelectorAll('.conn .modellist input').length,
      buttons: document.querySelectorAll('.conn .modellist button').length,
      summary: (document.querySelector('.conn .picker > summary') || {}).textContent,
      cursor: rows.length > 0 ? getComputedStyle(rows[0]).cursor : null,
      items: rows.map((row) => {
        const n = row.querySelector('.mopt-name');
        const s = row.querySelector('.mopt-sub');
        return {
          name: n ? n.textContent : null,
          sub: s ? s.textContent : null,
          stacked: !!(n && s) &&
            s.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1,
        };
      }),
    };
  });

  check('the list is one column, not a two-column grid', r.display === 'block', r);
  check('every fetched model gets a row', r.rows === 4, r.rows);
  check('no model can be ticked out of availability', r.boxes === 0, r);
  check('there is nothing to confirm, so there are no OK/Cancel buttons',
    r.buttons === 0, r);
  check('the summary counts what is available, it does not claim an active subset',
    r.summary === 'Models — 4 available', r.summary);
  check('an inert row does not pretend to be clickable',
    r.cursor !== 'pointer', r.cursor);
  check('each row shows a name and a context subtitle',
    r.items.every((x) => x.name && x.sub), r.items);
  check('the name sits above the subtitle',
    r.items.every((x) => x.stacked), r.items);
  check('a million reads 1M here too',
    r.items.some((x) => x.sub === '1M context'), r.items);
  check('a long id gets the full width of the row',
    r.items.some((x) => x.name === 'openrouter-dots-studio/dots-3-note-preview-free'), r.items);
  check('an unreported window says so rather than guessing',
    r.items.some((x) => x.sub === 'context unknown'), r.items);
  checkPageClean(p, 'settings model list');
  await p.close();
}


// D49u: the sequence the founder hit — install with NO providers, add one in
// Settings, return to the chat, click the model dropdown. It used to bounce
// straight back to Settings, because the chat-side "are there any providers"
// flag was only ever set by the models/restore payloads and adding a provider
// sends a `settings` payload instead.
{
  const p = await page(720, S({ connections: [] }));
  // 1. A chat with no providers: the flag is false.
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  { type: 'models', hasConnections: false, items: [], orchestration: 'solo', compaction: { mode: 'auto', threshold: 0.8 } });
  await p.waitForTimeout(160);
  // 2. The user adds a provider in Settings. Only a `settings` payload arrives.
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  S({ connections: [{ id: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-5'], all: ['claude-opus-5'], ctx: { 'claude-opus-5': 1000000 }, keyStatus: 'set', builtin: false }] }));
  await p.waitForTimeout(200);
  // 3. Back to the chat, then open the model dropdown.
  await p.evaluate(() => {
    const b = document.getElementById('sback');
    if (b) b.click();
  });
  await p.waitForTimeout(140);
  await p.evaluate(() => { window.__posted = []; });
  await p.evaluate(() => document.getElementById('modelBtn').click());
  await p.waitForTimeout(200);

  const r = await p.evaluate(() => ({
    posted: window.__posted.map((x) => x.type),
    settingsOpen: document.body.classList.contains('show-settings'),
  }));
  check('selecting a model does not bounce the user back to Settings',
    !r.posted.includes('openSettings'), r);
  check('and the chat stays on screen', r.settingsOpen === false, r);
  checkPageClean(p, 'provider added');
  await p.close();
}


// D49v: a `settings` payload must not drag the user out of the chat. The host
// sends one after ANY connection change — including a model fetch that
// completes a network round trip after the user has already moved on — and
// every such payload used to call showSettings unconditionally.
{
  const C = { id: 'litellm', kind: 'openai', baseUrl: 'https://llm.example/v1',
              models: ['m'], all: ['m'], keyStatus: 'set', builtin: false };
  const p = await page(720, S({ connections: [C] }));
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  { type: 'models', hasConnections: true, items: [], orchestration: 'solo', compaction: { mode: 'auto', threshold: 0.8 } });
  await p.waitForTimeout(160);
  await p.evaluate(() => { const b = document.getElementById('sback'); if (b) b.click(); });
  await p.waitForTimeout(140);
  const inChat = await p.evaluate(() => document.body.classList.contains('show-settings'));
  check('the user is in the chat to begin with', inChat === false, inChat);

  // The unprompted payload — a model fetch finishing, a key re-read, anything.
  // Explicitly NOT the reply to a request, which is the whole distinction.
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  { ...S({ connections: [C] }), open: false });
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => document.body.classList.contains('show-settings'));
  check('an unprompted settings payload does NOT move the user to Settings',
    after === false, after);
  checkPageClean(p, 'unprompted settings');
  await p.close();
}

await finish('providers row');
