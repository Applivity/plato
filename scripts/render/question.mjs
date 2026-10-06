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

// D. Tabs, and the FALLBACK. The old label said "Question 2 of 3", which told
//    the user nothing about the other questions and offered no way to reach one
//    except stepping through with Next. The strip shows the whole set, marks
//    what is already answered, and jumps straight to a question.
//
//    D49bd: a tab is NAMED by the question's `header`. This block's fixtures
//    carry no header, so what it pins is the other half — a question without a
//    label still gets its number, which is what makes the field safe to add.
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
  check('a question with no label is numbered (D49bd)', initial.labels === '1,2', initial);
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

// E. D49bd: NAMED tabs. The model gives each question a one- or two-word header
//    and the tab shows that name. Four things are pinned, and the last three are
//    the ones a label change can break silently:
//      - the name replaces the number, and an answered question is marked by NAME;
//      - four names fit on one row at a normal width;
//      - at a NARROW width they WRAP instead of running off the card — the strip
//        grows downward, and nothing is clipped;
//      - a blank header is not a label: that question keeps its number.
const NAMED = [
  { header: 'Contract', question: 'Should behaviour that affects public method contracts change?', options: ['Keep signatures', 'Change and fix callers'] },
  { header: 'Constraints', question: 'Any constraints on the fix?', options: ['None', 'Some'] },
  { header: 'Migration', question: 'Should the old migration files be deleted?', options: ['Yes', 'No'] },
  { header: 'Test runner', question: 'Which test runner should I wire up?', options: ['vitest', 'jest'] },
];

/** The strip's own geometry: its labels, how many rows they occupy, and how far
 *  the last tab runs past the strip's right edge (positive means clipped). */
const strip = (p) => p.evaluate(() => {
  const s = document.querySelector('.q-tabs');
  if (!s) { return { found: false }; }
  const tabs = [...s.querySelectorAll('.q-tab')];
  const last = tabs[tabs.length - 1];
  return {
    found: true,
    count: tabs.length,
    labels: tabs.map((t) => t.textContent).join('|'),
    rows: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size,
    overflowRight: last
      ? Math.round(last.getBoundingClientRect().right - s.getBoundingClientRect().right) : 0,
  };
});

const openNamed = async (p, questions) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'user-question', questions });
  await p.waitForTimeout(260);
};

{
  // --- Wide: the names are the labels, and they sit on one row. -------------
  const p = await page(760);
  await openNamed(p, NAMED);
  const wide = await strip(p);
  check('a tab shows the question\'s header, not its number',
    wide.labels === 'Contract|Constraints|Migration|Test runner', wide);
  check('four named tabs fit on one row at a normal width', wide.rows === 1, wide);
  check('and none of them runs off the card', wide.overflowRight <= 1, wide);

  // The answered marker is a NAME now, and the name is what the user sees as
  // "done" — a tab that lost its label on answering would be the regression.
  await p.evaluate(() => { document.querySelector('.q-option').click(); });
  await p.waitForTimeout(140);
  await p.evaluate(() => {
    [...document.querySelectorAll('.q-form button')]
      .find((b) => /Next/.test(b.textContent)).click();
  });
  await p.waitForTimeout(240);
  const answered = await p.evaluate(() => {
    const on = [...document.querySelectorAll('.q-tabs .q-tab')]
      .filter((t) => t.classList.contains('answered'));
    return { n: on.length, label: on.map((t) => t.textContent).join(',') };
  });
  check('the answered question is marked on its own NAMED tab',
    answered.n === 1 && answered.label === 'Contract', answered);
  checkPageClean(p, 'named tabs');
  await p.close();

  // --- Narrow: the strip wraps rather than clipping. ------------------------
  const q = await page(300);
  await openNamed(q, NAMED);
  const narrow = await strip(q);
  check('at a narrow width the named tabs wrap to more than one row',
    narrow.rows > 1, narrow);
  check('and still none of them is clipped', narrow.overflowRight <= 1, narrow);
  checkPageClean(q, 'named tabs, narrow');
  await q.close();

  // --- A blank header is not a label. --------------------------------------
  const r = await page(760);
  await openNamed(r, [{ header: '   ', question: 'Any constraints?', options: ['None', 'Some'] }, NAMED[1]]);
  const blank = await strip(r);
  check('a blank header falls back to that question\'s number',
    blank.labels === '1|Constraints', blank);
  checkPageClean(r, 'blank header');
  await r.close();
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

// G. D49bg. The question card was the LAST parked card missing from the log —
//    approval, stuck, undo and reveal were all rebuilt on replay and this one was
//    not, so a reload while the host waited on the answer took the card off the
//    screen with the run still parked on a promise nobody could resolve.
//
//    A rebuilt card is only worth anything if it is still ANSWERABLE, so these
//    assertions drive it to Submit and read what the view posts. "A card is
//    present" would pass on a card whose buttons do nothing.
const postMsg = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const rebuild = async (p, log) => {
  await postMsg(p, { type: 'restore', log, hasConnections: true, title: '' });
  await p.waitForTimeout(320);
};

/** The question card as the replay left it. */
const qCard = (p) => p.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector('.q-form'));
  return {
    found: !!c,
    heading: c ? String((c.querySelector('h3') || {}).textContent || '') : '',
    tabs: c ? c.querySelectorAll('.q-tabs .q-tab').length : 0,
  };
});

const submit = async (p) => {
  const n = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.q-form button')]
      .find((x) => /Next|Submit/.test(x.textContent));
    if (!b || b.disabled) { return 0; }
    b.click();
    return 1;
  });
  await p.waitForTimeout(240);
  return n;
};

