/**
 * The host under test, for this package's tests.
 *
 * It runs this package's own compiled `out/extension.js` — the same source the
 * VS Code VSIX and the Visual Studio host ship — with `vscode` replaced by the
 * Visual Studio lane's shim and the model replaced by the field harness's
 * scripted stub. Both are other lanes' files: these tests read and bundle them
 * and edit neither. If one moves, the build or the start below fails and names
 * the file it wanted, because a skipped test would be a silent hole.
 *
 * Importing this module starts one stub and one temp workspace; every test file
 * that imports it gets its own process under `node --test`, so they do not
 * collide.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
const HOST_ENTRY = join(REPO, 'packages', 'vs', 'host', 'entry.ts');
const SHIM = join(REPO, 'packages', 'vs', 'host', 'shim', 'vscode.ts');
const STUB = join(REPO, 'scripts', 'field', 'stub-model.mjs');
const COMPILED = join(REPO, 'packages', 'vscode', 'out', 'extension.js');

for (const file of [HOST_ENTRY, SHIM, STUB, COMPILED]) {
  assert.ok(
    existsSync(file),
    `${file} is missing — the host must be built (tsc -b) and the other lanes' harness files must be in place`,
  );
}

const HOME = mkdtempSync(join(tmpdir(), 'plato-host-home-'));
export const ROOT = mkdtempSync(join(tmpdir(), 'plato-host-root-'));
export const STATE = join(HOME, 'state');
export const PLATO_HOME = join(HOME, '.plato');
// The run record lands under ~/.plato/runs/<project-key>/ (D24c, D46). The
// key is the first eight hex digits of the workspace root's sha1.
export const RUNS_DIR = join(
  PLATO_HOME,
  'runs',
  createHash('sha1').update(ROOT).digest('hex').slice(0, 8),
);
const BUILD = mkdtempSync(join(tmpdir(), 'plato-host-build-'));
mkdirSync(PLATO_HOME, { recursive: true });
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

/* ------------------------------------------------------------ scripted model */

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

export const port = await freePort();
export const stub = spawn(process.execPath, [STUB], {
  env: { ...process.env, PLATO_STUB_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stubStderr = '';
stub.stderr.on('data', (chunk) => {
  stubStderr += String(chunk);
});
await new Promise((resolveStub, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`the stub did not start: ${stubStderr}`)),
    15_000,
  );
  stub.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer);
      resolveStub();
    }
  });
  stub.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`the stub exited ${code}: ${stubStderr}`));
  });
});

export async function setScript(steps, observers) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, observers }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
}

/** What the model was actually asked, which is how a test proves a word left. */
export async function readStubLog() {
  return await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
}

/* ------------------------------------------------------------------- the host */

const bundle = join(BUILD, 'host.cjs');
await esbuild.build({
  entryPoints: [HOST_ENTRY],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'silent',
  plugins: [
    {
      name: 'vscode-shim',
      setup(build_) {
        build_.onResolve({ filter: /^vscode$/ }, () => ({ path: SHIM }));
      },
    },
  ],
});
const { start } = createRequire(import.meta.url)(bundle);

/** Everything the host posted, in order, and when each reached the chat. */
export const posts = [];
export const stamps = [];
const waiters = [];

const transport = {
  setHtml() {},
  post(message) {
    posts.push(message);
    stamps.push(Date.now());
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
    return undefined;
  },
};

export function waitPost(predicate, label, from = 0, timeoutMs = 60_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return Promise.resolve(posts[i]);
  }
  return new Promise((resolvePost, reject) => {
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
        resolvePost(message);
      },
    });
  });
}

export const settings = {
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
  'plato.orchestration': 'duo',
  'plato.compaction.threshold': 0.8,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

/** Start the host and take it past the ready handshake. */
export async function startHost() {
  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });
  await host.execute('plato.openChat');
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');
  return host;
}

/** Every event written to this project's run record(s) so far. */
export function readRunEvents() {
  if (!existsSync(RUNS_DIR)) return [];
  const events = [];
  for (const f of readdirSync(RUNS_DIR).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(RUNS_DIR, f), 'utf8').split('\n')) {
      if (line.length > 0) events.push(JSON.parse(line));
    }
  }
  return events;
}

/** Each run record as its own list of events, so a test can name one run. */
export function readRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((n) => n.endsWith('.jsonl'))
    .map((f) => ({
      file: f,
      events: readFileSync(join(RUNS_DIR, f), 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l)),
    }));
}

/** A philosopher in the mode under test, with pause and cancel in reach. */
export function writeDuo(file = 'DUO.yaml') {
  writeFileSync(
    join(PLATO_HOME, file),
    [
      'philosopher:',
      '  persona: aristotle',
      '  name: Aristotle',
      '  model: stub:stub-model',
      '  color: violet',
      '  pause: true',
      '  cancel: true',
      '  maxInterventions: 5',
      '',
    ].join('\n'),
    'utf8',
  );
}
