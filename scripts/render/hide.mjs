/**
 * D49cp render suite: hiding the rows above the newest summary.
 *
 * The setting defaults to ON. These checks are the page's half:
 *   - the rows above the summary are not drawn, and the divider says plainly
 *     that they were summarised and are still in the transcript;
 *   - the divider's own control reveals them for this page, without touching the
 *     setting;
 *   - turning the setting off shows every row and restores the old banner;
 *   - a reload goes back to the setting, so a reveal is not remembered.
 *
 * The setting itself is the host's (packages/vs/test/history.test.mjs proves it
 * is written and re-sent); this suite proves the view applies it.
 */
import { page, check, checkPageClean, finish } from './plib.mjs';

const send = (p, msg) =>
  p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);

const LOG = [
  { k: 'msg', cls: 'you', who: 'You', text: 'First question' },
  { k: 'msg', cls: 'bot', who: 'Plato', text: 'First answer' },
  { k: 'msg', cls: 'you', who: 'You', text: 'Before the fold' },
  { k: 'compact', text: 'A summary the user never sees.' },
  { k: 'msg', cls: 'you', who: 'You', text: 'After the fold' },
  { k: 'msg', cls: 'bot', who: 'Plato', text: 'A later answer' },
];

const restore = (p) =>
  send(p, {
    type: 'restore',
    log: LOG,
    hasConnections: true,
    model: 'stub:stub-model',
    title: '',
    mode: 'edit',
    queue: [],
    queueHeld: false,
  });

/** What the transcript currently draws. */
const view = (p) => p.evaluate(() => {
  const kids = [...document.querySelectorAll('#log > .msg')];
  const shown = kids
    .filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => e.textContent);
  const banner = kids.find(
    (e) => e.classList.contains('compact') && !e.classList.contains('trim'),
  );
  const head = banner ? banner.querySelector('.cc-head') : null;
  return {
    shown,
    hiddenCount: kids.length - shown.length,
    head: head ? head.textContent : '',
    button: banner ? !!banner.querySelector('.cc-show') : false,
  };
});

/* A. Default on: the rows above the summary are not drawn. */
{
  const p = await page(760);
  await send(p, { type: 'chat-prefs', hideBeforeSummary: true });
  await restore(p);
  await p.waitForTimeout(200);
  const v = await view(p);
  check('the rows above the summary are not drawn',
    !v.shown.some((t) => t.includes('First question'))
      && !v.shown.some((t) => t.includes('Before the fold')), v.shown);
  check('the rows after it still are',
    v.shown.some((t) => t.includes('After the fold'))
      && v.shown.some((t) => t.includes('A later answer')), v.shown);
  check('the divider says the earlier messages were summarised',
    /summarised/i.test(v.head), v.head);
  check('and that they are still in the transcript',
    /still in the transcript/i.test(v.head), v.head);
  check('no wording implies they were deleted',
    !/delet|removed|lost/i.test(v.head), v.head);
  check('the divider offers to show them', v.button === true, v);
  checkPageClean(p, 'hidden by default');

  /* B. The divider's control reveals them for this page only. */
  await p.evaluate(() => document.querySelector('.cc-show').click());
  await p.waitForTimeout(120);
  const revealed = await view(p);
  check('Show earlier messages reveals every row',
    revealed.shown.some((t) => t.includes('First question'))
      && revealed.shown.some((t) => t.includes('Before the fold')), revealed.shown);
  check('the control goes once it has been used', revealed.button === false, revealed);
  check('the divider still says the conversation was summarised',
    /summarised/i.test(revealed.head), revealed.head);

  /* C. Toggling the setting off re-renders at once, without a reload. */
  await send(p, { type: 'chat-prefs', hideBeforeSummary: false });
  await p.waitForTimeout(120);
  const off = await view(p);
  check('with the setting off every row is drawn',
    off.shown.some((t) => t.includes('First question'))
      && off.hiddenCount === 0, off);
  check('and the banner goes back to the old wording',
    off.head.includes('Plato now carries a summary of the work above'), off.head);
  check('with no reveal control', off.button === false, off);

  /* D. And on again hides them. */
  await send(p, { type: 'chat-prefs', hideBeforeSummary: true });
  await p.waitForTimeout(120);
  const on = await view(p);
  check('turning it back on hides them again',
    !on.shown.some((t) => t.includes('First question')) && on.button === true, on);
  checkPageClean(p, 'toggled');
  await p.close();
}

