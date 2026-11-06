/**
 * D49cq host test: the registry's busy flag and the queueing rule agree.
 *
 * The founder's report: a chat the list showed as IDLE answered a message with
 * "queued". `receive()` queues on `busy` (`running || runInFlight`), and the
 * registry publishes the same getter — but the registry was only rewritten when
 * a run reached the wire, while `runInFlight` is already true for the whole
 * PREPARATION window (reading the key, fetching the model pool, starting MCP
 * servers up to 20 s each). A peer in that window read "idle", sent, and was
 * told the message was queued. The contradiction was not in either rule; it was
 * in WHEN the description was published.
 *
 * What it proves:
 *   - while a run is still being prepared, the registry entry says busy;
 *   - after the run ends, it says idle again (the slot-clearing write);
 *   - the description carries the SOLUTION ROOT, not the sidecar's cwd.
 *
 * It does NOT prove the real Visual Studio window or WebView2. It drives the
 * same shared host the VS Code extension runs.
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
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-live-busy-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-live-busy-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;
mkdirSync(STATE, { recursive: true });

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
const stub = spawn(process.execPath, [join(REPO, 'scripts/field/stub-model.mjs')], {
  env: { ...process.env, PLATO_STUB_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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

/**
 * A run needs one scripted answer; its PREPARATION is what this test watches.
 * The model-discovery call is held for four seconds, which turns a
 * millisecond-wide window into one the test can stand inside.
 */
const scripted = await fetch(`http://127.0.0.1:${port}/__script`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ steps: [{ text: 'Prepared.' }], modelsDelayMs: 4000 }),
});
assert.equal(scripted.status, 200, 'the stub accepted the script');

const posts = [];
const transport = {
  html: '',
  setHtml(html) {
    transport.html = html;
  },
  post(message) {
    posts.push(message);
  },
  reveal() {},
  disposed() {},
  async request() {
    return {};
  },
};

/** This process's own live entry, from the registry it wrote. */
function liveEntry() {
  const dir = join(HOME, '.plato', 'live');
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (entry.pid === process.pid) return entry;
    } catch {
      // A write can land mid-read; the next poll sees it.
    }
  }
  return null;
}

async function waitEntry(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let entry = null;
  while (Date.now() < deadline) {
    entry = liveEntry();
    if (entry !== null && predicate(entry)) return entry;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timeout waiting for the registry to say ${label} (last: ${JSON.stringify(entry)})`,
  );
}

let failure = null;
try {
  const { start } = require('../dist/plato-host.cjs');
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
      'plato.orchestration': 'solo',
    },
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  assert.ok(transport.html.includes('<title>Plato</title>'), 'chat HTML');
  host.receive({ type: 'ready' });

  const idle = await waitEntry((e) => e.busy === false, 'idle before the run');
  assert.equal(idle.cwd, ROOT, 'the description carries the solution root');
  assert.equal(idle.host, 'vs', 'the host names itself');

  host.receive({ type: 'ask', text: 'Prepare a run.' });

  // The run is PREPARING here: the model pool has not answered yet, so no run
  // has reached the wire. The registry must already say busy.
  const busy = await waitEntry((e) => e.busy === true, 'busy while preparing', 3000);
  assert.equal(busy.busy, true, 'busy is published from the start of preparation');

  // And it must return to idle once the run has fully unwound.
  await waitEntry((e) => e.busy === false, 'idle after the run', 30_000);

  host.panel()?.dispose();
  console.log('PASS live session busy state');
  console.log(`  entry: ${JSON.stringify(liveEntry())}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill();
}

if (failure !== null) {
  console.error('FAIL live session busy state');
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exitCode = 1;
}
