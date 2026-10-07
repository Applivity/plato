import { check, page, S, finish, checkPageClean } from './plib.mjs';

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
    const posted = window.__posted;
    return {
      hidden: btn.hidden,
      label: btn.textContent,
      title: btn.title,
      status: bar ? (bar.querySelector('.stext') || {}).textContent : null,
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
    parked.status === 'Paused', parked);

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
  await post({ type: 'done', text: { secs: 2, tools: 1 } });
  await p.waitForTimeout(150);
  const after = await snapP();
  check('the end of the run takes the button away and clears the label',
    after.hidden === true && after.label === 'Pause', after);
  checkPageClean(p, 'pause');
  await p.close();
}

await finish('run status');
