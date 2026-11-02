/**
 * M2 protocol tests: the sidecar's stdio contract.
 *
 * What it proves:
 *   - newline-delimited framing and request/response correlation;
 *   - init, command, and page-message routing;
 *   - an unknown method returns an error and does not crash;
 *   - RPC-backed dialogs and credential storage reach the host;
 *   - a request that is never answered times out;
 *   - shutdown is answered and the process leaves.
 *
 * It does NOT prove the C# shell or WebView2. Those are the VSIX's tests.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'plato-host.cjs');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-bridge-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-bridge-root-'));
const STATE = mkdtempSync(join(tmpdir(), 'plato-vs-bridge-state-'));
const SETTINGS = join(STATE, 'settings.json');

mkdirSync(join(HOME, '.plato'), { recursive: true });
writeFileSync(
  SETTINGS,
  JSON.stringify({
    'plato.connections': [
      {
        id: 'stub',
        kind: 'openai',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: ['stub-model'],
      },
    ],
    'plato.model': 'stub:stub-model',
  }),
);

const child = spawn(process.execPath, [BUNDLE], {
  env: {
    ...process.env,
    HOME,
    USERPROFILE: HOME,
    PLATO_VS_RPC_TIMEOUT_MS: '200',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

const messages = [];
const waiters = [];
let cursor = 0;

function dispatch(message) {
  messages.push(message);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
}

createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
  'line',
  (line) => {
    if (line.trim().length === 0) return;
    try {
      dispatch(JSON.parse(line));
    } catch (error) {
      throw new Error(`the sidecar wrote a line that is not JSON: ${line} ${error}`);
    }
  },
);

const exited = new Promise((resolve) => child.once('exit', resolve));

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitFor(predicate, label, timeoutMs = 15_000) {
  for (let i = cursor; i < messages.length; i += 1) {
    if (predicate(messages[i])) {
      cursor = i + 1;
      return Promise.resolve(messages[i]);
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const recent = messages
        .slice(-10)
        .map((m) => m.method ?? `response:${m.id}`)
        .join(', ');
      reject(
        new Error(
          `timeout waiting for ${label}. recent: ${recent}. stderr: ${stderr.slice(-500)}`,
        ),
      );
    }, timeoutMs);
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        cursor = messages.lastIndexOf(message) + 1;
        resolve(message);
      },
      timer,
    });
  });
}

const byId = (id) => (message) => message.id === id;
const byMethod = (method) => (message) => message.method === method;

let failure = null;
try {
  // ---- init -------------------------------------------------------------
  send({
    id: 1,
    method: 'init',
    params: {
      root: ROOT,
      settingsPath: SETTINGS,
      stateDir: STATE,
      workspaceStateFile: join(STATE, 'workspace-state', 'stub.json'),
      version: 'test',
    },
  });
  const init = await waitFor(byId(1), 'the init response');
  assert.ok(!init.error, `init failed: ${JSON.stringify(init)}`);
  assert.equal(init.result.ok, true, 'init reports ok');

  // ---- command -> html --------------------------------------------------
  send({ id: 2, method: 'command', params: { command: 'plato.openChat' } });
  const html = await waitFor(byMethod('webview.html'), 'the chat HTML');
  assert.ok(
    html.params.html.includes('<title>Plato</title>'),
    'the HTML is the real chat page',
  );
  assert.equal((await waitFor(byId(2), 'the command response')).error, undefined);

  // ---- page message -> post --------------------------------------------
  send({
    id: 3,
    method: 'webview.message',
    params: { message: { type: 'ready' } },
  });
  const restore = await waitFor(
    (m) => m.method === 'webview.post' && m.params.message?.type === 'restore',
    'the restore payload',
  );
  assert.ok(restore, 'the page message reached the host');
  await waitFor(byId(3), 'the page-message response');

  // ---- unknown method ---------------------------------------------------
  send({ id: 4, method: 'does.not.exist', params: {} });
  const unknown = await waitFor(byId(4), 'the unknown-method response');
  assert.equal(unknown.error.code, -32601, 'unknown methods are an error');
  assert.ok(unknown.error.message.includes('does.not.exist'));

  // ---- dialog and secret RPCs ------------------------------------------
  send({ id: 5, method: 'command', params: { command: 'plato.setApiKey' } });

  const pick = await waitFor(byMethod('ui.quickPick'), 'the connection picker');
  assert.deepEqual(pick.params.items, [{ label: 'stub' }]);
  send({ id: pick.id, result: { index: 0 } });

  const input = await waitFor(byMethod('ui.inputBox'), 'the key input');
  assert.equal(input.params.password, true, 'the key input is masked');
  send({ id: input.id, result: { value: 'sk-live-test' } });

  const store = await waitFor(byMethod('secrets.store'), 'the secret write');
  assert.equal(store.params.key, 'plato.providers.stub.apiKey');
  assert.equal(store.params.value, 'sk-live-test');
  send({ id: store.id, result: { ok: true } });

  const notice = await waitFor(byMethod('ui.message'), 'the confirmation');
  assert.ok(notice.params.message.includes('API key stored'));
  send({ id: notice.id, result: {} });

  const setKey = await waitFor(byId(5), 'the setApiKey response');
  assert.equal(setKey.error, undefined, JSON.stringify(setKey));

  // ---- a request that is never answered --------------------------------
  send({ id: 6, method: 'command', params: { command: 'plato.manageKeys' } });
  await waitFor(byMethod('ui.quickPick'), 'the manage picker');
  // Deliberately do not answer it. The request times out; a dialog with no
  // answer is a cancel, so the command finishes without an error.
  const cancelled = await waitFor(byId(6), 'the cancelled command response');
  assert.equal(
    cancelled.error,
    undefined,
    `a timed-out picker must not fail the command: ${JSON.stringify(cancelled)}`,
  );

  // ---- a timed-out dialog must not stop the sidecar --------------------
  // This is the shape of the real crash: the page asks for the file picker
  // through a webview message, the host never answers, and the rejection
  // used to reach Node's unhandled-rejection handler.
  send({
    id: 8,
    method: 'webview.message',
    params: { message: { type: 'attach' } },
  });
  await waitFor(byMethod('ui.openDialog'), 'the attachment picker');
  // Deliberately do not answer it. The timeout override is 200 ms.
  await new Promise((resolve) => setTimeout(resolve, 700));
  send({ id: 9, method: 'command', params: { command: 'plato.openChat' } });
  const alive = await waitFor(byId(9), 'the command after a dialog timeout');
  assert.equal(
    alive.error,
    undefined,
    `a timed-out dialog stopped the sidecar: ${JSON.stringify(alive)}`,
  );

  // ---- shutdown ---------------------------------------------------------
  send({ id: 7, method: 'shutdown' });
  const bye = await waitFor(byId(7), 'the shutdown response');
  assert.equal(bye.result.ok, true);
  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('still running'), 5_000)),
  ]);
  assert.notEqual(code, 'still running', 'the sidecar left after shutdown');

  console.log('PASS M2 sidecar protocol');
  console.log(`  messages: ${messages.length}`);
} catch (error) {
  failure = error;
} finally {
  if (child.exitCode === null) {
    child.kill();
  }
}

if (failure !== null) {
  console.error('FAIL M2 sidecar protocol');
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exitCode = 1;
}
