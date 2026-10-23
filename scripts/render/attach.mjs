import { check, checkPageClean, page, finish } from './plib.mjs';

/**
 * D49o: the attachment chips in the composer.
 *
 * The chip is a UI mirror — the host owns what is attached — so the risk here is
 * that the two drift: an image that silently renders as a plain text chip, or a
 * refusal the user never sees. Both are asserted rather than eyeballed.
 *
 * The image chip is a GLYPH plus the size, not a thumbnail. That is deliberate:
 * there is no resize anywhere in the pipeline, so a thumbnail would mean posting
 * the whole file as a data: URI, and it would need `img-src` in the CSP. If that
 * changes, this suite is where the new expectation belongs.
 */
const p = await page(700);
const send = (data) =>
  p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), data);

await send({
  type: 'attach-result',
  accepted: [{ path: 'src/a.ts' }],
  rejected: [],
});
await send({
  type: 'attach-result',
  accepted: [{ path: 'shot.png', image: true, size: 245760 }],
  rejected: [],
});
await send({
  type: 'attach-result',
  accepted: [],
  rejected: [{ path: 'lies.png', error: 'not a PNG, JPEG, WebP or GIF' }],
});
await p.waitForTimeout(150);

const r = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('#attachRow .attach-chip')];
  return {
    count: chips.length,
    names: chips.map((c) => (c.querySelector('.ac-name') || {}).textContent),
    glyphs: chips.filter((c) => c.querySelector('.ac-img')).length,
    rowHidden: document.getElementById('attachRow').hidden,
    log: (document.getElementById('log') || {}).textContent || '',
  };
});
check('both accepted attachments render a chip', r.count === 2, r);
check('the text chip is unchanged', r.names[0] === 'src/a.ts', r.names);
check('only the image chip carries the glyph', r.glyphs === 1, r);
const thumbnails = await p.evaluate(
  () => document.querySelectorAll('#attachRow img').length,
);
check('an image chip is a glyph, not a thumbnail', thumbnails === 0, thumbnails);
check('the image chip shows its size', r.names[1] === 'shot.png  240 KB', r.names);
check('the row is visible while chips exist', r.rowHidden === false, r.rowHidden);
check('a refusal is reported, not swallowed', r.log.includes('not a PNG'), r.log);

// Removing the last chip hides the row rather than leaving an empty gap.
await p.evaluate(() => {
  for (const b of document.querySelectorAll('#attachRow .attach-chip .ac-x')) {
    b.click();
  }
});
await p.waitForTimeout(150);
const hidden = await p.evaluate(() => document.getElementById('attachRow').hidden);
check('the row hides when the last chip goes', hidden === true, hidden);

checkPageClean(p, 'attach');
await p.close();
await finish('attachment chips');
