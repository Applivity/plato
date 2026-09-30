import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49bc: the card for a protected file Plato cannot mask.
 *
 * Four properties matter, and each is the answer to a real failure:
 *
 * 1. **The cost is on the card, weighted.** *Every value in this file goes into
 *    this conversation* is its own field in core, not one row among the prose,
 *    so the emphasis survives a reordering of the wording. A prompt that hides
 *    what the click costs until afterwards is the dishonest kind.
 * 2. **Two answers, and only two.** There is no "always" button: the permanent
 *    answer is a setting the user can read and change in the panel, not a
 *    security decision taken inside a dialog.
 * 3. **The file name is drawn as text.** A repo can hold a file whose NAME is
 *    markup, and this card prints that name.
 * 4. **A reload rebuilds it.** The host is parked on the answer, so a card lost
 *    to a reload leaves a run waiting for a click that can no longer be made.
 *
 * What this does NOT prove: which files reach this card at all. That split is
 * core's, by a UTF-8 decode, and `secretReveal.test.ts` pins both sides of it.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const card = (p) => p.evaluate(() => {
  const c = document.querySelector('.card.reveal-card');
  return c ? c.textContent : '';
});

const buttons = (p) => p.evaluate(() => [...document.querySelectorAll('.card.reveal-card button')]
  .map((b) => b.textContent));

const posted = (p) => p.evaluate(() => window.__posted);

/** The card as the host sends it — these strings come from core. */
const REVEAL = {
  type: 'reveal',
  title: 'Show this protected file in full?',
  lines: [
    'secrets.json is protected.',
    'Plato hides a value by replacing it with a placeholder, and it cannot do that in this file, because the file does not hold "KEY=value" lines.',
    'The choice lasts until the session ends. To allow this file in every session, add it to the plato.secrets.allow setting.',
  ],
  cost: 'If you show it, every value in this file goes into this conversation. Plato cannot hide the values afterwards.',
  confirm: 'Show it this session',
  cancel: 'Cancel',
};

// A. The card is drawn, names the file, and states the cost.
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(250);
  const t = await card(p);
  check('the reveal card is drawn', t.length > 0, t);
  check('it names the file', /secrets\.json is protected/.test(t), t);
  check('it says why this file and not others', /does not hold "KEY=value" lines/.test(t), t);
  check('it states the cost', /goes into this conversation/.test(t), t);
  check('and that the cost cannot be undone', /cannot hide the values afterwards/.test(t), t);
  // The cost is its own element with its own class, not one row in the prose —
  // that is what keeps the emphasis when the copy is reworded.
  const weighted = await p.evaluate(() => {
    const c = document.querySelector('.card.reveal-card .reveal-cost');
    if (!c) return null;
    return { text: c.textContent, bold: getComputedStyle(c).fontWeight };
  });
  check('the cost is set apart from the rest of the prose',
    weighted !== null && Number(weighted.bold) >= 600, weighted);
  checkPageClean(p, 'reveal card');
  await p.close();
}

// B. Two buttons, and neither of them is "always".
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(220);
  const b = await buttons(p);
  check('the primary button states what the click does',
    b[0] === 'Show it this session', b);
  check('and Cancel is the other answer', b[1] === 'Cancel', b);
  // The permanent answer is a SETTING. A third button that rewrote one would be
  // a security decision taken in a dialog the user reads once.
  check('there is no third, permanent answer on the card', b.length === 2, b);
  checkPageClean(p, 'two answers');
  await p.close();
}

// C. The safe answer is the one that is NOT the default-styled primary, and the
//    answer the host receives is an explicit boolean — never a string that a
//    malformed message could have produced.
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.reveal-card button')]
      .find((b) => b.textContent === 'Show it this session').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  const answer = all.find((m) => m.type === 'reveal-answer');
  check('the button tells the host what the user chose',
    answer !== undefined && answer.allow === true, all);
  check('and nothing else is posted', all.length === 1, all);
  check('the card stops taking answers once it is answered',
    (await buttons(p)).length === 0, await card(p));
  check('and it is marked answered, so nothing waits on it any more',
    await p.evaluate(() => {
      const c = document.querySelector('.card.reveal-card');
      return c ? c.classList.contains('answered') : false;
    }), await card(p));
  checkPageClean(p, 'allow');
  await p.close();
}

// D. Cancel says no, and says it as `false`.
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.reveal-card button')]
      .find((b) => b.textContent === 'Cancel').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  const answer = all.find((m) => m.type === 'reveal-answer');
  check('cancel tells the host', answer !== undefined && answer.allow === false, all);
  check('the card is closed', (await buttons(p)).length === 0, await card(p));
  checkPageClean(p, 'cancel');
  await p.close();
}

// E. A file name is the USER'S OWN DATA and must never become markup.
{
  const p = await page(900, S());
  await post(p, {
    ...REVEAL,
    lines: ['<img src=x onerror="window.__xss=1">.json is protected.', ...REVEAL.lines.slice(1)],
  });
  await p.waitForTimeout(250);
  check('a file name is drawn as text, never as markup', await p.evaluate(
    () => window.__xss === undefined && document.querySelector('.card.reveal-card img') === null,
  ));
  check('and the name is still readable', /onerror/.test(await card(p)), await card(p));
  checkPageClean(p, 'hostile file name');
  await p.close();
}

// F. A reload rebuilds the card, because the host is still waiting on it.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'read secrets.json' },
      { k: 'reveal-open', ...REVEAL },
    ],
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(320);
  const t = await card(p);
  check('a reload rebuilds the card', t.length > 0, t);
  check('and it still states the cost', /goes into this conversation/.test(t), t);
  check('and it is still answerable',
    (await buttons(p)).join('|') === 'Show it this session|Cancel', await buttons(p));
  checkPageClean(p, 'reload');
  await p.close();
}

// G. reveal-done takes the card away, whatever put it up — the cancel path.
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(220);
  check('the card is up before the answer', (await card(p)).length > 0);
  await post(p, { type: 'reveal-done' });
  await p.waitForTimeout(220);
  check('the answer takes the card away', (await buttons(p)).length === 0, await card(p));
  checkPageClean(p, 'reveal-done');
  await p.close();
}

// H. Two offers in a row leave ONE live card: two live cards would ask the same
//    question twice, and the second answer would resolve nothing.
{
  const p = await page(900, S());
  await post(p, REVEAL);
  await p.waitForTimeout(200);
  await post(p, REVEAL);
  await p.waitForTimeout(200);
  const live = await p.evaluate(() => document.querySelectorAll('.card.reveal-card:not(.answered)').length);
  check('only the newest offer is live', live === 1, String(live));
  checkPageClean(p, 'two offers');
  await p.close();
}

// I. Nothing is drawn on its own. This card exists because a run asked for a
//    file it cannot mask, and a card that appeared without that would be a
//    prompt with no question behind it.
{
  const p = await page(900, S());
  await post(p, { type: 'restore', log: [{ k: 'msg', cls: 'you', who: 'You', text: 'hi' }], hasConnections: true, title: '' });
  await p.waitForTimeout(300);
  check('no reveal card is drawn on its own',
    (await card(p)).length === 0, await card(p));
  checkPageClean(p, 'quiet by default');
  await p.close();
}

console.log('');
await finish('reveal card');
