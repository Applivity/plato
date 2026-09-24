import { check, page, finish, checkPageClean } from './plib.mjs';

/**
 * D49ah: the plan the agent holds across a long run.
 *
 * This panel is the part of the phase the user actually SEES, and it exists
 * because the runs got long: with no turn cap (D49ab) a real run reached 78
 * turns, and a 78-turn run with no visible plan is one you cannot tell is on
 * track until it stops.
 *
 * Two things are pinned here beyond "it renders", because both are the kind of
 * defect that looks fine in a screenshot:
 *
 *   1. **State is legible without colour.** Completed and in-progress items are
 *      distinguished by a GLYPH and by weight, not by a colour alone — a plan
 *      read by someone who cannot separate the two colours is still a plan.
 *   2. **Replaying a log rebuilds the plans in order.** A run that replans shows
 *      each plan as it stood, which is what the transcript is for; a reload must
 *      not collapse them into the last one.
 */

const replay = async (p, log) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'restore',
    log,
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(260);
};

const live = async (p, todos) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'todo', todos });
  await p.waitForTimeout(160);
};

const PLAN = [
  { content: 'Read the three utility classes', status: 'completed' },
  { content: 'Fix the formatter', status: 'in_progress' },
  { content: 'Add a test', status: 'pending' },
];

const read = (p) => p.evaluate(() => {
  const cards = [...document.querySelectorAll('.card.todo-card')];
  const last = cards[cards.length - 1];
  if (!last) { return { count: 0 }; }
  const items = [...last.querySelectorAll('.todo-item')];
  const css = (el) => getComputedStyle(el);
  return {
    count: cards.length,
    head: (last.querySelector('.todo-head') || {}).textContent || '',
    items: items.map((li) => {
      const box = li.querySelector('.todo-box');
      const text = li.querySelector('.todo-text');
      const cs = css(text);
      return {
        glyph: box ? box.textContent : '',
        // The glyph is aria-hidden and the text is what a reader gets, so both
        // are read back: the state must survive without the box.
        text: text ? text.textContent : '',
        cls: li.className,
        weight: parseInt(cs.fontWeight, 10) || 400,
        strike: cs.textDecorationLine.includes('line-through'),
        colour: cs.color,
        textColour: cs.color,
      };
    }),
    bodyColour: css(document.body).color,
  };
});

// A. The plan renders, in order, with its progress in the header.
{
  const p = await page(760);
  await replay(p, [
    { k: 'msg', cls: 'you', who: 'You', text: 'fix the three classes' },
    { k: 'todo', todos: PLAN },
  ]);
  const r = await read(p);
  check('the plan renders one card', r.count === 1, r);
  check('the header states the progress, so a glance is enough',
    r.head === 'Plan — 1 of 3 steps done', r.head);
  check('every step is shown, in order',
    r.items.map((i) => i.text).join('|') ===
      'Read the three utility classes|Fix the formatter|Add a test',
    r.items);
  check('each step carries its state class',
    r.items.map((i) => i.cls).join(' ') ===
      'todo-item completed todo-item in_progress todo-item pending', r.items);

  // (1) Legibility without colour: a distinct glyph per state, and a glyph at
  // all — an item whose state lived only in its colour would fail here.
  check('a completed step is struck through, not only dimmed',
    r.items[0].strike === true, r.items[0]);
  check('a pending step is NOT struck through — the states are told apart',
    r.items[2].strike === false, r.items[2]);
  check('the step in progress is the heaviest thing in the list',
    r.items[1].weight > r.items[0].weight && r.items[1].weight > r.items[2].weight,
    r.items.map((i) => i.weight));
  check('every step has a glyph, so no state is colour-only',
    r.items.every((i) => i.glyph.trim().length > 0), r.items.map((i) => i.glyph));
  check('the three states have three different glyphs',
    new Set(r.items.map((i) => i.glyph)).size === 3, r.items.map((i) => i.glyph));
  checkPageClean(p, 'todo panel');
  await p.close();
}

// B. A plan set mid-run appears where it was set, and an update is a NEW card —
// the transcript shows the run changing its mind rather than rewriting history.
{
  const p = await page(760);
  await replay(p, [
    { k: 'msg', cls: 'you', who: 'You', text: 'fix the three classes' },
    { k: 'todo', todos: PLAN },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Formatter done.' },
    { k: 'todo', todos: [
      { content: 'Read the three utility classes', status: 'completed' },
      { content: 'Fix the formatter', status: 'completed' },
      { content: 'Add a test', status: 'in_progress' },
    ] },
  ]);
  const r = await read(p);
  check('a replan is a second card, not a rewrite', r.count === 2, r.count);
  check('the newest card is the current plan',
    r.head === 'Plan — 2 of 3 steps done', r.head);
  check('and the step that moved is now the active one',
    r.items[2].cls.includes('in_progress'), r.items[2]);
  checkPageClean(p, 'todo replan');
  await p.close();
}

// C. The live path — what actually happens during a run.
{
  const p = await page(760);
  await live(p, [{ content: 'Only step', status: 'pending' }]);
  const r = await read(p);
  check('a live plan renders as it is set', r.count === 1, r);
  check('one step is described as one step, not as steps',
    r.head === 'Plan — 0 of 1 step done', r.head);
  checkPageClean(p, 'todo live');
  await p.close();
}

// D. A plan is data, never markup: an item is a file path or a snippet often
// enough that it must not be able to inject anything into the page.
{
  const p = await page(760);
  const nasty = '<img src=x onerror="window.__pwned=1">';
  await replay(p, [
    { k: 'todo', todos: [{ content: nasty, status: 'pending' }] },
  ]);
  const r = await p.evaluate(() => ({
    injected: !!document.querySelector('.todo-text img'),
    pwned: !!window.__pwned,
    text: (document.querySelector('.todo-text') || {}).textContent || '',
  }));
  check('a plan item is rendered as text, never as markup',
    r.injected === false && r.pwned === false, r);
  check('and it still shows the item the model wrote',
    r.text === nasty, r.text);
  checkPageClean(p, 'todo escaping');
  await p.close();
}

// E. An empty or malformed list draws nothing rather than an empty shell.
{
  const p = await page(760);
  await live(p, []);
  await live(p, null);
  const r = await read(p);
  check('no card is drawn for an empty plan', r.count === 0, r);
  checkPageClean(p, 'todo empty');
  await p.close();
}

console.log('');
await finish('todo panel');
