#!/usr/bin/env node
/**
 * The M4 acceptance test — EXECUTED, not described (D49at).
 *
 * M4's definition of done is seven clauses; this turns them into something that
 * can pass or fail on evidence. The clauses were restated on 2026-09-25 with a
 * witness named for each, because **a clause with no witness is what made the
 * old one unfalsifiable** — and then the restated test was never run. This is
 * the runner for it.
 *
 * ```
 * node scripts/field/acceptance.mjs            # judge the harness's last run
 * node scripts/field/acceptance.mjs --run      # run the twelve cases, then judge
 * ```
 *
 * **Two witnesses, deliberately.** The spec (`field.test.mjs`) reports what it
 * saw on SCREEN, and this file recomputes the TRANSCRIPT verdict from the JSONL
 * independently. They are wrong in different ways — the driver knows what it
 * clicked but can be wrong about what that meant; the transcript knows what
 * Plato did but cannot see the screen — so a disagreement is reported rather
 * than averaged away.
 *
 * **The manifest is the join.** A transcript records its task and its root, never
 * which case produced it, so a judge over transcripts alone cannot tell whether
 * a clause's case ran at all. `field.test.mjs` writes `tmp/field/last-manifest.json`
 * per run; this file refuses to pass a clause whose case is missing from it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { verdict } from './verdict.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const MANIFEST = join(ROOT, 'tmp', 'field', 'last-manifest.json');

/**
 * The seven clauses, each with the cases that witness it.
 *
 * `screen` names the note prefix the spec uses for the half of a clause that
 * only exists on screen (a closing line, a card's contents). `transcript: false`
 * marks a clause whose evidence is entirely on screen, so this file does not
 * pretend to have judged it from the JSONL.
 *
 * **Two corrections to the table in D49at are recorded here, because a witness
 * that does not exist is worse than none:**
 *
 *  - **Clause 6 was listed as covered by the scripted cases and was not.** No
 *    case touched `web_fetch` at all. Case 15 is that witness.
 *  - **Clause 6 as written was also STALE.** It said `web_fetch` "asks in every
 *    mode including `auto`", but **D49ak amended D49p on 2026-09-24 so that
 *    `auto` fetches without asking** — the founder's decision. A clause that
 *    describes the pre-amendment product cannot be passed or failed, which is
 *    the very defect D49at exists to fix, so the clause is now stated as what
 *    the product does and its two halves name two different witnesses: the card
 *    in `edit` (case 15, real window) and the `auto` policy (`modes.test.ts`).
 *  - **Clause 3's third witness — "the model's log showing the content was never
 *    in a request" — is SUBSUMED, not separate.** The guard refuses by NAME
 *    before any tool opens anything, so no read runs, so no content can enter a
 *    request; verdict rule 2 asserts exactly that ("no shell or read call ran to
 *    completion"), which is the stronger claim. A direct content test would need
 *    a real deny-listed file with a known marker, and the audit keeps real
 *    secrets out of this harness on purpose.
 */
const CLAUSES = [
  {
    n: 1,
    text: 'A real change lands — 1–3 files edited, and the edit is on disk',
    cases: [5, 9],
    witness: 'the demo repo diff after the run (the spec asserts it per case)',
  },
  {
    n: 2,
    text: 'The gates hold, per mode: edit asks, plan refuses with no card, auto does not ask',
    cases: [2, 3, 4, 9],
    witness: 'screen and transcript (approval-requested says an ask was raised)',
  },
  {
    n: 3,
    text: 'A protected file’s VALUES reach a model only through a card the user answered',
    cases: [1, 21, 22, 23],
    // D49bc restated this clause. It used to say the values NEVER reach a model,
    // and that is no longer true by design: a file the masker cannot parse is
    // shown in full when the USER says so, which is the whole point of the card.
    // Saying "never" would make the clause pass for the wrong reason — or force
    // the card to be a refusal again, which is what it replaced.
    witness:
      'the model-result log showing the placeholder and not the value (1, 21, 23); ' +
      'the card, its cost line, and the value arriving only after the click (22)',
  },
  {
    n: 4,
    text: 'The observer path is LIVE in Duo, and its work is reported',
    cases: [16],
    witness: "the run's closing line (it does NOT require an intervention)",
    screen: 'OBSERVER',
  },
  {
    n: 5,
    text: 'The run’s account of itself is honest — unfinished plan, refusal, cancel',
    cases: [7, 10, 17],
    witness: 'the closing line and the log',
    screen: 'PLANNOTE',
  },
  {
    n: 6,
    text: 'Nothing leaves the machine unasked — egress asks wherever a user is in the loop, URL on the card',
    cases: [15],
    witness: 'the approval card in the transcript + the URL on screen; the `auto` half is `modes.test.ts`',
    screen: 'FETCH',
  },
  {
    n: 7,
    text: 'Stop works — cancel ends the run as cancelled and dismisses the card',
    cases: [10],
    witness: "run-completed {reason: 'cancelled'}, the card gone",
  },
];

