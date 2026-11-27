import { check, page, finish, checkPageClean, S, TOOL_WORDS_MSG } from './plib.mjs';

/**
 * D49fg: the tool chain.
 *
 * A real reader said the filled chip took his eye before the answer did, so the
 * line is now plain muted text with a chevron, and the calls behind it open on
 * a click. This suite is the witness for what a person SEES and can DO: the
 * fill is gone, the type is smaller than the prose, the detail is closed until
 * asked for, and every row says what the call touched and how long it took.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const scene = (p) => p.evaluate(() => {
  const btn = document.querySelector('.msg.tool-summary');
  const det = document.querySelector('.tool-detail');
  const bot = document.querySelector('.msg.bot');
  if (!btn || !det) return null;
  const cs = getComputedStyle(btn);
  const chev = btn.querySelector('.chev');
  const chevSvg = chev ? chev.querySelector('svg') : null;
  const chevBox = chev ? chev.getBoundingClientRect() : null;
  const firstGlyph = det.querySelector('.tool-row .g');
  const rows = [...det.querySelectorAll('.tool-row')].map((r) => {
    const part = (c) => {
      const el = r.querySelector('.' + c);
      return el ? el.textContent.trim() : '';
    };
    return { glyph: part('g'), words: part('w'), what: part('d'), time: part('t') };
  });
  return {
    tag: btn.tagName,
    text: btn.textContent,
    expanded: btn.getAttribute('aria-expanded'),
    typed: cs.fontSize,
    prose: bot ? getComputedStyle(bot).fontSize : '',
    background: cs.backgroundColor,
    borderLeft: cs.borderLeftWidth,
    hidden: det.hidden,
    rows,
    // D49fs: one drawn arrow that turns, at a size a reader can see.
    chev: chevBox ? { w: chevBox.width, h: chevBox.height } : null,
    chevTurn: chevSvg ? getComputedStyle(chevSvg).transform : null,
    // D49ft: the tick at 11px read as a speck.
    glyphType: firstGlyph ? getComputedStyle(firstGlyph).fontSize : '',
  };
});

const transparent = (bg) =>
  bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || /,\s*0\)$/.test(bg);

/**
 * The word table reaches the view from the HOST, and in a suite this file is
 * the host. Without it every tool falls back to "tool call", which is exactly
 * what one of these assertions is watching for.
 */
const openPage = async () => {
  const p = await page(760, S({ open: false }));
  await post(p, TOOL_WORDS_MSG);
  return p;
};

const CALLS = [
  { tool: 'read_file', digest: 'src/pricing/Pricing.java', ms: 420 },
  { tool: 'read_file', digest: 'src/pricing/Plan.java', ms: 310 },
  { tool: 'shell', digest: './gradlew test --tests PricingTest', ms: 12600 },
];

{
  const p = await openPage();
  await post(p, { type: 'md', text: '<p>I will read the pricing code first.</p>' });
  await post(p, { type: 'turn' });
  for (const c of CALLS) {
    await post(p, { type: 'tool', phase: 'done', ok: true, ...c });
  }
  await p.waitForTimeout(700); // the buffer flushes 500ms after the last event

  const a = await scene(p);
  check('the chain is one line', a !== null && a.text.length > 0, a);

  check('the line is a real button, and it starts CLOSED',
    a.tag === 'BUTTON' && a.expanded === 'false' && a.hidden === true, a);

  check('the fill and the accent bar are gone',
    transparent(a.background) && a.borderLeft === '0px',
    { background: a.background, borderLeft: a.borderLeft });

  check('the line is smaller than the prose it sits between',
    parseFloat(a.typed) < parseFloat(a.prose),
    { line: a.typed, prose: a.prose });

  check('the line counts calls and adds up the time',
    a.text === '3 calls · 2 files read · 1 command run · 13.3s', a.text);

  check('nothing is behind the line until it is asked for',
    a.rows.length === 3 && a.hidden === true, a.rows);

  // D49fs: the arrow is drawn, not typed — the old pair of text glyphs read as
  // punctuation at 10.5px and the open one looked stretched.
  check('the line carries a chevron a reader can see',
    a.chev !== null && a.chev.w >= 12 && a.chev.h >= 12, a.chev);
  check('and it starts unturned', a.chevTurn === 'none', a.chevTurn);

  // Open it. A person clicks the line, not the chevron.
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(180);
  const b = await scene(p);
  check('a click opens it, and says so',
    b.hidden === false && b.expanded === 'true', b);
  check('and the SAME arrow turns to point down, rather than a second glyph',
    b.chevTurn !== null && b.chevTurn !== 'none' && /matrix/.test(b.chevTurn),
    b.chevTurn);

  check('one row per call, in the order they ran',
    b.rows.length === 3
      && b.rows[0].what === 'src/pricing/Pricing.java'
      && b.rows[2].what === './gradlew test --tests PricingTest',
    b.rows);

  check('the row glyph is large enough to read, not a speck',
    parseFloat(b.glyphType) >= 13, b.glyphType);

  check('each row names the call in words, never the tool name',
    b.rows.every((r) => r.words === 'file read' || r.words === 'command run'),
    b.rows);

  check('each row says how long it took',
    b.rows[0].time === '420ms' && b.rows[2].time === '12.6s', b.rows);

  check('each row is marked with how it ended',
    b.rows.every((r) => r.glyph === '✓'), b.rows);

  // Close, then open with the keyboard: the point of it being a button.
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(120);
  check('a second click closes it again', (await scene(p)).hidden === true);

  await p.focus('.msg.tool-summary');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(120);
  check('the keyboard opens it too', (await scene(p)).hidden === false);

  checkPageClean(p, 'tool chain');
  await p.close();
}

