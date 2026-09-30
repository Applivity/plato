/**
 * Transcript verdicts — the independent half of the field test.
 *
 * The field-test page made a promise: "every run writes a transcript to
 * ~/.plato/runs/…, one JSON event per line, and it records an
 * approval-requested entry per card plus a phase for every tool call, so 'no
 * card appeared' is verifiable from the file rather than from memory." This
 * file cashes that promise. It reads the JSONL and decides, on its own, whether
 * each field test passed.
 *
 * It is deliberately INDEPENDENT of the UI driver. The driver knows what it
 * clicked and can be wrong about what that means; the transcript only knows
 * what Plato did. When the two disagree, that disagreement is the finding.
 *
 * What the transcript cannot see, and why the checks are shaped as they are:
 * `transcript.ts` strips tool ARGUMENTS and approval PREVIEWS (file content can
 * carry secrets). So "the card named both files" is not checkable here — but
 * "one card covered the multi-file write, and the next write raised no card at
 * all" is, and that is the claim test 5 actually rests on.
 *
 * Usage:
 *   node scripts/field/verdict.mjs --case 5 --last 1
 *   node scripts/field/verdict.mjs --case 4 --transcripts a.jsonl b.jsonl
 *   node scripts/field/verdict.mjs --case 2 --root /path/to/workspace
 *   node scripts/field/verdict.mjs --list
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_ROOT = '/Users/ai/Desktop/HcadPublicAndroid-demo';

/** D46/D24c: the host keys runs by an 8-char sha1 of the workspace root. */
export function runsDirFor(root) {
  const key = createHash('sha1').update(root).digest('hex').slice(0, 8);
  return join(homedir(), '.plato', 'runs', key);
}

