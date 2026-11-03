/**
 * Multi-window host test: two sidecar processes, one per window.
 *
 * What it proves:
 *   - each window writes its own live state file, so one window's log cannot
 *     appear in the other;
 *   - the archived-chat list is one shared file, and two windows that archive
 *     at the same time both survive the merge (no last-writer-wins loss);
 *   - `panel.close` answers only after the chat has been archived, which is
 *     the ordering the shell uses before it stops the process.
 *
 * It does NOT prove WebView2 rendering or the Visual Studio tool-window
 * frames. The real windows and their screenshots are the other witness.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-windows-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-windows-root-'));
const STATE = join(HOME, 'state');
const SHARED = join(STATE, 'shared-chats.json');
const WINDOW_ONE = join(STATE, 'window-one.json');
const WINDOW_TWO = join(STATE, 'window-two.json');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

mkdirSync(STATE, { recursive: true });

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
    body: JSON.stringify({ steps, observers: [] }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
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
  'plato.secrets.protect': [],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};
const settingsPath = join(STATE, 'settings.json');
writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');

class Sidecar {
  constructor(name, workspaceStateFile) {
    this.name = name;
    this.workspaceStateFile = workspaceStateFile;
    this.pending = new Map();
    this.posts = [];
    this.nextId = 1;
    this.child = spawn(
      process.execPath,
      [join(REPO, 'packages/vs/dist/plato-host.cjs')],
      {
        env: {
          ...process.env,
          HOME,
          USERPROFILE: HOME,
          PLATO_VS: '1',
          PLATO_VS_LOG: join(STATE, `${name}.log`),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.errors = '';
    this.child.stderr.on('data', (chunk) => {
      this.errors += String(chunk);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      if (line.trim().length === 0) return;
      const message = JSON.parse(line);
      if (typeof message.id === 'number' && 'method' in message) {
        // The sidecar asks the shell for credentials. This test answers for
        // both windows; the value only has to exist for the stub connection.
        let result = {};
        if (message.method === 'secrets.get') result = { value: 'test-key' };
        if (message.method === 'secrets.store' || message.method === 'secrets.delete') {
          result = { ok: true };
        }
        this.child.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`);
        return;
      }
      if (typeof message.id === 'number' && !('method' in message)) {
        const waiter = this.pending.get(message.id);
        if (waiter) {
          this.pending.delete(message.id);
          if (message.error) waiter.reject(new Error(message.error.message));
          else waiter.resolve(message.result);
        }
        return;
      }
      if (message.method === 'webview.post') {
        this.posts.push(message.params?.message);
      }
    });
  }

  request(method, params = {}, timeoutMs = 60_000) {
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name}: ${method} timed out. ${this.errors}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(line);
    });
  }

  async init() {
    return await this.request('init', {
      root: ROOT,
      settingsPath,
      stateDir: STATE,
      workspaceStateFile: this.workspaceStateFile,
      sharedStateFile: SHARED,
      version: '0.1.5',
    }, 20_000);
  }

  async waitPost(predicate, label, from = 0, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (let i = from; i < this.posts.length; i += 1) {
        if (predicate(this.posts[i])) return this.posts[i];
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${this.name}: timeout waiting for ${label}. ${this.errors}`);
  }

  async ask(text) {
    const mark = this.posts.length;
    await this.request('webview.message', { message: { type: 'ask', text } });
    const done = await this.waitPost(
      (m) => m && (m.type === 'done' || m.type === 'error'),
      `"${text}" to finish`,
      mark,
    );
    assert.equal(done.type, 'done', `${this.name}: ${JSON.stringify(done)}`);
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failure = null;
try {
  writeFileSync(join(ROOT, 'note.txt'), 'a stable note\n', 'utf8');
  await setScript([{ text: 'Answer from window one.' }, { text: 'Answer from window two.' }]);

  const one = new Sidecar('window-one', WINDOW_ONE);
  const two = new Sidecar('window-two', WINDOW_TWO);

  await one.init();
  await two.init();
  await one.request('command', { command: 'plato.openChat' });
  await two.request('command', { command: 'plato.openChat' });

  await one.request('webview.message', { message: { type: 'ready' } });
  await two.request('webview.message', { message: { type: 'ready' } });

  await one.ask('Window one task.');
  await two.ask('Window two task.');

  /* Each window kept its own live log. */
  await sleep(300);
  const stateOne = readJson(WINDOW_ONE);
  const stateTwo = readJson(WINDOW_TWO);
  assert.ok(
    (stateOne['plato.chatLog'] || []).some((e) => e.text === 'Window one task.'),
    'window one has its own task',
  );
  assert.ok(
    !(stateOne['plato.chatLog'] || []).some((e) => e.text === 'Window two task.'),
    'window one does not have window two\'s task',
  );
  assert.ok(
    (stateTwo['plato.chatLog'] || []).some((e) => e.text === 'Window two task.'),
    'window two has its own task',
  );

  /* Both close at the same time: the shared list must contain both. */
  await Promise.all([
    one.request('panel.close', {}),
    two.request('panel.close', {}),
  ]);
  await sleep(300);
  const shared = readJson(SHARED);
  const chats = shared['plato.chatSessions'] || [];
  assert.equal(chats.length, 2, `both windows archived, got ${JSON.stringify(chats.map((c) => c.title))}`);
  assert.ok(
    chats.some((c) => (c.log || []).some((e) => e.text === 'Window one task.')),
    'window one\'s chat is in the shared History',
  );
  assert.ok(
    chats.some((c) => (c.log || []).some((e) => e.text === 'Window two task.')),
    'window two\'s chat is in the shared History',
  );

  one.child.stdin.end();
  two.child.stdin.end();
  await sleep(100);
  console.log('PASS multi-window host isolation and shared History');
  console.log(`  shared: ${SHARED}`);
  console.log(`  chats: ${chats.length}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill();
}

if (failure) {
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exit(1);
}
