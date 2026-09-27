import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49aw: the run stopped because it is going in circles, and it is asking.
 *
 * This card is the ONLY interruption `auto` ever raises, and the whole point of
 * it is that a stuck run is never ended silently — a silent stop cannot be told
 * apart from a finished run, which is the failure this codebase keeps
 * re-learning. So the assertions that matter are about what the user can READ
 * and what they can DO:
 *
 *   - the card says what Plato was doing. Not "the same call repeated 5 times",
 *     which tells a person nothing, but the call itself.
 *   - both answers are available, and "Keep going" carries whatever the user
 *     typed, because the user usually knows what to do differently.
 *   - a reload while the run is still waiting REBUILDS the card. Without that
 *     the question leaves the screen while the host waits for an answer nobody
 *     can give any more — the user would be left hanging, which is the one
 *     outcome this feature must not produce.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const cardText = (p) => p.evaluate(() => {
  const c = document.querySelector('.card.stuck-card');
  return c ? c.textContent : '';
});

const cardButtons = (p) => p.evaluate(() => [...document.querySelectorAll('.card.stuck-card button')]
  .map((b) => b.textContent));

const posted = (p) => p.evaluate(() => window.__posted);

const REPEAT = {
  type: 'stuck',
  title: 'Plato is repeating itself',
  lines: [
    'It has made this same call 5 times in a row — shell: pnpm build — and got the same result every time.',
    'Running it again will not change anything.',
  ],
};

// A. It says what Plato was DOING. "The same call repeated 5 times" would be
//    true and useless; the call is the part a person can act on.
{
  const p = await page(900, S());
  await post(p, REPEAT);
  await p.waitForTimeout(250);
  const t = await cardText(p);
  check('the stuck card is drawn', t.length > 0, t);
  check('it names the call, not just "the same call"', /pnpm build/.test(t), t);
  check('it says how many times, in words', /5 times in a row/.test(t), t);
  check('it says why repeating will not help', /will not change anything/.test(t), t);
  const b = await cardButtons(p);
  check('it offers both answers', b.join('|') === 'Keep going|Stop', b);
  const ph = await p.evaluate(() => {
    const i = document.querySelector('.stuck-input');
    return i ? i.placeholder : '';
  });
  check('it offers somewhere to say what to do instead', /instead/.test(ph), ph);
  checkPageClean(p, 'stuck card');
  await p.close();
}

// B. "Keep going" carries the user's own words. This is the fastest way to
//    unstick a run — the user often knows the answer — so the box is not
//    decoration and the guidance must reach the host.
{
  const p = await page(900, S());
  await post(p, REPEAT);
  await p.waitForTimeout(220);
  await p.evaluate(() => {
    document.querySelector('.stuck-input').value = 'the lockfile is the problem';
  });
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.stuck-card button')]
      .find((b) => b.textContent === 'Keep going').click();
  });
  await p.waitForTimeout(180);
  const all = await posted(p);
  const ans = all.find((m) => m.type === 'stuck-answer');
  check('keep going answers the host', ans && ans.value === 'continue', all);
  check('and it carries what the user typed',
    ans && ans.guidance === 'the lockfile is the problem', ans);
  check('the card stops accepting answers once it is answered',
    (await cardButtons(p)).length === 0, await cardText(p));
  // The card STAYS as the record — so it must be marked answered, or anything
  // watching for the question (the field harness, and the host) sees a spent
  // card as a live one and waits for an answer that already arrived. Found by
  // field case 12, which read the answered card as "still waiting".
  check('and it is marked answered, so nothing waits on it any more',
    await p.evaluate(() => {
      const c = document.querySelector('.card.stuck-card');
      return c ? c.classList.contains('answered') : false;
    }), await cardText(p));
  checkPageClean(p, 'keep going');
  await p.close();
}

// C. Stop is a real answer, and it is what the user chose — never a default.
{
  const p = await page(900, S());
  await post(p, REPEAT);
  await p.waitForTimeout(220);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.stuck-card button')]
      .find((b) => b.textContent === 'Stop').click();
  });
  await p.waitForTimeout(180);
  const all = await posted(p);
  const ans = all.find((m) => m.type === 'stuck-answer');
  check('stop answers the host', ans && ans.value === 'stop', all);
  check('the card says it stopped', /stopped/.test(await cardText(p)), await cardText(p));
  checkPageClean(p, 'stop');
  await p.close();
}

// D. THE ONE THAT MATTERS MOST: a reload while the run is waiting rebuilds the
//    card. Without this the question vanishes off the screen while the host
//    still waits on a promise nobody can resolve — the user is stuck with no way
//    out, which is exactly what this feature must never do.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'do the thing' },
      {
        k: 'stuck-open',
        title: '5 turns in a row have failed',
        lines: [
          'The last 5 turns all failed — 9 calls, none of them worked.',
          'The last call that worked was write_file: src/DateHelper.java.',
        ],
      },
    ],
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(320);
  const t = await cardText(p);
  check('a reload while the run waits rebuilds the card', t.length > 0, t);
  check('and it still says what last worked', /DateHelper/.test(t), t);
  check('and it is still answerable',
    (await cardButtons(p)).join('|') === 'Keep going|Stop', await cardButtons(p));
  checkPageClean(p, 'reload');
  await p.close();
}

// E. Cancel takes the card with it, exactly as it does for a question.
{
  const p = await page(900, S());
  await post(p, REPEAT);
  await p.waitForTimeout(220);
  check('the card is up before the cancel', (await cardText(p)).length > 0);
  await post(p, { type: 'stuck-done' });
  await p.waitForTimeout(220);
  check('cancel takes the card away, leaving no answer hanging',
    (await cardText(p)).length === 0, await cardText(p));
  checkPageClean(p, 'stuck-done');
  await p.close();
}

console.log('');
await finish('stuck');
