/**
 * The field-test suite: real VS Code, real webview, scripted model.
 *
 * Each case opens a chat, switches mode through the real picker, sends the
 * prompt a person would send, makes the decisions a person would make, and then
 * asks two separate things: what the SCREEN showed, and what the TRANSCRIPT
 * recorded. Both must agree. When they disagree, that disagreement is the
 * finding — the driver can be wrong about what a click meant, and the transcript
 * can be blind to what the DOM looked like, so neither is trusted alone.
 *
 * Run it with:  node scripts/field/run-field.mjs
 * One case only: FIELD_CASES=5 node scripts/field/run-field.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { By, Key, until } from 'selenium-webdriver';
import { VSBrowser, WebView, Workbench, Notification } from 'vscode-extension-tester';

import { CASES, DEMO_REPO } from './cases.mjs';
import { Field } from './driver.mjs';
import { runsDirFor, verdict } from './verdict.mjs';

const STUB = `http://127.0.0.1:${process.env['PLATO_STUB_PORT'] ?? 4599}`;
// Absolute, from this file — NOT process.cwd(). Node resolves its own main
// path through the working directory at startup, so a run started from a
// directory the process cannot read dies before any of this file executes
// (EPERM: uv_cwd). Deriving our paths from the module keeps the harness
// runnable from anywhere.
const SHOTS = join(import.meta.dirname, '..', '..', 'tmp', 'field', 'shots');
const RUNS = runsDirFor(DEMO_REPO);
const only = (process.env['FIELD_CASES'] ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const selected = only.length > 0 ? CASES.filter((c) => only.includes(c.n)) : CASES;

/** Sets the scripted model's next replies. */
async function setScript(steps, needles = []) {
  const res = await fetch(`${STUB}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, needles }),
  });
  if (!res.ok) throw new Error(`stub refused the script: ${res.status}`);
}

/** What the model was actually asked — the harness's second witness. */
async function stubLog() {
  return (await fetch(`${STUB}/__log`)).json();
}

/**
 * The API key, set the way a person sets it: through the product's own command.
 * The stub ignores the value, so a throwaway string is correct here — the point
 * is that the host refuses to run at all without SOMETHING stored.
 */
async function setApiKey(driver, key) {
  await new Workbench().executeCommand('Plato: Set API Key');
  await driver.sleep(800);
  // With one connection configured the picker may be skipped entirely; if a
  // quick pick IS showing, filter to the stub connection and take it.
  const picks = await driver.findElements(By.css('.quick-input-list .monaco-list-row'));
  if (picks.length > 0) {
    const box = await driver.findElement(By.css('.quick-input-box input'));
    await box.sendKeys('stub');
    await driver.sleep(400);
    await box.sendKeys(Key.ENTER);
    await driver.sleep(600);
  }
  const input = await driver.wait(until.elementLocated(By.css('.quick-input-box input')), 15000);
  await input.sendKeys(key);
  await input.sendKeys(Key.ENTER);
  await driver.sleep(600);
  console.log(`  api key set for the stub connection`);
}

describe('Plato field tests — real VS Code', function () {
  this.timeout(900000);
  let driver;
  let field;

  before(async () => {
    driver = VSBrowser.instance.driver;
    await new Workbench().executeCommand('Plato: Open Chat');
    await driver.sleep(3000);

    // The key is set from the workbench, so this happens BEFORE entering the
    // webview frame.
    await setApiKey(driver, 'sk-stub-not-a-real-key');

    // Notifications (a Java extension pack recommendation, a key warning) sit at
    // the bottom-right of the window — over the composer. They are dismissed
    // here rather than worked around later.
    try {
      await new Notification().dismissAll();
    } catch {
      // No notification helper available: the settings already stop
      // recommendations from appearing, so this is belt and braces only.
    }
    await driver.sleep(500);

    field = new Field(driver, new WebView(), { runsDir: RUNS, shotsDir: SHOTS });
    await field.enter();

    // Canary: one trivial run must reach the scripted model. If this fails,
    // nothing below is measuring Plato — it is measuring a misconfigured
    // harness, and it should say so immediately instead of nine times.
    await setScript([{ text: 'ready' }]);
    const marker = await field.send('harness check: reply with one word');
    const events = await field.waitRunEnd(marker, { tag: 'canary', timeoutMs: 90000 });
    const log = await stubLog();
    if (log.log.filter((r) => r.toolsOffered > 0).length === 0) {
      throw new Error('the scripted model was never called — the run is not reaching a provider (key? connection?)');
    }
    if (events.some((e) => e.type === 'run-failed')) {
      throw new Error('canary run failed: ' + JSON.stringify(events.find((e) => e.type === 'run-failed')));
    }
    console.log('  canary ok — the scripted model was reached');
  });

  after(async () => {
    console.log(`\nshots: ${SHOTS}`);
  });

  for (const c of selected) {
    it(`case ${c.n} — ${c.title}`, async () => {
      // One chat per case: cases 4 and 8 deliberately continue the same
      // conversation across their runs, which is what the field-test page asks
      // for ("in plan, then in edit"; "after a run that went on a while").
      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];
      const notes = [];

      for (const [i, run] of c.runs.entries()) {
        const label = c.runs.length > 1 ? `case-${c.n}-run${i + 1}-${run.mode}` : `case-${c.n}-${run.mode}`;
        await setScript(run.steps);
        await field.setMode(run.mode);

        const before = await field.send(run.prompt);
        const events = await field.waitRunEnd(before, {
          plan: run.cards,
          tag: `case ${c.n} run ${i + 1}`,
          // `run.question`, NOT `c.question`. The key lives on the run object, and
          // reading it off the case made this whole handler `undefined` — so it was
          // never passed, never fired, and the question card was never touched. Two
          // runs of selector-hunting followed from that one wrong property, and a
          // silent handler is indistinguishable from a card that never appeared.
          // D49as: case 10 presses Stop with the card on screen instead of
          // answering it. The two are exclusive — a case that cancels has no
          // answers to give, because the run is over.
          cancelOnQuestion: run.cancelOnQuestion === true,
          question: run.question ? async () => {
            // Test 6's own ask: pick two options, jump to another tab, come back,
            // and check the picks survived the round trip. Every outcome below is
            // a FAILURE when wrong, never a printed note — a note is precisely how
            // this case passed while clicking nothing at all.
            const first = await field.questionState();
            notes.push(`question card: tabs=${first.tabs} rows=${first.rows} boxes=${first.boxes} circles=${first.circles}`);
            if (first.boxes === 0) notes.push('TICKS: no multi-select (checkbox) question was asked, so the box path is untested');
            const clicked = await field.tickOptions(run.question.tickFirst);
            const ticked = await field.checkedLabels();
            if (clicked === 0 || ticked.length === 0) {
              notes.push(`TICKS: picking options selected nothing (clicked ${clicked}, selected ${ticked.length})`);
            }
            await field.goToTab(run.question.roundTripTab);
            await field.goToTab(0);
            const after = await field.checkedLabels();
            notes.push(`picks: ${ticked.length} before the tab round trip, ${after.length} after`);
            if (after.length !== ticked.length) {
              notes.push(`TICKS: the pick did not survive the round trip (${ticked.length} -> ${after.length})`);
            }
            await field.shot(`${label}-question`);
            // One pick per remaining question, then Submit — which refuses to
            // pretend it closed the card if the button is disabled.
            await field.answerAllQuestions({ picks: 1 });
          } : undefined,
        });

        await field.shot(label);
        const screen = await field.logText();

        // --- what the SCREEN says ------------------------------------------
        const cardsThisRun = field.cardsSeen.filter((x) => x.tag === `case ${c.n} run ${i + 1}`);
        const expectedCards = run.cards.length;
        const actualCards = cardsThisRun.length;
        if (actualCards !== expectedCards) {
          notes.push(`CARDS: expected ${expectedCards}, saw ${actualCards} (${cardsThisRun.map((x) => x.tool).join(', ') || 'none'})`);
        }
        if (run.question && !field.questionSeen) {
          // The check that had no teeth. Every assertion about the question card
          // used to live INSIDE the handler for it, so a card that was never
          // detected asserted nothing at all and the case still reported PASS.
          notes.push('QUESTION: no question card was ever detected, so nothing about it was exercised');
        }
        if (run.cards.length === 0 && /^Approve .+\?$/m.test(screen)) {
          notes.push('CARDS: an approval card is visible on screen when none was expected');
        }
        if (c.n === 5) {
          // The notice is DOM-only evidence: it never reaches the transcript.
          const noticed = /Session-approved future edits to .*DateHelper\.java/.test(screen);
          if (!noticed) notes.push('NOTICE: the session-approval notice for DateHelper.java was not on screen');
        }
        if (c.n === 7) {
          const plan = await field.planState();
          notes.push(`plan card: cards=${plan.cards} in_progress=${plan.inProgress} completed=${plan.completed} (in_progress across all cards=${plan.totalInProgress})`);
          if (plan.inProgress !== run.plan.inProgress) notes.push(`PLAN: expected ${run.plan.inProgress} step in progress, saw ${plan.inProgress}`);
        }
        if (c.n === 8) {
          for (const needle of ['DateHelper.java', 'SubmissionsViewModel.java']) {
            if (!screen.includes(needle)) notes.push(`LOG: the chat log does not mention ${needle}`);
          }
        }
        if (c.n === 10) {
          // D49as: three things a cancelled run must show, and the middle one is
          // the defect itself. "The run ended" was never in doubt — the transcript
          // check covers that. What the user sees must agree: the card must be
          // GONE, and the run must SAY it was cancelled. A run that stops in
          // silence leaves the user unsure the Stop took effect.
          const stillOpen = await field.questionOpen();
          if (!field.questionSeen) {
            notes.push('QUESTION: no question card was ever detected, so the cancel path was never exercised');
          }
          if (stillOpen) {
            notes.push('CANCEL: the question card is STILL on screen after the run was cancelled');
          }
          if (!/cancelled/i.test(screen)) {
            notes.push('CANCEL: the run does not say it was cancelled, so nothing tells the user the Stop worked');
          }
          notes.push(`cancel: card-dismissed=${!stillOpen} says-cancelled=${/cancelled/i.test(screen)}`);
        }
        if (run.expectOnDisk) {
          const p = join(DEMO_REPO, run.expectOnDisk.file);
          const body = readFileSync(p, 'utf8');
          if (!body.includes(run.expectOnDisk.contains)) {
            notes.push(`DISK: ${run.expectOnDisk.file} does not contain the expected change`);
          } else {
            notes.push(`disk: ${run.expectOnDisk.file} carries the change`);
          }
        }

        // --- what the MODEL was told ---------------------------------------
        if (run.expectModelTold) {
          const log = await stubLog();
          const told = log.log.some((r) =>
            (r.toolResults ?? []).some((t) => t.head.toLowerCase().includes(run.expectModelTold.toLowerCase())),
          );
          if (!told) notes.push(`MODEL: the refusal never reached the model (looked for "${run.expectModelTold}")`);
          else notes.push(`model was told: "${run.expectModelTold}"`);
        }

        // --- what the TRANSCRIPT says --------------------------------------
        if (run.expectZeroToolCalls) {
          // Case 8 declares this and nothing read it, so its whole point — that a
          // recap is answered from what the run already knows, not from re-reading
          // the files — was asserted nowhere. Same family as the question handler:
          // a declared expectation that no code consumed.
          const calls = events.filter((e) => e.type === 'tool-event').length;
          if (calls !== 0) {
            notes.push(`MEMORY: the recap run made ${calls} tool call(s), so it went back to the files instead of using what it knew`);
          } else {
            notes.push('memory: the recap cost no tool calls');
          }
        }
        const v = verdict(c.n, events);
        for (const chk of v.checks) {
          if (!chk.ok) notes.push(`TRANSCRIPT: ${chk.name} [${chk.detail}]`);
        }

        const failures = notes.filter((n) => /^(CARDS|QUESTION|MEMORY|NOTICE|PLAN|LOG|DISK|TRANSCRIPT|TICKS|CANCEL):/.test(n));
        console.log(`  case ${c.n} run ${i + 1} (${run.mode}): ${chk(v)} transcript, ${actualCards} card(s)`);
        for (const n of notes) console.log(`    ${n}`);
        if (failures.length > 0) {
          throw new Error(`case ${c.n} run ${i + 1}: ${failures.join(' | ')}`);
        }
      }
    });
  }
});

function chk(v) {
  return v.ok ? 'PASS' : 'FAIL';
}
