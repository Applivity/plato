import { check, page, finish, checkPageClean, TOOL_WORDS_MSG } from './plib.mjs';

/**
 * D49aa: the founder's report — a run ended, a fold ran, and the conversation he
 * could scroll was gone. Two markers decide whether that can happen again, and
 * neither was covered before this suite.
 *
 *   1. A fold writes a row. The transcript around it is untouched, and the
 *      summary itself is NOT printed — it is the model's memory, not a document
 *      for the reader.
 *   2. The display cap, when it drops rows, says so. A bounded transcript is
 *      fine; one that rewrites itself in silence is not.
 */

const replay = async (p, log) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'restore',
    log,
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(260);
};

const snapshot = (p) => p.evaluate(() => {
  const banners = [...document.querySelectorAll('.msg.compact')];
  return {
    messages: [...document.querySelectorAll('.msg.you, .msg.bot')]
      .map((e) => e.textContent).filter((t) => t.trim().length > 0),
    banners: banners.map((b) => ({
      head: (b.querySelector('.cc-head') || {}).textContent || '',
      body: (b.querySelector('.cc-body') || {}).textContent || '',
      isTrim: b.classList.contains('trim'),
    })),
  };
});

// A. A fold leaves every row in place and prints no summary.
{
  const p = await page(760);
  await replay(p, [
    { k: 'msg', cls: 'you', who: 'You', text: 'first question' },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'first answer' },
    { k: 'tool', tool: 'read_file', phase: 'done' },
    { k: 'compact', text: 'TERSE MACHINE SUMMARY: user asked two things.' },
    { k: 'msg', cls: 'you', who: 'You', text: 'second question' },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'second answer' },
  ]);
  const r = await snapshot(p);
  check('a fold renders one marker', r.banners.length === 1, r.banners);
  check('the marker is not a trim', r.banners[0] && !r.banners[0].isTrim, r.banners);
  check('the summary text is NOT printed into the transcript',
    !JSON.stringify(r).includes('TERSE MACHINE SUMMARY'), r.banners);
  // The whole point: the rows the fold accounted for are still readable.
  check('the rows before the fold are still in the transcript',
    r.messages.some((m) => m.includes('first question'))
      && r.messages.some((m) => m.includes('first answer')), r.messages);
  check('and the rows after it are too',
    r.messages.some((m) => m.includes('second question')), r.messages);
  checkPageClean(p, 'compact marker');
  await p.close();
}

// B. The display cap reports what it dropped, and WHICH KIND it took.
//    D49aa amended: the cap drops work before conversation, so a note that says
//    only "37 older entries" hides the one fact that matters — did the user's
//    own words go? The kinds are named when the note carries them.
{
  const p = await page(760);
  await replay(p, [
    { k: 'trim', dropped: 37, lostSummary: false, tools: 30, messages: 5 },
    { k: 'msg', cls: 'you', who: 'You', text: 'still here' },
  ]);
  const r = await snapshot(p);
  check('the cap renders a marker', r.banners.length === 1, r.banners);
  check('the marker is marked as a trim', r.banners[0].isTrim, r.banners);
  check('it names the conversation and the work',
    r.banners[0].head ===
      '5 earlier messages, 30 tool calls and 2 older notes are no longer shown',
    r.banners[0].head);
  check('it does not claim the summary was lost',
    r.banners[0].body === '', r.banners[0]);
  checkPageClean(p, 'trim marker');
  await p.close();
}

// B2. A note written before the kinds existed keeps the generic wording: its
//     kinds were never recorded, and inventing a split would be a lie.
{
  const p = await page(760);
  await replay(p, [{ k: 'trim', dropped: 37, lostSummary: false }]);
  const r = await snapshot(p);
  check('an old note still says how many entries went',
    r.banners[0].head === '37 older entries are no longer shown',
    r.banners[0].head);
  checkPageClean(p, 'old trim marker');
  await p.close();
}

// C. Losing the summary is stated as memory lost, not as a cosmetic cut.
{
  const p = await page(760);
  await replay(p, [
    { k: 'trim', dropped: 1, lostSummary: true, messages: 1 },
  ]);
  const r = await snapshot(p);
  const b = r.banners[0];
  check('one dropped message reads in the singular',
    b && /^1 earlier message is no longer shown$/.test(b.head), b);
  check('losing the summary is called out', /no longer remembers/.test(b.body), b);
  checkPageClean(p, 'summary loss');
  await p.close();
}

// D. The collapsed activity row counts ONE in the singular. The counted words
//    are plural, and until now a single call printed "1 files edited" — the line
//    a user sees after every small edit. The tally is per tool NAME, so one call
//    to one tool is exactly the case that was wrong.
const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const summary = (p) => p.evaluate(
  () => (document.querySelector('.msg.tool-summary') || {}).textContent || '',
);

{
  const p = await page(760);
  await post(p, TOOL_WORDS_MSG);
  await post(p, { type: 'tool', tool: 'apply_diff', phase: 'done' });
  await p.waitForTimeout(700); // the buffer flushes 500ms after the last event
  const one = await summary(p);
  check('a tally of one reads in the singular',
    one === '1 tool call · 1 file edited', one);
  checkPageClean(p, 'tool summary, one call');
  await p.close();
}
{
  const p = await page(760);
  await post(p, TOOL_WORDS_MSG);
  await post(p, { type: 'tool', tool: 'apply_diff', phase: 'done' });
  await post(p, { type: 'tool', tool: 'apply_diff', phase: 'done' });
  await p.waitForTimeout(700);
  const two = await summary(p);
  check('a tally of two still reads in the plural',
    two === '2 tool calls · 2 files edited', two);
  checkPageClean(p, 'tool summary, two calls');
  await p.close();
}

console.log('');
await finish('transcript');
