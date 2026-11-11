/**
 * 0.28.6 window check — the checks the founder asked for, in a real window.
 *
 * Run it with `node scripts/field/verify-0286.mjs`. It assumes that launcher:
 * a packaged 0.28.6, a throwaway workspace and Plato home, and a scripted model.
 *
 * What it measures, each reported with its numbers:
 *   - History draws both tabs and opens on Chats;
 *   - a search finds a word in an old chat, and a word that remains only in a
 *     run record finds the run;
 *   - deleting a saved chat removes it;
 *   - deleting the CURRENT chat lands on a fresh empty chat, and the
 *     conversation is not left in History;
 *   - Delete all on Chats empties History and lands on the fresh chat;
 *   - an image picked from outside the workspace shows a chip with its base
 *     name, and the provider request carries the image;
 *   - at a short window height the list scrolls and the header does not move.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { By, Key } from 'selenium-webdriver';
import {
  VSBrowser,
  WebView,
  Workbench,
  Notification,
} from 'vscode-extension-tester';

import { Field } from './driver.mjs';

const STUB = process.env['PLATO_VERIFY_STUB'];
const IMG = process.env['PLATO_VERIFY_IMG'];
const RUNS_DIR = process.env['PLATO_VERIFY_RUNS_DIR'];
const SHOTS = process.env['PLATO_VERIFY_SHOTS'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(m);

async function setScript(steps) {
  const res = await fetch(`${STUB}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, titleMode: 'prompt' }),
  });
  if (!res.ok) throw new Error(`stub refused the script: ${res.status}`);
}

async function stubLog() {
  return (await fetch(`${STUB}/__log`)).json();
}

/** Sets the API key through the product's own command (the stub ignores it). */
async function setApiKey(driver) {
  await new Workbench().executeCommand('Plato: Set API Key');
  await driver.sleep(800);
  const picks = await driver.findElements(By.css('.quick-input-list .monaco-list-row'));
  if (picks.length > 0) {
    const box = await driver.findElement(By.css('.quick-input-box input'));
    await box.sendKeys('stub');
    await driver.sleep(400);
    await box.sendKeys(Key.ENTER);
    await driver.sleep(600);
  }
  const deadline = Date.now() + 20000;
  let input = null;
  while (input === null && Date.now() < deadline) {
    for (const box of await driver.findElements(By.css('.quick-input-box input'))) {
      if (await box.isDisplayed().catch(() => false)) { input = box; break; }
    }
    if (input === null) await driver.sleep(200);
  }
  if (input === null) throw new Error('the API key prompt never appeared');
  await input.sendKeys('sk-stub-not-a-real-key');
  await input.sendKeys(Key.ENTER);
  await driver.sleep(600);
}

