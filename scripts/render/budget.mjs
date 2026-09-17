import { check, page, openAll, checkPageClean, S, finish } from './plib.mjs';

/**
 * D49h: the run-budget row in Settings → Context, DRIVEN rather than eyeballed.
 * The control is typed into and its change event fired for real, then the
 * message the webview posts to the host is read back — so this covers the
 * handler wiring, not just that some markup rendered.
 */
const ROW = '#sbody .budget-input';

const read = (p) => p.evaluate((sel) => {
  const inp = document.querySelector(sel);
  if (!inp) { return { found: false }; }
  const row = inp.closest('.row');
  const lab = row ? row.querySelector('label') : null;
  const live = row ? row.querySelector('.liveval') : null;
  return {
    found: true,
    type: inp.type,
    value: inp.value,
    label: lab ? lab.textContent.trim() : null,
    live: live ? live.textContent.trim() : null,
  };
}, ROW);

const setBudget = async (p, v) => {
  await p.fill(ROW, String(v));
  await p.evaluate((sel) => {
    document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true }));
  }, ROW);
  await p.waitForTimeout(120);
};

{
  const p = await page(720, S({ budget: { usd: 2.5 } }));
  checkPageClean(p, 'budget');
  await openAll(p);

  const r = await read(p);
  check('the budget row renders in Context', r.found === true, r);
  check('it is a number input', r.type === 'number', r);
  check('it shows the value the host sent', r.value === '2.5', r);
  check('it is labelled "Run budget"', r.label === 'Run budget', r);
  check('the live label spells out the cap', r.live === 'stops at $2.50 (estimated)', r);

  await setBudget(p, 4);
  const posted = await p.evaluate(() => (window.__posted || []).filter((m) => m.type === 'set-budget'));
  check('changing it posts set-budget with the number',
    posted.length === 1 && posted[0].value === 4, posted);
  const live4 = await read(p);
  check('the live label followed the typing',
    live4.live === 'stops at $4.00 (estimated)', live4);

  // 0 means no cap, and must say so in words: "$0.00" reads like a cap of zero,
  // which is the opposite of what it does.
  await setBudget(p, 0);
  const live0 = await read(p);
  check('0 reads "no cap", never "$0.00"', live0.live === 'no cap', live0);

  // A hand-typed negative must not read as a cap either.
  await setBudget(p, -3);
  const liveNeg = await read(p);
  check('a negative reads "no cap"', liveNeg.live === 'no cap', liveNeg);

  await p.screenshot({ path: '/tmp/plato-budget.png' });
  await p.close();
}

// The row sits in a section that is 300px wide at its narrowest, and a fixed
// 88px field plus a label plus a live label is exactly the shape that overflowed
// in D47h.
for (const w of [300, 360, 720]) {
  const p = await page(w, S({ budget: { usd: 12.5 } }));
  checkPageClean(p, 'budget@' + w);
  await openAll(p);
  const m = await p.evaluate((sel) => {
    const inp = document.querySelector(sel);
    const row = inp ? inp.closest('.row') : null;
    const sb = document.getElementById('sbody');
    return {
      w: inp ? Math.round(inp.getBoundingClientRect().width) : 0,
      rowOverflow: row ? row.scrollWidth - row.clientWidth : -1,
      panelOverflow: sb ? sb.scrollWidth - sb.clientWidth : -1,
    };
  }, ROW);
  check('w=' + w + ' the field keeps a usable width', m.w >= 60, m);
  check('w=' + w + ' the row does not overflow', m.rowOverflow <= 2, m);
  check('w=' + w + ' the panel does not overflow', m.panelOverflow <= 2, m);
  if (w === 300) { await p.screenshot({ path: '/tmp/plato-budget-narrow.png' }); }
  await p.close();
}

await finish('run budget row');
