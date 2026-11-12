/**
 * D49cd render suite: local paths, thumbnails, paste and drop.
 *
 * The client's agent wrote screenshots as `.scratch/shots/homeowner-PANEL-FINAL.png`
 * in backticks and the user could not open one. These checks are the page's
 * half of the fix:
 *   - a path in a reply is a span with data-path, never an href;
 *   - clicking it posts open-path and does NOT navigate;
 *   - an image path the host answers with a URI is drawn as a thumbnail at the
 *     measured caps, with the file name under it;
 *   - a paste of an image is posted as bytes, a text paste is not intercepted,
 *     and a dropped uri-list is posted as a path.
 *
 * The host's half — does the file exist, is it under 3 MB, where is it served
 * from — is pinned by `packages/vs/test/paths.test.mjs`.
 */
import * as core from '../../packages/core/dist/src/index.js';
import { page, check, checkPageClean, finish } from './plib.mjs';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const send = (p, msg) =>
  p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);

/* A. A path inside inline code is clickable, and an image becomes a thumbnail. */
{
  const p = await page(760);
  const md = core.renderMarkdown(
    'Saved `.scratch/shots/homeowner-PANEL-FINAL.png` for the panel.',
  );
  await send(p, { type: 'md', text: md });
  await p.waitForTimeout(200);

  const dom = await p.evaluate(() => {
    const el = document.querySelector('.md-path');
    return {
      has: !!el,
      path: el ? el.getAttribute('data-path') : null,
      href: el ? el.getAttribute('href') : 'none',
      role: el ? el.getAttribute('role') : '',
    };
  });
  check('a path in backticks is a path control', dom.has, dom);
  check('it carries the path as data', dom.path === '.scratch/shots/homeowner-PANEL-FINAL.png', dom);
  check('it is NOT an href the webview could follow', dom.href === null, dom);

  const asked = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'check-paths'));
  check('the page asks the host about it once',
    asked.length === 1 && asked[0].paths.length === 1, asked);

  // The host answers with a resource URI. A 400x200 image must be drawn inside
  // the 280x160 caps, not at its natural size.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
    '<rect width="400" height="200" fill="#4a90d9"/></svg>';
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await send(p, {
    type: 'path-info',
    entries: [{
      path: '.scratch/shots/homeowner-PANEL-FINAL.png',
      name: 'homeowner-PANEL-FINAL.png',
      thumb: uri,
    }],
  });
  await p.waitForFunction(() => {
    const i = document.querySelector('.md-thumb img');
    return !!i && i.complete && i.naturalWidth > 0;
  });
  const t = await p.evaluate(() => {
    const fig = document.querySelector('.md-thumb');
    const img = fig.querySelector('img');
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      maxW: cs.maxWidth,
      maxH: cs.maxHeight,
      fit: cs.objectFit,
      border: cs.borderTopWidth,
      cap: (fig.querySelector('figcaption') || {}).textContent,
    };
  });
  check('the image path becomes a thumbnail', t.w > 0 && t.h > 0, t);
  check('it is capped at 160px high and 280px wide',
    t.maxH === '160px' && /min\(280px, 100%\)|280px/.test(t.maxW), t);
  check('a 400x200 image is scaled into the caps',
    t.w <= 280 && t.h <= 160 && t.w === 280 && Math.abs(t.h - 140) <= 1, t);
  check('it keeps its whole frame (object-fit: contain)', t.fit === 'contain', t);
  check('it has a 1px border', t.border === '1px', t);
  check('the file name is under it',
    t.cap === 'homeowner-PANEL-FINAL.png', t);
  checkPageClean(p, 'thumbnail');
  await p.close();
}

