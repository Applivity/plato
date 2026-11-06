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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { By, Key } from 'selenium-webdriver';
import {
  VSBrowser,
  WebView,
  Workbench,
  Notification,
  BottomBarPanel,
  EditorView,
} from 'vscode-extension-tester';

import { CASES, DEMO_REPO, MODE_PROBE } from './cases.mjs';
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
  for (const name of [
    'PLATO_UNDO_A.txt',
    'PLATO_UNDO_B.txt',
    'PLATO_UNDO_C.txt',
    'PLATO_UNDO_D.txt',
    'PLATO_UNDO_E.txt',
    '.env.plato-probe',
  ]) {
    try {
      rmSync(join(DEMO_REPO, name), { force: true });
    } catch {
      /* not there, which is the normal case */
    }
  }
}

/**
 * D49bt: MCP config lives in the founder's REAL home (`~/.plato`), because the
 * harness runs against a real VS Code and `homePlatoDir()` is `os.homedir()`.
 * A case that seeds it would otherwise overwrite the founder's own servers —
 * and, worse, leave them in place, turning every LATER case in the suite into a
 * run with MCP servers attached. So it is backed up once for the whole suite and
 * restored in `after`, which mocha runs even when a case fails.
 */
const HOME_MCP = join(homedir(), '.plato', 'mcp.json');
const HOME_MCP_BAK = HOME_MCP + '.plato-field-backup';
/** D49bt: the schema Plato writes beside the config. */
const HOME_MP = join(homedir(), '.plato', 'mcp.schema.json');

function backupHomeMcp() {
  try {
    if (existsSync(HOME_MCP)) {
      renameSync(HOME_MCP, HOME_MCP_BAK);
      console.log('  ~/.plato/mcp.json backed up for the suite');
    }
  } catch (e) {
    throw new Error(`could not back up ${HOME_MCP}: ${e.message}`);
  }
}

