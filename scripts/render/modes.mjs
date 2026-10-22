import { check, page, finish, checkPageClean } from './plib.mjs';

/**
 * D49ak: the mode picker offers THREE modes, not four.
 *
 * Why this suite exists at all: until now **nothing covered the picker.** The
 * unit tests cover `decide()` — the permission table — and no render suite ever
 * opened the popover, so the list of modes the user actually sees was asserted
 * nowhere. That was survivable while the list was stable; this change removes a
 * mode from it, changes which one is the default, and rewrites two of the three
 * descriptions, so the gap had to be closed in the same commit.
 *
 * The assertions check the four things a removal can silently get wrong:
 * the row is gone, the survivors are right, the default moved, and the text that
 * described the old behaviour did not survive the mode it described.
 */

/** Opens the mode picker the way a user does and returns the rendered rows. */
const openPicker = async (p) => {
  await p.evaluate(() => { document.getElementById('modeBtn').click(); });
  await p.waitForTimeout(220);
  return p.evaluate(() => {
    const pop = document.querySelector('.popover.open[data-trigger="modeBtn"]');
    if (!pop) { return null; }
    return [...pop.querySelectorAll('.mp-row')].map((r) => ({
      mode: r.dataset.mode,
      name: r.querySelector('.mp-name') ? r.querySelector('.mp-name').textContent : '',
      desc: r.querySelector('.mp-desc') ? r.querySelector('.mp-desc').textContent : '',
      active: r.classList.contains('active'),
    }));
  });
};

const label = (p) => p.evaluate(() => {
  const l = document.getElementById('modeBtnLabel');
  return l ? l.textContent : '';
});

// A. The list itself, and the default.
{
  const p = await page(760);
  check('the mode button starts on edit', (await label(p)) === 'edit', await label(p));

  const rows = await openPicker(p);
  check('the picker opened', Array.isArray(rows) && rows.length > 0, rows);
  check('it offers exactly three modes', rows.length === 3, rows);
  check('the three are plan, edit, auto, in that order',
    rows.map((r) => r.mode).join(',') === 'plan,edit,auto', rows.map((r) => r.mode));
  check('there is no act row', !rows.some((r) => r.mode === 'act'), rows.map((r) => r.mode));
  check('edit is the row marked active', rows.find((r) => r.active)?.mode === 'edit',
    rows.map((r) => [r.mode, r.active]));
  checkPageClean(p, 'mode picker');
  await p.close();
}

// B. The descriptions describe the modes that exist. The old `edit` text said the
//    shell was denied, which was true of the mode `edit` used to be and is false
//    of the mode it is now — the exact kind of sentence a merge leaves behind.
{
  const p = await page(760);
  const rows = await openPicker(p);
  const by = Object.fromEntries(rows.map((r) => [r.mode, r]));
  check('edit now says it runs commands',
    /command/i.test(by.edit.desc) && !/shell access is denied/i.test(by.edit.desc), by.edit.desc);
  check('edit says an approval is asked for',
    /approval/i.test(by.edit.desc), by.edit.desc);
  // D49ao changed what plan DOES, so the assertion follows the behaviour instead
  // of pinning the old sentence: it must still say it cannot change anything, and
  // it must now say that it can read and run reading commands. A card that
  // claimed plan "never runs shell" would be a lie the user could test in one
  // keystroke.
  check('plan says it cannot change anything',
    /never changes|read-only/i.test(by.plan.desc), by.plan.desc);
  check('plan says it can run commands that only read (D49ao)',
    /only read|read only/i.test(by.plan.desc), by.plan.desc);
  check('plan does not claim it runs no shell at all',
    !/never.*shell|runs no shell|shell.*denied/i.test(by.plan.desc), by.plan.desc);
  check('auto now claims web requests, since it no longer asks for them',
    /web/i.test(by.auto.desc), by.auto.desc);
  checkPageClean(p, 'mode descriptions');
  await p.close();
}

// C. Choosing a mode updates the button and tells the host.
{
  const p = await page(760);
  await openPicker(p);
  await p.evaluate(() => {
    const pop = document.querySelector('.popover.open[data-trigger="modeBtn"]');
    const plan = [...pop.querySelectorAll('.mp-row')].find((r) => r.dataset.mode === 'plan');
    plan.click();
  });
  await p.waitForTimeout(220);
  check('picking plan relabels the button', (await label(p)) === 'plan', await label(p));

  const posted = await p.evaluate(() => window.__posted.filter((m) => m.type === 'mode'));
  check('the host is told which mode was picked',
    posted.length === 1 && posted[0].value === 'plan', posted);

  const cls = await p.evaluate(() => document.getElementById('modeBtn').className);
  check('the button carries the picked mode class',
    cls.includes('mode-plan') && !cls.includes('mode-edit'), cls);
  checkPageClean(p, 'mode switch');
  await p.close();
}

