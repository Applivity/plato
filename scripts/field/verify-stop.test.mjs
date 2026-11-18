/**
 * The words and the key — pause, Stop and Esc in a real window.
 *
 * Run it with `node scripts/field/verify-stop.mjs`. It assumes that launcher:
 * a packaged 0.31.0, a throwaway workspace and Plato home, and a scripted model
 * on localhost. Every label and tooltip read below comes from the INSTALLED
 * vsix, not from the source tree.
 *
 * What it measures:
 *   - the run-stop control reads Stop and says "Stop the task. The conversation
 *     stays."; Pause says "Pause after the current step. Nothing is lost.";
 *   - a paused run says so in the run area, with the cost of closing the window,
 *     and the busy dot stops pulsing;
 *   - resuming finishes the task and does not replay a tool call — the stub saw
 *     exactly one request per agent turn, and the last request carries exactly
 *     two tool results, one per file;
 *   - Stop ends the run and leaves the conversation on screen;
 *   - Esc once pauses, and Esc twice within 1.5 s stops.
 */
import assert from 'node:assert/strict';

import { By, Key } from 'selenium-webdriver';
import {
  VSBrowser,
  WebView,
  Workbench,
  NotificationsCenter,
} from 'vscode-extension-tester';

import { Field } from './driver.mjs';

const STUB = process.env['PLATO_VERIFY_STUB'];
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
  const res = await fetch(`${STUB}/__log`);
  return await res.json();
}

/** Every request that carried tools: one per agent turn, never per click. */
async function agentTurns() {
  const { log } = await stubLog();
  return log.filter((e) => Number(e.toolsOffered) > 0);
}

/**
 * The first quick-input field whose step matches `want`, ready to type into.
 *
 * A sleep is not a wait: the palette is in the DOM before it accepts keystrokes,
 * and the old fixed sleeps typed into a box that existed but was not yet
 * interactable. This polls the field's DISPLAYED and ENABLED state, and also
 * reads the step's own words, so the key is not typed into the connection
 * picker when the next step has not arrived yet.
 */
async function quickInput(driver, want, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const widget = await driver.executeScript(`
      const w = document.querySelector('.quick-input-widget');
      return w ? String(w.textContent || '') : '';
    `).catch(() => '');
    for (const el of await driver.findElements(By.css('.quick-input-box input'))) {
      try {
        if (!(await el.isDisplayed()) || !(await el.isEnabled())) continue;
        const desc = widget + ' ' + ((await el.getAttribute('placeholder')) || '');
        last = desc.replace(/\s+/g, ' ').trim().slice(0, 140);
        if (want.test(desc)) return el;
      } catch {
        /* the palette rebuilt under us; look again */
      }
    }
    await driver.sleep(200);
  }
  throw new Error(
    `the quick-input step ${want} never became interactable within ${timeoutMs}ms (last: ${JSON.stringify(last)})`,
  );
}

/** Types into the field, re-finding it if the palette was still settling. */
async function sendWithRetry(driver, el, keys, want, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      await el.sendKeys(keys);
      return;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!/interact|stale|not reachable/i.test(msg)) throw e;
      last = e;
      await driver.sleep(250);
      el = await quickInput(driver, want, 3000);
    }
  }
  throw new Error(`the ${want} field never accepted input within ${timeoutMs}ms (${last?.message ?? ''})`);
}

/**
 * Runs a command through the workbench, retrying while the palette is still
 * becoming interactive. The tester's own executeCommand types into the quick
 * input at once; on a freshly launched window that input can exist but not yet
 * accept keystrokes, which is the flake this replaces.
 */
async function runCommand(driver, title, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      await new Workbench().executeCommand(title);
      return;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!/interact|stale|not reachable|waiting until|timeout/i.test(msg)) throw e;
      last = e;
      await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => {});
      await driver.sleep(500);
    }
  }
  throw new Error(
    `the command "${title}" never ran within ${timeoutMs}ms (last: ${last?.message ?? ''})`,
  );
}

