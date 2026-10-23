/**
 * M3b checkpoint 2a host test: Solo, Duo, Academy and the observer strip.
 *
 * What it proves, through the EXISTING IDE host and the unchanged chat HTML:
 *   - Solo draws no team card and no observer, and its closing line says so;
 *   - Duo starts the philosopher named in ~/.plato/DUO.yaml, posts the
 *     "[Name] watching — <ref>" line with that philosopher's colour, and its
 *     guidance reaches the run;
 *   - a philosopher with pause/cancel granted pauses and cancels the run, with
 *     the same notices the VS Code extension shows;
 *   - Academy posts the council's team card (the observer strip) with every
 *     member's name, kind, model and powers;
 *   - guidance, pause and cancel share ONE cap of five per run, counted across
 *     members; a sixth intervention is never consulted.
 *
 * The team-card assertion is a regression test for a shared defect this
 * checkpoint found: the host posted the payload under `text` while the page
 * read it at the top level, so the card had never rendered in either host.
 *
 * It does NOT prove WebView2 rendering. The real Visual Studio window and its
 * screenshots are the other witness.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-teams-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-teams-root-'));
const STATE = join(HOME, 'state');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const PLATO_HOME = join(HOME, '.plato');
mkdirSync(PLATO_HOME, { recursive: true });

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

/** D49cg follow-on: `observers` is the philosopher's own script, not the agent's. */
async function setScript(steps, observers = []) {
  const response = await fetch(`http://127.0.0.1:${port}/__script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps, observers }),
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

function waitPost(predicate, label, from = 0, timeoutMs = 60_000) {
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function settingsFile() {
  return JSON.parse(readFileSync(join(STATE, 'settings.json'), 'utf8'));
}

async function waitSettings(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate(settingsFile())) return settingsFile();
    } catch {
      // The shim writes atomically; a read can still land mid-move.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for settings.json: ${label}`);
}

async function runToEnd(host, task, from) {
  host.receive({ type: 'ask', text: task });
  const done = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    `"${task}" to finish`,
    from,
    90_000,
  );
  assert.equal(done.type, 'done', JSON.stringify(done));
  return done;
}

function notices(from, needle) {
  return posts.filter(
    (m, i) =>
      i >= from &&
      m.type === 'notice' &&
      typeof m.text === 'string' &&
      m.text.includes(needle),
  );
}

/** A read-only turn so no approval card can park the run. */
const read = (delayMs = 0) => ({
  calls: [{ tool: 'read_file', args: { path: 'note.txt' } }],
  ...(delayMs > 0 ? { delayMs } : {}),
});

function writeDuo(extra) {
  writeFileSync(
    join(PLATO_HOME, 'DUO.yaml'),
    [
      'philosopher:',
      '  persona: aristotle',
      '  name: Aristotle',
      '  model: stub:stub-model',
      '  color: violet',
      ...extra,
      '',
    ].join('\n'),
    'utf8',
  );
}