export function listTranscripts(root) {
  const dir = runsDirFor(root);
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return { dir, files: [] };
  }
  const files = names
    .map((n) => ({ path: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return { dir, files };
}

export function loadEvents(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Reduces an event stream to the few shapes the rules ask about. Turns matter
 * because "answered with 0 tool calls" (test 8) is a per-turn property, and
 * because a card belongs to the turn that raised it.
 */
export function analyse(events) {
  const header = events.find((e) => e.kind === 'header') ?? null;
  const turns = [];
  let current = null;
  for (const e of events) {
    if (e.kind === 'header') continue;
    if (e.type === 'turn-started') {
      current = { turn: e.turn, events: [] };
      turns.push(current);
      continue;
    }
    if (current === null) {
      current = { turn: 0, events: [] };
      turns.push(current);
    }
    current.events.push(e);
  }
  const of = (type) => events.filter((e) => e.type === type);
  return {
    header,
    turns,
    task: header?.task ?? '',
    root: header?.root ?? '',
    approvals: of('approval-requested'),
    decisions: of('approval-decided'),
    toolEvents: of('tool-event'),
    notices: of('notice').map((e) => e.text),
    completed: of('run-completed'),
    failed: of('run-failed'),
    /** Approval cards for one tool. */
    cardsFor: (tool) => of('approval-requested').filter((e) => e.tool === tool),
    /**
     * Calls of one tool that SUCCEEDED.
     *
     * D49bc: `phase === 'done'` is not enough, and the difference matters for
     * every rule that reads "the call was not refused". A tool the EXECUTOR
     * refused — a protected file, a bad path, a failed write — also comes back
     * with phase 'done'; only `ok` separates it from a call that worked. A rule
     * written on the phase alone passes a run in which the call failed.
     */
    doneFor: (tool) => of('tool-event').filter((e) => e.tool === tool && e.ok === true),
    /** Every tool-event for one tool, in order. */
    phasesFor: (tool) => of('tool-event').filter((e) => e.tool === tool),
    /** Tool calls made in the final turn — test 8's whole claim. */
    toolCallsInLastTurn: () => {
      const last = turns[turns.length - 1];
      if (!last) return 0;
      return last.events.filter((e) => e.type === 'tool-event' && e.phase === 'requested').length;
    },
  };
}

/** Every rule returns a list of named checks so a failure says which claim broke. */
const RULES = {
  // 1 — the secret guard refuses before the card stage.
  //
  // This case can only be judged PARTLY here, and the gap is worth knowing: the
  // pre-flight refusal in the loop (containment/secret) pushes a tool_result to
  // the model and emits NO bus event, so a refusal leaves no trace in the
  // transcript at all. From the file alone, "the guard refused it" and "the model
  // never called a tool" look identical. What the file CAN show is the claim the
  // field-test page actually rests on — no card was raised, and nothing touched
  // the file. That the refusal REACHED the model is checked against the scripted
  // model's own record (`expectModelTold` in the case, read by the spec), which
  // is the only witness to it.
  //
  // D49bb split the two halves of this case. The rule used to read "no shell OR
  // READ call ran to completion", and that is now WRONG for the second run: a
  // protected file reads, masked. Only the shell keeps the refusal — its output
  // cannot be masked before Plato has seen the values — so the rule names the
  // shell alone. The read's half is witnessed by `expectModelTold: '«masked:'`.
  1: (a) => [
    {
      name: 'no approval card was raised for a protected-file call',
      ok: a.approvals.length === 0,
      detail: `${a.approvals.length} card(s)`,
    },
    {
      name: 'no shell call ran to completion',
      ok: !a.toolEvents.some((e) => e.tool === 'shell' && (e.phase === 'done' || e.phase === 'allowed')),
      detail: summarise(a.toolEvents),
    },
    {
      name: 'the transcript shows a refusal or shows nothing at all (both are legal — see the note above)',
      ok: true,
      detail: summarise(a.toolEvents),
    },
  ],

  // 2 — plan: reading commands run unasked, the build is refused outright.
  2: (a) => [
    {
      name: 'no approval card was raised anywhere in plan mode',
      ok: a.approvals.length === 0,
      detail: `${a.approvals.length} card(s): ${a.approvals.map((e) => e.tool).join(', ') || 'none'}`,
    },
    {
      name: 'at least one shell command ran (a read-only command)',
      ok: a.phasesFor('shell').some((e) => e.phase === 'allowed' || e.phase === 'done'),
      detail: summarise(a.phasesFor('shell')),
    },
    {
      name: 'the build command was refused, not offered as a card',
      ok: a.phasesFor('shell').some((e) => e.phase === 'denied'),
      detail: summarise(a.phasesFor('shell')),
    },
  ],

  // 3 — edit: reading is free, executing asks.
  3: (a) => [
    {
      name: 'the read-only commands raised no card',
      ok: a.approvals.filter((e) => e.tool === 'shell').length <= 1,
      detail: `${a.approvals.filter((e) => e.tool === 'shell').length} shell card(s)`,
    },
    {
      name: 'the build DID raise a card',
      ok: a.cardsFor('shell').length >= 1,
      detail: `${a.cardsFor('shell').length} card(s)`,
    },
    {
      name: 'an approved shell call then ran',
      ok: a.phasesFor('shell').some((e) => e.phase === 'allowed' || e.phase === 'done'),
      detail: summarise(a.phasesFor('shell')),
    },
  ],

  // 4 — run once in plan (refuse) and once in edit (ask, then deny).
  4: (a) => [
    {
      name: 'a write tool was refused or declined — it never completed',
      ok: a.toolEvents.some((e) => (e.tool === 'write_file' || e.tool === 'apply_diff') && (e.phase === 'denied' || e.phase === 'declined')),
      detail: summarise(a.toolEvents.filter((e) => e.tool === 'write_file' || e.tool === 'apply_diff')),
    },
    {
      name: 'the declined write did not land',
      ok: !a.toolEvents.some((e) => (e.tool === 'write_file' || e.tool === 'apply_diff') && e.phase === 'done' && e.ok === false) &&
        !(a.decisions.some((d) => d.allowed === false) && a.toolEvents.some((e) => (e.tool === 'write_file' || e.tool === 'apply_diff') && e.phase === 'done')),
      detail: `decisions: ${a.decisions.map((d) => `${d.tool}=${d.allowed}`).join(', ') || 'none'}`,
    },
  ],

  // 5 — one card covers the multi-file patch, then that file stops asking.
  //
  // The card COUNT is deliberately NOT asserted here, and the reason is a real
  // property of the product: `approval-requested` is emitted by the LOOP for
  // every ask decision, while the HOST decides whether to actually draw a card —
  // session memory short-circuits `approve()` and returns true without one. The
  // count in the file is therefore an UPPER BOUND on cards shown, and the
  // field-test page's "an approval-requested entry per card" is not accurate.
  // The exact count belongs to the screen (the spec's card check); this side
  // asserts what only the file can show — that both patches ran, and neither was
  // refused.
  5: (a) => [
    {
      name: 'both patches of the multi-file change reached done',
      ok: a.phasesFor('apply_patch').filter((e) => e.phase === 'done').length >= 2,
      detail: `${a.phasesFor('apply_patch').filter((e) => e.phase === 'done').length} done`,
    },
    {
      name: 'neither patch was refused or declined',
      ok: !a.phasesFor('apply_patch').some((e) => e.phase === 'denied' || e.phase === 'declined'),
      detail: summarise(a.phasesFor('apply_patch')),
    },
  ],

  // 6 — the question card is not gated, and the answer comes back.
  6: (a) => [
    {
      name: 'ask_user raised no approval card',
      ok: a.cardsFor('ask_user').length === 0,
      detail: `${a.cardsFor('ask_user').length} card(s)`,
    },
    {
      name: 'the answer reached the model (the call completed)',
      ok: a.phasesFor('ask_user').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('ask_user')),
    },
  ],

  // 7 — the plan card is not gated, and the plan moved.
  7: (a) => [
    {
      name: 'todo_write raised no approval card',
      ok: a.cardsFor('todo_write').length === 0,
      detail: `${a.cardsFor('todo_write').length} card(s)`,
    },
    {
      name: 'at least one plan write completed, and one as an update',
      ok: a.phasesFor('todo_write').filter((e) => e.phase === 'done').length >= 2,
      detail: `${a.phasesFor('todo_write').filter((e) => e.phase === 'done').length} completed plan write(s)`,
    },
  ],

  // 8 — after a long run, the recap costs 0 tool calls.
  8: (a) => [
    {
      name: 'the final turn answered with no tool calls at all',
      ok: a.turns.length > 1 && a.toolCallsInLastTurn() === 0,
      detail: `${a.turns.length} turn(s), ${a.toolCallsInLastTurn()} tool call(s) in the last`,
    },
    {
      name: 'the recap was its own turn, not the first thing said',
      ok: a.turns.length >= 2,
      detail: `${a.turns.length} turn(s)`,
    },
  ],

  // 9 — auto: the write lands with no gate anywhere in the run.
  9: (a) => [
    {
      name: 'no approval card was raised anywhere',
      ok: a.approvals.length === 0,
      detail: `${a.approvals.length} card(s)${a.approvals.length > 0 ? ': ' + a.approvals.map((e) => e.tool).join(', ') : ''}`,
    },
    {
      name: 'the edit landed',
      ok: a.toolEvents.some((e) => (e.tool === 'write_file' || e.tool === 'apply_diff' || e.tool === 'apply_patch') && e.phase === 'done'),
      detail: summarise(a.toolEvents.filter((e) => e.tool.startsWith('write') || e.tool.startsWith('apply'))),
    },
  ],

  // 11 — the editor's verdict on a file Plato just wrote reaches the model
  // (D49av), and the record never lets silence pass for success.
  //
  // The second check is the one the case exists for. "The editor reported
  // nothing" and "the editor was never reached" are the same absence in every
  // naive reading, and the whole design turns on telling them apart — so the
  // transcript is required to carry a POSITIVE report, not merely the absence of
  // one. A window with no language server fails this on purpose: the feature does
  // not work there, and the case should say so rather than pass quietly.
  11: (a) => [
    {
      name: 'the write completed',
      ok: a.phasesFor('write_file').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('write_file')),
    },
    {
      name: 'the host recorded what the editor said, so silence is not read as success',
      ok: a.notices.some((t) => t.startsWith('diagnostics:')),
      detail:
        a.notices.filter((t) => t.startsWith('diagnostics:')).join(' | ') ||
        'no diagnostics notice at all',
    },
  ],

  // 10 — Stop, pressed while a question is on screen (D49as).
  //
  // The transcript's job here is to say the run really STOPPED, and to show that
  // the question was resolved rather than left dangling: a cancelled run must not
  // strand a tool call, because the model's next request would then carry an
  // unanswered tool_use and a strict server rejects it outright (D49r).
  10: (a) => [
    {
      name: 'the run ended as cancelled, not as a completion',
      ok: a.completed.some((e) => e.reason === 'cancelled'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the question call was resolved rather than left hanging',
      ok: a.phasesFor('ask_user').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('ask_user')),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 12 — the repetition bound (D49aw).
  //
  // The transcript has to show BOTH halves, because either one alone can be
  // faked. A run that nudged the model and never stopped would satisfy "a notice
  // exists" while looping forever; a run that stopped without telling the model
  // first would be a silent abort — which is the exact failure this feature
  // exists to prevent. And the stop note must name the CALL, because "the same
  // call repeated 5 times" tells a reader nothing they can act on.
  12: (a) => [
    {
      name: 'the model was told it was stuck, before anyone was asked',
      ok: a.notices.some((t) => /stuck on the same call|turns in a row have failed/i.test(t)),
      detail: a.notices.join(' | ') || 'no notices at all',
    },
    {
      name: 'the run ended as stuck, not as a completion',
      ok: a.completed.some((e) => e.reason === 'stuck'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the stop note names what Plato was doing, and leaves the user a way out',
      ok: a.notices.some((t) => /^Stopped/.test(t) && /updating its plan/.test(t) && /Nothing was lost/.test(t)),
      detail:
        a.notices.filter((t) => t.startsWith('Stopped')).join(' | ') || 'no stop note',
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 13 — the user answers "keep going" (D49aw).
  //
  // The mirror of case 12, and the transcript has to say the run FINISHED: a
  // product that raised the card and then stopped anyway would look identical on
  // screen while ignoring the user's answer outright.
  13: (a) => [
    {
      name: 'the run was stuck enough to be put to the user',
      ok: a.notices.some((t) => /stuck on the same call/i.test(t)),
      detail: a.notices.join(' | ') || 'no notices at all',
    },
    {
      name: 'and it CONTINUED — the card is a question, not a stop',
      ok: a.completed.some((e) => e.reason === 'complete'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 14 — turns that all fail, with no repetition to see (D49aw).
  //
  // Every call differs, so the repetition trigger cannot fire. A card here is
  // therefore evidence of the SECOND trigger and nothing else.
  14: (a) => [
    {
      name: 'the run said turns in a row had failed',
      ok: a.notices.some((t) => /turns in a row have failed/i.test(t)),
      detail: a.notices.join(' | ') || 'no notices at all',
    },
    {
      name: 'the run ended as stuck',
      ok: a.completed.some((e) => e.reason === 'stuck'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the stop note says nothing has worked and leaves a way out',
      ok: a.notices.some((t) => /^Stopped/.test(t) && /Nothing was lost/.test(t)),
      detail: a.notices.filter((t) => t.startsWith('Stopped')).join(' | ') || 'no stop note',
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 15 — D49at CLAUSE 6: nothing leaves the machine unasked.
  //
  // `web_fetch` is the only tool that sends something out. In `edit` — where a
  // user is in the loop — it asks, and this case is that ask. **In `auto` it
  // does NOT ask, by D49ak's amendment of D49p**, and that half is witnessed by
  // `modes.test.ts` rather than here, because no field case can witness a
  // decision not to ask without either touching the network or asserting
  // nothing.
  //
  // The card was DENIED by the driver, which is the point: the clause is about
  // the ask, and this harness touches no network by design, so a denial proves
  // the gate without a socket being opened.
  //
  // The URL on the card is SCREEN-only: the transcript drops `preview` (D24c,
  // because a write preview carries file content), so `acceptance.mjs` reads
  // that half from the spec's FETCH note. The two halves are deliberately in
  // different witnesses.
  15: (a) => [
    {
      name: 'web_fetch asked in edit — the card was raised',
      ok: a.cardsFor('web_fetch').length === 1,
      detail: `${a.cardsFor('web_fetch').length} web_fetch card(s)`,
    },
    {
      name: 'the fetch was refused at the gate and NOT SENT',
      ok: a.phasesFor('web_fetch').some((e) => e.phase === 'declined'),
      detail: summarise(a.phasesFor('web_fetch')),
    },
    {
      name: 'and no fetch ever ran',
      ok: !a.phasesFor('web_fetch').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('web_fetch')),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 16 — D49at CLAUSE 4: the observer path is LIVE in Duo.
  //
  // This case is judged mostly on SCREEN, and that is recorded rather than
  // hidden: "its activity is reported" is a fact about the run's closing line,
  // which exists only in the webview. What the transcript can witness is that a
  // real run happened with a team configured, which is here; the closing line's
  // `observer N checks` is the spec's OBSERVER note.
  //
  // **No check requires an intervention.** An observer who correctly stays quiet
  // must pass — requiring one would measure chattiness and push the product
  // toward a noisy philosopher, which is the fault the clause's wording exists
  // to avoid.
  16: (a) => [
    {
      name: 'the run did the real work under a team',
      ok: a.phasesFor('read_file').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('read_file')),
    },
    {
      name: 'the run completed normally',
      ok: a.completed.some((e) => e.reason === 'complete'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 17 — D49at CLAUSE 5: a run that ends with an unfinished plan says so.
  //
  // The transcript half: a plan was written and the run ended as an ordinary
  // completion, with no cap anywhere (there is no turn cap and no budget cap).
  // The note itself — "2 of 3 plan steps unfinished" — is on the closing line,
  // so it is the spec's PLANNOTE check. Before this case the note had never been
  // exercised end to end at all.
  17: (a) => [
    {
      name: 'the plan was written',
      ok: a.phasesFor('todo_write').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('todo_write')),
    },
    {
      name: 'the run ended as a completion — nothing here is a cap',
      ok: a.completed.some((e) => e.reason === 'complete'),
      detail: a.completed.map((e) => e.reason).join(', ') || 'no run-completed',
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 18 — undo, driven from the real composer (D49ax).
  //
  // The transcript's share is deliberately small, and that is the honest split:
  // the undo itself is NOT a run, so it writes no transcript at all. What the
  // transcript can say is that there was something TO undo — a write that
  // completed, in a mode with no card in front of it. Whether the bytes actually
  // came back is asserted on disk in `field.test.mjs`, which is the only witness
  // that can see it.
  //
  // All three runs must satisfy this: two create a file, one edits a file, and a
  // rule written for one of them would pass while the other two did nothing.
  18: (a) => [
    {
      name: 'a write completed, so the undo had something to act on',
      ok: ['write_file', 'apply_diff', 'apply_patch'].some((t) =>
        a.phasesFor(t).some((e) => e.phase === 'done'),
      ),
      detail: summarise(a.toolEvents),
    },
    {
      name: 'auto put no card in front of it',
      ok: a.approvals.length === 0,
      detail: a.approvals.length === 0 ? 'no card' : `${a.approvals.length} card(s)`,
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 19 — undo refuses a file the user edited (D49az).
  //
  // The transcript's share again is small and for the same reason: undo is not a
  // run. What it CAN witness here is the second half of the case's claim — that
  // the shell command really ran, so the report's "it cannot undo those" is
  // about something that happened rather than a warning about nothing.
  19: (a) => [
    {
      name: 'the shell command the report names really ran',
      ok: a.phasesFor('shell').some((e) => e.phase === 'done'),
      detail: summarise(a.phasesFor('shell')),
    },
    {
      name: 'both writes completed, so one could be refused and one restored',
      ok: a.phasesFor('write_file').filter((e) => e.phase === 'done').length === 2,
      detail: summarise(a.phasesFor('write_file')),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],

  // 20 — the only file is refused, and no card is drawn (D49az).
  //
  // The rule holds for BOTH runs, and it has to: run 1 creates the file and run
  // 2 edits it, so a check written for `apply_diff` alone passes on run 2 and
  // fails on run 1 with "no events" — which reads as a broken feature and is
  // really a rule pinned to one run of a two-run case.
  20: (a) => [
    {
      name: 'the write the undo must refuse completed',
      ok: ['write_file', 'apply_diff'].some((t) =>
        a.phasesFor(t).some((e) => e.phase === 'done'),
      ),
      detail: summarise(a.toolEvents),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],
  // D49bb. The transcript cannot see a masked value — tool results are not
  // recorded — so the rule asserts the two things it CAN see: the read of a
  // protected file was NOT refused, and the write that followed completed. The
  // value-level claims are the spec's, on the screen and on the disk.
  21: (a) => [
    {
      name: 'the protected file was read, not refused',
      ok: a.doneFor('read_file').length > 0,
      detail: summarise(a.toolEvents),
    },
    {
      name: 'no call was refused by the secret guard',
      ok: !a.toolEvents.some((e) => e.phase === 'refused'),
      detail: summarise(a.toolEvents.filter((e) => e.phase === 'refused')),
    },
    {
      name: 'the write that followed completed',
      ok: a.phasesFor('apply_diff').some((e) => e.phase === 'done'),
      detail: summarise(a.toolEvents),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],
  // D49bc. A protected file the masker cannot parse is OFFERED rather than
  // refused. The transcript sees the two halves that live there: the read was
  // not stopped by the secret guard, and it completed. Whether the model was
  // then shown the value — and whether the card said what the click costs — is
  // the spec's claim, on the stub's log and on the card.
  22: (a) => [
    {
      name: 'the unmaskable file was read, not refused',
      ok: a.doneFor('read_file').length > 0,
      detail: summarise(a.toolEvents),
    },
    {
      // BOTH reads completed. The second is the session memory: an answer that
      // was not remembered would ask again, and a user who has answered once
      // must not be asked the same question twice in one run.
      name: 'the second read completed too, without a second question',
      ok: a.doneFor('read_file').length === 2,
      detail: summarise(a.toolEvents),
    },
    {
      name: 'no call was refused by the secret guard',
      ok: !a.toolEvents.some((e) => e.phase === 'refused'),
      detail: summarise(a.toolEvents.filter((e) => e.phase === 'refused')),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],
  // D49bc, the other half. The value was reached INDIRECTLY by a shell command,
  // so the transcript cannot show the masking — that happens on the stub's log.
  // What the transcript must show is the part that could go wrong here: the call
  // ran (the token scan cannot see a glob) and the run did not fail.
  23: (a) => [
    {
      name: 'the indirect command was allowed to run, and it worked',
      ok: a.doneFor('shell').length > 0,
      detail: summarise(a.toolEvents),
    },
    {
      name: 'the run did not fail',
      ok: a.failed.length === 0,
      detail: a.failed.length === 0 ? 'no failure' : JSON.stringify(a.failed[0]),
    },
  ],
};

function summarise(events) {
  if (events.length === 0) return 'no events';
  return events.map((e) => `${e.tool}:${e.phase}`).join(' → ');
}

/** Runs one case's rules against one run's events. */
export function verdict(caseId, events) {
  const rule = RULES[caseId];
  if (!rule) return { ok: false, checks: [{ name: `no rules for case ${caseId}`, ok: false, detail: '' }] };
  const a = analyse(events);
  const checks = rule(a);
  return { ok: checks.every((c) => c.ok), checks, analysis: a };
}

function parseArgs(argv) {
  const out = { case: null, transcripts: [], last: 1, root: DEFAULT_ROOT, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--case') out.case = Number(argv[++i]);
    else if (a === '--transcripts') while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.transcripts.push(argv[++i]);
    else if (a === '--last') out.last = Number(argv[++i]);
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--list') out.list = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { dir, files } = listTranscripts(args.root);

  if (args.list) {
    console.log(`runs dir: ${dir}`);
    if (files.length === 0) console.log('  (no transcripts)');
    for (const f of files.slice(0, 20)) console.log(`  ${new Date(f.mtime).toISOString()}  ${f.path}`);
    return 0;
  }

  const chosen = args.transcripts.length > 0 ? args.transcripts : files.slice(0, args.last).map((f) => f.path);
  if (chosen.length === 0) {
    console.error(`no transcripts in ${dir}`);
    return 2;
  }

  let failures = 0;
  for (const file of chosen.reverse()) {
    const events = loadEvents(file);
    const header = events.find((e) => e.kind === 'header');
    console.log(`\n${file}`);
    console.log(`  task: ${String(header?.task ?? '').split('\n')[0].slice(0, 100)}`);
    if (args.case === null) {
      const a = analyse(events);
      console.log(`  turns=${a.turns.length} tools=${a.toolEvents.length} cards=${a.approvals.length} done=${a.completed.length} failed=${a.failed.length}`);
      continue;
    }
    const v = verdict(args.case, events);
    for (const c of v.checks) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  [${c.detail}]`);
      if (!c.ok) failures += 1;
    }
    console.log(`  => case ${args.case}: ${v.ok ? 'PASS' : 'FAIL'}`);
  }

  if (args.case !== null) {
    console.log(failures === 0 ? '\nVERDICT: PASS' : `\nVERDICT: FAIL (${failures})`);
  }
  return failures === 0 ? 0 : 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exit(main());
}
