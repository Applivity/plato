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

await finish('run status');
