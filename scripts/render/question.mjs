import { check, page, finish, checkPageClean } from './plib.mjs';

/**
 * D49x: the free-text answer to a Plato question was a one-line input, which
 * scrolled sideways while the answer was still being written. It is now a
 * textarea that grows with the text and stops at three lines.
 *
 * The cap is the part worth pinning. "It grew" passes on a box that grows
 * forever, and a box that grows forever pushes the Submit button off the card —
 * so the assertions below measure the height at one, three and five lines and
 * require it to stop moving past three, with the overflow scrolling instead.
 */

const Q1 = {
  question: 'Should behaviour that affects public method contracts change?',
  context: 'Callers you have not seen may depend on the current shape.',
  options: ['Keep signatures and correct minimally', 'Change and fix callers'],
  recommended: 'Keep signatures and correct minimally',
};
const Q2 = { question: 'Any constraints on the fix?', options: ['None'] };

/** Opens the card, picks the free-text row, and returns the box's metrics. */
const openCustom = async (p) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'user-question', questions: [Q1, Q2] });
  await p.waitForTimeout(250);
  const opened = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.q-option')];
    const others = rows.find((r) => /Others/.test(r.textContent));
    if (!others) { return { found: false }; }
    others.click();
    return { found: true };
  });
  await p.waitForTimeout(160);
  return opened;
};

const metrics = (p) => p.evaluate(() => {
  const t = document.querySelector('.q-custom-row textarea');
  if (!t) { return { found: false }; }
  const cs = getComputedStyle(t);
  const lh = parseFloat(cs.lineHeight);
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  return {
    found: true,
    tag: t.tagName,
    lines: +(((t.clientHeight - pad) / lh)).toFixed(2),
    clipped: t.scrollHeight > t.clientHeight + 1,
    scrolls: cs.overflowY,
    resizable: cs.resize,
  };
});

const type = async (p, text) => {
  await p.evaluate((v) => {
    const t = document.querySelector('.q-custom-row textarea');
    t.focus();
    t.value = v;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await p.waitForTimeout(120);
};

// A. One line stays one line, and the box is a textarea so Enter is reachable.
{
  const p = await page(760);
  const opened = await openCustom(p);
  check('the free-text row was found and opened', opened.found, opened);
  const empty = await metrics(p);
  check('the empty answer box is a textarea', empty.tag === 'TEXTAREA', empty);
  check('the empty answer box is one line tall', empty.lines >= 0.9 && empty.lines <= 1.6, empty);
  check('the empty answer box does not scroll', empty.clipped === false, empty);

  await type(p, 'A short answer.');
  const one = await metrics(p);
  check('a short answer stays one line', one.lines >= 0.9 && one.lines <= 1.6, one);
  check('the box is never user-resizable', one.resizable === 'none', one);
  checkPageClean(p, 'answer box');
  await p.close();
}

// B. The box grows, stops at three lines, and scrolls past that.
{
  const p = await page(760);
  await openCustom(p);
  await type(p, 'one\ntwo');
  const two = await metrics(p);
  check('two lines grow the box', two.lines >= 1.9 && two.lines <= 2.6, two);
  check('two lines still fit, so nothing scrolls', two.clipped === false, two);

  await type(p, 'one\ntwo\nthree');
  const three = await metrics(p);
  check('three lines fit without scrolling', three.clipped === false, three);

  await type(p, 'one\ntwo\nthree\nfour\nfive');
  const five = await metrics(p);
  check('five lines keep the SAME height as three',
    Math.abs(five.lines - three.lines) < 0.2, { three, five });
  check('past three lines the box scrolls instead', five.clipped === true, five);
  check('the scrolling box still offers a scrollbar',
    five.scrolls === 'auto', five);
  checkPageClean(p, 'capped answer box');
  await p.close();
}

// C. Going Back to a question whose long answer is restored refits the box.
//    A hidden box measures zero, so this is the path that needs the height set
//    where the row is already in the document.
{
  const p = await page(760);
  await openCustom(p);
  await type(p, 'one\ntwo\nthree\nfour\nfive\nsix');
  await p.evaluate(() => {
    const next = [...document.querySelectorAll('.q-form button')]
      .find((b) => /Next/.test(b.textContent));
    next.click();
  });
  await p.waitForTimeout(220);
  const back = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.q-form button')]
      .find((x) => /Back/.test(x.textContent));
    if (!b) { return false; }
    b.click();
    return true;
  });
  await p.waitForTimeout(220);
  check('the card offers Back on the second question', back, back);
  const restored = await p.evaluate(() => {
    const t = document.querySelector('.q-custom-row textarea');
    return t ? { value: t.value, height: t.clientHeight } : null;
  });
  const cap = await metrics(p);
  check('the long answer survived the round trip',
    !!restored && restored.value.includes('six'), restored);
  check('the restored answer box is NOT collapsed to a sliver',
    !!restored && restored.height > 20, restored);
  check('the restored answer box is capped and scrolling',
    cap.clipped === true && cap.lines >= 2.8 && cap.lines <= 3.4, cap);
  checkPageClean(p, 'restored answer box');
  await p.close();
}

console.log('');
await finish('question card');
