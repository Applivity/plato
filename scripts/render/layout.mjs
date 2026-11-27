import { check, page, finish, checkPageClean, S, TOOL_WORDS_MSG } from './plib.mjs';

/**
 * D49fj: the shape of a message.
 *
 * Three things a person asked for after using the last round: the copy control
 * must not sit over text, the answers need room around them, and each turn
 * should say when it was said — with the whole time on the tooltip, and NO
 * time at all for a record written before times existed.
 */

const core = await import('../../packages/core/dist/src/index.js');

const post = (p, msg) => p.evaluate((x) => window.dispatchEvent(
  new MessageEvent('message', { data: x }),
), msg);

const scene = (p) => p.evaluate(() => {
  const bot = document.querySelector('.msg.bot');
  const you = document.querySelector('.msg.you');
  const time = bot ? bot.querySelector('.msg-time') : null;
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    timeText: time ? time.textContent : null,
    timeTitle: time ? time.title : null,
    timeInRow: time ? time.parentElement.className : null,
    youTime: you && you.querySelector('.msg-time')
      ? you.querySelector('.msg-time').textContent : null,
    lineHeight: bot ? cs(bot).lineHeight : null,
    fontSize: bot ? cs(bot).fontSize : null,
    marginTop: bot ? cs(bot).marginTop : null,
    marginBottom: bot ? cs(bot).marginBottom : null,
    paddingBottom: bot ? cs(bot).paddingBottom : null,
    copyBottom: (() => {
      const btn = bot ? bot.querySelector('.msg-copy') : null;
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const b = bot.getBoundingClientRect();
      return Math.round(b.bottom - r.bottom);
    })(),
  };
});

{
  const p = await page(760, S({ open: false }));
  await post(p, TOOL_WORDS_MSG);
  await post(p, { type: 'restore', hasConnections: true, title: '', log: [
    { k: 'msg', cls: 'you', who: 'You', text: 'Apply it and re-run the tests.', t: Date.UTC(2026, 10, 27, 9, 5) },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Applied. All 46 pricing tests pass.', t: Date.UTC(2026, 10, 27, 9, 6) },
  ] });
  await p.waitForTimeout(300);
  const s = await scene(p);

  check('a replayed turn carries the time the record kept',
    typeof s.timeText === 'string' && s.timeText.length > 0, s);
  check('and the whole time is the tooltip, not the caption',
    typeof s.timeTitle === 'string' && s.timeTitle.length > s.timeText.length, s);
  check('the time sits at the right end of the speaker row',
    s.timeInRow === 'who', s);
  check('the person\'s own turn carries one too',
    typeof s.youTime === 'string' && s.youTime.length > 0, s);

  // Room. The founder's words: "generous on vertical spacing".
  check('a reply has room above it, and more than it had',
    parseFloat(s.marginTop) >= 16, s);
  check('and room below it, which also holds its copy control',
    parseFloat(s.paddingBottom) >= 18 && s.marginBottom !== '0px', s);
  check('the copy control sits at the BOTTOM of the reply',
    s.copyBottom !== null && s.copyBottom <= 6, s);
  check('and the text is set with air between the lines',
    parseFloat(s.lineHeight) >= 20, s);

  checkPageClean(p, 'layout');
  await p.close();
}

// A record written before times existed shows none — not a guess.
{
  const p = await page(760, S({ open: false }));
  await post(p, TOOL_WORDS_MSG);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })), {
    type: 'restore', hasConnections: true, title: '', log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'No time on this one.' },
      { k: 'msg', cls: 'bot', who: 'Plato', text: 'Nor on this.' },
    ],
  });
  await p.waitForTimeout(300);
  const n = await p.evaluate(
    () => document.querySelectorAll('.msg .msg-time').length,
  );
  check('an old record draws no time at all', n === 0, n);
  checkPageClean(p, 'timeless record');
  await p.close();
}

// A live reply is stamped when it finishes, and the stamp survives being drawn
// twice (the stream re-renders its own HTML on every fragment).
{
  const p = await page(760, S({ open: false }));
  await post(p, TOOL_WORDS_MSG);
  await post(p, { type: 'md', text: 'First' });
  await post(p, { type: 'md', text: 'First second' });
  await post(p, { type: 'turn' });
  await p.waitForTimeout(200);
  const one = await p.evaluate(() => document.querySelectorAll('.msg.bot .msg-time').length);
  check('a live reply is stamped once, not once per fragment', one === 1, one);

  const plain = core.renderMarkdown('```\nplain\n```');
  const bar = await p.evaluate((html) => {
    const b = document.createElement('div');
    b.innerHTML = html;
    document.body.appendChild(b);
    const bar = b.querySelector('.md-lang');
    const out = { has: !!bar, h: bar ? bar.getBoundingClientRect().height : 0 };
    b.remove();
    return out;
  }, plain);
  check('a block with no language still draws its bar', bar.has === true && bar.h >= 20, bar);
  checkPageClean(p, 'live stamp');
  await p.close();
}

console.log('');
await finish('layout');
