/**
 * Host test: the display cap drops work before conversation.
 *
 * What it proves:
 *   - a log at the cap whose rows are mostly tool records loses TOOL ROWS when
 *     another row arrives, and every message row — including the opening
 *     question and answer — is still there afterwards;
 *   - the one `trim` note at the head says how many tool records went and that
 *     no message did;
 *   - the transcript is still bounded: the log does not exceed the cap.
 *
 * The pure rule is `planTrim` in core, where the message-only case and the
 * summary-loss warning are also pinned; this is the wiring and the state the
 * user would read after a reload. The drawn note is covered by the render suite.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatValue } from './chat-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-trim-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-trim-root-'));
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
    env: { ...process.env, PLATO_STUB_PORT: String(port) },
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

/* The state the user already has: a conversation at the cap, mostly work. */
const seedLog = [
  { k: 'msg', cls: 'you', who: 'You', text: 'Opening question' },
  { k: 'msg', cls: 'bot', who: 'Plato', text: 'Opening answer' },
];
const SEED_TOOLS = 300;
for (let i = 0; i < SEED_TOOLS; i += 1) {
  seedLog.push({
    k: 'tool',
    tool: 'read_file',
    phase: 'done',
    digest: `src/file${i}.ts`,
    ok: true,
  });
}
for (let i = 0; i < 98; i += 1) {
  seedLog.push({ k: 'msg', cls: 'you', who: 'You', text: `Later question ${i}` });
}
assert.equal(seedLog.length, 400, 'the fixture is exactly at the cap');
const MSG_COUNT = seedLog.filter((e) => e.k === 'msg').length;

mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({
    'plato.chatMode': 'edit',
    // A title, so the run does not spend a model call naming the chat.
    'plato.chatTitle': 'Seeded conversation',
    'plato.chatLog': seedLog,
  }),
  'utf8',
);

const posts = [];
const waiters = [];

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
  disposed() {},
  async request() {
    return {};
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 90_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return Promise.resolve(posts[i]);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${label}`)),
      timeoutMs,
    );
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

function stateFile() {
  return JSON.parse(readFileSync(join(STATE, 'workspace-state.json'), 'utf8'));
}

async function waitState(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate(stateFile())) return stateFile();
    } catch {
      // The shim writes atomically; a read can still land mid-move.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for workspaceState: ${label}`);
}

let failure = null;
try {
  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings: {
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
      'plato.orchestration': 'solo',
      'plato.compaction.threshold': 0.8,
      'plato.secrets.protect': [],
      'plato.secrets.allow': [],
      'plato.search.respectGitignore': false,
    },
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

  // One more exchange: the pushes that follow cross the cap.
  await setScript([{ text: 'One more answer.' }]);
  const mark = posts.length;
  host.receive({ type: 'ask', text: 'One more task.' });
  const done = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the run',
    mark,
  );
  assert.equal(done.type, 'done', JSON.stringify(done));

  const state = await waitState(
    (s) => (chatValue(s, 'log') || []).length <= 400,
    'the log back within the cap',
  );
  const log = chatValue(state, 'log');

  /* The cap kept the transcript bounded. */
  assert.ok(log.length <= 400, `the log is bounded (${log.length})`);

  /* Every message row is still there — the opening pair above all. */
  for (const row of seedLog) {
    if (row.k !== 'msg') continue;
    assert.ok(
      log.some((e) => e.k === 'msg' && e.text === row.text),
      `the message "${row.text}" survived the trim`,
    );
  }
  const messages = log.filter((e) => e.k === 'msg');
  assert.ok(
    messages.length >= MSG_COUNT,
    `no seeded message was dropped (${messages.length} >= ${MSG_COUNT})`,
  );
  assert.ok(
    messages.some((e) => e.text === 'Opening question'),
    'the opening question is still the first word of the conversation',
  );
  assert.ok(
    messages.some((e) => e.text === 'One more task.'),
    'the new task is there too',
  );

  /* Work went instead: fewer tool rows than the seed. */
  const tools = log.filter((e) => e.k === 'tool');
  assert.ok(
    tools.length < SEED_TOOLS,
    `tool records were dropped (${tools.length} < ${SEED_TOOLS})`,
  );

  /* One note at the head, accurate about what it took. */
  const notes = log.filter((e) => e.k === 'trim');
  assert.equal(notes.length, 1, 'one trim note, not a pile of them');
  assert.equal(log[0].k, 'trim', 'the note sits at the head');
  const note = log[0];
  assert.equal(note.messages, 0, 'the note says no message was lost');
  assert.ok(note.tools >= 3, `the note counts the tool records (${note.tools})`);
  assert.equal(
    note.dropped,
    note.tools + note.messages,
    'the total is the work plus the conversation',
  );
  assert.equal(note.lostSummary, false, 'no summary existed, and none was lost');

  console.log('PASS display cap: tool rows go before message rows');
  console.log(`  log ${log.length}, messages ${messages.length}, tools ${tools.length}`);
  console.log(`  note: tools ${note.tools}, messages ${note.messages}`);

  host.panel()?.dispose();
} catch (error) {
  failure = error;
}

stub.kill();

if (failure !== null) {
  console.error('FAIL display cap: tool rows go before message rows');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-10).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