/* A2. The thumbnail scales with a narrow panel rather than overflowing it. */
{
  const p = await page(240);
  const md = core.renderMarkdown('`shots/homeowner-PANEL-FINAL.png`');
  await send(p, { type: 'md', text: md });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">' +
    '<rect width="800" height="400" fill="#4a90d9"/></svg>';
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await send(p, {
    type: 'path-info',
    entries: [{ path: 'shots/homeowner-PANEL-FINAL.png', name: 'homeowner-PANEL-FINAL.png', thumb: uri }],
  });
  await p.waitForFunction(() => {
    const i = document.querySelector('.md-thumb img');
    return !!i && i.complete && i.naturalWidth > 0;
  });
  const t = await p.evaluate(() => {
    const r = document.querySelector('.md-thumb img').getBoundingClientRect();
    const wide = [...document.querySelectorAll('body *')]
      .map((e) => ({ c: e.className || e.tagName, r: e.getBoundingClientRect().right }))
      .filter((x) => x.r > window.innerWidth + 1)
      .slice(0, 5);
    return { w: Math.round(r.width), right: Math.round(r.right), vw: window.innerWidth, wide };
  });
  check('a narrow panel shrinks the thumbnail inside the panel',
    t.w < 280 && t.w > 60 && t.right <= t.vw + 1, t);
  checkPageClean(p, 'narrow thumbnail');
  await p.close();
}

/* B. Clicking a path posts open-path and does not navigate. */
{
  const p = await page(760);
  await send(p, { type: 'md', text: core.renderMarkdown('Open /home/me/photo.png please') });
  await p.waitForTimeout(120);
  const before = await p.evaluate(() => location.href);
  await p.evaluate(() => { document.querySelector('.md-path').click(); });
  const posted = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'open-path'));
  check('clicking a path asks the host to open it',
    posted.length === 1 && posted[0].path === '/home/me/photo.png', posted);
  const after = await p.evaluate(() => location.href);
  check('the page does not navigate to the file', after === before, { before, after });

  // The host's own answer when the file is not there. This proves the chat can
  // SHOW it; that the host SENDS it is pinned by the host test.
  await send(p, {
    type: 'notice',
    text: 'Could not open "shots/gone.png" — file not found (ENOENT).',
  });
  await p.waitForTimeout(120);
  const text = await p.evaluate(() => document.getElementById('log').textContent);
  check('a missing path says why in the chat',
    text.includes('file not found (ENOENT)'), text);
  checkPageClean(p, 'open path');
  await p.close();
}

/* C. A pasted image is posted as bytes; a text paste is untouched. */
{
  const p = await page(760);
  const pasted = await p.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'clip.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.getElementById('q').dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 250));
    return window.__posted;
  }, PNG);
  const bytes = pasted.find((m) => m.type === 'attach-bytes');
  check('a pasted image reaches the host as bytes',
    !!bytes && bytes.name === 'clip.png' && bytes.mime === 'image/png'
      && bytes.data === PNG, bytes);

  // The host's reply is what draws the chip — the same attach-result the
  // paperclip produces.
  await send(p, {
    type: 'attach-result',
    accepted: [{ path: 'pasted-1-clip.png', name: 'pasted-1-clip.png', image: true, size: 68 }],
    rejected: [],
  });
  await p.waitForTimeout(120);
  const chips = await p.evaluate(() =>
    [...document.querySelectorAll('.attach-chip .ac-name')].map((n) => n.textContent));
  check('the pasted image appears as a chip',
    chips.some((c) => c.startsWith('pasted-1-clip.png')), chips);

  const text = await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    const before = window.__posted.length;
    document.getElementById('q').dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, added: window.__posted.length - before };
  });
  check('a text paste is not intercepted at all',
    text.prevented === false && text.added === 0, text);
  checkPageClean(p, 'paste');
  await p.close();
}

/* D. A dropped uri-list is attached by PATH, not by bytes. */
{
  const p = await page(760);
  const posted = await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', 'file:///Users/me/My%20Folder/shot.png');
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    document.dispatchEvent(ev);
    return window.__posted;
  });
  const paths = posted.find((m) => m.type === 'attach-paths');
  check('a dropped file path is attached by path',
    !!paths && paths.paths.length === 1
      && paths.paths[0] === '/Users/me/My Folder/shot.png', paths);

  await send(p, {
    type: 'attach-result',
    accepted: [{
      path: '/Users/me/My Folder/shot.png',
      name: 'shot.png',
      image: true,
      size: 9800,
    }],
    rejected: [],
  });
  await p.waitForTimeout(120);
  const chips = await p.evaluate(() =>
    [...document.querySelectorAll('.attach-chip .ac-name')].map((n) => n.textContent));
  check('the dropped file appears as a chip',
    chips.some((c) => c.startsWith('shot.png')), chips);
  checkPageClean(p, 'drop');
  await p.close();
}

await finish('paths: links, thumbnails, paste and drop');
