/**
 * Drives the built CLI in a real terminal through slash commands typed during
 * a live run.
 *
 *   node scripts/cli-tui/command-drive.mjs [--cli path/to/cli.js]
 *
 * The rule is a WHITELIST: `/help`, `/queue`, `/history`, `/sessions`,
 * `/compact` may act during a run; `/continue` may act only when a pause is in
 * effect; every other command is refused with one line and is not queued.
 *
 * A. A normal run writes a file, so an undo copy exists. It stays written.
 * B. During a long run:
 *    - `/help`, `/sessions` and `/compact` act.
 *    - `/undo`, `/resume`, `/model`, `/mode`, `/team`, `/gitignore`, `/new` and
 *      `/exit` each show "Finish or stop the run first." exactly once, in order.
 *    - The mode, team and model are unchanged; no resume picker opens; the
 *      earlier answer is still on screen; the process is still alive.
 * C. After the run: the file still holds the run's content, so the mid-run
 *    `/undo` touched no file, and none of the refused commands was queued.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'command-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const lastFrame = (text) => {
  const start = text.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(text);
  const end = text.lastIndexOf('\x1b[?2026l');
  return plain(text.slice(start, end > start ? end : undefined));
};
const lastComposer = (text) =>
  lastFrame(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.startsWith('› '))
    .at(-1) ?? '';

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function attempt(run) {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-command-'));
const config = join(root, 'config');
const data = join(root, 'data');
const home = join(root, 'home');
const project = join(root, 'project');
for (const dir of [config, data, home, project]) mkdirSync(dir, { recursive: true });
writeFileSync(
  join(config, 'config.json'),
  `${JSON.stringify(
    {
      connections: [
        { id: 'fake', kind: 'openai', baseUrl: `http://127.0.0.1:${provider.port}/v1` },
      ],
      model: 'fake:command-model',
      team: 'solo',
      mode: 'auto',
      reasoning: 'off',
      compactionThreshold: 0.8,
      respectGitignore: false,
    },
    null,
    2,
  )}\n`,
);
const undoFile = join(project, 'undo.txt');
writeFileSync(undoFile, 'old content');

let output = '';
const inner = `stty cols 100; exec node ${JSON.stringify(cli)}`;
const child = spawn('sh', ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`], {
  cwd: project,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    PLATO_CONFIG_DIR: config,
    PLATO_DATA_DIR: data,
    PLATO_HOME: home,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const notes = [];
const send = (text) => child.stdin.write(text);
const submit = async (text) => {
  send(text);
  await sleep(150);
  send('\r');
};
/**
 * A command is typed, the composer is allowed to show it, and only then is
 * Enter sent. A fixed sleep lost this under load once.
 */
const submitCommand = async (text) => {
  send(text);
  await waitFor(
    () => lastComposer(output).includes(text),
    5000,
    `the composer to show ${text}`,
  );
  await sleep(120);
  send('\r');
};
const refusalCount = (mark) =>
  (plain(output.slice(mark)).match(/Finish or stop the run first\./g) ?? []).length;

async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 30000, 'the run summary');
  await sleep(400);
}

try {
  await waitFor(() => output.includes('Type / for commands'), 10000, 'the start screen');

  // A. A write, so an undo copy of the file exists.
  provider.setScript([
    {
      tool: 'write_file',
      args: { path: 'undo.txt', content: 'new content', overwrite: true },
    },
    { text: 'wrote it' },
  ]);
  let mark = output.length;
  await submit('change the file');
  await waitFor(() => plain(output.slice(mark)).includes('wrote it'), 20000, 'the write to finish');
  await waitRunEnd(mark);
  record(readFileSync(undoFile, 'utf8') === 'new content', 'the first run wrote the file');

  // B. Commands during a long run.
  const stream = Array.from({ length: 80 }, (_, i) => `HOLD-${String(i).padStart(2, '0')}`).join(' ');
  provider.setScript([{ text: stream, chunks: 80, chunkMs: 150 }]);
  mark = output.length;
  await submit('hold the run open');
  await waitFor(() => plain(output.slice(mark)).includes('HOLD-00'), 20000, 'the long run');

  // Allowed: these act during the run.
  await submitCommand('/help');
  const helped = await attempt(() =>
    waitFor(() => plain(output.slice(mark)).includes('Commands'), 5000, 'the help text'),
  );
  record(helped && refusalCount(mark) === 0, '/help acts during a run');
  await submitCommand('/sessions');
  const sessions = await attempt(() =>
    waitFor(() => plain(output.slice(mark)).includes('Saved conversations'), 5000, 'the sessions list'),
  );
  record(sessions && refusalCount(mark) === 0, '/sessions acts during a run');
  await submitCommand('/compact');
  const compact = await attempt(() =>
    waitFor(() => plain(output.slice(mark)).includes('Compaction requested.'), 5000, 'the compact request'),
  );
  record(compact && refusalCount(mark) === 0, '/compact acts during a run');

  // Refused: one line each, in order, and the run keeps going.
  const refused = [
    ['/undo', 1],
    ['/resume', 2],
    ['/model fake:other-model', 3],
    ['/mode plan', 4],
    ['/team duo', 5],
    ['/gitignore on', 6],
    ['/new', 7],
    ['/exit', 8],
  ];
  for (const [command, count] of refused) {
    await submitCommand(command);
    record(
      await attempt(() =>
        waitFor(
          () => refusalCount(mark) === count,
          5000,
          `the refusal of ${command}`,
        ),
      ),
      `${command} is refused with one line during a run`,
    );
  }
  record(refusalCount(mark) === refused.length, 'each refused command shows exactly one line');

  // The run is still the run it was.
  const frame = lastFrame(output);
  record(frame.includes('mode: auto'), '/mode did not change the mode mid-run');
  record(frame.includes('team: solo'), '/team did not change the team mid-run');
  record(frame.includes('fake:command-model'), '/model did not change the model mid-run');
  record(
    !frame.includes('↑↓ move · Enter switches · Esc closes'),
    '/resume did not open the conversation picker mid-run',
  );
  record(child.exitCode === null, '/exit did not end the process');
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('HOLD-70'), 20000, 'the run to continue')),
    'the run continues after every refused command',
  );
  await waitRunEnd(mark);

  // C. Not queued, and `/undo` touched no file.
  await sleep(800);
  const after = plain(output.slice(mark));
  record(readFileSync(undoFile, 'utf8') === 'new content', '/undo mid-run touched no file');
  record(!after.includes('Undo:'), '/undo did not run after the run either');
  record(plain(output).includes('wrote it'), '/new did not clear the earlier conversation');
  record(!/Queued: \/(undo|resume|new|mode|team|gitignore|model|exit)/.test(after), 'no refused command was queued');
  record(
    await attempt(() =>
      waitFor(
        () =>
          lastFrame(output).includes('mode: auto') &&
          lastFrame(output).includes('fake:command-model'),
        5000,
        'the settled status line',
      ),
    ),
    'the mode and model are unchanged after the run',
  );
} catch (error) {
  record(false, error.message);
} finally {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await provider.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — commands during a run proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      '--- terminal capture ---',
      output,
      '',
    ].join('\n'),
  );
}


for (const line of results) console.log(line);
for (const line of notes) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
