import { b, check, finish, page, checkPageClean, html } from './plib.mjs';

/**
 * D49cd: the Plato mark in the chat header starts a conversation, and what
 * "start" means depends on the surface:
 *
 *   - a chat TAB (newChatTab true) opens another tab — the same action as the
 *     title-bar mark;
 *   - the activity-bar chat (newChatTab false) clears THIS view: the host
 *     archives the conversation to History and shows the empty state.
 *
 * The page is a plain script, so the wire proof is the message it posts. The
 * default HTML is the no-tabs/no-new-tab shape (the Visual Studio window and
 * the side surface); the second page flips the attribute the host writes for a
 * tab surface.
 */

// Opens the same shipped HTML with the tab-surface capabilities.
async function pageAsTab(w) {
  const p = await b.newPage({ viewport: { width: w, height: 1700 } });
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(String(e.message)));
  p.on('console', (m) => { if (m.type() === 'error') p.__errors.push(m.text()); });
  const body = html()
    .replace('data-plato-tabs="false"', 'data-plato-tabs="true"')
    .replace('data-plato-newtab="false"', 'data-plato-newtab="true"');
  await p.route('**/*', (r) => (r.request().url().endsWith('/plato.html')
    ? r.fulfill({ contentType: 'text/html', body }) : r.abort()));
  await p.addInitScript(() => {
    window.__posted = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__posted.push(m); } });
  });
  await p.goto('http://localhost/plato.html');
  await p.waitForFunction(() => !!document.getElementById('gear'));
  return p;
}

const shape = (p) => p.evaluate(() => {
  const b = document.getElementById('new');
  const nav = document.querySelector('.headnav');
  return {
    exists: !!b,
    inNav: !!nav && nav.contains(b),
    first: nav ? nav.querySelector('button')?.id : null,
    title: b ? b.title : null,
    markPaths: b ? b.querySelectorAll('svg.mark path').length : 0,
  };
});

// A. The control itself: the Plato mark, beside history and settings, named.
{
  const p = await page(760);
  const s = await shape(p);
  check('the header draws a new-chat control', s.exists, s);
  check('it is inside the history/settings cluster, first of the three', s.inNav && s.first === 'new', s);
  check('its tooltip says "New chat"', s.title === 'New chat', s);
  check('it is the Plato mark (the owl path set), not a plus glyph', s.markPaths >= 3, s);
  checkPageClean(p, 'header mark');
  await p.close();
}

// B. No-tabs surface: the mark CLEARS this view (the host asks first and
// archives to History). This is the message that task's clearing path carries.
{
  const p = await page(760);
  await p.evaluate(() => document.getElementById('new').click());
  await p.waitForTimeout(120);
  const posted = await p.evaluate(() => window.__posted);
  const kinds = posted.map((m) => m.type);
  check('with newChatTab false the mark posts the clearing action', kinds.includes('newChat'), kinds);
  check('and it does not ask the host to open a tab', !kinds.includes('new-tab'), kinds);
  // The host clears at once only for a click on this visible button; the menu
  // and command paths reach the same handler without the flag and keep asking.
  const clear = posted.find((m) => m.type === 'newChat');
  check('the clearing click says it came from the header button', clear?.fromHeader === true, clear);
  checkPageClean(p, 'new chat clears');
  await p.close();
}

// C. Tab surface: the mark asks for another tab, exactly like the title bar.
{
  const p = await pageAsTab(760);
  await p.evaluate(() => document.getElementById('new').click());
  await p.waitForTimeout(120);
  const kinds = await p.evaluate(() => window.__posted.map((m) => m.type));
  check('with newChatTab true the mark posts the new-tab action', kinds.includes('new-tab'), kinds);
  check('and it does not clear this conversation', !kinds.includes('newChat'), kinds);
  checkPageClean(p, 'new chat opens a tab');
  await p.close();
}

console.log('');
await finish('new chat control');
