import { check, page, S, finish, checkPageClean } from './plib.mjs';

/**
 * D49t: the model picker is now one model per line — the name, with its context
 * window as a subtitle — and a million is "1M", not "1000k".
 *
 * The rows come from the `models` payload's `items`, which carries `maxContext`
 * only for models the connection actually reported a window for.
 */

const ITEMS = [
  { value: 'litellm:auto-act', label: 'Auto-Act', group: 'litellm', maxContext: 163840 },
  { value: 'litellm:big', label: 'Big Context', group: 'litellm', maxContext: 1000000 },
  { value: 'litellm:small', label: 'Small', group: 'litellm', maxContext: 128000 },
  { value: 'litellm:mystery', label: 'Mystery', group: 'litellm', maxContext: null },
];

const models = () => ({
  type: 'models',
  hasConnections: true,
  items: ITEMS,
  effectiveModel: 'litellm:auto-act',
  reasoningCapable: true,
  reasoning: 'off',
  orchestration: 'solo',
  compaction: { mode: 'auto', threshold: 0.8 },
});

async function openPicker(width) {
  const p = await page(width, S());
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })), models());
  await p.waitForTimeout(220);
  await p.evaluate(() => document.getElementById('modelBtn').click());
  await p.waitForTimeout(220);
  return p;
}

// A. One model per row: name above, context beneath.
{
  const p = await openPicker(620);
  const rows = await p.evaluate(() =>
    [...document.querySelectorAll('.popover-row.model-row')].map((r) => {
      const n = r.querySelector('.pr-name');
      const s = r.querySelector('.pr-sub');
      return {
        name: n ? n.textContent : null,
        sub: s ? s.textContent : null,
        // Stacked, not side by side: the subtitle starts below the name.
        stacked: !!(n && s) &&
          s.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1,
      };
    }));

  check('every model has its own row', rows.length === ITEMS.length, rows.length);
  check('each row carries a name and a subtitle',
    rows.every((r) => r.name && r.sub), rows);
  check('the name sits above the subtitle, not beside it',
    rows.every((r) => r.stacked), rows);
  checkPageClean(p, 'model rows');
  await p.close();
}

// B. D49t: the unit switches at a million.
{
  const p = await openPicker(620);
  const subs = await p.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.popover-row.model-row')]
      .map((r) => [
        r.querySelector('.pr-name').textContent,
        r.querySelector('.pr-sub').textContent,
      ])));

  check('a million reads 1M, never 1000k', subs['Big Context'] === '1M context', subs);
  check('no row anywhere says 1000k',
    !Object.values(subs).some((s) => /1000k/.test(s)), subs);
  check('hundreds of thousands stay in k', subs['Small'] === '128k context', subs);
  check('a reported 163840 reads 164k', subs['Auto-Act'] === '164k context', subs);
  check('a model with no reported window says so',
    subs['Mystery'] === 'context unknown', subs);
  checkPageClean(p, 'units');
  await p.close();
}

// C. A long list scrolls rather than pushing the panel around.
{
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({ value: 'litellm:m' + i, label: 'Model ' + i, group: 'litellm', maxContext: 128000 });
  }
  const p = await page(620, S());
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  { ...models(), items: many });
  await p.waitForTimeout(220);
  await p.evaluate(() => document.getElementById('modelBtn').click());
  await p.waitForTimeout(220);
  const r = await p.evaluate(() => {
    const list = document.querySelector('.popover-list');
    const names = [...document.querySelectorAll('.popover-row.model-row .pr-name')]
      .map((n) => n.textContent);
    const subs = [...document.querySelectorAll('.popover-row.model-row .pr-sub')]
      .map((n) => n.textContent);
    return {
      names,
      subs,
      scrolls: list ? list.scrollHeight > list.clientHeight + 1 : false,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const missing = [];
  for (let i = 0; i < 40; i++) {
    if (!r.names.includes('Model ' + i)) missing.push(i);
  }
  check('a long list keeps every model', missing.length === 0, { missing, total: r.names.length });
  // The picker always shows what is selected, even when it is not in the list.
  check('the selected model still gets a row',
    r.names.includes('litellm:auto-act'), r.names.slice(0, 3));
  check('the fallback row says why it is there',
    r.subs.includes('not in the fetched list'), r.subs.slice(0, 3));
  check('a long list scrolls instead of growing without bound', r.scrolls, r);
  check('a long list does not overflow the panel sideways', r.overflowX <= 0, r);
  checkPageClean(p, 'long list');
  await p.close();
}

await finish('model list');
