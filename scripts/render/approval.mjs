import {
  check,
  page,
  S,
  finish,
  checkPageClean,
  approvalHeading,
  approvalAllowAll,
  approvalAnswered,
  approvalAnsweredSession,
} from './plib.mjs';

/**
 * D49p: the approval card is where the user decides where Plato may go, so a
 * host-scoped approval must name the host — "Allow every request" would read as
 * covering every future host, which is exactly what it must not do.
 *
 * D49ba: and the card must say the SITUATION, not the tool. It used to read
 * "Approve web_fetch?" / "Approve apply_diff?" — Plato's own part names, where
 * the user needs to know what they are deciding.
 *
 * The fixtures are built by calling core, not by pasting strings. The host
 * composes this copy and sends it ready to draw, so a suite that pasted its own
 * would assert the harness's idea of the wording rather than the product's.
 */

/** An approval message exactly as the host builds one. */
const card = (tool, args, host) => ({
  type: 'approval',
  tool,
  sessionKey: host ? `${tool}:${host}` : tool,
  ...(host ? { host } : {}),
  heading: approvalHeading(tool, args),
  allowAll: approvalAllowAll(tool, host),
  // The three answered variants travel with it, because the view draws them.
  headingAllowed: approvalAnswered(approvalHeading(tool, args), true),
  headingDenied: approvalAnswered(approvalHeading(tool, args), false),
  headingSession: approvalAnsweredSession(approvalHeading(tool, args)),
  preview: args.preview ?? 'preview',
});

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const cardInfo = (p) => p.evaluate(() => {
  const c = document.querySelector('.card.approval-card');
  if (!c) return { found: false, buttons: [], text: '', heading: '', tool: '' };
  const h = c.querySelector('h3');
  return {
    found: true,
    buttons: [...c.querySelectorAll('button')].map((b) => b.textContent),
    text: c.textContent,
    heading: h ? h.textContent : '',
    tool: c.dataset.tool ?? '',
  };
});

// A. A host-scoped card names the host in the session button, and the card says
//    what is being decided rather than which tool is asking.
{
  const p = await page(900, S());
  await post(p, card('web_fetch', { preview: 'This sends a request to:\n\n  https://example.com/a' }, 'example.com'));
  await p.waitForTimeout(250);
  const r = await cardInfo(p);
  check('the approval card rendered', r.found, r);
  check('the card offers three choices', r.buttons.length === 3, r.buttons);
  check('the session button names the HOST',
    /\bexample\.com\b/.test(r.buttons.join('|')), r.buttons);
  check('and the heading says the situation, not the tool',
    r.heading === 'Let Plato fetch this page?', r.heading);
  check('the card carries its tool as data, so nothing has to read the copy',
    r.tool === 'web_fetch', r.tool);
  check('no button names an internal tool',
    !/web_fetch/.test(r.buttons.join('|')), r.buttons);
  check('the preview URL is visible on the card', r.text.includes('https://example.com/a'), r.text);
  checkPageClean(p, 'host card');
  await p.close();
}

// B. The session button reports back the HOST-SCOPED key, so the shell cannot
//    widen it into a tool-wide approval.
{
  const p = await page(900, S());
  await post(p, card('web_fetch', {}, 'example.com'));
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.card.approval-card button')]
      .find((x) => /^Allow every/.test(x.textContent));
    b.click();
  });
  await p.waitForTimeout(120);
  const posted = await p.evaluate(() => window.__posted);
  const all = posted.find((m) => m.type === 'approve-all');
  check('approve-all sent the host-scoped sessionKey',
    all && all.sessionKey === 'web_fetch:example.com', posted);
  checkPageClean(p, 'approve-all');
  await p.close();
}

// C. A tool with no host gets the ACTION's own words in the session button — the
//    host rule must not leak into shell and write approvals, and the button must
//    not fall back to printing an identifier.
{
  const p = await page(900, S());
  await post(p, card('shell', { preview: 'rm -rf build' }));
  await p.waitForTimeout(250);
  const r = await cardInfo(p);
  check('a hostless shell card says what will happen',
    r.heading === 'Let Plato run this command?', r.heading);
  const session = r.buttons.find((b) => /^Allow every/.test(b)) ?? '';
  check('and its session button names the action, not the tool',
    session === 'Allow every command this session', session);
  check('so nothing on the card prints "shell"',
    !/shell/.test(r.text), r.text);
  checkPageClean(p, 'hostless card');
  await p.close();
}

// D. A write card names the FILE. This is the change a user feels most: the old
//    card said "Approve apply_diff?" and left them to read the diff to find out
//    which file it was about.
{
  const p = await page(900, S());
  await post(p, card('apply_diff', { path: 'app/src/main/java/DateHelper.java', diffs: [] }));
  await p.waitForTimeout(250);
  const r = await cardInfo(p);
  check('a write card names the file it will edit',
    r.heading === 'Let Plato edit app/src/main/java/DateHelper.java?', r.heading);
  check('and never the tool', !/apply_diff/.test(r.text), r.text);
  checkPageClean(p, 'write card');
  await p.close();
}

// E. A multi-file patch counts them, because listing three long paths would push
//    the heading past the width where it can be read.
{
  const p = await page(900, S());
  await post(p, card('apply_patch', {
    patches: [{ path: 'a.ts', diffs: [] }, { path: 'b.ts', diffs: [] }, { path: 'c.ts', diffs: [] }],
  }));
  await p.waitForTimeout(250);
  check('a multi-file patch counts its files',
    (await cardInfo(p)).heading === 'Let Plato edit 3 files?', (await cardInfo(p)).heading);
  checkPageClean(p, 'patch card');
  await p.close();
}

// F. The answered card is the record of what was asked, so it must say which way
//    it went — and it must not depend on the heading ending in a question mark,
//    which is how the old one worked and silently did nothing when it did not.
{
  const p = await page(900, S());
  await post(p, card('write_file', { path: 'src/a.ts', content: 'x' }));
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.approval-card button')]
      .find((b) => b.textContent === 'Allow once').click();
  });
  await p.waitForTimeout(150);
  const r = await cardInfo(p);
  check('the answered card says it was allowed',
    r.heading === approvalAnswered('Let Plato write src/a.ts?', true), r.heading);
  check('and the buttons are gone, so it cannot be answered twice',
    r.buttons.length === 0, r.buttons);
  // Still the same card, still findable by class: anything watching for an OPEN
  // card must not read this one as live.
  check('and it is marked answered',
    await p.evaluate(() => document.querySelector('.card.approval-card.answered') !== null));
  checkPageClean(p, 'answered card');
  await p.close();
}

// G. The address warning is rendered as visible text, not swallowed.
{
  const p = await page(900, S());
  await post(p, card('web_fetch', {
    preview: 'This sends a request to:\n\n  http://169.254.169.254/latest/meta-data/'
      + '\n\nWARNING: 169.254.169.254 is the cloud metadata address, not a website.'
      + ' A request here can read this machine\'s cloud credentials.',
  }, '169.254.169.254'));
  await p.waitForTimeout(250);
  const r = await cardInfo(p);
  check('the warning card rendered', r.found, r);
  check('the metadata warning reaches the user', /cloud metadata address/.test(r.text), r.text);
  checkPageClean(p, 'warning card');
  await p.close();
}

await finish('approval');
