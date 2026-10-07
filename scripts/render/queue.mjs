import { check, page, S, finish, checkPageClean } from './plib.mjs';

/**
 * D49bo: the queued follow-ups.
 *
 * A queued message is a task held for AFTER the current run, which is a
 * different thing from the mid-run guidance the composer already sends. The
 * assertions that matter are the two the design turns on: the list is VISIBLE
 * and each item can be taken back before it is sent, and the row never becomes
 * a second send button — the host owns the queue, so this view only draws what
 * it is told and posts what the user clicked.
 */

const snap = (p) => p.evaluate(() => {
  const row = document.getElementById('queueRow');
  const chips = [...row.querySelectorAll('.attach-chip')];
  return {
    hidden: row.hidden,
    names: chips.map((c) => (c.querySelector('.ac-name') || {}).textContent),
    titles: chips.map((c) => c.title),
    removeLabels: chips.map((c) => {
      const x = c.querySelector('.ac-x');
      return x ? x.getAttribute('aria-label') : null;
    }),
    start: !!row.querySelector('.queue-start'),
    attachHidden: document.getElementById('attachRow').hidden,
    posted: window.__posted.slice(),
  };
});

// A. An empty queue draws nothing at all — no row, no placeholder.
{
  const p = await page(620, S());
  const empty = await snap(p);
  check('an empty queue shows no row', empty.hidden === true, empty);
  checkPageClean(p, 'empty');
  await p.close();
}

// B. The list is visible, in order, and numbered.
{
  const p = await page(620, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'queue', items: ['update the README', 'then run the tests'], held: false });
  await p.waitForTimeout(150);
  const q = await snap(p);
  check('a queued message is visible', q.hidden === false, q);
  check('every queued message is listed, in order',
    JSON.stringify(q.names) === JSON.stringify(['1. update the README', '2. then run the tests']), q);
  check('a long message is readable in full on hover, not truncated away',
    q.titles[0] === 'update the README', q);
  check('each one can be taken back before it is sent',
    q.removeLabels[0] === 'Remove queued message 1', q);
  check('and nothing is held, so there is no Start control', q.start === false, q);
  checkPageClean(p, 'listed');
  await p.close();
}

// C. Removing posts the INDEX, and the view does not edit itself.
//
// The view must not remove the chip locally: removal is by index, so a local
// edit that disagreed with the host would take out the wrong message. The
// assertion is that the chip is still there until the host answers.
{
  const p = await page(620, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'queue', items: ['first', 'second'], held: false });
  await p.waitForTimeout(150);
  await p.evaluate(() => {
    document.querySelectorAll('#queueRow .ac-x')[1].click();
  });
  await p.waitForTimeout(120);
  const after = await snap(p);
  const last = after.posted[after.posted.length - 1];
  check('removing a queued message posts its index',
    last && last.type === 'queue-remove' && last.index === 1, last);
  check('and the row is left for the host to correct, not edited here',
    after.names.length === 2, after);
  checkPageClean(p, 'remove');
  await p.close();
}

// D. A held queue offers a way to continue, and only a held one does.
//
// The hold is the whole reason this control exists: a run that stopped because
// the user cancelled it, or because it failed, must not quietly hand the queue
// on. The user asks for it to continue.
{
  const p = await page(620, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'queue', items: ['held one'], held: true });
  await p.waitForTimeout(150);
  const held = await snap(p);
  check('a held queue says so by offering Start', held.start === true, held);
  await p.evaluate(() => { document.querySelector('#queueRow .queue-start').click(); });
  await p.waitForTimeout(120);
  const after = await snap(p);
  const last = after.posted[after.posted.length - 1];
  check('and clicking it asks the host to continue',
    last && last.type === 'queue-start', last);
  checkPageClean(p, 'held');
  await p.close();
}

// E. The queue and the attachments are separate rows.
//
// They are cleared at different moments — an attachment is consumed by the send,
// a queued message outlives runs — so one row could not serve both.
{
  const p = await page(620, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'queue', items: ['later'], held: false });
  await p.waitForTimeout(150);
  const q = await snap(p);
  check('the queue has a row of its own', q.hidden === false && q.attachHidden === true, q);
  checkPageClean(p, 'separate rows');
  await p.close();
}

// F. The queue survives a panel reload, because it is the host's to remember.
{
  const p = await page(620, {
    ...S(),
    type: 'restore', log: [],
    queue: ['restored task'], queueHeld: true,
  });
  const q = await snap(p);
  check('a restored panel draws the queue it is sent',
    JSON.stringify(q.names) === JSON.stringify(['1. restored task']), q);
  check('and the hold with it', q.start === true, q);
  checkPageClean(p, 'restored');
  await p.close();
}

// G. A long message and a long queue do not push the panel sideways.
{
  const p = await page(320, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    {
      type: 'queue',
      items: [
        'a very long queued instruction that goes on and on and would run off the edge of a narrow panel if nothing stopped it',
        'second', 'third', 'fourth',
      ],
      held: true,
    });
  await p.waitForTimeout(150);
  const over = await p.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    startVisible: !!document.querySelector('#queueRow .queue-start'),
  }));
  check('the queue does not make the panel scroll sideways', over.docOverflow === false, over);
  check('and the Start control is still reachable', over.startVisible === true, over);
  checkPageClean(p, 'narrow queue');
  await p.close();
}

// H. The TYPED path carries its message.
//
// This is the bug the field driver found before the field driver existed: typing
// '/queue fix the tests' opens the command menu (the '/' opens it), so Enter runs
// the highlighted row — and an earlier version sent that row with an empty
// payload, which queued nothing and answered with the usage note instead. The
// message has to survive both routes.
{
  const p = await page(620, S(undefined));
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'slash-meta', commands: [
      { id: 'compact', label: 'Compact', usage: '/compact', blurb: 'x' },
      { id: 'queue', label: 'Queue', usage: '/queue <message>', blurb: 'x' },
    ] });
  await p.waitForTimeout(150);
  const sent = await p.evaluate(() => {
    const q = document.getElementById('q');
    q.focus();
    q.value = '/queue fix the tests';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const posted = window.__posted;
    return posted.length > 0 ? posted[posted.length - 1] : null;
  });
  check('a typed /queue message arrives at the host with its text',
    sent !== null && sent.type === 'slash-run' && sent.id === 'queue'
      && sent.text === 'fix the tests', sent);
  checkPageClean(p, 'typed queue');
  await p.close();
}

// I. A bare /queue carries nothing, so the host can state the usage.
{
  const p = await page(620, S(undefined));
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'slash-meta', commands: [
      { id: 'queue', label: 'Queue', usage: '/queue <message>', blurb: 'x' },
    ] });
  await p.waitForTimeout(150);
  const sent = await p.evaluate(() => {
    const q = document.getElementById('q');
    q.focus();
    q.value = '/queue';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const posted = window.__posted;
    return posted.length > 0 ? posted[posted.length - 1] : null;
  });
  check('a bare /queue sends no message, rather than queueing the word "/queue"',
    sent !== null && sent.type === 'slash-run' && sent.id === 'queue'
      && sent.text === '', sent);
  checkPageClean(p, 'bare queue');
  await p.close();
}

await finish('queued messages');
