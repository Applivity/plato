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
  approvalCancelled,
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

/**
 * The host's per-call label (extension.ts, promptCard): a write card that
 * remembers its yes for every path on it says so — "Allow this file" for one,
 * "Allow these files" for several — and a call with no usable path keeps the
 * view's plain "Allow once" fallback. Mirrored here because the host's helper
 * is not exported from core; the assertion is about what the view DRAWS for the
 * message it is sent, and the click below is by that label.
 */
const allowOnceFor = (tool, args) => {
  const paths = tool === 'apply_patch'
    ? (Array.isArray(args.patches) ? args.patches.map((p) => p.path).filter(Boolean) : [])
    : (args.path === undefined ? [] : [args.path]);
  if (paths.length === 0) return undefined;
  return paths.length === 1 ? 'Allow this file' : 'Allow these files';
};

/** An approval message exactly as the host builds one. */
const card = (tool, args, host) => ({
  type: 'approval',
  tool,
  sessionKey: host ? `${tool}:${host}` : tool,
  ...(host ? { host } : {}),
  heading: approvalHeading(tool, args),
  allowAll: approvalAllowAll(tool, host),
  ...(allowOnceFor(tool, args) === undefined ? {} : { allowOnce: allowOnceFor(tool, args) }),
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
  if (!c) {
    return {
      found: false, buttons: [], text: '', heading: '', tool: '',
      outcome: '', mark: '', time: '', you: 0,
    };
  }
  const h = c.querySelector('h3');
  // D49fr: an answered card's heading is a mark, a label and a time; a live
  // card's is one text node. Reading the label when it exists keeps every
  // heading check about the sentence, not about the decoration.
  const label = h ? h.querySelector('.out-text') : null;
  const mark = h ? h.querySelector('.out-mark') : null;
  const time = h ? h.querySelector('.msg-time') : null;
  return {
    found: true,
    // Trimmed: a button can carry child markup (the run controls now do),
    // and an exact-text match on untrimmed text is how a cosmetic change turns
    // into an unrelated red suite.
    buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()),
    text: c.textContent,
    heading: h ? (label ? label.textContent : h.textContent) : '',
    outcome: c.dataset.outcome ?? '',
    mark: mark ? mark.textContent : '',
    time: time ? time.textContent : '',
    you: document.querySelectorAll('.msg.you').length,
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
  check('and its per-call button says the yes covers every path on the card',
    (await cardInfo(p)).buttons[0] === 'Allow these files', (await cardInfo(p)).buttons);
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
  // The host remembers the yes for this file, so the button says that rather
  // than promising one call it does not grant.
  check('a single-file card\'s per-call button says Allow this file',
    (await cardInfo(p)).buttons[0] === 'Allow this file', (await cardInfo(p)).buttons);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.approval-card button')]
      .find((b) => b.textContent.trim() === 'Allow this file').click();
  });
  await p.waitForTimeout(150);
  const r = await cardInfo(p);
  check('the answered card says it was allowed',
    r.heading === approvalAnswered('Let Plato write src/a.ts?', true), r.heading);
  // D49fr: the answer lives on the card — carry it as data, draw a mark, keep
  // the time — instead of a "You" message reading "[allowed]" underneath.
  check('the card carries its outcome as data, so the mark can be coloured',
    r.outcome === 'allowed', r.outcome);
  check('the outcome has a mark and the minute beside it',
    r.mark.length > 0 && r.time.length > 0, r);
  check('and nothing is written in the person\'s name',
    r.you === 0, r.you);
  check('and the buttons are gone, so it cannot be answered twice',
    r.buttons.length === 0, r.buttons);
  // Still the same card, still findable by class: anything watching for an OPEN
  // card must not read this one as live.
  check('and it is marked answered',
    await p.evaluate(() => document.querySelector('.card.approval-card.answered') !== null));
  checkPageClean(p, 'answered card');
  await p.close();
}

// F2. Deny and cancel are outcomes too, and each takes its own mark. Neither
//     writes a message in the person's name.
{
  const p = await page(900, S());
  const denied = card('shell', { preview: '{"command":"rm -rf build"}' });
  await post(p, denied);
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    [...document.querySelectorAll('.card.approval-card button')]
      .find((b) => b.textContent.trim() === 'Deny').click();
  });
  await p.waitForTimeout(150);
  const r = await cardInfo(p);
  check('a denied card says it was denied',
    r.heading === approvalAnswered(denied.heading, false), r.heading);
  check('and carries the denied outcome, so the mark is red',
    r.outcome === 'denied', r.outcome);
  check('with a mark to colour', r.mark.length > 0, r);
  check('and no message in the person\'s name', r.you === 0, r.you);
  checkPageClean(p, 'denied card');
  await p.close();
}

// F3. A card the host closed on cancel says cancelled — it must not claim the
//     person answered, and it must not borrow the denied mark.
{
  const p = await page(900, S());
  const m = card('shell', {});
  await post(p, m);
  await p.waitForTimeout(250);
  await post(p, { type: 'approval-done', text: approvalCancelled(m.heading) });
  await p.waitForTimeout(150);
  const r = await cardInfo(p);
  check('a cancelled card says cancelled, not denied',
    r.outcome === 'cancelled' && /cancelled$/.test(r.heading), r);
  check('and draws no message in the person\'s name', r.you === 0, r.you);
  checkPageClean(p, 'cancelled card');
  await p.close();
}

// F4. A record written before the change kept the answer as a "You" message.
//     Replay skips it, so an old conversation comes back without the fake turn.
{
  const p = await page(900, S());
  await post(p, { type: 'restore', hasConnections: true, title: '', log: [
    { k: 'msg', cls: 'you', who: 'You', text: '[allowed]', t: Date.now() },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Applied.' },
  ] });
  await p.waitForTimeout(250);
  const n = await p.evaluate(() => document.querySelectorAll('.msg.you').length);
  check('an old "[allowed]" is not replayed as a turn the person took', n === 0, n);
  checkPageClean(p, 'legacy record');
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