function writeAcademy() {
  writeFileSync(
    join(PLATO_HOME, 'ACADEMY.yaml'),
    [
      'academy:',
      '  name: Lyceum',
      'members:',
      '  - name: Aristotle',
      '    kind: philosopher',
      '    model: stub:stub-model',
      '    persona: aristotle',
      '    color: violet',
      '    guidance: true',
      '    pause: false',
      '    cancel: false',
      '    maxInterventions: 5',
      '  - name: Diogenes',
      '    kind: philosopher',
      '    model: stub:stub-model',
      '    persona: diogenes',
      '    color: amber',
      '    guidance: true',
      '    pause: false',
      '    cancel: false',
      '    maxInterventions: 5',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function choose(host, mode) {
  const mark = posts.length;
  host.receive({ type: 'set-orchestration', mode });
  const chosen = await waitPost(
    (m) => m.type === 'settings' && m.orchestration?.mode === mode,
    `the settings payload to show ${mode}`,
    mark,
  );
  assert.equal(
    chosen.flash,
    `Orchestration: ${mode} — applies from the next run.`,
    'the picker says when the choice applies',
  );
  await waitSettings(
    (s) => s['plato.orchestration'] === mode,
    `${mode} persisted`,
  );
}

let failure = null;
try {
  writeFileSync(join(ROOT, 'note.txt'), 'a stable note\n', 'utf8');
  // Both team files exist before the first run, so a missing-file default can
  // never be mistaken for the file's own values. The philosopher is granted
  // EIGHT interventions so the run-wide cap of five is the only thing that can
  // produce five in the cap run below — a per-member limit of five would make
  // that assertion pass without the run-wide rule existing.
  writeDuo(['  pause: true', '  cancel: true', '  maxInterventions: 8']);
  writeAcademy();

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
  // The settings payload is the answer to opening Settings, not something the
  // ready handshake posts (D49v: a payload must not move the view).
  host.receive({ type: 'openSettings' });
  await waitPost(
    (m) => m.type === 'settings' && m.orchestration?.mode === 'solo',
    'the initial settings payload',
  );

  /* ================================================================== */
  /* 1. The picker: Solo -> Duo -> Academy, each persisted              */
  /* ================================================================== */
  await choose(host, 'duo');
  await choose(host, 'academy');
  await choose(host, 'solo');

  /* ================================================================== */
  /* 2. Solo: no observer, no team card, and the closing line says so   */
  /* ================================================================== */
  await setScript([read(), { text: 'Solo done.' }]);
  let mark = posts.length;
  const soloDone = await runToEnd(host, 'Read note.txt on your own.', mark);
  assert.equal(soloDone.text?.obs, '', 'a Solo run reports no observer');
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'team').length,
    0,
    'Solo draws no team card',
  );
  assert.equal(notices(mark, 'watching —').length, 0, 'Solo starts no observer');

  /* ================================================================== */
  /* 3. Duo: the philosopher is named, coloured, and its guidance lands */
  /* ================================================================== */
  await choose(host, 'duo');
  await setScript(
    [read(), read(400), { text: 'Duo done.' }],
    [{ action: 'guidance', message: 'Cite the file you read.' }],
  );
  mark = posts.length;
  const duoDone = await runToEnd(host, 'Read note.txt with a philosopher.', mark);
  const watching = notices(mark, '[Aristotle] watching — stub:stub-model');
  assert.equal(watching.length, 1, 'the observer announces itself once');
  assert.equal(
    watching[0].meta?.color,
    '#b48ad4',
    'the notice carries the philosopher\'s colour (violet)',
  );
  const guidance = notices(mark, '[Aristotle] guidance: Cite the file you read.');
  assert.equal(guidance.length, 1, 'the guidance reaches the run once');
  assert.match(
    String(duoDone.text?.obs),
    /^observer \d+ checks · 1 interventions$/,
    'the closing line reports the observer and its intervention',
  );
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'team').length,
    0,
    'Duo draws no council card — one philosopher is named in the notices',
  );

  /* ================================================================== */
  /* 4. Duo: the philosopher pauses, then the user resumes               */
  /* ================================================================== */
  await setScript(
    [read(), read(1_200), read(1_200), read(1_200), { text: 'Resumed and done.' }],
    [{ action: 'pause' }],
  );
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Read note.txt while the philosopher pauses.' });
  const paused = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === true,
    'the observer to park the run',
    mark,
  );
  assert.equal(paused.text.parked, true);
  assert.equal(notices(mark, '[Aristotle] paused the run').length, 1);
  host.receive({ type: 'resume' });
  const resumed = await waitPost(
    (m) => m.type === 'pause-state' && m.text?.parked === false,
    'the run to resume',
    mark,
  );
  assert.equal(resumed.text.parked, false);
  // D49ch: the park notice is emitted on the bus, and the bus `notice`
  // listener both records and sends it. An extra explicit `send` drew every
  // pause and resume twice in the real window.
  assert.equal(
    posts.filter(
      (m, i) =>
        i >= mark && m.type === 'notice' && m.text === 'Plato paused at a safe point.',
    ).length,
    1,
    'the pause line is drawn once, not twice',
  );
  assert.equal(
    posts.filter(
      (m, i) => i >= mark && m.type === 'notice' && m.text === 'Plato resumed.',
    ).length,
    1,
    'the resume line is drawn once, not twice',
  );
  const pauseDone = await waitPost(
    (m) => m.type === 'done' || m.type === 'error',
    'the paused run to finish',
    mark,
    90_000,
  );
  assert.equal(pauseDone.type, 'done', JSON.stringify(pauseDone));

  /* ================================================================== */
  /* 5. Duo: the philosopher cancels the run                            */
  /* ================================================================== */
  await setScript(
    [read(), read(1_200), read(1_200), { text: 'Must not be reached.' }],
    [{ action: 'cancel' }],
  );
  mark = posts.length;
  const cancelled = await runToEnd(
    host,
    'Read note.txt until the philosopher cancels.',
    mark,
  );
  assert.equal(notices(mark, '[Aristotle] cancelled the run').length, 1);
  assert.match(
    String(cancelled.text?.note),
    /cancelled/,
    'a cancelled run says so in its closing line',
  );

  /* ================================================================== */
  /* 6. Academy: the council card — the observer strip                  */
  /* ================================================================== */
  await choose(host, 'academy');
  await setScript(
    [read(), read(400), { text: 'Academy done.' }],
    [{ action: 'noop' }, { action: 'noop' }],
  );
  mark = posts.length;
  const academyDone = await runToEnd(host, 'Read note.txt with the council.', mark);
  const active = notices(mark, 'Academy "Lyceum" active');
  assert.equal(active.length, 1, 'the council announces itself');

  const team = posts.find((m, i) => i >= mark && m.type === 'team');
  assert.ok(team, 'the team card is posted');
  // THE REGRESSION: the page reads name/members at the top level. A payload
  // nested under `text` renders "Team unnamed" with no rows.
  assert.equal(team.text, undefined, 'the team payload is not nested under text');
  assert.equal(team.name, 'Lyceum', 'the card names the council');
  assert.deepEqual(
    team.members.map((m) => m.name),
    ['Aristotle', 'Diogenes'],
    'the card lists every member',
  );
  assert.deepEqual(
    team.members.map((m) => m.kind),
    ['philosopher', 'philosopher'],
  );
  assert.deepEqual(
    team.members.map((m) => m.model),
    ['stub:stub-model', 'stub:stub-model'],
  );
  assert.deepEqual(
    team.members.map((m) => m.tiers),
    [['guidance'], ['guidance']],
    'the card states each member\'s powers',
  );
  assert.deepEqual(
    team.members.map((m) => m.color),
    ['#b48ad4', '#d9a441'],
    'the card carries each member\'s colour',
  );
  assert.equal(
    notices(mark, '[Diogenes] watching — stub:stub-model').length,
    1,
    'every council member is watched and named',
  );
  assert.match(String(academyDone.text?.obs), /^observer \d+ checks · 0 interventions$/);

  /* ================================================================== */
  /* 7. The five-intervention cap, counted across the run               */
  /* ================================================================== */
  await choose(host, 'duo');
  // Eight tool turns offer seven consultations; only five may intervene.
  const capSteps = [];
  for (let i = 0; i < 8; i += 1) capSteps.push(read());
  capSteps.push({ text: 'Cap run done.' });
  await setScript(
    capSteps,
    Array.from({ length: 8 }, (_, i) => ({
      action: 'guidance',
      message: `Steer ${i + 1}.`,
    })),
  );
  mark = posts.length;
  const capDone = await runToEnd(host, 'Read note.txt and keep steering.', mark);
  const steer = notices(mark, '[Aristotle] guidance:');
  assert.equal(steer.length, 5, 'exactly five interventions are applied');
  assert.deepEqual(
    steer.map((m) => String(m.text).replace('[Aristotle] guidance: ', '')),
    ['Steer 1.', 'Steer 2.', 'Steer 3.', 'Steer 4.', 'Steer 5.'],
    'the first five are applied, in order',
  );
  assert.match(
    String(capDone.text?.obs),
    /^observer 5 checks · 5 interventions$/,
    'a sixth intervention is never consulted',
  );

  /* ================================================================== */
  /* 8. The unchanged page carries the controls                         */
  /* ================================================================== */
  for (const id of ['orchChip', 'team-card', 'philosopher']) {
    assert.ok(
      transport.html.includes(id),
      `the shared page carries ${id}`,
    );
  }

  const panel = host.panel();
  panel.dispose();
  await settle();
  assert.equal(disposed, true, 'the panel reported disposal');

  console.log('PASS M3b checkpoint 2a Solo, Duo, Academy and the observer strip');
  console.log(`  posts: ${posts.length}`);
  console.log(`  protocol: ${port}`);
} catch (error) {
  failure = error;
} finally {
  stub.kill('SIGTERM');
}

if (failure !== null) {
  console.error('FAIL M3b checkpoint 2a Solo, Duo, Academy and the observer strip');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' +
      JSON.stringify(
        posts.slice(-14).map((p) => ({
          type: p?.type,
          text: typeof p?.text === 'object' ? p.text : p?.text,
        })),
      ),
  );
  console.error(`stub stderr: ${stubStderr}`);
  process.exitCode = 1;
}
