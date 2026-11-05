import { check, page, html, b, S, finish, checkPageClean } from './plib.mjs';

/**
 * D49cq: the send-to-session panel.
 *
 * Two capabilities are separate and this suite holds them apart:
 *
 *   - `relay` controls SENDING. With it false the button and the panel do not
 *     exist at all.
 *   - RECEIVING is not gated. `relay-in` must draw a message from another
 *     session in every host, because a window that cannot send can still be
 *     sent to — and a hidden message would be a run the user never saw start.
 *
 * The assertions also hold the rule the design turns on: the row's outcome
 * comes from the HOST (relay-result), never from the page guessing that a
 * message went out because a button was clicked.
 */

const snap = (p) => p.evaluate(() => {
  const row = document.getElementById('relayRow');
  const fromRows = [...document.querySelectorAll('#log .msg')]
    .filter((d) => (d.querySelector('.who') || {}).textContent
      && String(d.querySelector('.who').textContent).startsWith('From'));
  return {
    hidden: row.hidden,
    button: !document.getElementById('relayBtn').hidden,
    peers: [...document.querySelectorAll('.relay-peer')].map((r) => ({
      id: r.dataset.peer,
      name: (r.querySelector('.rp-name') || {}).textContent,
      host: (r.querySelector('.rp-host') || {}).textContent,
      state: (r.querySelector('.rp-busy') || {}).textContent,
      pressed: r.getAttribute('aria-pressed'),
    })),
    empty: !!row.querySelector('.relay-empty'),
    posted: window.__posted.slice(),
    msgs: [...document.querySelectorAll('#log .msg')].map((d) => ({
      cls: d.className,
      who: (d.querySelector('.who') || {}).textContent,
      text: d.textContent,
      tag: (d.querySelector('.relay-tag') || {}).textContent,
      state: (d.querySelector('.relay-state') || {}).textContent,
    })),
    fromRows: fromRows.length,
    pause: !document.getElementById('pp').hidden,
    cancel: !document.getElementById('cx').hidden,
    textarea: document.getElementById('relayText').value,
  };
});

const PEERS = [
  { id: 'aaa111', name: 'Fix the parser', host: 'vscode', busy: false, summary: 'edit · Fix the parser' },
  { id: 'bbb222', name: 'Run the tests', host: 'vs', busy: true, summary: 'auto, busy · Run the tests' },
  { id: 'ccc333', name: 'build', host: 'cli', busy: false, summary: 'Terminal session' },
];

const outgoing = (s) => s.msgs.filter((m) => m.who && m.who.startsWith('You →')).pop();

// A. The control exists only where the host says it can send.
{
  const p = await page(620, S());
  const closed = await snap(p);
  check('the session control is offered in a capable host', closed.button === true, closed);
  check('and the panel is closed until it is asked for', closed.hidden === true, closed);
  await p.evaluate(() => document.getElementById('relayBtn').click());
  await p.waitForTimeout(120);
  const open = await snap(p);
  check('clicking it opens the panel', open.hidden === false, open);
  check('opening asks the host for a fresh peer list',
    open.posted.some((m) => m.type === 'peers-refresh'), open.posted);
  checkPageClean(p, 'open');
  await p.close();
}

// B. The list says who, which host, and whether they are busy.
{
  const p = await page(620, S());
  await p.evaluate(() => document.getElementById('relayBtn').click());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'peers', peers: PEERS });
  await p.waitForTimeout(150);
  const s = await snap(p);
  check('every live peer is listed', s.peers.length === 3, s.peers);
  check('each row names the peer',
    JSON.stringify(s.peers.map((x) => x.name)) === JSON.stringify(['Fix the parser', 'Run the tests', 'build']), s.peers);
  check('and names its host in words, not wire values',
    JSON.stringify(s.peers.map((x) => x.host)) === JSON.stringify(['VS Code', 'Visual Studio', 'Terminal']), s.peers);
  check('a busy peer reads "running" and an idle one "idle"',
    JSON.stringify(s.peers.map((x) => x.state)) === JSON.stringify(['idle', 'running', 'idle']), s.peers);
  checkPageClean(p, 'listed');
  await p.close();
}

// C. An empty registry says so, rather than drawing an empty box.
{
  const p = await page(620, S());
  await p.evaluate(() => document.getElementById('relayBtn').click());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'peers', peers: [] });
  await p.waitForTimeout(150);
  const s = await snap(p);
  check('with no peers the panel says so', s.empty === true, s);
  checkPageClean(p, 'empty');
  await p.close();
}

// D. A send posts the target it was told to use, and the page does not claim it
//    arrived. The row exists; its outcome waits for the host.
{
  const p = await page(620, S());
  await p.evaluate(() => document.getElementById('relayBtn').click());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'peers', peers: PEERS });
  await p.waitForTimeout(120);
  await p.evaluate(() => document.querySelectorAll('.relay-peer')[1].click());
  await p.evaluate(() => {
    document.getElementById('relayText').value = 'which test failed?';
  });
  await p.evaluate(() => document.getElementById('relaySend').click());
  await p.waitForTimeout(120);
  const s = await snap(p);
  const sent = s.posted.filter((m) => m.type === 'relay-out').pop();
  check('Send posts the chosen peer, the text, and an id',
    sent && sent.to === 'bbb222' && sent.text === 'which test failed?' && typeof sent.id === 'string' && sent.id.length > 0,
    sent);
  const row = outgoing(s);
  check('the message is drawn as the user\'s own, addressed to the peer',
    row && row.who === 'You → Run the tests' && row.text.includes('which test failed?'), row);
  check('and it says nothing about delivery yet', row !== undefined && !row.state, row);
  check('the box is cleared for the next message', s.textarea === '', s);
  checkPageClean(p, 'send');
  await p.close();
}

