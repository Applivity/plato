/**
 * The philosopher's pause line waits for the park.
 *
 * A philosopher's `pause` answer is a REQUEST. The run works on to its next
 * safe point — in the demo take that was another 90 seconds, with the footer
 * still reading "reading a file" and the buttons still Pause and Stop. The
 * line used to be posted at the answer, so the chat said paused while the run
 * was not. It is posted at the park now, and this test is the witness:
 *
 *   - the philosopher's line is not on screen while the run still works, so
 *     nothing but the park's own posts may sit between it and the safe-point
 *     line;
 *   - it is posted exactly once, with its reason and its colour unchanged,
 *     and before the safe-point line, so the chat reads reason, then what to
 *     do next.
 *
 * The host under test — this package's compiled `out/extension.js`, started
 * through the Visual Studio lane's shim against the field harness's scripted
 * model — is set up in `host-harness.mjs`, which names each of those files and
 * fails loudly if one moves.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  posts,
  stamps,
  stub,
  setScript,
  readStubLog,
  readRunEvents,
  readRuns,
  startHost,
  waitPost,
  writeDuo,
} from './host-harness.mjs';

const PAUSE_REASON =
  'The coder is about to write checkout.js, and price rules live in pricing.js.';
const PHILOSOPHER_LINE = `[Aristotle] paused the run — ${PAUSE_REASON}`;
const SAFE_POINT =
  'Plato paused at a safe point. Resume to continue, or type a note first.';

/** A read-only turn so no approval card can park the run. */
const read = (delayMs = 0) => ({
  calls: [{ tool: 'read_file', args: { path: 'note.txt' } }],
  ...(delayMs > 0 ? { delayMs } : {}),
});

