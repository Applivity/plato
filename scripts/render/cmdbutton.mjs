import { check, page, finish, checkPageClean, SLASH_META_MSG } from './plib.mjs';

/**
 * D49bl: the commands button. It opens the `/` menu, and until this suite
 * existed **nothing covered it at all** — not the glyph, not the click.
 *
 * The defect it was written for is worth stating because it survived every
 * other check in the repo: the icon was a bare diagonal drawn from the
 * top-left to the bottom-right, which on a screen is a BACKSLASH — the one
 * glyph that means the opposite of what the button does. No test could see it:
 * the markup was valid, the button worked, and a diagonal line is a diagonal
 * line to every assertion that is not about direction.
 *
 * So the assertions are about the two things a viewer reads off it — WHICH
 * glyph it is, and whether it is legible — plus the behaviour its icon change
 * could silently break.
 */

const post = (p, msg) => p.evaluate(
  (x) => window.dispatchEvent(new MessageEvent('message', { data: x })), msg);

/** The icon's geometry, in its own viewBox units. */
const glyph = (p) => p.evaluate(() => {
  const svg = document.querySelector('#cmds svg');
  if (!svg) { return null; }
  const line = svg.querySelector('line');
  const rect = svg.querySelector('rect');
  const num = (el, a) => (el ? Number(el.getAttribute(a)) : null);
  return {
    width: svg.getAttribute('width'),
    line: line ? {
      x1: num(line, 'x1'), y1: num(line, 'y1'),
      x2: num(line, 'x2'), y2: num(line, 'y2'),
    } : null,
    rect: rect ? {
      x: num(rect, 'x'), y: num(rect, 'y'),
      w: num(rect, 'width'), h: num(rect, 'height'),
      rx: num(rect, 'rx'),
    } : null,
    rendered: (() => { const b = svg.getBoundingClientRect(); return { w: b.width, h: b.height }; })(),
    button: (() => {
      const b = document.getElementById('cmds').getBoundingClientRect();
      return { w: b.width, h: b.height };
    })(),
  };
});

// A. It is a FORWARD slash, and the assertion is the property, not the numbers.
//
// Screen coordinates run y DOWNWARD, so the higher end of the line is the one
// with the SMALLER y. A forward slash leans so that its higher end is on the
// RIGHT; a backslash puts it on the left. Writing it that way means the check
// still holds if someone re-orders the endpoints or redraws with other numbers
// — which a "x1 === 15" assertion would not.
{
  const p = await page(760);
  const g = await glyph(p);
  check('the commands button draws an icon', g !== null && g.line !== null, g);
  const { x1, y1, x2, y2 } = g.line;
  const topIsOnTheRight = y1 < y2 ? x1 > x2 : x2 > x1;
  check('the glyph is a forward slash, not a backslash', topIsOnTheRight, g.line);
  // Guard the guard: a horizontal or vertical line would satisfy neither
  // reading, and a line whose ends share an x or y is not a slash at all.
  check('the glyph actually leans, so the reading above means something',
    x1 !== x2 && y1 !== y2, g.line);
  checkPageClean(p, 'commands glyph');
  await p.close();
}

// B. The box, and the glyph's place inside it. The box is the legibility half of
//    the change: a lone diagonal reads as a stray stroke, and a slash inside a
//    rounded square reads as a KEY. Centring is asserted because a keycap glyph
//    jammed into a corner is exactly the kind of thing nobody writes a test for
//    and everybody sees.
{
  const p = await page(760);
  const g = await glyph(p);
  check('the icon has a box outline, not just a line', g.rect !== null, g);
  // Null-safe from here: without a box there is nothing to measure, and a suite
  // that CRASHES on the defect reports less than one that fails and says why.
  check('the box is square', !!g.rect && g.rect.w === g.rect.h, g.rect);
  check('the box is rounded but not a circle',
    !!g.rect && g.rect.rx > 0 && g.rect.rx < g.rect.w / 2, g.rect);

  const cx = g.rect ? g.rect.x + g.rect.w / 2 : 0;
  const cy = g.rect ? g.rect.y + g.rect.h / 2 : 0;
  const mx = (g.line.x1 + g.line.x2) / 2;
  const my = (g.line.y1 + g.line.y2) / 2;
  check('the slash is centred in the box',
    !!g.rect && Math.abs(mx - cx) <= 1.5 && Math.abs(my - cy) <= 1.5,
    { glyphMid: [mx, my], boxMid: [cx, cy] });

  // The glyph must fill enough of the box to read. Measured against the box's
  // inner height: a slash shorter than half of it looks lost, which is what the
  // first attempt at this icon did.
  const inner = g.rect ? g.rect.h - 2 * 2 : 0; // box height less one stroke at each end
  const slashHeight = Math.abs(g.line.y2 - g.line.y1);
  check('the slash fills the box rather than floating in it',
    !!g.rect && slashHeight >= inner * 0.6, { slashHeight, inner });
  checkPageClean(p, 'commands box');
  await p.close();
}

// C. Size in the button: big enough to read, small enough to fit. A box is
//    mostly empty space and measures lighter than a solid glyph, so it is drawn
//    slightly larger than the paperclip beside it — and this is the assertion
//    that keeps a later "make the icons consistent" pass from shrinking it back
//    to the size that was hard to read, or from overflowing the button.
{
  const p = await page(760);
  const g = await glyph(p);
  check('the icon is drawn large enough to read',
    g.rendered.w >= 12 && g.rendered.h >= 12, g.rendered);
  check('and still fits inside its button',
    g.rendered.w <= g.button.w && g.rendered.h <= g.button.h, g);
  // The neighbouring control, so "large enough" is judged against a real icon
  // rather than a number picked out of the air.
  const clip = await p.evaluate(() => {
    const b = document.querySelector('#clip svg').getBoundingClientRect();
    return { w: b.width, h: b.height };
  });
  check('it is at least the paperclip beside it, which it measures lighter than',
    g.rendered.w >= clip.w, { commands: g.rendered, clip });
  checkPageClean(p, 'commands size');
  await p.close();
}

// D. The button is still the button. An icon swap is cosmetic, and the two ways
//    it stops being cosmetic are the accessible name going missing and the
//    click ceasing to open the menu — neither of which any other suite checks.
{
  const p = await page(760);
  const a11y = await p.evaluate(() => {
    const b = document.getElementById('cmds');
    return { title: b.getAttribute('title'), label: b.getAttribute('aria-label') };
  });
  check('the button still names itself for a screen reader',
    a11y.label === 'Commands', a11y);
  check('and its tooltip still says what it opens',
    /command/i.test(a11y.title || ''), a11y);

  await post(p, SLASH_META_MSG);
  await p.waitForTimeout(120);
  await p.evaluate(() => document.getElementById('cmds').click());
  await p.waitForTimeout(220);
  const open = await p.evaluate(() => {
    const pop = document.querySelector('.popover.open[data-trigger="q"]');
    return pop ? pop.querySelectorAll('.popover-row, [role="option"]').length : -1;
  });
  check('clicking it opens the command menu, with rows in it', open > 0, open);

  await p.evaluate(() => document.getElementById('cmds').click());
  await p.waitForTimeout(220);
  const closed = await p.evaluate(() =>
    document.querySelectorAll('.popover.open[data-trigger="q"]').length);
  check('and clicking it again closes the menu', closed === 0, closed);
  checkPageClean(p, 'commands click');
  await p.close();
}

console.log('');
await finish('commands button');