/** Sets the API key through the product's own command (the stub ignores it). */
async function setApiKey(driver) {
  await runCommand(driver, 'Plato: Set API Key');
  const pick = await quickInput(driver, /which connection is this key for/i);
  await sendWithRetry(driver, pick, 'stub', /which connection is this key for/i);
  await driver.sleep(250);
  await sendWithRetry(driver, pick, Key.ENTER, /which connection is this key for/i);
  const key = await quickInput(driver, /API key/i);
  await sendWithRetry(driver, key, 'sk-stub-not-a-real-key', /API key/i);
  await sendWithRetry(driver, key, Key.ENTER, /API key/i);
  await driver.sleep(600);
}

/** The two controls and the run area, as the installed build draws them. */
async function controls(driver, field) {
  await field.switchToChatFrame();
  return await driver.executeScript(`
    const pp = document.getElementById('pp');
    const cx = document.getElementById('cx');
    const bar = document.getElementById('statusbar');
    const dot = bar ? bar.querySelector('.pdot') : null;
    return {
      pause: { text: pp.textContent.trim(), title: pp.title, hidden: pp.hidden },
      stop: { text: cx.textContent.trim(), title: cx.title, hidden: cx.hidden },
      status: bar ? (bar.querySelector('.stext') || {}).textContent : null,
      paused: bar ? bar.classList.contains('paused') : null,
      dotAnim: dot ? getComputedStyle(dot).animationName : null,
    };
  `);
}

/**
 * Closes VS Code's notification toasts.
 *
 * The key-stored toast sits exactly over the right of the composer bar, where
 * Stop and Resume are. The notifications CENTER can be empty while a toast is
 * on screen, so the toast itself is dismissed here (its close control appears
 * on hover, and a scripted click does not need the hover).
 */
async function dismissToasts(driver, field) {
  await field.webview.switchBack();
  const res = await driver.executeScript(`
    const hosts = document.querySelectorAll('.notifications-toasts, .notification-toast');
    let closed = 0;
    for (const h of hosts) {
      for (const b of h.querySelectorAll(
        '[aria-label^="Clear Notification"], .codicon-notifications-clear, ' +
        '.codicon-close, .codicon-notification-close, [aria-label="Close"], [title="Close"]')) {
        b.click();
        closed += 1;
      }
    }
    return { hosts: hosts.length, closed };
  `);
  await driver.sleep(300);
  await field.switchToChatFrame();
  return res;
}

/** Presses Esc on the run surface: the composer has focus, no menu or card. */
async function pressEsc(driver, field) {
  await field.switchToChatFrame();
  const q = await driver.findElement(By.id('q'));
  await q.click();
  await q.sendKeys(Key.ESCAPE);
}

const PAUSE_STEPS = [
  { delayMs: 3000, calls: [{ tool: 'read_file', args: { path: 'notes.txt' } }] },
  { delayMs: 2000, calls: [{ tool: 'read_file', args: { path: 'notes2.txt' } }] },
  { text: 'Read both notes.' },
];

