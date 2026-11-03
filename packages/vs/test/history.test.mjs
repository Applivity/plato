/**
 * M3b checkpoint 2b host test: History, session resume, title generation,
 * and folding, through the EXISTING IDE host and the unchanged chat HTML.
 *
 * What it proves:
 *   - an idle /compact folds the oldest turns into a summary row, TELLS the
 *     user how many messages it accounted for, and removes nothing (D49aa);
 *   - the first completed run of an untitled conversation generates a title
 *     with the same model, persists it, and tells the page;
 *   - a rename wins, and a later run never overwrites it;
 *   - History lists the live conversation first, then saved chats and runs;
 *   - resuming a saved chat restores its log and its title, and is refused
 *     while a run is active;
 *   - closing the panel archives the conversation, so History fills without
 *     an explicit New Chat.
 *
 * It does NOT prove WebView2 rendering. The real Visual Studio window and its
 * screenshots are the other witness.
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
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-history-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-history-root-'));
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

async function setScript(steps, observers = []) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, observers }),
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
    },
  ],
  'plato.model': 'stub:stub-model',
  'plato.reasoning': 'off',
  'plato.orchestration': 'solo',
  'plato.compaction.threshold': 0.8,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

/* ---- the state a user already has: a live log, and one saved chat -------- */

const seedLog = [];
for (let i = 1; i <= 15; i += 1) {
  seedLog.push({ k: 'msg', cls: 'you', who: 'You', text: `Question ${i}` });
  seedLog.push({ k: 'msg', cls: 'bot', who: 'Plato', text: `Answer ${i}` });
}
const saved = {
  id: 'saved-1',
  title: 'Older conversation',
  ts: '2026-10-20T10:00:00.000Z',
  log: [
    { k: 'msg', cls: 'you', who: 'You', text: 'Old question' },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Old answer' },
  ],
};
mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({
    'plato.chatMode': 'edit',
    'plato.chatLog': seedLog,
    'plato.chatTitle': '',
    'plato.chatSessions': [saved],
  }),
  'utf8',
);

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
    if (predicate(posts[i])) return Promise.resolve(posts[i]);
  }
  return new Promise((resolve, reject) => {
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
        resolve(message);
      },
    });
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function stateFile() {
  return JSON.parse(readFileSync(join(STATE, 'workspace-state.json'), 'utf8'));
}

