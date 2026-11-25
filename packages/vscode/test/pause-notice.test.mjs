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
 * The host under test is this package's own compiled `out/extension.js` — the
 * same source the VS Code VSIX and the Visual Studio host ship. `vscode` is
 * replaced by the Visual Studio lane's shim, and the model is the field
 * harness's scripted stub. Both are other lanes' files: this test reads and
 * bundles them, and edits neither. If the shim or the stub moves, the build
 * or the start below fails and says which file it wanted.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const HOST_ENTRY = join(REPO, 'packages', 'vs', 'host', 'entry.ts');
const SHIM = join(REPO, 'packages', 'vs', 'host', 'shim', 'vscode.ts');
const STUB = join(REPO, 'scripts', 'field', 'stub-model.mjs');
const COMPILED = join(REPO, 'packages', 'vscode', 'out', 'extension.js');

for (const file of [HOST_ENTRY, SHIM, STUB, COMPILED]) {
  assert.ok(
    existsSync(file),
    `${file} is missing — the host must be built (tsc -b) and the other lanes' harness files must be in place`,
  );
}

const HOME = mkdtempSync(join(tmpdir(), 'plato-pause-notice-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-pause-notice-root-'));
const STATE = join(HOME, 'state');
const PLATO_HOME = join(HOME, '.plato');
const BUILD = mkdtempSync(join(tmpdir(), 'plato-pause-notice-build-'));
mkdirSync(PLATO_HOME, { recursive: true });
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

/* ------------------------------------------------------------ scripted model */

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

const port = await freePort();
const stub = spawn(process.execPath, [STUB], {
  env: { ...process.env, PLATO_STUB_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stubStderr = '';
stub.stderr.on('data', (chunk) => {
  stubStderr += String(chunk);
});
await new Promise((resolveStub, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`the stub did not start: ${stubStderr}`)),
    15_000,
  );
  stub.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer);
      resolveStub();
    }
  });
  stub.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`the stub exited ${code}: ${stubStderr}`));
  });
});

async function setScript(steps, observers) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, observers }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
}

/* ------------------------------------------------------------------- the host */

const bundle = join(BUILD, 'host.cjs');
await esbuild.build({
  entryPoints: [HOST_ENTRY],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'silent',
  plugins: [
    {
      name: 'vscode-shim',
      setup(build_) {
        build_.onResolve({ filter: /^vscode$/ }, () => ({ path: SHIM }));
      },
    },
  ],
});
const { start } = createRequire(import.meta.url)(bundle);

const settings = {
  'plato.connections': [
    {
      id: 'stub',
      kind: 'openai',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: ['stub-model'],
    },
  ],
  'plato.model': 'stub:stub-model',
  'plato.reasoning': 'off',
  'plato.orchestration': 'duo',
  'plato.compaction.threshold': 0.8,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

const posts = [];
// When each post reached the chat. The park cannot happen while the model is
// still answering, so the distance in TIME between the philosopher's line and
// the safe-point line is what separates "said at the answer" from "said at the
// park" — the demo's 90 seconds, in miniature.
const stamps = [];
const waiters = [];
const transport = {
  setHtml() {},
  post(message) {
    posts.push(message);
    stamps.push(Date.now());
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  },
  reveal() {},
  disposed() {},
  async request() {
    return undefined;
  },
};

function waitPost(predicate, label, from = 0, timeoutMs = 60_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return Promise.resolve(posts[i]);
  }
  return new Promise((resolvePost, reject) => {
    const timer = setTimeout(() => {
      const recent = posts
        .slice(from)
        .slice(-12)
        .map((p) => p?.type ?? '?')
        .join(', ');
      reject(new Error(`timeout waiting for ${label}. recent posts: ${recent}`));
    }, timeoutMs);
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        resolvePost(message);
      },
    });
  });
}

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
  writeFileSync(
    join(PLATO_HOME, 'DUO.yaml'),
    [
      'philosopher:',
      '  persona: aristotle',
      '  name: Aristotle',
      '  model: stub:stub-model',
      '  color: violet',
      '  pause: true',
      '  maxInterventions: 5',
      '',
    ].join('\n'),
    'utf8',
  );

  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });
  await host.execute('plato.openChat');
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

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
  await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === true,
    'the observer to park the run',
    mark,
  );

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

  host.receive({ type: 'resume' });
  const done = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the resumed run to finish',
    mark,
    90_000,
  );
  assert.equal(done.type, 'done', JSON.stringify(done));

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
  const log = await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
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
