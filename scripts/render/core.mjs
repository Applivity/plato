import { check, page, academyS, finish } from './plib.mjs';

// A. The Role box must not clip, at realistic widths, and keep ~1 line slack.
for (const w of [300, 340, 420, 520, 740, 940]) {
  const p = await page(w, academyS('academy', 2));
  const r = await p.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('.mrow textarea.rolearea')) {
      const cs = getComputedStyle(t);
      const lh = parseFloat(cs.lineHeight);
      const padT = parseFloat(cs.paddingTop);
      const padB = parseFloat(cs.paddingBottom);
      const m = document.createElement('div');
      m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-break:break-word;'
        + 'font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight
        + ';letter-spacing:' + cs.letterSpacing + ';line-height:' + cs.lineHeight + ';width:' + t.clientWidth + 'px;';
      m.textContent = t.value;
      document.body.appendChild(m);
      const textH = m.getBoundingClientRect().height;
      m.remove();
      const innerH = t.clientHeight - padT - padB;
      out.push({
        clipped: t.scrollHeight > t.clientHeight + 1,
        slackLines: +((innerH - textH) / lh).toFixed(2),
        maxlen: t.getAttribute('maxlength'),
      });
    }
    return out;
  });
  check('w=' + w + ' role box does not clip', r.every((x) => !x.clipped), r);
  check('w=' + w + ' role box keeps ~1 line slack', r.every((x) => x.slackLines >= 0.85 && x.slackLines <= 1.6), r);
  check('w=' + w + ' role box is capped at 1000', r.every((x) => x.maxlen === '1000'), r);
  await p.close();
}

// B. The wall matrix (Option B: drawn always, disabled at the floor).
const expect = { 2: [2, 2, false], 3: [3, 0, false], 4: [4, 0, false], 5: [5, 0, true] };
for (const n of [2, 3, 4, 5]) {
  const p = await page(620, academyS('academy', n));
  const r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('.mrow .btn-danger')];
    const add = [...document.querySelectorAll('.listfoot .btn')].find((x) => /Add philosopher/.test(x.textContent));
    const first = btns[0];
    const cs = first ? getComputedStyle(first) : null;
    return {
      drawn: btns.length,
      off: btns.filter((x) => x.classList.contains('is-off')).length,
      glyph: first ? first.textContent : null,
      bg: cs ? cs.backgroundColor : null,
      addDisabled: add ? add.disabled : null,
      footer: (document.querySelector('.listfoot .lcount') || {}).textContent,
    };
  });
  const e = expect[n];
  check('n=' + n + ' X drawn on every card', r.drawn === e[0], r);
  check('n=' + n + ' X disabled count', r.off === e[1], r);
  check('n=' + n + ' Add disabled state', r.addDisabled === e[2], r);
  check('n=' + n + ' glyph is X and transparent', r.glyph === '\u2715' && r.bg === 'rgba(0, 0, 0, 0)', r);
  check('n=' + n + ' footer states the range', r.footer === n + ' of 5 philosophers \u00b7 minimum 2', r.footer);
  await p.close();
}

// C. A stored colour must not shift when a philosopher is removed.
{
  const p = await page(620, academyS('academy', 3));
  const before = await p.evaluate(() => [...document.querySelectorAll('.mrow')].map((c) => c.style.getPropertyValue('--accent')));
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), academyS('academy', 2));
  await p.waitForTimeout(320);
  const after = await p.evaluate(() => [...document.querySelectorAll('.mrow')].map((c) => c.style.getPropertyValue('--accent')));
  check('colours do not shift when a member is removed', before[0] === after[0] && before.length === 3 && after.length === 2, { before, after });
  check('the 3 palette colours are distinct', new Set(before).size === before.length, before);
  await p.close();
}

await finish('role box + walls + colours');
