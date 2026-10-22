import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49cb: the card for the model's mode request.
 *
 * Four properties matter:
 *
 * 1. **The card says what changes and what it costs.** The target mode's own
 *    description is on the card, and the current mode is named, so a click is
 *    never a guess about what the other mode means.
 * 2. **Two answers, and the safe one is not the primary.** Switch is the
 *    primary button; Stay is the secondary — but only the yes changes anything.
 * 3. **The model's reason is TEXT, never markup.** It is model output, and a
 *    card is exactly where model output must not become HTML.
 * 4. **The answer is an explicit boolean.** A malformed message must not be
 *    able to read as consent.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const card = (p) => p.evaluate(() => {
  const c = document.querySelector('.card.mode-card');
  return c ? c.textContent : '';
});

const buttons = (p) => p.evaluate(() => [...document.querySelectorAll('.card.mode-card button')]
  .map((b) => b.textContent));

const posted = (p) => p.evaluate(() => window.__posted);

const REQUEST = {
  type: 'mode-request',
  current: 'plan',
  mode: 'edit',
  reason: 'Plan mode cannot write the file this fix needs, and the patch is ready to apply.',
};

// A. The card is drawn, and it names the target, the reason and the current mode.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(250);
  const t = await card(p);
  check('the mode card is drawn', t.length > 0, t);
  check('it names the mode the model asked for', /Switch Plato to edit mode\?/.test(t), t);
  check('it carries the model’s reason', /the patch is ready to apply/.test(t), t);
  check('it says what edit mode means', /approval card/.test(t), t);
  check('it names the mode in force now', /Plato is in plan mode now/.test(t), t);
  checkPageClean(p, 'mode card');
  await p.close();
}

// B. Exactly two answers, each naming its outcome.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(220);
  const b = await buttons(p);
  check('the primary button names the switch', b[0] === 'Switch to edit', b);
  check('the other answer names staying', b[1] === 'Stay in plan', b);
  check('there is no third answer', b.length === 2, b);
  checkPageClean(p, 'two answers');
  await p.close();
}

// C. Switch posts an explicit true and spends the card.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.mode-card button')]
      .find((b) => b.textContent === 'Switch to edit').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  const answer = all.find((m) => m.type === 'mode-request-answer');
  check('the button tells the host what the user chose',
    answer !== undefined && answer.allow === true, all);
  check('and nothing else is posted', all.length === 1, all);
  check('the card stops taking answers once it is answered',
    (await buttons(p)).length === 0, await card(p));
  check('and it is marked answered, so nothing waits on it any more',
    await p.evaluate(() => {
      const c = document.querySelector('.card.mode-card');
      return c ? c.classList.contains('answered') : false;
    }), await card(p));
  checkPageClean(p, 'switch');
  await p.close();
}

// D. Stay says no, and says it as `false`.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(220);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.mode-card button')]
      .find((b) => b.textContent === 'Stay in plan').click();
  });
  await p.waitForTimeout(200);
  const all = await posted(p);
  const answer = all.find((m) => m.type === 'mode-request-answer');
  check('stay tells the host', answer !== undefined && answer.allow === false, all);
  check('the card is closed', (await buttons(p)).length === 0, await card(p));
  checkPageClean(p, 'stay');
  await p.close();
}

// E. The reason is model output and must never become markup.
{
  const p = await page(900, S());
  const hostile = 'Need edit. <b>BOLD</b><img src=x onerror="window.__pwned=1">';
  await post(p, { ...REQUEST, reason: hostile });
  await p.waitForTimeout(220);
  const built = await p.evaluate(() => {
    const why = document.querySelector('.card.mode-card .mode-why');
    return why
      ? { text: why.textContent, bold: why.querySelectorAll('b').length, imgs: why.querySelectorAll('img').length }
      : null;
  });
  check('the reason is drawn as text', built !== null && built.text.includes('<b>BOLD</b>'), built);
  check('its markup did not become elements',
    built !== null && built.bold === 0 && built.imgs === 0, built);
  check('and nothing ran from it',
    await p.evaluate(() => window.__pwned === undefined), built);
  checkPageClean(p, 'text not markup');
  await p.close();
}

// F. The host dismissing the card marks it answered, so nothing looks live.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(220);
  await post(p, { type: 'mode-request-done' });
  await p.waitForTimeout(150);
  check('dismissing removes the answers', (await buttons(p)).length === 0, await card(p));
  check('and marks the card answered',
    await p.evaluate(() => {
      const c = document.querySelector('.card.mode-card');
      return c ? c.classList.contains('answered') : false;
    }), await card(p));
  checkPageClean(p, 'dismissed');
  await p.close();
}

// G. Only the newest request stays live — the rule every card here follows.
{
  const p = await page(900, S());
  await post(p, REQUEST);
  await p.waitForTimeout(160);
  await post(p, { ...REQUEST, mode: 'auto', reason: 'This needs several commands.' });
  await p.waitForTimeout(200);
  const cards = await p.evaluate(() => [...document.querySelectorAll('.card.mode-card')]
    .map((c) => ({ mode: c.dataset.mode, answered: c.classList.contains('answered') })));
  check('both requests are kept as the record', cards.length === 2, cards);
  check('only the newest still takes an answer',
    cards[0]?.answered === true && cards[1]?.answered === false, cards);
  checkPageClean(p, 'one live card');
  await p.close();
}

// H. A reload while the host is parked on the answer rebuilds the card. A card
//    lost to a reload is a run waiting for a click that can no longer be made.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [{ k: 'mode-open', current: 'plan', mode: 'edit', reason: 'Plan mode cannot write the file.' }],
    hasConnections: true,
    model: '',
    title: '',
    mode: 'plan',
  });
  await p.waitForTimeout(280);
  const t = await card(p);
  check('a reload rebuilds the mode card', /Switch Plato to edit mode\?/.test(t), t);
  check('with the reason it was asked for', /Plan mode cannot write the file/.test(t), t);
  check('and with both answers still live', (await buttons(p)).length === 2, await buttons(p));
  checkPageClean(p, 'rebuilt card');
  await p.close();
}

// I. A recorded answer closes it on replay, so a settled request is not asked
//    again by the rebuilt page.
{
  const p = await page(900, S());
  await post(p, {
    type: 'restore',
    log: [
      { k: 'mode-open', current: 'plan', mode: 'edit', reason: 'Plan mode cannot write the file.' },
      { k: 'mode-done' },
    ],
    hasConnections: true,
    model: '',
    title: '',
    mode: 'plan',
  });
  await p.waitForTimeout(280);
  check('a settled request is not drawn as live',
    (await buttons(p)).length === 0, await card(p));
  check('and it stays as the record of what was asked',
    /Switch Plato to edit mode\?/.test(await card(p)), await card(p));
  checkPageClean(p, 'settled replay');
  await p.close();
}

await finish('mode request card');
