import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49ax: the undo card.
 *
 * Three properties matter here, and each one is the answer to a real failure:
 *
 * 1. **The file names are on the card.** A card that says "3 files" makes the
 *    user go and count.
 * 2. **What CANNOT be put back is on the same card as the offer.** "2 of your 3
 *    files" is a different decision from "all 3", and finding that out after the
 *    click is how the feature loses trust.
 * 3. **Nothing happens without a click.** There is no icon, no automatic card at
 *    the end of a run, and no way to undo by accident — `/undo` is the only
 *    entrance.
 *
 * What this does NOT prove: the wording of the refusal lines comes from core,
 * where `undoCopy.test.ts` pins it. This asserts the fields are DRAWN, that a
 * file name is never markup, and that the buttons post what the host expects.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const card = (p) => p.evaluate(() => {
  const c = document.querySelector('.card.undo-card');
  return c ? c.textContent : '';
});

const buttons = (p) => p.evaluate(() => [...document.querySelectorAll('.card.undo-card button')]
  .map((b) => b.textContent));

const posted = (p) => p.evaluate(() => window.__posted);

/** The card as the host sends it — these strings come from core via the host. */
const OFFER = {
  type: 'undo',
  title: 'Put back the 3 files from your last request?',
  restore: ['src/a.ts', 'src/b.ts', 'Probe.ts'],
  refuse: [],
};

const WITH_REFUSAL = {
  type: 'undo',
  title: 'Put back the 3 files from your last request?',
  restore: ['src/a.ts', 'src/b.ts'],
  refuse: [
    'Probe.ts — you changed it after Plato did. Putting the old copy back would wipe out your work, so Plato left it alone.',
    "build/output.bin is 4.2 MB, above the 1 MB limit Plato keeps undo copies up to. Use git or your editor's own history for this one.",
  ],
};

// A. The offer names every file, and offers the two honest answers.
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(250);
  const t = await card(p);
  check('the undo card is drawn', t.length > 0, t);
  check('it says how many files', /3 files/.test(t), t);
  check('and it names each one', /src\/a\.ts/.test(t) && /Probe\.ts/.test(t), t);
  const b = await buttons(p);
  // Three files in this fixture, so the narrower undo is offered too — see I.
  check('it offers every answer', b.join('|') === 'Put these back|Just the last change|Cancel', b);
  // The list is its own element, so a long path wraps inside it rather than
  // pushing the card sideways.
  const items = await p.evaluate(() => [...document.querySelectorAll('.card.undo-card .undo-list li')]
    .map((li) => li.textContent));
  check('every file has its own row', items.join('|') === 'src/a.ts|src/b.ts|Probe.ts', items);
  checkPageClean(p, 'undo card');
  await p.close();
}

// B. THE ONE THAT MATTERS MOST: what cannot be put back is on the card, in full
//    foreground, before the click. Hiding it until afterwards is the cryptic
//    draft the founder rejected.
{
  const p = await page(900, S());
  await post(p, WITH_REFUSAL);
  await p.waitForTimeout(250);
  const t = await card(p);
  check('the refusal is on the card too', /Probe\.ts/.test(t), t);
  check('it says why, in plain words', /you changed it after Plato did/.test(t), t);
  check('and it names the size and the limit', /4\.2 MB/.test(t) && /1 MB/.test(t), t);
  check('and it says where else to go', /git/.test(t), t);
  const lines = await p.evaluate(() => [...document.querySelectorAll('.card.undo-card .undo-cannot')]
    .length);
  check('each refusal is set apart from the offer', lines === 2, String(lines));
  checkPageClean(p, 'undo card with refusals');
  await p.close();
}

// C. A file name is the USER'S OWN DATA and must never become markup. A repo can
//    contain a file called `<img src=x onerror=...>.ts`, and the card prints it.
{
  const p = await page(900, S());
  await post(p, {
    type: 'undo',
    title: 'Put back the file from your last request?',
    restore: ['<img src=x onerror="window.__xss=1">.ts'],
    refuse: [],
  });
  await p.waitForTimeout(250);
  check('a file name is drawn as text, never as markup', await p.evaluate(
    () => window.__xss === undefined && document.querySelector('.card.undo-card img') === null,
  ));
  check('and the name is still readable', /onerror/.test(await card(p)), await card(p));
  checkPageClean(p, 'hostile file name');
  await p.close();
}

