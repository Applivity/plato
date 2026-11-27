import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * D49fh: copy.
 *
 * The founder's rule: not every reply deserves a button, and a button on every
 * reply would be noise. So the suite checks the shape of that rule, not only
 * that copying works: a fenced block carries one, a reply carries one for its
 * whole text, the person's own turn carries none, and none of them is drawn
 * until the pointer is over the thing it copies.
 *
 * The clipboard itself is a stub here: a suite can prove the button passes the
 * RIGHT TEXT, and cannot prove the operating system accepted it. That half is
 * checked in the installed extension.
 */

// The host builds the HTML from core, so the suite renders markdown with the
// same function the product uses — a hand-written block would test the test.
const core = await import('../../packages/core/dist/src/index.js');

const MATCH = `Run this to match CI:

\`\`\`sh
npm test -- --watch=false
\`\`\`

Then check the report.`;

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

/** Records what the page hands to the clipboard, either way it gets there. */
const stubClipboard = (p, { withApi = true } = {}) => p.evaluate((useApi) => {
  window.__copied = null;
  window.__execText = null;
  const write = async (t) => { window.__copied = t; };
  if (useApi) {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: write }, configurable: true,
      });
    } catch { navigator.clipboard.writeText = write; }
  } else {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined, configurable: true,
      });
    } catch { /* older engines refuse; the exec path is tested below anyway */ }
  }
  document.execCommand = (name) => {
    window.__execText = document.activeElement ? document.activeElement.value : '';
    return name === 'copy';
  };
}, withApi);

const buttons = (p) => p.evaluate(() => {
  const opacity = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
  const copy = document.querySelector('.copy-btn');
  const reply = document.querySelector('.msg-copy');
  return {
    blocks: document.querySelectorAll('.copy-btn').length,
    replies: document.querySelectorAll('.msg-copy').length,
    blockOpacity: opacity(copy),
    replyOpacity: opacity(reply),
    // D49fj: the controls are icons, so what they SAY lives in the accessible
    // name and the tooltip, not in their text.
    blockLabel: copy ? (copy.getAttribute('aria-label') || '') : '',
    replyLabel: reply ? (reply.getAttribute('aria-label') || '') : '',
    blockText: copy ? copy.textContent.trim() : '',
    inBar: copy ? copy.parentElement.classList.contains('md-lang') : false,
    barHeight: copy ? copy.parentElement.getBoundingClientRect().height : 0,
  };
});

{
  const p = await page(760, S({ open: false }));
  await stubClipboard(p);
  await post(p, { type: 'md', text: core.renderMarkdown(MATCH) });
  await post(p, { type: 'done', text: { secs: 3, tools: 0 } });
  await p.waitForTimeout(200);

  const a = await buttons(p);
  check('a fenced block carries a copy button', a.blocks === 1, a);
  check('the control sits in the block\'s bar, not over the code',
    a.inBar === true && a.barHeight >= 20, a);
  check('and it is a glyph with an accessible name, not a word',
    a.blockText === '' && a.blockLabel === 'Copy this block', a);
  check('the reply carries ONE button for its whole text', a.replies === 1, a);
  check('neither is drawn until the pointer is over it',
    a.blockOpacity === 0 && a.replyOpacity === 0, a);

  await p.hover('.md-code');
  await p.waitForTimeout(120);
  check('pointing at the block draws its button',
    (await buttons(p)).blockOpacity === 1, await buttons(p));

  await p.click('.copy-btn');
  await p.waitForTimeout(150);
  const copied = await p.evaluate(() => window.__copied);
  check('the block copies its body and nothing else',
    copied === 'npm test -- --watch=false', copied);
  check('and the control said what happened, to a screen reader too',
    (await buttons(p)).blockLabel === 'Copied', await buttons(p));

  await p.waitForTimeout(1500);
  check('then it went back to being an offer',
    (await buttons(p)).blockLabel === 'Copy this block', await buttons(p));

  await p.hover('.msg.bot');
  await p.click('.msg-copy');
  await p.waitForTimeout(150);
  const reply = await p.evaluate(() => window.__copied);
  check('the reply copies its text without the speaker label',
    reply.startsWith('Run this to match CI') && !reply.includes('PLATO'),
    reply);
  check('and without its own button label in the text',
    !/\bCopy\b|\bCopied\b/.test(reply), reply);

  checkPageClean(p, 'copy buttons');
  await p.close();
}

// The person's own turn never carries one, and a reply with no code gets the
// reply button only.
{
  const p = await page(760, S({ open: false }));
  await stubClipboard(p);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), {
    type: 'restore',
    hasConnections: true,
    title: '',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'Apply it and re-run the tests.' },
      { k: 'msg', cls: 'bot', who: 'Plato', text: 'Applied. All 46 pricing tests pass.' },
    ],
  });
  await p.waitForTimeout(300);
  const b = await buttons(p);
  check('the person\'s own turn carries no copy button',
    b.blocks === 0 && b.replies === 1, b);
  check('a reply with no code gets no block button',
    b.blocks === 0, b);
  checkPageClean(p, 'plain reply');
  await p.close();
}

// With no clipboard API on the page, the older path copies the same text. A
// webview host that does not grant the permission must not lose the feature.
{
  const p = await page(760, S({ open: false }));
  await stubClipboard(p, { withApi: false });
  await post(p, { type: 'md', text: core.renderMarkdown(MATCH) });
  await post(p, { type: 'done', text: { secs: 3, tools: 0 } });
  await p.waitForTimeout(200);
  await p.click('.copy-btn');
  await p.waitForTimeout(150);
  const viaExec = await p.evaluate(() => window.__execText);
  check('with no clipboard API the fallback copies the same text',
    viaExec === 'npm test -- --watch=false', viaExec);
  checkPageClean(p, 'fallback copy');
  await p.close();
}

console.log('');
await finish('copy');