describe('the words and the key — real-window check', function () {
  this.timeout(900000);
  let driver;
  let field;

  before(async () => {
    driver = VSBrowser.instance.driver;
    await runCommand(driver, 'Plato: Open Chat');
    await driver.sleep(3000);
    await setApiKey(driver);
    try {
      await new NotificationsCenter().clearAllNotifications();
    } catch {
      /* nothing showing */
    }
    await driver.sleep(500);
    field = new Field(driver, new WebView(), { runsDir: RUNS_DIR, shotsDir: SHOTS });
    await field.enter();
  });

  it('pauses at a safe point, says so, resumes, and does not replay a call', async () => {
    await setScript(PAUSE_STEPS);
    const before = await field.send('read both notes');
    let seen = null;
    const events = await field.waitRunEnd(before, {
      tag: 'pause',
      timeoutMs: 180000,
      during: async () => {
        const started = await field.waitForRunStart();
        const ui = await controls(driver, field);
        seen = ui;
        assert.equal(ui.pause.text, 'Pause', 'the run did not start with Pause on the control');
        assert.equal(ui.pause.title, 'Pause after the current step. Nothing is lost.');
        assert.equal(ui.stop.text, 'Stop', 'the run-stop control is not labelled Stop');
        assert.equal(ui.stop.title, 'Stop the task. The conversation stays.');
        say(`OK   installed build: pause "${ui.pause.title}" / stop "${ui.stop.text}"`);

        const clicked = await field.pause();
        assert.equal(clicked.label, 'Pausing…',
          'the control claimed a pause before the run reached a safe point');
        const parked = await field.waitForPauseLabel('Resume', 30000);
        assert.equal(parked.label, 'Resume', 'the run never parked');
        const paused = await controls(driver, field);
        assert.match(paused.status || '', /^Paused\b/,
          'the run area does not say the run is paused');
        assert.match(paused.status || '', /does not survive closing this window/,
          'the run area does not say a pause is lost when the window closes');
        assert.equal(paused.paused, true, 'the status bar does not carry the paused state');
        assert.equal(paused.dotAnim, 'none', 'the busy dot is still pulsing while parked');
        say(`OK   paused: "${paused.status}" (dot ${paused.dotAnim})`);
        // The key-stored toast sits over the right of the composer bar, where
        // Resume is. Clear it first, so the screenshot shows the control.
        const cleared = await dismissToasts(driver, field);
        say(`   toasts: ${JSON.stringify(cleared)}`);
        await field.shot('stop-window-paused');

        const released = await field.pause();
        assert.equal(released.label, 'Pause', 'Resume did not release the run');
      },
    });
    const ended = events.find((e) => e.type === 'run-completed');
    assert.ok(ended, 'the resumed run wrote no run-completed event');
    assert.equal(ended.reason, 'complete', 'the resumed run did not finish normally');

    const turns = await agentTurns();
    assert.equal(turns.length, 3,
      `the resumed run made ${turns.length} agent turns, not the 3 scripted ones`);
    const last = turns[turns.length - 1];
    assert.equal((last.toolResults || []).length, 2,
      `the last request carried ${(last.toolResults || []).length} tool results, not one per file`);
    const heads = (last.toolResults || []).map((r) => String(r.head || ''));
    assert.ok(heads.some((h) => h.includes('notes from the workspace')), 'notes.txt was never read');
    assert.ok(heads.some((h) => h.includes('notes too')), 'notes2.txt was never read');
    say('OK   resume finished the task: 3 agent turns, 2 tool results, no call replayed');
    say(`OK   pause state seen before the press: ${JSON.stringify(seen.pause)}`);
  });

  it('stops the run and keeps the conversation', async () => {
    await setScript([
      { delayMs: 8000, calls: [{ tool: 'read_file', args: { path: 'notes.txt' } }] },
      { text: 'This should not run.' },
    ]);
    const prompt = 'stop this one and keep what we said';
    const before = await field.send(prompt);
    let stopUi = null;
    const events = await field.waitRunEnd(before, {
      tag: 'stop',
      timeoutMs: 90000,
      during: async () => {
        await field.waitForRunStart();
        const ui = await controls(driver, field);
        stopUi = ui.stop;
        assert.equal(ui.stop.text, 'Stop');
        assert.equal(ui.stop.title, 'Stop the task. The conversation stays.');
        await field.cancel();
      },
    });
    const ended = events.find((e) => e.type === 'run-completed');
    assert.ok(ended, 'the stopped run wrote no run-completed event');
    assert.equal(ended.reason, 'cancelled', `the run ended as "${ended.reason}", not cancelled`);
    await field.switchToChatFrame();
    const text = await field.logText();
    assert.ok(text.includes(prompt), 'the user message is not in the conversation after Stop');
    say(`OK   Stop ended the run as cancelled, and the conversation kept "${prompt}"`);
    say(`OK   Stop control read: ${JSON.stringify(stopUi)}`);
    await field.shot('stop-window-stopped');
  });

  it('Esc once pauses, and Resume finishes the run', async () => {
    await setScript(PAUSE_STEPS);
    const before = await field.send('esc once, then resume');
    const events = await field.waitRunEnd(before, {
      tag: 'esc-pause',
      timeoutMs: 180000,
      during: async () => {
        await field.waitForRunStart();
        await pressEsc(driver, field);
        const parked = await field.waitForPauseLabel('Resume', 30000);
        assert.equal(parked.label, 'Resume', 'one Esc did not park the run');
        const paused = await controls(driver, field);
        assert.match(paused.status || '', /^Paused\b/);
        assert.equal(paused.dotAnim, 'none');
        say(`OK   one Esc paused the run: "${paused.status}"`);
        const cleared = await dismissToasts(driver, field);
        say(`   toasts: ${JSON.stringify(cleared)}`);
        await field.shot('stop-window-esc-paused');
        await field.pause(); // Resume
      },
    });
    const ended = events.find((e) => e.type === 'run-completed');
    assert.ok(ended, 'the Esc-paused run wrote no run-completed event');
    assert.equal(ended.reason, 'complete', 'the Esc-paused run did not finish after Resume');
    say('OK   Esc once paused, Resume finished');
  });

  it('Esc twice within 1.5 s stops the run and keeps the conversation', async () => {
    await setScript([
      { delayMs: 8000, calls: [{ tool: 'read_file', args: { path: 'notes2.txt' } }] },
      { text: 'This should not run either.' },
    ]);
    const prompt = 'esc twice should stop this one';
    const before = await field.send(prompt);
    const events = await field.waitRunEnd(before, {
      tag: 'esc-stop',
      timeoutMs: 90000,
      during: async () => {
        await field.waitForRunStart();
        await pressEsc(driver, field);
        await sleep(250);
        await pressEsc(driver, field);
      },
    });
    const ended = events.find((e) => e.type === 'run-completed');
    assert.ok(ended, 'the Esc-stopped run wrote no run-completed event');
    assert.equal(ended.reason, 'cancelled', `Esc twice ended the run as "${ended.reason}", not cancelled`);
    await field.switchToChatFrame();
    const text = await field.logText();
    assert.ok(text.includes(prompt), 'the user message is not in the conversation after Esc twice');
    say('OK   Esc twice stopped the run, and the conversation stayed');
    await field.shot('stop-window-esc-stopped');
  });

  it('pauses while a final answer is arriving, and Resume lands it', async () => {
    // `pauseFinalAnswer: true` is what makes this work. Without it the run has
    // no safe point left once the closing answer is on its way, so the press is
    // recorded and then the run simply ends — the old "a pause that never
    // lands" behaviour.
    await setScript([{ delayMs: 4000, text: 'The final answer is here.' }]);
    const before = await field.send('give me the final answer');
    let held = false;
    const events = await field.waitRunEnd(before, {
      tag: 'pause-final-answer',
      timeoutMs: 90000,
      during: async () => {
        await field.waitForRunStart();
        const clicked = await field.pause();
        assert.equal(clicked.label, 'Pausing…');
        const parked = await field.waitForPauseLabel('Resume', 30000);
        assert.equal(parked.label, 'Resume',
          'the pause during a final answer was never honoured');
        const paused = await controls(driver, field);
        assert.match(paused.status || '', /^Paused\b/);
        assert.equal(paused.dotAnim, 'none');
        held = true;
        await field.shot('stop-window-final-answer-paused');
        await field.pause(); // Resume
      },
    });
    assert.equal(held, true, 'the run never parked on the final answer');
    const ended = events.find((e) => e.type === 'run-completed');
    assert.ok(ended, 'the final-answer run wrote no run-completed event');
    assert.equal(ended.reason, 'complete', 'the resumed final answer did not finish');
    await field.switchToChatFrame();
    const text = await field.logText();
    assert.ok(text.includes('The final answer is here.'),
      'the held answer did not land after Resume');
    say('OK   pause during a final answer: held, resumed, and the answer landed');
  });

  it('leaves no error notification on the window', async () => {
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
