/**
 * M4a host test: the agent-features half of M4, through the EXISTING IDE host
 * and the unchanged chat HTML.
 *
 * What it proves, with no VS Code, no provider key and no network:
 *   - MCP servers are read from ~/.plato/mcp.json; Settings reports each one's
 *     configuration and the last run's outcome; a configured server's tool is
 *     offered to the model, gated by the ordinary approval card, and its result
 *     reaches the model; a disabled server is absent from the tool list and says
 *     nothing; and a plan run starts no server while keeping the last outcome;
 *   - an image and a text file are picked by the native dialog contract, the
 *     image is validated by its BYTES, and the model receives both — the image
 *     as a parts-array on the opening user turn, the file as its text;
 *   - /undo draws the undo card, deletes a file Plato created, puts back a file
 *     Plato edited, and a restore is the redo; a file the user touched since is
 *     refused and no card is drawn;
 *   - a protected text file reads with its VALUES masked; a protected text file
 *     the masker cannot parse raises the reveal card once; an allow shows it in
 *     full; a decline returns the refusal and the model never sees the value;
 *   - five identical calls raise the stuck card with the core copy; Keep going
 *     resumes the run and carries the user's words to the model; Stop ends it
 *     and does not consume the model's next step.
 *
 * The copy assertions are the point: M4a requires the SAME visible copy as the
 * VS Code extension. The host and the HTML are shared, so drift here is a real
 * product defect.
 *
 * It does NOT prove WebView2 rendering. The real Visual Studio window and its
 * screenshots are the other witness.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatValue } from './chat-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-m4a-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-m4a-root-'));
const STATE = join(HOME, 'state');
const PLATO_HOME = join(HOME, '.plato');
const FAKE_MCP = join(REPO, 'scripts', 'field', 'fake-mcp.mjs');
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

async function setScript(steps) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps }),
  });
  assert.equal(response.status, 200, 'the stub accepted the script');
}

async function stubLog() {
  return await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
}

/** The newest agent turn the stub recorded, ignoring title/observer calls. */
async function agentTurn() {
  const log = await stubLog();
  const turns = log.log.filter((entry) => entry.toolsOffered > 0);
  assert.ok(turns.length > 0, 'the stub recorded an agent turn');
  return turns[turns.length - 1];
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
  // The protect list the run is given. The maskable file and the blob both match.
  'plato.secrets.protect': ['*.m4a-secret'],
  'plato.secrets.allow': [],
  'plato.search.respectGitignore': false,
};

const posts = [];
const waiters = [];
let disposed = false;
/** Answers the shim's `ui.openDialog` requests, in order. */
const dialogAnswers = [];
/** Every native request the shim made, so a config action can be witnessed. */
const requests = [];

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
  async request(method, params) {
    requests.push({ method, params });
    if (method === 'ui.openDialog') {
      return dialogAnswers.shift();
    }
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
        .slice(-12)
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

function postIndexOf(predicate, from = 0) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return i;
  }
  return -1;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function stateFile() {
  return JSON.parse(readFileSync(join(STATE, 'workspace-state.json'), 'utf8'));
}