const answersPosted = (p) => p.evaluate(() =>
  window.__posted.filter((m) => m.type === 'user-answer'));

{
  const p = await page(760);
  await rebuild(p, [
    { k: 'msg', cls: 'you', who: 'You', text: 'wire up the tests' },
    { k: 'question-open', questions: [MULTI, Q1] },
  ]);
  const card = await qCard(p);
  check('a reload while the run waits rebuilds the question card',
    card.found === true, card);
  check('and it is the real card, not an empty shell',
    card.heading === 'Plato has a few questions' && card.tabs === 2, card);
  // The `multiple` flag has to survive the trip through the log: a rebuilt card
  // that lost it draws circles where the live card drew boxes, which quietly
  // changes what the user believes they may pick.
  const drawn = await marks(p);
  check('a multi question is still checkboxes after the reload',
    drawn.boxes === 4 && drawn.radios === 0, drawn);

  await clickOption(p, 'DateHelper.java');
  await submit(p);
  await clickOption(p, 'Keep signatures and correct minimally');
  await submit(p);
  const sent = await answersPosted(p);
  check('the rebuilt card still answers the host', sent.length === 1, sent);
  check('and the answer is the one that was picked',
    sent.length === 1 && sent[0].answers.join('|') === 'DateHelper.java|Keep signatures and correct minimally',
    sent.length === 1 ? sent[0].answers : sent);
  checkPageClean(p, 'rebuilt question card');
  await p.close();
}

// H. The other half: once answered (or cancelled) the card must NOT come back.
//    Without the closing row a reload would resurrect a question the user had
//    already dealt with, and the answer rows are what keep the exchange in the
//    transcript — a fold used to summarise a run in which the user appeared to
//    have said nothing.
{
  const p = await page(760);
  // The card is drawn FIRST, from the same row the host writes when it asks. The
  // "not rebuilt" assertions below are absences, and an absence passes just as
  // well on a replay that draws nothing at all — so this is what makes them mean
  // something. It is the count-repeated-on-purpose rule the tab block uses.
  await rebuild(p, [{ k: 'question-open', questions: [Q1] }]);
  const up = await qCard(p);
  check('the open row alone does draw the card', up.found === true, up);

  await rebuild(p, [
    { k: 'question-open', questions: [Q1] },
    { k: 'msg', cls: 'you', who: 'You', text: `${Q1.question}: Keep signatures and correct minimally` },
    { k: 'question-done' },
  ]);
  const closed = await qCard(p);
  check('an answered question is not rebuilt on reload', closed.found === false, closed);
  const text = await p.evaluate(() => document.getElementById('log').textContent);
  check('and the exchange it produced is still in the transcript',
    text.indexOf(Q1.question) !== -1 && text.indexOf('Keep signatures') !== -1,
    text.slice(0, 300));
  checkPageClean(p, 'answered question replay');
  await p.close();

  // And a card closed with no answer at all — the cancel path, which writes no
  // echo rows because the user answered nothing.
  const q = await page(760);
  await rebuild(q, [{ k: 'question-open', questions: [Q1] }]);
  check('the open row draws the card here too', (await qCard(q)).found === true);
  await rebuild(q, [
    { k: 'question-open', questions: [Q1] },
    { k: 'question-done' },
  ]);
  const gone = await qCard(q);
  check('a cancelled question is not rebuilt either', gone.found === false, gone);
  checkPageClean(q, 'cancelled question replay');
  await q.close();
}

// I. The recommendation marker. `recommended` has been in this suite's fixtures
//    from the start and **nothing asserted what it does** — the field was
//    exercised and its one visible effect was unpinned. Core now resolves the
//    model's string against the options before the card sees it, so this is the
//    view's whole contract: mark the matching option, mark exactly ONE, and mark
//    nothing when there is nothing to mark.
const REC_MULTI = { ...MULTI, recommended: 'DateHelper.java' };

/** Where the marker is, and how many rows carry it. */
const markers = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll('.q-option')];
  const on = rows.filter((r) => /\(recommended\)/.test(r.textContent));
  return {
    total: rows.length,
    count: on.length,
    labels: on.map((r) => r.querySelector('.q-text').textContent).join('|'),
    boxes: document.querySelectorAll('.q-check').length,
  };
});

{
  // A page per card: `openCard` appends, so two cards in one page would be
  // counted as one card's rows.
  const p = await page(760);
  await openCard(p, [Q1]);
  const one = await markers(p);
  check('exactly one option carries the recommendation', one.count === 1, one);
  check('and it is the option the model named, by its full label',
    one.labels === 'Keep signatures and correct minimally (recommended)', one);
  checkPageClean(p, 'recommended marker');
  await p.close();

  // The other half: no recommendation means no marker anywhere, so a card cannot
  // be read as recommending something the model never named.
  const q = await page(760);
  await openCard(q, [MULTI]);
  const none = await markers(q);
  check('a question with no recommendation marks nothing', none.count === 0, none);
  check('and that is a real card, not an empty one', none.total === 4, none);
  checkPageClean(q, 'no recommendation');
  await q.close();

  // The case the founder asked about: a recommendation on a CHECKBOX question.
  const r = await page(760);
  await openCard(r, [REC_MULTI]);
  const multi = await markers(r);
  check('a multi question can carry a recommendation too', multi.count === 1, multi);
  check('and it still draws checkboxes',
    multi.boxes === 4 && /DateHelper\.java/.test(multi.labels), multi);
  checkPageClean(r, 'recommended box');
  await r.close();
}

console.log('');
await finish('question card');