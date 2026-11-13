/**
 * Drives the built CLI in a real terminal and proves a line typed during a run
 * is held and runs next.
 *
 *   node scripts/cli-tui/queue-drive.mjs [--cli path/to/cli.js]
 *
 * A. Text typed during a slow run is visible in the composer; Enter queues it;
 *    the provider receives nothing until the run ends; two lines run in order.
 * B. Esc still stops the run, and the queued line still runs afterwards.
 * C. A queued `/help` prints help and sends nothing to the model.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'queue-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const SLOW = (marker) =>
  `${marker}\n\nThis answer streams slowly so a line can be typed while the run is in progress.`;

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-queue-'));
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
      model: 'fake:queue-model',
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
const child = spawn('sh', ['-c', 'cat | script -q /dev/null "$0"', cli], {
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
const type = async (text) => {
  send(text);
  await sleep(120);
};
const submit = async (text) => {
  await type(text);
  send('\r');
};
const userText = (index) => {
  const body = provider.requests[index];
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = messages.filter((message) => message?.role === 'user').at(-1);
  return typeof last?.content === 'string' ? last.content : '';
};
async function attempt(run) {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 20000, 'the run summary');
  await sleep(400);
}

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  provider.setScript([
    { text: SLOW('SLOW-ONE-START'), chunks: 8, chunkMs: 400 },
    { text: 'Reply one.' },
    { text: 'Reply two.' },
    { text: SLOW('SLOW-TWO-START'), chunks: 8, chunkMs: 400 },
    { text: 'Reply three.' },
    { text: SLOW('SLOW-THREE-START'), chunks: 8, chunkMs: 400 },
  ]);

  // A. Two lines typed and queued during the first run.
  let mark = output.length;
  await submit('first task');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-ONE-START'), 10000, 'the slow run'));

  const typedAt = output.length;
  await type('first queued line');
  record(
    plain(output.slice(typedAt)).includes('› first queued line'),
    'text typed during a run is visible in the composer',
  );
  send('\r');
  const firstRow = await attempt(() =>
    waitFor(
      () => plain(output.slice(mark)).includes('Queued: first queued line'),
      4000,
      'the queued row',
    ),
  );
  record(firstRow, 'Enter during a run shows the queued row');
  record(provider.requests.length === 1, 'the queued line sent nothing to the model during the run');

  await type('second queued line');
  send('\r');
  const secondRow = await attempt(() =>
    waitFor(
      () => plain(output.slice(mark)).includes('Queued: second queued line'),
      4000,
      'the second queued row',
    ),
  );
  record(secondRow, 'a second queued line shows its own row');
  record(provider.requests.length === 1, 'the second queued line sent nothing either');

  await attempt(() => waitFor(() => provider.requests.length === 3, 20000, 'both queued runs'));
  await sleep(800);
  record(
    userText(1) === 'first queued line' && userText(2) === 'second queued line',
    'the two queued lines ran in order, each with the exact text',
  );

  // B. Esc stops the run; the queued line still runs.
  mark = output.length;
  await submit('stop me');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-TWO-START'), 10000, 'the second slow run'));
  await type('after the stop');
  send('\r');
  await attempt(() =>
    waitFor(
      () => plain(output.slice(mark)).includes('Queued: after the stop'),
      4000,
      'the queued line for the stopped run',
    ),
  );
  send('\x1b');
  const stopped = await attempt(() =>
    waitFor(
      () => plain(output.slice(mark)).includes('Run ended: cancelled.'),
      10000,
      'the stopped run',
    ),
  );
  record(stopped, 'Esc during a run still stops it');
  const afterStop = await attempt(() =>
    waitFor(() => provider.requests.length >= 5, 15000, 'the queued line after the stop'),
  );
  record(afterStop && userText(4) === 'after the stop', 'a queued line still runs after a stop');

  // C. A queued command runs as a command.
  await sleep(1000);
  mark = output.length;
  await submit('third task');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-THREE-START'), 10000, 'the third slow run'));
  await type('/help');
  send('\r');
  const helpRow = await attempt(() =>
    waitFor(
      () => plain(output.slice(mark)).includes('Queued: /help'),
      4000,
      'the queued help row',
    ),
  );
  await attempt(() => waitRunEnd(mark));
  const helped = await attempt(() =>
    waitFor(() => plain(output.slice(mark)).includes('Commands'), 5000, 'the help text'),
  );
  record(helped && helpRow, 'a queued /help prints help');
  record(provider.requests.length === 6, 'a queued /help sends nothing to the model');
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
      'Plato CLI — queued line proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      '--- requests ---',
      JSON.stringify(provider.requests, null, 2),
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