async function waitState(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(stateFile())) return stateFile();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for workspaceState: ${label}`);
}

async function runToEnd(host, task, from, timeoutMs = 60_000) {
  host.receive({ type: 'ask', text: task });
  return await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    timeoutMs,
  );
}

/** The host starts in edit; the picker only posts when the mode changes. */
let currentMode = 'edit';
async function switchMode(host, value) {
  if (currentMode === value) return;
  const mark = posts.length;
  host.receive({ type: 'mode', value });
  await waitPost(
    (m) => m.type === 'mode-state' && m.text === value,
    `the picker to show ${value}`,
    mark,
  );
  currentMode = value;
  await settle();
}

/** The PNG every image path here uses: a real 1x1 PNG, so the bytes pass. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let failure = null;
try {
  /* ------------------------------------------------------------------ */
  /* Test files                                                         */
  /* ------------------------------------------------------------------ */
  writeFileSync(join(ROOT, 'notes.txt'), 'attached note body\n', 'utf8');
  writeFileSync(join(ROOT, 'picture.png'), PNG);
  writeFileSync(join(ROOT, 'broken.png'), 'this is not a png\n', 'utf8');
  writeFileSync(join(ROOT, 'config.m4a-secret'), 'API_KEY=sk-live-m4a-0001\nDB_URL=postgres://probe/db\n', 'utf8');
  writeFileSync(join(ROOT, 'blob.m4a-secret'), '{"token":"sk-live-reveal-m4a"}\n', 'utf8');
  writeFileSync(join(ROOT, 'blob2.m4a-secret'), '{"token":"sk-live-reveal-DENY"}\n', 'utf8');
  const outside = join(HOME, 'outside.txt');
  writeFileSync(outside, 'outside the workspace\n', 'utf8');

  const MCP_CONFIG = `${JSON.stringify(
    {
      mcpServers: {
        fake: { command: process.execPath, args: [FAKE_MCP] },
        off: {
          command: process.execPath,
          args: [FAKE_MCP],
          disabled: true,
        },
      },
    },
    null,
    2,
  )}\n`;
  mkdirSync(PLATO_HOME, { recursive: true });
  writeFileSync(join(PLATO_HOME, 'mcp.json'), MCP_CONFIG, 'utf8');

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
  await waitPost((m) => m.type === 'restore', 'restore');

  /* ================================================================== */
  /* 1. MCP configuration and server status                             */
  /* ================================================================== */
  let mark = posts.length;
  host.receive({ type: 'openSettings' });
  let payload = await waitPost(
    (m) => m.type === 'settings' && m.open === true,
    'the Settings payload',
    mark,
  );
  assert.equal(payload.mcp.available, true, 'mcp.json is configured');
  assert.equal(payload.mcp.error, '', 'mcp.json parsed');
  const fakeBefore = payload.mcp.servers.find((s) => s.name === 'fake');
  const offBefore = payload.mcp.servers.find((s) => s.name === 'off');
  assert.deepEqual(fakeBefore, { name: 'fake', disabled: false, tools: null, error: '' },
    'a server that has not run reports tools: null, not 0');
  assert.equal(offBefore.disabled, true, 'the disabled server is reported as disabled');

  // -- configuration: the enable/disable switch rewrites the file --------
  mark = posts.length;
  host.receive({ type: 'set-mcp-disabled', name: 'fake', disabled: true });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.flash === 'fake disabled — applies from the next run.',
    'the disabled switch confirmation',
    mark,
  );
  assert.equal(
    payload.mcp.servers.find((s) => s.name === 'fake').disabled,
    true,
    'the Settings switch reports the server off',
  );
  let onDisk = JSON.parse(readFileSync(join(PLATO_HOME, 'mcp.json'), 'utf8'));
  assert.equal(onDisk.mcpServers.fake.disabled, true, 'the switch rewrote mcp.json');

  mark = posts.length;
  host.receive({ type: 'set-mcp-disabled', name: 'fake', disabled: false });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.flash === 'fake enabled — applies from the next run.',
    'the enabled switch confirmation',
    mark,
  );
  assert.equal(
    payload.mcp.servers.find((s) => s.name === 'fake').disabled,
    false,
    'the Settings switch reports the server on again',
  );
  onDisk = JSON.parse(readFileSync(join(PLATO_HOME, 'mcp.json'), 'utf8'));
  assert.notEqual(onDisk.mcpServers.fake.disabled, true, 'the switch rewrote mcp.json back');

  // -- Open mcp.json asks the shell to open the real file ----------------
  mark = requests.length;
  host.receive({ type: 'open-mcp' });
  await settle();
  assert.ok(
    requests.some(
      (r) =>
        r.method === 'editor.open' &&
        String(r.params?.path ?? '').endsWith(join('.plato', 'mcp.json')),
    ),
    'Open mcp.json opens the real ~/.plato/mcp.json in the editor',
  );

  // The model calls the configured server's tool, behind the ordinary card.
  await switchMode(host, 'edit');
  await setScript([
    { calls: [{ tool: 'mcp__fake__echo', args: { text: 'hi' } }] },
    { text: 'The echo tool returned what I sent it.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Use the echo tool to send the word hi.' });
  const mcpCard = await waitPost((m) => m.type === 'approval', 'the MCP approval card', mark);
  assert.equal(mcpCard.heading, 'Let Plato use this tool?', 'the MCP card asks about the tool');
  assert.equal(
    mcpCard.allowAll,
    'Allow every use of this tool this session',
    'the session button names the action, not the raw tool name',
  );
  host.receive({ type: 'approve', value: 'yes' });
  const mcpDone = await waitPost((m) => m.type === 'done', 'the MCP run to finish', mark);
  assert.equal(mcpDone.type, 'done', JSON.stringify(mcpDone));

  // The start notice names the server and its tool count.
  assert.ok(
    posts.some(
      (m, i) => i >= mark && m.type === 'notice' && m.text === 'MCP fake: 1 tools available',
    ),
    'the run says the MCP server started and how many tools it exposed',
  );

  // The result the fake server produced reached the model.
  let turn = await agentTurn();
  assert.ok(
    turn.toolResults.some((r) => r.head.includes('echo:hi')),
    'the MCP tool result reached the model',
  );
  assert.ok(
    turn.toolNames.includes('mcp__fake__echo'),
    'the configured server was offered under mcp__<server>__<tool>',
  );
  assert.equal(
    turn.toolNames.some((name) => name.startsWith('mcp__off__')),
    false,
    'a disabled server contributed no tool',
  );

  // The run's outcome is now reported in Settings.
  mark = posts.length;
  host.receive({ type: 'openSettings' });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.open === true,
    'the Settings payload after the run',
    mark,
  );
  assert.deepEqual(
    payload.mcp.servers.find((s) => s.name === 'fake'),
    { name: 'fake', disabled: false, tools: 1, error: '' },
    'Settings reports the last run: the server exposed one tool',
  );
  assert.deepEqual(
    payload.mcp.servers.find((s) => s.name === 'off'),
    { name: 'off', disabled: true, tools: null, error: '' },
    'a disabled server says nothing and reports no run',
  );

  // plan starts no server, and the last run's outcome survives rather than
  // becoming "not run yet".
  await switchMode(host, 'plan');
  mark = posts.length;
  await setScript([{ text: 'I can read files and search the project.' }]);
  await runToEnd(host, 'Which tools do you have for this project?', mark);
  assert.equal(
    posts.some(
      (m, i) => i >= mark && m.type === 'notice' && String(m.text).startsWith('MCP '),
    ),
    false,
    'a plan run starts no MCP server and says nothing about one',
  );
  mark = posts.length;
  host.receive({ type: 'openSettings' });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.open === true,
    'the Settings payload after the plan run',
    mark,
  );
  assert.equal(
    payload.mcp.servers.find((s) => s.name === 'fake').tools,
    1,
    'a plan run keeps the last run that actually started the server',
  );
  // -- a malformed config is an error, never "no servers" ----------------
  writeFileSync(join(PLATO_HOME, 'mcp.json'), '{ not json\n', 'utf8');
  mark = posts.length;
  host.receive({ type: 'openSettings' });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.open === true,
    'the Settings payload with a broken mcp.json',
    mark,
  );
  assert.equal(payload.mcp.available, false, 'a broken config is not reported as empty');
  assert.ok(payload.mcp.error.length > 0, 'the parse error is reported, not swallowed');
  writeFileSync(join(PLATO_HOME, 'mcp.json'), MCP_CONFIG, 'utf8');
  await switchMode(host, 'auto');

  // -- a server that cannot start is reported, not fatal (D49ci) --------
  const badConfig = JSON.parse(MCP_CONFIG);
  badConfig.mcpServers.bad = { command: 'plato-no-such-command-9f3a' };
  writeFileSync(join(PLATO_HOME, 'mcp.json'), `${JSON.stringify(badConfig, null, 2)}\n`, 'utf8');
  mark = posts.length;
  await setScript([{ text: 'I have no MCP tools.' }]);
  const badRun = await runToEnd(host, 'Which MCP tools are available?', mark);
  assert.equal(badRun.type, 'done', JSON.stringify(badRun));
  assert.ok(
    posts.some(
      (m, i) => i >= mark && m.type === 'notice' && /^MCP bad failed to start — /.test(String(m.text)),
    ),
    'a server that cannot spawn is a notice, and the run continues',
  );
  mark = posts.length;
  host.receive({ type: 'openSettings' });
  payload = await waitPost(
    (m) => m.type === 'settings' && m.open === true,
    'the Settings payload with a failed server',
    mark,
  );
  const badRow = payload.mcp.servers.find((s) => s.name === 'bad');
  assert.equal(badRow.tools, 0, 'the failed server exposed no tools');
  assert.ok(badRow.error.length > 0, 'the failure reason is reported in Settings');
  writeFileSync(join(PLATO_HOME, 'mcp.json'), MCP_CONFIG, 'utf8');

  /* ================================================================== */
  /* 2. Images and file attachments                                     */
  /* ================================================================== */
  mark = posts.length;
  dialogAnswers.push({ paths: [join(ROOT, 'picture.png'), join(ROOT, 'notes.txt')] });
  host.receive({ type: 'attach' });
  const attach = await waitPost((m) => m.type === 'attach-result', 'the attach result', mark);
  assert.equal(attach.accepted.length, 2, 'the image and the text file were accepted');
  const imageRow = attach.accepted.find((a) => a.image === true);
  const textRow = attach.accepted.find((a) => a.image !== true);
  assert.ok(imageRow, 'the PNG is offered as an image');
  assert.equal(imageRow.size, PNG.length, 'the image size is its RAW byte count');
  // D49cd: the picker returns absolute paths, so an inside file is stored as
  // the absolute path it was picked by; the chip and the task label use the
  // base name.
  assert.equal(textRow.path, join(ROOT, 'notes.txt'), 'the picked path is stored as itself');
  assert.equal(textRow.name, 'notes.txt', 'the chip shows the base name');
  assert.deepEqual(attach.rejected, [], 'nothing was refused');

  // A file offered as an image must BE one.
  mark = posts.length;
  dialogAnswers.push({ paths: [join(ROOT, 'broken.png')] });
  host.receive({ type: 'attach' });
  const badImage = await waitPost((m) => m.type === 'attach-result', 'the bad-image result', mark);
  assert.deepEqual(badImage.accepted, [], 'a corrupt PNG is not attached');
  assert.equal(
    badImage.rejected[0].error,
    'not a PNG, JPEG, WebP or GIF — the bytes are not an image, whatever the name says',
    'the refusal says the bytes were checked, not the name',
  );

  // D49cd: a file the USER picked outside the workspace is ACCEPTED. The
  // workspace rule is for tool calls the model makes, not for the picker — a
  // screenshot on the Desktop is the normal case. The absolute path is stored
  // and the chip shows the base name.
  mark = posts.length;
  dialogAnswers.push({ paths: [outside] });
  host.receive({ type: 'attach' });
  const away = await waitPost((m) => m.type === 'attach-result', 'the outside-file result', mark);
  assert.equal(away.accepted.length, 1, 'a picked file outside the workspace is attached');
  assert.equal(away.accepted[0].path, outside, 'its absolute path is what is stored');
  assert.equal(away.accepted[0].name, 'outside.txt', 'the chip shows the base name');
  assert.deepEqual(away.rejected, [], 'nothing was refused');

  // A deny-listed name outside the workspace is refused by the LIST, not by
  // containment — the guard that matters still applies.
  const outsideSecret = join(HOME, '.env');
  writeFileSync(outsideSecret, 'API_KEY=sk-live-outside-0001\n', 'utf8');
  mark = posts.length;
  dialogAnswers.push({ paths: [outsideSecret] });
  host.receive({ type: 'attach' });
  const secretAway = await waitPost((m) => m.type === 'attach-result', 'the outside-secret result', mark);
  assert.deepEqual(secretAway.accepted, [], 'a deny-listed outside file is not attached');
  assert.equal(
    secretAway.rejected[0].error,
    'on the secret deny-list',
    'the refusal is the deny-list, not containment',
  );

  // Send, and prove the MODEL received both — not merely that the picker did.
  await setScript([{ text: 'I have looked at both.' }]);
  mark = posts.length;
  const attachDone = await runToEnd(host, 'Look at the picture and the note.', mark);
  assert.equal(attachDone.type, 'done', JSON.stringify(attachDone));
  turn = await agentTurn();
  assert.equal(turn.imageParts, 1, 'the opening user turn carried exactly one image');
  assert.deepEqual(turn.imageMimes, ['image/png'], 'the image arrived as its sniffed MIME');
  const userText = turn.userTexts.join('\n');
  assert.ok(
    userText.includes('[attachment: notes.txt]'),
    'the text attachment reached the model as an attachment block',
  );
  assert.ok(
    userText.includes('attached note body'),
    'the attached file body reached the model',
  );
  // The outside text file was attached in the same batch; its content and the
  // base-name label reached the model too.
  assert.ok(
    userText.includes('[attachment: outside.txt]'),
    'an outside text file is labelled by its base name',
  );
  assert.ok(
    userText.includes('outside the workspace'),
    'an outside text file body reached the model',
  );

  // D49cd: an IMAGE outside the workspace is accepted and its BYTES reach the
  // provider — the founder's case, a screenshot on the Desktop.
  const outsidePng = join(HOME, 'desktop-shot.png');
  writeFileSync(outsidePng, PNG);
  mark = posts.length;
  dialogAnswers.push({ paths: [outsidePng] });
  host.receive({ type: 'attach' });
  const awayImage = await waitPost(
    (m) => m.type === 'attach-result',
    'the outside-image result',
    mark,
  );
  assert.equal(awayImage.accepted.length, 1, 'an outside image is attached');
  assert.equal(awayImage.accepted[0].image, true, 'and is treated as an image');
  assert.equal(awayImage.accepted[0].name, 'desktop-shot.png', 'the chip shows its base name');

  await setScript([{ text: 'Seen.' }]);
  mark = posts.length;
  const shotDone = await runToEnd(host, 'Look at the desktop screenshot.', mark);
  assert.equal(shotDone.type, 'done', JSON.stringify(shotDone));
  const shotTurn = await agentTurn();
  assert.equal(shotTurn.imageParts, 1, 'the outside image reached the provider');
  assert.deepEqual(shotTurn.imageMimes, ['image/png'], 'as its sniffed MIME');
  // Pending attachments are consumed by the send, so the next run is clean.
  await settle();

  /* ================================================================== */
  /* 3. The undo card and undo behavior                                 */
  /* ================================================================== */
  // -- a created file is REMOVED ---------------------------------------
  await setScript([
    { calls: [{ tool: 'write_file', args: { path: 'PLATO_M4A_CREATED.txt', content: 'created by plato\n' } }] },
    { text: 'Created it.' },
  ]);
  mark = posts.length;
  await runToEnd(host, 'Create the probe file.', mark);
  assert.equal(existsSync(join(ROOT, 'PLATO_M4A_CREATED.txt')), true, 'the file exists before undo');

  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'undo' });
  const createdCard = await waitPost((m) => m.type === 'undo', 'the undo card', mark);
  assert.equal(createdCard.title, 'Undo your last request?');
  assert.deepEqual(createdCard.willChange, [
    'PLATO_M4A_CREATED.txt — Plato made this file. Undo deletes it.',
  ]);
  assert.deepEqual(createdCard.willNotChange, []);
  assert.equal(createdCard.confirm, 'Delete 1 file', 'the button names the action, not the tool');
  assert.equal(createdCard.onlyLast, null, 'one file means no narrower action');

  mark = posts.length;
  host.receive({ type: 'undo-apply' });
  await waitPost((m) => m.type === 'undo-done', 'the created file to be undone', mark);
  assert.equal(existsSync(join(ROOT, 'PLATO_M4A_CREATED.txt')), false, 'undo removed the file');

  // -- an edited file is PUT BACK, and the undo is its own redo ---------
  writeFileSync(join(ROOT, 'PLATO_M4A_EDITED.txt'), 'version one\n', 'utf8');
  await setScript([
    {
      calls: [
        {
          tool: 'apply_diff',
          args: {
            path: 'PLATO_M4A_EDITED.txt',
            diffs: [{ search: 'version one', replace: 'version two' }],
          },
        },
      ],
    },
    { text: 'Changed it.' },
  ]);
  mark = posts.length;
  await runToEnd(host, 'Change the second probe file.', mark);
  assert.equal(readFileSync(join(ROOT, 'PLATO_M4A_EDITED.txt'), 'utf8'), 'version two\n');

  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'undo' });
  const editedCard = await waitPost((m) => m.type === 'undo', 'the edit undo card', mark);
  assert.deepEqual(editedCard.willChange, [
    'PLATO_M4A_EDITED.txt — Plato changed this file. Undo puts back the old copy.',
  ]);
  assert.equal(editedCard.confirm, 'Put back 1 file');
  mark = posts.length;
  host.receive({ type: 'undo-apply' });
  await waitPost((m) => m.type === 'undo-done', 'the edit to be put back', mark);
  assert.equal(
    readFileSync(join(ROOT, 'PLATO_M4A_EDITED.txt'), 'utf8'),
    'version one\n',
    'undo put back the exact old bytes',
  );

  // The restore is a write, so the undo of the undo is the redo. Nothing
  // special was built for it; the mechanism already does it.
  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'undo' });
  const redoCard = await waitPost((m) => m.type === 'undo', 'the redo card', mark);
  assert.equal(redoCard.confirm, 'Put back 1 file');
  mark = posts.length;
  host.receive({ type: 'undo-apply' });
  await waitPost((m) => m.type === 'undo-done', 'the redo', mark);
  assert.equal(
    readFileSync(join(ROOT, 'PLATO_M4A_EDITED.txt'), 'utf8'),
    'version two\n',
    'undoing the undo put the edit back',
  );

  // -- a file the USER touched since is refused, and no card is drawn ---
  writeFileSync(join(ROOT, 'PLATO_M4A_REFUSED.txt'), 'version one\n', 'utf8');
  await setScript([
    {
      calls: [
        {
          tool: 'apply_diff',
          args: {
            path: 'PLATO_M4A_REFUSED.txt',
            diffs: [{ search: 'version one', replace: 'version two' }],
          },
        },
      ],
    },
    { text: 'Changed it.' },
  ]);
  mark = posts.length;
  await runToEnd(host, 'Change the refusal probe.', mark);
  // The user's own edit, from outside Plato, after Plato's write.
  writeFileSync(join(ROOT, 'PLATO_M4A_REFUSED.txt'), 'version two\nthe user added this line\n', 'utf8');

  mark = posts.length;
  host.receive({ type: 'slash-run', id: 'undo' });
  const refusal = await waitPost(
    (m) => m.type === 'notice' && String(m.text).includes('you edited it after Plato wrote it'),
    'the undo refusal',
    mark,
  );
  assert.ok(
    refusal.text.includes('Undo did not change any file.'),
    'the refusal says nothing changed, which is the safety claim',
  );
  assert.equal(
    postIndexOf((m) => m.type === 'undo', mark),
    -1,
    'a card is not drawn when every file is refused',
  );
  assert.equal(
    readFileSync(join(ROOT, 'PLATO_M4A_REFUSED.txt'), 'utf8'),
    'version two\nthe user added this line\n',
    'the user-since file is untouched',
  );

  /* ================================================================== */
  /* 4. Protected-file masking and the reveal card                      */
  /* ================================================================== */
  await setScript([
    {
      calls: [
        { tool: 'read_file', args: { path: 'config.m4a-secret' } },
        { tool: 'read_file', args: { path: 'blob.m4a-secret' } },
        // Twice: the second read proves the answer is remembered for the
        // session rather than asked again.
        { tool: 'read_file', args: { path: 'blob.m4a-secret' } },
      ],
    },
    { text: 'I read both files.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read the config and the blob.' });
  const revealCard = await waitPost((m) => m.type === 'reveal', 'the reveal card', mark);
  assert.equal(revealCard.title, 'Show this protected file in full?');
  assert.deepEqual(revealCard.lines, [
    'blob.m4a-secret is protected.',
    'Plato hides a value by replacing it with a placeholder, and it cannot do that in this file, because the file does not hold "KEY=value" lines.',
    'The choice lasts until the session ends. To allow this file in every session, add it to the plato.secrets.allow setting.',
  ]);
  assert.equal(
    revealCard.cost,
    'If you show it, every value in this file goes into this conversation. Plato cannot hide the values afterwards.',
    'the cost is its own field',
  );
  assert.equal(revealCard.confirm, 'Show it this session');
  assert.equal(revealCard.cancel, 'Cancel');
  host.receive({ type: 'reveal-answer', allow: true });
  const revealDone = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the reveal run to finish',
    mark,
  );
  assert.equal(revealDone.type, 'done', JSON.stringify(revealDone));
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'reveal').length,
    1,
    'the card is asked once per file per session, not once per read',
  );

  turn = await agentTurn();
  const maskedResult = turn.toolResults.find((r) => r.masked === true);
  assert.ok(maskedResult, 'the maskable protected file produced a masked result');
  assert.ok(
    maskedResult.head.includes('API_KEY=«masked:API_KEY»'),
    'the model was shown the placeholder, with the key name intact',
  );
  assert.equal(
    turn.toolResults.some((r) => r.head.includes('sk-live-m4a-0001')),
    false,
    'the maskable value never reached the model',
  );
  assert.ok(
    turn.toolResults.some((r) => r.head.includes('sk-live-reveal-m4a')),
    'the value the user chose to show did reach the model — the card is not theatre',
  );

  // -- a decline is a refusal, and the value stays out ------------------
  await setScript([
    { calls: [{ tool: 'read_file', args: { path: 'blob2.m4a-secret' } }] },
    { text: 'I did not read it.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read the other protected file.' });
  await waitPost(
    (m) => m.type === 'reveal' && String(m.lines?.[0]).startsWith('blob2.m4a-secret'),
    'the second reveal card',
    mark,
  );
  host.receive({ type: 'reveal-answer', allow: false });
  const declined = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the declined run to finish',
    mark,
  );
  assert.equal(declined.type, 'done', JSON.stringify(declined));
  turn = await agentTurn();
  assert.ok(
    turn.toolResults.some((r) =>
      r.head.includes(
        'Plato did not show blob2.m4a-secret. It is protected, and Plato cannot replace its values with placeholders. The user chose not to show it in full.',
      ),
    ),
    'a declined reveal returns the refusal, not an empty answer',
  );
  assert.equal(
    turn.toolResults.some((r) => r.head.includes('sk-live-reveal-DENY')),
    false,
    'a declined value never reached the model',
  );

  /* ================================================================== */
  /* 5. The stuck card: Keep going, then Stop                           */
  /* ================================================================== */
  const REPEAT = () => ({
    calls: [
      {
        tool: 'todo_write',
        args: { todos: [{ content: 'the same step', status: 'in_progress' }] },
      },
    ],
  });

  // -- Keep going: the run resumes, and the user's words reach the model
  await setScript([REPEAT(), REPEAT(), REPEAT(), REPEAT(), REPEAT(), { text: 'Everything is done.' }]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Keep working until the task is done.' });
  const stuckCard = await waitPost((m) => m.type === 'stuck', 'the stuck card', mark);
  assert.equal(stuckCard.title, 'Plato is stuck');
  assert.equal(
    stuckCard.lead,
    'It has made the same call 5 times and got the same answer every time:',
  );
  assert.equal(stuckCard.call, 'updating its plan (the same step)',
    'the card names the call in words a person reads');
  assert.equal(
    stuckCard.help,
    'Repeating it will only give the same answer. Tell Plato what to do instead, or press Stop and rephrase your request. Keep going resumes the run, and Plato will not ask about this same call again.',
  );
  const guidance = 'That step is already recorded — stop updating the plan and finish.';
  mark = posts.length;
  host.receive({ type: 'stuck-answer', value: 'continue', guidance });
  const keptGoing = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the kept-going run to finish',
    mark,
  );
  assert.equal(keptGoing.type, 'done', JSON.stringify(keptGoing));
  assert.equal(
    String(keptGoing.text?.note ?? '').includes('Stopped — Plato was stuck'),
    false,
    'Keep going is not a stop',
  );
  turn = await agentTurn();
  assert.ok(
    turn.userTexts.some((t) => t.includes(`The user says: ${guidance}`)),
    'the guidance typed at the card reached the model on the next turn',
  );
  const afterContinue = await stubLog();
  assert.equal(afterContinue.cursor, 6, 'the run continued to the model\'s next step');

  // -- Stop: the run ends, says why, and the model's next step is not used
  await setScript([REPEAT(), REPEAT(), REPEAT(), REPEAT(), REPEAT(), { text: 'Everything is done.' }]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Keep working until the task is done.' });
  await waitPost((m) => m.type === 'stuck', 'the second stuck card', mark);
  mark = posts.length;
  host.receive({ type: 'stuck-answer', value: 'stop' });
  const stopped = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the stopped run to finish',
    mark,
  );
  assert.equal(stopped.type, 'done', JSON.stringify(stopped));
  const stopNote = String(stopped.text?.note ?? '');
  assert.ok(
    stopNote.startsWith(
      'Stopped — Plato was stuck on the same call (updating its plan (the same step)) and kept getting the same answer. Nothing was lost — tell Plato what to do differently, or rephrase your request.',
    ),
    `the closing line says what happened and what to do next: ${stopNote}`,
  );
  assert.ok(
    stopNote.includes('1 of 1 plan step unfinished'),
    'the closing line also names the unfinished plan (D49as)',
  );
  const afterStop = await stubLog();
  assert.equal(afterStop.cursor, 5, 'Stop did not let the model take its next step');

  // The card is recorded in the conversation, so a reload rebuilds it.
  const log = chatValue(stateFile(), 'log') ?? [];
  assert.ok(
    log.some((e) => e.k === 'stuck-open' && e.title === 'Plato is stuck'),
    'the stuck card is written to the log before the promise',
  );
  assert.ok(
    log.some((e) => e.k === 'undo-open'),
    'the undo card is written to the log before it is posted',
  );
  assert.ok(
    log.some((e) => e.k === 'reveal-open'),
    'the reveal card is written to the log before it is posted',
  );

  assert.equal(disposed, false, 'the panel was not disposed');
  console.log(
    'PASS M4a agent features: MCP, images, attachments, undo, masking/reveal, stuck',
  );
  console.log(`  posts: ${posts.length}`);
  console.log(`  html: ${transport.html.length} chars`);
  console.log(`  root: ${ROOT}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill();
  if (failure !== null) {
    console.error('FAIL M4a agent features');
    console.error(failure);
    process.exitCode = 1;
  }
}
