/**
 * D49cd (merge): the founder's own project shape, through the REAL host.
 *
 * His repository keeps instructions in BOTH `.github/AGENTS.md` and
 * `.claude/CLAUDE.md`. Under the first-found rule one was read and the other
 * never reached the system prompt. This test seeds exactly that shape, runs one
 * turn through the existing IDE host and the shared chat page, and reads the
 * system prompt the model was actually sent — both markers present, the
 * `.claude` one last.
 *
 * The stub is asked to log the system text (`PLATO_STUB_LOG_SYSTEM=1`); it is
 * off everywhere else, because a prompt can carry a project's own rules.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-agentfiles-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-agentfiles-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;
process.env['PLATO_HOME'] = join(HOME, '.plato');

const require = createRequire(import.meta.url);

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
  env: { ...process.env, PLATO_STUB_PORT: String(port), PLATO_STUB_LOG_SYSTEM: '1' },
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
};

const posts = [];
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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

let failure = null;
try {
  mkdirSync(join(HOME, '.plato'), { recursive: true });
  mkdirSync(STATE, { recursive: true });
  // The founder's shape: GitHub's agents file and the tool-specific CLAUDE one,
  // each with a marker that identifies it in the prompt.
  mkdirSync(join(ROOT, '.github'), { recursive: true });
  mkdirSync(join(ROOT, '.claude'), { recursive: true });
  writeFileSync(join(ROOT, '.github', 'AGENTS.md'), 'GITHUB-MARKER: use pnpm for builds.\n');
  writeFileSync(join(ROOT, '.claude', 'CLAUDE.md'), 'CLAUDE-MARKER: cite file paths in reviews.\n');
  // D49dk: environment facts are a HOST paragraph and must survive a project
  // PLATO.md, so this run has one.
  writeFileSync(join(ROOT, 'PLATO.md'), 'PLATO-MARKER: keep the build green.\n');

  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });
  await host.execute('plato.openChat');

  await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: [{ text: 'ok.' }], titleMode: 'fixed' }),
  });

  const mark = posts.length;
  host.receive({ type: 'ask', text: 'say ok' });
  const done = await waitPost((m) => m.type === 'done' || m.type === 'error', 'the run to end', mark);
  assert.equal(done.type, 'done', `the run ended: ${JSON.stringify(done)}`);

  const log = await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
  const agentTurn = log.log.find((e) => Number(e.toolsOffered) > 0);
  assert.ok(agentTurn, 'the stub was sent an agent turn');
  const system = String(agentTurn.systemText ?? '');
  assert.ok(system.length > 0, 'the stub logged the system prompt');

  assert.ok(system.includes('GITHUB-MARKER'), 'the .github/AGENTS.md marker reached the model');
  assert.ok(system.includes('CLAUDE-MARKER'), 'the .claude/CLAUDE.md marker reached the model');
  assert.ok(
    system.includes('From .github/AGENTS.md:'),
    'the GitHub section is labelled with its source',
  );
  assert.ok(
    system.includes('From .claude/CLAUDE.md:'),
    'the .claude section is labelled with its source',
  );
  assert.ok(
    system.indexOf('GITHUB-MARKER') < system.indexOf('CLAUDE-MARKER'),
    'the .claude section comes last',
  );

  // D49dk: the machine the run is on, as a host fact appended after the body.
  const shell =
    process.platform === 'win32' ? 'cmd.exe via %COMSPEC%' : '/bin/bash -c';
  assert.ok(system.includes('PLATO-MARKER'), 'the project PLATO.md reached the model');
  assert.ok(
    system.includes(`Environment: this run is on `) &&
      system.includes(`(${process.platform})`),
    `the prompt names the platform: ${system.slice(system.indexOf('Environment:'))}`,
  );
  assert.ok(
    system.includes(`The shell tool runs ${shell}.`),
    `the prompt names the real shell: ${system.slice(system.indexOf('Environment:'))}`,
  );
  assert.ok(
    system.includes(`The workspace root is ${ROOT};`),
    'the prompt names the workspace root',
  );
  assert.ok(
    system.indexOf('PLATO-MARKER') < system.indexOf('Environment: this run is on'),
    'the environment paragraph comes after the project body, so PLATO.md cannot delete it',
  );

  console.log('PASS agent files: both project instruction files reach the real host, .claude last');
} catch (err) {
  failure = err;
} finally {
  stub.kill();
  if (failure) {
    console.error('FAIL agent files:', failure);
    process.exit(1);
  }
}
