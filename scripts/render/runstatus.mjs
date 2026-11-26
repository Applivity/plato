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

// E. The footer is at most two controls, and the park is the only moment the
// run has really stopped.
//
// D49bm is why: the old button flipped its own label to "Resume" on the click,
// claiming a stop that had only been requested. Now the footer is drawn from
// facts — a run is live, the run is parked, a pause was asked for, the box has
// words — and the claims that matter are: Pause while working with an empty
// box; Pausing… and disabled once asked, cancelling nothing; Stop and Resume
// once parked, with Resume as the primary.
//
// The chat page, not the Settings page: `S()` opens Settings, and the footer
// then sits inside a `display:none` ancestor. Visibility checks read that,
// correctly — a control nobody can see is not on screen.
{
  const p = await page(620, S({ open: false }));
  const snapP = () => p.evaluate(() => {
    const pp = document.getElementById('pp');
    const go = document.getElementById('go');
    const goLabel = go ? go.querySelector('.btn-send-label') : null;
    const cx = document.getElementById('cx');
    const bar = document.getElementById('statusbar');
    const dot = bar ? bar.querySelector('.pdot') : null;
    // VISIBILITY, not the attribute. `.btn-send` is display:inline-flex in the
    // page's own CSS, which outranks the user agent's `[hidden]` rule — so a
    // hidden primary once stayed on screen beside Pause and Stop while every
    // `el.hidden` read true. The count has to mean what a person sees.
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const shown = [pp, go, cx].filter(visible).length;
    const posted = window.__posted;
    return {
      pp: { hidden: !visible(pp), label: pp.textContent.trim(), title: pp.title, disabled: pp.disabled },
      go: {
        hidden: !visible(go),
        label: (goLabel ? goLabel.textContent : go.textContent).trim(),
        disabled: go.disabled,
      },
      stop: { hidden: !visible(cx), label: cx.textContent.trim() },
      shown,
      status: bar ? (bar.querySelector('.stext') || {}).textContent : null,
      paused: bar ? bar.classList.contains('paused') : null,
      dotAnim: dot ? getComputedStyle(dot).animationName : null,
      last: posted.length > 0 ? posted[posted.length - 1] : null,
      posted: posted.slice(),
    };
  });
  const post = (x) => p.evaluate(
    (m) => window.dispatchEvent(new MessageEvent('message', { data: m })), x);
  const clickPp = () => p.evaluate(() => { document.getElementById('pp').click(); });
  const clickGo = () => p.evaluate(() => { document.getElementById('go').click(); });

  await send(p, 'a long job');
  const started = await snapP();
  check('while working with an empty box the footer offers Pause and Stop',
    started.pp.hidden === false && started.pp.label === 'Pause'
      && started.stop.hidden === false && started.stop.label === 'Stop',
    started);
  check('and the primary is not a third control',
    started.go.hidden === true && started.shown === 2, started);

  await clickPp();
  const asked = await snapP();
  check('a click asks to pause and does NOT claim the run has stopped',
    asked.pp.label === 'Pausing…' && asked.go.hidden === true, asked);
  check('and the label is disabled, so a second click cannot ask twice',
    asked.pp.disabled === true, asked);
  check('and the click cancels nothing, because it cannot be taken back',
    asked.posted.every((m) => m.type !== 'cancel') && asked.last.type === 'pause', asked);
  check('the status line does not say paused yet',
    !/^Paused\b/.test(asked.status || ''), asked);

  // The host's account of the run: only now is it genuinely parked.
  await post({ type: 'pause-state', text: { parked: true } });
  await p.waitForTimeout(120);
  const parked = await snapP();
  check('when the host reports the park, the footer is Stop and Resume',
    parked.stop.hidden === false && parked.stop.label === 'Stop'
      && parked.go.hidden === false && parked.go.label === 'Resume', parked);
  check('and Resume is the primary, with Pause gone',
    parked.pp.hidden === true && parked.shown === 2, parked);
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

  await clickGo();
  const released = await snapP();
  check('clicking Resume releases at once',
    released.pp.hidden === false && released.pp.label === 'Pause', released);
  check('and the release reaches the host',
    released.last !== null && released.last.type === 'resume'
      && released.last.note === undefined, released);

  await post({ type: 'pause-state', text: { parked: false } });
  const resumed = await snapP();
  check('releasing the pause starts the busy dot again',
    resumed.paused === false && resumed.dotAnim === 'platoPulse', resumed);
  await post({ type: 'done', text: { secs: 2, tools: 1 } });
  await p.waitForTimeout(150);
  const after = await snapP();
  check('the end of the run takes the run controls away',
    after.pp.hidden === true && after.stop.hidden === true
      && after.go.hidden === false && after.go.label === 'Send', after);
  check('and the primary is greyed and unclickable while idle and empty',
    after.go.disabled === true, after);
  checkPageClean(p, 'pause');
  await p.close();
}

