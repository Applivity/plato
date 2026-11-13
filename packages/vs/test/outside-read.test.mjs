/**
 * Host test: touching a path outside the project with the user's say-so (D49dk).
 *
 * What it proves, through the real host and card flow:
 *   - a read of a path outside the workspace raises the card, which names the
 *     path, says it is outside the project, says why Plato wants it, and offers
 *     exactly core's three answers with their hints — no folder answer;
 *   - "Allow once" lets the tool run and is FORGOTTEN: the next call asks again;
 *   - "Allow for this session" covers a later READ and a later WRITE with no
 *     card at all;
 *   - a NEW chat asks again: the memory is the chat session's, not a setting,
 *     and nothing is written to workspace state;
 *   - "Deny" is a normal tool result the model reads — the run continues, and
 *     for a write nothing is written;
 *   - a call carrying TWO outside paths (apply_patch) puts BOTH on the card,
 *     and denying it leaves both files absent.
 *
 * The page's drawing is pinned by `scripts/render/outside.mjs`; the core rules
 * by `packages/core/test/outsideRead.test.ts`.
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
const WRITTEN = join(AWAY, 'written.txt');
const DENIED = join(AWAY, 'denied.txt');
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

/** Core's three answers for a read; the card must carry exactly these. */
const READ_ANSWERS = [
  { choice: 'once', label: 'Allow once', hint: 'Just this one request.' },
  {
    choice: 'session',
    label: 'Allow for this session',
    hint: 'Anything outside the project until this chat ends.',
  },
  { choice: 'deny', label: 'Deny', hint: 'Nothing is read.' },
];

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

  /* ---- 1. The card: three answers, in core's order, no folder -------- */
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: ONE } }] },
    { text: 'Read it.' },
  ]);
  let mark = posts.length;
  host.receive(runStart('read the first file outside'));
  const card = await waitPost(
    (m) => m.type === 'outside-read',
    'the outside-path card',
    mark,
  );
  assert.equal(card.path, ONE, 'the card carries the path the model asked for');
  assert.equal(card.abs, ONE, 'and the path Plato resolved it to');
  assert.equal(card.kind, 'read', 'a read card says it is a read');
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
  assert.deepEqual(card.answers, READ_ANSWERS, 'the card carries core\'s three answers verbatim');
  assert.equal(card.folderLabel, undefined, 'there is no folder answer');

  /* ---- 2. Allow once: this call runs, the next asks again ------------ */
  host.receive({ type: 'outside-answer', value: 'once' });
  await waitPost((m) => m.type === 'done', 'the run allowed once', mark);
  assert.match(await lastToolText(), /first outside fact/, 'the model saw the file');

  await settle();
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: TWO } }] },
    { text: 'Read that one too.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read the second file outside'));
  const again = await waitPost(
    (m) => m.type === 'outside-read',
    'the card for the second call',
    mark,
  );
  assert.equal(again.abs, TWO, '"Allow once" was not remembered');

  /* ---- 3. Allow for this session: a later READ and WRITE, no card ---- */
  host.receive({ type: 'outside-answer', value: 'session' });
  await waitPost((m) => m.type === 'done', 'the run allowed for the session', mark);
  assert.match(await lastToolText(), /second outside fact/, 'the second read ran');

  await settle();
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: THREE } }] },
    { text: 'Read the third.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read another folder outside'));
  await waitPost((m) => m.type === 'done', 'the later read', mark);
  assert.equal(
    posts.slice(mark).filter((m) => m.type === 'outside-read').length,
    0,
    'the session answer covered a later read with no card',
  );
  assert.match(await lastToolText(), /third outside fact/, 'the later read ran');

  await settle();
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: WRITTEN, content: 'session write\n' } }] },
    { text: 'Wrote it.' },
  ]);
  mark = posts.length;
  host.receive(runStart('write a file outside'));
  await waitPost((m) => m.type === 'done', 'the later write', mark);
  assert.equal(
    posts.slice(mark).filter((m) => m.type === 'outside-read').length,
    0,
    'the session answer covered a later WRITE with no card',
  );
  assert.equal(
    existsSync(WRITTEN) && readFileSync(WRITTEN, 'utf8') === 'session write\n',
    true,
    'the write outside the project landed',
  );

  /* ---- 4. Deny a read: a normal result, and the run continues -------- */
  host.receive({ type: 'newChat', fromHeader: true });
  await settle(500);
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: ONE } }] },
    { text: 'Understood.' },
  ]);
  mark = posts.length;
  host.receive(runStart('read outside in a new chat'));
  const newCard = await waitPost(
    (m) => m.type === 'outside-read',
    'the card in the new chat',
    mark,
  );
  assert.equal(newCard.abs, ONE, 'a new chat asks again');
  host.receive({ type: 'outside-answer', value: 'deny' });
  const denied = await waitPost((m) => m.type === 'done', 'the run after a denial', mark);
  assert.equal(denied.type, 'done', 'a denial does not fail the run');
  const text = await lastToolText();
  assert.match(text, /user declined/, 'the model is told the user declined');
  assert.match(
    text,
    /ask for it again only if the task genuinely cannot be done otherwise/,
    'the model is told when a later ask is permitted',
  );
  assert.doesNotMatch(text, /first outside fact/, 'nothing was read');

  /* ---- 5. Deny a write: nothing is written, the run continues -------- */
  await settle();
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: DENIED, content: 'must not land\n' } }] },
    { text: 'Not written.' },
  ]);
  mark = posts.length;
  host.receive(runStart('write a file outside'));
  const writeCard = await waitPost(
    (m) => m.type === 'outside-read',
    'the write card',
    mark,
  );
  assert.equal(writeCard.kind, 'write', 'the card says the call is a write');
  assert.equal(writeCard.title, 'Write a file outside the project?');
  assert.equal(writeCard.answers[2].hint, 'Nothing is changed.');
  host.receive({ type: 'outside-answer', value: 'deny' });
  const writeDenied = await waitPost(
    (m) => m.type === 'done',
    'the run after a write denial',
    mark,
  );
  assert.equal(writeDenied.type, 'done', 'a write denial does not fail the run');
  assert.equal(existsSync(DENIED), false, 'the denied write wrote nothing');
  const writeText = await lastToolText();
  assert.match(writeText, /declined to write/, 'the model is told a write was declined');
  assert.match(writeText, /Nothing was written/, 'and that nothing was written');

  /* ---- 6. A call carrying TWO outside paths names both --------------- */
  // apply_patch is the real shape: a call can carry several paths, and a
  // mapping loop that kept only the first would ask consent for a change the
  // user was never shown. The assertions read the POSTED card's lines, so they
  // fail if the host dropped an entry even though core would list both.
  const PATCH_ONE = join(AWAY, 'patch-one.txt');
  const PATCH_TWO = join(AWAY2, 'patch-two.txt');
  await settle();
  await setScript([
    {
      calls: [{
        tool: 'apply_patch',
        args: {
          patches: [
            { path: PATCH_ONE, diffs: [{ search: 'old-one', replace: 'new-one' }] },
            { path: PATCH_TWO, diffs: [{ search: 'old-two', replace: 'new-two' }] },
          ],
        },
      }],
    },
    { text: 'Patched.' },
  ]);
  mark = posts.length;
  host.receive(runStart('patch two files outside'));
  const manyCard = await waitPost(
    (m) => m.type === 'outside-read',
    'the two-path card',
    mark,
  );
  assert.equal(manyCard.kind, 'write', 'the two-path card is a write card');
  assert.equal((manyCard.entries ?? []).length, 2, 'the card carries both entries');
  assert.ok(
    manyCard.lines.some((l) => l.includes(PATCH_ONE)),
    `the card names the first path: ${JSON.stringify(manyCard.lines)}`,
  );
  assert.ok(
    manyCard.lines.some((l) => l.includes(PATCH_TWO)),
    `the card names the second path: ${JSON.stringify(manyCard.lines)}`,
  );
  host.receive({ type: 'outside-answer', value: 'deny' });
  const patchDenied = await waitPost(
    (m) => m.type === 'done',
    'the run after the two-path denial',
    mark,
  );
  assert.equal(patchDenied.type, 'done', 'a two-path denial does not fail the run');
  assert.equal(existsSync(PATCH_ONE), false, 'the first file was not written');
  assert.equal(existsSync(PATCH_TWO), false, 'the second file was not written');

  // Nothing about the approvals was written to a setting.
  const raw = readFileSync(join(STATE, 'workspace-state.json'), 'utf8');
  assert.doesNotMatch(raw, /outsideSession|allowOnce|outsideRead|allowedFolders/i);

  console.log('PASS outside paths: card, allow once, session read+write, deny read+write, two-path card, new chat');
  console.log(`  card path: ${card.abs}`);
  console.log(`  requests: ${requests.length}`);

  host.panel()?.dispose();
} catch (error) {
  failure = error;
}

stub.kill();

if (failure !== null) {
  console.error('FAIL outside paths: card, allow once, session read+write, deny read+write, two-path card, new chat');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-12).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
