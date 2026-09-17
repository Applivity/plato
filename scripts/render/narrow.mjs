import { check, page, academyS, finish } from './plib.mjs';

// The Settings page must not overflow at a narrow editor column, action buttons
// must keep their label on one line, and mode cards must stay usable.
for (const w of [300, 340, 420, 720]) {
  for (const mode of ['duo', 'academy']) {
    const p = await page(w, academyS(mode, 2));
    const r = await p.evaluate(() => {
      const sb = document.getElementById('sbody');
      const over = [];
      for (const el of document.querySelectorAll('#sbody *')) {
        if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 2) {
          over.push({ cls: el.className || el.tagName, over: el.scrollWidth - el.clientWidth });
        }
      }
      const btns = [...document.querySelectorAll('.workers .pline .btn, .duo .dhead .btn')];
      const modes = document.querySelector('.modes');
      return {
        panelOverflow: sb.scrollWidth - sb.clientWidth,
        overflowers: over.slice(0, 5),
        btnHeights: btns.map((x) => Math.round(x.getBoundingClientRect().height)),
        modeCols: modes ? getComputedStyle(modes).gridTemplateColumns.split(' ').length : null,
        modeCardW: modes ? Math.round(modes.firstElementChild.getBoundingClientRect().width) : null,
      };
    });
    const tag = 'w=' + w + ' ' + mode;
    check(tag + ': no element overflows', r.panelOverflow <= 2 && r.overflowers.length === 0, r);
    check(tag + ': action buttons stay on one line', r.btnHeights.every((h) => h <= 34), r.btnHeights);
    // No-overflow is not enough: three 67px columns do not overflow, they cram.
    check(tag + ': mode card keeps a usable width', r.modeCardW >= 150, r.modeCardW);
    check(tag + ': mode cards stack when narrow, spread when wide',
      w <= 420 ? r.modeCols === 1 : r.modeCols === 3, r.modeCols);
    await p.close();
  }
}
await finish('narrow layout');
