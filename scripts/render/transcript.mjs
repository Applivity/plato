import { check, page, finish, checkPageClean } from './plib.mjs';

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

// B. The display cap reports what it dropped.
{
  const p = await page(760);
  await replay(p, [
    { k: 'trim', dropped: 37, lostSummary: false },
    { k: 'msg', cls: 'you', who: 'You', text: 'still here' },
  ]);
  const r = await snapshot(p);
  check('the cap renders a marker', r.banners.length === 1, r.banners);
  check('the marker is marked as a trim', r.banners[0].isTrim, r.banners);
  check('it says how many entries went',
    r.banners[0].head.includes('37'), r.banners[0]);
  check('it does not claim the summary was lost',
    r.banners[0].body === '', r.banners[0]);
  checkPageClean(p, 'trim marker');
  await p.close();
}

// C. Losing the summary is stated as memory lost, not as a cosmetic cut.
{
  const p = await page(760);
  await replay(p, [
    { k: 'trim', dropped: 1, lostSummary: true },
  ]);
  const r = await snapshot(p);
  const b = r.banners[0];
  check('one dropped entry reads in the singular', b && /^1 older entry /.test(b.head), b);
  check('losing the summary is called out', /no longer remembers/.test(b.body), b);
  checkPageClean(p, 'summary loss');
  await p.close();
}

console.log('');
await finish('transcript');
