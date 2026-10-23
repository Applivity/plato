import {
  check,
  page,
  S,
  finish,
  checkPageClean,
  approvalHeading,
  approvalAllowAll,
  approvalAnswered,
  approvalAnsweredSession,
} from './plib.mjs';

/**
 * D49cg: the three approval-lifecycle defects, on the real DOM.
 *
 * 1. A queued run starts in the HOST, so the page never saw an `ask`. The host
 *    now sends `queue-run`; the page must show the task and the same run UI a
 *    user's send shows, or Pause and Cancel stay hidden for the whole run.
 * 2. A cancel must CLOSE the approval card. Its buttons used to stay live after
 *    the run was gone, so a click answered a dead run.
 * 3. A fold re-renders the conversation from the log. A rebuilt approval card
 *    must be spent, not live — and an old log with an open row and no close
 *    must rebuild non-interactive, because the host is not waiting on it.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const card = (tool, args) => ({
  type: 'approval',
  tool,
  sessionKey: tool,
  heading: approvalHeading(tool, args),
  allowAll: approvalAllowAll(tool),
  headingAllowed: approvalAnswered(approvalHeading(tool, args), true),
  headingDenied: approvalAnswered(approvalHeading(tool, args), false),
  headingSession: approvalAnsweredSession(approvalHeading(tool, args)),
  preview: args.preview ?? 'preview',
});

const runUi = (p) => p.evaluate(() => ({
  pauseHidden: document.getElementById('pp').hidden,
  cancelHidden: document.getElementById('cx').hidden,
  pauseLabel: document.getElementById('pp').textContent,
  placeholder: document.getElementById('q').placeholder,
  status: document.getElementById('statusbar')?.textContent ?? '',
  lastUser: [...document.querySelectorAll('#log .msg.you')].slice(-1).map((e) => e.textContent)[0] ?? '',
  posted: window.__posted.slice(),
}));

// A. A queued run shows the task and the run controls, and both controls post.
{
  const p = await page(620, S());
  await post(p, { type: 'queue-run', text: 'Queued follow-up message' });
  await p.waitForTimeout(200);
  const ui = await runUi(p);
  check('a queued run shows its message as the user\'s', ui.lastUser.includes('Queued follow-up message'), ui.lastUser);
  check('a queued run shows Pause', ui.pauseHidden === false, ui);
  check('a queued run shows Cancel', ui.cancelHidden === false, ui);
  check('and the composer becomes the guide box', /Guide Plato mid-run/.test(ui.placeholder), ui.placeholder);
  check('and the status says Plato is working', /thinking/i.test(ui.status), ui.status);

  await p.evaluate(() => document.getElementById('pp').click());
  await p.waitForTimeout(120);
  const afterPause = await p.evaluate(() => window.__posted.slice(-1)[0] ?? null);
  check('Pause during a queued run posts a pause', afterPause && afterPause.type === 'pause', afterPause);

  await p.evaluate(() => document.getElementById('cx').click());
  await p.waitForTimeout(120);
  const afterCancel = await p.evaluate(() => window.__posted.slice(-1)[0] ?? null);
  check('Cancel during a queued run posts a cancel', afterCancel && afterCancel.type === 'cancel', afterCancel);
  checkPageClean(p, 'queued run');
  await p.close();
}

// B. `approval-done` closes the card: buttons gone, heading says cancelled.
{
  const p = await page(620, S());
  await post(p, card('write_file', { path: 'src/a.ts', content: 'x' }));
  await p.waitForTimeout(200);
  const live = await p.evaluate(() => ({
    buttons: document.querySelectorAll('.card.approval-card button').length,
    answered: document.querySelectorAll('.card.approval-card.answered').length,
  }));
  check('the card starts live with its three choices', live.buttons === 3 && live.answered === 0, live);

  await post(p, { type: 'approval-done', text: 'Let Plato write src/a.ts — cancelled' });
  await p.waitForTimeout(200);
  const closed = await p.evaluate(() => {
    const c = document.querySelector('.card.approval-card');
    return {
      answered: c ? c.classList.contains('answered') : false,
      heading: c ? c.querySelector('h3').textContent : '',
      buttons: c ? c.querySelectorAll('button').length : -1,
      posted: window.__posted.slice(),
    };
  });
  check('a cancelled card is marked answered', closed.answered === true, closed);
  check('and says it was cancelled, not denied',
    closed.heading === 'Let Plato write src/a.ts — cancelled', closed.heading);
  check('and has no buttons left', closed.buttons === 0, closed.buttons);
  check('and closing it posts no answer',
    closed.posted.every((m) => m.type !== 'approve' && m.type !== 'approve-all'), closed.posted);
  checkPageClean(p, 'cancelled card');
  await p.close();
}

// C. A replayed open/close pair rebuilds a SPENT card, never a live one.
{
  const p = await page(620, S());
  const heading = approvalHeading('write_file', { path: 'src/a.ts' });
  await post(p, {
    type: 'restore',
    hasConnections: true,
    mode: 'edit',
    queue: [],
    queueHeld: false,
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'Write it.' },
      {
        k: 'card-open',
        tool: 'write_file',
        preview: 'x',
        heading,
        allowAll: approvalAllowAll('write_file'),
      },
      { k: 'card-done', title: approvalAnswered(heading, true), preview: 'x' },
    ],
  });
  await p.waitForTimeout(250);
  const replayed = await p.evaluate(() => ({
    live: document.querySelectorAll('.card.approval-card:not(.answered)').length,
    spent: document.querySelectorAll('.card.approval-card.answered').length,
    heading: document.querySelector('.card.approval-card.answered h3')?.textContent ?? '',
    buttons: document.querySelectorAll('.card.approval-card button').length,
  }));
  check('a replayed spent card is not live', replayed.live === 0, replayed);
  check('and the pair rebuilds one answered card', replayed.spent === 1, replayed);
  check('carrying its answered heading', /— allowed$/.test(replayed.heading), replayed.heading);
  check('with no buttons to answer again', replayed.buttons === 0, replayed.buttons);
  checkPageClean(p, 'replayed pair');
  await p.close();
}

// D. An old log with an open row and NO close rebuilds non-interactive.
//
// The state it ended in is unknown, and the host is not waiting on it, so the
// only safe rebuild is a spent card.
{
  const p = await page(620, S());
  const heading = approvalHeading('write_file', { path: 'src/b.ts' });
  await post(p, {
    type: 'restore',
    hasConnections: true,
    mode: 'edit',
    queue: [],
    queueHeld: false,
    log: [
      {
        k: 'card-open',
        tool: 'write_file',
        preview: 'x',
        heading,
        allowAll: approvalAllowAll('write_file'),
      },
    ],
  });
  await p.waitForTimeout(250);
  const legacy = await p.evaluate(() => ({
    live: document.querySelectorAll('.card.approval-card:not(.answered)').length,
    buttons: document.querySelectorAll('.card.approval-card button').length,
    heading: document.querySelector('.card.approval-card.answered h3')?.textContent ?? '',
  }));
  check('a lone open row does not rebuild a live card', legacy.live === 0, legacy);
  check('and has no buttons', legacy.buttons === 0, legacy.buttons);
  check('and keeps the question it asked', legacy.heading === heading, legacy.heading);
  checkPageClean(p, 'legacy open');
  await p.close();
}

await finish('approval lifecycle');
