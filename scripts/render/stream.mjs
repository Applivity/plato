import { check, checkPageClean, page, S, finish } from './plib.mjs';

/**
 * D49j: the webview half of the streaming contract.
 *
 * The host posts `md` on a ~50 ms throttle while a turn is being written, and
 * each post carries the WHOLE reply so far. That is only correct because
 * `streamHtml` REPLACES one tagged element. If it ever appended instead, a
 * growing reply would accumulate copies of itself — "Hel", then "HelHello" —
 * and no unit test in packages/core could see it, because the defect lives in
 * the DOM.
 *
 * The second half is ordering: a turn boundary commits the live element so the
 * next turn opens a fresh one, which is what keeps notices and tool cards
 * between the two replies instead of above the second one.
 */
const p = await page(700, S());

const send = (data) =>
  p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), data);

const snap = () =>
  p.evaluate(() => {
    const bots = [...document.querySelectorAll('#log .msg.bot')];
    const live = document.getElementById('streaming');
    return {
      count: bots.length,
      texts: bots.map((b) => (b.textContent || '').trim()),
      live: live ? (live.textContent || '').trim() : null,
    };
  });

await send({ type: 'md', text: 'Hel' });
await p.waitForTimeout(120);
let s = await snap();
check('the first fragment opens one reply', s.count === 1 && s.texts[0] === 'Hel', s);

// A throttled stream posts the cumulative reply, so each post is longer than
// the last. The element must GROW, not multiply.
for (const t of ['Hello', 'Hello wor', 'Hello world']) {
  await send({ type: 'md', text: t });
}
await p.waitForTimeout(140);
s = await snap();
check('a growing reply replaces itself instead of appending',
  s.count === 1 && s.texts[0] === 'Hello world', s);
check('the element being replaced is the live one', s.live === 'Hello world', s);

await send({ type: 'turn', text: {} });
await p.waitForTimeout(120);
const afterTurn = await p.evaluate(() => ({
  live: document.getElementById('streaming') !== null,
  bots: document.querySelectorAll('#log .msg.bot').length,
}));
check('a turn boundary commits the live element',
  afterTurn.live === false && afterTurn.bots === 1, afterTurn);

// Ordering: the committed reply must stay above whatever comes next.
await send({ type: 'notice', text: 'intervening notice' });
await send({ type: 'md', text: 'Second answer' });
await p.waitForTimeout(140);
s = await snap();
check('the next turn opens a SECOND reply', s.count === 2, s);
check('the committed reply keeps its text', s.texts[0] === 'Hello world', s);
check('the new reply is the live one', s.live === 'Second answer', s);

const order = await p.evaluate(() =>
  [...document.querySelectorAll('#log > *')].map((e) => (e.textContent || '').trim().slice(0, 20)));
check('the notice sits between the two replies',
  order.findIndex((t) => t.includes('intervening')) === 1
  && order.findIndex((t) => t.includes('Second answer')) === 2, order);

await send({ type: 'done', text: { secs: 1, tools: 0 } });
await p.waitForTimeout(160);
const finished = await p.evaluate(() => ({
  live: document.getElementById('streaming') !== null,
  busy: document.getElementById('send') ? document.getElementById('send').disabled : null,
}));
check('finish() releases the live element', finished.live === false, finished);

checkPageClean(p, 'stream');
await p.close();
await finish('streaming');
