/**
 * 0.30.0 window check — a provider's advertised context window, in a real
 * window.
 *
 * Run it with `node scripts/field/verify-0300.mjs`. It assumes that launcher:
 * a packaged 0.30.0, a throwaway workspace and Plato home, and a scripted model
 * whose `/models` serves two entries from ONE endpoint:
 *   - `deepseek-chat` carries DeepSeek's own spelling, `context_window:
 *     1048576`, and no `context_length`;
 *   - `quiet-model` carries no window at all.
 *
 * What it measures:
 *   - a stored pool with a recent timestamp but no window on either model —
 *     what 0.29.0 left behind — is stale under the CLI's cache rule: the FIRST
 *     run refreshes it and uses the refreshed pool, so the ring reads 1M on
 *     that run and the window is not stranded behind a 24-hour cache;
 *   - the window reaches the UI as 1,048,576, not 131,072: the composer's model
 *     picker says "1M context", Plato's Settings list says the same, and the
 *     live context ring's max row reads 1M after a run;
 *   - the fold threshold uses that same number. One conversation of about
 *     115,000 estimated tokens does NOT compact on the 1M model (80% of 1M is
 *     838,861) and DOES compact on the quiet model, whose absent window falls
 *     back to core's 131,072 (80% of that is 104,858). The compaction line
 *     printed in the chat carries the measured size, so the trip can be read;
 *   - nothing else regressed: a normal run, an approval card, and a path link
 *     all behave as before.
 *
 * The packaged webview is a compiled page with no test hooks, so an uncaught
 * page error cannot be observed from outside the frame the way the render
 * suites observe one. The proxy used here is stated with its limits in the
 * report: every affordance the page must draw was found and worked, and the
 * window carries no error notification at the end.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const WS = process.env['PLATO_VERIFY_WS'];

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

/**
 * About 115,000 tokens by core's ~4 chars/token estimate — enough to cross 80%
 * of the 131,072 fallback, far short of 80% of 1,048,576.
 */
const REPEAT = 'the quick brown fox jumps over the lazy dog. ';
const BIG = 'BIG-NOTE-START ' + REPEAT.repeat(10000) + 'BIG-NOTE-END';

