import { check, page, openAll, finish } from './plib.mjs';

const CONNS = [{ id: 'openrouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', models: ['a/b'], all: ['a/b'], keyStatus: 'missing', builtin: false }];
const S = {
  type: 'settings', open: true, modelItems: [], presets: [], connections: CONNS,
  defaultModel: '', workers: { noRoot: false, plato: 'global', agentsFile: null },
  orchestration: { mode: 'duo', personas: [{ id: 'aristotle', name: 'Aristotle', epithet: 'e', role: 'R' }], colors: [{ id: 'violet', hex: '#b48ad4' }], roleMaxChars: 1000, duo: {}, academy: { available: false, name: '', members: [], error: '' } },
  compaction: { mode: 'auto', threshold: 0.8 },
};

for (const w of [300, 340, 420, 720]) {
  const p = await page(w, S);
  // Open every section so content that is collapsed by default is measurable.
  await openAll(p);

  const r = await p.evaluate(() => {
    const secs = [...document.querySelectorAll('#sbody > .wrap > .sec')];
    const shape = secs.map((s) => {
      const cs = getComputedStyle(s);
      const head = s.querySelector('summary, .sechead');
      const hs = head ? getComputedStyle(head) : null;
      const mk = head ? getComputedStyle(head, '::before') : null;
      return {
        isDetails: s.tagName === 'DETAILS',
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        radius: cs.borderTopLeftRadius,
        title: head ? head.textContent.trim().split('  ')[0] : null,
        headH: head ? Math.round(head.getBoundingClientRect().height) : null,
        headPad: hs ? hs.paddingTop : null,
        markerSize: mk ? parseFloat(mk.fontSize) : null,
        markerW: mk ? mk.width : null,
      };
    });
    // Every section must report the SAME frame, or the page has two looks.
    const borders = new Set(shape.map((s) => s.border));
    const radii = new Set(shape.map((s) => s.radius));
    // Buttons in a connection row.
    const crow = document.querySelector('.conn .crow');
    const kids = crow ? [...crow.children] : [];
    const setKey = kids.find((x) => /Set key/.test(x.textContent));
    const refresh = kids.find((x) => /Refresh/.test(x.textContent));
    const del = kids.find((x) => /Delete/.test(x.textContent));
    const gapRefreshToDelete = (refresh && del) ? Math.round(del.getBoundingClientRect().left - refresh.getBoundingClientRect().right) : null;
    const sameRow = (refresh && del) ? Math.abs(Math.round(del.getBoundingClientRect().top - refresh.getBoundingClientRect().top)) < 4 : false;
    const hasDivider = kids.some((x) => x.classList && x.classList.contains('crow-sep'));
    const hasFill = kids.some((x) => x.classList && x.classList.contains('crow-fill'));
    // Add-provider inputs must not be clipped.
    const clipped = [...document.querySelectorAll('.add-card input, .add-card select')]
      .filter((x) => x.getBoundingClientRect().width < 80).map((x) => Math.round(x.getBoundingClientRect().width));
    const sb = document.getElementById('sbody');
    return {
      shape, uniqueBorders: [...borders], uniqueRadii: [...radii],
      sectionCount: shape.length,
      gapRefreshToDelete, sameRow, hasDivider, hasFill,
      clippedInputs: clipped,
      panelOverflow: sb.scrollWidth - sb.clientWidth,
    };
  });

  const uniform = r.uniqueBorders.length === 1 && r.uniqueRadii.length === 1;
  const markers = r.shape.every((s) => s.markerSize >= 16 && s.markerW === '16px');
  const heads = r.shape.every((s) => s.headH >= 32);
  const named = r.shape.every((s) => !!s.title);
  // Delete is separated from Refresh by a rule and a flexible gap. In a very
  // narrow panel it legitimately WRAPS to its own line, which is separated by
  // definition — so require either a wide gap on one row, or a wrapped row.
  const separated = r.hasDivider && r.hasFill
    && (r.sameRow ? r.gapRefreshToDelete >= 14 : true);
  const noClip = r.clippedInputs.length === 0;

  check('w=' + w + ' sections share ONE frame', uniform, { b: r.uniqueBorders, r: r.uniqueRadii });
  check('w=' + w + ' marker is a real control (>=16px, 16px box)', markers, r.shape.map((s) => [s.markerSize, s.markerW]));
  check('w=' + w + ' header bar is tall enough (>=32px)', heads, r.shape.map((s) => s.headH));
  check('w=' + w + ' every section is named in its header', named, r.shape.map((s) => s.title));
  check('w=' + w + ' Delete separated from Refresh (divider + fill)', separated, { d: r.gapRefreshToDelete, div: r.hasDivider, fill: r.hasFill });
  check('w=' + w + ' add-provider inputs not clipped', noClip, r.clippedInputs);
  check('w=' + w + ' no panel overflow', r.panelOverflow <= 2, r.panelOverflow);
  await p.close();
}
await finish('unified panels');