// A chain that merges: consecutive calls must not draw a new line each.
{
  const p = await openPage();
  await post(p, { type: 'tool', phase: 'done', ok: true, tool: 'read_file', digest: 'a.txt', ms: 100 });
  await p.waitForTimeout(650);
  await post(p, { type: 'tool', phase: 'done', ok: true, tool: 'read_file', digest: 'b.txt', ms: 100 });
  await p.waitForTimeout(650);
  const lines = await p.evaluate(
    () => document.querySelectorAll('.msg.tool-summary').length,
  );
  const text = await p.evaluate(
    () => (document.querySelector('.msg.tool-summary') || {}).textContent || '',
  );
  check('consecutive calls stay on ONE line', lines === 1, lines);
  check('and that line counts both', text === '2 calls · 2 files read · 200ms', text);
  checkPageClean(p, 'merged chain');
  await p.close();
}

// A declined request joins the chain but is never counted as a call that ran.
{
  const p = await openPage();
  await post(p, { type: 'tool', phase: 'declined', tool: 'shell', digest: './gradlew clean' });
  await post(p, { type: 'tool', phase: 'done', ok: true, tool: 'read_file', digest: 'a.txt', ms: 250 });
  await p.waitForTimeout(700);
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(120);
  const s = await scene(p);
  check('a declined request is not counted as a call that ran',
    s.text === '1 call · 1 file read · 250ms', s.text);
  check('but it is shown, and it says who stopped it',
    s.rows.length === 2 && s.rows[0].time === 'you declined', s.rows);
  checkPageClean(p, 'declined chain');
  await p.close();
}

// A failed call is marked, and never claims a success glyph.
{
  const p = await openPage();
  await post(p, { type: 'tool', phase: 'done', ok: false, tool: 'read_file', digest: 'build/R.java', ms: 90 });
  await p.waitForTimeout(700);
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(120);
  const s = await scene(p);
  check('a failed call is marked as failed',
    s.rows[0].glyph === '✕' && s.rows[0].time === 'failed', s.rows);
  checkPageClean(p, 'failed chain');
  await p.close();
}

// A reload draws the same chain: the rows come from the record, not from memory.
{
  const p = await openPage();
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), {
    type: 'restore',
    hasConnections: true,
    title: '',
    log: [
      { k: 'msg', cls: 'bot', who: 'Plato', text: 'Reading the pricing code.' },
      { k: 'tool', tool: 'read_file', phase: 'done', ok: true, digest: 'src/pricing/Pricing.java', ms: 420 },
      { k: 'tool', tool: 'shell', phase: 'done', ok: true, digest: './gradlew test', ms: 12600 },
    ],
  });
  await p.waitForTimeout(400);
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(120);
  const s = await scene(p);
  check('a reloaded chain opens to the same rows',
    s.rows.length === 2
      && s.rows[0].what === 'src/pricing/Pricing.java'
      && s.rows[1].time === '12.6s',
    s);
  check('and keeps the line\'s time',
    s.text === '2 calls · 1 file read · 1 command run · 13.0s', s.text);
  checkPageClean(p, 'reloaded chain');
  await p.close();
}

// A record written before timing existed shows no time at all — not a zero.
{
  const p = await openPage();
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), {
    type: 'restore',
    hasConnections: true,
    title: '',
    log: [
      { k: 'tool', tool: 'read_file', phase: 'done', ok: true, digest: 'src/A.java' },
      { k: 'tool', tool: 'read_file', phase: 'done', ok: true, digest: 'src/B.java' },
    ],
  });
  await p.waitForTimeout(400);
  const s = await scene(p);
  check('a record with no timing shows no figure',
    s.text === '2 calls · 2 files read', s.text);
  check('and its rows carry no time either',
    s.rows.every((r) => r.time === ''), s.rows);
  checkPageClean(p, 'untimed chain');
  await p.close();
}

// An open chain must stay open while the run carries on. The field window
// showed a chain closed again after a later click, and whether that is the
// product or the harness had to be settled here rather than guessed.
{
  const p = await openPage();
  await post(p, { type: 'tool', phase: 'done', ok: true, tool: 'read_file', digest: 'a.txt', ms: 100 });
  await post(p, { type: 'tool', phase: 'done', ok: true, tool: 'read_file', digest: 'b.txt', ms: 100 });
  await p.waitForTimeout(700);
  await p.click('.msg.tool-summary');
  await p.waitForTimeout(120);
  await post(p, { type: 'md', text: '<p>A later reply.</p>' });
  await post(p, { type: 'done', text: { secs: 2, tools: 2 } });
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => {
    const det = document.querySelector('.tool-detail');
    return det ? det.hidden : null;
  });
  check('an open chain stays open when the run carries on', after === false, after);

  await p.click('.msg-copy');
  await p.waitForTimeout(200);
  const afterCopy = await p.evaluate(() => {
    const det = document.querySelector('.tool-detail');
    return det ? det.hidden : null;
  });
  check('and a copy click does not close it', afterCopy === false, afterCopy);
  checkPageClean(p, 'chain stays open');
  await p.close();
}

console.log('');
await finish('toolchain');
