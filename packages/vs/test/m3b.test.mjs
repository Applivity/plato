/**
 * M3b checkpoint 1 host test: modes and approvals through the sidecar host.
 *
 * What it proves, through the EXISTING IDE host and the unchanged chat HTML:
 *   - the plan/edit/auto picker switches live, says when the switch applies,
 *     and persists the mode in workspaceState;
 *   - a switch made mid-run reaches the next tool call;
 *   - the mode-request card approves and declines, with the same notices the
 *     VS Code extension shows, and a decline leaves the mode alone;
 *   - a write is denied (no file) and approved (file on disk);
 *   - "allow every edit this session" answers the card, suppresses the next
 *     card, and is cleared by a mode switch;
 *   - /queue holds a message, runs it after the current run finishes, and is
 *     held — not drained — when a run is cancelled;
 *   - pause parks the run at a safe point and resume lets it finish;
 *   - cancel releases every parked card: approval, question, stuck, reveal,
 *     and mode request.
 *
 * The fake copy assertions are the point of the last section: checkpoint 1
 * requires the SAME visible copy as the VS Code extension. Because the host
 * and the HTML are shared, a drift here is a real product defect.
 *
 * It does NOT prove WebView2 rendering. The real Visual Studio window and its
 * screenshots are the other witness.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
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
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-m3b-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-m3b-root-'));
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

async function setScript(steps, modelsDelayMs = 0) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, modelsDelayMs }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
}

async function stubLog() {
  return await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
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
  // The reveal card needs a protected text file the masker cannot parse.
  'plato.secrets.protect': ['*.m3b-secret'],
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function stateFile() {
  return JSON.parse(
    readFileSync(join(STATE, 'workspace-state.json'), 'utf8'),
  );
}

async function waitState(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(stateFile())) return stateFile();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for workspaceState: ${label}`);
}

/** One run: ask, then wait for the terminal post. */
async function runToEnd(host, task, from) {
  host.receive({ type: 'ask', text: task });
  return await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    60_000,
  );
}

function postIndexOf(predicate, from = 0) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return i;
  }
  return -1;
}

