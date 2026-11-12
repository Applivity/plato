/**
 * D49cd render suite: local paths, thumbnails, paste and drop.
 *
 * The client's agent wrote screenshots as `.scratch/shots/homeowner-PANEL-FINAL.png`
 * in backticks and the user could not open one. These checks are the page's
 * half of the fix:
 *   - a path in a reply is a span with data-path, never an href;
 *   - clicking it posts open-path and does NOT navigate;
 *   - an image path the host answers with a URI is drawn as a small inline
 *     hint (64px square) that sits inside the running text, names itself in the
 *     title, and opens the full image when clicked;
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

  // The host answers with a resource URI. A 400x200 image is a HINT, not a
  // picture: it must be drawn as a 64px square inside the sentence.
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
    const i = document.querySelector('.md-thumb');
    return !!i && i.tagName === 'IMG' && i.complete && i.naturalWidth > 0;
  });
  const t = await p.evaluate(() => {
    const img = document.querySelector('.md-thumb');
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    return {
      tag: img.tagName,
      w: Math.round(r.width),
      h: Math.round(r.height),
      fit: cs.objectFit,
      radius: cs.borderRadius,
      display: cs.display,
      vAlign: cs.verticalAlign,
      margin: cs.marginLeft + ' ' + cs.marginRight,
      border: cs.borderTopWidth,
      title: img.getAttribute('title'),
      captions: document.querySelectorAll('figcaption').length,
      inPara: !!img.closest('p'),
    };
  });
  console.log('MEASURED single thumbnail', JSON.stringify(t));
  check('the image path becomes a thumbnail', t.tag === 'IMG' && t.w > 0, t);
  check('it is a 64x64 square', t.w === 64 && t.h === 64, t);
  check('it is covered into a tidy square (object-fit: cover)', t.fit === 'cover', t);
  check('it has a 3px border radius', t.radius === '3px', t);
  check('it sits inline inside the running text',
    t.display === 'inline-block' && t.vAlign === 'middle' && t.inPara, t);
  check('with small side margins', t.margin === '2px 2px', t);
  check('it has a 1px border', t.border === '1px', t);
  check('the file name is in the title, not a caption',
    /homeowner-PANEL-FINAL\.png/.test(String(t.title)) && t.captions === 0, t);

  // Clicking the hint still opens the FULL image, through the same host call.
  await p.evaluate(() => document.querySelector('.md-thumb').click());
  const opened = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'open-path'));
  check('clicking the thumbnail asks the host to open the image',
    opened.length === 1
      && opened[0].path === '.scratch/shots/homeowner-PANEL-FINAL.png', opened);
  checkPageClean(p, 'thumbnail');
  await p.close();
}

/* A1. Several images in one sentence line up inline, not one per line. */
{
  const p = await page(760);
  const md = core.renderMarkdown(
    'Three files here: `a.png` and `b.png` and `c.png`. Click either one.',
  );
  await send(p, { type: 'md', text: md });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' +
    '<rect width="400" height="200" fill="#4a90d9"/></svg>';
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await send(p, {
    type: 'path-info',
    entries: ['a.png', 'b.png', 'c.png'].map((n) => ({ path: n, name: n, thumb: uri })),
  });
  await p.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.md-thumb')];
    return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
  const m = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll('.md-thumb')];
    const para = imgs[0].closest('p');
    const rects = imgs.map((i) => i.getBoundingClientRect());
    const line = parseFloat(getComputedStyle(para).lineHeight) || 0;
    return {
      count: imgs.length,
      samePara: imgs.every((i) => i.closest('p') === para),
      tops: rects.map((r) => Math.round(r.top)),
      sizes: rects.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)),
      rowSpread: Math.round(Math.max(...rects.map((r) => r.top))
        - Math.min(...rects.map((r) => r.top))),
      paraH: Math.round(para.getBoundingClientRect().height),
      imgH: Math.round(rects[0].height),
      line: Math.round(line),
    };
  });
  console.log('MEASURED three in one sentence', JSON.stringify(m));
  check('three image paths in one sentence draw three hints',
    m.count === 3 && m.samePara, m);
  check('they share one line, not one line each', m.rowSpread <= 2, m);
  check('the paragraph stays about one thumbnail tall',
    m.paraH <= m.imgH + Math.max(8, m.line), m);
  checkPageClean(p, 'three inline');
  await p.close();
}

