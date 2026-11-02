import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49aw: the run stopped because it is going in circles, and it is asking.
 *
 * This card is the ONLY interruption `auto` ever raises, and the whole point of
 * it is that a stuck run is never ended silently — a silent stop cannot be told
 * apart from a finished run, which is the failure this codebase keeps
 * re-learning.
 *
 * **The founder read the first version of this copy and rejected it as vague and
 * a dead end**: "It has been asked to try something else" and "Running it again
 * will not change anything" describe what Plato did to itself and stop there.
 * The assertions below therefore pin the shape the second version has, and the
 * load-bearing one is `help` — a card that says what went wrong but not what the
 * user can do about it is exactly the failure he flagged.
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

/** The card as the host sends it: what happened, the call, and the way out. */
const REPEAT = {
  type: 'stuck',
  title: 'Plato is stuck',
  lead: 'It has made the same call 5 times and got the same answer every time:',
  call: 'running pnpm build',
  // M4a: the host now sends the FULL core copy, including the sentence that
  // says what Keep going does. The fixture used to stop at the first way out,
  // so the card could lose the second one and this suite would not see it.
  help: 'Repeating it will only give the same answer. Tell Plato what to do instead, or press Stop and rephrase your request. Keep going resumes the run, and Plato will not ask about this same call again.',
};

const NOPROGRESS = {
  type: 'stuck',
  title: '5 turns in a row have failed',
  lead: 'Nothing has worked in the last 5 turns — 9 calls, and none of them succeeded.',
  detail: 'The last thing that worked was writing src/DateHelper.java.',
  help: 'Trying the same things again will not help. Tell Plato what to do instead, or press Stop and rephrase your request.',
};

// A. It says what happened, WHICH call, and what the user can do. The last one is
//    the part the first version of this copy was missing.
{
  const p = await page(900, S());
  await post(p, REPEAT);
  await p.waitForTimeout(250);
  const t = await cardText(p);
  check('the stuck card is drawn', t.length > 0, t);
  const heading = await p.evaluate(() => {
    const h = document.querySelector('.card.stuck-card h3');
    return h ? h.textContent : '';
  });
  check('the title is the product copy', heading === 'Plato is stuck', heading);
  check('it names the call, not just "the same call"', /pnpm build/.test(t), t);
  check('it says how many times', /5 times/.test(t), t);
  check('it says what Keep going does as well as what it says',
    /Keep going resumes the run/.test(t) && /will not ask about this same call again/.test(t), t);
  // The call gets its own element, so "which call" is answerable at a glance.
  const callLine = await p.evaluate(() => {
    const c = document.querySelector('.card.stuck-card .stuck-call');
    return c ? c.textContent : '';
  });
  check('the call is set apart on its own line', callLine === 'running pnpm build', callLine);
  // The WAY OUT is rendered. Note what this does and does not prove: the card
  // gets its `help` line from the host, and the host's wording comes from core,
  // where `stuck.test.ts` pins it. This asserts the field is DRAWN and readable;
  // the sentence itself is core's to get right.
  check('the way out is drawn on the card', /Tell Plato what to do instead/.test(t), t);
  check('and it names the other way out', /Stop/.test(t), t);
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

// B. The no-progress card: what failed, where it got to, and the way out.
{
  const p = await page(900, S());
  await post(p, NOPROGRESS);
  await p.waitForTimeout(250);
  const t = await cardText(p);
  check('the no-progress card is drawn', t.length > 0, t);
  check('it says how many turns and calls', /5 turns/.test(t) && /9 calls/.test(t), t);
  check('it says what last worked', /writing src\/DateHelper\.java/.test(t), t);
  check('it says trying the same things will not help', /will not help/.test(t), t);
  check('and its way out is drawn too', /Tell Plato what to do instead/.test(t), t);
  check('and there is no call line to show', await p.evaluate(
    () => document.querySelector('.card.stuck-card .stuck-call') === null,
  ));
  checkPageClean(p, 'no-progress card');
  await p.close();
}

// C. "Keep going" carries the user's own words. This is the fastest way to
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

// D. Stop is a real answer, and it is what the user chose — never a default.
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

// E. THE ONE THAT MATTERS MOST: a reload while the run is waiting rebuilds the
//    card. Without this the question vanishes off the screen while the host
//    still waits on a promise nobody can resolve — the user is stuck with no way
//    out, which is exactly what this feature must never do.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'do the thing' },
      { k: 'stuck-open', ...NOPROGRESS },
    ],
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(320);
  const t = await cardText(p);
  check('a reload while the run waits rebuilds the card', t.length > 0, t);
  check('and it still says what last worked', /DateHelper/.test(t), t);
  check('and the way out survives the reload too', /Tell Plato what to do instead/.test(t), t);
  check('and it is still answerable',
    (await cardButtons(p)).join('|') === 'Keep going|Stop', await cardButtons(p));
  checkPageClean(p, 'reload');
  await p.close();
}

// F. Cancel takes the card with it, exactly as it does for a question.
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
