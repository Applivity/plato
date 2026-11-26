import { check, page, finish, checkPageClean, S } from './plib.mjs';

/**
 * The founder's report: a real user lost his own messages in the thread,
 * because his turn and Plato's were drawn identically but for the colour of a
 * 2px hairline. Measured before the change, at 760px: both rows 732px wide,
 * transparent, square, 10px apart.
 *
 * The approved fix is a filled, right-shifted bubble for the person's turn that
 * keeps its accent bar. This suite is the witness, and every assertion below is
 * about what a person SEES — computed colour, edges, width, gaps — not about
 * which CSS rule exists.
 */

const replay = async (p, log) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), { type: 'restore', log, hasConnections: true, title: '' });
  await p.waitForTimeout(260);
};

const rows = (p) => p.evaluate(() => {
  const log = document.getElementById('log');
  const lr = log.getBoundingClientRect();
  const cs = getComputedStyle(log);
  const padL = parseFloat(cs.paddingLeft);
  const padR = parseFloat(cs.paddingRight);
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      width: r.width, height: r.height,
      background: s.backgroundColor,
      borderLeft: s.borderLeftWidth,
      borderLeftColor: s.borderLeftColor,
      radius: s.borderTopLeftRadius,
    };
  };
  return {
    log: {
      left: lr.left, right: lr.right, top: lr.top, bottom: lr.bottom,
      contentLeft: lr.left + padL,
      contentRight: lr.right - padR,
    },
    you: pick('.msg.you'),
    bot: pick('.msg.bot'),
    inbound: pick('.msg.in'),
  };
});

const transparent = (bg) =>
  bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || /,\s*0\)$/.test(bg);

{
  const p = await page(760, S({ open: false }));
  await replay(p, [
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Here is what I found in the run record.' },
    { k: 'msg', cls: 'you', who: 'You', text: 'Then use the pricing module instead.' },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Understood — I will check pricing first.' },
    { k: 'msg', cls: 'in', who: 'Agent', text: 'A relayed note from another session.' },
  ]);
  const r = await rows(p);
  check('the scene drew all four rows', Boolean(r.you && r.bot && r.inbound), r);

  check('the person\'s row is FILLED, and Plato\'s row is not',
    !transparent(r.you.background) && transparent(r.bot.background),
    { you: r.you.background, bot: r.bot.background });

  check('the person\'s bubble is shifted right by at least 40px',
    r.you.left - r.bot.left >= 40,
    { you: r.you.left, bot: r.bot.left, delta: r.you.left - r.bot.left });

  check('and the two rows end at the same right edge, within 2px',
    Math.abs(r.you.right - r.bot.right) <= 2,
    { you: r.you.right, bot: r.bot.right });

  const contentWidth = r.log.contentRight - r.log.contentLeft;
  check('the bubble keeps at least 85% of the log\'s content width',
    r.you.width >= contentWidth * 0.85,
    { width: r.you.width, contentWidth, pct: r.you.width / contentWidth });

  const botToYou = r.you.top - r.bot.bottom;
  check('there is room above the person\'s turn — 18px or more',
    botToYou >= 18, { gap: botToYou });

  // The next row after the person's is Plato's answer, so the AFTER gap is
  // measured from the person's row to the following bot row.
  const next = await p.evaluate(() => {
    const all = [...document.querySelectorAll('#log .msg')];
    const i = all.findIndex((e) => e.classList.contains('you'));
    const n = all[i + 1];
    if (!n) return null;
    const a = all[i].getBoundingClientRect();
    const b = n.getBoundingClientRect();
    return { gap: b.top - a.bottom, cls: n.className };
  });
  check('and the answer follows closely — 14px or less',
    next !== null && next.gap <= 14, next);

  check('the accent bar survives the fill: 2px on the left edge',
    r.you.borderLeft === '2px', { border: r.you.borderLeft, color: r.you.borderLeftColor });
  check('and the bubble is rounded by 8px',
    r.you.radius === '8px', { radius: r.you.radius });

  check('a relayed message is NOT painted like the person\'s own words',
    transparent(r.inbound.background), { in: r.inbound.background });

  checkPageClean(p, 'readability');
  await p.close();
}

await finish('readability');
