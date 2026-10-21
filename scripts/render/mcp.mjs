import { check, page, openAll, finish, checkPageClean, checkSections, S } from './plib.mjs';

/**
 * D49bt: the MCP servers section — the only place MCP is discoverable at all.
 *
 * Before this, the file the feature reads was named nowhere in the product, so
 * the assertions below are about two things:
 *
 * 1. **The section tells the truth about state.** Plato starts MCP servers while
 *    a run is going and stops them when it ends, so between runs there is
 *    nothing live to read. A row that has not run yet must say so rather than
 *    show a count nobody measured — the honesty requirement, and the reason
 *    `not run yet` is asserted as an ABSENCE of digits rather than as a string.
 * 2. **A parse error cannot hide.** A broken file must open the section by
 *    itself and say what is wrong; a collapsed section holding the only
 *    explanation is indistinguishable from a section with nothing in it.
 *
 * What this does NOT prove: that a server starts, or that its tools reach the
 * model. That is the field case's job, and the parser's is core's.
 */

const section = (p) => p.evaluate(() => {
  const sec = [...document.querySelectorAll('#sbody .sec')]
    .find((s) => (s.getAttribute('data-sec') || '') === 'mcp');
  if (!sec) return null;
  return {
    open: sec.open,
    title: (sec.querySelector('summary') || {}).textContent.trim(),
    help: (sec.querySelector('.shelp') || {}).textContent || '',
    starter: (sec.querySelector('.starter') || {}).textContent || null,
    note: (sec.querySelector('.note') || {}).textContent || null,
    buttons: [...sec.querySelectorAll('.dhead button, .dhead .help')].map((x) => x.textContent),
    rows: [...sec.querySelectorAll('.plist-row')].map((r) => ({
      name: (r.querySelector('.plist-name') || {}).textContent,
      tag: (r.querySelector('.plist-tag') || {}).textContent || null,
      help: (r.querySelector('.help') || {}).getAttribute('title') || null,
      checked: r.querySelector('.beh input') ? r.querySelector('.beh input').checked : null,
      switches: r.querySelectorAll('.beh input').length,
    })),
  };
});

/**
 * The "?" buttons carry their text in a mouseenter closure rather than a title
 * attribute (D47: native tooltips do not render in a webview), so the only way
 * to read one is to open it the way a person does.
 */
const tipText = (p, selector) => p.evaluate((sel) => {
  const sec = [...document.querySelectorAll('#sbody .sec')]
    .find((s) => s.getAttribute('data-sec') === 'mcp');
  const btn = sec.querySelector(sel);
  if (!btn) return null;
  btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  const tip = [...document.querySelectorAll('div')]
    .find((d) => d.style.position === 'fixed' && d.style.zIndex === '9999');
  return tip && tip.style.display === 'block' ? tip.textContent : null;
}, selector);

// A. No file yet: the section exists, explains itself, and offers the way in.
{
  const p = await page(720, S());
  await openAll(p);
  const s = await section(p);
  check('the section exists', s !== null, s);
  check('its header names it', /^MCP servers/.test(s.title), s.title);
  check('the header counts what is configured', /0 configured/.test(s.title), s.title);
  check('it explains what a server is and how its tools are gated',
    /starts and reads tools/.test(s.help) && /plan/.test(s.help) && /auto/.test(s.help),
    s.help);
  check('it says a disabled server is skipped at the next run',
    /disabled server is skipped/.test(s.help), s.help);
  check('the empty state names the file to open',
    /No MCP servers configured yet/.test(s.starter) && /mcp\.json/.test(s.starter),
    s.starter);
  check('and it says a copied block works as it stands',
    /README/.test(s.starter), s.starter);
  check('the way in is a button named for the action, not the path',
    s.buttons.includes('Open mcp.json'), s.buttons);
  check('with nothing configured there is no toggle to render',
    s.rows.length === 0, s.rows);
  await checkSections(p, 'no file');
  checkPageClean(p, 'no file');
  await p.close();
}

// B. Configured: one server that ran, one switched off.
{
  const p = await page(720, S({
    mcp: {
      available: true,
      servers: [
        { name: 'files', disabled: false, tools: 3, error: '' },
        { name: 'gh', disabled: true, tools: null, error: '' },
      ],
      error: '',
    },
  }));
  await openAll(p);
  const s = await section(p);
  check('the header counts the servers', /2 configured/.test(s.title), s.title);
  check('each server gets a row', s.rows.length === 2, s.rows);
  check('rows keep the order the file has', s.rows.map((r) => r.name).join(',') === 'files,gh',
    s.rows.map((r) => r.name));
  check('a server that ran shows the tool count it produced',
    s.rows[0].tag === '3 tools', s.rows[0]);
  check('a disabled server is tagged, not hidden', s.rows[1].tag === 'disabled', s.rows[1]);
  check('each row carries a switch', s.rows.every((r) => r.switches === 1), s.rows);
  check('an enabled server is switched on and a disabled one off',
    s.rows[0].checked === true && s.rows[1].checked === false, s.rows);
  checkPageClean(p, 'configured');
  await p.close();
}

