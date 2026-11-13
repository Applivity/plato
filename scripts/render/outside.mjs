/**
 * D49dk render suite: the "path outside the project?" card.
 *
 * The copy comes from CORE (`outsidePathCard`), the same function the host
 * sends, so this suite cannot pass on wording the product no longer ships.
 * It checks what the user reads and what each control does:
 *   - the path, the fact that it is outside the project, and why Plato wants it;
 *   - exactly three answers, in core's order, each label with CORE's hint under
 *     it (the page invents no wording);
 *   - a write card says nothing is changed when denied;
 *   - each answer posts exactly its own value;
 *   - the done message marks the card answered and takes the buttons away;
 *   - a replayed log rebuilds the card, spent.
 */
import * as core from '../../packages/core/dist/src/index.js';
import { page, check, checkPageClean, finish } from './plib.mjs';

const send = (p, msg) =>
  p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);

const CARD = core.outsidePathCard('read', 'read_file', [
  { path: '/home/me/notes/plan.txt', abs: '/home/me/notes/plan.txt' },
]);
const WRITE_CARD = core.outsidePathCard('write', 'write_file', [
  { path: '/home/me/notes/plan.txt', abs: '/home/me/notes/plan.txt' },
]);

const answersOf = (p) => p.evaluate(() => {
  const c = document.querySelector('.outside-card');
  if (!c) return null;
  return [...c.querySelectorAll('.actions button')].map((b) => ({
    label: (b.querySelector('.oa-label') || {}).textContent || '',
    hint: (b.querySelector('.oa-hint') || {}).textContent || '',
  }));
});

/* A. The card states the situation, the why, and three answers. */
{
  const p = await page(760);
  await send(p, { type: 'outside-read', ...CARD });
  await p.waitForTimeout(150);
  const view = await p.evaluate(() => {
    const c = document.querySelector('.outside-card');
    if (!c) return null;
    return { title: c.querySelector('h3').textContent, text: c.textContent };
  });
  check('the card appears', view !== null, view);
  check('it names the path it wants to read',
    view.text.includes('/home/me/notes/plan.txt'), view);
  check('it says the path is outside the project',
    /outside the project/i.test(view.text), view);
  check('it says why Plato wants it',
    /reading a file/i.test(view.text), view);
  const answers = await answersOf(p);
  check('it offers exactly core\'s answers, in order',
    answers !== null && answers.length === CARD.answers.length
      && answers.every((a, i) =>
        a.label === CARD.answers[i].label && a.hint === CARD.answers[i].hint),
    { answers, core: CARD.answers });
  const labels = (answers || []).map((a) => a.label);
  check('the first answer is Allow once', labels[0] === 'Allow once', labels);
  check('the second answer is Allow for this session',
    labels[1] === 'Allow for this session', labels);
  check('the third answer is Deny', labels[2] === 'Deny', labels);
  check('each hint is core\'s own line',
    JSON.stringify((answers || []).map((a) => a.hint)) ===
      JSON.stringify(CARD.answers.map((a) => a.hint)),
    answers);
  check('no answer offers a folder',
    !(answers || []).some((a) => /folder/i.test(a.label) || /folder/i.test(a.hint)),
    answers);
  check('the old supporting sentence is gone',
    !/covers this one call|this chat ends\. Plato saves neither/i.test(view.text),
    view.text);
  checkPageClean(p, 'outside card');
  await p.close();
}

/* A2. A WRITE card says the deny answer changes nothing. */
{
  const p = await page(760);
  await send(p, { type: 'outside-read', ...WRITE_CARD });
  await p.waitForTimeout(150);
  const title = await p.evaluate(() =>
    document.querySelector('.outside-card h3').textContent);
  const answers = await answersOf(p);
  check('a write card says it is a write',
    title === 'Write a file outside the project?', title);
  check('and its deny hint says nothing is changed',
    answers !== null && answers[2].hint === 'Nothing is changed.', answers);
  check('with core\'s own write hints throughout',
    JSON.stringify(answers) === JSON.stringify(WRITE_CARD.answers.map((a) => ({
      label: a.label, hint: a.hint,
    }))),
    answers);
  checkPageClean(p, 'write outside card');
  await p.close();
}

/* B. Each answer posts only itself; the done message spends the card. */
for (const [index, value] of [['0', 'once'], ['1', 'session'], ['2', 'deny']]) {
  const p = await page(760);
  await send(p, { type: 'outside-read', ...CARD });
  await p.waitForTimeout(120);
  await p.evaluate((i) => {
    document.querySelectorAll('.outside-card .actions button')[Number(i)].click();
  }, index);
  const posted = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'outside-answer'));
  check(`the "${value}" answer posts exactly that`,
    posted.length === 1 && posted[0].value === value, posted);
  const spent = await p.evaluate(() => ({
    answered: document.querySelector('.outside-card').classList.contains('answered'),
    actions: !!document.querySelector('.outside-card .actions'),
  }));
  check(`the "${value}" answer spends the card at once`,
    spent.answered && spent.actions === false, spent);
  checkPageClean(p, 'outside answer ' + value);
  await p.close();
}

/* B2. The host's done message spends a card answered elsewhere. */
{
  const p = await page(760);
  await send(p, { type: 'outside-read', ...CARD });
  await p.waitForTimeout(120);
  await send(p, { type: 'outside-read-done' });
  await p.waitForTimeout(120);
  const spent = await p.evaluate(() => ({
    answered: document.querySelector('.outside-card').classList.contains('answered'),
    actions: !!document.querySelector('.outside-card .actions'),
  }));
  check('the done message marks the card answered and removes its buttons',
    spent.answered && spent.actions === false, spent);
  await p.close();
}

/* C. A replayed log rebuilds the card, spent — the past is not clickable. */
{
  const p = await page(760);
  await send(p, {
    type: 'restore',
    log: [{ k: 'outside-open', ...CARD }, { k: 'outside-done' }],
    hasConnections: true,
    title: '',
    mode: 'auto',
    queue: [],
    queueHeld: false,
  });
  await p.waitForTimeout(200);
  const replay = await p.evaluate(() => {
    const cards = document.querySelectorAll('.outside-card');
    return {
      cards: cards.length,
      answered: cards.length ? cards[0].classList.contains('answered') : false,
      buttons: cards.length ? cards[0].querySelectorAll('button').length : -1,
    };
  });
  check('a reloaded transcript keeps the record of the question',
    replay.cards === 1, replay);
  check('the rebuilt card is spent, not live',
    replay.answered && replay.buttons === 0, replay);
  checkPageClean(p, 'outside replay');
  await p.close();
}

/* D. A narrow panel wraps the three answers instead of clipping them. */
{
  const p = await page(300);
  await send(p, { type: 'outside-read', ...CARD });
  await p.waitForTimeout(150);
  const narrow = await p.evaluate(() => ({
    buttons: [...document.querySelectorAll('.outside-card .actions button')]
      .map((b) => b.getBoundingClientRect().right),
    vw: window.innerWidth,
    doc: document.documentElement.scrollWidth,
  }));
  check('all three answers stay inside a narrow panel',
    narrow.buttons.length === 3 &&
      narrow.buttons.every((r) => r <= narrow.vw + 1) &&
      narrow.doc <= narrow.vw + 1,
    narrow);
  checkPageClean(p, 'narrow outside card');
  await p.close();
}

await finish('outside path: the card, its three answers, and its replay');