async function waitState(predicate, label, timeoutMs = 15_000) {
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

async function runToEnd(host, task, from) {
  host.receive({ type: 'ask', text: task });
  const done = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    90_000,
  );
  assert.equal(done.type, 'done', JSON.stringify(done));
  return done;
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
  const restore = await waitPost((m) => m.type === 'restore', 'restore');
  assert.equal(restore.log.length, seedLog.length, 'the saved log is restored');
  assert.equal(restore.title, '', 'an untitled conversation starts with no title');

  /* ================================================================== */
  /* 1. /compact folds older turns without removing them                */
  /* ================================================================== */
  // 30 message rows, take the newest 12 pairs verbatim: 18 are covered.
  let mark = posts.length;
  host.receive({ type: 'slash-run', id: 'compact' });
  const foldNotice = await waitPost(
    (m) =>
      m.type === 'notice' &&
      m.text === 'Summary added for 18 earlier messages. Nothing was removed.',
    'the fold notice',
    mark,
  );
  assert.equal(
    foldNotice.text,
    'Summary added for 18 earlier messages. Nothing was removed.',
    'the fold says what it accounted for, and that nothing was removed',
  );
  const folded = await waitState(
    (s) => (chatValue(s, 'log') || []).some((e) => e.k === 'compact'),
    'the summary row in the log',
  );
  const foldedLog = chatValue(folded, 'log');
  assert.equal(
    foldedLog.length,
    seedLog.length + 1,
    'the fold ADDS a row; it never shrinks the transcript',
  );
  for (const row of seedLog) {
    assert.ok(
      foldedLog.some((e) => e.k === 'msg' && e.text === row.text),
      `the fold kept "${row.text}"`,
    );
  }
  const foldRestore = await waitPost(
    (m) =>
      m.type === 'restore' &&
      Array.isArray(m.log) &&
      m.log.some((e) => e.k === 'compact'),
    'the re-rendered log after the fold',
    mark,
  );
  assert.equal(foldRestore.log.length, foldedLog.length);

  /* ================================================================== */
  /* 2. The first completed run generates a title                       */
  /* ================================================================== */
  await setScript([{ text: 'Answer after the fold.' }]);
  mark = posts.length;
  await runToEnd(host, 'First task after the fold.', mark);
  const titlePost = await waitPost(
    (m) => m.type === 'title' && m.text === 'Field test run',
    'the generated title',
    mark,
    30_000,
  );
  assert.equal(titlePost.text, 'Field test run', 'the title comes from the model');
  await waitState(
    (s) => chatValue(s, 'title') === 'Field test run',
    'the generated title persisted',
  );

  /* ================================================================== */
  /* 3. A rename wins, and a later run does not overwrite it            */
  /* ================================================================== */
  mark = posts.length;
  host.receive({ type: 'rename', value: 'Release run' });
  await waitPost(
    (m) => m.type === 'title' && m.text === 'Release run',
    'the renamed title',
    mark,
  );
  await waitState((s) => chatValue(s, 'title') === 'Release run', 'the rename persisted');

  await setScript([{ text: 'Second answer.' }]);
  mark = posts.length;
  await runToEnd(host, 'Second task.', mark);
  await settle();
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'title').length,
    0,
    'a later run does not overwrite a title the user set',
  );
  assert.equal(chatValue(stateFile(), 'title'), 'Release run');

  /* ================================================================== */
  /* 4. History lists the live chat first, then the saved chat and runs */
  /* ================================================================== */
  mark = posts.length;
  host.receive({ type: 'openHistory' });
  const history = await waitPost((m) => m.type === 'history', 'the history payload', mark);
  assert.equal(history.chats[0].current, true, 'the live chat comes first');
  assert.equal(history.chats[0].title, 'Release run');
  const older = history.chats.find((c) => c.id === 'saved-1');
  assert.ok(older, 'the saved chat is listed');
  assert.equal(older.title, 'Older conversation');
  assert.equal(older.count, 2, 'the saved chat reports its message count');
  assert.ok(Array.isArray(history.runs) && history.runs.length > 0, 'runs are listed');
  const firstRun = history.runs.find((r) => r.task === 'First task after the fold.');
  assert.ok(firstRun, 'the first run is in the list');
  assert.equal(typeof firstRun.turns, 'number', 'a run reports its turns');

  /* ================================================================== */
  /* 5. Resuming a saved chat restores its log and its title            */
  /* ================================================================== */
  mark = posts.length;
  host.receive({ type: 'resumeChat', id: 'saved-1' });
  const resumed = await waitPost(
    (m) => m.type === 'restore' && m.title === 'Older conversation',
    'the resumed conversation',
    mark,
  );
  assert.equal(resumed.log.length, 2, 'the saved log replaced the live one');
  assert.equal(resumed.log[0].text, 'Old question');
  assert.equal(resumed.log[1].text, 'Old answer');
  await waitState(
    (s) => chatValue(s, 'title') === 'Older conversation',
    'the resumed title persisted',
  );
  const afterResume = await waitState(
    (s) => (chatValue(s, 'log') || []).length === 2,
    'the resumed log persisted',
  );
  assert.equal(chatValue(afterResume, 'log')[0].text, 'Old question');

  /* ================================================================== */
  /* 6. A resume is refused while a run is active                       */
  /* ================================================================== */
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: 'note.txt' } }], delayMs: 2_000 },
    { text: 'Finished after the resume attempt.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt slowly.' });
  // The run is `running` once preparation ends; a 2s model step keeps it live.
  await new Promise((resolve) => setTimeout(resolve, 700));
  host.receive({ type: 'resumeChat', id: 'saved-1' });
  await waitPost(
    (m) =>
      m.type === 'notice' &&
      m.text ===
        'A run is active — wait for it to finish before opening another conversation.',
    'the active-run refusal',
    mark,
  );
  await waitPost((m) => m.type === 'done', 'the slow run to finish', mark);
  assert.equal(
    posts.filter(
      (m, i) => i >= mark && m.type === 'restore' && m.title === 'Older conversation',
    ).length,
    0,
    'the refused resume did not replace the live conversation',
  );

  /* ================================================================== */
  /* 7. Closing the panel archives the conversation                     */
  /* ================================================================== */
  const beforeClose = stateFile();
  assert.equal(
    (beforeClose['plato.chatSessions'] || []).length,
    1,
    'one saved chat before the close',
  );
  const panel = host.panel();
  panel.dispose();
  const closed = await waitState(
    (s) => (s['plato.chatSessions'] || []).length === 2,
    'the conversation archived on close',
    20_000,
  );
  const archived = closed['plato.chatSessions'].find(
    (s) => s.title === 'Older conversation' && s.id !== 'saved-1',
  );
  assert.ok(archived, 'the closed conversation is in History');
  assert.ok(
    archived.log.some((e) => e.k === 'msg' && e.text === 'Read note.txt slowly.'),
    'the archive holds the conversation as it was',
  );
  await settle();
  assert.equal(disposed, true, 'the panel reported disposal');

  console.log('PASS M3b checkpoint 2b history, resume, title and folding');
  console.log(`  posts: ${posts.length}`);
  console.log(`  runs: ${join(STATE, 'workspace-state.json')}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill('SIGTERM');
}

if (failure !== null) {
  console.error('FAIL M3b checkpoint 2b history, resume, title and folding');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' +
      JSON.stringify(
        posts.slice(-14).map((p) => ({
          type: p?.type,
          text: typeof p?.text === 'object' ? p.text : p?.text,
        })),
      ),
  );
  console.error(`stub stderr: ${stubStderr}`);
  process.exitCode = 1;
}
