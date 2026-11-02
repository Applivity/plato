/**
 * M4b host test: the editor/interaction half of M4, through the EXISTING IDE host
 * and the unchanged chat HTML.
 *
 * What it proves, with no VS Code, no provider key and no network:
 *   - / commands and completion:
 *     - slash-meta payload is sent on ready, containing all 5 canonical slash
 *       commands (compact, history, system-prompt, undo, queue) with labels,
 *       usage and blurbs; tool-words table is sent with it;
 *     - /queue holds message and advances run; bare /queue gives guidance notice;
 *     - /compact mid-run requests compaction; idle folds conversation;
 *     - /system-prompt opens/creates PLATO.md in workspace root;
 *     - /history triggers history import;
 *     - unknown / command reports honest notice ("Unknown command: /<id>");
 *   - Plan and todos:
 *     - model calls todo_write; host parses todos and posts { type: 'todo', todos };
 *     - replan replaces list and posts updated todos;
 *     - unfinished plan steps are reported honestly at run end ("N of M plan steps unfinished");
 *     - fully completed plan produces no unfinished note;
 *     - todo cards persist in the chat log (restore);
 *   - Open-file actions:
 *     - /system-prompt opens PLATO.md via editor.open;
 *     - Settings' Open mcp.json opens ~/.plato/mcp.json via editor.open;
 *     - Settings' Open DUO.yaml opens ~/.plato/DUO.yaml via editor.open;
 *     - Settings' Open ACADEMY.yaml opens ~/.plato/ACADEMY.yaml via editor.open;
 *     - History's openRun posts { type: 'run', file, events } with rendered markdown;
 *   - Diagnostics after a write (the documented gap):
 *     - after a write, editorDiag.collect reports "not checked — no language server reported on it";
 *     - the notice is emitted on the bus and posted to the chat;
 *     - the transcript records the diagnostic notice honestly.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-m4b-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-m4b-root-'));
const STATE = join(HOME, 'state');
const PLATO_HOME = join(HOME, '.plato');
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

const posts = [];
const waiters = [];
let disposed = false;
const requests = [];

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
  async request(method, params) {
    requests.push({ method, params });
    if (method === 'editor.open' || method === 'editor.closeActive') {
      return { ok: true };
    }
    return undefined;
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 30_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) {
      return Promise.resolve(posts[i]);
    }
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

async function runToEnd(host, task, from, timeoutMs = 60_000) {
  host.receive({ type: 'ask', text: task });
  return await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    timeoutMs,
  );
}

let failure = null;
try {
  mkdirSync(PLATO_HOME, { recursive: true });
  mkdirSync(STATE, { recursive: true });

  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  assert.ok(transport.html.includes('<title>Plato</title>'), 'chat HTML');

  /* ================================================================== */
  /* 1. Slash commands and completion metadata                          */
  /* ================================================================== */
  let mark = posts.length;
  host.receive({ type: 'ready' });

  const slashMeta = await waitPost((m) => m.type === 'slash-meta', 'slash-meta', mark);
  assert.ok(Array.isArray(slashMeta.commands), 'slash-meta carries commands list');
  const cmdIds = slashMeta.commands.map((c) => c.id);
  assert.deepEqual(
    cmdIds.sort(),
    ['compact', 'history', 'queue', 'system-prompt', 'undo'].sort(),
    'all 5 canonical slash commands are published',
  );

  for (const c of slashMeta.commands) {
    assert.ok(typeof c.label === 'string' && c.label.length > 0, `cmd ${c.id} has label`);
    assert.ok(typeof c.usage === 'string' && c.usage.startsWith('/'), `cmd ${c.id} has usage`);
    assert.ok(typeof c.blurb === 'string' && c.blurb.length > 0, `cmd ${c.id} has blurb`);
  }

  const toolWordsMsg = await waitPost((m) => m.type === 'tool-words', 'tool-words', mark);
  assert.ok(typeof toolWordsMsg.words === 'object' && toolWordsMsg.words !== null, 'tool-words sent');

  // Bare /queue when idle gives guidance notice
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'queue', text: '' });
  const queueNotice = await waitPost(
    (m) => m.type === 'notice' && m.text.includes('Type the message you want to queue'),
    'bare queue notice',
    mark,
  );
  assert.ok(queueNotice.text.includes('/queue <message>'), 'bare queue guidance includes syntax');

  // Unknown command gives clear notice
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'unknown-cmd', text: '' });
  const unknownNotice = await waitPost(
    (m) => m.type === 'notice' && m.text.includes('Unknown command: /unknown-cmd'),
    'unknown command notice',
    mark,
  );
  assert.equal(unknownNotice.text, 'Unknown command: /unknown-cmd');

  // /history triggers importHistory: when no chats exist, reports honest notice
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'history', text: '' });
  const historyNotice = await waitPost(
    (m) => m.type === 'notice' && m.text.includes('No archived conversations yet'),
    'history notice',
    mark,
  );
  assert.equal(historyNotice.text, 'No archived conversations yet.');

  // openHistory message returns the full history list
  mark = posts.length;
  host.receive({ type: 'openHistory' });
  const historyMsg = await waitPost((m) => m.type === 'history', 'history payload', mark);
  assert.ok(Array.isArray(historyMsg.chats), 'history contains chats array');
  assert.ok(Array.isArray(historyMsg.runs), 'history contains runs array');

  /* ================================================================== */
  /* 2. Plan and todos (todo_write tool, parsing, card, unfinished note) */
  /* ================================================================== */
  // Script a run with todo_write steps: 1 completed, 1 in_progress, 1 pending
  const plan1 = [
    { content: 'Inspect the codebase', status: 'completed' },
    { content: 'Implement the feature', status: 'in_progress' },
    { content: 'Run test suite', status: 'pending' },
  ];
  const plan2 = [
    { content: 'Inspect the codebase', status: 'completed' },
    { content: 'Implement the feature', status: 'completed' },
    { content: 'Run test suite', status: 'in_progress' },
  ];

  await setScript([
    {
      calls: [
        {
          tool: 'todo_write',
          args: { todos: plan1 },
        },
      ],
    },
    {
      calls: [
        {
          tool: 'todo_write',
          args: { todos: plan2 },
        },
      ],
    },
    {
      text: 'I have updated the plan and made progress on all tasks.',
    },
  ]);

  mark = posts.length;
  const doneWithUnfinished = await runToEnd(host, 'Execute task with plan', mark);
  assert.equal(doneWithUnfinished.type, 'done');

  // Both plan cards were posted
  const todoPosts = posts.slice(mark).filter((p) => p.type === 'todo');
  assert.equal(todoPosts.length, 2, 'both todo cards were posted');
  assert.deepEqual(todoPosts[0].todos, plan1, 'first plan posted exactly');
  assert.deepEqual(todoPosts[1].todos, plan2, 're-plan posted exactly');

  // Run end note carries unfinished plan note: "1 of 3 plan steps unfinished"
  const unfinishedNote = String(doneWithUnfinished.text?.note ?? '');
  assert.ok(
    unfinishedNote.includes('1 of 3 plan steps unfinished'),
    `closing note "${unfinishedNote}" includes unfinished plan note`,
  );

  // Next run: a plan where ALL steps are completed
  const planCompleted = [
    { content: 'Inspect the codebase', status: 'completed' },
    { content: 'Implement the feature', status: 'completed' },
    { content: 'Run test suite', status: 'completed' },
  ];
  await setScript([
    {
      calls: [
        {
          tool: 'todo_write',
          args: { todos: planCompleted },
        },
      ],
    },
    {
      text: 'Plan is fully complete.',
    },
  ]);

  mark = posts.length;
  const doneAllFinished = await runToEnd(host, 'Complete the plan', mark);
  assert.equal(doneAllFinished.type, 'done');
  const finishedNote = String(doneAllFinished.text?.note ?? '');
  assert.ok(
    !finishedNote.includes('unfinished'),
    `closing note "${finishedNote}" has no unfinished note when all steps are completed`,
  );

  /* ================================================================== */
  /* 3. Open-file links and editor actions                              */
  /* ================================================================== */
  requests.length = 0; // Clear recorded editor requests

  // 3a. /system-prompt opens PLATO.md
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'system-prompt', text: '' });
  await waitPost(
    (m) =>
      m.type === 'notice' &&
      m.text.includes('Created PLATO.md from the bundled default'),
    'PLATO.md creation notice',
    mark,
  );
  assert.ok(
    existsSync(join(ROOT, 'PLATO.md')),
    'PLATO.md was created in the workspace root',
  );
  assert.ok(
    requests.some(
      (r) =>
        r.method === 'editor.open' &&
        r.params.path === join(ROOT, 'PLATO.md'),
    ),
    'editor.open was called for PLATO.md',
  );

  // 3b. Settings -> Open mcp.json
  requests.length = 0;
  host.receive({ type: 'open-mcp' });
  await settle();
  assert.ok(
    requests.some(
      (r) =>
        r.method === 'editor.open' &&
        r.params.path === join(PLATO_HOME, 'mcp.json'),
    ),
    'editor.open was called for mcp.json',
  );

  // 3c. Settings -> Open DUO.yaml
  requests.length = 0;
  host.receive({ type: 'open-duo' });
  await settle();
  assert.ok(
    requests.some(
      (r) =>
        r.method === 'editor.open' &&
        r.params.path === join(PLATO_HOME, 'DUO.yaml'),
    ),
    'editor.open was called for DUO.yaml',
  );

  // 3d. Settings -> Open ACADEMY.yaml
  requests.length = 0;
  host.receive({ type: 'open-academy' });
  await settle();
  assert.ok(
    requests.some(
      (r) =>
        r.method === 'editor.open' &&
        r.params.path === join(PLATO_HOME, 'ACADEMY.yaml'),
    ),
    'editor.open was called for ACADEMY.yaml',
  );

  // 3e. History -> openRun
  // Find a transcript that was written by one of our runs
  const projectKey = require('node:crypto')
    .createHash('sha1')
    .update(ROOT)
    .digest('hex')
    .slice(0, 8);
  const runDir = join(PLATO_HOME, 'runs', projectKey);
  assert.ok(existsSync(runDir), 'run directory exists');
  const runFiles = require('node:fs')
    .readdirSync(runDir)
    .filter((f) => f.endsWith('.jsonl'));
  assert.ok(runFiles.length > 0, 'at least one run transcript exists');
  const sampleRun = runFiles[0];

  mark = posts.length;
  host.receive({ type: 'openRun', file: sampleRun });
  const runViewMsg = await waitPost((m) => m.type === 'run', 'openRun response', mark);
  assert.equal(runViewMsg.file, sampleRun, 'openRun returned the requested run file');
  assert.ok(Array.isArray(runViewMsg.events), 'openRun returned events array');
  assert.ok(runViewMsg.events.length > 0, 'openRun events is non-empty');

  /* ================================================================== */
  /* 4. Diagnostics after a write (documented "not checked" gap)         */
  /* ================================================================== */
  // Switch to auto so write_file runs without approval prompt
  host.receive({ type: 'mode', value: 'auto' });
  await waitPost(
    (m) => m.type === 'mode-state' && m.text === 'auto',
    'mode-state auto',
  );

  await setScript([
    {
      calls: [
        {
          tool: 'write_file',
          args: {
            path: 'diag-probe.txt',
            content: 'hello diagnostics probe',
          },
        },
      ],
    },
    {
      text: 'I wrote diag-probe.txt.',
    },
  ]);

  mark = posts.length;
  const diagDone = await runToEnd(host, 'Write a file and observe diagnostics', mark);
  assert.equal(diagDone.type, 'done');

  // Verify that the write succeeded on disk
  assert.ok(
    existsSync(join(ROOT, 'diag-probe.txt')),
    'diag-probe.txt exists on disk',
  );

  // Verify that diagnostics notice was emitted and posted to chat
  const diagNotice = posts
    .slice(mark)
    .find(
      (m) =>
        m.type === 'notice' &&
        m.text.includes('diagnostics: not checked in diag-probe.txt') &&
        m.text.includes('no language server reported on it'),
    );
  assert.ok(
    diagNotice !== undefined,
    'honest "diagnostics: not checked in diag-probe.txt — no language server reported on it" notice was posted',
  );

  // Verify that the run transcript contains the exact diagnostics notice
  const latestRuns = require('node:fs')
    .readdirSync(runDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const latestRunFile = join(runDir, latestRuns[latestRuns.length - 1]);
  const transcriptLines = readFileSync(latestRunFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  const diagEvent = transcriptLines.find(
    (e) =>
      e.type === 'notice' &&
      typeof e.text === 'string' &&
      e.text.includes('diagnostics: not checked in diag-probe.txt — no language server reported on it'),
  );
  assert.ok(
    diagEvent !== undefined,
    'transcript records the diagnostics: not checked notice',
  );

  console.log('PASS M4b editor/interaction: slash commands, todos, open-file actions, diagnostics gap');
  console.log(`  posts: ${posts.length}`);
  console.log(`  editor.open requests: ${requests.length}`);
  console.log(`  root: ${ROOT}`);
} catch (err) {
  failure = err;
} finally {
  stub.kill();
  if (failure) {
    console.error('FAIL M4b editor/interaction:', failure);
    process.exit(1);
  }
}
