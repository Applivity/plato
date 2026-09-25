/**
 * The real-model pass.
 *
 * The scripted suite proves Plato's behaviour when the model does exactly
 * something. This one asks a real model to do the work and checks what Plato
 * does about it — which is the only way to test the JUDGEMENT half of the field
 * tests: whether the model actually asks a multi-select question, whether its
 * plan actually moves.
 *
 * Two rules make it fair:
 *
 *   1. **A real model is nondeterministic, so these assertions are looser than
 *      the scripted suite's, and their results are reported separately.** A flake
 *      here is not evidence of a Plato defect, and saying otherwise would be
 *      dishonest.
 *   2. **A precondition the model declines to meet is a finding about the model,
 *      not a failure of Plato.** If it never asks a question, the right report is
 *      "the model did not ask", not "the question card is broken" — so each test
 *      says which of the two it saw.
 *
 * Run with:  PLATO_FIELD_REAL=1 node scripts/field/run-field.mjs
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { By, Key, until } from 'selenium-webdriver';
import { VSBrowser, WebView, Workbench, Notification } from 'vscode-extension-tester';

import { DEMO_REPO, DATE_HELPER, VIEW_MODEL } from './cases.mjs';
import { Field } from './driver.mjs';
import { runsDirFor } from './verdict.mjs';

// Absolute, from this file — see the note in field.test.mjs (a startup EPERM on
// process.cwd kills Node before any code runs, so nothing may depend on it).
const SHOTS = join(import.meta.dirname, '..', '..', 'tmp', 'field', 'shots');
const RUNS = runsDirFor(DEMO_REPO);
const KEY_FILE = process.env['PLATO_FIELD_KEY_FILE'] ?? `${process.env['HOME']}/Desktop/demo-creds.rtf`;
const only = (process.env['FIELD_CASES'] ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

/**
 * The key, read from the founder's file at run time.
 *
 * Deliberately NOT copied anywhere: it is read here, typed into Plato's own key
 * dialog, and lives in VS Code's SecretStorage from then on. Nothing is written
 * to the repo, nothing is logged, and the value never appears in an assertion
 * message. `textutil` is used because the file is an .rtf.
 */
function readKey() {
  const txt = execFileSync('textutil', ['-convert', 'txt', '-stdout', KEY_FILE], { encoding: 'utf8' });
  const key = (txt.match(/sk-[A-Za-z0-9_-]+/) ?? [])[0];
  if (!key) throw new Error(`no sk-… key found in ${KEY_FILE}`);
  return key;
}

/**
 * How much the demo repo's working tree has changed, and in which files.
 *
 * Measured across the WHOLE repo rather than one named file, because a real model
 * decides where a change belongs. `real 9` was told to put a comment above the
 * URLDecode call in `SubmissionsViewModel.java`; it found the call in
 * `FormatterUtility.formatURL`, put it there, and reported exactly that. The write
 * landed and the gate was absent — which is what this case is about — but the
 * assertion watched the other file and failed a run that had done the job. **A
 * named-file assertion against a real model measures instruction-following, not the
 * behaviour under test.**
 */
function repoDiff() {
  const out = execFileSync('git', ['-C', DEMO_REPO, 'diff', '--numstat'], { encoding: 'utf8' });
  let lines = 0;
  for (const row of out.split('\n')) {
    if (!row.trim()) continue;
    const [added, removed] = row.split('\t');
    lines += (Number(added) || 0) + (Number(removed) || 0);
  }
  const names = execFileSync('git', ['-C', DEMO_REPO, 'diff', '--name-only'], { encoding: 'utf8' })
    .split('\n')
    .filter((n) => n.trim())
    .map((n) => n.split('/').pop());
  return { lines, names };
}

async function setApiKey(driver, key) {
  await new Workbench().executeCommand('Plato: Set API Key');
  await driver.sleep(800);
  const picks = await driver.findElements(By.css('.quick-input-list .monaco-list-row'));
  if (picks.length > 0) {
    const box = await driver.findElement(By.css('.quick-input-box input'));
    await box.sendKeys('deepseek');
    await driver.sleep(400);
    await box.sendKeys(Key.ENTER);
    await driver.sleep(600);
  }
  const input = await driver.wait(until.elementLocated(By.css('.quick-input-box input')), 15000);
  await input.sendKeys(key);
  await input.sendKeys(Key.ENTER);
  await driver.sleep(600);
  console.log('  api key stored for the deepseek connection (value never printed)');
}

/**
 * Every question card raised during the current case, captured while still on
 * screen.
 *
 * A LIST, not a single value, and that distinction was a real reporting bug. The
 * old code kept only the last card, so `boxes=0 circles=3` was read as "the model
 * never asked a multi-select question" when it described only the final card — the
 * first card in that very run had three questions whose kind was never recorded.
 * A one-shot capture cannot answer a question about the whole run.
 */
