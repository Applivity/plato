import { check, page, openAll, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49bc: the Protected files section — the panel half of D45c.
 *
 * The section exists because the list lived only in settings.json, and the
 * assertions below are about the two things that must not go wrong in a UI that
 * edits a SECURITY list:
 *
 * 1. **The built-in names are shown and cannot be removed.** They appear, so the
 *    user can see what is protected without reading a document, and they carry
 *    no Remove — because removing `.env` everywhere is a silent hole. The
 *    deliberate way to unprotect one file is a path on the second list, where
 *    the user can see WHICH file they meant.
 * 2. **The two lists cannot be confused for each other.** Names match the last
 *    path segment and take `*` at the ends; paths are exact and take no
 *    wildcard. The help text under each says which is which, and the asymmetry
 *    is the security property rather than a style choice.
 *
 * What this does NOT prove: that an entry does anything. The matching, and the
 * refusal of an entry that could never match, are core's — `secretReveal.test.ts`
 * covers both, and `secrets.test.ts` covers the matcher.
 */

const section = (p) => p.evaluate(() => {
  const sec = [...document.querySelectorAll('#sbody .sec')]
    .find((s) => (s.getAttribute('data-sec') || '') === 'secrets');
  if (!sec) return null;
  const blocks = [...sec.querySelectorAll('.pblock')];
  return {
    title: sec.querySelector('summary').textContent.trim(),
    help: sec.querySelector('.shelp').textContent,
    blocks: blocks.map((b) => ({
      label: (b.querySelector('.slabel') || {}).textContent,
      help: (b.querySelector('.shelp') || {}).textContent,
      rows: [...b.querySelectorAll('.plist-row')].map((r) => ({
        name: (r.querySelector('.plist-name') || {}).textContent,
        tag: (r.querySelector('.plist-tag') || {}).textContent || null,
        buttons: [...r.querySelectorAll('button')].map((x) => x.textContent),
      })),
      placeholder: (b.querySelector('input') || {}).placeholder,
      addLabel: [...b.querySelectorAll('button')].map((x) => x.textContent).pop(),
      note: (b.querySelector('.note') || {}).textContent || null,
    })),
  };
});

const WITH_LISTS = S({
  secrets: {
    builtin: ['keystore.properties', 'local.properties', '.env', '.env.*', '*.keystore', '*.jks', 'secrets.*'],
    extra: ['*.pem'],
    allow: ['app/.env.example'],
  },
});

// A. The section is there, named in its header, and explains itself.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  const s = await section(p);
  check('the section exists', s !== null, s);
  check('its header names it', /^Protected files/.test(s.title), s.title);
  // The count is in the header so a collapsed section still answers "how much is
  // protected?" — eight names, built-in plus the user's own.
  check('the header carries the count', /8 protected/.test(s.title), s.title);
  check('it explains what Plato does with these files',
    /does not send the values/.test(s.help) && /placeholder/.test(s.help), s.help);
  // The seeding (D49bc) is a fact about the user's secrets, so the section says
  // it rather than leaving it to a document.
  check('and it says Plato reads them when a run starts',
    /when a run starts/.test(s.help) && /stay in memory/.test(s.help), s.help);
  checkPageClean(p, 'section');
  await p.close();
}

// B. The two lists, and the asymmetry between them.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  const s = await section(p);
  const [names, allow] = s.blocks;
  check('there are two lists', s.blocks.length === 2, s.blocks.length);
  check('the first holds names', names.label === 'Protected names', names.label);
  check('the second holds exact paths', allow.label === 'Shown in full', allow.label);
  check('the names help allows a wildcard at the ends',
    /\*/.test(names.help) && /start or the end/.test(names.help), names.help);
  // The asymmetry, said in the user's own terms: a wildcard exception could not
  // be seen to be one, so it is refused.
  check('the paths help says a wildcard is not allowed here',
    /not allowed/.test(allow.help), allow.help);
  check('and says why, so the rule does not read as arbitrary',
    /unprotect every file/.test(allow.help), allow.help);
  checkPageClean(p, 'two lists');
  await p.close();
}

// C. THE ONE THAT MATTERS MOST: a built-in name has no Remove.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  const s = await section(p);
  const rows = s.blocks[0].rows;
  const builtin = rows.filter((r) => r.tag === 'built in');
  const mine = rows.filter((r) => r.tag === null);
  check('every built-in name is shown', builtin.length === 7, builtin.map((r) => r.name));
  check('and none of them can be removed', builtin.every((r) => r.buttons.length === 0), builtin);
  check('so the row says why instead of looking broken',
    builtin.every((r) => r.tag === 'built in'), builtin.map((r) => r.tag));
  check('a name the user added CAN be removed',
    mine.length === 1 && mine[0].buttons.join('|') === 'Remove', mine);
  check('and the allowed path can be removed too',
    s.blocks[1].rows.length === 1 && s.blocks[1].rows[0].buttons.join('|') === 'Remove',
    s.blocks[1].rows);
  checkPageClean(p, 'built-ins');
  await p.close();
}

