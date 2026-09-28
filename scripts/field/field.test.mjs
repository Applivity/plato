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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * D49ax: the files case 18 creates. Polled rather than slept on — the host
 * answers a slash command synchronously, but the webview repaints on its own
 * schedule, and a fixed sleep is how a harness starts failing on a slow machine.
 */
async function waitForUndo(field, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await field.undoOpen()) return true;
    await field.driver.sleep(200);
  }
  return false;
}

async function waitForUndoSettled(field, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await field.undoOpen())) return true;
    await field.driver.sleep(200);
  }
  return false;
}

/**
 * The undo probe files, removed whatever happened. They are created by THIS
 * harness in the demo repo, so leaving them behind would be the harness
 * dirtying the workspace it is supposed to be observing — and one of them is
 * meant to be deleted by the feature under test, which is exactly the case a
 * failed run would leave lying around.
 */
function clearUndoProbes() {
  for (const name of ['PLATO_UNDO_A.txt', 'PLATO_UNDO_B.txt']) {
    try {
      rmSync(join(DEMO_REPO, name), { force: true });
    } catch {
      /* not there, which is the normal case */
    }
  }
}

/**
 * Every run this spec performs, in order, with the transcript it wrote.
 *
 * D49at: this is the join between the seven acceptance clauses and the fourteen
 * cases that witness them. A transcript records its task and its root, never
 * which case produced it, so a judge over the transcripts alone cannot tell
 * whether clause 6's case ran at all.
 */