// D. "Put these back" posts the apply, and the card stops taking answers. Both
//    halves matter: without the first nothing happens, and without the second a
//    second click offers an undo that has already run.
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.undo-card button')]
      .find((b) => b.textContent === 'Put these back').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  check('the button asks the host to do it',
    all.some((m) => m.type === 'undo-apply'), all);
  check('and nothing else is posted', all.length === 1, all);
  check('the card stops taking answers once it is answered',
    (await buttons(p)).length === 0, await card(p));
  check('and it is marked answered, so nothing waits on it any more',
    await p.evaluate(() => {
      const c = document.querySelector('.card.undo-card');
      return c ? c.classList.contains('answered') : false;
    }), await card(p));
  checkPageClean(p, 'apply');
  await p.close();
}

// E. Cancel is the other honest answer, and it is a real one: nothing is written
//    and the host is told so.
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.undo-card button')]
      .find((b) => b.textContent === 'Cancel').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  check('cancel tells the host', all.some((m) => m.type === 'undo-dismiss'), all);
  check('and it never asks for the undo to run',
    !all.some((m) => m.type === 'undo-apply'), all);
  check('the card is closed', (await buttons(p)).length === 0, await card(p));
  checkPageClean(p, 'cancel');
  await p.close();
}

// F. A reload rebuilds the card from the log — the offer must survive, or the
//    user is left with a question that vanished. The plan behind it is made
//    again on the click, so a rebuilt card is never a stale promise.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'add the null check' },
      { k: 'undo-open', ...OFFER },
    ],
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(320);
  const t = await card(p);
  check('a reload rebuilds the offer', t.length > 0, t);
  check('and it still names the files', /src\/a\.ts/.test(t), t);
  check('and it is still answerable',
    (await buttons(p)).join('|') === 'Put these back|Just the last change|Cancel', await buttons(p));
  checkPageClean(p, 'reload');
  await p.close();
}

// G. undo-done closes the card, whatever opened it.
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(220);
  check('the card is up before the answer', (await card(p)).length > 0);
  await post(p, { type: 'undo-done' });
  await p.waitForTimeout(220);
  check('the answer takes the offer away', (await buttons(p)).length === 0, await card(p));
  checkPageClean(p, 'undo-done');
  await p.close();
}

// H. Two offers in a row leave ONE live card. Two live cards would offer the
//    same action twice, and the second click would find nothing left to undo.
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(200);
  await post(p, OFFER);
  await p.waitForTimeout(200);
  const live = await p.evaluate(() => document.querySelectorAll('.card.undo-card:not(.answered)').length);
  check('only the newest offer is live', live === 1, String(live));
  checkPageClean(p, 'two offers');
  await p.close();
}

// I. D49ax's second level: "just the last change". It appears only when it does
//    something DIFFERENT — with one file in the request the two are the same
//    action, and a second button that does the same thing is a choice the user
//    has to read for nothing.
{
  const p = await page(900, S());
  await post(p, { type: 'undo', title: 'Put back the file from your last request?', restore: ['only.ts'], refuse: [] });
  await p.waitForTimeout(220);
  const b = await buttons(p);
  check('one file means no second button', b.join('|') === 'Put these back|Cancel', b);
  checkPageClean(p, 'single file');
  await p.close();
}
{
  const p = await page(900, S());
  await post(p, OFFER);
  await p.waitForTimeout(220);
  const b = await buttons(p);
  check('several files offer the narrower undo too',
    b.join('|') === 'Put these back|Just the last change|Cancel', b);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.undo-card button')]
      .find((x) => x.textContent === 'Just the last change').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  const ask = all.find((m) => m.type === 'undo-apply');
  check('and it asks for the LAST change, not the whole request',
    ask && ask.scope === 'last', all);
  checkPageClean(p, 'last change');
  await p.close();
}

// J. Nothing is drawn before /undo. An undo icon in the toolbar, or a card at the
//    end of every run, would be a nuisance — and this feature has already been
//    told once that a new guard must not become one.
{
  const p = await page(900, S());
  await post(p, { type: 'restore', log: [{ k: 'msg', cls: 'you', who: 'You', text: 'hi' }], hasConnections: true, title: '' });
  await p.waitForTimeout(300);
  check('no undo control is drawn on its own',
    (await card(p)).length === 0, await card(p));
  checkPageClean(p, 'quiet by default');
  await p.close();
}

console.log('');
await finish('undo');