let failure = null;
try {
  // ---- boot ------------------------------------------------------------
  writeFileSync(
    join(ROOT, 'note.txt'),
    'a stable note\n',
    'utf8',
  );
  // Plain text, but one JSON line: the masker cannot account for it, so a
  // protected read raises the reveal card (D49bc).
  writeFileSync(
    join(ROOT, 'blob.m3b-secret'),
    '{"token":"m3b-value"}\n',
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
  assert.ok(transport.html.includes('<title>Plato</title>'), 'chat HTML');
  host.receive({ type: 'ready' });
  const restore = await waitPost((m) => m.type === 'restore', 'restore');
  assert.equal(restore.mode, 'edit', 'the default mode is edit');

  /* ================================================================== */
  /* 1. The picker: live switch, the line, and persistence              */
  /* ================================================================== */
  let mark = posts.length;
  host.receive({ type: 'mode', value: 'plan' });
  const planState = await waitPost(
    (m) => m.type === 'mode-state' && m.text === 'plan',
    'the picker to show plan',
    mark,
  );
  assert.ok(planState, 'the picker was told plan');
  const planNotice = await waitPost(
    (m) => m.type === 'notice' && String(m.text).includes('Mode: plan'),
    'the plan switch line',
    mark,
  );
  assert.match(
    String(planNotice.text),
    /applies from your next message\.$/,
    'an idle switch says when it applies',
  );
  await waitState((s) => s['plato.chatMode'] === 'plan', 'plan persisted');

  mark = posts.length;
  host.receive({ type: 'mode', value: 'edit' });
  await waitPost(
    (m) => m.type === 'mode-state' && m.text === 'edit',
    'the picker to show edit',
    mark,
  );

  // A value the picker never offers must not reach the permission table.
  host.receive({ type: 'mode', value: 'act' });
  await settle();
  assert.equal(
    postIndexOf((m) => m.type === 'mode-state' && m.text === 'act'),
    -1,
    'an unrecognised mode is refused',
  );

  /* ================================================================== */
  /* 2. Approvals: deny, approve, session memory, and its clearing      */
  /* ================================================================== */
  // -- deny -------------------------------------------------------------
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'denied.txt', content: 'no' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write denied.txt.' });
  const denyCard = await waitPost((m) => m.type === 'approval', 'the deny card', mark);
  assert.equal(
    denyCard.heading,
    'Let Plato write denied.txt?',
    'the card names the situation, not the tool',
  );
  assert.equal(
    denyCard.allowAll,
    'Allow every edit this session',
    'the session button names the action',
  );
  assert.equal(
    denyCard.headingDenied,
    'Let Plato write denied.txt — denied',
    'the answered heading is built in core',
  );
  host.receive({ type: 'approve', value: 'no' });
  await waitPost((m) => m.type === 'done', 'the denied run to finish', mark);
  assert.equal(existsSync(join(ROOT, 'denied.txt')), false, 'a denied write does not happen');
  await settle();
  assert.ok(
    stateFile()['plato.chatLog'].some((e) => e.k === 'msg' && e.text === '[denied]'),
    'the refusal is in the conversation',
  );

  // -- approve ----------------------------------------------------------
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'allowed.txt', content: 'yes' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write allowed.txt.' });
  const allowCard = await waitPost((m) => m.type === 'approval', 'the allow card', mark);
  assert.equal(allowCard.headingAllowed, 'Let Plato write allowed.txt — allowed');
  host.receive({ type: 'approve', value: 'yes' });
  await waitPost((m) => m.type === 'done', 'the approved run to finish', mark);
  assert.equal(readFileSync(join(ROOT, 'allowed.txt'), 'utf8'), 'yes', 'an approved write happens');

  // -- session memory ---------------------------------------------------
  await setScript([
    {
      calls: [
        { tool: 'write_file', args: { path: 'session-a.txt', content: 'a' } },
        { tool: 'write_file', args: { path: 'session-b.txt', content: 'b' } },
      ],
    },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write session-a.txt and session-b.txt.' });
  const sessionCard = await waitPost((m) => m.type === 'approval', 'the session card', mark);
  assert.equal(sessionCard.headingSession, 'Let Plato write session-a.txt — allowed for the rest of this session');
  host.receive({
    type: 'approve-all',
    tool: sessionCard.tool,
    sessionKey: sessionCard.sessionKey,
  });
  await waitPost((m) => m.type === 'done', 'the session-memory run to finish', mark);
  assert.equal(existsSync(join(ROOT, 'session-a.txt')), true);
  assert.equal(existsSync(join(ROOT, 'session-b.txt')), true);
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'approval').length,
    1,
    'the second write was answered by session memory, not a card',
  );
  assert.ok(
    posts.some(
      (m, i) =>
        i >= mark &&
        m.type === 'notice' &&
        m.text === 'Plato did not ask — you already allowed this for the session.',
    ),
    'the notice says why no card appeared',
  );
  assert.ok(
    posts.some(
      (m, i) => i >= mark && m.type === 'notice' && m.text === 'Plato will not ask about this again this session.',
    ),
    'the session answer is acknowledged',
  );

  // -- a mode switch clears the session memory (host contract) ----------
  host.receive({ type: 'mode', value: 'plan' });
  await settle();
  host.receive({ type: 'mode', value: 'edit' });
  await settle();
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'after-switch.txt', content: 'c' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write after-switch.txt.' });
  await waitPost(
    (m) => m.type === 'approval',
    'a card after the mode switch (the session memory was cleared)',
    mark,
  );
  host.receive({ type: 'approve', value: 'yes' });
  await waitPost((m) => m.type === 'done', 'the post-switch run to finish', mark);

  /* ================================================================== */
  /* 3. The mode-request card: approve, decline                        */
  /* ================================================================== */
  // -- approve ----------------------------------------------------------
  await setScript([
    {
      calls: [
        {
          tool: 'request_mode',
          args: { mode: 'auto', reason: 'The next write needs no card.' },
        },
      ],
    },
    { text: 'Done in auto.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask to switch to auto.' });
  const modeCard = await waitPost((m) => m.type === 'mode-request', 'the mode card', mark);
  assert.equal(modeCard.current, 'edit');
  assert.equal(modeCard.mode, 'auto');
  assert.equal(modeCard.reason, 'The next write needs no card.');
  host.receive({ type: 'mode-request-answer', allow: true });
  await waitPost((m) => m.type === 'mode-state' && m.text === 'auto', 'the picker after the request', mark);
  await waitPost(
    (m) => m.type === 'notice' && m.text === 'Mode: auto — the user approved Plato\'s request.',
    'the approved-request line',
    mark,
  );
  await waitPost((m) => m.type === 'mode-request-done', 'the card to close', mark);
  const afterRequest = await runToEnd(
    host,
    'Ask to switch to auto.',
    mark,
  );
  assert.equal(afterRequest.type, 'done');
  await waitState((s) => s['plato.chatMode'] === 'auto', 'auto persisted');

  // -- decline ----------------------------------------------------------
  host.receive({ type: 'mode', value: 'edit' });
  await settle();
  await setScript([
    {
      calls: [
        {
          tool: 'request_mode',
          args: { mode: 'plan', reason: 'I want to inspect only.' },
        },
      ],
    },
    { text: 'Stayed in edit.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask to switch to plan.' });
  await waitPost((m) => m.type === 'mode-request', 'the second mode card', mark);
  host.receive({ type: 'mode-request-answer', allow: false });
  await waitPost(
    (m) =>
      m.type === 'notice' &&
      m.text === 'Plato asked to switch to plan — the user declined.',
    'the declined-request line',
    mark,
  );
  await waitPost((m) => m.type === 'done', 'the declined-request run to finish', mark);
  await waitState((s) => s['plato.chatMode'] === 'edit', 'a decline leaves the mode alone');

  /* ================================================================== */
  /* 4. A live switch applies at the next tool call                     */
  /* ================================================================== */
  host.receive({ type: 'mode', value: 'plan' });
  await settle();
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: 'note.txt' } }], delayMs: 1_500 },
    { calls: [{ tool: 'write_file', args: { path: 'live-switch.txt', content: 'live' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt, then write live-switch.txt.' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  host.receive({ type: 'mode', value: 'auto' });
  const liveNotice = await waitPost(
    (m) => m.type === 'notice' && String(m.text).includes('Mode: auto'),
    'the live switch line',
    mark,
  );
  assert.match(
    String(liveNotice.text),
    /applies from the next tool call\.$/,
    'a live switch says it applies at the next tool call',
  );
  const liveEnd = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the live-switch run to finish',
    mark,
    60_000,
  );
  assert.equal(liveEnd.type, 'done', JSON.stringify(liveEnd));
  assert.equal(
    readFileSync(join(ROOT, 'live-switch.txt'), 'utf8'),
    'live',
    'the write after the switch ran under auto, with no card',
  );
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'approval').length,
    0,
    'auto drew no approval card',
  );
  const switchedLog = stateFile()['plato.chatLog'];
  assert.ok(
    switchedLog.some(
      (e) => e.k === 'msg' && String(e.text).startsWith('Mode: auto — applies from the next tool call.'),
    ),
    'the live switch is in the conversation',
  );

  /* ================================================================== */
  /* 5. Queue: advance on completion, hold on cancel                    */
  /* ================================================================== */
  await setScript([
    { text: 'First run done.', delayMs: 1_500 },
    { text: 'Queued run done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'First task.' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  host.receive({ type: 'slash-run', id: 'queue', text: 'Queued task.' });
  const queued = await waitPost(
    (m) => m.type === 'queue' && Array.isArray(m.items) && m.items.includes('Queued task.'),
    'the queued message in the view',
    mark,
  );
  assert.equal(queued.held, false);
  await waitPost((m) => m.type === 'done', 'the first run to finish', mark);
  const secondDone = await waitPost(
    (m) => m.type === 'done',
    'the queued message to run',
    postIndexOf((m) => m.type === 'done', mark) + 1,
    60_000,
  );
  assert.equal(secondDone.type, 'done', 'the queued message ran after the first run');
  const drained = await waitPost(
    (m) => m.type === 'queue' && Array.isArray(m.items) && m.items.length === 0,
    'the queue to drain',
    mark,
  );
  assert.equal(drained.held, false);

  // -- held: a cancel must not quietly hand the queue on ----------------
  // Back to edit so the write raises a card to cancel from.
  host.receive({ type: 'mode', value: 'edit' });
  await settle();
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'never.txt', content: 'x' } }] },
    { text: 'Held run done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write never.txt.' });
  await waitPost((m) => m.type === 'approval', 'the card before the cancel', mark);
  host.receive({ type: 'slash-run', id: 'queue', text: 'Held task.' });
  await waitPost(
    (m) => m.type === 'queue' && m.items.includes('Held task.'),
    'the held message',
    mark,
  );
  host.receive({ type: 'cancel' });
  await waitPost((m) => m.type === 'done', 'the cancelled run to finish', mark);
  const held = await waitPost(
    (m) => m.type === 'queue' && m.held === true && m.items.includes('Held task.'),
    'the held queue after a cancel',
    mark,
  );
  assert.equal(held.held, true);
  assert.equal(existsSync(join(ROOT, 'never.txt')), false, 'the cancelled write did not happen');

  // -- queue-start clears the hold and runs the item --------------------
  mark = posts.length;
  host.receive({ type: 'queue-start' });
  const heldDone = await waitPost(
    (m) => m.type === 'done',
    'the held message to run after Queue',
    mark,
    60_000,
  );
  assert.equal(heldDone.type, 'done');

  /* ================================================================== */
  /* 6. Pause and resume                                                */
  /* ================================================================== */
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: 'note.txt' } }], delayMs: 1_200 },
    { text: 'Finished after the pause.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt, then finish.' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  host.receive({ type: 'pause' });
  const parked = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === true,
    'the run to park',
    mark,
  );
  assert.equal(parked.text.parked, true);
  host.receive({ type: 'resume' });
  await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === false,
    'the run to resume',
    mark,
  );
  const pausedEnd = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the paused run to finish',
    mark,
    60_000,
  );
  assert.equal(pausedEnd.type, 'done', JSON.stringify(pausedEnd));

  /* ================================================================== */
  /* 7. Cancel releases every parked card                               */
  /* ================================================================== */
  // -- question ---------------------------------------------------------
  await setScript([
    {
      calls: [
        {
          tool: 'ask_user',
          args: {
            questions: [
              { question: 'Which name?', options: ['Alpha', 'Beta'] },
            ],
          },
        },
      ],
    },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask me a question.' });
  await waitPost((m) => m.type === 'user-question', 'the question card', mark);
  host.receive({ type: 'cancel' });
  await waitPost((m) => m.type === 'question-done', 'the question card to close', mark);
  await waitPost((m) => m.type === 'done', 'the question run to cancel', mark);
  assert.ok(
    stateFile()['plato.chatLog'].some((e) => e.k === 'question-done'),
    'the cancelled question is closed in the log',
  );

  // -- stuck ------------------------------------------------------------
  await setScript(
    Array.from({ length: 8 }, () => ({
      calls: [{ tool: 'read_file', args: { path: 'note.txt' } }],
    })),
  );
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt again and again.' });
  const stuck = await waitPost((m) => m.type === 'stuck', 'the stuck card', mark, 60_000);
  assert.ok(stuck.title, 'the stuck card has the core heading');
  host.receive({ type: 'cancel' });
  await waitPost((m) => m.type === 'stuck-done', 'the stuck card to close', mark);
  await waitPost((m) => m.type === 'done', 'the stuck run to cancel', mark);

  // -- reveal -----------------------------------------------------------
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: 'blob.m3b-secret' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read blob.m3b-secret.' });
  const reveal = await waitPost((m) => m.type === 'reveal', 'the reveal card', mark);
  assert.ok(reveal.title, 'the reveal card has the core heading');
  host.receive({ type: 'cancel' });
  await waitPost((m) => m.type === 'reveal-done', 'the reveal card to close', mark);
  await waitPost((m) => m.type === 'done', 'the reveal run to cancel', mark);

  // -- mode request -----------------------------------------------------
  host.receive({ type: 'mode', value: 'edit' });
  await settle();
  await setScript([
    {
      calls: [
        { tool: 'request_mode', args: { mode: 'auto', reason: 'Let me write.' } },
      ],
    },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask for auto, then finish.' });
  await waitPost((m) => m.type === 'mode-request', 'the mode card to cancel', mark);
  host.receive({ type: 'cancel' });
  await waitPost((m) => m.type === 'mode-request-done', 'the mode card to close', mark);
  await waitPost((m) => m.type === 'done', 'the mode-request run to cancel', mark);
  await waitState((s) => s['plato.chatMode'] === 'edit', 'a cancelled request leaves the mode alone');

  /* ================================================================== */
  /* 8. The unchanged page and the transcript                           */
  /* ================================================================== */
  assert.ok(
    transport.html.includes('id="modeBtn"'),
    'the shared page carries the plan/edit/auto picker',
  );
  for (const mode of ['mode-plan', 'mode-edit', 'mode-auto']) {
    assert.ok(
      transport.html.includes(mode),
      `the shared page styles the ${mode} state`,
    );
  }
  const runs = join(HOME, '.plato', 'runs');
  assert.ok(existsSync(runs), '~/.plato/runs exists');

  host.receive({ type: 'mode', value: 'plan' });
  await settle();
  assert.equal(
    stateFile()['plato.chatMode'],
    'plan',
    'the final mode survives in workspaceState',
  );

  const panel = host.panel();
  panel.dispose();
  await settle();
  assert.equal(disposed, true, 'the panel reported disposal');

  console.log('PASS M3b checkpoint 1 modes and approvals');
  console.log(`  html: ${transport.html.length} chars`);
  console.log(`  posts: ${posts.length}`);
  console.log(`  runs: ${runs}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill('SIGTERM');
}

if (failure !== null) {
  console.error('FAIL M3b checkpoint 1 modes and approvals');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' +
      JSON.stringify(posts.slice(-12).map((p) => ({ type: p?.type, text: p?.text }))),
  );
  console.error(`stub stderr: ${stubStderr}`);
  process.exitCode = 1;
}
