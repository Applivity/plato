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
 * D49t: the run's elapsed time moved out of the header (where it sat as a second
 * chip beside Solo / new) and into the pinned run-status bar at the end of the
 * conversation — the bar that already says what Plato is doing. One place to
 * look while a run is in flight.
 *
 * These assertions drive a REAL send, because `busy` and `runT0` — the things the
 * timer reads — are set by the composer, not by any inbound message.
 */

/** Sends a message the way a user does, so the run actually starts. */
async function send(p, text) {
  await p.evaluate((t) => {
    const q = document.getElementById('q');
    q.value = t;
    q.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await p.evaluate(() => {
    document.getElementById('go').click();
  });
  await p.waitForTimeout(200);
}

const snap = (p) => p.evaluate(() => {
  const bar = document.getElementById('statusbar');
  return {
    headerChip: document.querySelectorAll('#st').length,
    hidden: bar ? bar.hidden : null,
    text: bar ? (bar.querySelector('.stext') || {}).textContent : null,
    elapsed: bar ? (bar.querySelector('.selapsed') || {}).textContent : null,
    done: bar ? bar.classList.contains('done') : null,
  };
});

// A. The header chip is gone; the timer is on the status bar.
{
  const p = await page(620, S());
  const before = await snap(p);
  check('the header no longer carries a separate timer chip',
    before.headerChip === 0, before);
  check('and nothing is showing before a run starts', before.hidden === true, before);
  checkPageClean(p, 'idle');
  await p.close();
}

// B. Mid-run: the bar is up, carries the status AND the seconds.
{
  const p = await page(620, S());
  await send(p, 'review these files');
  const running = await snap(p);
  check('the status bar is visible while running', running.hidden === false, running);
  check('it says what Plato is doing', running.text === 'Plato is thinking', running);
  check('it carries the elapsed time too', /^\d+s$/.test(running.elapsed || ''), running);
  check('and it is not marked done', running.done === false, running);
  checkPageClean(p, 'running');
  await p.close();
}

// C. The seconds actually tick.
{
  const p = await page(620, S());
  await send(p, 'a long job');
  await p.waitForTimeout(1100);
  const t1 = await snap(p);
  await p.waitForTimeout(1100);
  const t2 = await snap(p);
  const secs = (x) => parseInt(String(x.elapsed).replace('s', ''), 10);
  check('the elapsed time advances', secs(t2) > secs(t1), { t1: t1.elapsed, t2: t2.elapsed });
  checkPageClean(p, 'ticking');
  await p.close();
}

// D. Done: the same bar reports the finish, in the done colour, with no timer.
{
  const p = await page(620, S());
  await send(p, 'quick job');
  await p.evaluate((x) =>
    window.dispatchEvent(new MessageEvent('message', { data: x })),
  { type: 'done', text: { secs: 3, tools: 1 } });
  await p.waitForTimeout(200);
  const after = await snap(p);
  check('the bar stays up after the run', after.hidden === false, after);
  check('it reports the finish', /done in 3s/.test(after.text || ''), after);
  check('it is marked done', after.done === true, after);
  check('the timer is cleared once it is over', after.elapsed === '', after);
  checkPageClean(p, 'done');
  await p.close();
}

// E. D49bm: the pause button reports the RUN, and never the click.
//
// The defect this exists for: the button flipped its own label to "Resume" the
// instant it was clicked, so it claimed the run had stopped while only a
// REQUEST had been recorded — and when the run ended before any safe point, it
// claimed a pause that never happened. So the assertion that matters is the one
// right after the click, and it is that the label is NOT "Resume".
{
  const p = await page(620, S());
  const snapP = () => p.evaluate(() => {
    const btn = document.getElementById('pp');
    const bar = document.getElementById('statusbar');
    const dot = bar ? bar.querySelector('.pdot') : null;
    const posted = window.__posted;
    return {
      hidden: btn.hidden,
      label: btn.textContent,
      title: btn.title,
      status: bar ? (bar.querySelector('.stext') || {}).textContent : null,
      paused: bar ? bar.classList.contains('paused') : null,
      dotAnim: dot ? getComputedStyle(dot).animationName : null,
      last: posted.length > 0 ? posted[posted.length - 1] : null,
    };
  });
  const post = (x) => p.evaluate(
    (m) => window.dispatchEvent(new MessageEvent('message', { data: m })), x);
  const click = () => p.evaluate(() => { document.getElementById('pp').click(); });

  await send(p, 'a long job');
  const started = await snapP();
  check('the pause button appears with the run', started.hidden === false, started);
  check('and it offers to pause', started.label === 'Pause', started);
  check('and its tooltip is the terminal\'s sentence, word for word',
    started.title === 'Pause after the current step. Nothing is lost.', started);

  await click();
  const asked = await snapP();
  check('a click asks to pause and does NOT claim the run has stopped',
    asked.label === 'Pausing…', asked);
  check('and it says the click can be taken back',
    /cancel the pause/i.test(asked.title || ''), asked);
  check('the request reaches the host',
    asked.last !== null && asked.last.type === 'pause', asked);
  check('the status line does not say paused yet',
    asked.status !== 'Paused', asked);

  // The host's account of the run: only now is it genuinely parked.
  await post({ type: 'pause-state', text: { parked: true } });
  await p.waitForTimeout(120);
  const parked = await snapP();
  check('when the host reports the park, the button offers to resume',
    parked.label === 'Resume', parked);
  check('and the status line says paused, not what it was doing',
    /^Paused\b/.test(parked.status || ''), parked);
  check('and it says a pause does not survive closing the window',
    /does not survive closing this window/.test(parked.status || ''), parked);
  check('and the busy dot stops pulsing while parked',
    parked.paused === true && parked.dotAnim === 'none', parked);

  // A fragment can still be streaming behind the park. It must not repaint
  // "writing" over the line that says the run is paused.
  await post({ type: 'md', text: 'a late fragment' });
  await p.waitForTimeout(120);
  const stillParked = await snapP();
  check('a streamed fragment does not repaint writing over the paused line',
    /^Paused\b/.test(stillParked.status || '') && stillParked.paused === true, stillParked);

  await click();
  const released = await snapP();
  check('clicking Resume releases at once', released.label === 'Pause', released);
  check('and the release reaches the host',
    released.last !== null && released.last.type === 'resume', released);
  // The flags are cleared together, so a second click cannot arrive while the
  // first round trip is out and re-pause the run the user just let go.
  await click();
  const again = await snapP();
  check('a second click pauses again rather than repeating the release',
    again.label === 'Pausing…' && again.last.type === 'pause', again);

  await post({ type: 'pause-state', text: { parked: false } });
  const resumed = await snapP();
  check('releasing the pause starts the busy dot again',
    resumed.paused === false && resumed.dotAnim === 'platoPulse', resumed);
  await post({ type: 'done', text: { secs: 2, tools: 1 } });
  await p.waitForTimeout(150);
  const after = await snapP();
  check('the end of the run takes the button away and clears the label',
    after.hidden === true && after.label === 'Pause', after);
  checkPageClean(p, 'pause');
  await p.close();
}

// G. The park screen: a philosopher's note replaces the mechanism wording and
// is offered back to the empty composer. A user's own pause carries no note.
// `S({ open: false })` keeps the chat surface on screen so the composer can
// take focus; the payload still carries the provider, so the run can start.
{
  const p = await page(620, S({ open: false }));
  const post = (x) => p.evaluate(
    (m) => window.dispatchEvent(new MessageEvent('message', { data: m })), x);
  const snapN = () => p.evaluate(() => {
    const q = document.getElementById('q');
    const offer = document.getElementById('noteOffer');
    return {
      placeholder: q.placeholder,
      value: q.value,
      focused: document.activeElement === q,
      offerHidden: offer ? offer.hidden : null,
      offerText: offer ? offer.textContent : null,
    };
  });
  const GUIDE = 'Guide Plato mid-run… (injected at the next safe point)';
  const PLAIN = 'Tell Plato what to do differently, then press Resume.';
  const NOTE =
    'The coder is about to write checkout.js, and price rules live in pricing.js.';

  await send(p, 'a long job');

  // The user's own pause: parked, but no note. It must read as the guide box,
  // with no offer — a note is a philosopher's, never the user's own pause.
  await post({ type: 'pause-state', text: { parked: true } });
  await p.waitForTimeout(120);
  const own = await snapN();
  check('a park with no note keeps the guide placeholder',
    own.placeholder === GUIDE, own);
  check('and shows no note offer', own.offerHidden === true, own);

  // A philosopher's park: plain instruction, and the note offered by name.
  await post({ type: 'pause-state', text: { parked: true, note: NOTE, by: 'Aristotle' } });
  await p.waitForTimeout(120);
  const offered = await snapN();
  check('a philosopher\'s park replaces the mechanism wording with a plain instruction',
    offered.placeholder === PLAIN, offered);
  check('and offers the note under the speaker\'s name',
    offered.offerHidden === false && offered.offerText === "Use Aristotle's note", offered);

  // Clicking fills the composer, focuses it, and the offer leaves.
  await p.bringToFront(); // headless can leave a fresh page unfocused
  await p.evaluate(() => document.getElementById('noteOffer').click());
  await p.waitForTimeout(120);
  const filled = await snapN();
  check('clicking the offer fills the composer with the note',
    filled.value === NOTE, filled);
  check('and focuses the composer so the user can edit it', filled.focused === true, filled);
  check('and the offer hides once the composer has text',
    filled.offerHidden === true, filled);

  // Text already typed: the offer must not appear over it, and must never
  // replace it.
  await p.evaluate(() => {
    const q = document.getElementById('q');
    q.value = 'make it use pricing.js';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await post({ type: 'pause-state', text: { parked: true, note: NOTE, by: 'Aristotle' } });
  await p.waitForTimeout(120);
  const typed = await snapN();
  check('the offer is absent when the composer already has text',
    typed.offerHidden === true, typed);
  check('and the text the user typed is untouched',
    typed.value === 'make it use pricing.js', typed);

  // Resume takes what the user typed with it. The park's own instruction says
  // to type a redirect and press Resume, so the words must leave the composer
  // on that click — the CLI's /continue <text> is the same contract.
  await p.evaluate(() => { document.getElementById('pp').click(); });
  await p.waitForTimeout(120);
  const released = await p.evaluate(() => {
    const posted = window.__posted;
    return {
      last: posted.length > 0 ? posted[posted.length - 1] : null,
      value: document.getElementById('q').value,
    };
  });
  check('pressing Resume sends the typed note with the release',
    released.last !== null && released.last.type === 'resume'
      && released.last.note === 'make it use pricing.js', released);
  check('and the composer is empty again', released.value === '', released);

  // Resume clears the park wording and the offer.
  await post({ type: 'pause-state', text: { parked: false } });
  await p.waitForTimeout(120);
  const resumed = await snapN();
  check('resuming restores the guide placeholder', resumed.placeholder === GUIDE, resumed);
  check('and takes the note offer away', resumed.offerHidden === true, resumed);

  await post({ type: 'done', text: { secs: 2, tools: 1 } });
  await p.waitForTimeout(150);
  checkPageClean(p, 'park note');
  await p.close();
}

// F. The controls' words, and Esc on the run surface doing nothing to the run.
//
// A window with buttons does not need the keyboard to duplicate them. Esc in a
// GUI means close/dismiss/an edit; it must not pause or stop a run. The menu
// and card checks below prove the parts that DO own Esc still do.
// `S({ open: false })` keeps the chat surface on screen; the payload still
// carries the provider, so the composer can send.
{
  const p = await page(620, S({ open: false }));
  const state = () => p.evaluate(() => ({
    pp: document.getElementById('pp').textContent,
    ppTitle: document.getElementById('pp').title,
    stop: document.getElementById('cx').textContent,
    stopTitle: document.getElementById('cx').title,
    hidden: document.getElementById('pp').hidden,
    posted: window.__posted.slice(),
  }));

  await send(p, 'a long job');
  const idle = await state();
  check('the run-stop control reads Stop', idle.stop === 'Stop', idle);
  check('and its tooltip is the terminal\'s sentence, word for word',
    idle.stopTitle === 'Stop the task. The conversation stays.', idle);
  check('and the pause tooltip is the terminal\'s sentence, word for word',
    idle.ppTitle === 'Pause after the current step. Nothing is lost.', idle);

  await p.evaluate(() => document.getElementById('q').focus());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const afterEsc = await state();
  check('Esc on the run surface does not pause or stop the run',
    afterEsc.posted.every((m) => m.type !== 'pause' && m.type !== 'cancel'), afterEsc);
  check('and the controls are still the live run\'s controls',
    afterEsc.hidden === false && afterEsc.pp === 'Pause', afterEsc);
  checkPageClean(p, 'esc on the run surface');
  await p.close();
}

// H. Esc in an open menu closes the menu and does NOT pause.
{
  const p = await page(620, S({ open: false }));
  await send(p, 'a long job');
  await p.evaluate(() => document.getElementById('modelBtn').click());
  await p.waitForTimeout(250);
  const openBefore = await p.evaluate(() => document.querySelectorAll('.popover.open').length);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => ({
    open: document.querySelectorAll('.popover.open').length,
    posted: window.__posted.slice(),
  }));
  check('the model menu was open before the press', openBefore > 0, openBefore);
  check('Esc closes the open model menu', after.open === 0, after);
  check('and that press does not also pause or stop the run',
    after.posted.every((m) => m.type !== 'pause' && m.type !== 'cancel'), after);
  checkPageClean(p, 'esc on a menu');
  await p.close();
}

// I. Esc on a live card leaves both the card and the run alone.
{
  const p = await page(620, S({ open: false }));
  const post = (x) => p.evaluate((m) => window.dispatchEvent(
    new MessageEvent('message', { data: m })), x);
  await send(p, 'a long job');
  const heading = approvalHeading('write_file', { path: 'a.txt' });
  await post({
    type: 'approval',
    tool: 'write_file',
    sessionKey: 'write_file',
    heading,
    allowAll: approvalAllowAll('write_file'),
    headingAllowed: approvalAnswered(heading, true),
    headingDenied: approvalAnswered(heading, false),
    headingSession: approvalAnsweredSession(heading),
    preview: 'x',
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById('q').focus());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const after = await p.evaluate(() => ({
    buttons: document.querySelectorAll('.card.approval-card:not(.answered) button').length,
    posted: window.__posted.slice(),
  }));
  check('a live card keeps Esc to itself', after.buttons === 3, after);
  check('and the run was not paused or stopped behind it',
    after.posted.every((m) => m.type !== 'pause' && m.type !== 'cancel'), after);
  checkPageClean(p, 'esc on a card');
  await p.close();
}

await finish('run status');