// D. Removing posts the value, and only the value — a Remove that guessed at the
//    list it belonged to would delete from the wrong one.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((s) => s.getAttribute('data-sec') === 'secrets');
    const blocks = [...sec.querySelectorAll('.pblock')];
    // The user's OWN name in the first list, and the path in the second.
    const rows = [...blocks[0].querySelectorAll('.plist-row')];
    rows[rows.length - 1].querySelector('button').click();
    blocks[1].querySelector('.plist-row button').click();
  });
  await p.waitForTimeout(200);
  const all = await p.evaluate(() => window.__posted);
  check('removing a protected name posts it',
    all.some((m) => m.type === 'secrets-remove-name' && m.value === '*.pem'), all);
  check('removing an allowed path posts it, to its own list',
    all.some((m) => m.type === 'secrets-remove-allow' && m.value === 'app/.env.example'), all);
  checkPageClean(p, 'remove');
  await p.close();
}

// E. Adding posts what the user typed, and clears the box so the next entry
//    does not start from a stale value.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  await p.evaluate(() => window.__posted.length = 0);
  const cleared = await p.evaluate(async () => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((s) => s.getAttribute('data-sec') === 'secrets');
    const blocks = [...sec.querySelectorAll('.pblock')];
    const inName = blocks[0].querySelector('input');
    inName.value = 'id_rsa';
    [...blocks[0].querySelectorAll('button')].pop().click();
    const inPath = blocks[1].querySelector('input');
    inPath.value = 'local.properties';
    [...blocks[1].querySelectorAll('button')].pop().click();
    return { name: inName.value, path: inPath.value };
  });
  await p.waitForTimeout(200);
  const all = await p.evaluate(() => window.__posted);
  check('adding a protected name posts it',
    all.some((m) => m.type === 'secrets-add-name' && m.value === 'id_rsa'), all);
  check('adding an allowed path posts it',
    all.some((m) => m.type === 'secrets-add-allow' && m.value === 'local.properties'), all);
  check('and the field is cleared after sending',
    cleared.name === '' && cleared.path === '', cleared);
  checkPageClean(p, 'add');
  await p.close();
}

// F. An EMPTY field posts nothing. A blank entry would be stored as a name that
//    matches no file, and nothing on screen would say so.
{
  const p = await page(720, WITH_LISTS);
  await openAll(p);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((s) => s.getAttribute('data-sec') === 'secrets');
    for (const b of [...sec.querySelectorAll('.pblock')]) {
      [...b.querySelectorAll('button')].pop().click();
    }
  });
  await p.waitForTimeout(200);
  const all = await p.evaluate(() => window.__posted);
  check('an empty field posts nothing', all.length === 0, all);
  checkPageClean(p, 'empty');
  await p.close();
}

// G. The inputs are labelled and keep a usable width at the narrowest column the
//    panel is ever asked to render in — the fault the narrow suite exists for.
{
  const p = await page(300, WITH_LISTS);
  await openAll(p);
  const s = await section(p);
  check('the add labels say what they add',
    s.blocks[0].addLabel === 'Add name' && s.blocks[1].addLabel === 'Add file',
    [s.blocks[0].addLabel, s.blocks[1].addLabel]);
  check('the fields say what to type',
    /\*\.pem/.test(s.blocks[0].placeholder) && /workspace root/.test(s.blocks[1].placeholder),
    [s.blocks[0].placeholder, s.blocks[1].placeholder]);
  const widths = await p.evaluate(() => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((x) => x.getAttribute('data-sec') === 'secrets');
    return {
      inputs: [...sec.querySelectorAll('input')].map((i) => Math.round(i.getBoundingClientRect().width)),
      rows: [...sec.querySelectorAll('.plist-row')].map((r) => Math.round(r.getBoundingClientRect().width)),
      panel: (() => { const b = document.getElementById('sbody'); return b.scrollWidth - b.clientWidth; })(),
    };
  });
  check('the fields keep a usable width at 300px',
    widths.inputs.every((w) => w >= 80), widths.inputs);
  check('no row is squeezed out of the panel', widths.rows.every((w) => w > 0), widths.rows);
  check('and nothing overflows sideways', widths.panel <= 2, widths.panel);
  checkPageClean(p, 'narrow');
  await p.close();
}

// H. No lists at all is a real state — a project with no protected files and no
//    exceptions — and it must read as a statement, not as a broken table.
{
  const p = await page(720, S({ secrets: { builtin: ['keystore.properties'], extra: [], allow: [] } }));
  await openAll(p);
  const s = await section(p);
  check('the header counts only what is there', /1 protected/.test(s.title), s.title);
  check('an empty list has no rows', s.blocks[1].rows.length === 0, s.blocks[1].rows);
  // A heading with nothing under it reads as a failure to load. The list says
  // "None." in words, so an empty state is a statement rather than a blank.
  check('and it says so in words', s.blocks[1].note === 'None.', s.blocks[1].note);
  check('and the section is still complete', s.blocks.length === 2, s.blocks.length);
  checkPageClean(p, 'empty lists');
  await p.close();
}

console.log('');
await finish('protected files section');