// E. The host's answer is what the row reports — sent, queued, refused.
{
  const p = await page(620, S());
  await p.evaluate(() => document.getElementById('relayBtn').click());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'peers', peers: PEERS });
  await p.waitForTimeout(120);
  const send = async (peerIndex, text, result) => {
    await p.evaluate((i) => document.querySelectorAll('.relay-peer')[i].click(), peerIndex);
    await p.evaluate((t) => { document.getElementById('relayText').value = t; }, text);
    await p.evaluate(() => document.getElementById('relaySend').click());
    const id = (await snap(p)).posted.filter((m) => m.type === 'relay-out').pop().id;
    await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
      { type: 'relay-result', text: { id, ...result } });
    await p.waitForTimeout(80);
    return outgoing(await snap(p));
  };
  const ok = await send(0, 'first', { ok: true, status: 'accepted', to: 'Fix the parser' });
  check('an accepted message says it was sent', ok.state === 'sent to Fix the parser', ok);
  const q = await send(1, 'second', { ok: true, status: 'queued', to: 'Run the tests' });
  check('a queued message says it waits for the run',
    q.state.includes('queued') && q.state.includes('current run'), q);
  const bad = await send(2, 'third', { ok: false, reason: 'unknown' });
  check('a refused message names what happened, in the user\'s terms',
    bad.state === 'not sent — that session is no longer running', bad);
  checkPageClean(p, 'outcome');
  await p.close();
}

// F. An incoming message renders as somebody else's words, and when it starts
//    a run the run UI follows the host's `started` flag.
{
  const p = await page(620, S());
  const before = await snap(p);
  check('a fresh page has no run controls', before.pause === false && before.cancel === false, before);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'relay-in', text: 'the parser test is red', name: 'Run the tests', host: 'vs', started: true, queued: false });
  await p.waitForTimeout(120);
  const s = await snap(p);
  const row = s.msgs.find((m) => m.who && m.who.startsWith('From'));
  check('a received message names its sender', row && row.who === 'From Run the tests', row);
  check('and names the host it came from', row && row.tag === 'Visual Studio', row);
  check('it is NOT drawn as this user\'s own message', row && row.cls.includes('in') && !row.cls.includes('you'), row);
  check('starting a run turns on Pause and Cancel', s.pause === true && s.cancel === true, s);
  // A queued arrival is shown as waiting, and does not fake a run start.
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'relay-in', text: 'and the lint too', name: 'build', host: 'cli', started: false, queued: true });
  await p.waitForTimeout(80);
  const q = await snap(p);
  const qrow = q.msgs.filter((m) => m.who && m.who.startsWith('From')).pop();
  check('a queued arrival says it waits behind the run',
    qrow.state === 'queued behind the current run', qrow);
  check('and a row the page already drew is not drawn twice', q.fromRows === 2, q);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'relay-in', text: 'and the lint too', name: 'build', host: 'cli', started: true, queued: false, row: false });
  await p.waitForTimeout(80);
  const r = await snap(p);
  check('a queued message that starts its run adds no second row', r.fromRows === 2, r);
  checkPageClean(p, 'incoming');
  await p.close();
}

// G. A host that cannot send still receives: relay:false hides the control and
//    nothing else.
{
  const NO_RELAY = html().replace('data-plato-relay="true"', 'data-plato-relay="false"');
  const p = await b.newPage({ viewport: { width: 620, height: 1700 } });
  p.__errors = [];
  p.on('pageerror', (e) => { p.__errors.push(String(e.message)); });
  p.on('console', (m) => { if (m.type() === 'error') { p.__errors.push(m.text()); } });
  await p.route('**/*', (r) => (r.request().url().endsWith('/plato.html')
    ? r.fulfill({ contentType: 'text/html', body: NO_RELAY }) : r.abort()));
  await p.addInitScript(() => {
    window.__posted = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__posted.push(m); } });
  });
  await p.goto('http://localhost/plato.html');
  await p.waitForFunction(() => !!document.getElementById('gear'));
  const s = await snap(p);
  check('a host that cannot send has no session control', s.button === false, s);
  check('and no send panel', s.hidden === true, s);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    { type: 'relay-in', text: 'please check the build', name: 'Fix the parser', host: 'vscode', started: true, queued: false });
  await p.waitForTimeout(120);
  const t = await snap(p);
  const row = t.msgs.find((m) => m.who && m.who.startsWith('From'));
  check('an arriving message still renders where sending is unavailable',
    row && row.who === 'From Fix the parser' && row.text.includes('please check the build'), row);
  check('and its run still shows the controls', t.pause === true && t.cancel === true, t);
  check('no session message is posted by the page',
    t.posted.every((m) => m.type !== 'relay-out' && m.type !== 'peers-refresh'), t.posted);
  checkPageClean(p, 'no-relay');
  await p.close();
}

await finish('relay');
