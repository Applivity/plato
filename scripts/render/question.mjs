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

// D. Numbered tabs. The old label said "Question 2 of 3", which told the user
//    nothing about the other questions and offered no way to reach one except
//    stepping through with Next. The strip shows the whole set, marks what is
//    already answered, and jumps straight to a question.
{
  const p = await page(760);
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'user-question', questions: [Q1, Q2] });
  await p.waitForTimeout(250);

  const initial = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.q-tabs .q-tab')];
    return {
      count: tabs.length,
      labels: tabs.map((t) => t.textContent).join(','),
      active: tabs.findIndex((t) => t.classList.contains('active')),
      answered: tabs.filter((t) => t.classList.contains('answered')).length,
    };
  });
  check('there is one tab per question', initial.count === 2, initial);
  check('the tabs are numbered from 1', initial.labels === '1,2', initial);
  check('the first tab is the active one', initial.active === 0, initial);
  // The count is repeated here on purpose: on its own this passes vacuously on
  // a card with no tabs at all, which is exactly the regression it must catch.
  check('no tab is marked answered before an answer exists',
    initial.count === 2 && initial.answered === 0, initial);

  await p.evaluate(() => { document.querySelector('.q-option').click(); });
  await p.waitForTimeout(140);
  await p.evaluate(() => {
    const next = [...document.querySelectorAll('.q-form button')]
      .find((b) => /Next/.test(b.textContent));
    next.click();
  });
  await p.waitForTimeout(240);

  const afterNext = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.q-tabs .q-tab')];
    return {
      active: tabs.findIndex((t) => t.classList.contains('active')),
      answered: tabs.filter((t) => t.classList.contains('answered'))
        .map((t) => t.textContent).join(','),
    };
  });
  check('Next moves the active tab to question 2', afterNext.active === 1, afterNext);
  check('the answered question is marked on its own tab',
    afterNext.answered === '1', afterNext);

  // The point of the strip: reach a question without walking back through Next.
  // Guarded, so a card with no tabs reports the failures above instead of
  // throwing and hiding the rest of the block.
  await p.evaluate(() => {
    const tabs = document.querySelectorAll('.q-tabs .q-tab');
    if (tabs.length) { tabs[0].click(); }
  });
  await p.waitForTimeout(240);
  const jumped = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.q-tabs .q-tab')];
    const selected = document.querySelector('.q-option.selected');
    return {
      active: tabs.findIndex((t) => t.classList.contains('active')),
      selected: selected ? selected.textContent : '',
    };
  });
  check('clicking tab 1 returns to question 1', jumped.active === 0, jumped);
  check('and the answer given to it is still selected',
    /Keep signatures/.test(jumped.selected), jumped);
  checkPageClean(p, 'question tabs');
  await p.close();
}

// D49al. Multi-select. A question with `multiple: true` gets CHECKBOXES and the
// user may pick several; a question without it keeps radios and one answer. The
// assertions below pin the four things that can silently go wrong: the wrong
// marker is drawn, a second pick replaces the first instead of adding to it, a
// pick cannot be taken back, and the several picks never reach the model as
// several.
const MULTI = {
  question: 'Which files should I read first?',
  context: 'Pick any that matter.',
  options: ['DateHelper.java', 'SubmissionsViewModel.java', 'MainActivity.java'],
  multiple: true,
};

/** Dispatch a card and return nothing; the caller drives it. */
const openCard = async (p, questions) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'user-question', questions });
  await p.waitForTimeout(260);
};

const marks = (p) => p.evaluate(() => ({
  boxes: document.querySelectorAll('.q-check').length,
  radios: document.querySelectorAll('.q-radio').length,
  selected: [...document.querySelectorAll('.q-option.selected')]
    .map((r) => r.querySelector('.q-text').textContent),
  nextDisabled: (() => {
    const b = [...document.querySelectorAll('.q-form button')]
      .find((x) => /Next|Submit/.test(x.textContent));
    return b ? b.disabled : null;
  })(),
}));

