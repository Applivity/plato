/**
 * Drives the built CLI through a slow cold start.
 *
 *   node scripts/cli-tui/coldstart-drive.mjs [--cli path/to/cli.js]
 *
 * The model list is delayed, so the first submission waits. After about a
 * second the status line names the step, once; the phrase clears when the run
 * begins. A second submission, whose waits are cached, names nothing.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const PHRASE = 'checking the model…';

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const linesOf = (output) =>
  plain(output).split('\n').map((line) => line.replace(/\r$/, ''));
const statusLines = (output) => linesOf(output).filter((line) => line.startsWith('mode: '));
const lastStatus = (output) => statusLines(output).at(-1) ?? '';

const provider = await startProvider({
  context: 131_072,
  modelsDelayMs: 1800,
  model: 'cold-model',
});
const root = mkdtempSync(join(tmpdir(), 'plato-cli-cold-'));
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
      model: 'fake:cold-model',
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

let output = '';
const inner = `stty cols 100; exec node ${JSON.stringify(cli)}`;
const child = spawn(
  'sh',
  ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`],
  {
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
  },
);
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});
let exited = false;
child.on('close', () => {
  exited = true;
});

const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

async function submitTimed(text) {
  const mark = output.length;
  child.stdin.write(text);
  await waitFor(
    () => plain(output.slice(mark)).includes(text.slice(0, 20)),
    5000,
    'the task on screen',
  );
  const at = Date.now();
  child.stdin.write('\r');
  return at;
}

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  provider.setScript([{ text: 'Cold start answer.' }]);
  const started = await submitTimed('first question');
  await waitFor(
    () => statusLines(output).some((line) => line.includes(PHRASE)),
    8000,
    'the cold-start phrase',
  );
  const seenAfter = Date.now() - started;
  record(seenAfter >= 900, 'the phrase waits about a second before it appears');
  record(
    (lastStatus(output).match(/checking the model…/g) ?? []).length === 1,
    'one phrase at a time',
  );
  record(lastStatus(output).startsWith('mode: '), 'the phrase is in the status line');

  await waitFor(
    () => plain(output).includes('Cold start answer.'),
    15000,
    'the answer',
  );
  await waitFor(
    () => lastStatus(output).includes('mode: ') && !lastStatus(output).includes(PHRASE),
    8000,
    'the phrase to clear',
  );
  record(true, 'the phrase clears once the run begins');
  await waitFor(() => /\b1 turn\b/.test(plain(output)), 20000, 'the run summary');

  // The same waits are cached now: a fast start must stay silent.
  provider.setScript([{ text: 'Second answer.' }]);
  const secondMark = output.length;
  await submitTimed('second question');
  await waitFor(
    () => /\b1 turn\b/.test(plain(output.slice(secondMark))),
    20000,
    'the second run summary',
  );
  record(
    !plain(output.slice(secondMark)).includes(PHRASE),
    'a wait that finishes under a second is never named',
  );

  child.stdin.write('\x03');
  await sleep(400);
  child.stdin.write('\x03');
  await sleep(700);
  try {
    child.stdin.end();
  } catch {
    // Already gone.
  }
  await waitFor(() => exited, 5000, 'the process to exit');
} catch (error) {
  record(false, error.message);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
} finally {
  await provider.close();
  writeFileSync(
    join(here, 'coldstart-capture.txt'),
    [
      'Plato CLI — the cold start names its step',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      output,
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
console.log(`capture: ${join(here, 'coldstart-capture.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
