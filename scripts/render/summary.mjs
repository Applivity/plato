import { check, page, finish, checkPageClean } from './plib.mjs';

/**
 * D49ac: a reply is the part the user reads. The founder's complaint was that
 * headings and spacing were "all too jammed up" and the headings "too small" —
 * and the arithmetic backs him up: body text is 13px and the headings were
 * 15/14/13/12.5px, so **an h3 was the same size as the paragraph under it and an
 * h4 was smaller than it.** With .25em below each heading, every section title
 * sat directly on the text it introduced.
 *
 * These assertions are all relative to the BODY size, because that is the thing
 * that was broken: a heading ladder is only a ladder if it climbs clear of the
 * prose, and spacing only reads as a section if the gap above a heading is
 * bigger than the gap below it.
 */

// The classes the core renderer emits — <div class="md-h md-hN">, <p>, <li>.
const BODY = [
  '<div class="md-h md-h1">Summary</div>',
  '<p>I reviewed all three classes against their call sites.</p>',
  '<div class="md-h md-h2">Fixed</div>',
  '<ol>',
  '<li><strong>FormatterUtility.formatFloat</strong> — negative values truncated.</li>',
  '<li><strong>ApiSecurityUtility</strong> — platform default charset in HMAC.</li>',
  '</ol>',
  '<div class="md-h md-h3">Left alone</div>',
  '<ul><li>Local time zone, not UTC.</li></ul>',
].join('');

// A lead-in paragraph first, so no heading is the first child and every heading
// is measured with its full top margin.
const WITH_LEAD = '<p>A correctness review follows.</p>' + BODY;

const show = async (p, html) => {
  await p.evaluate((x) => window.dispatchEvent(
    new MessageEvent('message', { data: x }),
  ), {
    type: 'restore',
    log: [{ k: 'msg', cls: 'bot', who: 'Plato', text: 'summary', html }],
    hasConnections: true,
    title: '',
  });
  await p.waitForTimeout(280);
};

const measure = (p) => p.evaluate(() => {
  const bot = document.querySelector('.msg.bot');
  const px = (v) => parseFloat(v) || 0;
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) { return null; }
    const cs = getComputedStyle(el);
    return { size: px(cs.fontSize), mt: px(cs.marginTop), mb: px(cs.marginBottom) };
  };
  const para = document.querySelector('.msg.bot p');
  const li = document.querySelector('.msg.bot li');
  const head = document.querySelector('.msg.bot .md-h1');
  return {
    body: bot ? px(getComputedStyle(bot).fontSize) : 0,
    botLine: bot ? px(getComputedStyle(bot).lineHeight) : 0,
    h1: read('.msg.bot .md-h1'),
    h2: read('.msg.bot .md-h2'),
    h3: read('.msg.bot .md-h3'),
    headMt: head ? px(getComputedStyle(head).marginTop) : -1,
    paraLine: para ? px(getComputedStyle(para).lineHeight) : 0,
    liMb: li ? px(getComputedStyle(li).marginBottom) : 0,
  };
});

{
  const p = await page(760);
  await show(p, WITH_LEAD);
  const r = await measure(p);

  check('the reply rendered', r.body > 0, r);
  check('the first heading in this fixture is not first-child', r.headMt > 0, r);

  // The defect, as a requirement: every heading must be LARGER than the text it
  // introduces. h3 = body size is exactly what the founder was looking at.
  check('no heading is the same size as body text',
    [r.h1, r.h2, r.h3].every((h) => h && h.size > r.body), r);
  check('the ladder descends, h1 > h2 > h3',
    !!r.h1 && !!r.h2 && !!r.h3 && r.h1.size > r.h2.size && r.h2.size > r.h3.size,
    r);

  // Space above must dominate space below, or a heading binds to the text above
  // it rather than to the text it introduces.
  for (const k of ['h1', 'h2', 'h3']) {
    check(`${k} has more space above than below`, r[k] && r[k].mt > r[k].mb, r[k]);
    check(`${k} is not set hard against the text below it`, r[k] && r[k].mb >= 4, r[k]);
  }
  check('paragraphs are spaced apart', r.paraLine >= 18, r.paraLine);
  check('list items are spaced apart', r.liMb >= 3, r.liMb);
  checkPageClean(p, 'summary readability');
  await p.close();
}

// A reply that OPENS with a heading must not push its own text down — the name
// line above it is already the separation.
{
  const p = await page(760);
  await show(p, BODY);
  const r = await measure(p);
  check('a heading that opens the reply gets no space above it', r.headMt === 0, r.headMt);
  checkPageClean(p, 'leading heading');
  await p.close();
}

console.log('');
await finish('summary readability');