const MANIFEST = [];
const MANIFEST_PATH = join(import.meta.dirname, '..', '..', 'tmp', 'field', 'last-manifest.json');
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
        // D49at clause 4: set orchestration EXPLICITLY before every run, not only
        // for the case that needs Duo. The chip is sticky, so a case that left it
        // on duo would quietly turn every later case into a team run — and a
        // run asserted to be solo with a philosopher in it is a case that no
        // longer measures what it says.
        await field.setOrchestration(run.orchestration ?? 'solo');

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
          // D49aw: case 12 presses Stop on the "repeating itself" card. A stuck
          // card with no answer parks the run, so it is always dealt with here —
          // declared or not.
          stuckStop: run.stuckStop === true,
          // D49aw: case 13 answers the card with "keep going" AND guidance —
          // the path a person reaches for first, which no real window had
          // exercised.
          stuckGuidance: run.stuckGuidance ?? '',
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
        if (c.n === 12) {
          // D49aw. The card must have appeared at all — without this check the
          // case passes on a build with no bound, because the script's last step
          // ends the run normally and every other assertion holds. That is the
          // same shape of toothless check case 10 was fixed for.
          if (!field.stuckSeen) {
            notes.push('STUCK: no stuck card was ever detected, so the bound was never exercised');
          }
          const stillOpen = await field.stuckOpen();
          // "Open" means still waiting for an answer. The answered card stays as
          // the record of what was asked, so this asks the question that matters:
          // is anything on screen still demanding a reply?
          if (stillOpen) {
            notes.push('STUCK: the card is still WAITING FOR AN ANSWER after the run ended');
          }
          // What the user is told, and the founder's requirement is the middle
          // one: a card that explains the problem but not the way out is a dead
          // end. These read the REAL copy, which no other suite does — core pins
          // the wording and the render suite renders a fixture, so this is the
          // only place the two are proved to meet.
          if (!/stuck/i.test(screen)) {
            notes.push('STUCK: the run never says Plato was stuck, so nothing explains the stop');
          }
          if (!/the same step/.test(screen)) {
            notes.push('STUCK: the card/notice does not name which call was repeating');
          }
          if (!/Tell Plato what to do instead/.test(screen)) {
            notes.push('STUCK: the card does not tell the user what they can do about it');
          }
          if (!/Nothing was lost/.test(screen)) {
            notes.push('STUCK: the closing line does not tell the user anything is recoverable');
          }
          // `awaiting-answer`, NOT "dismissed": the answered card deliberately
          // STAYS on screen as the record of what was asked, exactly as an
          // approval card does. Calling that "dismissed" would print true while
          // the card is plainly visible in the screenshot — the kind of label
          // that reads as success and hides the thing it names.
          notes.push(`stuck: card-seen=${field.stuckSeen} awaiting-answer=${stillOpen} names-the-call=${/the same step/.test(screen)} says-what-to-do=${/Tell Plato what to do instead/.test(screen)}`);
        }
        if (c.n === 13) {
          // D49aw: the run was NOT stopped. The card appeared, the user said
          // keep going with a reason, and the run finished normally.
          if (!field.stuckSeen) {
            notes.push('STUCK: no stuck card was ever detected, so "keep going" was never exercised');
          }
          const stillOpen = await field.stuckOpen();
          if (stillOpen) {
            notes.push('STUCK: the card is still WAITING FOR AN ANSWER after the run ended');
          }
          // The user's own words must reach Plato — and the chat is where the
          // user checks that they did.
          if (!screen.includes('That step is already recorded')) {
            notes.push('GUIDANCE: what the user typed into the card never reached the conversation');
          }
          notes.push(`keep-going: card-seen=${field.stuckSeen} awaiting-answer=${stillOpen} guidance-in-log=${screen.includes('That step is already recorded')}`);
        }
        if (c.n === 14) {
          // D49aw: the second trigger. The calls all differ, so repetition
          // detection CANNOT fire here — if the card appears, it is because
          // turns that all fail are counted.
          if (!field.stuckSeen) {
            notes.push('STUCK: no card appeared for five turns of failures, so the no-progress trigger never fired');
          }
          const stillOpen = await field.stuckOpen();
          if (stillOpen) {
            notes.push('STUCK: the card is still WAITING FOR AN ANSWER after the run ended');
          }
          if (!/turns in a row/i.test(screen)) {
            notes.push('STUCK: the run does not say turns in a row failed, so nothing explains the stop');
          }
          if (!/Tell Plato what to do instead/.test(screen)) {
            notes.push('STUCK: the card does not tell the user what they can do about it');
          }
          notes.push(`no-progress: card-seen=${field.stuckSeen} awaiting-answer=${stillOpen} turns-named=${/turns in a row/i.test(screen)}`);
        }
        if (c.n === 11) {
          // D49av. Two assertions and one report, and the split is deliberate.
          //
          // ASSERTED, because it is about Plato and holds in every window: the
          // host asked the editor and wrote down one of the three known answers.
          // Silence here is the fault the whole design is against — an absent
          // report would mean nobody could tell "nothing is wrong" from "nobody
          // looked".
          const notices = events
            .filter((e) => e.type === 'notice')
            .map((e) => String(e.text ?? ''));
          const said = notices.find((t) => t.startsWith('diagnostics:'));
          if (said === undefined) {
            notes.push('DIAGNOSTICS: the host never recorded what the editor thought of the file it wrote');
          } else if (!/^diagnostics: (\d+ new error|none new|not checked)/.test(said)) {
            notes.push(`DIAGNOSTICS: the report is not one of the three known states: ${said}`);
          } else {
            notes.push(`editor said: ${said}`);
          }
          // ASSERTED ONLY WHERE IT CAN BE. If the editor reported an error, it
          // must have reached the model — that is the feature. Demanding it in a
          // window that publishes no diagnostics would assert the environment
          // rather than Plato, and would leave a case that fails forever for a
          // reason that is not a defect.
          const reported = said !== undefined && /^diagnostics: \d+ new error/.test(said);
          if (reported) {
            const log = await stubLog();
            const told = log.log.some((r) =>
              (r.toolResults ?? []).some((t) =>
                String(t.head ?? '').includes('The editor reports'),
              ),
            );
            if (!told) {
              notes.push('DIAGNOSTICS: the editor reported errors and they never reached the model');
            } else {
              notes.push('model was told what the editor reported');
            }
          } else {
            // REPORTED, not asserted — see the README's note on this window.
            notes.push('note: this window published no diagnostics, so the model told nothing (not a pass, not a failure)');
          }
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

        // --- D49ax: what /undo does, driven the way a person drives it ------
        //
        // Failures here are FATAL (`UNDO:` is in the prefix list below), because
        // every one of them is a claim the feature is built on: that a copy was
        // taken, that the card names the files, and that the bytes come back.
        for (const check of run.undoAfter ?? []) {
          await field.send('/undo');
          const offered = await waitForUndo(field, 20000);
          if (!offered) {
            notes.push('UNDO: /undo offered nothing, so nothing could be put back');
            continue;
          }
          const cardText = await field.undoText();
          notes.push(`undo card: ${cardText.replace(/\s+/g, ' ').slice(0, 140)}`);
          if (check.names && !cardText.includes(check.names)) {
            notes.push(`UNDO: the card did not name ${check.names}`);
          }
          await field.answerUndo('confirm');
          const settled = await waitForUndoSettled(field, 20000);
          if (!settled) notes.push('UNDO: the card stayed open after the click, so the answer was not taken');
          if (check.gone) {
            if (existsSync(join(DEMO_REPO, check.gone))) {
              notes.push(`UNDO: ${check.gone} is still on disk — a created file was not removed`);
            } else {
              notes.push(`undo: ${check.gone} was removed`);
            }
          }
          for (const [file, want] of Object.entries(check.text ?? {})) {
            const got = existsSync(join(DEMO_REPO, file))
              ? readFileSync(join(DEMO_REPO, file), 'utf8')
              : '(missing)';
            if (got !== want) {
              notes.push(`UNDO: ${file} came back as ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
            } else {
              notes.push(`undo: ${file} came back byte for byte`);
            }
          }
        }

        // --- what the MODEL was told ---------------------------------------
        if (run.expectModelTold) {
          const log = await stubLog();
          const told = log.log.some((r) =>
            (r.toolResults ?? []).some((t) => t.head.toLowerCase().includes(run.expectModelTold.toLowerCase())),
          );
          if (!told) notes.push(`MODEL: the expected text never reached the model (looked for "${run.expectModelTold}")`);
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

        // D49at: the acceptance clauses that are witnessed on SCREEN rather than
        // in the transcript. Each names its clause so a failure reads as a failed
        // clause rather than a mysterious note.
        if (c.n === 15) {
          // Clause 6: the card must carry the EXACT url, because the URL is what
          // leaves the machine. The card stays on screen after the denial with
          // its preview intact, so this is readable after the run.
          const shown = /example\.com\/acceptance-check/.test(screen);
          if (!shown) notes.push('FETCH: the approval card did not show the exact URL that would be sent');
          notes.push(`fetch: url-on-card=${shown} cards=${actualCards}`);
        }
        if (c.n === 16) {
          // Clause 4: the observer path RAN and its work is REPORTED. NOT that it
          // intervened — a philosopher who correctly stays quiet must pass.
          const reported = /observer \d+ checks/.test(screen);
          if (!reported) {
            notes.push('OBSERVER: the closing line does not report the observer, so its liveness is not visible');
          }
          notes.push(`observer: reported=${reported}`);
        }
        if (c.n === 17) {
          // Clause 5: a run that ends mid-plan must say so. A run that reported
          // only "done" here is the fault this exists for.
          const says = /2 of 3 plan steps unfinished/.test(screen);
          if (!says) {
            notes.push('PLANNOTE: the run ended with 2 of 3 plan steps unfinished and did not say so');
          }
          notes.push(`plannote: says-unfinished=${says}`);
        }

        // D49at: `STUCK`, `GUIDANCE` and the clause prefixes above are FATAL. The
        // stuck cases' screen checks were written as notes and were NOT in this
        // list, so "no stuck card was ever detected" — the check that gives cases
        // 12-14 their teeth — could not fail the case. Found while wiring the
        // acceptance clauses; a note is not a check.
        const failures = notes.filter((n) =>
          /^(CARDS|QUESTION|MEMORY|NOTICE|PLAN|PLANNOTE|LOG|DISK|TRANSCRIPT|TICKS|CANCEL|DIAGNOSTICS|STUCK|GUIDANCE|FETCH|OBSERVER|UNDO):/.test(n),
        );
        console.log(`  case ${c.n} run ${i + 1} (${run.mode}): ${chk(v)} transcript, ${actualCards} card(s)`);
        for (const n of notes) console.log(`    ${n}`);
        // D49at: the manifest is what turns a pile of cases into an executable
        // acceptance test. Without it a run of fourteen cases cannot be mapped
        // back to the seven clauses, because a transcript records its TASK and
        // its root but not which case produced it — so `acceptance.mjs` had
        // nothing to join on. Written per RUN, so a clause witnessed by one run
        // of a two-run case can name it.
        MANIFEST.push({
          case: c.n,
          run: i + 1,
          mode: run.mode,
          orchestration: run.orchestration ?? 'solo',
          title: c.title,
          transcript: field.lastTranscript,
          transcriptOk: v.ok,
          screenFailures: failures,
        });
        if (failures.length > 0) {
          throw new Error(`case ${c.n} run ${i + 1}: ${failures.join(' | ')}`);
        }
      }
    });
  }

  /**
   * D49at: the manifest is written even when a case FAILS — mocha runs `after`
   * either way — so a failing acceptance run still reports which clauses passed
   * and which did not, rather than reporting nothing at all.
   */
  after(() => {
    // D49ax: case 18 creates probe files in the demo repo. Cleared HERE rather
    // than at the end of the case, so a case that fails half way through still
    // leaves the workspace as it found it.
    clearUndoProbes();
    mkdirSync(join(import.meta.dirname, '..', '..', 'tmp', 'field'), { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({ at: new Date().toISOString(), runs: MANIFEST }, null, 2),
    );
    console.log(`\nmanifest: ${MANIFEST.length} run(s) → ${MANIFEST_PATH}`);
  });
});

function chk(v) {
  return v.ok ? 'PASS' : 'FAIL';
}
