import { check, page, html, b, S, finish, checkPageClean } from './plib.mjs';

/**
 * D49cq: a message that arrives from another Plato session.
 *
 * There is no send control any more — a person asks the model, and the model's
 * send shows in the chat like any other tool call (the founder's call). What
 * remains here is the INBOUND half, and it must work in every host: a message
 * from another session names its sender and host, is never drawn as this user's
 * own words, and — when the host says it started a run — turns on the run UI.
 * It must also work where `relay` is false, because a window that cannot send
 * can still be sent to.
 */

const snap = (p) => p.evaluate(() => {
  const fromRows = [...document.querySelectorAll('#log .msg')]
    .filter((d) => {
      const who = (d.querySelector('.who') || {}).textContent;
      return who && String(who).startsWith('From');
    });
  return {
    sendButton: !!document.getElementById('relayBtn'),
    sendPanel: !!document.getElementById('relayRow'),
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
  };
});

const incoming = (over) => ({
  type: 'relay-in',
  text: 'the parser test is red',
  name: 'Fix the parser',
  host: 'vscode',
  started: false,
  queued: false,
  ...over,
});

// A. The send control is gone; the chat composer is unchanged.
{
  const p = await page(620, S());
  const s = await snap(p);
  check('the dedicated send control is gone', s.sendButton === false, s);
  check('and its panel with it', s.sendPanel === false, s);
  check('the chat composer still has its send button',
    await p.evaluate(() => !!document.getElementById('go')), null);
  checkPageClean(p, 'gone');
  await p.close();
}

// B. An arriving message names its sender and host, and is not the user.
{
  const p = await page(620, S());
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    incoming({ started: true }));
  await p.waitForTimeout(120);
  const s = await snap(p);
  const row = s.msgs.find((m) => m.who && m.who.startsWith('From'));
  check('a received message names its sender', row && row.who === 'From Fix the parser', row);
  check('and names the host it came from', row && row.tag === 'VS Code', row);
  check('it is NOT drawn as this user\'s own message', row && row.cls.includes('in') && !row.cls.includes('you'), row);
  check('starting a run turns on Pause and Cancel', s.pause === true && s.cancel === true, s);
  checkPageClean(p, 'incoming');
  await p.close();
}

// C. A queued arrival says it waits, and the later start adds no second row.
{
  const p = await page(620, S());
  const before = await snap(p);
  check('a fresh page has no run controls', before.pause === false && before.cancel === false, before);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    incoming({ queued: true }));
  await p.waitForTimeout(80);
  const q = await snap(p);
  const row = q.msgs.filter((m) => m.who && m.who.startsWith('From')).pop();
  check('a queued arrival says it waits behind the run',
    row.state === 'queued behind the current run', row);
  check('and it does not fake a run start', q.pause === false && q.cancel === false, q);
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    incoming({ started: true, row: false }));
  await p.waitForTimeout(80);
  const r = await snap(p);
  check('the queued message that now runs adds no second row', r.fromRows === 1, r);
  check('and the run UI turns on', r.pause === true && r.cancel === true, r);
  checkPageClean(p, 'queued');
  await p.close();
}

// D. A host that cannot send still receives.
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
  await p.evaluate((x) => window.dispatchEvent(new MessageEvent('message', { data: x })),
    incoming({ started: true, text: 'please check the build', name: 'Run the tests', host: 'vs' }));
  await p.waitForTimeout(120);
  const s = await snap(p);
  const row = s.msgs.find((m) => m.who && m.who.startsWith('From'));
  check('an arriving message still renders where sending is unavailable',
    row && row.who === 'From Run the tests' && row.text.includes('please check the build'), row);
  check('with the sender\'s host', row && row.tag === 'Visual Studio', row);
  check('and its run still shows the controls', s.pause === true && s.cancel === true, s);
  checkPageClean(p, 'no-relay');
  await p.close();
}

await finish('relay');