/* A1b. A preview that cannot load puts the clickable path back. */
{
  const p = await page(760);
  await send(p, { type: 'md', text: core.renderMarkdown('Saved `shots/gone.png` for the panel.') });
  await p.waitForTimeout(120);
  // A URI that cannot decode: the host probed a file, then it went away, or
  // the webview's img-src blocked the resource.
  await send(p, {
    type: 'path-info',
    entries: [{
      path: 'shots/gone.png',
      name: 'gone.png',
      thumb: 'data:image/png;base64,bm90LWFuLWltYWdl',
    }],
  });
  // The path must come back; a timeout here fails the checks below with data
  // rather than aborting the suite.
  await p.waitForFunction(() =>
    !document.querySelector('.md-thumb') && !!document.querySelector('.md-path'),
  null, { timeout: 5_000 }).catch(() => {});
  const back = await p.evaluate(() => {
    const el = document.querySelector('.md-path');
    return {
      thumbs: document.querySelectorAll('.md-thumb').length,
      imgs: document.querySelectorAll('#log img').length,
      path: el ? el.getAttribute('data-path') : null,
      role: el ? el.getAttribute('role') : '',
      tab: el ? el.getAttribute('tabindex') : '',
      text: el ? el.textContent : '',
      sentence: document.getElementById('log').textContent,
    };
  });
  check('a failed preview leaves no broken image', back.thumbs === 0 && back.imgs === 0, back);
  check('the path text is back, as a path control',
    back.path === 'shots/gone.png' && back.text.includes('shots/gone.png'), back);
  check('with the role and tab stop it had before',
    back.role === 'link' && back.tab === '0', back);
  check('the sentence reads as it did before the preview',
    back.sentence.includes('Saved shots/gone.png for the panel.'), back.sentence);

  await p.evaluate(() => document.querySelector('.md-path').click());
  const posted = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'open-path'));
  check('and clicking it still asks the host to open the path',
    posted.length === 1 && posted[0].path === 'shots/gone.png', posted);

  // The host answering again must not re-break it: a failed preview is final.
  await send(p, {
    type: 'path-info',
    entries: [{
      path: 'shots/gone.png',
      name: 'gone.png',
      thumb: 'data:image/png;base64,bm90LWFuLWltYWdl',
    }],
  });
  await p.waitForTimeout(150);
  const again = await p.evaluate(() => ({
    thumbs: document.querySelectorAll('.md-thumb').length,
    paths: document.querySelectorAll('.md-path').length,
  }));
  check('a repeated answer does not draw the broken preview again',
    again.thumbs === 0 && again.paths === 1, again);
  checkPageClean(p, 'failed thumbnail');
  await p.close();
}

/* A2. The hint stays inside a narrow panel. */
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
    const i = document.querySelector('.md-thumb');
    return !!i && i.complete && i.naturalWidth > 0;
  });
  const t = await p.evaluate(() => {
    const r = document.querySelector('.md-thumb').getBoundingClientRect();
    const wide = [...document.querySelectorAll('body *')]
      .map((e) => ({ c: e.className || e.tagName, r: e.getBoundingClientRect().right }))
      .filter((x) => x.r > window.innerWidth + 1)
      .slice(0, 5);
    return { w: Math.round(r.width), right: Math.round(r.right), vw: window.innerWidth, wide };
  });
  check('a narrow panel keeps the hint at 64px, inside the panel',
    t.w === 64 && t.right <= t.vw + 1, t);
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
