/**
 * Host test: deleting chats from History, including the live one.
 *
 * What it proves:
 *   - deleting the CURRENT chat discards it — the log and the title are
 *     cleared, the page is told to start empty, and NO archive is written, so
 *     the conversation does not come back in History;
 *   - the saved chats are untouched by that delete, and History re-sent after
 *     it has no current entry;
 *   - Delete all removes the saved chats too, ends on the same empty chat, and
 *     leaves History with nothing in it;
 *   - neither action opens a host dialog: the page owns the two-step
 *     confirmation, so a host box would be a second, invisible guard.
 *
 * It does NOT prove the drawn page or its confirmations — the render suite
 * covers the controls, and the real window is the other witness.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatValue } from './chat-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-chatdelete-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-chatdelete-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const require = createRequire(import.meta.url);

const seedLog = [
  { k: 'msg', cls: 'you', who: 'You', text: 'Live question' },
  { k: 'msg', cls: 'bot', who: 'Plato', text: 'Live answer' },
];
const saved = [
  {
    id: 'saved-1',
    title: 'Saved one',
    ts: '2026-11-10T10:00:00.000Z',
    log: [
      { k: 'msg', cls: 'you', who: 'You', text: 'Saved question one' },
      { k: 'msg', cls: 'bot', who: 'Plato', text: 'Saved answer one' },
    ],
  },
  {
    id: 'saved-2',
    title: 'Saved two',
    ts: '2026-11-09T10:00:00.000Z',
    log: [{ k: 'msg', cls: 'you', who: 'You', text: 'Saved question two' }],
  },
];

mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({
    'plato.chatMode': 'edit',
    'plato.chatLog': seedLog,
    'plato.chatTitle': 'Live chat',
    'plato.chatSessions': saved,
  }),
  'utf8',
);

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

const emptyRestore = (m) =>
  m.type === 'restore' && Array.isArray(m.log) && m.log.length === 0;

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
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

  /* ================================================================== */
  /* 1. Deleting the current chat discards it, and writes no archive    */
  /* ================================================================== */
  let mark = posts.length;
  let requestMark = requests.length;
  host.receive({ type: 'deleteChat', id: '__current__' });
  const blanked = await waitPost(emptyRestore, 'the empty conversation after the delete', mark);
  assert.equal(blanked.title, '', 'the fresh chat has no title');

  // The user must land on the fresh chat. A `history` payload opens the
  // History page in the shell, so one sent after the restore would strand
  // them on an empty list; give a late one time to arrive and refuse it.
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    posts.slice(mark).filter((m) => m.type === 'history').length,
    0,
    'deleting the current chat does not re-open History',
  );

  const afterDelete = await waitState(
    (s) => (chatValue(s, 'log') || []).length === 0 && chatValue(s, 'title') === '',
    'the discarded log and title',
  );
  assert.equal(
    afterDelete['plato.chatSessions'].length,
    2,
    'the live chat is discarded, not archived: no session is added',
  );
  assert.deepEqual(
    afterDelete['plato.chatSessions'].map((s) => s.id),
    ['saved-1', 'saved-2'],
    'the saved chats are untouched',
  );
  assert.equal(
    requests.filter((r, i) => i >= requestMark && r.method === 'ui.message').length,
    0,
    'the host asks nothing; the page owns the confirmation',
  );

  // History re-sent after the delete lists only the saved chats.
  mark = posts.length;
  host.receive({ type: 'openHistory' });
  const history = await waitPost((m) => m.type === 'history', 'History after the delete', mark);
  assert.equal(history.chats.length, 2, 'History lists only the saved chats');
  assert.ok(
    history.chats.every((c) => !c.current),
    'there is no current entry for the discarded conversation',
  );
  assert.ok(
    history.chats.every((c) => c.title !== 'Live chat'),
    'the discarded conversation is not in History',
  );

  /* ================================================================== */
  /* 2. Delete all removes the saved chats too, and ends empty          */
  /* ================================================================== */
  mark = posts.length;
  requestMark = requests.length;
  host.receive({ type: 'deleteAllChats' });
  await waitPost(emptyRestore, 'the empty conversation after Delete all', mark);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    posts.slice(mark).filter((m) => m.type === 'history').length,
    0,
    'Delete all ends on the fresh chat, not on an empty History page',
  );
  const afterAll = await waitState(
    (s) => (s['plato.chatSessions'] || []).length === 0,
    'every chat removed from storage',
  );
  assert.equal(
    (afterAll['plato.chatSessions'] || []).length,
    0,
    'Delete all removes the saved chats',
  );
  assert.equal((chatValue(afterAll, 'log') || []).length, 0, 'the live log is cleared');
  assert.equal(chatValue(afterAll, 'title'), '', 'and its title with it');
  assert.equal(
    requests.filter((r, i) => i >= requestMark && r.method === 'ui.message').length,
    0,
    'Delete all asks nothing in the host either',
  );

  mark = posts.length;
  host.receive({ type: 'openHistory' });
  const emptyHistory = await waitPost(
    (m) => m.type === 'history',
    'History after Delete all',
    mark,
  );
  assert.deepEqual(emptyHistory.chats, [], 'History is empty after Delete all');

  host.panel()?.dispose();

  console.log('PASS chat delete: current chat, saved chats, Delete all');
  console.log(`  requests: ${requests.length}`);
  console.log(`  state: ${join(STATE, 'workspace-state.json')}`);
} catch (error) {
  failure = error;
}

if (failure !== null) {
  console.error('FAIL chat delete: current chat, saved chats, Delete all');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(`last requests: ${JSON.stringify(requests.slice(-6))}`);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-10).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
