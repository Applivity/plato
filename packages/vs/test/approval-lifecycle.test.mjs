/**
 * D49cg host test: three approval-lifecycle defects, through the real host.
 *
 * 1. FOLD REPLAY. Answering an approval writes a `card-done` row next to its
 *    `card-open`; a real `/compact` fold posts a restore, and the log it posts
 *    carries the pair. A late click on the rebuilt card posts nothing: no echo
 *    row, no new card, no file.
 * 2. CANCEL. Cancelling with an approval card open posts `approval-done` and
 *    writes the card's close with the word "cancelled"; a late click posts
 *    nothing, and the cancelled call never widens a session permission.
 * 3. QUEUED RUN. A run started from the queue posts `queue-run` (so the page
 *    can show the task and the run controls) and records the user row; pause
 *    and resume work during it, and a cancel of a queued run ends it cancelled.
 *
 * The page-side rendering of the same messages is pinned by
 * `scripts/render/runlifecycle.mjs`, which the lead runs on macOS.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatValue } from './chat-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-life-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-life-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const require = createRequire(import.meta.url);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const stub = spawn(
  process.execPath,
  [join(REPO, 'scripts/field/stub-model.mjs')],
  {
    // D44d amended: the fold and the run share one window. Without a number
    // the fixture could only ever test the fallback, so the stub advertises one.
    env: {
      ...process.env,
      PLATO_STUB_PORT: String(port),
      PLATO_STUB_CONTEXT: '8192',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let stubStderr = '';
stub.stderr.on('data', (chunk) => {
  stubStderr += String(chunk);
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`stub did not start. stderr: ${stubStderr}`)),
    15_000,
  );
  stub.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
  stub.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`stub exited ${code}. stderr: ${stubStderr}`));
  });
});

async function setScript(steps) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
}

const settings = {
  'plato.connections': [
    {
      id: 'stub',
      kind: 'openai',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: ['stub-model'],
      // Set before the first run refreshes the pool from /models; the stub
      // advertises the same number, so the two can never disagree.
      pool: [{ id: 'stub-model', maxContext: 8192 }],
    },
  ],
  'plato.model': 'stub:stub-model',
  'plato.reasoning': 'off',
  'plato.orchestration': 'solo',
  'plato.compaction.threshold': 0.95,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

const posts = [];
const waiters = [];
let disposed = false;

const transport = {
  html: '',
  setHtml(html) {
    transport.html = html;
  },
  post(message) {
    posts.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  },
  reveal() {},
  disposed() {
    disposed = true;
  },
  async request() {
    return undefined;
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 60_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) {
      return Promise.resolve(posts[i]);
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const recent = posts
        .slice(from)
        .slice(-10)
        .map((p) => p?.type ?? '?')
        .join(', ');
      reject(new Error(`timeout waiting for ${label}. recent posts: ${recent}`));
    }, timeoutMs);
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

function chatLog() {
  return chatValue(
    JSON.parse(readFileSync(join(STATE, 'workspace-state.json'), 'utf8')),
    'log',
  );
}

function echoRows() {
  return chatLog().filter(
    (e) => e.k === 'msg' && /^\[(allowed|denied)\]$/.test(e.text),
  ).length;
}

function filesInRoot() {
  return readdirSync(ROOT).sort();
}

async function runToEnd(host, task, from) {
  host.receive({ type: 'ask', text: task });
  return await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    120_000,
  );
}

let failure = null;
try {
  writeFileSync(join(ROOT, 'note.txt'), 'a stable note\n', 'utf8');
  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  assert.ok(transport.html.includes('<title>Plato</title>'), 'chat HTML');
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

  /* ================================================================== */
  /* 1. Fold replay                                                     */
  /* ================================================================== */
  // Auto for the filler runs, so they draw no cards; the last one is edit.
  host.receive({ type: 'mode', value: 'auto' });
  await settle();
  // D44d amended: the fold is measured, not counted — it runs once the history
  // reaches the threshold (95% of 8,192 tokens here) and keeps a quarter of the
  // window. Fourteen two-word runs make ~240 tokens, so the filler carries real
  // text: the conversation must outgrow the keep budget (2,048 tokens) for
  // `/compact` to have something older to summarise.
  const filler = 'the quick brown fox jumps over the lazy dog '.repeat(10);
  await setScript(
    Array.from({ length: 14 }, (_, i) => ({ text: `filler ${i + 1} ${filler}` })),
  );
  for (let i = 1; i <= 14; i += 1) {
    const mark = posts.length;
    const end = await runToEnd(host, `filler task ${i} ${filler}`, mark);
    assert.equal(end.type, 'done', `filler run ${i}: ${JSON.stringify(end)}`);
  }

  // One approval, answered yes, so the log holds a spent card.
  host.receive({ type: 'mode', value: 'edit' });
  await settle();
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'life-allowed.txt', content: 'yes' } }] },
    { text: 'Wrote it.' },
  ]);
  let mark = posts.length;
  host.receive({ type: 'ask', text: 'Write life-allowed.txt.' });
  await waitPost((m) => m.type === 'approval', 'the approval card', mark);
  host.receive({ type: 'approve', value: 'yes' });
  const firstRun = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the approved run',
    mark,
  );
  assert.equal(firstRun.type, 'done', JSON.stringify(firstRun));
  await settle();

  const opened = chatLog().filter((e) => e.k === 'card-open');
  const closed = chatLog().filter((e) => e.k === 'card-done');
  assert.equal(opened.length, 1, 'one card was opened');
  assert.equal(closed.length, 1, 'the answer wrote the card closed');
  assert.match(closed[0].title, /— allowed$/);
  const openAt = chatLog().findIndex((e) => e.k === 'card-open');
  assert.equal(
    chatLog()[openAt + 1].k,
    'card-done',
    'the close sits next to its open, which is what replay pairs',
  );

  // A REAL fold: /compact while idle re-renders the page from the log.
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'compact', text: '' });
  const folded = await waitPost(
    (m) =>
      m.type === 'restore' &&
      Array.isArray(m.log) &&
      m.log.some((e) => e.k === 'compact'),
    'the fold restore',
    mark,
    120_000,
  );
  assert.ok(folded.log.length > 0, 'the fold posted the conversation back');
  const foldOpen = folded.log.findIndex((e) => e.k === 'card-open');
  assert.ok(foldOpen >= 0, 'the card is in the folded log');
  assert.equal(
    folded.log[foldOpen + 1].k,
    'card-done',
    'the folded log carries the open/close pair, so replay can draw it spent',
  );

  // The late click: the host is not waiting on anything.
  const echoesBefore = echoRows();
  const filesBefore = filesInRoot();
  const cardsBefore = chatLog().filter((e) => e.k === 'card-done').length;
  host.receive({ type: 'approve', value: 'yes' });
  host.receive({ type: 'approve', value: 'no' });
  host.receive({
    type: 'approve-all',
    tool: 'write_file',
    sessionKey: 'write_file',
  });
  await settle();
  assert.equal(echoRows(), echoesBefore, 'a late click writes no echo row');
  assert.equal(
    chatLog().filter((e) => e.k === 'card-done').length,
    cardsBefore,
    'a late click closes no card',
  );
  assert.deepEqual(filesInRoot(), filesBefore, 'a late click writes no file');

  // And approve-all on a dead card must not widen the session: a fresh write
  // still draws a card.
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'life-after-late.txt', content: 'x' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write life-after-late.txt.' });
  const stillAsks = await waitPost(
    (m) => m.type === 'approval',
    'a card for the next write (the late approve-all did not widen the session)',
    mark,
  );
  assert.equal(stillAsks.tool, 'write_file');
  host.receive({ type: 'approve', value: 'no' });
  await waitPost((m) => m.type === 'done', 'the probe run', mark);
  assert.equal(existsSync(join(ROOT, 'life-after-late.txt')), false);

  /* ================================================================== */
  /* 2. Cancel closes the card                                          */
  /* ================================================================== */
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'life-cancelled.txt', content: 'x' } }] },
    { text: 'Should not run.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write life-cancelled.txt.' });
  await waitPost((m) => m.type === 'approval', 'the cancel card', mark);
  host.receive({ type: 'cancel' });
  const closedPost = await waitPost(
    (m) => m.type === 'approval-done',
    'the cancelled card to close',
    mark,
  );
  assert.match(String(closedPost.text), /— cancelled$/);
  await waitPost((m) => m.type === 'done', 'the cancelled run', mark);
  assert.equal(
    existsSync(join(ROOT, 'life-cancelled.txt')),
    false,
    'a cancelled write does not happen',
  );
  const cancelRow = chatLog().filter((e) => e.k === 'card-done').pop();
  assert.match(cancelRow.title, /— cancelled$/);

  // A late answer after the cancel is inert, and does not widen the session.
  const echoesAfterCancel = echoRows();
  host.receive({ type: 'approve', value: 'yes' });
  host.receive({
    type: 'approve-all',
    tool: 'write_file',
    sessionKey: 'write_file',
  });
  await settle();
  assert.equal(echoRows(), echoesAfterCancel, 'no echo after a cancelled card');
  assert.equal(
    existsSync(join(ROOT, 'life-cancelled.txt')),
    false,
    'no write after a cancelled card',
  );
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'life-after-cancel.txt', content: 'x' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write life-after-cancel.txt.' });
  await waitPost(
    (m) => m.type === 'approval',
    'a card after the cancel (the cancelled approve-all did not widen the session)',
    mark,
  );
  host.receive({ type: 'approve', value: 'no' });
  await waitPost((m) => m.type === 'done', 'the post-cancel probe', mark);

  /* ================================================================== */
  /* 3. A queued run sets the run UI, and its controls work             */
  /* ================================================================== */
  host.receive({ type: 'mode', value: 'auto' });
  await settle();
  await setScript([
    { text: 'First is done.', delayMs: 2_000 },
    // The queued run asks for a read: the tool loop gates before the call, so a
    // pause sent during the delayed model reply has a safe point to land on.
    { calls: [{ tool: 'read_file', args: { path: 'note.txt' } }], delayMs: 2_500 },
    { text: 'Queued one is done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'First task.' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  host.receive({ type: 'slash-run', id: 'queue', text: 'Queued task one.' });
  const queueRun = await waitPost(
    (m) => m.type === 'queue-run' && m.text === 'Queued task one.',
    'the queued run to announce itself',
    mark,
  );
  assert.equal(queueRun.text, 'Queued task one.');
  // Everything after this belongs to the queued run, not the first one.
  const queuedAt = posts.findIndex(
    (m) => m.type === 'queue-run' && m.text === 'Queued task one.',
  ) + 1;
  await settle();
  assert.ok(
    chatLog().some((e) => e.k === 'msg' && e.text === 'Queued task one.'),
    'the queued task is in the conversation, not only in the transcript',
  );

  // Pause and resume, on the queued run. The run is live now.
  host.receive({ type: 'pause' });
  const parked = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === true,
    'the queued run to park',
    queuedAt,
    60_000,
  );
  assert.equal(parked.text.parked, true);
  host.receive({ type: 'resume' });
  await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === false,
    'the queued run to resume',
    queuedAt,
  );
  await waitPost((m) => m.type === 'done', 'the queued run to finish', queuedAt);
  await settle();
  assert.equal(
    chatLog().filter((e) => e.k === 'msg' && e.text === 'Queued task one.').length,
    1,
    'the queued task is recorded once',
  );

  // A cancelled queued run ends cancelled, not complete.
  await setScript([
    { text: 'Long first run.', delayMs: 1_500 },
    { text: 'Queued cancel target.', delayMs: 4_000 },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Long first task.' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  host.receive({ type: 'slash-run', id: 'queue', text: 'Queued cancel target.' });
  await waitPost(
    (m) => m.type === 'queue-run' && m.text === 'Queued cancel target.',
    'the second queued run',
    mark,
  );
  const queuedCancelAt = posts.findIndex(
    (m) => m.type === 'queue-run' && m.text === 'Queued cancel target.',
  ) + 1;
  // The loop's first context event proves the run is past preparation, so the
  // cancel is aimed at a LIVE queued run rather than at the pre-run window.
  await waitPost(
    (m) => m.type === 'context',
    'the queued run to start',
    queuedCancelAt,
    60_000,
  );
  const cancelAt = posts.length;
  host.receive({ type: 'cancel' });
  const cancelledQueued = await waitPost(
    (m) => m.type === 'done',
    'the cancelled queued run',
    cancelAt,
  );
  assert.match(
    JSON.stringify(cancelledQueued.text ?? {}),
    /cancel/i,
    'the queued run that was cancelled says so',
  );

  /* ================================================================== */
  /* 4. The page still has its parts                                    */
  /* ================================================================== */
  assert.ok(transport.html.includes('id="modeBtn"'), 'the mode picker');
  assert.ok(transport.html.includes('id="pp"'), 'the pause button');

  const panel = host.panel();
  panel.dispose();
  await settle();
  assert.equal(disposed, true, 'the panel reported disposal');

  console.log('PASS D49cg approval lifecycle host');
  console.log(`  posts: ${posts.length}`);
  console.log(`  html: ${transport.html.length} chars`);
} catch (error) {
  failure = error;
} finally {
  stub.kill('SIGTERM');
}

if (failure !== null) {
  console.error('FAIL D49cg approval lifecycle host');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' +
      JSON.stringify(posts.slice(-12).map((p) => ({ type: p?.type, text: p?.text }))),
  );
  console.error(`stub stderr: ${stubStderr}`);
  process.exitCode = 1;
}