describe('0.28.6 real-window check — History, outside image, short window', function () {
  this.timeout(900000);
  let driver;
  let field;

  /** Reads a value from inside the chat webview frame. */
  const read = (script) => field.driver.executeScript(script);

  async function waitInPage(script, label, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await read(script).catch(() => undefined);
      if (last === true) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
  }

  async function openHistory() {
    await field.switchToChatFrame();
    await read(`const h = document.getElementById('hist'); if (h) h.click();`);
    await waitInPage(
      `return document.body.classList.contains('show-history')
        && !!document.querySelector('#hibody');`,
      'the History page',
    );
  }

  async function chatsShown() {
    return await read(`
      return {
        open: document.body.classList.contains('show-history'),
        rows: [...document.querySelectorAll('#hibody .runitem')].map((i) => ({
          title: (i.querySelector('.rt') || {}).textContent || '',
          current: i.classList.contains('current'),
          del: !!i.querySelector('.rdel'),
        })),
        deleteAll: !!document.querySelector('#hibody .runhead .btn-danger'),
        notes: [...document.querySelectorAll('#hibody .note')].map((n) => n.textContent),
      };
    `);
  }

  async function setQuery(q) {
    await field.switchToChatFrame();
    const box = await field.driver.findElement(By.id('hq'));
    await box.clear();
    await box.sendKeys(q, Key.ENTER);
    await waitInPage(
      `return document.querySelectorAll('#hibody .hresult').length > 0
        || (document.querySelector('#hibody .note') || {}).textContent?.includes('No matches');`,
      `search results for "${q}"`,
    );
  }

  async function clearQuery() {
    await read(`
      const q = document.getElementById('hq');
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(400);
  }

  async function searchKinds() {
    return await read(`
      return [...document.querySelectorAll('#hibody .hresult')].map((r) => ({
        kind: (r.querySelector('.hkind') || {}).textContent || '',
        title: (r.querySelector('.hcase') || {}).textContent || '',
      }));
    `);
  }

  async function rowWith(text) {
    const rows = await field.driver.findElements(By.css('#hibody .runitem'));
    for (const row of rows) {
      const t = await row.getText().catch(() => '');
      if (t.includes(text)) return row;
    }
    return null;
  }

  async function fireDelete(button) {
    await button.click();
    await sleep(200);
    await button.click();
  }

  before(async () => {
    driver = VSBrowser.instance.driver;
    await new Workbench().executeCommand('Plato: Open Chat');
    await driver.sleep(3000);
    await setApiKey(driver);
    try {
      await new Notification().dismissAll();
    } catch {
      /* no toast helper */
    }
    await driver.sleep(500);
    field = new Field(driver, new WebView(), { runsDir: RUNS_DIR, shotsDir: SHOTS });
    await field.enter();
  });

  it('History, image and layout in a real window', async () => {
    // One clean surface, then three conversations: A and B are archived by
    // opening the next chat; C stays live.
    await field.newChat();
    const run = async (prompt, reply, tag) => {
      await setScript([{ text: reply }]);
      const marker = await field.send(prompt);
      const events = await field.waitRunEnd(marker, { tag, timeoutMs: 120000 });
      const failed = events.find((e) => e.type === 'run-failed');
      assert.equal(failed, undefined, `${tag} failed: ${JSON.stringify(failed)}`);
    };

    await run('oldchat appleword — what is this?', 'oldchat reply about appleword.', 'A');
    await field.newChat();
    await driver.sleep(1200);
    await run('savedchat bananaword — what is this?', 'savedchat reply about bananaword.', 'B');
    await field.newChat();
    await driver.sleep(1200);
    await run('livechat cherryword — what is this?', 'livechat reply about cherryword.', 'C');

    /* ---- History: both tabs, on Chats ---------------------------------- */
    await openHistory();
    const tabs = await read(`
      return {
        chats: !!document.getElementById('htab-chats'),
        runs: !!document.getElementById('htab-runs'),
        active: (document.querySelector('.htab.on') || {}).textContent || '',
      };
    `);
    if (!(tabs.chats && tabs.runs && tabs.active === 'Chats')) {
      throw new Error(`History tabs are wrong: ${JSON.stringify(tabs)}`);
    }
    say(`OK   both tabs are drawn, opening on Chats  ${JSON.stringify(tabs)}`);

    const list = await chatsShown();
    if (!(list.rows.some((r) => r.title.includes('appleword'))
      && list.rows.some((r) => r.title.includes('bananaword'))
      && list.rows.some((r) => r.title.includes('cherryword') && r.current))) {
      throw new Error(`History does not list the three conversations: ${JSON.stringify(list.rows)}`);
    }
    say(`OK   History lists two saved chats and the live one  rows=${list.rows.length}`);

    /* ---- Search an old chat ------------------------------------------- */
    await setQuery('appleword');
    const chatHits = await searchKinds();
    const oldHit = chatHits.find((h) => h.kind === 'Chat' && h.title.includes('appleword'));
    if (!oldHit) throw new Error(`no chat hit for the old chat: ${JSON.stringify(chatHits)}`);
    say(`OK   an old chat is found by a word in it  ${JSON.stringify(oldHit)}`);
    await clearQuery();

    /* ---- Delete a saved chat ------------------------------------------ */
    await field.switchToChatFrame();
    const savedRow = await rowWith('bananaword');
    if (savedRow === null) throw new Error('the saved chat to delete is not listed');
    await fireDelete(await savedRow.findElement(By.css('.rdel')));
    const goneDeadline = Date.now() + 15000;
    let remaining = null;
    while (Date.now() < goneDeadline) {
      remaining = await chatsShown();
      if (!remaining.rows.some((r) => r.title.includes('bananaword'))) break;
      await sleep(300);
    }
    if (remaining.rows.some((r) => r.title.includes('bananaword'))) {
      throw new Error('the saved chat is still listed after its delete');
    }
    say(`OK   a saved chat is deleted  rows=${remaining.rows.length}`);

    /* ---- A run match (that conversation is gone, its run remains) ----- */
    await setQuery('bananaword');
    const runHits = await searchKinds();
    const runHit = runHits.find((h) => h.kind === 'Run');
    if (!runHit) throw new Error(`no run hit: ${JSON.stringify(runHits)}`);
    if (runHits.some((h) => h.kind === 'Chat')) {
      throw new Error(`the deleted chat still answers: ${JSON.stringify(runHits)}`);
    }
    say(`OK   a run record is found by a word in it  ${JSON.stringify(runHit)}`);
    await clearQuery();

    /* ---- Delete the current chat -------------------------------------- */
    await field.switchToChatFrame();
    const liveRow = await rowWith('cherryword');
    if (liveRow === null) throw new Error('the live chat is not listed');
    if (!(await liveRow.getAttribute('class')).includes('current')) {
      throw new Error('the row found for the live chat is not marked current');
    }
    await fireDelete(await liveRow.findElement(By.css('.rdel')));
    await waitInPage(
      `return !document.body.classList.contains('show-history')`,
      'the return to the chat after deleting it',
    );
    const fresh = await read(`
      return {
        log: (document.getElementById('log') || {}).textContent?.trim() || '',
        title: (document.getElementById('chatTitleText') || {}).textContent?.trim() || '',
        composer: !!document.getElementById('q'),
      };
    `);
    if (fresh.log !== '' || fresh.title !== '' || !fresh.composer) {
      throw new Error(`the view is not a fresh empty chat: ${JSON.stringify(fresh)}`);
    }
    say('OK   deleting the current chat lands on a fresh empty chat');

    await openHistory();
    const afterCurrent = await chatsShown();
    if (afterCurrent.rows.some((r) => r.current || r.title.includes('cherryword'))) {
      throw new Error(`the deleted conversation is still in History: ${JSON.stringify(afterCurrent.rows)}`);
    }
    await setQuery('cherryword');
    const cherry = await searchKinds();
    if (cherry.some((h) => h.kind === 'Chat')) {
      throw new Error(`the deleted conversation is still searchable as a chat: ${JSON.stringify(cherry)}`);
    }
    say('OK   the deleted conversation is gone from History (its run record remains)');
    await clearQuery();

    /* ---- Delete all on Chats ------------------------------------------ */
    await field.switchToChatFrame();
    const beforeAll = await chatsShown();
    if (!beforeAll.deleteAll) throw new Error('Delete all is not offered on Chats');
    const allButton = await field.driver.findElement(
      By.css('#hibody .runhead .btn-danger'),
    );
    await fireDelete(allButton);
    await waitInPage(
      `return !document.body.classList.contains('show-history')`,
      'the return to the chat after Delete all',
    );
    await openHistory();
    const afterAll = await chatsShown();
    if (afterAll.rows.length !== 0
      || !afterAll.notes.some((n) => n.includes('No saved conversations'))) {
      throw new Error(`History is not empty after Delete all: ${JSON.stringify(afterAll)}`);
    }
    say(`OK   Delete all empties History and ends on the fresh chat  notes=${JSON.stringify(afterAll.notes)}`);

    /* ---- An image from OUTSIDE the workspace -------------------------- */
    // A fresh chat, so the chip is unambiguous.
    await field.newChat();
    await driver.sleep(800);
    await field.switchToChatFrame();
    await read(`const c = document.getElementById('clip'); if (c) c.click();`);
    await field.webview.switchBack();
    let picker = null;
    let pickerDeadline = Date.now() + 12000;
    while (picker === null && Date.now() < pickerDeadline) {
      for (const box of await driver.findElements(By.css('.quick-input-box input'))) {
        if (await box.isDisplayed().catch(() => false)) { picker = box; break; }
      }
      if (picker === null) await sleep(250);
    }
    if (picker === null) {
      throw new Error('the file picker did not draw in the workbench (simple dialog not used)');
    }
    // The dialog is pre-filled with the workspace path; replace it, or the
    // typed path is appended and the dialog reports "Please enter a path that
    // exists" (measured on the first attempt).
    await picker.sendKeys(Key.END);
    await picker.sendKeys(Array(160).fill(Key.BACK_SPACE).join(''));
    await picker.sendKeys(IMG);
    await sleep(900);
    const typed = await picker.getAttribute('value').catch(() => '');
    if (typed !== IMG) {
      throw new Error(`the dialog holds "${typed}", not the image path`);
    }
    await picker.sendKeys(Key.ENTER);
    await sleep(900);
    // The simple dialog submits with its own button, labelled by the host.
    let attached = false;
    for (const label of ['Attach', 'Open', 'OK']) {
      const buttons = await driver.findElements(
        By.xpath(`//a[normalize-space(text())='${label}']`),
      );
      if (buttons.length > 0) {
        await buttons[0].click().catch(() => {});
        attached = true;
        await sleep(800);
        break;
      }
    }
    await field.switchToChatFrame();
    await waitInPage(
      `return [...document.querySelectorAll('.attach-chip .ac-name')]
        .some((n) => n.textContent.startsWith('outside-shot.png'));`,
      'the attachment chip with the base name',
    );
    const chip = await read(`
      return [...document.querySelectorAll('.attach-chip .ac-name')].map((n) => n.textContent);
    `);
    say(`OK   the chip shows the base name of an outside file (submit button found: ${attached})  ${JSON.stringify(chip)}`);

    await setScript([{ text: 'Seen the picture.' }]);
    const shotMarker = await field.send('What is in this picture?');
    await field.waitRunEnd(shotMarker, { tag: 'image', timeoutMs: 120000 });
    const log = await stubLog();
    const turn = [...(log.log ?? [])]
      .reverse()
      .find((r) => r.consumedStep !== 'auxiliary');
    if (!turn || turn.imageParts !== 1 || turn.imageMimes?.[0] !== 'image/png') {
      throw new Error(`the request did not carry the outside image: ${JSON.stringify(turn)}`);
    }
    say(`OK   the provider request carries the image  parts=${turn.imageParts} mime=${turn.imageMimes}`);

    /* ---- The scroll fix, at a short window height --------------------- */
    // Enough run rows to overflow a short window. macOS reports /var/... where
    // VS Code sees /private/var/..., and the runs folder is keyed by the root
    // string, so seed both spellings.
    const seedDirs = new Set([RUNS_DIR]);
    const home = dirname(dirname(RUNS_DIR));
    for (const spelling of new Set([process.env['PLATO_VERIFY_WS'], realpathSync(process.env['PLATO_VERIFY_WS'])])) {
      if (spelling) {
        const key = createHash('sha1').update(spelling).digest('hex').slice(0, 8);
        seedDirs.add(join(home, 'runs', key));
      }
    }
    for (const dir of seedDirs) mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 40; i += 1) {
      const rows = [
        {
          kind: 'header',
          schemaVersion: 1,
          runId: `seed-${i}`,
          startedAt: `2099-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
          task: `seeded run ${i}`,
          root: process.env['PLATO_VERIFY_WS'] ?? '',
          mode: 'auto',
        },
        { type: 'text', runId: `seed-${i}`, text: `seeded output ${i}` },
      ];
      for (const dir of seedDirs) {
        writeFileSync(
          join(dir, `2099-03-${String(i).padStart(2, '0')}T00-00-00-000Z-seed-${i}.jsonl`),
          rows.map((e) => JSON.stringify(e)).join('\n') + '\n',
          'utf8',
        );
      }
    }

    // Electron's ChromeDriver does not implement the Window API ("Browser.
    // getWindowForTarget wasn't found", measured). Set the renderer viewport
    // instead: the page and every webview inside it get a short height, which
    // is the condition under test.
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 560,
      deviceScaleFactor: 0,
      mobile: false,
    });
    await driver.sleep(1500);
    await field.switchToChatFrame();
    await read(`const h = document.getElementById('hist'); if (h) h.click();`);
    await waitInPage(
      `return document.body.classList.contains('show-history')
        && !!document.querySelector('#htab-runs');`,
      'History after the resize',
    );
    await sleep(400);
    await read(`document.getElementById('htab-runs').click();`);
    await waitInPage(
      `return document.querySelectorAll('#hibody .runitem').length > 20;`,
      'the run list to fill the short window',
    );

    const before = await read(`
      const rect = (n) => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const body = document.getElementById('hibody');
      const first = document.querySelector('#hibody .runitem');
      return {
        head: rect(document.querySelector('#historyPage header.shead')),
        search: rect(document.getElementById('hsearch')),
        tabs: rect(document.getElementById('htabs')),
        body: rect(body),
        first: rect(first),
        overflow: getComputedStyle(body).overflowY,
        scrolls: body.scrollHeight > body.clientHeight + 1,
        vh: window.innerHeight,
      };
    `);
    if (!(before.overflow === 'auto' && before.scrolls === true)) {
      throw new Error(`the list region does not scroll: ${JSON.stringify(before)}`);
    }
    if (before.body.bottom > before.vh + 1) {
      throw new Error(`the list runs past the window: ${JSON.stringify(before)}`);
    }
    if (before.body.top < before.tabs.bottom - 1) {
      throw new Error(`the list starts above the tabs: ${JSON.stringify(before)}`);
    }
    say(`OK   at ${before.vh}px high the list scrolls inside the window  body=${before.body.top}-${before.body.bottom}, tabs end ${before.tabs.bottom}`);

    const after = await read(`
      const body = document.getElementById('hibody');
      body.scrollTop = 120;
      const rect = (n) => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      return {
        head: rect(document.querySelector('#historyPage header.shead')),
        search: rect(document.getElementById('hsearch')),
        tabs: rect(document.getElementById('htabs')),
        body: rect(body),
        first: rect(document.querySelector('#hibody .runitem')),
        top: body.scrollTop,
      };
    `);
    const moved = after.first.top < before.first.top;
    const still = after.head.top === before.head.top
      && after.search.top === before.search.top
      && after.tabs.top === before.tabs.top
      && after.body.top === before.body.top;
    if (!(after.top > 0 && moved && still)) {
      throw new Error(
        `scrolling the list moved something it must not: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      );
    }
    say(`OK   scrolling the list moves its rows and leaves the header in place  scrollTop=${after.top}, first row ${before.first.top} -> ${after.first.top}, header ${before.head.top} -> ${after.head.top}`);
  });
});
