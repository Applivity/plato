/**
 * 0.29.0 window check — the release's new behaviour, in a real window.
 *
 * Run it with `node scripts/field/verify-0290.mjs`. It assumes that launcher:
 * a packaged 0.29.0, a throwaway workspace and Plato home, and a scripted model.
 *
 * What it measures, each reported with its numbers:
 *   - the two new settings, as installed, read from VS Code's Settings editor;
 *   - an image path in a reply draws a 64x64 inline hint with no caption, and a
 *     click opens the image in an editor tab;
 *   - a text path in the same reply opens in an editor, with its content;
 *   - a path that does not exist posts the chat notice and opens no tab;
 *   - a paste posted from the real page becomes a chip, and the model is sent
 *     the bytes (the host route, not the OS clipboard);
 *   - an outside read asks its card; it offers core's three answers with their
 *     hints, and "Allow once" lets the tool result reach the model and the run
 *     finish.
 *
 * The packaged webview is a compiled page with no test hooks, so an uncaught
 * page error cannot be observed from outside the frame the way the render
 * suites observe one. The proxy used here is stated with its limits in the
 * report: every affordance the page must draw was found and worked, and the
 * window carries no error notification at the end.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { By, Key } from 'selenium-webdriver';
import {
  VSBrowser,
  WebView,
  Workbench,
  EditorView,
  Notification,
  NotificationsCenter,
} from 'vscode-extension-tester';

import { Field } from './driver.mjs';

const STUB = process.env['PLATO_VERIFY_STUB'];
const RUNS_DIR = process.env['PLATO_VERIFY_RUNS_DIR'];
const SHOTS = process.env['PLATO_VERIFY_SHOTS'];
const OUTSIDE = process.env['PLATO_VERIFY_OUTSIDE'];

/** The same 1x1 PNG the package's own render suites use. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

describe('0.29.0 real-window check — settings, hints, paths, paste, outside read', function () {
  this.timeout(900000);
  let driver;
  let field;

  const read = (script) => field.driver.executeScript(script);

  async function waitInPage(script, label, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await read(script).catch(() => undefined);
      if (last === true) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
  }

  /** Waits until some open editor tab title contains `want`. */
  async function waitForTab(want, timeoutMs = 20000) {
    await field.webview.switchBack();
    const deadline = Date.now() + timeoutMs;
    let titles = [];
    while (Date.now() < deadline) {
      titles = await new EditorView().getOpenEditorTitles().catch(() => []);
      if (titles.some((t) => t.includes(want))) return titles;
      await sleep(300);
    }
    throw new Error(`no editor tab named "${want}" appeared (open: ${titles.join(', ')})`);
  }

  async function closeTab(label) {
    await new EditorView().closeEditor(label);
    await driver.sleep(600);
  }

  async function clickPath(pathInReply) {
    await field.switchToChatFrame();
    const clicked = await read(`
      const p = [...document.querySelectorAll('.md-path')]
        .find((n) => n.getAttribute('data-path') === ${JSON.stringify(pathInReply)});
      if (!p) return false;
      p.click();
      return true;
    `);
    if (!clicked) throw new Error(`the path "${pathInReply}" is not a path control on screen`);
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

  it('settings, hints, paths, paste and an outside read', async () => {
    /* ---- 1. The two new settings, as installed ------------------------ */
    // Read from VS Code's own Settings editor, which renders what the
    // configuration service reports for this installed extension — defaults
    // included. The user settings file this run was given sets neither key, so
    // these are the values a fresh install has.
    //
    // The row is found by its `data-key` and its value by the `aria-checked` of
    // the toggle the user sees, because the page object's own `getValue()`
    // reads a control this VS Code build does not draw (measured: it reported
    // the hide setting's value for both keys).
    await field.webview.switchBack();
    const settings = await new Workbench().openSettings();
    const readSetting = async (id) => {
      // The page object's search box is the reliable way to filter the editor.
      await settings.findSettingByID(id);
      await driver.sleep(600);
      return await driver.executeScript(`
        const row = document.querySelector('[data-key="' + arguments[0] + '"]');
        if (!row) return { found: false };
        const box = row.querySelector('[role="checkbox"]');
        return {
          found: true,
          checked: box ? box.getAttribute('aria-checked') === 'true' : null,
          label: ((row.querySelector('.setting-item-category') || {}).textContent || '')
            + ((row.querySelector('.setting-item-label') || {}).textContent || ''),
        };
      `, id);
    };
    const idleRow = await readSetting('plato.compaction.idle');
    const hideRow = await readSetting('plato.chat.hideBeforeSummary');
    if (!idleRow.found || !hideRow.found) {
      throw new Error(`a new setting is not registered by the installed extension: ${JSON.stringify({ idleRow, hideRow })}`);
    }
    assert.equal(idleRow.checked, false, 'plato.compaction.idle must default to false');
    assert.equal(hideRow.checked, true, 'plato.chat.hideBeforeSummary must default to true');
    say(`OK   settings as installed  ${JSON.stringify(idleRow)}  ${JSON.stringify(hideRow)}`);
    await closeTab('Settings');
    await field.switchToChatFrame();

    /* ---- 2-4. A reply with an image, a file and a missing file -------- */
    await field.newChat();
    await setScript([{
      text: 'Files: `shot.png`, `notes.txt`, `gone.txt`.',
    }]);
    const marker = await field.send('name the files');
    const events = await field.waitRunEnd(marker, { tag: 'files', timeoutMs: 120000 });
    const failed = events.find((e) => e.type === 'run-failed');
    assert.equal(failed, undefined, `the reply run failed: ${JSON.stringify(failed)}`);

    // The hint arrives after the page asks the host about the path.
    await waitInPage(
      `const i = document.querySelector('.md-thumb');
       return !!i && i.tagName === 'IMG' && i.complete && i.naturalWidth > 0;`,
      'the image hint to load',
    );
    const hint = await read(`
      const img = document.querySelector('.md-thumb');
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const msg = img.closest('.msg');
      return {
        tag: img.tagName,
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display, vAlign: cs.verticalAlign, fit: cs.objectFit,
        title: img.getAttribute('title') || '',
        captions: msg ? msg.querySelectorAll('figcaption').length : -1,
        inline: !!img.closest('p'),
      };
    `);
    say(`OK   hint measured  ${JSON.stringify(hint)}`);
    assert.equal(hint.tag, 'IMG');
    assert.equal(hint.w, 64);
    assert.equal(hint.h, 64);
    assert.equal(hint.display, 'inline-block');
    assert.equal(hint.vAlign, 'middle');
    assert.equal(hint.fit, 'cover');
    assert.match(hint.title, /shot\.png/);
    assert.equal(hint.captions, 0, 'the hint must carry no caption');
    assert.equal(hint.inline, true, 'the hint must sit inside the paragraph');

    // The screenshot the record keeps: the reply with its thumbnail.
    await field.shot('0290-reply-thumbnail');

    // A click on the hint opens the FULL image in an editor tab.
    await read(`document.querySelector('.md-thumb').click();`);
    const afterImage = await waitForTab('shot.png');
    say(`OK   clicking the hint opened an editor  open=${JSON.stringify(afterImage)}`);
    await closeTab('shot.png');

    // A text path opens in an editor, with its content read back.
    await clickPath('notes.txt');
    await waitForTab('notes.txt');
    const editor = await new EditorView().openEditor('notes.txt');
    const text = await editor.getText();
    assert.equal(text, 'notes from the workspace\n');
    say(`OK   clicking a text path opened an editor  text=${JSON.stringify(text)}`);
    await closeTab('notes.txt');

    // A missing path says so in the chat and opens nothing.
    await field.switchToChatFrame();
    const beforeTabs = await (async () => {
      await field.webview.switchBack();
      return await new EditorView().getOpenEditorTitles();
    })();
    await clickPath('gone.txt');
    await field.switchToChatFrame();
    await waitInPage(
      `return (document.getElementById('log') || {}).textContent.includes('Could not open')`,
      'the missing-file notice',
    );
    const notice = await read(`
      const m = [...document.querySelectorAll('#log .msg.sys')]
        .map((n) => n.textContent)
        .filter((t) => t.includes('Could not open'));
      return m[m.length - 1] || '';
    `);
    await field.webview.switchBack();
    const afterTabs = await new EditorView().getOpenEditorTitles();
    const openedGone = afterTabs.some((t) => t.includes('gone.txt'));
    say(`OK   a missing path is said in the chat  notice=${JSON.stringify(notice)}  tabOpened=${openedGone}`);
    assert.match(notice, /gone\.txt/);
    assert.match(notice, /not found|ENOENT/);
    assert.equal(openedGone, false);
    assert.equal(afterTabs.length, beforeTabs.length);

    /* ---- 5. A paste posts the page's own attach-bytes message -------- */
    // The OS clipboard cannot be driven honestly from here, and driving it
    // would test the platform rather than Plato. What is posted is EXACTLY the
    // message the page's paste handler sends (type, name, mime, data), so this
    // proves the host route: bytes -> bounded temp file -> attachFiles -> chip
    // -> the model's turn. The render suite proves the handler produces it.
    await field.newChat();
    await field.switchToChatFrame();
    const posted = await driver.executeScript(`
      const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'clip.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
      document.getElementById('q').dispatchEvent(ev);
      return true;
    `, PNG);
    assert.equal(posted, true);
    await waitInPage(
      `return [...document.querySelectorAll('.attach-chip .ac-name')]
        .some((n) => n.textContent.includes('clip.png'));`,
      'the pasted image chip',
    );
    const chips = await read(`
      return [...document.querySelectorAll('.attach-chip .ac-name')].map((n) => n.textContent);
    `);
    say(`OK   the pasted bytes became a chip  ${JSON.stringify(chips)}`);

    await setScript([{ text: 'Seen the pasted picture.' }]);
    const pasteMarker = await field.send('what is in the pasted picture?');
    const pasteEvents = await field.waitRunEnd(pasteMarker, { tag: 'paste', timeoutMs: 120000 });
    assert.equal(pasteEvents.find((e) => e.type === 'run-failed'), undefined);
    const log = await stubLog();
    const turn = [...(log.log ?? [])]
      .reverse()
      .find((r) => r.consumedStep !== 'auxiliary' && r.consumedStep !== 'observer');
    assert.ok(turn, 'the stub recorded no agent turn');
    assert.equal(turn.imageParts, 1, 'the model was not sent the pasted image');
    assert.equal(turn.imageMimes?.[0], 'image/png');
    say(`OK   the model received the pasted bytes  parts=${turn.imageParts} mime=${turn.imageMimes}`);

    /* ---- 6. An outside read: card, Allow once, result, run end -------- */
    await field.newChat();
    await setScript([
      { calls: [{ tool: 'read_file', args: { path: OUTSIDE } }] },
      { text: 'Read it.' },
    ]);
    const outsideBefore = await field.send('read the file outside the project');
    const outside = await waitForOutsideRun(outsideBefore);
    say(`OK   the outside card was answered: Allow once  card=${JSON.stringify(outside.cardText)}`);
    assert.equal(outside.answered, true, 'the outside-read card never appeared or was not answered');
    // The three answers, with core's own one-line hints, in order.
    assert.deepEqual(
      outside.answers.map((a) => a.label),
      ['Allow once', 'Allow for this session', 'Deny'],
      `the card did not offer core's three answers: ${JSON.stringify(outside.answers)}`,
    );
    assert.deepEqual(
      outside.answers.map((a) => a.hint),
      ['Just this one request.', 'Anything outside the project until this chat ends.', 'Nothing is read.'],
      `the card did not carry core's hints: ${JSON.stringify(outside.answers)}`,
    );
    say(`OK   the card offers three answers with their hints  ${JSON.stringify(outside.answers)}`);
    assert.equal(outside.events.find((e) => e.type === 'run-failed'), undefined);
    assert.ok(
      outside.events.some((e) => e.type === 'run-completed'),
      'the outside-read run did not finish',
    );
    const outsideLog = await stubLog();
    const afterTool = [...(outsideLog.log ?? [])]
      .reverse()
      .find((r) => r.consumedStep !== 'auxiliary' && r.consumedStep !== 'observer');
    const heads = (afterTool?.toolResults ?? []).map((r) => r.head || '');
    if (!heads.some((h) => h.includes('outside-read-marker'))) {
      throw new Error(`the tool result never reached the model: ${JSON.stringify(heads)}`);
    }
    say('OK   the outside file\'s content reached the model, and the run finished');

    /* ---- No error notification left on the window ---------------------- */
    await field.webview.switchBack();
    const notices = await new NotificationsCenter().getNotifications().catch(() => []);
    const errors = [];
    for (const n of notices) {
      const kind = String(await n.getType().catch(() => '')).toLowerCase();
      const msg = String(await n.getMessage().catch(() => ''));
      if (kind.includes('error') || /uncaught|exception/i.test(msg)) errors.push({ kind, msg });
    }
    assert.deepEqual(errors, [], 'the window carries an error notification');
    say(`OK   no error notification on the window (${notices.length} notification(s), none errors)`);
  });

  /**
   * Waits for a run whose tool call needs the outside-read card. The shared
   * driver does not know this card, and a card nobody answers parks the run, so
   * this loop answers "Allow once" the moment it is drawn and then judges the
   * transcript, exactly as the driver does.
   */
  async function waitForOutsideRun(before, timeoutMs = 180000) {
    const started = Date.now();
    let answered = false;
    let cardText = '';
    let answers = [];
    while (Date.now() - started < timeoutMs) {
      await field.switchToChatFrame().catch(() => {});
      const card = await read(`
        const c = document.querySelector('.card.outside-card:not(.answered)');
        if (!c) return null;
        return {
          text: c.textContent,
          answers: [...c.querySelectorAll('.actions button')].map((b) => ({
            label: ((b.querySelector('.oa-label') || {}).textContent || '').trim(),
            hint: ((b.querySelector('.oa-hint') || {}).textContent || '').trim(),
          })),
        };
      `).catch(() => null);
      if (card !== null && card !== undefined) {
        if (!answered) {
          cardText = String(card.text);
          answers = card.answers;
        }
        const clicked = await read(`
          const c = document.querySelector('.card.outside-card:not(.answered)');
          if (!c) return false;
          const b = [...c.querySelectorAll('button')].find((x) =>
            ((x.querySelector('.oa-label') || {}).textContent || '').trim() === 'Allow once');
          if (!b) return false;
          b.click();
          return true;
        `).catch(() => false);
        if (clicked) {
          answered = true;
          await sleep(500);
        }
      }
      const fresh = field.transcripts().filter((f) => !before.has(f));
      for (const file of fresh) {
        let text = '';
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('"run-completed"') || text.includes('"run-failed"')) {
          return { answered, cardText, answers, events: field.readRun(file) };
        }
      }
      await sleep(400);
    }
    throw new Error(`the outside-read run did not end within ${timeoutMs}ms (answered: ${answered})`);
  }
});
