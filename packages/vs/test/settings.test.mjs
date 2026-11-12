/**
 * M3a host test: the Settings page through the sidecar.
 *
 * What it proves:
 *   - the settings payload carries every field the page reads, including the
 *     compaction threshold (the M3a regression: it used to be absent, so the
 *     page always rendered 0.8);
 *   - add, discovery, model, reasoning, compaction, protected names, Others,
 *     and key replacement all reach the real IDE host;
 *   - settings survive a sidecar restart (a Visual Studio reload);
 *   - no key material reaches the settings file.
 *
 * The fake host answers the bridge methods the C# shell answers in production
 * (`secrets.*`, `ui.*`, `editor.*`). Credential Manager itself is proven in a
 * real Visual Studio window; this test proves the host contract around it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'plato-host.cjs');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-settings-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-settings-root-'));
const STATE = mkdtempSync(join(tmpdir(), 'plato-vs-settings-state-'));
const SETTINGS = join(STATE, 'settings.json');
const WORKSPACE_STATE = join(STATE, 'workspace-state.json');

mkdirSync(join(HOME, '.plato'), { recursive: true });

const DEFAULTS = {
  'plato.connections': [],
  'plato.model': 'anthropic:claude-sonnet-4-5',
  'plato.reasoning': 'off',
  'plato.orchestration': 'solo',
  'plato.compaction.threshold': 0.8,
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};
writeFileSync(SETTINGS, JSON.stringify(DEFAULTS));

const modelServer = createServer((request, response) => {
  if ((request.url ?? '').endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        data: [{ id: 'stub-model' }, { id: 'o4-mini' }],
      }),
    );
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) =>
  modelServer.listen(0, '127.0.0.1', resolve),
);
const modelPort = modelServer.address().port;

/** The fake C# host's Credential Manager. */
const secrets = new Map();
const requests = [];
const notifications = [];
const waiters = [];
let cursor = 0;
let nextHostId = 1000;

function dispatch(message) {
  notifications.push(message);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
}

function waitFor(predicate, label, timeoutMs = 20_000) {
  for (let i = cursor; i < notifications.length; i += 1) {
    if (predicate(notifications[i])) {
      cursor = i + 1;
      return Promise.resolve(notifications[i]);
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `timeout waiting for ${label}. recent: ${notifications
            .slice(-10)
            .map((n) => n.method)
            .join(', ')}`,
        ),
      );
    }, timeoutMs);
    waiters.push({
      predicate,
      timer,
      resolve(message) {
        clearTimeout(timer);
        cursor = notifications.lastIndexOf(message) + 1;
        resolve(message);
      },
    });
  });
}