let failure = null;
try {
  writeFileSync(join(ROOT, 'note.txt'), 'a stable note\n', 'utf8');
  writeDuo();
  const host = await startHost();

  // The second turn's model call is held for two seconds. The observer is
  // consulted when that turn starts, so its answer lands while the run is
  // unmistakably still working — and the run cannot park until the model
  // replies. A line posted at the answer is therefore drawn about two seconds
  // before the park; a line posted at the park is drawn with it.
  await setScript(
    [read(), read(2_000), read(), { text: 'Resumed and done.' }],
    [{ action: 'pause', message: PAUSE_REASON }],
  );

  const mark = posts.length;
  host.receive({
    type: 'ask',
    text: 'Read note.txt while the philosopher pauses.',
  });
  const park = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === true,
    'the observer to park the run',
    mark,
  );
  // The park screen offers the philosopher's own sentence back to the composer,
  // named by its speaker. The note is the raw sentence: the bracket prefix and
  // the line's full stop belong to the notice, not to the note.
  assert.equal(
    park.text?.note,
    PAUSE_REASON.replace(/[.!?]+$/, ''),
    'the park carries the philosopher\'s sentence without its prefix or full stop',
  );
  assert.equal(park.text?.by, 'Aristotle', 'the park names whose note it is');

  const pauseLines = posts.filter(
    (m, i) =>
      i >= mark && m.type === 'notice' && m.text === PHILOSOPHER_LINE,
  );
  assert.equal(
    pauseLines.length,
    1,
    'the philosopher\'s pause line is drawn once, with its reason and punctuation unchanged',
  );
  assert.equal(
    pauseLines[0].meta?.color,
    '#b48ad4',
    'the line keeps the philosopher\'s colour (violet)',
  );

  const pauseLine = posts.indexOf(pauseLines[0]);
  const safePoints = posts.filter(
    (m, i) => i >= mark && m.type === 'notice' && m.text === SAFE_POINT,
  );
  assert.equal(safePoints.length, 1, 'the safe-point line is drawn once');
  const safePoint = posts.indexOf(safePoints[0]);
  assert.ok(
    pauseLine < safePoint,
    'the philosopher\'s line comes before the safe-point line',
  );
  const away = stamps[safePoint] - stamps[pauseLine];
  assert.ok(
    away < 500,
    `the pause line was drawn ${away} ms before the park — it is the answer's, not the park's`,
  );

  // The defect this change fixes: the reason used to live only on screen. It
  // rides the bus now, so the run's own record keeps it — once, with its
  // colour — and keeps the safe-point line after it.
  const runEvents = readRunEvents();
  const recordedReasons = runEvents.filter(
    (e) => e.type === 'notice' && e.text === PHILOSOPHER_LINE,
  );
  assert.equal(
    recordedReasons.length,
    1,
    'the run record carries the philosopher\'s reason exactly once',
  );
  assert.equal(
    recordedReasons[0].color,
    '#b48ad4',
    'the recorded reason keeps the philosopher\'s colour (violet)',
  );
  const recordedSafe = runEvents.filter(
    (e) => e.type === 'notice' && e.text === SAFE_POINT,
  );
  assert.equal(
    recordedSafe.length,
    1,
    'the run record carries the safe-point line once',
  );
  assert.ok(
    runEvents.indexOf(recordedReasons[0]) < runEvents.indexOf(recordedSafe[0]),
    'the run record keeps the reason before the safe-point line',
  );

  // The park's placeholder tells the user to type a redirect and press Resume,
  // so the composer's words must travel with the click — the same contract the
  // CLI's `/continue <text>` has. This resume carries one, and the model's next
  // request is the witness that it was sent before the run continued.
  const NOTE = 'Confirm the target file before you touch it.';
  host.receive({ type: 'resume', note: NOTE });
  const release = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === false,
    'the host to report the release',
    mark,
  );
  assert.equal(
    release.text?.note,
    undefined,
    'a resume carries no note, so the park screen cannot offer a stale one',
  );
  const done = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the resumed run to finish',
    mark,
    90_000,
  );
  assert.equal(done.type, 'done', JSON.stringify(done));

  // The model's own request log is the witness that the note left the composer:
  // the loop drains guidance at the turn the resume wakes, so the first request
  // after the park carries the words the user pressed Resume with.
  const resumedLog = await readStubLog();
  assert.ok(
    resumedLog.log.some(
      (entry) =>
        entry.consumedStep !== 'observer' &&
        entry.userTexts.some((text) => text.includes(NOTE)),
    ),
    'the note pressed with Resume reached the model in its next request',
  );

  // A run stopped before it parks never speaks the held line: the request ran
  // out of run. The observer answers pause while the second turn's model call
  // is held, and Stop lands before that call returns, so the run ends cancelled
  // with no park to speak at.
  await setScript(
    [read(), read(1_000), { text: 'Never reached.' }],
    [{ action: 'pause', message: PAUSE_REASON }],
  );
  const mark2 = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt and let me stop it.' });
  await new Promise((r) => setTimeout(r, 250));
  host.receive({ type: 'cancel' });
  const stopped = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the stopped run to finish',
    mark2,
    90_000,
  );
  assert.equal(stopped.type, 'done', JSON.stringify(stopped));
  // The done card's closing note speaks to the person, so it says what they
  // did. `cancelled` is the record's word for the same event, and the record
  // keeps it — the screen does not.
  const stoppedNote = String(stopped.text?.note ?? '');
  assert.match(stoppedNote, /\bstopped\b/, 'a stopped run says stopped');
  assert.equal(
    /\bcancelled\b/.test(stoppedNote),
    false,
    'and does not say cancelled, which is the record\'s word',
  );
  const log = await readStubLog();
  assert.ok(
    log.log.some((entry) => entry.consumedStep === 'observer'),
    'the scenario is real: the philosopher answered pause in this run',
  );
  assert.equal(
    posts.filter(
      (m, i) => i >= mark2 && m.type === 'notice' && m.text === PHILOSOPHER_LINE,
    ).length,
    0,
    'a pause that never parked is never announced as a pause',
  );

  // The other two notices that used to go straight to the webview: guidance and
  // cancel. Neither reached the run record, so neither survived a reload. Both
  // must now be drawn once and kept in the run record with their colour. The
  // observer steers once, then stops the run; the model steps are held so the
  // observation re-arms between turns rather than racing the next one.
  const GUIDANCE = 'Check pricing.js before checkout.js sees a price.';
  const GUIDANCE_LINE = `[Aristotle] guidance: ${GUIDANCE}`;
  const CANCEL_REASON = 'The run is about to write the wrong file.';
  const CANCEL_LINE =
    `[Aristotle] cancelled the run — ${CANCEL_REASON.replace(/[.!?]+$/, '')}.`;
  await setScript(
    [read(), read(400), read(400), { text: 'Never reached.' }],
    [
      { action: 'guidance', message: GUIDANCE },
      { action: 'cancel', message: CANCEL_REASON },
    ],
  );
  const mark4 = posts.length;
  const TASK4 = 'Read note.txt while the philosopher steers.';
  host.receive({ type: 'ask', text: TASK4 });
  const steered = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the guided run to finish',
    mark4,
    90_000,
  );
  assert.equal(steered.type, 'done', JSON.stringify(steered));

  for (const line of [GUIDANCE_LINE, CANCEL_LINE]) {
    const seen = posts.filter(
      (m, i) => i >= mark4 && m.type === 'notice' && m.text === line,
    );
    assert.equal(seen.length, 1, `"${line}" is drawn exactly once`);
    assert.equal(
      seen[0].meta?.color,
      '#b48ad4',
      `"${line}" keeps its colour on screen`,
    );
  }

  // The run that carried them, named by its own header, keeps both once.
  const steeredRun = readRuns().find((r) =>
    r.events.some((e) => e.kind === 'header' && e.task === TASK4),
  );
  assert.ok(steeredRun, 'the guided run wrote its own record');
  for (const line of [GUIDANCE_LINE, CANCEL_LINE]) {
    const recorded = steeredRun.events.filter(
      (e) => e.type === 'notice' && e.text === line,
    );
    assert.equal(recorded.length, 1, `the run record carries "${line}" exactly once`);
    assert.equal(
      recorded[0].color,
      '#b48ad4',
      `the recorded "${line}" keeps its colour`,
    );
  }

  // The closing line for a pause that ran out of run. It is keyed to the
  // USER's own Pause button (`pauseRequested`), not to a philosopher's answer,
  // so this case drives that button: Pause is pressed while the model call is
  // in flight, the provider then dies before the call returns, and the run
  // ends with no safe point to stop at. The line must say so exactly once —
  // once on the bus, whose listener already sends every notice.
  await setScript([read(), read(3_000), { text: 'Never reached.' }], []);
  const mark3 = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt and let the provider fail.' });
  await new Promise((r) => setTimeout(r, 500));
  host.receive({ type: 'pause' });
  await new Promise((r) => setTimeout(r, 300));
  stub.kill();
  await waitPost((m) => m.type === 'error', 'the failed run to report', mark3);
  // The closing line is written in the run's `finally`, just after the error.
  await new Promise((r) => setTimeout(r, 300));
  const CLOSING = 'The run finished before the pause took effect.';
  const closing = posts.filter(
    (m, i) => i >= mark3 && m.type === 'notice' && m.text === CLOSING,
  );
  assert.equal(
    closing.length,
    1,
    `the closing line for a pause that ran out of run must be drawn once, drawn ${closing.length} times`,
  );
} catch (error) {
  failure = error;
} finally {
  stub.kill();
}

if (failure !== null) throw failure;