// C. THE HONESTY ASSERTION. A server that has not run must not show a number.
{
  const p = await page(720, S({
    mcp: {
      available: true,
      servers: [{ name: 'never', disabled: false, tools: null, error: '' }],
      error: '',
    },
  }));
  await openAll(p);
  const s = await section(p);
  check('a server that has not run says so', s.rows[0].tag === 'not run yet', s.rows[0]);
  // Asserting the ABSENCE of a digit, not the presence of a phrase: the failure
  // this guards is a count nobody measured, whatever words sit around it.
  check('and it invents no count',
    !/[0-9]/.test(s.rows[0].tag), s.rows[0].tag);
  check('the section says where the counts come from',
    /last run/.test(s.note), s.note);
  check('and that servers do not outlive the run',
    /stops them when it ends/.test(s.note), s.note);
  checkPageClean(p, 'not run yet');
  await p.close();
}

// D. A server that failed: the reason is reachable from its own row. As a chat
//    notice it would scroll away, and a failure nobody can read is not reported.
{
  const p = await page(720, S({
    mcp: {
      available: true,
      servers: [{
        name: 'gh', disabled: false, tools: 0,
        error: 'mcp server gh exited',
      }],
      error: '',
    },
  }));
  await openAll(p);
  const s = await section(p);
  check('a failed server is tagged failed', s.rows[0].tag === 'failed', s.rows[0]);
  check('and its row carries the reason',
    (await tipText(p, '.plist-row .help')) === 'mcp server gh exited',
    await tipText(p, '.plist-row .help'));
  check('a failure counts as having run, so it is not "not run yet"',
    s.rows[0].tag !== 'not run yet', s.rows[0]);
  checkPageClean(p, 'failed');
  await p.close();
}

// E. The toggle posts the server and the new state — and only those, because the
//    host writes the file from the name.
{
  const p = await page(720, S({
    mcp: {
      available: true,
      servers: [{ name: 'files', disabled: false, tools: 3, error: '' }],
      error: '',
    },
  }));
  await openAll(p);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((s) => s.getAttribute('data-sec') === 'mcp');
    sec.querySelector('.plist-row .beh input').click();
  });
  await p.waitForTimeout(200);
  const all = await p.evaluate(() => window.__posted);
  check('switching a server off posts it',
    all.some((m) => m.type === 'set-mcp-disabled' && m.name === 'files' && m.disabled === true),
    all);
  checkPageClean(p, 'toggle');
  await p.close();
}

// F. A BROKEN FILE. The section opens by itself and the message is in the DOM —
//    a collapsed section holding the only explanation reads as an empty one.
{
  const p = await page(720, S({
    mcp: {
      available: false,
      servers: [],
      error: 'mcp.json is not valid JSON — Unexpected end of JSON input',
    },
  }));
  // Deliberately NOT openAll: the section must open itself.
  const s = await section(p);
  check('a parse error opens the section without the user clicking', s.open === true, s.open);
  check('the header says error rather than claiming zero',
    /error/.test(s.title) && !/0 configured/.test(s.title), s.title);
  const help = await tipText(p, '.dhead .help');
  check('the error reaches the panel', /not valid JSON/.test(help), help);
  check('and it names the file it came from', /mcp\.json/.test(help), help);
  check('the empty state does not claim nothing is configured',
    !/No MCP servers configured yet/.test(s.starter), s.starter);
  check('it says the file could not be read instead',
    /could not be read/.test(s.starter), s.starter);
  checkPageClean(p, 'parse error');
  await p.close();
}

// G. Open is the way in when there is no file, and it posts the action the host
//    answers by creating one.
{
  const p = await page(720, S());
  await openAll(p);
  await p.evaluate(() => window.__posted.length = 0);
  await p.evaluate(() => {
    const sec = [...document.querySelectorAll('#sbody .sec')]
      .find((s) => s.getAttribute('data-sec') === 'mcp');
    [...sec.querySelectorAll('.dhead button')]
      .find((b) => b.textContent === 'Open mcp.json').click();
  });
  await p.waitForTimeout(200);
  const all = await p.evaluate(() => window.__posted);
  check('Open posts open-mcp', all.some((m) => m.type === 'open-mcp'), all);
  checkPageClean(p, 'open');
  await p.close();
}

// H. A host payload with no mcp key at all must not abort the render. This is
//    the D47j lesson: a throw inside showSettings kills every section after it.
{
  const p = await page(720, S({ mcp: undefined }));
  await openAll(p);
  const s = await section(p);
  check('an older payload still renders the section', s !== null, s);
  check('and it reads as the empty state', /0 configured/.test(s.title), s.title);
  await checkSections(p, 'missing key');
  checkPageClean(p, 'missing key');
  await p.close();
}

console.log('');
await finish('mcp servers section');