const clickOption = async (p, label) => {
  await p.evaluate((l) => {
    const row = [...document.querySelectorAll('.q-option')]
      .find((r) => r.querySelector('.q-text').textContent.indexOf(l) === 0);
    if (row) { row.click(); }
  }, label);
  await p.waitForTimeout(120);
};

// A. The marker: boxes for a multi question, circles for a single one.
{
  const p = await page(760);
  await openCard(p, [MULTI, Q1]);

  const m = await marks(p);
  check('a multi question draws checkboxes, not radios',
    m.boxes === 4 && m.radios === 0, m);
  check('nothing is selected to begin with', m.selected.length === 0, m);
  check('Submit is refused until something is picked', m.nextDisabled === true, m);

  await clickOption(p, 'DateHelper.java');
  const one = await marks(p);
  check('one pick selects one row', one.selected.length === 1, one);
  check('and that unlocks the button', one.nextDisabled === false, one);

  await clickOption(p, 'MainActivity.java');
  const two = await marks(p);
  check('a second pick ADDS to the first instead of replacing it',
    two.selected.length === 2, two);

  await clickOption(p, 'DateHelper.java');
  const back = await marks(p);
  check('clicking a chosen box again takes it back',
    back.selected.length === 1 && /MainActivity/.test(back.selected[0]), back);

  // The contrast case, in the same card: the single question still behaves like
  // a radio group, so supporting several did not make EVERY question multi.
  await p.evaluate(() => {
    [...document.querySelectorAll('.q-form button')]
      .find((b) => /Next/.test(b.textContent)).click();
  });
  await p.waitForTimeout(240);
  const single = await marks(p);
  check('the single question in the same card still draws radios',
    single.radios === 3 && single.boxes === 0, single);

  await clickOption(p, 'Change and fix callers');
  await clickOption(p, 'Keep signatures and correct minimally');
  const switched = await marks(p);
  check('choosing another radio REPLACES the first',
    switched.selected.length === 1 && /Keep signatures/.test(switched.selected[0]),
    switched);
  checkPageClean(p, 'checkbox affordance');
  await p.close();
}

// B. What actually reaches the model: the picks, as one string per question.
{
  const p = await page(760);
  await openCard(p, [MULTI]);
  await clickOption(p, 'DateHelper.java');
  await clickOption(p, 'MainActivity.java');
  await p.evaluate(() => {
    [...document.querySelectorAll('.q-form button')]
      .find((b) => /Submit/.test(b.textContent)).click();
  });
  await p.waitForTimeout(240);

  const posted = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'user-answer'));
  check('the answer is posted once', posted.length === 1, posted);
  check('several picks travel as several, separated by a semicolon',
    posted.length === 1 && posted[0].answers[0] === 'DateHelper.java; MainActivity.java',
    posted.length === 1 ? posted[0].answers : posted);
  checkPageClean(p, 'multi answer');
  await p.close();
}

// C. A free-text pick joins the others rather than replacing them — the case
//    where "one string per question" could quietly drop one of the two answers.
{
  const p = await page(760);
  await openCard(p, [MULTI]);
  await clickOption(p, 'DateHelper.java');
  await clickOption(p, 'Others');
  await p.waitForTimeout(160);
  await p.evaluate(() => {
    const t = document.querySelector('.q-custom-row textarea');
    t.focus();
    t.value = 'BuildConfig.java';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(160);
  await p.evaluate(() => {
    [...document.querySelectorAll('.q-form button')]
      .find((b) => /Submit/.test(b.textContent)).click();
  });
  await p.waitForTimeout(240);

  const posted = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'user-answer'));
  check('a typed answer joins the picked ones, not replaces them',
    posted.length === 1 && posted[0].answers[0] === 'DateHelper.java; BuildConfig.java',
    posted.length === 1 ? posted[0].answers : posted);
  checkPageClean(p, 'multi answer with free text');
  await p.close();
}

console.log('');
await finish('question card');