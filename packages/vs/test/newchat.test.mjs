/**
 * Gap 16 host test: the New Chat confirmation, through the EXISTING IDE host
 * and the unchanged chat HTML.
 *
 * What it proves:
 *   - `+ new` (and the menu command) ask first, with the warning kind, the
 *     core's exact message, and the core's "New Chat" action label;
 *   - a cancel changes nothing: the live log, its title and History stay as
 *     they were;
 *   - an answer archives the live conversation in History, clears the log and
 *     the title, and tells the page to start empty.
 *
 * It does NOT prove the C# shell or the dialog's window. The real Visual
 * Studio window is that witness; the defect this test guards was a host box
 * that blocked without ever appearing.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatValue } from './chat-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-newchat-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-newchat-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const require = createRequire(import.meta.url);

const CONFIRM = {
  kind: 'warning',
  message: 'Start a new chat? The current conversation will be cleared.',
  actions: ['New Chat'],
};

const seedLog = [
  { k: 'msg', cls: 'you', who: 'You', text: 'First question' },
  { k: 'msg', cls: 'bot', who: 'Plato', text: 'First answer' },
];

mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({
    'plato.chatMode': 'edit',
    'plato.chatLog': seedLog,
    'plato.chatTitle': 'Live title',
    'plato.chatSessions': [],
  }),
  'utf8',
);

const posts = [];
const requests = [];
const waiters = [];
let answer; // undefined = the user closes the dialog without an answer.

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
    if (method === 'ui.message') {
      return answer === undefined ? {} : { action: answer };
    }
    return {};
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 15_000) {
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

async function waitRequest(predicate, label, from = 0, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = from; i < requests.length; i += 1) {
      if (predicate(requests[i])) return requests[i];
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for ${label}`);
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
          baseUrl: 'http://127.0.0.1:1/v1',
          models: ['stub-model'],
        },
      ],
      'plato.model': 'stub:stub-model',
    },
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  assert.ok(transport.html.includes('<title>Plato</title>'), 'chat HTML');
  // The Visual Studio window has no editor title bar to hold a new-chat
  // button, so its own header keeps one: the shim states no `newChat`
  // capability and the shell draws the chip unless a host says false. This
  // asserts the flag the page's script reads and the chip's markup. The
  // script's removal for VS Code, and this chip's survival here, run only in
  // a WebView2; no test below claims to witness the drawn header.
  assert.ok(
    transport.html.includes('data-plato-new="true"'),
    'the Visual Studio window keeps the header new-chat chip',
  );
  assert.ok(
    transport.html.includes('id="new"'),
    'the new-chat chip is still in the chat markup',
  );
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

  /* ================================================================== */
  /* 1. A cancel leaves the conversation alone                          */
  /* ================================================================== */
  answer = undefined;
  let mark = posts.length;
  let requestMark = requests.length;
  host.receive({ type: 'newChat' });
  const asked = await waitRequest(
    (r) => r.method === 'ui.message',
    'the New Chat confirmation',
    requestMark,
  );
  assert.deepEqual(asked.params, CONFIRM, 'the confirmation carries the core copy');

  await settle();
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'restore' && m.log?.length === 0)
      .length,
    0,
    'a cancel does not blank the conversation',
  );
  const afterCancel = stateFile();
  assert.equal(chatValue(afterCancel, 'log').length, 2, 'the log is untouched');
  assert.equal(chatValue(afterCancel, 'title'), 'Live title', 'the title is untouched');
  assert.equal(
    (afterCancel['plato.chatSessions'] || []).length,
    0,
    'a cancel writes no archive',
  );

  /* ================================================================== */
  /* 2. An answer archives, clears, and resets the title                */
  /* ================================================================== */
  answer = 'New Chat';
  mark = posts.length;
  requestMark = requests.length;
  host.receive({ type: 'newChat' });
  await waitRequest((r) => r.method === 'ui.message', 'the second confirmation', requestMark);
  const blanked = await waitPost(
    (m) => m.type === 'restore' && Array.isArray(m.log) && m.log.length === 0,
    'the empty conversation',
    mark,
  );
  assert.equal(blanked.title, '', 'a new chat has no title');

  const afterNew = await waitState(
    (s) => (chatValue(s, 'log') || []).length === 0,
    'the cleared log',
  );
  assert.equal(chatValue(afterNew, 'title'), '', 'the title is reset');

  const archived = afterNew['plato.chatSessions'][0];
  assert.ok(archived, 'the conversation is in History');
  assert.equal(archived.title, 'Live title', 'the archive keeps the live title');
  assert.equal(archived.log.length, 2, 'the archive holds the whole conversation');
  assert.equal(archived.log[0].text, 'First question');

  host.panel()?.dispose();

  console.log('PASS gap 16 New Chat confirmation');
  console.log(`  requests: ${requests.length}`);
  console.log(`  state: ${join(STATE, 'workspace-state.json')}`);
} catch (error) {
  failure = error;
}

if (failure !== null) {
  console.error('FAIL gap 16 New Chat confirmation');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(`last requests: ${JSON.stringify(requests.slice(-6))}`);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-10).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