describe('0.30.0 real-window check — the advertised context window', function () {
  this.timeout(1200000);
  let driver;
  let field;

  const read = (script, ...args) => field.driver.executeScript(script, ...args);

  async function waitInPage(script, label, timeoutMs = 30000, arg) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = arg === undefined ? await read(script) : await read(script, arg);
      } catch {
        last = undefined;
      }
      if (last === true) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
  }

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

  /** The rows of the composer's model picker, as the user reads them. */
  async function openModelPicker() {
    await field.switchToChatFrame();
    await read(`document.getElementById('modelBtn').click(); return true;`);
    await waitInPage(
      `return !!document.querySelector('.popover-row.model-row');`,
      'the model picker',
    );
    return await read(`
      return [...document.querySelectorAll('.popover-row.model-row')].map((r) => ({
        value: r.dataset.value || '',
        name: ((r.querySelector('.pr-name') || {}).textContent || '').trim(),
        sub: ((r.querySelector('.pr-sub') || {}).textContent || '').trim(),
      }));
    `);
  }

  async function closePopover() {
    await read(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true;`);
    await sleep(250);
  }

  /** The compaction rows the chat shows, oldest first. */
  async function compactionRows() {
    return await read(`
      return [...document.querySelectorAll('#log .msg')]
        .map((n) => (n.textContent || '').trim())
        .filter((t) => /context compacted|Summary added|Compacted while idle|Conversation reached \\d+% of this model's context|compaction produced no summary/i.test(t));
    `);
  }

  /**
   * Sends a large prompt without typing it through the keyboard — sendKeys is
   * one keystroke at a time and would take longer than the run. It sets the real
   * composer's value and dispatches the same Enter the page listens for, so the
   * page's own send path is what posts the message.
   */
  async function sendLarge(text) {
    const before = new Set(field.transcripts());
    await field.switchToChatFrame();
    const length = await read(`
      const q = document.getElementById('q');
      q.value = arguments[0];
      q.dispatchEvent(new Event('input', { bubbles: true }));
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return q.value.length;
    `, text);
    assert.equal(length, 0, 'the composer kept the large draft — the page did not send it');
    field.lastPrompt = text;
    say(`   large prompt posted: ${text.length} chars (~${Math.ceil(text.length / 4)} tokens)`);
    return before;
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

  it('reads the DeepSeek window, folds on the fallback, and keeps the rest', async () => {
    /* ---- 1. The old stored pool, refreshed and USED by the first run --- */
    // The settings file holds a pool fetched "now" with no window on either
    // model and no reader marker — exactly what 0.29.0 stored, because its
    // reader ignored `context_window`. The FIRST run must treat that pool as
    // stale, refresh it, and use the refreshed one: the ring's max row reads
    // 1M, and ~117k tokens are left alone because 80% of 1M is 838,861.
    await setScript([{ text: 'Files: `notes.txt`.' }]);
    const firstBefore = await sendLarge(BIG);
    const first = await field.waitRunEnd(firstBefore, { tag: 'first', timeoutMs: 300000 });
    assert.equal(first.find((e) => e.type === 'run-failed'), undefined,
      'the first run failed');

    // The ring is the run's own view of the window it measured against.
    await field.switchToChatFrame();
    const ring = await read(`
      return {
        max: document.getElementById('ctxb-max').textContent.trim(),
        threshold: document.getElementById('ctxb-thr-live').textContent.trim(),
      };
    `);
    say(`OK   context ring on the FIRST run  ${JSON.stringify(ring)}`);
    assert.equal(ring.max, '1M', 'the first run did not use the advertised 1M window');
    assert.equal(ring.threshold, '80%');

    // The post-run fold is scheduled; give it time to decide and act.
    await sleep(4000);
    const afterFirst = await compactionRows();
    assert.deepEqual(afterFirst, [],
      `the first run compacted the same conversation: ${JSON.stringify(afterFirst)}`);
    say('OK   the old pool was refreshed, and run one kept ~117k tokens on the 1M window');

    // The reply's path link still opens the file.
    await clickPath('notes.txt');
    await waitForTab('notes.txt');
    const editor = await new EditorView().openEditor('notes.txt');
    const text = await editor.getText();
    assert.equal(text, 'notes from the workspace\n');
    say(`OK   path link opened the file  text=${JSON.stringify(text)}`);
    await closeTab('notes.txt');

    /* ---- 2. Every display surface says 1M, not 131k -------------------- */
    const picker = await openModelPicker();
    say(`OK   model picker  ${JSON.stringify(picker)}`);
    const pickerDeep = picker.find((r) => r.name === 'deepseek-chat');
    const pickerQuiet = picker.find((r) => r.name === 'quiet-model');
    assert.ok(pickerDeep, `the picker does not list deepseek-chat: ${JSON.stringify(picker)}`);
    assert.ok(pickerQuiet, `the picker does not list quiet-model: ${JSON.stringify(picker)}`);
    assert.equal(pickerDeep.sub, '1M context', 'the picker did not show the 1M window');
    assert.equal(pickerQuiet.sub, 'context unknown', 'a model with no window must not invent one');
    await field.shot('0300-window-picker');
    await closePopover();

    // Plato's own Settings list, from the same payload.
    await field.switchToChatFrame();
    const opened = await field.openSettings();
    assert.equal(opened, true, 'Plato settings did not open');
    const listed = await driver.executeScript(`
      return [...document.querySelectorAll('#sbody .conn .mopt')].map((r) => ({
        name: ((r.querySelector('.mopt-name') || {}).textContent || '').trim(),
        sub: ((r.querySelector('.mopt-sub') || {}).textContent || '').trim(),
      }));
    `);
    say(`OK   settings model list  ${JSON.stringify(listed)}`);
    const listedDeep = listed.find((r) => r.name === 'deepseek-chat');
    const listedQuiet = listed.find((r) => r.name === 'quiet-model');
    assert.ok(listedDeep, `Settings does not list deepseek-chat: ${JSON.stringify(listed)}`);
    assert.ok(listedQuiet, `Settings does not list quiet-model: ${JSON.stringify(listed)}`);
    assert.equal(listedDeep.sub, '1M context');
    assert.equal(listedQuiet.sub, 'context unknown');
    await driver.executeScript(`document.getElementById('sback').click(); return true;`);
    await driver.sleep(400);
    await field.switchToChatFrame();

    /* ---- 3. An approval card still gates a write ----------------------- */
    await setScript([
      { calls: [{ tool: 'write_file', args: { path: 'approved.txt', content: 'approved by the card\n' } }] },
      { text: 'Wrote it.' },
    ]);
    const approvalBefore = await field.send('write the approved file');
    const approval = await field.waitRunEnd(approvalBefore, {
      plan: ['allow'],
      tag: 'approval',
      timeoutMs: 180000,
    });
    assert.equal(approval.find((e) => e.type === 'run-failed'), undefined,
      'the approval run failed');
    const card = field.cardsSeen.find((c) => c.tag === 'approval' && c.tool === 'write_file');
    assert.ok(card, `no write_file approval card was answered: ${JSON.stringify(field.cardsSeen)}`);
    const approved = join(WS, 'approved.txt');
    assert.equal(existsSync(approved), true, 'the approved write did not land');
    assert.equal(readFileSync(approved, 'utf8'), 'approved by the card\n');
    say('OK   approval card gated write_file, and the allowed write landed');

    /* ---- 4. The quiet model: the same history folds on the fallback --- */
    await openModelPicker();
    const switched = await read(`
      const r = [...document.querySelectorAll('.popover-row.model-row')]
        .find((x) => x.dataset.value === 'stub:quiet-model');
      if (!r) return false;
      r.click();
      return true;
    `);
    assert.equal(switched, true, 'the quiet model is not selectable in the picker');
    await waitInPage(
      `return ((document.querySelector('#modelBtn .model-btn-label') || {}).textContent || '').trim() === 'quiet-model';`,
      'the quiet model to be selected',
    );
    await closePopover();
    say('OK   switched to quiet-model through the picker');

    await setScript([{ text: 'Short note received.' }]);
    const quietBefore = await field.send('and now a short one');
    const quiet = await field.waitRunEnd(quietBefore, { tag: 'quiet', timeoutMs: 300000 });
    assert.equal(quiet.find((e) => e.type === 'run-failed'), undefined,
      'the quiet-model run failed');
    // The run's request is trimmed to the threshold before it is sent, so the
    // in-run check sees a total just under it; the HOST's fold reads the whole
    // transcript and is the one that trips here. Either line is a witness.
    let rows = [];
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      rows = await compactionRows();
      if (rows.some((t) => /context compacted|Summary added|Conversation reached/.test(t))) break;
      await sleep(500);
    }
    say(`OK   compaction on the quiet model  ${JSON.stringify(rows)}`);
    assert.ok(
      rows.some((t) => /context compacted|Summary added|Conversation reached/.test(t)),
      `the quiet model did not compact the same conversation: ${JSON.stringify(rows)}`,
    );
    const hostFold = rows.find((t) => t.includes('Conversation reached'));
    if (hostFold !== undefined) {
      assert.match(
        hostFold,
        /reached 80% of this model's context/,
        `the fold notice did not name the threshold that decided it: ${hostFold}`,
      );
      say('OK   the host fold fired at 80% of the fallback window, on the same history the 1M model kept');
    }
    const inRun = rows.find((t) => t.includes('context compacted'));
    if (inRun !== undefined) {
      const m = /\[plato\] context compacted \((\w+)\) — ([\d.]+)k tok →/.exec(inRun);
      assert.ok(m, `the compaction line did not carry the measured size: ${inRun}`);
      const beforeTokens = Number(m[2]) * 1000;
      assert.ok(
        beforeTokens > 104857 && beforeTokens < 131072,
        `the fold did not trip against the 131,072 fallback: ${inRun}`,
      );
      say(`OK   the fold tripped at ${m[2]}k tok — above 80% of the 131,072 fallback, below the 1M threshold`);
    }
    const ringQuiet = await read(`return document.getElementById('ctxb-max').textContent.trim();`);
    assert.equal(ringQuiet, '--', 'a model with no window must not display an invented one');
    say('OK   the quiet model shows no window, and the fallback still folded');

    await field.shot('0300-window-compacted');

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
});