// D. D49bj: a STORED mode is restored, not overwritten by the view's own
//    default. The view hardcodes its starting mode, so before this the two
//    halves of the product disagreed after every reload — the button said one
//    mode while the permission table ran another, and nothing said so.
{
  const p = await page(760);
  const post = (msg) => p.evaluate(
    (x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);
  const restoreMode = (mode) => post({
    type: 'restore',
    log: [],
    hasConnections: true,
    model: '',
    title: '',
    mode,
  });

  check('the view starts on edit before any restore', (await label(p)) === 'edit', await label(p));

  await restoreMode('auto');
  await p.waitForTimeout(220);
  check('a restore carrying auto moves the button to auto',
    (await label(p)) === 'auto', await label(p));
  const cls = await p.evaluate(() => document.getElementById('modeBtn').className);
  check('and the button and composer agree it is auto, not edit',
    cls.includes('mode-auto') && !cls.includes('mode-edit'), cls);

  // The picker's own active row must follow, or reopening it would show a
  // different mode marked than the one that is running.
  const rows = await openPicker(p);
  check('the picker marks auto active after the restore',
    rows.find((r) => r.active)?.mode === 'auto', rows.map((r) => [r.mode, r.active]));

  // A SECOND restore must land too, because `ready` fires on every reload and
  // each one re-sends the mode. Asserting a JUNK value instead would look like a
  // stronger check and be a weaker one: "a bad payload leaves the default" also
  // passes when the payload is ignored entirely, so it cannot tell the two
  // apart. (The junk case is handled where it is a real boundary — the host
  // validates the stored value before it ever reaches the panel.)
  await restoreMode('plan');
  await p.waitForTimeout(220);
  check('a second restore is applied too, not only the first',
    (await label(p)) === 'plan', await label(p));

  checkPageClean(p, 'mode restore');
  await p.close();
}

// E. D49bj: the switch is WRITTEN DOWN, so it survives a reload. The host now
//    pushes a system line into the log and re-sends it as a notice; this proves
//    the pushed row is one the replay knows how to draw. A row with a `k` the
//    view does not handle would vanish on reload with nothing to show for it.
{
  const p = await page(760);
  const post = (msg) => p.evaluate(
    (x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);
  await post({
    type: 'restore',
    log: [{ k: 'msg', cls: 'sys', who: 'Plato', text: 'Mode: auto' }],
    hasConnections: true,
    model: '',
    title: '',
    mode: 'auto',
  });
  // The exact selector, not a substring of the whole page: the restore payload
  // also carries the mode, so a loose `innerText.includes('Mode: auto')` could
  // pass on something that is not the log line at all.
  const drawn = await p.evaluate(() => [...document.querySelectorAll('.msg.sys')]
    .map((e) => e.textContent).join('\n'));
  check('a mode-switch line in the log is rebuilt on replay',
    drawn.includes('Mode: auto'), drawn);
  check('and it is a system line, where the model cannot have written it',
    (await p.evaluate(() => [...document.querySelectorAll('.msg.sys')]
      .filter((e) => e.textContent.includes('Mode: auto')).length)) === 1, drawn);
  checkPageClean(p, 'mode replay');
  await p.close();
}

// D49cb: a mode the HOST changed — the model asked, the user approved on the
// card — must reach the picker. Without it the chip read `plan` while the
// permission table was `edit`, and the screenshot of the first real run caught
// the disagreement.
{
  const p = await page(760);
  const post = (msg) => p.evaluate(
    (x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);
  check('the picker starts on its own default', (await label(p)) === 'edit', await label(p));
  await post({ type: 'mode-state', text: 'auto' });
  await p.waitForTimeout(200);
  const after = await label(p);
  check('a host-side switch moves the picker label', after === 'auto', after);
  const rows = await openPicker(p);
  check('and the active row follows it',
    rows.find((r) => r.active)?.mode === 'auto', rows.map((r) => [r.mode, r.active]));
  checkPageClean(p, 'host mode state');
  await p.close();
}

console.log('');
await finish('mode picker');