/* E. A reload goes back to the setting: the reveal is not remembered. */
{
  const p = await page(760);
  await send(p, { type: 'chat-prefs', hideBeforeSummary: true });
  await restore(p);
  await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('.cc-show').click());
  await p.waitForTimeout(100);
  await p.close();

  const reload = await page(760);
  await send(reload, { type: 'chat-prefs', hideBeforeSummary: true });
  await restore(reload);
  await reload.waitForTimeout(200);
  const v = await view(reload);
  check('a reload starts from the setting again, not from the reveal',
    !v.shown.some((t) => t.includes('First question')) && v.button === true, v);
  checkPageClean(reload, 'reloaded');
  await reload.close();
}

/* F. No summary in the log: nothing is hidden. */
{
  const p = await page(760);
  await send(p, { type: 'chat-prefs', hideBeforeSummary: true });
  await send(p, {
    type: 'restore',
    log: LOG.filter((e) => e.k !== 'compact'),
    hasConnections: true,
    model: 'stub:stub-model',
    title: '',
    mode: 'edit',
    queue: [],
    queueHeld: false,
  });
  await p.waitForTimeout(150);
  const v = await view(p);
  check('a conversation with no summary hides nothing',
    v.hiddenCount === 0 && v.shown.some((t) => t.includes('First question')), v);
  checkPageClean(p, 'no summary');
  await p.close();
}

/* G. A warning is never hidden: a trim note above the summary stays visible. */
{
  const p = await page(760);
  await send(p, { type: 'chat-prefs', hideBeforeSummary: true });
  await send(p, {
    type: 'restore',
    log: [
      { k: 'trim', dropped: 12, lostSummary: true, tools: 10, messages: 2 },
      { k: 'msg', cls: 'you', who: 'You', text: 'A message above the summary' },
      { k: 'msg', cls: 'bot', who: 'Plato', text: 'An answer above the summary' },
      { k: 'compact', text: 'A summary the user never sees.' },
      { k: 'msg', cls: 'you', who: 'You', text: 'A message below the summary' },
    ],
    hasConnections: true,
    model: 'stub:stub-model',
    title: '',
    mode: 'edit',
    queue: [],
    queueHeld: false,
  });
  await p.waitForTimeout(200);
  const v = await p.evaluate(() => {
    const note = document.querySelector('#log > .msg.compact.trim');
    const above = [...document.querySelectorAll('#log > .msg.you, #log > .msg.bot')]
      .filter((e) => e.textContent.includes('above the summary'));
    const below = [...document.querySelectorAll('#log > .msg.you, #log > .msg.bot')]
      .filter((e) => e.textContent.includes('below the summary'));
    return {
      noteShown: !!note && getComputedStyle(note).display !== 'none',
      noteText: note ? note.textContent : '',
      aboveHidden:
        above.length === 2 &&
        above.every((e) => getComputedStyle(e).display === 'none'),
      belowShown:
        below.length === 1 && getComputedStyle(below[0]).display !== 'none',
    };
  });
  check('a view preference never hides a trim note', v.noteShown, v);
  check('the note still warns about the cap and the lost summary',
    /no longer shown/i.test(v.noteText) && /no longer remembers/i.test(v.noteText),
    v.noteText);
  check('the messages above the summary are hidden', v.aboveHidden, v);
  check('the messages below it are shown', v.belowShown, v);

  await p.evaluate(() => document.querySelector('.cc-show').click());
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => {
    const note = document.querySelector('#log > .msg.compact.trim');
    const above = [...document.querySelectorAll('#log > .msg.you, #log > .msg.bot')]
      .filter((e) => e.textContent.includes('above the summary'));
    return {
      noteShown: !!note && getComputedStyle(note).display !== 'none',
      aboveShown: above.every((e) => getComputedStyle(e).display !== 'none'),
    };
  });
  check('Show earlier messages still reveals the messages', after.aboveShown, after);
  check('and the warning is still there afterwards', after.noteShown, after);
  checkPageClean(p, 'warning above the divider');
  await p.close();
}

await finish('hide before summary: default, control, toggle, reload, warnings');
