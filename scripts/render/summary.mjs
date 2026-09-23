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
  '<hr>',
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
    return {
      size: px(cs.fontSize),
      mt: px(cs.marginTop),
      mb: px(cs.marginBottom),
      weight: cs.fontWeight,
    };
  };
  const para = document.querySelector('.msg.bot p');
  const li = document.querySelector('.msg.bot li');
  const head = document.querySelector('.msg.bot .md-h1');
  const hr = document.querySelector('.msg.bot hr');
  const hrCs = hr ? getComputedStyle(hr) : null;
  return {
    text: bot ? bot.textContent : '',
    dashes: bot ? /---/.test(bot.textContent) : true,
    body: bot ? px(getComputedStyle(bot).fontSize) : 0,
    botLine: bot ? px(getComputedStyle(bot).lineHeight) : 0,
    h1: read('.msg.bot .md-h1'),
    h2: read('.msg.bot .md-h2'),
    h3: read('.msg.bot .md-h3'),
    headMt: head ? px(getComputedStyle(head).marginTop) : -1,
    paraLine: para ? px(getComputedStyle(para).lineHeight) : 0,
    liMb: li ? px(getComputedStyle(li).marginBottom) : 0,
    hr: hrCs && {
      present: true,
      topWidth: px(hrCs.borderTopWidth),
      // The default UA rule is an inset groove; a document break is a flat line.
      style: hrCs.borderTopStyle,
      // The PAINTED thickness. The stylesheet is border-box, so this is the
      // border and nothing else — asserting the computed content height instead
      // asserts an implementation detail that a border-box element cannot vary.
      painted: hr.getBoundingClientRect().height,
      mt: px(hrCs.marginTop),
    },
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
  // "More pronounced" is the second read, and it is a different requirement from
  // "bigger than the body": a title 1.1x the prose clears the first bar and is
  // still a label. These pin the DOMINANCE ratios, so the ladder cannot be
  // quietly shrunk back toward the prose.
  check('the top heading dominates the prose (>=1.45x)',
    !!r.h1 && r.h1.size / r.body >= 1.45, r.h1 && { h1: r.h1.size, body: r.body });
  check('the second heading dominates the prose (>=1.3x)',
    !!r.h2 && r.h2.size / r.body >= 1.3, r.h2 && { h2: r.h2.size, body: r.body });
  /**
   * h3 is the WORKHORSE and was the rung with no assertion.
   *
   * A real report used a second-level heading once and a third-level heading for
   * every one of its sections, so the two rungs this suite pinned were used once
   * and three times respectively, and the rung it did not pin carried the whole
   * structure. The
   * fix had landed and the report still read flat. **Assert the rungs the
   * document actually uses** — otherwise the suite measures the ladder instead of
   * the page, which is the same mistake as a cap nobody had a test for.
   */
  check('the workhorse heading (h3) is pronounced, not a label (>=1.25x)',
    !!r.h3 && r.h3.size / r.body >= 1.25, r.h3 && { h3: r.h3.size, body: r.body });
  // All three rungs are bold now, including the workhorse — size alone separates
  // them. Weight is not a ladder here, so the requirement is simply that a
  // heading is never lighter than the prose it introduces.
  check('every heading rung is bold, not merely larger',
    [r.h1, r.h2, r.h3].every((h) => h && parseInt(h.weight, 10) >= 600),
    { h1: r.h1 && r.h1.weight, h2: r.h2 && r.h2.weight, h3: r.h3 && r.h3.weight });

  // Space above must dominate space below, or a heading binds to the text above
  // it rather than to the text it introduces.
  for (const k of ['h1', 'h2', 'h3']) {
    check(`${k} has more space above than below`, r[k] && r[k].mt > r[k].mb, r[k]);
    check(`${k} is not set hard against the text below it`, r[k] && r[k].mb >= 4, r[k]);
  }
  check('paragraphs are spaced apart', r.paraLine >= 18, r.paraLine);
  check('list items are spaced apart', r.liMb >= 3, r.liMb);

  // D49ad: the section rule is a flat 1px line with room around it, not the
  // browser's inset groove, and not a stray run of dashes in the prose.
  check('a thematic break renders as a rule', !!r.hr && r.hr.present, r.hr);
  check('the rule is a flat hairline, not the default groove',
    !!r.hr && r.hr.style === 'solid' && r.hr.topWidth === 1 && r.hr.painted <= 2,
    r.hr);
  check('the rule is not jammed against the text', !!r.hr && r.hr.mt >= 12, r.hr);
  check('no literal dashes are left in the reply', !r.dashes, r.text);
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
