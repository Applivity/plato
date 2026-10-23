/**
 * M1 spike: prove the existing VS Code host runs outside VS Code.
 *
 * What it proves:
 *   - activate() runs against the shim;
 *   - the chat HTML is produced;
 *   - the page's `ready` message restores the host state;
 *   - a scripted provider run streams and completes;
 *   - an approval card is drawn and the answer reaches the loop;
 *   - the approved write lands on disk;
 *   - undo removes the file Plato created;
 *   - a question card is answered and the run continues;
 *   - a mode request is approved and the picker is told;
 *   - a mode change is persisted in workspaceState;
 *   - a transcript is written to ~/.plato;
 *   - disposing the panel is clean.
 *
 * It does NOT prove the C# shell or WebView2. Those are M2.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-root-'));
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

async function waitFor(predicate, label, from = 0, timeoutMs = 30_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) {
      return await posts[i];
    }
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const recent = posts
        .slice(from)
        .slice(-8)
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

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
    body: JSON.stringify({ steps }),
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

let failure = null;
try {
  const host = start({
    root: ROOT,
    stateDir: join(HOME, 'state'),
    settings,
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  assert.ok(
    transport.html.includes('<title>Plato</title>'),
    'the chat HTML was produced',
  );
  assert.ok(
    transport.html.includes('id="log"'),
    'the chat HTML has the transcript element',
  );

  host.receive({ type: 'ready' });
  await waitFor((m) => m.type === 'restore', 'the restore payload');

  // ---- run 1: write, approval, completion -------------------------------
  await setScript([
    {
      calls: [
        {
          tool: 'write_file',
          args: { path: 'probe.txt', content: 'hello from the shim' },
        },
      ],
    },
    { text: 'Done. probe.txt is written.' },
  ]);

  let mark = posts.length;
  host.receive({
    type: 'ask',
    text: 'Create probe.txt with the text "hello from the shim".',
  });

  const approval = await waitFor(
    (m) => m.type === 'approval',
    'the approval card',
    mark,
  );
  assert.equal(approval.tool, 'write_file', 'the card is for the write');

  host.receive({ type: 'approve', value: 'yes' });

  let end = await waitFor(
    (m) => m.type === 'done' || m.type === 'error',
    'run 1 to finish',
    mark,
  );
  assert.equal(end.type, 'done', `run 1 failed: ${JSON.stringify(end)}`);
  assert.equal(
    readFileSync(join(ROOT, 'probe.txt'), 'utf8'),
    'hello from the shim',
    'the approved write landed on disk',
  );
  await settle();

  // ---- undo: remove the file Plato created ------------------------------
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'undo', text: '' });
  const undoCard = await waitFor(
    (m) => m.type === 'undo',
    'the undo card',
    mark,
  );
  assert.ok(undoCard, 'the undo card was drawn');
  host.receive({ type: 'undo-apply', scope: 'request' });
  await waitFor((m) => m.type === 'undo-done', 'the undo to finish', mark);
  assert.equal(
    existsSync(join(ROOT, 'probe.txt')),
    false,
    'undo removed the file Plato created',
  );
  await settle();

  // ---- run 2: question card --------------------------------------------
  await setScript([
    {
      calls: [
        {
          tool: 'ask_user',
          args: {
            questions: [
              {
                question: 'Which name should I use?',
                options: ['Alpha', 'Beta'],
                recommended: 'Alpha',
              },
            ],
          },
        },
      ],
    },
    { text: 'Done with the answer.' },
  ]);

  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask me one question, then finish.' });
  const question = await waitFor(
    (m) => m.type === 'user-question',
    'the question card',
    mark,
  );
  assert.equal(question.questions.length, 1, 'one question was asked');
  host.receive({ type: 'user-answer', answers: ['Alpha'] });
  end = await waitFor(
    (m) => m.type === 'done' || m.type === 'error',
    'run 2 to finish',
    mark,
  );
  assert.equal(end.type, 'done', `run 2 failed: ${JSON.stringify(end)}`);
  await settle();

  // ---- run 3: mode request ---------------------------------------------
  await setScript([
    {
      calls: [
        {
          tool: 'request_mode',
          args: { mode: 'auto', reason: 'I need to write without a card.' },
        },
      ],
    },
    { text: 'Done after the switch.' },
  ]);

  mark = posts.length;
  host.receive({ type: 'ask', text: 'Ask to switch to auto, then finish.' });
  const modeRequest = await waitFor(
    (m) => m.type === 'mode-request',
    'the mode request card',
    mark,
  );
  assert.equal(modeRequest.mode, 'auto', 'the card asks for auto');
  host.receive({ type: 'mode-request-answer', allow: true });
  await waitFor(
    (m) => m.type === 'mode-state' && m.text === 'auto',
    'the picker to be told',
    mark,
  );
  end = await waitFor(
    (m) => m.type === 'done' || m.type === 'error',
    'run 3 to finish',
    mark,
  );
  assert.equal(end.type, 'done', `run 3 failed: ${JSON.stringify(end)}`);
  await settle();

  // ---- workspaceState persistence --------------------------------------
  host.receive({ type: 'mode', value: 'plan' });
  await settle();
  const state = JSON.parse(
    readFileSync(join(HOME, 'state', 'workspace-state.json'), 'utf8'),
  );
  assert.equal(state['plato.chatMode'], 'plan', 'the mode was persisted');

  // ---- transcript -------------------------------------------------------
  const runs = join(HOME, '.plato', 'runs');
  assert.ok(existsSync(runs), '~/.plato/runs exists');
  const projectDirs = readdirSync(runs);
  assert.ok(projectDirs.length > 0, 'a transcript directory was written');
  const transcripts = readdirSync(join(runs, projectDirs[0]));
  assert.ok(transcripts.length >= 3, 'a transcript per run was written');

  // ---- dispose ----------------------------------------------------------
  const panel = host.panel();
  panel.dispose();
  await settle();
  assert.equal(disposed, true, 'the panel reported disposal');

  console.log('PASS M1 shim spike');
  console.log(`  html: ${transport.html.length} chars`);
  console.log(`  posts: ${posts.length}`);
  console.log(`  transcripts: ${transcripts.length}`);
  console.log(`  runs: ${join(runs, projectDirs[0])}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill('SIGTERM');
}

if (failure !== null) {
  console.error('FAIL M1 shim spike');
  console.error(failure instanceof Error ? failure.stack : failure);
  process.exitCode = 1;
}