// E2. With words in the box the footer is Stop and Send: the user's text is the
// next thing to send, so Pause gives way rather than hiding the primary.
{
  const p = await page(620, S({ open: false }));
  const snapF = () => p.evaluate(() => {
    // Visibility, for the same reason as section E: the page's own CSS can
    // outrank `[hidden]`, so the attribute is not what a person sees.
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const go = document.getElementById('go');
    const goLabel = go ? go.querySelector('.btn-send-label') : null;
    return {
      ppHidden: !visible(document.getElementById('pp')),
      goHidden: !visible(go),
      goLabel: goLabel ? goLabel.textContent : null,
      stopHidden: !visible(document.getElementById('cx')),
      goDisabled: go.disabled,
    };
  });
  await send(p, 'a long job');
  await p.evaluate(() => {
    const q = document.getElementById('q');
    q.value = 'use pricing.js';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(120);
  const typed = await snapF();
  check('typing during a run makes the footer Stop and Send',
    typed.ppHidden === true && typed.stopHidden === false
      && typed.goHidden === false && typed.goLabel === 'Send', typed);
  check('and the primary is live again, because there is something to send',
    typed.goDisabled === false, typed);
  checkPageClean(p, 'typed during a run');
  await p.close();
}

// G. The park screen: one sentence with a live phrase, drawn in the composer.
// A philosopher's note is offered back by name; a park without one says what to
// do next and offers nothing. The click fills the box and sends nothing — the
// Resume press is the person's own.
// `S({ open: false })` keeps the chat surface on screen so the composer can
// take focus; the payload still carries the provider, so the run can start.
{
  const p = await page(620, S({ open: false }));
  const post = (x) => p.evaluate(
    (m) => window.dispatchEvent(new MessageEvent('message', { data: m })), x);
  const snapN = () => p.evaluate(() => {
    const q = document.getElementById('q');
    const hint = document.getElementById('parkHint');
    const use = document.getElementById('parkHintUse');
    // The sentence is checked the way it is seen: a page rule can outrank
    // `[hidden]`, so the attribute alone would not prove it is off screen.
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return {
      placeholder: q.placeholder,
      value: q.value,
      focused: document.activeElement === q,
      hintHidden: !visible(hint),
      hintText: hint ? hint.textContent : null,
      phrase: use ? use.textContent : null,
      posted: window.__posted.slice(),
    };
  });
  const GUIDE = 'Guide Plato mid-run… (injected at the next safe point)';
  const PLAIN = 'Tell Plato what to do differently, then press Resume.';
  const NOTE =
    'The coder is about to write checkout.js, and price rules live in pricing.js.';

  await send(p, 'a long job');
  const working = await snapN();
  check('while working the box keeps the guide wording and no sentence',
    working.placeholder === GUIDE && working.hintHidden === true, working);

  // The user's own pause: parked, but no note. It must read as the plain
  // instruction, with no phrase — a note is a philosopher's, never the user's.
  await post({ type: 'pause-state', text: { parked: true } });
  await p.waitForTimeout(120);
  const own = await snapN();
  check('a park with no note keeps the plain park wording',
    own.placeholder === PLAIN, own);
  check('and shows no phrase', own.hintHidden === true, own);

  // A philosopher's park: one sentence, with the phrase live inside it.
  await post({ type: 'pause-state', text: { parked: true, note: NOTE, by: 'Aristotle' } });
  await p.waitForTimeout(120);
  const offered = await snapN();
  check('a philosopher\'s park draws one sentence with a live phrase',
    offered.hintHidden === false
      && offered.hintText ===
        "Tell Plato what to do differently — or use Aristotle's note — then press Resume.",
    offered);
  check('and the phrase names the speaker', offered.phrase === "use Aristotle's note", offered);
  check('and the sentence stands in the box, so it cannot sit over the placeholder',
    offered.placeholder === '', offered);

  // Clicking the phrase fills the box, focuses it, and sends nothing.
  await p.bringToFront(); // headless can leave a fresh page unfocused
  await p.evaluate(() => document.getElementById('parkHintUse').click());
  await p.waitForTimeout(120);
  const filled = await snapN();
  check('clicking the phrase fills the composer with the note',
    filled.value === NOTE, filled);
  check('and focuses the composer so the user can edit it', filled.focused === true, filled);
  check('and the click sends nothing',
    filled.posted.length === offered.posted.length, filled);

  // Typing hides the sentence and the plain park wording comes back.
  await p.evaluate(() => {
    const q = document.getElementById('q');
    q.value = 'make it use pricing.js';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(120);
  const typed = await snapN();
  check('typing hides the sentence', typed.hintHidden === true, typed);
  check('and the park wording returns to the box', typed.placeholder === PLAIN, typed);
  check('and the text the user typed is untouched',
    typed.value === 'make it use pricing.js', typed);

  // Resume takes the box's words with it. The park's sentence says to press
  // Resume, so the words must leave the composer on that click — the CLI's
  // /continue <text> is the same contract.
  await p.evaluate(() => { document.getElementById('go').click(); });
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

  // Resume clears the park wording and the sentence.
  await post({ type: 'pause-state', text: { parked: false } });
  await p.waitForTimeout(120);
  const resumed = await snapN();
  check('resuming restores the guide placeholder', resumed.placeholder === GUIDE, resumed);
  check('and takes the sentence away', resumed.hintHidden === true, resumed);

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
  const state = () => p.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return {
      pp: document.getElementById('pp').textContent.trim(),
      ppTitle: document.getElementById('pp').title,
      stop: document.getElementById('cx').textContent.trim(),
      stopTitle: document.getElementById('cx').title,
      hidden: !visible(document.getElementById('pp')),
      posted: window.__posted.slice(),
    };
  });

  await send(p, 'a long job');
  const idle = await state();
  check('the run-stop control reads Stop', idle.stop === 'Stop', idle);
  check('and its tooltip is the terminal\'s sentence, word for word',
    idle.stopTitle === 'End this run now — the conversation stays.', idle);
  check('and the pause tooltip is the terminal\'s sentence, word for word',
    idle.ppTitle === 'Pause after the current step — the run waits for Resume.', idle);

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
