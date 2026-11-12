/**
 * Host test: reading outside the project with the user's say-so (D49ck).
 *
 * What it proves, through the real host and card flow:
 *   - a read of a path outside the workspace raises the card, which names the
 *     path, says it is outside the project, says why Plato wants it, and offers
 *     Allow once / Allow this folder for this session / Deny;
 *   - "Allow once" lets the tool run and the model sees the file;
 *   - "Allow this folder" covers a SECOND file in it with no card;
 *   - "Deny" is a normal tool result the model reads — the run continues;
 *   - a NEW chat asks again: the folder memory is the chat session's, not a
 *     setting, and nothing is written to workspace state.
 *
 * The page's drawing is pinned by `scripts/render/outside.mjs`; the core rules
 * by `packages/core/test/outsideRead.test.ts`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-outside-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-outside-root-'));
const AWAY = mkdtempSync(join(tmpdir(), 'plato-vs-outside-away-'));
const AWAY2 = mkdtempSync(join(tmpdir(), 'plato-vs-outside-away2-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const require = createRequire(import.meta.url);

const ONE = join(AWAY, 'one.txt');
const TWO = join(AWAY, 'two.txt');
const THREE = join(AWAY2, 'three.txt');
writeFileSync(ONE, 'first outside fact\n', 'utf8');
writeFileSync(TWO, 'second outside fact\n', 'utf8');
writeFileSync(THREE, 'third outside fact\n', 'utf8');
mkdirSync(join(ROOT, 'src'), { recursive: true });
writeFileSync(join(ROOT, 'src', 'inside.txt'), 'inside\n', 'utf8');

mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({ 'plato.chatMode': 'auto', 'plato.chatLog': [] }),
  'utf8',
);

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

async function stubLog() {
  return (await fetch(`http://127.0.0.1:${port}/__log`)).json();
}

const posts = [];
const requests = [];
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
  async request(method, params) {
    requests.push({ method, params });
    return {};
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 60_000) {
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

const runStart = (text) => ({ type: 'ask', text });

/**
 * The tool result text the model was last shown. It searches back for the
 * newest turn that carried a result: the title call runs beside the run and
 * lands in the log with no tools, so the LAST entry is not always this run's.
 */
async function lastToolText() {
  const log = await stubLog();
  const turns = log.log ?? [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const results = turns[i].toolResults ?? [];
    if (results.length > 0) return results.map((r) => r.head).join('\n');
  }
  return '';
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

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

  /* ---- 1. Allow this folder ---------------------------------------- */
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: ONE } }] },
    { text: 'Read it.' },
  ]);
  let mark = posts.length;
  host.receive(runStart('read the first file outside'));
  const card = await waitPost(
    (m) => m.type === 'outside-read',
    'the outside-read card',
    mark,
  );
  assert.equal(card.path, ONE, 'the card carries the path the model asked for');
  assert.equal(card.abs, ONE, 'and the path Plato resolved it to');
  assert.equal(card.title, 'Read a file outside the project?');
  assert.ok(
    card.lines.some((l) => l.includes(ONE)) &&
      card.lines.some((l) => l.includes('outside the project')),
    `the card says which path and that it is outside: ${JSON.stringify(card.lines)}`,
  );
  assert.ok(
    card.why.includes('reading a file'),
    `the card says why Plato wants it: ${card.why}`,
  );
  assert.equal(card.once, 'Allow once');
  assert.equal(card.folderLabel, 'Allow this folder for this session');
  assert.equal(card.deny, 'Deny');
  host.receive({ type: 'outside-answer', value: 'folder' });
  await waitPost((m) => m.type === 'done', 'the approved run', mark);
  assert.match(await lastToolText(), /first outside fact/, 'the model saw the file');

  /* ---- 2. The allowed folder covers a second file, with no card ----- */
  await settle();
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: TWO } }] },
    { text: 'Read that one too.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read the second file in the same folder'));
  await waitPost((m) => m.type === 'done', 'the second run', mark);
  assert.equal(
    posts.slice(mark).filter((m) => m.type === 'outside-read').length,
    0,
    'the allowed folder covered the second file without a card',
  );
  assert.ok(
    posts.slice(mark).some(
      (m) => m.type === 'notice' && /you allowed this folder for this session/i.test(String(m.text)),
    ),
    'the user is told why no card appeared',
  );
  assert.match(await lastToolText(), /second outside fact/, 'the second file was read');

  /* ---- 3. Deny: a normal result, and the run continues --------------- */
  await settle();
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: THREE } }] },
    { text: 'Understood.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read a file in another folder'));
  const denyCard = await waitPost(
    (m) => m.type === 'outside-read',
    'the card for the other folder',
    mark,
  );
  assert.equal(denyCard.abs, THREE, 'a different folder asks again');
  host.receive({ type: 'outside-answer', value: 'deny' });
  const denied = await waitPost((m) => m.type === 'done', 'the run after a denial', mark);
  assert.equal(denied.type, 'done', 'a denial does not fail the run');
  const text = await lastToolText();
  assert.match(text, /user declined/, 'the model is told the user declined');
  assert.doesNotMatch(text, /third outside fact/, 'nothing was read');

  /* ---- 4. A new chat is a new session: it asks again ----------------- */
  await settle();
  host.receive({ type: 'newChat', fromHeader: true });
  await settle(500);
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: ONE } }] },
    { text: 'Read it again.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read the first file in a new chat'));
  const again = await waitPost(
    (m) => m.type === 'outside-read',
    'the card in the new session',
    mark,
  );
  assert.equal(again.abs, ONE, 'a later session asks again, for the same file');
  host.receive({ type: 'outside-answer', value: 'once' });
  await waitPost((m) => m.type === 'done', 'the new-chat run', mark);

  // Nothing about the approval was written to a setting.
  const raw = readFileSync(join(STATE, 'workspace-state.json'), 'utf8');
  assert.doesNotMatch(raw, /outsideFolders|allowOnce|outsideRead|allowedFolders/i);

  console.log('PASS outside reads: card, allow once, allow folder, deny, new chat');
  console.log(`  card path: ${card.abs}`);
  console.log(`  requests: ${requests.length}`);

  host.panel()?.dispose();
} catch (error) {
  failure = error;
}

stub.kill();

if (failure !== null) {
  console.error('FAIL outside reads: card, allow once, allow folder, deny, new chat');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-12).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