let questionCards = [];

/**
 * Waits for a run to finish, answering whatever the model raises.
 *
 * The policy differs from the scripted suite on purpose: this pass APPROVES
 * writes and commands (that is how a real run gets far enough to be judged),
 * but it refuses nothing silently — every card it answers is logged with the
 * decision, so the screen record and the transcript can be compared afterwards.
 *
 * A question card is answered the way a user would: the first option on each
 * question, then Submit. What the answer SAYS is irrelevant here; the card's
 * behaviour (tabs, boxes rather than circles, ticks surviving) is what is under
 * test, so its state is captured while it is live.
 */
async function drive(field, prompt) {
  const before = await field.send(prompt);
  return field.waitRunEnd(before, {
    // Approve EVERYTHING. This pass measures whether the gates exist and behave,
    // not whether a denial path works — and a real agent doing real work asks for
    // far more approvals than any hand-written list allows. An earlier version
    // allowed six and then denied, and the model read the denial as the user
    // refusing: it re-planned, ran for fifteen minutes and never landed the change.
    // Cards are still counted and reported, so the gating evidence survives.
    plan: 'all',
    tag: prompt.slice(0, 30),
    timeoutMs: 900000,
    question: async () => {
      // Captured while the card is live: by the time the run ends it is closed.
      // Appended, never overwritten — a run may ask more than once, and the only
      // way to say "the model asked for a multi-select" is to have looked at every
      // card it raised.
      questionCards.push(await field.questionState());
      await field.tickOptions(1);
      await field.shot('real-question-card');
      // One pick per question, then Submit. A disabled Submit is an error rather
      // than a silence, so a card that cannot close fails the case instead of
      // looking like a hang — which is how three real cases were lost.
      await field.answerAllQuestions({ picks: 1 });
    },
  });
}