function readEvents(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

/** Every run of ONE case (`n` is a case number, not the clause's list of them). */
function judgeCase(runs, n) {
  const mine = runs.filter((r) => r.case === n);
  if (mine.length === 0) return { ran: false, runs: [] };
  return {
    ran: true,
    runs: mine.map((r) => {
      const events = readEvents(r.transcript);
      if (events === null) {
        return { run: r.run, mode: r.mode, ok: false, why: 'transcript unreadable' };
      }
      const v = verdict(n, events);
      const failed = v.checks.filter((c) => !c.ok).map((c) => `${c.name} [${c.detail}]`);
      const screen = r.screenFailures ?? [];
      return {
        run: r.run,
        mode: r.mode,
        ok: v.ok && screen.length === 0,
        why: [...failed, ...screen].join(' | '),
      };
    }),
  };
}

function main() {
  const wantRun = process.argv.includes('--run');

  if (wantRun) {
    console.log('running the harness first (this packages a fresh VSIX and drives real VS Code)\n');
    const r = spawnSync('node', [join(import.meta.dirname, 'run-field.mjs')], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    // A non-zero exit is expected when a case fails — the judge below says which
    // clause that costs, which is more useful than the harness's own error.
    if (r.error) {
      console.error(`could not run the harness: ${r.error.message}`);
      process.exit(2);
    }
    console.log('');
  }

  const manifest = loadManifest();
  if (manifest === null) {
    console.error(
      `no manifest at ${MANIFEST}\n` +
        'The acceptance test judges a harness run. Do one of:\n' +
        '  node scripts/field/acceptance.mjs --run     (run the cases, then judge)\n' +
        '  node scripts/field/run-field.mjs            (run them yourself, then judge)',
    );
    process.exit(2);
  }

  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  console.log(`Plato — M4 acceptance test (D49at), from ${manifest.at ?? 'an unknown run'}`);
  console.log(`${runs.length} recorded run(s)\n`);

  let failed = 0;
  for (const c of CLAUSES) {
    let ok = true;
    const detail = [];
    const perCase = [];

    for (const n of c.cases) {
      const judged = judgeCase(runs, n);
      if (!judged.ran) {
        ok = false;
        perCase.push(`${n} NOT RUN`);
        detail.push(`case ${n}: no run in the manifest — the harness stopped before reaching it`);
        continue;
      }
      let caseOk = true;
      for (const r of judged.runs) {
        if (!r.ok) {
          caseOk = false;
          detail.push(`case ${n} run ${r.run} (${r.mode}): ${r.why}`);
        }
      }
      if (!caseOk) ok = false;
      perCase.push(`${n} ${caseOk ? 'PASS' : 'FAIL'}`);
    }

    if (!ok) failed += 1;
    console.log(`  clause ${c.n}  ${ok ? 'PASS' : 'FAIL'}  ${c.text}`);
    console.log(`            witness: ${c.witness}`);
    console.log(`            cases:   ${perCase.join(' · ')}`);
    for (const d of detail) console.log(`            ↳ ${d}`);
    console.log('');
  }

  const total = CLAUSES.length;
  const passed = total - failed;
  console.log(`${passed} of ${total} clauses pass.`);
  if (failed > 0) {
    console.log('\nM4 is NOT met. A clause above names the case and the reason.');
    process.exit(1);
  }
  console.log('\nM4’s acceptance test is met: every clause has a witness and every witness passed.');
}

main();
