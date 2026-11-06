/**
 * D49cq forced states: what `receive()` answers, beside what the registry
 * published at that moment.
 *
 * The founder saw a chat the list called IDLE answer a message with "queued".
 * Windows could not reproduce it, so this test forces the states nobody has
 * driven yet and records BOTH sides for each:
 *
 *   - the registry entry's `busy` immediately before the send, and
 *   - the transport's answer (accepted / queued / refused).
 *
 * A queued answer beside `busy: false` is the founder's contradiction; anything
 * else is consistent, and an accepted answer is the snapshot behaving as a
 * snapshot should.
 *
 * Forced here: a run parked on an APPROVAL card, a run parked on a QUESTION
 * card, two inbound messages waiting at once (order), and a send that arrives
 * while the window is disposing. A hidden tool window, an entry that outruns
 * attach, and an auxiliary call still in flight are recorded in the report as
 * reasoned about, not forced — the first two are not representable in the shim
 * (its panels are always `active`), and the third needs a provider that can
 * hold the title call open.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-live-states-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-live-states-root-'));
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;
const require = createRequire(import.meta.url);
const { createLiveSession } = await import(join(REPO, 'packages/core/dist/src/index.js'));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const stub = spawn(process.execPath, [join(REPO, 'scripts/field/stub-model.mjs')], {
  env: { ...process.env, PLATO_STUB_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stubStderr = '';
stub.stderr.on('data', (c) => { stubStderr += String(c); });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`stub did not start: ${stubStderr}`)), 15_000);
  stub.stdout.on('data', (c) => {
    if (String(c).includes('listening')) { clearTimeout(timer); resolve(); }
  });
  stub.once('exit', (code) => { clearTimeout(timer); reject(new Error(`stub exited ${code}: ${stubStderr}`)); });
});

async function setScript(steps) {
  const res = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps }),
  });
  assert.equal(res.status, 200, 'the stub accepted the script');
}

/**
 * The HOST's live entry. The peer session runs in this process too, so `pid`
 * alone finds either one; the peer's id is excluded.
 */
let peerId = '';
function liveEntry() {
  const dir = join(HOME, '.plato', 'live');
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return null; }
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (entry.pid === process.pid && entry.id !== peerId) return entry;
    } catch { /* mid-write */ }
  }
  return null;
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${label} (entry: ${JSON.stringify(liveEntry())})`);
}

/** A peer session, so every send goes over the real wire and gets a real ack. */
const peer = await createLiveSession({
  host: 'cli',
  // The shared PLATO home, which is where every host registers — not the
  // process HOME itself.
  home: join(HOME, '.plato'),
  describe: () => ({ name: 'Test peer', summary: 'a peer', busy: false, cwd: ROOT }),
  receive: async () => 'refused',
});
peerId = peer.id;

/** Sends one message and records both halves of the answer. */
let lastId = '';
async function record(label, text) {
  const entry = liveEntry();
  const published = entry === null ? 'absent' : entry.busy;
  // By ID, not by name: the chat's title is generated DURING the run, so the
  // name read a moment ago may already be the old one.
  if (entry !== null) lastId = entry.id;
  const res = await peer.send(entry?.id ?? lastId, text);
  const answer = res.ok ? res.status : `refused:${res.reason}`;
  console.log(`  ${label}: registry busy=${published} → ${answer}`);
  return { published, answer };
}

let failure = null;
try {
  const { start } = require('../dist/plato-host.cjs');

  /** Starts one host with its own state dir, and returns it. */
  function startHost(name, settings, transport) {
    const state = join(HOME, name);
    mkdirSync(state, { recursive: true });
    return start({
      root: ROOT,
      stateDir: state,
      settings,
      secrets: { 'plato.providers.stub.apiKey': 'test-key' },
      transport,
    });
  }
  const settings = {
    'plato.connections': [
      { id: 'stub', kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['stub-model'] },
    ],
    'plato.model': 'stub:stub-model',
    'plato.mode': 'edit',
    'plato.orchestration': 'solo',
  };
  const posts = [];
  const transport = {
    html: '',
    setHtml(html) { transport.html = html; },
    post(m) { posts.push(m); },
    reveal() {},
    disposed() {},
    async request() { return {}; },
  };

  // 1. A run parked on an APPROVAL card. The window is alive and the person
  //    has not answered, so it is BUSY — however quiet it looks.
  const host = startHost('state-approval', settings, transport);
  await host.execute('plato.openChat');
  host.receive({ type: 'ready' });
  await setScript([{ tool: 'write_file', args: { path: 'probe.txt', content: 'x' } }]);
  host.receive({ type: 'ask', text: 'Write probe.txt.' });
  await waitFor(() => posts.some((p) => p.type === 'approval' || p.type === 'approval-card'), 'the approval card');
  const parked = await record('approval card parked', 'while you are parked, status?');
  assert.equal(parked.published, true, 'a parked run is published as busy');
  assert.equal(parked.answer, 'queued', 'a message to a parked run is queued');

  // 2. Two inbounds waiting at once: both queued, in order, and still one busy.
  const second = await record('second inbound while one waits', 'second message');
  assert.equal(second.answer, 'queued', 'the second message is queued too');

  // 3. A send that arrives while the window is disposing.
  await host.panel().disposeAsync();
  const gone = await record('after dispose', 'anyone there?');
  assert.equal(gone.published, 'absent', 'a closed window leaves no entry');
  assert.match(gone.answer, /^refused:(unknown|closed)$/, 'a closed window never accepts');

  // 4. A run parked on a QUESTION card — the same rule, a different card.
  const posts2 = [];
  const transport2 = {
    html: '',
    setHtml(html) { transport2.html = html; },
    post(m) { posts2.push(m); },
    reveal() {},
    disposed() {},
    async request() { return {}; },
  };
  const host2 = startHost('state-question', settings, transport2);
  await host2.execute('plato.openChat');
  host2.receive({ type: 'ready' });
  await setScript([{
    tool: 'ask_user',
    args: { questions: [{ question: 'Which path?', options: ['A', 'B'] }] },
  }]);
  host2.receive({ type: 'ask', text: 'Ask me which path.' });
  await waitFor(() => posts2.some((p) => p.type === 'user-question'), 'the question card');
  const asking = await record('question card parked', 'while you are asking, status?');
  assert.equal(asking.published, true, 'a run waiting on a question is busy');
  assert.equal(asking.answer, 'queued', 'a message to a run waiting on a question is queued');
  await host2.panel().disposeAsync();

  console.log('PASS forced live states');
} catch (error) {
  failure = error;
} finally {
  await peer.close();
  stub.kill();
}

if (failure !== null) {
  console.error('FAIL forced live states');
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exitCode = 1;
}
