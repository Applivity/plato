import { check, page, S, PERSONAS, COLOR_IDS, COLOR_HEX, finish, checkPageClean } from './plib.mjs';

/**
 * M3b checkpoint 2a: the team surface on the real DOM.
 *
 * The host and the page are shared with the VS Code extension, so these
 * assertions are the same contract in both hosts:
 *   - the header chip names the active arrangement (Solo / Duo / Academy);
 *   - the Orchestration section carries the unchanged three cards and copy;
 *   - the council team card renders name, kind, model, colour and powers;
 *   - an observer notice carries that philosopher's colour, and the guidance,
 *     pause and cancel lines read as the product says they do.
 *
 * The team-card block is a regression assertion for a shared defect found in
 * this checkpoint: the host wrapped the payload in `text`, the page read it at
 * the top level, and the card had never rendered.
 */

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const council = {
  available: true,
  name: 'Lyceum',
  error: '',
  members: [
    {
      name: 'Aristotle', kind: 'philosopher', model: 'anthropic:claude-sonnet-4-5',
      role: '', persona: 'aristotle', color: 'violet',
      guidance: true, pause: false, cancel: false, maxInterventions: 5,
    },
    {
      name: 'Diogenes', kind: 'philosopher', model: 'anthropic:claude-sonnet-4-5',
      role: '', persona: 'diogenes', color: 'amber',
      guidance: true, pause: false, cancel: false, maxInterventions: 5,
    },
  ],
};

const teamSettings = (mode, duoName = '', academyName = '') => S({
  orchestration: {
    mode,
    personas: PERSONAS,
    colors: COLOR_IDS.map((id, i) => ({ id, hex: COLOR_HEX[i] })),
    roleMaxChars: 1000,
    duo: {
      source: 'default', name: duoName, error: '',
      philosopher: {
        persona: 'aristotle', name: duoName, role: '', model: '', color: 'violet',
        pause: false, cancel: false, maxInterventions: 5,
      },
    },
    academy: { ...council, name: academyName },
  },
});

// A. The header chip names the active arrangement.
{
  for (const [mode, want] of [
    ['solo', '● solo'],
    ['duo', '◐ duo · Aristotle'],
    ['academy', '✧ academy:Lyceum'],
  ]) {
    const p = await page(720, teamSettings(mode, 'Aristotle', 'Lyceum'));
    checkPageClean(p, `chip ${mode}`);
    const chip = await p.evaluate(() => document.getElementById('orchChip').textContent);
    check(`the chip names ${mode}`, chip === want, { chip, want });
    await p.close();
  }
}

// B. The Orchestration section carries the three cards, their copy and their
//    behaviour. Clicking one posts the choice; the host applies it next run.
{
  const p = await page(720, teamSettings('solo'));
  checkPageClean(p, 'orchestration cards');
  const cards = await p.evaluate(() => [...document.querySelectorAll('#sbody .sec-static[data-sec="orchestration"] .mcard')]
    .map((c) => ({
      label: (c.querySelector('.mtitle') || {}).textContent || '',
      desc: (c.querySelector('.mdesc') || {}).textContent || '',
      on: c.classList.contains('on'),
    })));
  check('three team cards render', cards.length === 3, cards);
  check('Solo keeps the shipped copy',
    cards[0] && cards[0].label === 'Solo'
      && cards[0].desc === 'Plato alone. No philosopher watching.', cards);
  check('Duo keeps the shipped copy',
    cards[1] && cards[1].label === 'Duo'
      && cards[1].desc === 'Plato + one philosopher steering the run.', cards);
  check('Academy keeps the shipped copy',
    cards[2] && cards[2].label === 'Academy'
      && cards[2].desc === 'Plato + a council of philosophers.', cards);
  check('the active arrangement is the one marked on',
    cards.filter((c) => c.on).length === 1 && cards[0].on === true, cards);

  const posted = await p.evaluate(() => {
    window.__posted.length = 0;
    document.querySelectorAll('#sbody .sec-static[data-sec="orchestration"] .mcard')[2].click();
    return window.__posted.slice();
  });
  check('choosing Academy posts set-orchestration',
    posted.length === 1 && posted[0].type === 'set-orchestration' && posted[0].mode === 'academy',
    posted);
  await p.close();
}