function startSidecar() {
  const child = spawn(process.execPath, [BUNDLE], {
    env: { ...process.env, HOME, USERPROFILE: HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    'line',
    (line) => {
      if (line.trim().length === 0) return;
      const message = JSON.parse(line);
      if (message.method !== undefined && message.id !== undefined) {
        // A request from the sidecar to the C# host.
        requests.push(message);
        const params = message.params ?? {};
        let result = {};
        if (message.method === 'secrets.get') {
          result = secrets.has(params.key)
            ? { value: secrets.get(params.key) }
            : {};
        } else if (message.method === 'secrets.store') {
          secrets.set(params.key, params.value);
          result = { ok: true };
        } else if (message.method === 'secrets.delete') {
          secrets.delete(params.key);
          result = { ok: true };
        }
        child.stdin.write(
          `${JSON.stringify({ id: message.id, result })}\n`,
        );
        return;
      }
      dispatch(message);
    },
  );
  return { child, stderr: () => stderr };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const exited = (child) =>
  new Promise((resolve) => child.once('exit', resolve));

async function waitRequest(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = requests.find(predicate);
    if (hit !== undefined) return hit;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for ${label}`);
}

function settingsFile() {
  return JSON.parse(readFileSync(SETTINGS, 'utf8'));
}

async function waitFile(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = settingsFile();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for the settings file: ${label}`);
}

async function shutdown(child) {
  send(child, { id: nextHostId++, method: 'shutdown' });
  const code = await Promise.race([
    exited(child),
    new Promise((resolve) => setTimeout(() => resolve('running'), 5_000)),
  ]);
  if (code === 'running') child.kill();
}

let failure = null;
let sidecar = null;
try {
  sidecar = startSidecar();
  const { child } = sidecar;

  send(child, {
    id: 1,
    method: 'init',
    params: {
      root: ROOT,
      settingsPath: SETTINGS,
      stateDir: STATE,
      workspaceStateFile: WORKSPACE_STATE,
      version: 'test',
    },
  });
  await waitFor((m) => m.id === 1, 'init');
  send(child, { id: 2, method: 'command', params: { command: 'plato.openChat' } });
  await waitFor((m) => m.method === 'webview.html', 'chat HTML');
  await waitFor((m) => m.id === 2, 'openChat');

  send(child, {
    id: 3,
    method: 'webview.message',
    params: { message: { type: 'ready' } },
  });
  await waitFor(
    (m) => m.method === 'webview.post' && m.params.message?.type === 'restore',
    'restore',
  );
  // The page-message response can precede the async post it starts, so this
  // test waits for the POST, not for the message's own ok.

  // ---- settings payload: compaction must be present --------------------
  send(child, {
    id: 4,
    method: 'webview.message',
    params: { message: { type: 'openSettings' } },
  });
  const first = await waitFor(
    (m) =>
      m.method === 'webview.post' &&
      m.params.message?.type === 'settings' &&
      m.params.message.open === true,
    'the settings payload',
  );
  const firstPayload = first.params.message;
  assert.equal(firstPayload.connections.length, 0);
  assert.equal(
    firstPayload.compaction?.threshold,
    0.8,
    'the settings payload carries the compaction threshold',
  );
  assert.equal(
    firstPayload.compaction?.idle,
    false,
    'idle compaction is off unless the user turns it on',
  );
  assert.equal(
    firstPayload.compaction?.hideBeforeSummary,
    true,
    'earlier turns are hidden at the latest summary by default',
  );
  // ---- add + discovery -------------------------------------------------
  send(child, {
    id: 5,
    method: 'webview.message',
    params: {
      message: {
        type: 'settings-add',
        connId: 'localhost',
        kind: 'openai',
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        apiKey: 'test-key',
      },
    },
  });
  const store = await waitRequest(
    (r) => r.method === 'secrets.store',
    'the key write',
  );
  assert.equal(store.params.key, 'plato.providers.localhost.apiKey');
  assert.equal(store.params.value, 'test-key');
  await waitFile(
    (s) =>
      Array.isArray(s['plato.connections']) &&
      s['plato.connections'][0]?.models?.includes('o4-mini'),
    'the discovered models',
  );
  const afterAdd = settingsFile();
  assert.deepEqual(
    [...afterAdd['plato.connections'][0].models].sort(),
    ['o4-mini', 'stub-model'],
  );
  assert.equal(
    readFileSync(SETTINGS, 'utf8').includes('test-key'),
    false,
    'the key never enters the settings file',
  );

  // ---- model, reasoning, compaction, protected, Others -----------------
  send(child, {
    id: 6,
    method: 'webview.message',
    params: { message: { type: 'model', value: 'localhost:o4-mini' } },
  });
  await waitFile((s) => s['plato.model'] === 'localhost:o4-mini', 'model');

  send(child, {
    id: 7,
    method: 'webview.message',
    params: { message: { type: 'set-reasoning', value: 'medium' } },
  });
  await waitFile((s) => s['plato.reasoning'] === 'medium', 'reasoning');

  send(child, {
    id: 8,
    method: 'webview.message',
    params: {
      message: { type: 'set-compaction-threshold', value: 0.7 },
    },
  });
  await waitFile(
    (s) => s['plato.compaction.threshold'] === 0.7,
    'compaction threshold',
  );

  // D49cm: idle compaction is a setting, off by default, and the page's
  // checkbox is the way to turn it on.
  send(child, {
    id: 8.1,
    method: 'webview.message',
    params: {
      message: { type: 'set-compaction-idle', value: true },
    },
  });
  await waitFile(
    (s) => s['plato.compaction.idle'] === true,
    'idle compaction',
  );

  send(child, {
    id: 9,
    method: 'webview.message',
    params: { message: { type: 'openSettings' } },
  });
  const second = await waitFor(
    (m) =>
      m.method === 'webview.post' &&
      m.params.message?.type === 'settings' &&
      m.params.message.open === true,
    'the second settings payload',
  );
  assert.equal(
    second.params.message.compaction?.threshold,
    0.7,
    'a re-render reads the stored threshold, not the default',
  );
  send(child, {
    id: 10,
    method: 'webview.message',
    params: {
      message: { type: 'secrets-add-name', value: '*.m3a-secret' },
    },
  });
  await waitFile(
    (s) => s['plato.secrets.protect'].includes('*.m3a-secret'),
    'the protected name',
  );

  send(child, {
    id: 11,
    method: 'webview.message',
    params: {
      message: { type: 'settings-respect-gitignore', value: true },
    },
  });
  await waitFile(
    (s) => s['plato.search.respectGitignore'] === true,
    'the Others switch',
  );

  // ---- replace the key -------------------------------------------------
  send(child, {
    id: 12,
    method: 'webview.message',
    params: {
      message: {
        type: 'settings-set-key',
        connId: 'localhost',
        apiKey: 'test-key-2',
      },
    },
  });
  const replace = await waitRequest(
    (r) =>
      r.method === 'secrets.store' &&
      r.params.value === 'test-key-2',
    'the replacement key',
  );
  assert.equal(replace.params.key, 'plato.providers.localhost.apiKey');

  // ---- shutdown, then a reload from the same file ----------------------
  await shutdown(child);
  const beforeReload = settingsFile();
  assert.equal(beforeReload['plato.model'], 'localhost:o4-mini');
  assert.equal(beforeReload['plato.reasoning'], 'medium');
  assert.equal(beforeReload['plato.compaction.threshold'], 0.7);
  assert.deepEqual(beforeReload['plato.secrets.protect'], ['*.m3a-secret']);
  assert.equal(beforeReload['plato.search.respectGitignore'], true);

  requests.length = 0;
  notifications.length = 0;
  cursor = 0;
  sidecar = startSidecar();
  const reloaded = sidecar.child;
  send(reloaded, {
    id: 20,
    method: 'init',
    params: {
      root: ROOT,
      settingsPath: SETTINGS,
      stateDir: STATE,
      workspaceStateFile: WORKSPACE_STATE,
      version: 'test',
    },
  });
  await waitFor((m) => m.id === 20, 'reload init');
  send(reloaded, {
    id: 21,
    method: 'command',
    params: { command: 'plato.openChat' },
  });
  await waitFor((m) => m.method === 'webview.html', 'reload HTML');
  await waitFor((m) => m.id === 21, 'reload openChat');
  send(reloaded, {
    id: 22,
    method: 'webview.message',
    params: { message: { type: 'ready' } },
  });
  await waitFor(
    (m) => m.method === 'webview.post' && m.params.message?.type === 'restore',
    'reload restore',
  );
  send(reloaded, {
    id: 23,
    method: 'webview.message',
    params: { message: { type: 'openSettings' } },
  });
  const reloadPayload = (
    await waitFor(
      (m) =>
        m.method === 'webview.post' &&
        m.params.message?.type === 'settings' &&
        m.params.message.open === true,
      'the reload settings payload',
    )
  ).params.message;
  assert.equal(reloadPayload.defaultModel, 'localhost:o4-mini');
  assert.equal(reloadPayload.reasoning, 'medium');
  assert.equal(reloadPayload.compaction?.threshold, 0.7);
  assert.equal(
    reloadPayload.compaction?.idle,
    true,
    'the settings payload carries the idle choice',
  );
  assert.equal(reloadPayload.respectGitignore, true);
  assert.deepEqual(reloadPayload.secrets.extra, ['*.m3a-secret']);
  assert.equal(reloadPayload.connections[0].keyStatus, 'set');
  assert.deepEqual(
    [...reloadPayload.connections[0].models].sort(),
    ['o4-mini', 'stub-model'],
  );
  await shutdown(reloaded);

  console.log('PASS M3a settings host');
  console.log(`  secrets: ${[...secrets.keys()].join(', ')}`);
} catch (error) {
  failure = error;
} finally {
  modelServer.close();
  if (sidecar?.child.exitCode === null) sidecar.child.kill();
}

if (failure !== null) {
  console.error('FAIL M3a settings host');
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exitCode = 1;
}