function restoreHomeMcp() {
  try {
    rmSync(HOME_MCP, { force: true });
    // D49bt: the probe has the product create this one, so it is the harness's
    // to clear as well — the founder's home must hold what it held before.
    rmSync(join(homedir(), '.plato', 'mcp.schema.json'), { force: true });
    if (existsSync(HOME_MCP_BAK)) {
      renameSync(HOME_MCP_BAK, HOME_MCP);
    }
  } catch {
    /* nothing to put back */
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
/**
 * The harness profile's USER settings file — the one VS Code's Settings editor
 * writes and `ConfigurationTarget.Global` updates. D49bz reads it to prove the
 * panel switch and the editor's checkbox are one value, not two copies.
 */
const USER_SETTINGS = join(
  import.meta.dirname,
  '..',
  '..',
  'tmp',
  'field',
  'storage',
  'settings',
  'User',
  'settings.json',
);

const MANIFEST = [];
const MANIFEST_PATH = join(import.meta.dirname, '..', '..', 'tmp', 'field', 'last-manifest.json');
const RUNS = runsDirFor(DEMO_REPO);
const only = (process.env['FIELD_CASES'] ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const selected = only.length > 0 ? CASES.filter((c) => only.includes(c.n)) : CASES;

/**
 * Sets the scripted model's next replies.
 *
 * D49bo: `modelsDelayMs` deliberately stalls the provider's model-discovery call,
 * which the host makes while PREPARING a run — before it is `running` and before
 * its controls mean anything. Without a stall the window is milliseconds wide and
 * a race inside it can only be hit by luck; with one, a case can walk into it on
 * purpose. See case 26.
 */
async function setScript(steps, needles = [], modelsDelayMs = 0) {
  const res = await fetch(`${STUB}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // titleMode 'prompt' gives each conversation a title taken from its own
    // prompt, so two open chat tabs are distinguishable in the workbench.
    body: JSON.stringify({ steps, needles, modelsDelayMs, titleMode: 'prompt' }),
  });
  if (!res.ok) throw new Error(`stub refused the script: ${res.status}`);
}

/** What the model was actually asked — the harness's second witness. */
async function stubLog() {
  return (await fetch(`${STUB}/__log`)).json();
}

/**
 * Waits for a live session named `name` in THIS workspace's registry.
 *
 * The chat's title is generated after the run, so the name it is addressable by
 * is not knowable at send time — it is waited for rather than guessed at. The
 * `cwd` filter keeps a founder's own open window out of the answer.
 */
async function waitForLiveEntry(name, timeoutMs = 20000) {
  const dir = join(homedir(), '.plato', 'live');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const e = JSON.parse(readFileSync(join(dir, f), 'utf8'));
          if (e.name === name && e.cwd === DEMO_REPO) return e;
        } catch {
          /* mid-write */
        }
      }
    } catch {
      /* no registry yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/**
 * D49ca: waits until a tool result the model has been shown contains `needle`.
 *
 * A mid-run switch must be sequenced AFTER the refusal reached the model, and
 * the transcript cannot be read until the run ends. The stub's log is the only
 * witness available while the run is still going.
 */
async function waitForModelToolResult(driver, needle, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const log = await stubLog();
      const seen = (log.log ?? []).some((entry) =>
        (entry.toolResults ?? []).some((r) => String(r.head ?? '').includes(needle)),
      );
      if (seen) return true;
    } catch {
      // The stub may still be starting; keep waiting for the caller's clock.
    }
    await driver.sleep(200);
  }
  return false;
}

/**
 * The heads of every tool result the model received, for a failing MODEL check.
 *
 * Truncated again and quoted, because this text goes into a console line — and
 * the heads are already masked or refusals by construction. Reading a red check
 * is the only thing this exists for.
 */
function headsSeen(log) {
  const heads = [];
  for (const r of log.log ?? []) {
    for (const t of r.toolResults ?? []) {
      const h = String(t.head ?? '').replace(/\s+/g, ' ').trim();
      if (h.length > 0) heads.push(JSON.stringify(h.slice(0, 80)));
    }
  }
  return heads.length === 0 ? 'no tool results at all' : heads.slice(-3).join(' | ');
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
  // Wait for a VISIBLE key box. The palette can close and reopen between the
  // picker and the prompt, and an element located in the gap is not
  // interactable — the failure seen as "element not interactable" on a fresh
  // browser, which told the case nothing about Plato.
  const deadline = Date.now() + 20000;
  let input = null;
  while (input === null && Date.now() < deadline) {
    const boxes = await driver.findElements(By.css('.quick-input-box input'));
    for (const box of boxes) {
      if (await box.isDisplayed().catch(() => false)) {
        input = box;
        break;
      }
    }
    if (input === null) await driver.sleep(200);
  }
  if (input === null) throw new Error('the API key prompt never appeared');
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
    // D49bt: taken before anything runs, so the founder's own mcp.json survives
    // a case that seeds one — including a case that fails half way through.
    backupHomeMcp();
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
      // D49ca: cases 34 and 35 prove that a write was admitted or refused, so
      // their probe starts ABSENT rather than inheriting a previous run's file.
      // Case 36 also writes the probe, and `write_file` refuses to replace an
      // existing file without `overwrite: true`. Leaving 34/35's copy behind
      // makes 36 fail for a reason that has nothing to do with its subject.
      if (c.n === 34 || c.n === 35 || c.n === 36) {
        rmSync(join(DEMO_REPO, MODE_PROBE), { force: true });
      }

      for (const [i, run] of c.runs.entries()) {
        const label = c.runs.length > 1 ? `case-${c.n}-run${i + 1}-${run.mode}` : `case-${c.n}-${run.mode}`;
        // `notes` belongs to the CASE — several checks are about the case as a
        // whole — but each run prints its own. Without this mark, run 2 reprints
        // run 1's notes and it reads as though run 2 failed twice. It cost a
        // misdiagnosis: a note saying "model was told: refused" appearing under
        // the masked-read run looked like the wrong case definition had loaded.
        const mark = notes.length;
        await setScript(run.steps, [], run.modelsDelayMs ?? 0);
        await field.setMode(run.mode);
        // D49ca: the picker changed the mode and nothing has been sent. If the
        // product ever resumes a run on the click alone, this is where it shows —
        // and the case says so rather than leaving the behaviour unrecorded.
        if (run.afterModeSwitch === 'noResume') {
          const before = new Set(field.transcripts());
          await field.driver.sleep(2500);
          const fresh = field.transcripts().filter((f) => !before.has(f));
          notes.push(
            fresh.length === 0
              ? 'idle switch: no run started by itself'
              : `MODE: the switch alone started ${fresh.length} run(s) with no message`,
          );
        }
        // D49at clause 4: set orchestration EXPLICITLY before every run, not only
        // for the case that needs Duo. The chip is sticky, so a case that left it
        // on duo would quietly turn every later case into a team run — and a
        // run asserted to be solo with a philosopher in it is a case that no
        // longer measures what it says.
        await field.setOrchestration(run.orchestration ?? 'solo');

        // D49bz: the switch has two doors and they share one value. The case
        // drives BOTH, in that order of importance: Plato's own settings page is
        // where a user looks, and VS Code's Settings editor is the other door.
        // Either runs BEFORE the send, because the run reads the value when it
        // starts.
        if (run.panelToggle !== undefined) {
          const after = await field.setRespectGitignore(run.panelToggle);
          if (after !== run.panelToggle) {
            notes.push(
              `IGNORE: Plato's panel switch did not take — it reads ${after} after clicking for ${run.panelToggle}`,
            );
          } else {
            notes.push(`panel switch: set to ${after} from Plato's settings page`);
          }
          // The panel and the Settings editor must be one value, not two. The
          // harness profile's user settings file is what BOTH write to, so this
          // is the join.
          const stored = readFileSync(USER_SETTINGS, 'utf8');
          const storedValue = JSON.parse(stored)?.['plato.search.respectGitignore'];
          if (storedValue !== run.panelToggle) {
            notes.push(
              `IGNORE: Plato's panel switch did not reach plato.search.respectGitignore (found ${JSON.stringify(storedValue)})`,
            );
          } else {
            notes.push('panel switch: the VS Code setting holds the same value');
          }
          // The hint is read on screen, because the copy is what a user meets.
          await field.shotSettingsHint();
        }

        // D49bb: files the HARNESS owns, written from outside Plato before the
        // run starts. A protected file has to exist before the model can ask for
        // it, and the harness writing it is also what keeps a real secret out of
        // the test: the value here is deliberately fake.
        for (const [file, content] of Object.entries(run.seed ?? {})) {
          writeFileSync(join(DEMO_REPO, file), content);
          notes.push(`seeded ${file}`);
        }
        // D49bt: ~/.plato config for the run under test. Removed immediately
        // after this run — an MCP config left in place would attach servers to
        // every case that follows, so a later case would be measuring a run the
        // case before it configured.
        for (const [file, content] of Object.entries(run.seedHome ?? {})) {
          mkdirSync(join(homedir(), '.plato'), { recursive: true });
          writeFileSync(join(homedir(), '.plato', file), content);
          notes.push(`seeded ~/.plato/${file}`);
        }

        // D49bt: the chat log persists across the runs of a case, so the plan
        // half is judged on what IT added. Matching the whole log found the
        // previous run's notices and reported a server that never started.
        const logBefore =
          (c.n === 29 && run.mode === 'plan') || c.n === 32 ? await field.logText() : '';
        // D49bz: the stub's log accumulates across runs, so the model-side half
        // of case 32 has to be read as a DELTA. `expectModelTold` reads the whole
        // log and cannot answer "what did THIS run tell the model".
        const modelLogBefore = c.n === 32 ? (await stubLog()).log.length : 0;
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
          // D49bc: the protected file Plato cannot mask. A case that expects the
          // card declares how the user answers it; a case that does not gets the
          // safe answer so the run can finish.
          revealAnswer: run.revealAnswer,
          // D49cb: the model's mode request card, answered like every other
          // parked card. Undeclared, the driver stays — the safe answer.
          modeAnswers: run.modeAnswers,
          // D49bm/D49bo: the ONE moment a case acts on a run that is still in
          // flight — clicking Pause, queueing a follow-up, closing the panel.
          // The scripts live here rather than in `cases.mjs` because this is
          // where `field`, `notes` and the transcript baseline are.
          during: run.during === undefined ? undefined : async () => {
            if (run.during === 'pause') {
              const started = await field.waitForRunStart();
              notes.push(`pause: the control is up and says "${started.label}"`);
              const clicked = await field.pause();
              if (clicked.label !== 'Pausing…') {
                notes.push(`PAUSE: straight after the click the button claimed "${clicked.label}" — a request is not a pause`);
              }
              const parked = await field.waitForPauseLabel('Resume');
              if (parked.label !== 'Resume') {
                notes.push(`PAUSE: the run never parked — the button stayed at "${parked.label}"`);
              } else {
                notes.push('pause: the run parked, and only then did the button offer Resume');
              }
              const released = await field.pause();
              if (released.label !== 'Pause') {
                notes.push(`PAUSE: the release left the button reading "${released.label}"`);
              }
            } else if (run.during === 'pauseTooLate') {
              await field.waitForRunStart();
              const clicked = await field.pause();
              if (clicked.label !== 'Pausing…') {
                notes.push(`PAUSE: straight after the click the button claimed "${clicked.label}"`);
              }
              notes.push('pause-too-late: asked while the final answer was still being written');
            } else if (run.during === 'queueWhileBusy') {
              await field.waitForRunStart();
              await field.queueMessage('write the release notes');
              const q = await field.queueState();
              if (q.names.length === 0) {
                notes.push('QUEUE: the queued message was never shown, so nothing could be taken back');
              } else {
                notes.push(`queue: ${q.names.length} message waiting`);
              }
            } else if (run.during === 'queueThenCancel') {
              await field.waitForRunStart();
              await field.queueMessage('first follow-up');
              await field.queueMessage('second follow-up');
              const q = await field.queueState();
              notes.push(`queue: ${q.names.length} message(s) waiting before the cancel`);
              await field.cancel();
            } else if (run.during === 'switchModeAfterDenial') {
              // D49ca: the switch must happen AFTER the refusal reached the
              // model. The stub's next step is held for four seconds, which is
              // the window this lives in. Reading the stub's log is the only
              // witness available mid-run — the transcript appears only on disk
              // and its ending has not been written yet.
              await field.waitForRunStart();
              const refused = await waitForModelToolResult(
                field.driver,
                'not permitted in plan mode',
                20000,
              );
              notes.push(
                refused
                  ? 'mid-run switch: the refusal reached the model before the switch'
                  : 'MODEL: the plan-mode refusal never reached the model, so the switch was not sequenced after it',
              );
              await field.setMode('edit');
            } else if (run.during === 'closePanel') {
              await field.waitForRunStart();
              await field.closeChat();
              // Wait for the run to END, which is the claim. The panel is NOT
              // reopened: the harness cannot find the iframe of a webview panel
              // it has closed, and a reopen that always failed would turn this
              // case into a harness story instead of a product one.
              const done = await field.waitForRunsDone(before, 1, 40000);
              notes.push(`panel close: ${done.done.length} run(s) ended after the tab was closed`);
              // Put the panel back so the NEXT case can start from a normal
              // window. Best effort by design: it exists for the cases after this
              // one, not for this case's assertions, which are already read.
              try {
                await field.reopenChat();
              } catch (e) {
                notes.push(`panel close: the chat could not be reopened for the following cases (${e.message})`);
              }
            }
          },
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
        // D49bn: case 29 CLOSES the chat panel, and once it is closed the
        // harness cannot step back inside a webview panel — a fresh one is
        // created but its iframe is never found, and that failure is the
        // harness's, not the product's. So that case is judged from the run
        // record, which is where its assertion has teeth: the falsification in
        // DECISIONS shows the case fails when the run is not stopped. Saying so
        // here is the point — quietly skipping the screen half would be exactly
        // the kind of silent gap this file exists to remove.
        const screen = run.during === 'closePanel' ? '' : await field.logText();

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
        // D49ba: asked of the DOM, not of the text. The screen scrape used to
        // match the card's sentence, which meant a copy change could report an
        // "unexpected card" for a card that was not there — or miss one that was.
        if (run.cards.length === 0 && (await field.openCard()) !== null) {
          notes.push('CARDS: an approval card is visible on screen when none was expected');
        }
        if (c.n === 5) {
          // The notice is DOM-only evidence: it never reaches the transcript.
          // The notice carries the FULL workspace-relative path, so the match
          // needs the gap — dropping it is how this assertion failed on a
          // notice that was on screen the whole time.
          const noticed = /Plato will not ask again before editing .*DateHelper\.java/.test(screen);
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
        // D49bm: the pause is only honest if the RECORD agrees with the button.
        // The button is checked live, in `during`; these check that the run kept
        // the same account, and that a pause which never landed is named rather
        // than swallowed.
        if (c.n === 24) {
          if (!screen.includes('Plato paused at a safe point.')) {
            notes.push('PAUSE: nothing on screen says the run stopped, so the pause left no record');
          }
          if (!screen.includes('Plato resumed.')) {
            notes.push('PAUSE: nothing on screen says the run continued, so a paused run cannot be told from a stopped one');
          }
          if (!events.some((e) => e.type === 'notice' && /paused at a safe point/.test(e.text ?? ''))) {
            notes.push('PAUSE: the transcript has no record of the park, so the run cannot be read back');
          }
          notes.push(`pause: recorded=${events.filter((e) => e.type === 'notice' && /paus/i.test(e.text ?? '')).length} notice(s)`);
        }
        if (c.n === 25) {
          if (screen.includes('Plato paused at a safe point.')) {
            notes.push('PAUSE: the run claims it paused, but it never reached a safe point to pause at');
          }
          if (!screen.includes('The run finished before the pause took effect.')) {
            notes.push('PAUSE: the pause was asked for and never landed, and nothing says so — this is the silence the case exists to stop');
          }
          notes.push('pause-too-late: reported');
        }
        // D49bo: the queue advancing by itself, and — the sharper half — NOT
        // advancing when the run before it was cancelled.
        if (c.n === 26 || c.n === 27) {
          const runs = await field.waitForRunsDone(before, run.expectRuns, 60000);
          if (runs.done.length !== run.expectRuns) {
            notes.push(`QUEUE: expected ${run.expectRuns} finished run(s), saw ${runs.done.length}`);
          }
          const q = await field.queueState();
          if (c.n === 26) {
            const ordered = runs.done.slice().sort();
            const second = ordered[ordered.length - 1];
            const text = second === undefined ? '' : readFileSync(second, 'utf8');
            if (!text.includes('write the release notes')) {
              notes.push('QUEUE: the second run did not carry the queued message as its task');
            } else {
              notes.push('queue: the queued message became the next run, with nobody pressing anything');
            }
            // D49bo: the claim is that the queue hands over when the run before
            // it has FINISHED, so that is what is checked — and the first version
            // of this assertion did not check it. It compared the two headers'
            // `startedAt` stamps, which is a COIN FLIP under the very defect it
            // exists for: that stamp is written when a run REACHES THE WIRE, after
            // the host has prepared it, so two runs started into one preparation
            // window stamp in either order. It passed against the broken build.
            //
            // The fact the claim is about is when the first run STOPPED, and the
            // only witness to that is the transcript file's own last write. Two
            // runs sharing one controller, one webview and one runs directory are
            // the defect; overlap is the symptom, and this reads overlap directly.
            const startedAtOf = (f) => {
              if (f === undefined) return null;
              for (const line of readFileSync(f, 'utf8').split('\n')) {
                if (!line.trim()) continue;
                try {
                  const e = JSON.parse(line);
                  if (e.kind === 'header') return e.startedAt;
                } catch {
                  // A partial last line is not a header.
                }
              }
              return null;
            };
            const firstEndedAt = ordered[0] === undefined ? null : statSync(ordered[0]).mtimeMs;
            const secondStartedAt = startedAtOf(second);
            if (firstEndedAt !== null && secondStartedAt !== null
              && Date.parse(secondStartedAt) <= firstEndedAt) {
              notes.push(`QUEUE: the queued run began BEFORE the run it was queued behind had finished — two runs overlapped (queued started ${secondStartedAt}, the first run's last write ${new Date(firstEndedAt).toISOString()})`);
            } else {
              notes.push('queue: the queued run began only after the run before it had finished');
            }
            if (q.names.length !== 0) {
              notes.push(`QUEUE: the queue still shows ${q.names.length} message(s) after it was sent`);
            }
          } else {
            if (q.names.length !== 2) {
              notes.push(`QUEUE: a cancelled run should leave both messages waiting, saw ${q.names.length}`);
            }
            if (!q.start) {
              notes.push('QUEUE: the queue is held but offers no way to continue it');
            }
            if (!/cancelled/i.test(screen)) {
              notes.push('CANCEL: the run does not say it was cancelled');
            }
            notes.push('queue: held after the cancel, with a way to continue');
          }
        }
        // D49bn: closing the panel stops the run, and says why. Judged from the
        // record alone — see the note where `screen` is read — and the record is
        // the right witness here for a second reason: the same bus notice is what
        // puts the row in the chat log, so the transcript proves the row was
        // written even though this case cannot look at the panel it was written in.
        // D49bt: the MCP path. Two witnesses, because the two claims have
        // different homes.
        //
        // The tool SURFACE is read from the stub's own record of what it was
        // offered — nothing else can show that a disabled server contributed
        // nothing, and "it was not called" would pass a run in which it was
        // offered and simply not chosen.
        //
        // The START notices are looked for on the SCREEN. Servers start while the
        // run is being prepared, before `run-started`, and the transcript writer
        // drops a notice that arrives before the record it would land in exists
        // (the rule D49bn records). So the transcript cannot witness them, and it
        // is not worth restructuring the product to make a test easier.
        if (c.n === 29 && run.mode === 'plan') {
          // D49bt: `plan` denies every MCP tool, so the servers are not started
          // — no tool offered, and nothing said about them in the chat. The
          // absence is the claim: were the start loop still running, `fake`
          // would be offered and announced exactly as it is in `edit`.
          const offered = new Set(
            (await stubLog()).log
              .filter((r) => r.toolsOffered > 0)
              .flatMap((r) => r.toolNames ?? []),
          );
          if ([...offered].some((t) => /^mcp__/.test(t))) {
            notes.push(`MCP: a plan run was offered MCP tools (${[...offered].filter((t) => /^mcp__/.test(t)).join(', ')}) — plan denies every one of them, so the servers should not have started`);
          } else {
            notes.push('mcp: a plan run offered no MCP tools — the servers were not started');
          }
          const countMcp = (t) => (t.match(/MCP (fake|off)\b/g) || []).length;
          const added = countMcp(await field.logText()) - countMcp(logBefore);
          if (added !== 0) {
            notes.push(`MCP: a plan run added ${added} MCP server line(s) to the chat, so a server was started after all`);
          } else {
            notes.push('mcp: a plan run said nothing about MCP servers');
          }
        }
        if (c.n === 29 && i === 0) {
          const records = (await stubLog()).log.filter((r) => r.toolsOffered > 0);
          const offered = new Set(records.flatMap((r) => r.toolNames ?? []));
          if (!offered.has('mcp__fake__echo')) {
            notes.push('mcp: the configured server’s tool was never offered to the model');
          } else {
            notes.push('mcp: the configured server’s tool was on the model’s tool surface');
          }
          if (offered.has('mcp__off__echo')) {
            notes.push('MCP: a DISABLED server’s tool was offered — disabled must contribute nothing at all');
          } else {
            notes.push('mcp: the disabled server’s tool was absent from the surface');
          }
          const log = await field.logText();
          if (!/MCP fake: \d+ tools? available/.test(log)) {
            notes.push('MCP: the chat never said the server was up, or what it offers');
          } else {
            notes.push('mcp: the chat named the server and its tool count');
          }
          if (/MCP off\b/.test(log)) {
            notes.push('MCP: a disabled server announced itself on screen');
          }

          // D49bt: and the Settings page in a REAL window — the one place
          // `mcpStatus()` runs. Opening it by clicking the gear is the point: the
          // render suite feeds the view a payload it is HANDED, so no render
          // assertion can show that the host builds one. This is also the only
          // check anywhere that the previous run's outcome survives into the
          // panel, which is the whole of what the section claims to report.
          //
          // Closed again immediately, in every path: `body.show-settings` hides
          // the composer, so leaving it open would fail every case after this one
          // for a reason with nothing to do with the product.
          const opened = await field.openSettings();
          if (!opened) {
            notes.push('MCP: the Settings page never rendered its MCP section');
          } else {
            // Expanded BEFORE the read, so the screenshot shows the rows rather
            // than a header: a `<details>` keeps its children in the DOM while
            // collapsed, so a read alone would pass against a section no user
            // could see.
            //
            // And the shot is taken BEFORE the read, because reading a "?" opens
            // its tooltip and leaves it open — which covered the server names in
            // the first version of this screenshot. Evidence that hides the thing
            // it is evidence for is not evidence.
            await field.expandMcpSection();
            await field.shot('case-29-settings-mcp');
            const sec = await field.mcpSection();
            if (!sec) {
              notes.push('MCP: Settings opened but the section was not in the DOM');
            } else {
              if (!/2 configured/.test(sec.title)) {
                notes.push(`MCP: Settings headed the section "${sec.title}" — both configured servers should be listed`);
              } else {
                notes.push('mcp: Settings listed both configured servers');
              }
              const fake = sec.rows.find((r) => r.name === 'fake');
              const off = sec.rows.find((r) => r.name === 'off');
              if (!fake || fake.tag !== '1 tool') {
                notes.push(`MCP: the server that ran reads "${fake ? fake.tag : 'no row'}" — the last run's tool count did not reach the panel`);
              } else {
                notes.push('mcp: the panel carried the tool count the last run produced');
              }
              if (!off || off.tag !== 'disabled' || off.checked !== false) {
                notes.push(`MCP: the disabled server reads "${off ? off.tag : 'no row'}" with its switch ${off ? off.checked : 'missing'}`);
              } else {
                notes.push('mcp: the disabled server is listed, tagged, and switched off');
              }
            }
          }
          // D49bt: and "Open mcp.json" — the one control a user has for reaching
          // the file, and the path that creates it. The config is deleted first so
          // the press takes the CREATE branch, which is what writes the schema
          // beside it and puts the `$schema` line in the config.
          rmSync(HOME_MCP, { force: true });
          rmSync(HOME_MP, { force: true });
          await field.clickMcpOpen();
          await field.shot('case-29-schema-opened');

          await field.leave();
          try {
            // The status bar is the witness. The Problems view reported nothing
            // for a file that was visibly open with a squiggle and a "1" badge on
            // its tab, so reading it would have reported "no marker" for a file
            // VS Code was plainly flagging.
            const errorCount = async () => {
              const n = await driver.executeScript(`
                for (const el of document.querySelectorAll('[aria-label]')) {
                  const label = el.getAttribute('aria-label') || '';
                  if (/^Errors:/.test(label)) return label.replace(/[^0-9]/g, '');
                }
                return null;
              `);
              // No such item means NO errors: VS Code removes the status bar entry
              // at zero rather than showing "0". Reading that as null was the bug
              // that made an earlier version of this probe call a valid file broken.
              return n === null || n === '' ? 0 : Number(n);
            };
            const waitForCount = async (want, ms) => {
              const deadline = Date.now() + ms;
              for (;;) {
                if (await errorCount() === want) return true;
                if (Date.now() > deadline) return false;
                await driver.sleep(1000);
              }
            };
            const schemaStatus = async () => driver.executeScript(`
              for (const el of document.querySelectorAll('[aria-label]')) {
                const label = el.getAttribute('aria-label') || '';
                if (/schema/i.test(label)) return label.replace(/\s+/g, ' ').slice(0, 110);
              }
              return null;
            `);
            const write = (obj) => writeFileSync(
              HOME_MCP, JSON.stringify(obj, null, 2) + '\n',
            );
            // A BASELINE, because this count is WORKSPACE-WIDE. In a full-suite
            // run other cases have left deliberate errors in the demo repo, so the
            // count does not start at zero — an isolated run of this case reads 0
            // and the full suite read 3, which is what made this pass alone and
            // fail in the suite. Every check below is a DELTA from here.
            const base = await errorCount();

            // CONTROL — a JSON syntax error, which cannot depend on any schema. If
            // this is not seen, nothing below means anything: "no error" is the
            // answer this probe can produce wrongly.
            writeFileSync(HOME_MCP, '{ "mcpServers": { ');
            if (!(await waitForCount(base + 1, 25000))) {
              notes.push(`SCHEMA: the probe is blind — a JSON syntax error in the open ~/.plato/mcp.json never reached the status bar (baseline ${base}, read ${JSON.stringify(await errorCount())})`);
            } else {
              notes.push(`schema control: the editor reported the broken JSON (count rose by one from a baseline of ${base})`);

              // CONTROL 2 — valid and complete. Zero errors, proving the count
              // tracks THIS file and is not a stale number.
              write({ mcpServers: { probe: { command: 'node' } } });
              const clean = await waitForCount(base, 25000);
              if (!clean) {
                notes.push(`SCHEMA: a valid mcp.json did not return the count to its baseline of ${base} (read ${JSON.stringify(await errorCount())}), so it cannot be trusted to report the schema question`);
              } else {
                notes.push('schema control: valid JSON returned the count to its baseline — the count tracks this file');

                // THE SCHEMA QUESTION, and the answer is no — recorded, not
                // asserted, because the product no longer ships a schema for this
                // file. Three deliveries were measured and all three failed the
                // same way: `contributes.jsonValidation` (bare name, and
                // `**/mcp.json`), and a `$schema` line in the file with the schema
                // written beside it. In every case VS Code reported a schema as
                // CONFIGURED while catching neither a missing required key nor an
                // unknown one — so it is not validation that is failing to fire,
                // it is the schema failing to load for a file outside a workspace.
                //
                // This note is lowercase on purpose: it is a recorded limitation,
                // and it is here so that a future VS Code would show up as a change
                // in what this line reports.
                const status = await schemaStatus();
                write({ mcpServers: { probe: { command: 'node', nonsense: true } } });
                const unknownFlagged = await waitForCount(base + 1, 15000);
                notes.push(unknownFlagged
                  ? `schema: VS Code flagged an unknown key in ~/.plato/mcp.json (status "${status}") — the limit recorded in D49bt no longer holds, so a schema could be shipped for this file again`
                  : `schema: no editor validation for ~/.plato/mcp.json — an unknown key is not flagged, though VS Code still reports "${status}". The limit is recorded in D49bt; the Settings panel is where the format is explained`);
              }
            }
          } catch (e) {
            notes.push(`SCHEMA: the editor probe could not run — ${String(e?.message ?? e).slice(0, 120)}`);
          } finally {
            // `closeAllEditors` was the first attempt and it CLOSED THE CHAT PANEL
            // — the chat is an editor tab, and closing it stops the run and leaves
            // a webview this harness cannot step back into, which is exactly why
            // the panel-close case must run last. So: the one tab this probe
            // opened, by name, and nothing else.
            try { await new EditorView().closeEditor('mcp.json'); } catch { /* never opened */ }
            try { await new BottomBarPanel().closePanel(); } catch { /* already shut */ }
            await field.enter();
            await field.closeSettings();
          }
        }
        // D49bt: this reads the SECOND scripted case that must run last, so the
        // number here follows the renumber — it was 29, then 32 when the MCP case
        // took that slot, and 33 on 2026-10-21 when the .gitignore case took 32.
        // A check keyed on a case number is exactly what a renumber breaks, and
        // it fails silently: the notes below simply stop being written.
        if (c.n === 33) {
          if (!events.some((e) => e.type === 'notice' && /panel closed/.test(e.text ?? ''))) {
            notes.push('PANEL: the run carries no record that the panel closing is what stopped it');
          }
          if (!events.some((e) => e.type === 'run-completed' && e.reason === 'cancelled')) {
            notes.push('PANEL: the run did not end as cancelled, so it may still be going');
          }
          notes.push('panel close: the run stopped and the record names the cause');
        }
        if (c.n === 28) {
          // D49bp. The stub cut the stream, so the run must show a RETRY and end
          // on the retried answer rather than the half one. Both halves are read
          // from the two independent witnesses: the retry notice from the
          // transcript, the answer from the screen. If the cut were still taken
          // as a finished turn, there would be no retry and the screen would
          // carry only the truncated reply — so each check fails on its own.
          const retried = events.filter(
            (e) => e.type === 'notice' && /retrying in/.test(e.text ?? ''),
          );
          if (retried.length === 0) {
            notes.push('CUT: the transcript shows no retry, so the cut stream was taken as a finished turn');
          }
          if (!screen.includes('for the field tests')) {
            notes.push('CUT: the run did not reach the retried answer, so it ended on the truncated reply');
          }
          notes.push(
            `cut: ${retried.length} retry notice(s), retried answer on screen=${screen.includes('for the field tests')}`,
          );
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
          // The user's OWN edit, written from outside Plato between the run and
          // the /undo. Nothing a scripted model can do produces this, and it is
          // the only thing that makes the fingerprint do any work.
          for (const [file, content] of Object.entries(check.before ?? {})) {
            writeFileSync(join(DEMO_REPO, file), content);
            notes.push(`the user edited ${file} after Plato did`);
          }
          await field.send('/undo');
          // A shorter wait when no card is expected: the point of that case is
          // that NOTHING is drawn, and a 20 s poll would just make it slow.
          const offered = await waitForUndo(field, check.card === false ? 5000 : 20000);
          if (check.card === false) {
            if (offered) notes.push('UNDO: a card was drawn when nothing could be put back');
            else notes.push('undo: no card, as it should be — nothing could be put back');
          } else if (!offered) {
            notes.push('UNDO: /undo offered nothing, so nothing could be put back');
          }
          if (offered) {
            // Shot WITH the card on screen. A claim about what the user is shown
            // is worth exactly as much as the picture of it, and the driver's
            // own post-run shot is taken before /undo ever runs.
            await field.shot(`${label}-undo-card`);
            const cardText = await field.undoText();
            notes.push(`undo card: ${cardText.replace(/\s+/g, ' ').slice(0, 220)}`);
            if (check.names && !cardText.includes(check.names)) {
              notes.push(`UNDO: the card did not name ${check.names}`);
            }
            // A refusal is only honest if it is on the card BEFORE the click AND
            // says why. Kilo's bug is a refusal that arrives as a deletion.
            if (check.refuses) {
              if (!cardText.includes(check.refuses)) {
                notes.push(`UNDO: the card did not name ${check.refuses} as not restorable`);
              } else if (!/you edited it after Plato wrote it/.test(cardText)) {
                notes.push('UNDO: the card named the file but never said WHY it was refused');
              } else {
                notes.push(`undo: the card refused ${check.refuses} and said why, before the click`);
              }
            }
            await field.answerUndo(check.answer ?? 'confirm');
            const settled = await waitForUndoSettled(field, 20000);
            if (!settled) notes.push('UNDO: the card stayed open after the click, so the answer was not taken');
          }
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
              notes.push(`UNDO: ${file} reads ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
            } else {
              notes.push(`undo: ${file} is exactly as expected`);
            }
          }
          // The report is a chat row, so it is read off the screen after the
          // reply settles. This is where the founder's rejected draft failed:
          // it warned that commands "are not affected" and named none of them.
          if (check.report) {
            let said = '';
            for (let attempt = 0; attempt < 10; attempt += 1) {
              said = await field.logText();
              if (check.report.every((n) => said.includes(n))) break;
              await field.driver.sleep(300);
            }
            for (const needle of check.report) {
              if (!said.includes(needle)) notes.push(`UNDO: the report never said "${needle}"`);
            }
            if (check.report.every((n) => said.includes(n))) {
              notes.push('undo report: names what happened and what it could not cover');
            }
            // And the report in frame, because the wording is the thing the
            // founder rejected a draft of — a passing substring check is not the
            // same as having read it.
            await field.shot(`${label}-undo-report`);
          }
        }

        // --- D49bz: what the .gitignore switch does --------------------------
        //
        // Two runs, two different claims, and the model-side half is read as a
        // DELTA of the stub's log: the log accumulates across runs, so the whole
        // log would carry run 1's hit into run 2 and the negative check would be
        // meaningless. The screen is read as a delta for the same reason.
        if (c.n === 32) {
          const log = await stubLog();
          const heads = log.log
            .slice(modelLogBefore)
            .flatMap((r) => (r.toolResults ?? []).map((t) => String(t.head ?? '')))
            .join('\n');
          const onScreen = screen.slice(logBefore.length);
          if (i === 0) {
            if (!heads.includes('HcadPublicAndroid.iml')) {
              notes.push('IGNORE: the ignored file never reached the model, so the default is hiding it');
            }
            if (!heads.includes('.gitignore excludes')) {
              notes.push('IGNORE: the model was not told the result is in a .gitignore path');
            }
            if (!/paths that \.gitignore excludes/.test(onScreen)) {
              notes.push('IGNORE: the user was never told the result is in a .gitignore path');
            }
            notes.push(`ignore: default — found=${heads.includes('HcadPublicAndroid.iml')} labelled=${heads.includes('.gitignore excludes')}`);
          } else {
            if (heads.includes('HcadPublicAndroid.iml')) {
              notes.push('IGNORE: with the setting on, the ignored file still reached the model');
            }
            if (!/no files match/i.test(heads)) {
              notes.push('IGNORE: with the setting on, the search did not report an empty result');
            }
            if (/paths that \.gitignore excludes/.test(onScreen)) {
              notes.push('IGNORE: with the setting on, the run still warned about ignored paths');
            }
            notes.push(`ignore: setting on — hid=${!heads.includes('HcadPublicAndroid.iml')} empty=${/no files match/i.test(heads)}`);
          }
        }

        // --- D49ca: the mode switch, on screen and on disk -------------------
        //
        // The transcript verdict proves the permission table used the new mode.
        // These two are the halves only a real window can show: the copy says
        // WHEN the switch applies, and the write that was refused under `plan`
        // really exists (or does not) once the mode has changed.
        if (c.n === 34 || c.n === 35) {
          const onDisk = existsSync(join(DEMO_REPO, MODE_PROBE));
          if (c.n === 34) {
            if (run.mode === 'plan') {
              if (onDisk) notes.push('DISK: the plan-mode run created the probe file');
              notes.push(`disk: plan left the probe ${onDisk ? 'present' : 'absent'}`);
            } else {
              if (!onDisk) notes.push('DISK: the edit run did not create the probe file after the switch');
              const says = /applies from your next message/.test(screen);
              if (!says) notes.push('MODE: the idle switch notice did not say it applies from the next message');
              notes.push(`mode copy: idle — next-message=${says} disk=${onDisk ? 'written' : 'missing'}`);
            }
          } else {
            if (!onDisk) notes.push('DISK: the run did not create the probe file after the mid-run switch');
            const says = /applies from the next tool call/.test(screen);
            if (!says) notes.push('MODE: the mid-run switch notice did not say it applies from the next tool call');
            notes.push(`mode copy: live — next-call=${says} disk=${onDisk ? 'written' : 'missing'}`);
          }
        }

        // --- D49cb: the model's mode request, on the real card --------------
        if (c.n === 36) {
          const onDisk = existsSync(join(DEMO_REPO, MODE_PROBE));
          if (i === 0) {
            const cardSeen = /Switch Plato to edit mode\?/.test(screen)
              && /Switch me to edit and I will write it/.test(screen);
            if (!cardSeen) notes.push('MODE: the mode card did not show the target and the model’s reason');
            const approved = /the user approved Plato's request/.test(screen);
            if (!approved) notes.push('MODE: the approved switch left no line on screen');
            // The picker is the view's own account of the mode. A host-side
            // switch that does not reach it leaves the chip and the permission
            // table disagreeing — caught in the first screenshot of real 34.
            const label = await field.modeLabel();
            if (label !== 'edit') notes.push(`MODE: after the approved switch the picker still reads "${label}"`);
            if (!onDisk) notes.push('DISK: the write after the approved switch did not land');
            notes.push(`mode request: card=${cardSeen} approved=${approved} picker=${label} disk=${onDisk ? 'written' : 'missing'}`);
          } else {
            const cardSeen = /Switch Plato to auto mode\?/.test(screen);
            if (!cardSeen) notes.push('MODE: the declined request’s card was not drawn');
            const declined = /Plato asked to switch to auto — the user declined/.test(screen);
            if (!declined) notes.push('MODE: the declined request left no line on screen');
            notes.push(`mode request: declined-card=${cardSeen} line=${declined}`);
          }
        }

        // --- what the MODEL was told ---------------------------------------
        if (run.expectModelTold) {
          const log = await stubLog();
          const told = log.log.some((r) =>
            (r.toolResults ?? []).some((t) => t.head.toLowerCase().includes(run.expectModelTold.toLowerCase())),
          );
          if (!told) {
            // Say what the model DID see. A failing assertion with no evidence
            // costs a whole debugging session, and this check's whole job is to
            // be read when it goes red.
            notes.push(
              `MODEL: the expected text never reached the model (looked for "${run.expectModelTold}"; saw ${headsSeen(log)})`,
            );
          } else notes.push(`model was told: "${run.expectModelTold}"`);
        }

        // --- D49bb: the model was handed a MASKED view -----------------------
        //
        // The placeholder may sit anywhere in the file — `local.properties` is
        // ten comment lines before its one assignment — so this asks the stub's
        // boolean rather than searching the head. Searching the head passed for
        // the wrong reason once already.
        if (run.expectMaskedInModel) {
          const log = await stubLog();
          const masked = log.log.some((r) => (r.toolResults ?? []).some((t) => t.masked === true));
          if (!masked) {
            notes.push(`MODEL: no tool result carried a placeholder, so the protected file arrived unmasked`);
          } else {
            notes.push('the model was handed a masked view');
          }
        }

        // --- D49bb: what the model was NOT told -----------------------------
        //
        // The negative half, and the half that matters. `expectModelTold` proves
        // the placeholder arrived; only this proves the VALUE did not. Without
        // it a masker that appended the placeholder to the real text would pass
        // every other check in this file.
        if (run.expectModelNotTold) {
          const log = await stubLog();
          const leaked = log.log.some((r) =>
            (r.toolResults ?? []).some((t) => (t.head ?? '').includes(run.expectModelNotTold)),
          );
          if (leaked) {
            notes.push(`SECRET: the real value reached the model — the mask failed open`);
          } else {
            notes.push('the real value never reached the model');
          }
        }

        // --- D49bb: the file on disk after a masked round trip ---------------
        //
        // A masked read followed by a write is the trap the whole design turns
        // on: without un-masking, the file now holds the literal placeholder and
        // every secret in it is gone. Only the disk can prove which happened.
        if (run.expectSecretRoundTrip) {
          const body = readFileSync(join(DEMO_REPO, run.expectSecretRoundTrip.file), 'utf8');
          for (const needle of run.expectSecretRoundTrip.keeps ?? []) {
            if (!body.includes(needle)) {
              notes.push(`SECRET: ${run.expectSecretRoundTrip.file} lost "${needle}" — a masked write was not restored`);
            }
          }
          for (const needle of run.expectSecretRoundTrip.has ?? []) {
            if (!body.includes(needle)) {
              notes.push(`SECRET: ${run.expectSecretRoundTrip.file} does not contain "${needle}"`);
            }
          }
          if (body.includes('«masked:')) {
            notes.push('SECRET: the placeholder itself was written to disk');
          } else {
            notes.push(`secret round trip: ${run.expectSecretRoundTrip.file} is intact and carries no placeholder`);
          }
        }

        // --- D49bc: the protected file Plato cannot mask ---------------------
        //
        // Two claims, and the count is the second: the card was DRAWN (rather
        // than the file shown or refused without asking), and it stated what the
        // click costs. `askOnce` is the session rule — a user who answered once
        // must not be asked again in the same run, which is the difference
        // between a question and a nuisance.
        if (run.expectReveal) {
          const text = await field.revealText();
          if (!field.revealSeen) {
            notes.push('REVEAL: no card was drawn — the file was shown or refused without asking');
          } else if (!/goes into this conversation/.test(text)) {
            notes.push(`REVEAL: the card did not state the cost of the click — it read: ${text}`);
          } else {
            notes.push('reveal card: drawn, and it states what the click costs');
          }
          if (run.expectReveal.askOnce !== undefined
            && field.revealCards !== run.expectReveal.askOnce) {
            notes.push(
              `REVEAL: asked ${field.revealCards} time(s), expected ${run.expectReveal.askOnce} — ` +
              `the session memory of the answer is not holding`,
            );
          } else if (run.expectReveal.askOnce !== undefined) {
            notes.push(`reveal card: asked ${field.revealCards} time(s), as expected`);
          }
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

        // D49bz: a case that changed a setting puts it back, so the next case
        // starts from the same defaults this one did. Not fatal: the case's own
        // claims are read by here, and a Settings trip that failed would say so.
        if (run.panelToggle !== undefined) {
          const restored = await field.setRespectGitignore(false);
          notes.push(
            restored === false
              ? 'panel switch: restored to off from Plato\'s settings page'
              : 'setting: the panel switch could not be restored — later cases may inherit it',
          );
        }

        // D49at: `STUCK`, `GUIDANCE` and the clause prefixes above are FATAL. The
        // stuck cases' screen checks were written as notes and were NOT in this
        // list, so "no stuck card was ever detected" — the check that gives cases
        // 12-14 their teeth — could not fail the case. Found while wiring the
        // acceptance clauses; a note is not a check.
        //
        // D49bc: `REVEAL` was written the same way and caught by the same rule
        // one decision later — case 22's "no card was drawn" note would have
        // passed a case in which no card appeared at all. **This list is part of
        // writing a check, not an afterthought to it.**
        //
        // D49bm/D49bo: `PAUSE`, `QUEUE` and `PANEL` join it in the same breath as
        // the checks that use them, for exactly that reason.
        const failures = notes.slice(mark).filter((n) =>
          /^(CARDS|QUESTION|MEMORY|NOTICE|PLAN|PLANNOTE|LOG|DISK|TRANSCRIPT|TICKS|CANCEL|DIAGNOSTICS|STUCK|GUIDANCE|FETCH|OBSERVER|UNDO|SECRET|MODEL|REVEAL|PAUSE|QUEUE|PANEL|CUT|MCP|SCHEMA|IGNORE|MODE):/.test(n),
        );
        // D49bt: the seeded home config goes as soon as this run is over, so the
        // next case starts from the same empty state this one did.
        for (const file of Object.keys(run.seedHome ?? {})) {
          rmSync(join(homedir(), '.plato', file), { force: true });
        }
        console.log(`  case ${c.n} run ${i + 1} (${run.mode}): ${chk(v)} transcript, ${actualCards} card(s)`);
        for (const n of notes.slice(mark)) console.log(`    ${n}`);
        // D49at: the manifest is what turns a pile of cases into an executable
        // acceptance test. Without it a run of cases cannot be mapped back to the
        // clauses, because a transcript records its TASK and its root but not
        // which case produced it — so `acceptance.mjs` had nothing to join on.
        // Written per RUN, so a clause witnessed by one run of a two-run case can
        // name it.
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
   * Case 37 — the tabs proof. Two conversations in two panels, a completed
   * write in each, then a run in flight in BOTH, and one tab is closed.
   *
   * What makes it a check rather than a demonstration:
   *   - the two writes land in different files and in different transcripts;
   *   - the closed tab's run ends cancelled with the panel-close notice, and
   *     the other tab's run still completes;
   *   - the archived-chat count in History grows by exactly one, and the newest
   *     archived chat is the closed tab's conversation.
   *
   * Falsified by the change it guards: with `dispose()` wired to one tracked
   * panel, the closed tab's run keeps going and never archives — every one of
   * the three checks above fails.
   */
  if (only.length === 0 || only.includes(37)) {
    it('case 37 — two chat tabs run independently, and closing one stops only its run', async () => {
      const A_FILE = 'tab-a-probe.txt';
      const B_FILE = 'tab-b-probe.txt';
      for (const f of [A_FILE, B_FILE]) {
        rmSync(join(DEMO_REPO, f), { force: true });
      }

      const storedChats = async () => {
        const rows = await field.driver.findElements(By.css('.runitem'));
        let n = 0;
        for (const row of rows) {
          if ((await row.getText()).includes('click to resume')) n += 1;
        }
        return n;
      };
      const openHistory = async () => {
        // A webview that was hidden and shown again is a NEW document, and the
        // automation context still points at the old one. Re-enter only when
        // the header cannot be seen from the current context, and say so.
        let inside = false;
        try {
          inside = await field.driver.executeScript(
            "return !!document.getElementById('hist');",
          );
        } catch {
          inside = false;
        }
        if (!inside) {
          field.log('  the driver was not inside the chat frame — re-entering');
          try {
            await field.webview.switchBack();
          } catch {
            /* already at the top level */
          }
          await field.switchToChatFrame();
        }
        await field.clickElement(await field.driver.findElement(By.id('hist')));
        // The host builds the History payload asynchronously and the page only
        // switches when it arrives. A fixed sleep was the old assumption and it
        // is what failed once under load: the page had not opened, `storedChats`
        // saw no rows, and the BACK click hit a hidden button. Wait for the
        // page state instead.
        await waitForHistory(true);
      };
      const leaveHistory = async () => {
        await field.clickElement(await field.driver.findElement(By.id('hback')));
        await waitForHistory(false);
      };
      /**
       * Waits for the History page to be OPEN or CLOSED — the page's own state,
       * not a guess about how long the host takes. Bounded, and loud on timeout.
       */
      const waitForHistory = async (open, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const shown = await field.driver
            .executeScript("return document.body.classList.contains('show-history');")
            .catch(() => null);
          if (shown === open) return;
          if (Date.now() > deadline) {
            throw new Error(
              `HISTORY: the page did not ${open ? 'open' : 'close'} within ${timeoutMs}ms`,
            );
          }
          await field.driver.sleep(150);
        }
      };

      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];
      await field.setMode('auto');

      // Tab A: a completed write.
      await setScript([
        { tool: 'write_file', args: { path: A_FILE, content: 'tab A' } },
        { text: 'TAB A wrote its file.' },
      ]);
      const beforeA = await field.send('TAB A: write the probe file');
      const eventsA = await field.waitRunEnd(beforeA, { tag: 'tab-a' });
      const aTranscript = field.lastTranscript;
      if (!eventsA.some((e) => e.type === 'run-completed')) {
        throw new Error('TAB A: the first run did not complete');
      }
      if (!existsSync(join(DEMO_REPO, A_FILE))) {
        throw new Error('TAB A: the write did not land');
      }

      // Tab B: "+ new" opens another conversation and leaves A open.
      const aLabel = await field.openNewTab();
      await field.switchToChatFrame();
      await field.setMode('auto');
      await setScript([
        { tool: 'write_file', args: { path: B_FILE, content: 'tab B' } },
        { text: 'TAB B wrote its file.' },
      ]);
      const beforeB = await field.send('TAB B: write the probe file');
      const eventsB = await field.waitRunEnd(beforeB, { tag: 'tab-b' });
      const bTranscript = field.lastTranscript;
      if (!eventsB.some((e) => e.type === 'run-completed')) {
        throw new Error('TAB B: the first run did not complete');
      }
      if (!existsSync(join(DEMO_REPO, B_FILE))) {
        throw new Error('TAB B: the write did not land');
      }
      if (aTranscript === bTranscript) {
        throw new Error('TABS: both conversations wrote the SAME transcript');
      }

      // How many chats are already archived before this case closes anything.
      await openHistory();
      const storedBefore = await storedChats();
      await leaveHistory();

      // B is on screen. Start a slow run here, then start one in A as well.
      await setScript([{ text: 'TAB SLOW reply', delayMs: 20000 }]);
      const beforeSlowB = await field.send('TAB B: slow run');
      const [slowBFile] = await field.waitForNewRuns(beforeSlowB, 1);

      await field.webview.switchBack();
      const bLabel = await field.activeEditorLabel();
      await field.activateTabByLabel(aLabel, { notActive: true });
      // The frame, not just the tab, must be A's: a send into the wrong chat
      // would become guidance for B's live run and start nothing. Chat tabs are
      // stacked overlays with identical geometry, so the iframe can lag the tab
      // by a moment. Wait for A's own words instead of sampling once; a chat
      // that never shows them still fails, and the message names what was on
      // screen so a real wrong-chat defect is not mistaken for slow rendering.
      const aDeadline = Date.now() + 15000;
      let aVisible = '';
      while (Date.now() < aDeadline) {
        await field.switchToChatFrame();
        aVisible = await field.logText().catch(() => '');
        if (aVisible.includes('TAB A: write the probe file')) break;
        await field.webview.switchBack().catch(() => {});
        await field.driver.sleep(250);
      }
      if (!aVisible.includes('TAB A: write the probe file')) {
        throw new Error(
          `TABS: the visible chat is not tab A after switching (showing "${aVisible
            .replace(/\s+/g, ' ')
            .slice(0, 140)}")`,
        );
      }
      const beforeSlowA = new Set(field.transcripts());
      await field.send('TAB A: slow run');
      const [slowAFile] = await field.waitForNewRuns(beforeSlowA, 1);

      // Close A while its run is in flight. Only A may stop.
      await field.closeChat();
      const aEvents = await field.waitRunTerminal(slowAFile, 30000);
      const bEvents = await field.waitRunTerminal(slowBFile, 90000);

      const aEnd = aEvents.find((e) => e.type === 'run-completed');
      const bEnd = bEvents.find((e) => e.type === 'run-completed');
      if (aEnd === undefined) throw new Error('TAB A: the run never ended after the close');
      if (aEnd.reason !== 'cancelled') {
        throw new Error(`TAB A: the closed tab's run ended "${aEnd.reason}", not cancelled`);
      }
      if (!aEvents.some((e) => e.type === 'notice' && /panel closed/i.test(String(e.text)))) {
        throw new Error('TAB A: the transcript does not say the panel close stopped the run');
      }
      if (bEnd === undefined) throw new Error('TAB B: the run never ended');
      if (bEnd.reason === 'cancelled') {
        throw new Error('TAB B: closing the OTHER tab cancelled this run');
      }

      // Back to B: the archive must have grown by exactly the closed chat, and
      // the newest stored chat must be A's conversation.
      //
      // Two timing assumptions meet here. The History page opens only when the
      // host's answer arrives, and under load a fixed sleep was too short: the
      // reproduced failure was the BACK click hitting a page that had never
      // opened (see `waitForHistory`). The archive itself is written by the
      // panel's own async dispose, AFTER the run it cancelled has unwound, and
      // History does not update itself afterwards — so one read can also arrive
      // before the archive lands. Both are waited for now: the page's state,
      // and the count. The 30s deadline still fails the case if the archive
      // never arrives, so a lost snapshot cannot pass as slow.
      await field.activateTabByLabel(bLabel);
      await field.switchToChatFrame();
      // The stored list is capped (30). In a full run it is already full, so a
      // new archive can be accompanied by the oldest one dropping off. One new
      // row is therefore `min(before + 1, 30)`; which row it is, the click
      // below proves.
      const expected = Math.min(storedBefore + 1, 30);
      let storedAfter = storedBefore;
      const archiveDeadline = Date.now() + 30000;
      for (;;) {
        await field.driver.sleep(500);
        await openHistory();
        storedAfter = await storedChats();
        // Stay in History on a match: the row click below happens there.
        if (storedAfter === expected) break;
        await leaveHistory();
        if (Date.now() > archiveDeadline) {
          throw new Error(
            `HISTORY: archived chats went ${storedBefore} → ${storedAfter}; expected ${expected} within 30s`,
          );
        }
      }
      const rows = await field.driver.findElements(By.css('.runitem'));
      let storedRow = null;
      for (const row of rows) {
        if ((await row.getText()).includes('click to resume')) {
          storedRow = row;
          break;
        }
      }
      if (storedRow === null) throw new Error('HISTORY: the archived chat row is missing');
      await field.clickElement(storedRow);
      await field.driver.sleep(1200);
      const resumed = await field.logText();
      if (!resumed.includes('TAB A: slow run')) {
        throw new Error('HISTORY: the newest archived chat is not the closed tab');
      }

      MANIFEST.push({
        case: 37,
        run: 1,
        mode: 'auto',
        orchestration: 'solo',
        title: 'Two chat tabs run independently; closing one stops only its run',
        transcript: slowAFile,
        transcriptOk: true,
        screenFailures: [],
      });
      console.log(
        `  case 37: tabs independent, closed run cancelled, other run complete, archives +1 (${storedBefore} → ${storedAfter})`,
      );
    });
  }

  /**
   * D49cq, the GUI half: two real chats in one real window, talking.
   *
   * The stub now plays a step when the prompt MATCHES it (`match`), because two
   * conversations share one script and one cursor: tab A's next turn would
   * otherwise take the step a run in tab B had just started for. That is a
   * harness change, and it is what makes the rest of this case deterministic.
   *
   * What it proves, in the order a person would meet it:
   *   - the picker lists the OTHER tab from the registry, with its host and
   *     whether it is busy;
   *   - sending to an idle chat starts a run THERE, whose task carries the
   *     provenance header, and whose model is not offered send_to_session
   *     (depth 1);
   *   - sending to a busy chat is acknowledged as queued and runs after the run
   *     it waited behind;
   *   - a refused send says so on the row that asked (the outcome comes from
   *     the host, never from the click);
   *   - a closed chat disappears from the picker, and its entry is gone from
   *     the registry.
   */
  if (only.length === 0 || only.includes(38)) {
    it('case 38 — one chat messages another through the model: start, queue, refuse, registry truth', async () => {
      // D49cq: the send is the MODEL's, not a panel's. The founder's call:
      // asking the model is what a person does, and the send shows in the chat
      // like any other tool call. This case therefore drives `send_to_session`
      // and `list_sessions` through the stub and reads the TOOL RESULTS the
      // model was shown — the only witness for a pre-flight refusal.
      const LONG = 'x'.repeat(4100);
      await setScript([
        { match: 'TAB B: standby', text: 'TAB B is standing by.' },
        { match: 'RELAY: check the parser', text: 'B: the parser is fine.' },
        { match: 'RELAY: draft check', text: 'B: the draft did not matter.' },
        { match: 'TAB B: slow run', text: 'The slow run finished.', delayMs: 30000 },
        { match: 'RELAY: and the lexer', text: 'B: the lexer is fine too.' },
        { match: 'TAB A: message idle B', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: standby', text: 'RELAY: check the parser' } }] },
        { match: 'TAB A: message idle B', text: 'A: I asked B.' },
        { match: 'TAB A: message drafted B', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: standby', text: 'RELAY: draft check' } }] },
        { match: 'TAB A: message drafted B', text: 'A: I asked B again.' },
        { match: 'TAB A: message busy B', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: standby', text: 'RELAY: and the lexer' } }] },
        { match: 'TAB A: message busy B', text: 'A: B was busy.' },
        { match: 'TAB A: oversize', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: standby', text: LONG } }] },
        { match: 'TAB A: oversize', text: 'A: that was too long.' },
        { match: 'TAB A: list after close', calls: [{ tool: 'list_sessions', args: {} }] },
        { match: 'TAB A: list after close', text: 'A: listed.' },
      ]);

      /**
       * The newest real agent turn whose CURRENT task contains `prompt`. The
       * last user message is the task: a later run carries the earlier ones as
       * history, so matching ANY user text finds the wrong turn.
       */
      const turnFor = async (prompt) => {
        const log = await stubLog();
        const hits = log.log.filter((e) => {
          if (Number(e.toolsOffered) <= 0) return false;
          // Tool results travel as `role:'user'` messages with no text, so the
          // LAST user string can be empty. The task is the last NON-EMPTY one.
          const texts = (e.userTexts || []).map(String).filter((t) => t.length > 0);
          return String(texts[texts.length - 1] || '').includes(prompt);
        });
        return hits[hits.length - 1];
      };
      /** What the model was shown as tool results in that turn. */
      const resultsFor = async (prompt) => {
        const turn = await turnFor(prompt);
        const log = await stubLog();
        const recent = log.log.slice(-4).map((e) => ({
          tools: e.toolsOffered,
          last: String(((e.userTexts || []).map(String).filter(Boolean)).slice(-1)[0] || '').slice(0, 50),
          results: (e.toolResults || []).length,
          head: String(((e.toolResults || [])[0] || {}).head || '').slice(0, 70),
        }));
        if (turn === undefined) {
          return '[no turn for "' + prompt + '"; recent ' + JSON.stringify(recent) + ']';
        }
        const out = (turn.toolResults || []).map((r) => String(r.head || '')).join('\n');
        return out.length > 0 ? out : '[turn for "' + prompt + '" had no results; recent ' + JSON.stringify(recent) + ']';
      };
      /** A run whose header task contains `needle`, started after `before`. */
      const waitForRun = async (before, needle, timeoutMs = 120000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const f of field.transcripts().filter((x) => !before.has(x))) {
            const first = readFileSync(f, 'utf8').split('\n')[0] || '{}';
            let task = '';
            try {
              task = String(JSON.parse(first).task || '');
            } catch {
              task = '';
            }
            if (task.includes(needle)) return f;
          }
          await field.driver.sleep(250);
        }
        throw new Error(`RELAY: no run appeared for "${needle}"`);
      };

      // B first, so it has a title to address.
      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];
      await field.setMode('auto');
      const beforeB = await field.send('TAB B: standby');
      await field.waitRunEnd(beforeB, { tag: 'tab-b' });
      await field.webview.switchBack();
      await field.driver.sleep(800);
      const bLabel = await field.activeEditorLabel();
      if (!bLabel || !bLabel.includes('TAB B: standby')) {
        throw new Error(`RELAY: B's title is "${bLabel}", so it cannot be addressed by name`);
      }

      // A second tab; A asks its model to message B.
      await field.openNewTab(); // leaves us in A
      await field.setMode('auto');
      const idleBefore = new Set(field.transcripts());
      const beforeA = await field.send('TAB A: message idle B');
      const idleRun = await waitForRun(idleBefore, 'RELAY: check the parser');
      const aRun = await waitForRun(beforeA, 'TAB A: message idle B');
      await field.waitRunTerminal(aRun, 90000);
      await field.webview.switchBack();
      await field.driver.sleep(800);
      const aLabel = await field.activeEditorLabel();
      if (!aLabel || aLabel === bLabel) {
        throw new Error(`RELAY: A's label is "${aLabel}"`);
      }
      await field.switchToChatFrame();

      // The model was told it was delivered — B was idle after its own run.
      const delivered = await resultsFor('TAB A: message idle B');
      if (!delivered.includes('delivered to')) {
        throw new Error(`RELAY: a send to an idle chat reported:\n${delivered}`);
      }
      // B's run carries the message and the provenance header, and completes.
      const idleEvents = await field.waitRunTerminal(idleRun, 90000);
      if (!idleEvents.some((e) => e.type === 'run-completed')) {
        throw new Error('RELAY: the run started by the message never completed');
      }
      const idleText = readFileSync(idleRun, 'utf8');
      if (!idleText.includes('Message from another Plato session')) {
        throw new Error('RELAY: the receiving run was not told where the task came from');
      }
      if (!idleText.includes('RELAY: check the parser')) {
        throw new Error('RELAY: the receiving run does not carry the message');
      }
      // D49cq (amended): a session-origin run MAY answer the session that sent
      // it, once — so the tool is offered. What it may not do is reach a THIRD
      // session; that chain rule, and the reply run that cannot send at all,
      // are case 40's.
      const inboundTurn = await turnFor('RELAY: check the parser');
      if (inboundTurn === undefined) {
        throw new Error('RELAY: the stub has no record of the receiving turn');
      }
      if (!(inboundTurn.toolNames || []).includes('send_to_session')) {
        throw new Error('RELAY: a session-origin run was not offered its one reply');
      }

      // An UNSENT DRAFT in the receiver must change nothing: the founder's
      // other suspect. Type into B, do not send, then message it from A.
      await field.webview.switchBack();
      await field.activateTabByLabel(bLabel);
      await field.switchToChatFrame();
      await field.type('a draft I never sent');
      await field.webview.switchBack();
      await field.activateTabByLabel(aLabel);
      await field.switchToChatFrame();
      const draftBefore = new Set(field.transcripts());
      const beforeDraft = await field.send('TAB A: message drafted B');
      const draftRun = await waitForRun(draftBefore, 'RELAY: draft check');
      await field.waitRunTerminal(draftRun, 90000);
      const draftA = await waitForRun(beforeDraft, 'TAB A: message drafted B');
      await field.waitRunTerminal(draftA, 90000);
      const draftResult = await resultsFor('TAB A: message drafted B');
      if (!draftResult.includes('delivered to')) {
        throw new Error(`RELAY: a draft in the receiver's composer changed the outcome:\n${draftResult}`);
      }

      // Queue behind a live run.
      await field.webview.switchBack();
      await field.activateTabByLabel(bLabel);
      await field.switchToChatFrame();
      // The draft is still in B's composer; clear it before B sends its own task.
      await field.driver.executeScript("document.getElementById('q').value = '';");
      const slowBefore = new Set(field.transcripts());
      await field.send('TAB B: slow run');
      const slowFile = await waitForRun(slowBefore, 'TAB B: slow run', 60000);
      await field.webview.switchBack();
      await field.activateTabByLabel(aLabel);
      await field.switchToChatFrame();
      const busyBefore = new Set(field.transcripts());
      const beforeBusy = await field.send('TAB A: message busy B');
      const busyA = await waitForRun(beforeBusy, 'TAB A: message busy B');
      await field.waitRunTerminal(busyA, 90000);
      const queued = await resultsFor('TAB A: message busy B');
      if (!queued.includes('queued at')) {
        throw new Error(`RELAY: a send to a busy chat reported:\n${queued}`);
      }
      const slowEvents = await field.waitRunTerminal(slowFile, 120000);
      if (!slowEvents.some((e) => e.type === 'run-completed')) {
        throw new Error("RELAY: B's slow run never ended");
      }
      const lexerRun = await waitForRun(busyBefore, 'RELAY: and the lexer');
      const lexerEvents = await field.waitRunTerminal(lexerRun, 90000);
      if (!lexerEvents.some((e) => e.type === 'run-completed')) {
        throw new Error('RELAY: the queued run never completed');
      }
      if (!readFileSync(lexerRun, 'utf8').includes('RELAY: and the lexer')) {
        throw new Error('RELAY: the queued run does not carry the queued message');
      }

      // Oversized: the engine refuses before anything is dialled.
      const beforeOversize = await field.send('TAB A: oversize');
      const oversizeA = await waitForRun(beforeOversize, 'TAB A: oversize');
      await field.waitRunTerminal(oversizeA, 90000);
      const oversize = await resultsFor('TAB A: oversize');
      if (!oversize.includes('the limit is 4000')) {
        throw new Error(`RELAY: an oversized send reported:\n${oversize}`);
      }
      // Nothing may start in the receiver. Count from AFTER the sender's own
      // run, or its transcript would be mistaken for one.
      const afterOversize = new Set(field.transcripts());
      await field.driver.sleep(2000);
      const extra = field.transcripts().filter((f) => !afterOversize.has(f));
      if (extra.length > 0) {
        throw new Error(`RELAY: an oversized message still started a run (${extra.join(', ')})`);
      }

      // Registry truth: close B, then have the MODEL list the sessions.
      await field.webview.switchBack();
      await field.activateTabByLabel(bLabel);
      await field.closeChat();
      await field.activateTabByLabel(aLabel);
      await field.switchToChatFrame();
      const beforeList = await field.send('TAB A: list after close');
      const listA = await waitForRun(beforeList, 'TAB A: list after close');
      await field.waitRunTerminal(listA, 90000);
      const listed = await resultsFor('TAB A: list after close');
      if (listed.includes('TAB B: standby')) {
        throw new Error(`REGISTRY: the closed chat is still listed:\n${listed}`);
      }

      MANIFEST.push({
        case: 38,
        run: 1,
        mode: 'auto',
        orchestration: 'solo',
        title: 'One chat messages another through the model: start, queue, refuse, registry truth',
        transcript: lexerRun,
        transcriptOk: true,
        screenFailures: [],
      });
      console.log(
        '  case 38: model sends start an idle chat, queue behind a live run, refuse an oversized text; a closed chat leaves the registry',
      );
    });
  }

  /**
   * D49cq, the founder's first point: the new-chat control belongs where a
   * person looks for it — the editor title bar, beside the tab, the way Claude
   * Code puts it. The risk is the `when` clause: `activeWebviewPanelId` must
   * make the button appear on a Plato tab and NOWHERE else, or a Plato button
   * lands on every editor. This case is that verification, and it also records
   * the activity-bar container the founder could not see.
   */
  if (only.length === 0 || only.includes(39)) {
    it('case 39 — the Plato mark is in every editor title bar and opens a new chat', async () => {
      const titleActions = async () => {
        await field.webview.switchBack();
        return await field.driver.executeScript(`
          return [...document.querySelectorAll(
            '.editor-actions .action-label, .editorTitle .action-label, .editor-title .action-label'
          )].map((a) => ({
            label: a.getAttribute('aria-label') || '',
            title: a.getAttribute('title') || '',
          }));
        `);
      };
      const hasNewChat = (actions) => actions.some((a) =>
        (a.label + ' ' + a.title).includes('Plato: New Chat'));

      // A Plato tab carries it. The `when` clause must keep it there after the
      // plain-file case below is added.
      const onChat = await titleActions();
      if (!hasNewChat(onChat)) {
        throw new Error(
          `TITLE BAR: no "Plato: New Chat" action on a Plato tab (saw: ${JSON.stringify(onChat)})`,
        );
      }

      // The activity bar: the founder could not see the owl. Record what the
      // workbench actually holds, so "not registered" and "hidden in HIS
      // profile" are distinguishable.
      const containers = await field.driver.executeScript(`
        return [...document.querySelectorAll('.activitybar .action-label, .activitybar .action-item')]
          .map((a) => a.getAttribute('aria-label') || a.getAttribute('title') || '')
          .filter((s) => s.length > 0);
      `);
      await field.shot('case-39-activitybar');
      if (!containers.some((c) => c.toLowerCase().includes('plato'))) {
        throw new Error(
          `ACTIVITY BAR: no Plato container in a fresh profile (saw: ${JSON.stringify(containers)})`,
        );
      }

      // A PLAIN FILE carries it too — the founder's rule: the mark is on every
      // open editor, the way Claude Code's icon is, and it is how a tab is
      // made. Open the file from the Explorer: a plain click on it, which is
      // what a person does. Quick open and the tester's openEditor both proved
      // unreliable from a workbench left by a click.
      await field.webview.switchBack();
      await field.driver.switchTo().defaultContent();
      // Show the Explorer by clicking its icon. The command palette is NOT
      // used: with a webview editor active the tester's prompt can stall for
      // five seconds, which is a harness fault that reads as a product
      // failure. The icon TOGGLES its container, so it is clicked only while
      // the tree is absent — clicking an open Explorer would hide it.
      const explorerShown = async () =>
        (await field.driver
          .executeScript(`
            const side = document.querySelector('.part.sidebar');
            if (!side || side.getBoundingClientRect().width < 50) return false;
            return document.querySelectorAll('.part.sidebar .monaco-list-row').length > 0;
          `)
          .catch(() => false)) === true;
      for (let attempt = 0; attempt < 3 && !(await explorerShown()); attempt += 1) {
        // A TRUSTED click: VS Code listens for real mouse events on the
        // activity bar, so a JS-dispatched click there is ignored.
        const { ActivityBar } = await import('vscode-extension-tester');
        const control = await new ActivityBar().getViewControl('Explorer');
        if (!control) throw new Error('TITLE BAR: the Explorer icon is not in the activity bar');
        await field.clickElement(control);
        await field.driver.sleep(900);
      }
      if (!(await explorerShown())) {
        throw new Error('TITLE BAR: the Explorer could not be shown');
      }
      const clickedFile = await field.driver.executeScript(`
        const rows = [...document.querySelectorAll('.monaco-list-row')];
        const row = rows.find((r) =>
          ((r.getAttribute('aria-label') || '') + ' ' + (r.textContent || '')).includes('settings.gradle'));
        if (!row) return false;
        row.click();
        return true;
      `);
      await field.driver.sleep(1500);
      if (!clickedFile || !(await field.activeEditorLabel()).includes('settings.gradle')) {
        throw new Error('TITLE BAR: the plain file editor did not open');
      }
      const onFile = await titleActions();
      if (!hasNewChat(onFile)) {
        throw new Error('TITLE BAR: the Plato mark is missing on a plain file editor');
      }
      await field.shot('case-39-file-editor');

      // Clicking the mark ON THE FILE opens a new chat tab.
      const before = await field.activeEditorLabel();
      await field.driver.executeScript(`
        const a = [...document.querySelectorAll('.editor-actions .action-label, .editorTitle .action-label')]
          .find((x) => ((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '')).includes('Plato: New Chat'));
        a.click();
      `);
      await field.driver.sleep(1500);
      const after = await field.activeEditorLabel();
      if (after === before || !/plato/i.test(after)) {
        throw new Error(
          `TITLE BAR: the mark on a file did not open a new chat ("${before}" → "${after}")`,
        );
      }
      // The new conversation is a Plato tab, and it carries the mark as well.
      const onNewChat = await titleActions();
      if (!hasNewChat(onNewChat)) {
        throw new Error(
          `TITLE BAR: the new chat tab lost the mark (saw: ${JSON.stringify(onNewChat)})`,
        );
      }

      // Leave a chat in front for whatever runs after this one: close the file
      // tab, which re-activates the new chat beside it.
      await field.closeTabByLabel('settings.gradle', { notActive: true }).catch(() => undefined);
      await field.driver.sleep(900);

      MANIFEST.push({
        case: 39,
        run: 1,
        mode: 'auto',
        orchestration: 'solo',
        title: 'The Plato mark is on a Plato tab and on a plain file, and opens a new chat',
        transcript: '',
        transcriptOk: true,
        screenFailures: [],
      });
      console.log('  case 39: the Plato mark is on a plain file and on a Plato tab; a click opens a new chat');
    });
  }

  /**
   * D49cq (amended): one round trip, through the model, in two real chats.
   *
   *   A (user run)  →  B (session run: may answer once, to A only)
   *                 →  A (reply run: may not send at all)
   *
   * The stub emits the tool calls, so this drives what a person does — ask the
   * model — and reads what each model was actually offered and told: the reply
   * tool is in B's declaration and absent from A's reply run, B's send is marked
   * a reply, and A's forced attempt comes back refused.
   */
  if (only.length === 0 || only.includes(40)) {
    it('case 40 — a message and its one reply, and the chain stops there', async () => {
      await setScript([
        { match: 'TAB B: answer', text: 'B ready.' },
        { match: 'TAB A: warm up', text: 'A ready.' },
        { match: 'RELAY: what is the status?', calls: [{ tool: 'send_to_session', args: { to: 'TAB A: warm up', text: 'RELAY: all good' } }] },
        { match: 'RELAY: what is the status?', text: 'B: replied.' },
        { match: 'RELAY: all good', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: answer', text: 'RELAY: again' } }] },
        { match: 'RELAY: all good', text: 'A: the answer is all good.' },
        { match: 'TAB A: ask B', calls: [{ tool: 'send_to_session', args: { to: 'TAB B: answer', text: 'RELAY: what is the status?' } }] },
        { match: 'TAB A: ask B', text: 'A: asked B.' },
      ]);

      // The CURRENT task is the LAST user message; a later run repeats the
      // earlier turns as history, so matching any user text finds the wrong one.
      const turnFor = async (prompt) => {
        const log = await stubLog();
        const hits = log.log.filter((e) => {
          if (Number(e.toolsOffered) <= 0) return false;
          // Tool results travel as `role:'user'` messages with no text, so the
          // LAST user string can be empty. The task is the last NON-EMPTY one.
          const texts = (e.userTexts || []).map(String).filter((t) => t.length > 0);
          return String(texts[texts.length - 1] || '').includes(prompt);
        });
        return hits[hits.length - 1];
      };
      const resultsFor = async (prompt) => {
        const turn = await turnFor(prompt);
        if (turn === undefined) return '';
        return (turn.toolResults || []).map((r) => String(r.head || '')).join('\n');
      };
      const waitForRun = async (before, needle, timeoutMs = 120000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const f of field.transcripts().filter((x) => !before.has(x))) {
            const first = readFileSync(f, 'utf8').split('\n')[0] || '{}';
            let task = '';
            try {
              task = String(JSON.parse(first).task || '');
            } catch {
              task = '';
            }
            if (task.includes(needle)) return f;
          }
          await field.driver.sleep(250);
        }
        throw new Error(`REPLY: no run appeared for "${needle}"`);
      };

      // B first, so it has a name A can address.
      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];
      await field.setMode('auto');
      const beforeB = await field.send('TAB B: answer');
      await field.waitRunEnd(beforeB, { tag: 'tab-b' });
      await field.webview.switchBack();
      await field.driver.sleep(800);
      const bLabel = await field.activeEditorLabel();
      if (!bLabel || !bLabel.includes('TAB B: answer')) {
        throw new Error(`REPLY: B's title is "${bLabel}"`);
      }

      // A gets its own title before it messages anyone: B addresses A by
      // NAME, and a chat still called "Plato 2" cannot be answered.
      await field.openNewTab();
      await field.setMode('auto');
      const beforeWarm = await field.send('TAB A: warm up');
      await field.waitRunEnd(beforeWarm, { tag: 'tab-a' });
      await field.webview.switchBack();
      await field.driver.sleep(800);
      const aLabel = await field.activeEditorLabel();
      if (!aLabel || !aLabel.includes('TAB A: warm up')) {
        throw new Error(`REPLY: A's title is "${aLabel}"`);
      }
      await field.switchToChatFrame();

      // A asks its model to message B. Everything else follows from that.
      const beforeAsk = new Set(field.transcripts());
      const beforeA = await field.send('TAB A: ask B');
      const askRun = await waitForRun(beforeA, 'TAB A: ask B');
      await field.waitRunTerminal(askRun, 90000);
      await field.webview.switchBack();
      await field.driver.sleep(300);
      await field.switchToChatFrame();

      const asked = await resultsFor('TAB A: ask B');
      if (!asked.includes('delivered to')) {
        throw new Error(`REPLY: A's message to B reported:\n${asked}`);
      }

      // B's run was offered the send tool (as a REPLY, to A) and used it.
      const bTurn = await turnFor('RELAY: what is the status?');
      if (bTurn === undefined) {
        throw new Error('REPLY: the stub has no record of B answering A');
      }
      if (!(bTurn.toolNames || []).includes('send_to_session')) {
        throw new Error('REPLY: B was not offered the reply tool');
      }
      const bSent = await resultsFor('RELAY: what is the status?');
      // A may still be finishing its own run when the answer arrives, in which
      // case the engine says the reply was queued. Both outcomes prove the
      // send was MARKED a reply; the end of the chain is proved below.
      if (!bSent.includes('reply delivered to') && !bSent.includes('your reply is queued at')) {
        throw new Error(`REPLY: B's answer reported:\n${bSent}`);
      }

      // A's reply run: it ran, it is labelled as a reply, and it cannot send.
      const replyRun = await waitForRun(beforeAsk, 'RELAY: all good');
      const replyEvents = await field.waitRunTerminal(replyRun, 120000);
      if (!replyEvents.some((e) => e.type === 'run-completed')) {
        throw new Error('REPLY: the reply run never completed');
      }
      const replyText = readFileSync(replyRun, 'utf8');
      if (!replyText.includes('Reply from another Plato session')) {
        throw new Error('REPLY: the reply run was not told it was an answer');
      }
      const replyTurn = await turnFor('RELAY: all good');
      if (replyTurn === undefined) {
        throw new Error('REPLY: the stub has no record of the reply run');
      }
      if ((replyTurn.toolNames || []).includes('send_to_session')) {
        throw new Error('REPLY: a reply run was offered send_to_session');
      }
      const refused = await resultsFor('RELAY: all good');
      if (!refused.includes('exchange is over')) {
        throw new Error(`REPLY: a reply run's forced send was not refused:\n${refused}`);
      }

      // The window shows the answer as somebody else's, named as a reply.
      await field.webview.switchBack();
      await field.activateTabByLabel(aLabel);
      await field.switchToChatFrame();
      const screen = await field.logText();
      if (!screen.toLowerCase().includes(('Reply from ' + bLabel).toLowerCase())) {
        throw new Error(`REPLY: the window does not label the answer (${bLabel})`);
      }

      MANIFEST.push({
        case: 40,
        run: 1,
        mode: 'auto',
        orchestration: 'solo',
        title: 'A message and its one reply; the chain stops at the reply',
        transcript: replyRun,
        transcriptOk: true,
        screenFailures: [],
      });
      console.log('  case 40: B replied once to A, A could not send again, and the window labels the answer');
    });
  }

  /**
   * The activity-bar container is a CHAT WINDOW again, not a list of
   * sessions — the founder's words: "we can simple restore chat panel here."
   *
   * Four things are proved here, in the order a person meets them:
   *   - the view is the composer, with no "+" in its header;
   *   - it runs a conversation from its own composer;
   *   - it is a live session a tab can address by name, through the model;
   *   - hiding it and showing it again keeps the conversation, because the view
   *     is hidden and not disposed.
   */
  if (only.length === 0 || only.includes(41)) {
    it('case 41 — the activity bar is a chat that keeps its conversation and can be addressed', async () => {
      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];

      // The container's own command — the same one its icon runs.
      await field.openSidebarChat();
      await field.switchToSidebarFrame();
      const shape = await field.driver.executeScript(`
        return {
          q: !!document.getElementById('q'),
          go: !!document.getElementById('go'),
          neu: !!document.getElementById('new'),
          tabs: document.body.getAttribute('data-plato-tabs'),
        };
      `);
      if (!shape.q || !shape.go) {
        throw new Error(`SIDEBAR: the view is not a chat (saw ${JSON.stringify(shape)})`);
      }
      if (shape.neu) {
        throw new Error('SIDEBAR: the chat still draws a "+" in its header');
      }
      if (shape.tabs !== 'false') {
        throw new Error(`SIDEBAR: the view thinks it has tabs (data-plato-tabs=${shape.tabs})`);
      }

      // It is a conversation: it runs from its own composer.
      await field.setMode('auto');
      await setScript([{ match: 'TAB SIDE: hello', text: 'S: hello.' }]);
      const beforeSide = await field.send('TAB SIDE: hello');
      const sideEvents = await field.waitRunEnd(beforeSide, { tag: 'sidebar' });
      if (!sideEvents.some((e) => e.type === 'run-completed')) {
        throw new Error('SIDEBAR: its run did not complete');
      }
      await field.shot('case-41-sidebar-chat');

      // The conversation title becomes its address. Waited for, not guessed at:
      // the title call happens after the run.
      const title = 'TAB SIDE: hello';
      const entry = await waitForLiveEntry(title);
      if (entry === null) {
        throw new Error(`SIDEBAR: no live session named "${title}" is registered`);
      }
      if (entry.host !== 'vscode') {
        throw new Error(`SIDEBAR: it is registered as "${entry.host}", not a VS Code chat`);
      }

      // Hidden and shown again. The view must survive this with its
      // conversation intact — that is what makes it a window and not a list.
      await field.hideSidebarChat();
      await field.openSidebarChat();
      await field.switchToSidebarFrame();
      // The page may be the retained one or a rebuilt one; a rebuilt page asks
      // the host for its log on 'ready', so the conversation is waited for
      // rather than sampled once.
      const restoreDeadline = Date.now() + 10000;
      let again = { q: false, log: '' };
      while (Date.now() < restoreDeadline) {
        again = await field.driver.executeScript(`
          return {
            q: !!document.getElementById('q'),
            log: (document.getElementById('log') || {}).textContent || '',
          };
        `);
        if (again.q && String(again.log).includes(title)) break;
        await field.driver.sleep(250);
      }
      if (!again.q) {
        throw new Error('SIDEBAR: the composer is gone after hide/show');
      }
      if (!again.log.includes(title)) {
        throw new Error(
          `SIDEBAR: the conversation was lost across hide/show (log: "${
            String(again.log).replace(/\s+/g, ' ').slice(0, 160)
          }")`,
        );
      }

      // A tab addresses it by name, through the model — the messaging feature,
      // not a test-side shortcut.
      await field.webview.switchBack();
      await field.switchToChatFrame();
      await field.setMode('auto');
      await setScript([
        { match: 'TAB A: list sessions', calls: [{ tool: 'list_sessions', args: {} }] },
        { match: 'TAB A: list sessions', text: 'A: listed.' },
        {
          match: 'TAB A: message the sidebar',
          calls: [
            {
              tool: 'send_to_session',
              args: { to: title, text: 'TAB SIDE: from A' },
            },
          ],
        },
        { match: 'TAB A: message the sidebar', text: 'A: sent.' },
        { match: 'TAB SIDE: from A', text: 'S: got it.' },
      ]);

      /** The tool results the model was shown in the last turn for `prompt`. */
      const resultsFor = async (prompt) => {
        const log = await stubLog();
        const hits = log.log.filter((e) => {
          if (Number(e.toolsOffered) <= 0) return false;
          const texts = (e.userTexts || []).map(String).filter((t) => t.length > 0);
          return String(texts[texts.length - 1] || '').includes(prompt);
        });
        const turn = hits[hits.length - 1];
        return turn === undefined
          ? ''
          : (turn.toolResults || []).map((r) => String(r.head || '')).join('\n');
      };
      const waitForRun = async (before, needle, timeoutMs = 120000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const f of field.transcripts().filter((x) => !before.has(x))) {
            const first = readFileSync(f, 'utf8').split('\n')[0] || '{}';
            let task = '';
            try {
              task = String(JSON.parse(first).task || '');
            } catch {
              task = '';
            }
            if (task.includes(needle)) return f;
          }
          await field.driver.sleep(250);
        }
        throw new Error(`SIDEBAR: no run appeared for "${needle}"`);
      };

      const listBefore = await field.send('TAB A: list sessions');
      const listRun = await waitForRun(listBefore, 'TAB A: list sessions');
      await field.waitRunTerminal(listRun, 90000);
      const listed = await resultsFor('TAB A: list sessions');
      if (!listed.includes(title)) {
        throw new Error(`SIDEBAR: the model's session list does not name it:\n${listed}`);
      }

      const inboundBefore = new Set(field.transcripts());
      const sendBefore = await field.send('TAB A: message the sidebar');
      const sendRun = await waitForRun(sendBefore, 'TAB A: message the sidebar');
      await field.waitRunTerminal(sendRun, 90000);
      const delivered = await resultsFor('TAB A: message the sidebar');
      if (!delivered.includes('delivered to')) {
        throw new Error(`SIDEBAR: the send did not reach it:\n${delivered}`);
      }
      const inboundRun = await waitForRun(inboundBefore, 'TAB SIDE: from A');
      const inboundEvents = await field.waitRunTerminal(inboundRun, 90000);
      if (!inboundEvents.some((e) => e.type === 'run-completed')) {
        throw new Error('SIDEBAR: the run started by the message never completed');
      }
      if (!readFileSync(inboundRun, 'utf8').includes('Message from another Plato session')) {
        throw new Error('SIDEBAR: the inbound run was not told where the task came from');
      }

      // And the window shows it, named as a message from the other session.
      await field.webview.switchBack();
      await field.switchToSidebarFrame();
      const seen = await field.logText();
      if (!seen.includes('TAB SIDE: from A')) {
        throw new Error(
          `SIDEBAR: the message never appeared (log: "${seen
            .replace(/\s+/g, ' ')
            .slice(0, 160)}")`,
        );
      }
      // The shell uppercases the row's label through CSS, and getText returns
      // the RENDERED text, so this must not be case-sensitive.
      if (!/from\s/i.test(seen)) {
        throw new Error(
          `SIDEBAR: the row does not name a sender (log: "${seen
            .replace(/\s+/g, ' ')
            .slice(0, 400)}")`,
        );
      }

      MANIFEST.push({
        case: 41,
        run: 1,
        mode: 'auto',
        orchestration: 'solo',
        title: 'The activity bar is a chat that keeps its conversation and can be addressed',
        transcript: inboundRun,
        transcriptOk: true,
        screenFailures: [],
      });
      console.log('  case 41: the sidebar is a chat, survives hide/show, and a tab messaged it by name');
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
    restoreHomeMcp();
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