// C. The council card: the observer strip. Every member is named, tagged with
//    its kind, tied to its model, and states the powers it was granted.
{
  const p = await page(720, teamSettings('academy', '', 'Lyceum'));
  checkPageClean(p, 'council card');
  await post(p, {
    type: 'team',
    name: 'Lyceum',
    members: [
      { name: 'Aristotle', kind: 'philosopher', model: 'anthropic:claude-sonnet-4-5', color: '#b48ad4', tiers: ['guidance'] },
      { name: 'Diogenes', kind: 'philosopher', model: 'anthropic:claude-sonnet-4-5', color: '#d9a441', tiers: ['guidance', 'pause', 'cancel'] },
    ],
  });
  await p.waitForTimeout(200);
  const card = await p.evaluate(() => {
    const c = document.querySelector('.team-card');
    if (!c) return null;
    return {
      name: (c.querySelector('.team-name') || {}).textContent || '',
      rows: [...c.querySelectorAll('.team-member')].map((r) => ({
        name: (r.querySelector('.tm-name') || {}).textContent || '',
        kind: (r.querySelector('.tm-kind') || {}).textContent || '',
        model: (r.querySelector('.tm-model') || {}).textContent || '',
        tiers: [...r.querySelectorAll('.tm-tier')].map((t) => t.textContent),
        dot: !!r.querySelector('.tdot'),
      })),
    };
  });
  check('the council card renders', card !== null, card);
  check('it names the council', card && card.name === 'Team Lyceum', card);
  check('it lists every member',
    card && card.rows.map((r) => r.name).join(',') === 'Aristotle,Diogenes', card);
  check('every member is tagged as an observer',
    card && card.rows.every((r) => r.kind === 'philosopher'
      && r.model === 'anthropic:claude-sonnet-4-5'), card);
  check('every member carries its colour dot',
    card && card.rows.every((r) => r.dot), card);
  check('the powers are stated per member',
    card
      && card.rows[0].tiers.join(',') === 'guidance'
      && card.rows[1].tiers.join(',') === 'guidance,pause,cancel', card);
  await p.close();
}

// D. The observer notices: each philosopher's lines carry its colour and the
//    product's own wording for guidance, pause and cancel.
{
  const p = await page(720, teamSettings('duo', 'Aristotle'));
  checkPageClean(p, 'observer notices');
  for (const [text, hex] of [
    ['[Aristotle] watching — anthropic:claude-sonnet-4-5', '#b48ad4'],
    ['[Aristotle] guidance: Cite the file you read.', '#b48ad4'],
    ['[Aristotle] paused the run', '#b48ad4'],
    ['[Aristotle] cancelled the run', '#b48ad4'],
    ['[Diogenes] guidance: Name the invariant.', '#d9a441'],
  ]) {
    await post(p, { type: 'notice', text, meta: { color: hex } });
  }
  await p.waitForTimeout(250);
  const lines = await p.evaluate(() => [...document.querySelectorAll('#log .msg.philosopher')].map((e) => ({
    text: e.textContent,
    dot: !!e.querySelector('.pdot'),
    accent: e.style.getPropertyValue('--accent'),
    who: (e.querySelector('.who') || {}).textContent || '',
  })));
  check('every observer line renders as a philosopher notice', lines.length === 5, lines);
  check('each carries its colour dot', lines.every((l) => l.dot), lines);
  check('each carries that philosopher\'s accent',
    lines[0].accent === '#b48ad4' && lines[4].accent === '#d9a441', lines);
  check('the names are visible in the line, not a generic speaker label',
    lines.every((l) => l.who === '')
      && lines[1].text.includes('[Aristotle] guidance: Cite the file you read.'), lines);
  check('guidance, pause and cancel read as the product says',
    lines.map((l) => l.text).join('\n').includes('[Aristotle] paused the run')
      && lines.map((l) => l.text).join('\n').includes('[Aristotle] cancelled the run'), lines);
  await p.close();
}

await finish('teams: chip, orchestration cards, council card, observer notices');