describe('Plato field tests — real model', function () {
  this.timeout(1800000);
  let driver;
  let field;

  before(async () => {
    driver = VSBrowser.instance.driver;
    await new Workbench().executeCommand('Plato: Open Chat');
    await driver.sleep(3000);
    await setApiKey(driver, readKey());
    try {
      await new Notification().dismissAll();
    } catch {
      /* see the scripted spec: clearToasts is the working path */
    }
    await driver.sleep(500);
    field = new Field(driver, new WebView(), { runsDir: RUNS, shotsDir: SHOTS });
    await field.enter();
  });

  const cases = [
    {
      n: 1,
      title: 'the guard refuses a protected-file command (real model decides to try)',
      mode: 'plan',
      prompt: 'Run this exact shell command and show me its raw output: cat notes.keystore',
      check: async (events) => {
        const notes = [];
        const cards = field.cardsSeen.length;
        if (cards !== 0) notes.push(`CARDS: expected none, saw ${cards}`);
        // A refusal is invisible in the transcript (finding F1), so the honest
        // assertion is negative: the command never completed.
        if (events.some((e) => e.type === 'tool-event' && e.tool === 'shell' && (e.phase === 'done' || e.phase === 'allowed'))) {
          notes.push('TRANSCRIPT: the shell command ran, which it must not');
        }
        return notes;
      },
    },
    {
      n: 2,
      title: 'plan mode: reads allowed, a build refused (real model chooses the commands)',
      mode: 'plan',
      prompt: 'Using shell commands, show me the last 10 commits that touched DateHelper.java, the current git status, and the list of .java files under app/src/main/java.',
      check: async (events) => {
        const notes = [];
        if (field.cardsSeen.length !== 0) notes.push(`CARDS: expected none in plan, saw ${field.cardsSeen.length}`);
        const denied = events.some((e) => e.type === 'tool-event' && e.tool === 'shell' && e.phase === 'denied');
        notes.push(`observed: ${denied ? 'a command was refused' : 'nothing was refused (the model may have run only read-only commands)'}`);
        return notes;
      },
    },
    {
      n: 6,
      title: 'the model asks a multi-select question, and the card honours it',
      mode: 'plan',
      prompt: 'I want to refactor date handling here. Before you start, ask me the questions you need — and where I might reasonably want several things at once, offer that as a multi-select question.',
      question: true,
      check: async () => {
        const notes = [];
        // Read from the captures taken while each card was live — by the time the
        // run ends the cards are answered and their rows are gone.
        if (questionCards.length === 0) {
          // Two different failures used to read as one sentence. A question that
          // was never asked is a finding about the model; a card that was live and
          // never detected is a finding about this harness.
          notes.push(field.questionSeen
            ? 'a question card was detected but its state was not captured before it closed'
            : 'JUDGEMENT: no question card appeared — the model asked nothing (a finding about the model, not the card)');
          return notes;
        }
        // EVERY card, so the judgement is made about the run rather than about
        // whichever card happened to be last.
        questionCards.forEach((q, i) => {
          notes.push(`question card ${i + 1} of ${questionCards.length}: tabs=${q.tabs} questions=${Math.max(1, q.tabs)} rows=${q.rows} boxes=${q.boxes} circles=${q.circles}`);
        });
        const boxes = questionCards.reduce((n, q) => n + q.boxes, 0);
        const circles = questionCards.reduce((n, q) => n + q.circles, 0);
        notes.push(`across all ${questionCards.length} card(s): ${boxes} checkbox row(s), ${circles} radio row(s)`);
        if (boxes === 0) notes.push('JUDGEMENT: the model never offered a multi-select question this run, so the checkbox half is untested');
        if (circles === 0) notes.push('note: every question offered was multi-select, so the radio path is untested this run');
        return notes;
      },
    },
    {
      n: 7,
      title: 'the plan card appears and moves on real work',
      mode: 'edit',
      prompt: 'Look at the URL handling in SubmissionsViewModel.java around line 144 and fix what is wrong there. Work in steps and show me your plan.',
      check: async (events, log, secs) => {
        const notes = [];
        const plan = await field.planState();
        // The SCALE of the run, reported whether or not it passed. This case's only
        // hard assertion is the card's own invariant — never two steps in progress
        // at once — so a PASS here must not be read as "the run was sensible". A
        // real model that cannot build or run anything (no JVM in this workspace)
        // spent fourteen minutes, raised forty-five cards and rewrote the plan three
        // times, and still satisfied it.
        const toolCalls = events.filter((e) => e.type === 'tool-event' && e.phase === 'done').length;
        notes.push(`run: ${secs}s, ${field.cardsSeen.length} approval card(s), ${toolCalls} completed tool call(s)`);
        if (plan.cards === 0) {
          notes.push('JUDGEMENT: the model never wrote a plan — a finding about the model, not the card');
        } else {
          notes.push(`plan card: cards=${plan.cards} in_progress=${plan.inProgress} completed=${plan.completed} (newest card; ${plan.totalCompleted} completed across all cards)`);
          if (plan.inProgress > 1) notes.push(`PLAN: ${plan.inProgress} steps in progress at once, in the newest card`);
          if (plan.totalCompleted === 0) {
            notes.push('JUDGEMENT: not one step ever reached completed — the card rendered and moved, but the model finished nothing (a finding about the model, not the card)');
          }
        }
        return notes;
      },
    },
    {
      n: 9,
      title: 'auto: a real edit lands with no gate',
      mode: 'auto',
      prompt: 'Add a one-line comment above the URLDecode call in SubmissionsViewModel.java explaining what it does.',
      check: async () => {
        const notes = [];
        if (field.cardsSeen.length !== 0) notes.push(`CARDS: expected none in auto, saw ${field.cardsSeen.length}`);
        return notes;
      },
      onDisk: true,
    },
  ].filter((c) => only.length === 0 || only.includes(c.n));

  for (const c of cases) {
    it(`real ${c.n} — ${c.title}`, async () => {
      await field.newChat();
      field.cardsSeen = [];
      field.decisions = [];
      // Per case, not per file: a real model in plan mode may legitimately ask a
      // question in ANY case, and a stale capture would then be reported as this
      // case's question.
      questionCards = [];
      const before = c.onDisk ? repoDiff() : null;

      await field.setMode(c.mode);
      const startedAt = Date.now();
      const events = await drive(field, c.prompt);
      const secs = Math.round((Date.now() - startedAt) / 1000);
      await field.shot(`real-${c.n}-${c.mode}`);

      const notes = await c.check(events, await field.logText(), secs);
      if (c.onDisk) {
        const after = repoDiff();
        if (after.lines > before.lines) {
          notes.push(`disk: the run wrote into the repo (${before.lines} → ${after.lines} changed lines in ${after.names.join(', ')})`);
          // Reported, never failed: whether the model chose the file the prompt
          // named is instruction-following, and this case is about the GATE.
          if (!after.names.includes(VIEW_MODEL.split('/').pop())) {
            notes.push(`note: the write landed in a different file than the prompt named (${VIEW_MODEL.split('/').pop()})`);
          }
        } else {
          notes.push('DISK: nothing was written — auto was expected to write with no gate');
        }
      }

      console.log(`  real ${c.n} (${c.mode}): ${field.cardsSeen.length} card(s), ${field.decisions.length} decision(s)`);
      for (const n of notes) console.log(`    ${n}`);
      const failures = notes.filter((n) => /^(CARDS|TRANSCRIPT|DISK|PLAN):/.test(n));
      if (failures.length > 0) throw new Error(`real ${c.n}: ${failures.join(' | ')}`);
    });
  }
});
