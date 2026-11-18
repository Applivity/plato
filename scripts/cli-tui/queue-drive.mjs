/**
 * Drives the built CLI in a real terminal through steering and the queue.
 *
 *   node scripts/cli-tui/queue-drive.mjs [--cli path/to/cli.js]
 *
 * The founder's interaction model:
 *   A. Enter during a run STEERS it. The provider gets the text as observer
 *      guidance at the next safe point; nothing is held for later.
 *   B. `/queue <text>` is the way to defer. It sends nothing during the run
 *      and runs as its own run with the exact text afterwards.
 *   C. `/queue /help` runs the command after the run and sends nothing.
 *   D. Esc twice stops the run; a queued line still runs afterwards.
 *   E. Bare `/queue` says what to write and starts nothing.
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
const requestBody = (index) => JSON.stringify(provider.requests[index]?.messages ?? []);
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

  // A. Enter during a run steers it.
  provider.setScript([
    { text: SLOW('SLOW-ONE-START'), chunks: 8, chunkMs: 400 },
    { text: 'Reply to the steer.' },
  ]);
  let mark = output.length;
  await submit('first task');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-ONE-START'), 10000, 'the slow run'));
  await type('steer this way');
  send('\r');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('› steer this way'), 4000, 'the steering row'),
    ),
    'Enter during a run shows the line as the user\'s direction',
  );
  record(provider.requests.length === 1, 'the steered line sent nothing yet');
  record(
    await attempt(() => waitFor(() => provider.requests.length >= 2, 15000, 'the steered request')),
    'the steered line reaches the model at the next safe point',
  );
  record(
    requestBody(1).includes('[observer guidance] steer this way'),
    'the steered text arrives as observer guidance',
  );
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Reply to the steer.'), 15000, 'the steered answer')),
    'the same run continues and answers the steer',
  );
  await waitRunEnd(mark);

  // B. /queue defers a line to the next run.
  provider.setScript([
    { text: SLOW('SLOW-TWO-START'), chunks: 8, chunkMs: 400 },
    { text: 'Reply after the queue.' },
  ]);
  mark = output.length;
  const beforeQueue = provider.requests.length;
  await submit('second task');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-TWO-START'), 10000, 'the second slow run'));
  await submit('/queue queued later');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Queued: queued later'), 4000, 'the queued row'),
    ),
    '/queue during a run shows the queued row',
  );
  record(provider.requests.length === beforeQueue + 1, '/queue sent nothing during the run');
  await waitRunEnd(mark);
  record(
    await attempt(() => waitFor(() => provider.requests.length >= beforeQueue + 2, 15000, 'the queued run')),
    'the queued line runs when the run ends',
  );
  record(userText(beforeQueue + 1) === 'queued later', 'the queued run carries the exact text');
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Reply after the queue.'), 15000, 'the queued answer')),
    'the queued run gets its own answer',
  );

  // C. /queue /help runs the command after the run, with no model request.
  provider.setScript([{ text: SLOW('SLOW-THREE-START'), chunks: 8, chunkMs: 400 }]);
  mark = output.length;
  const beforeCommand = provider.requests.length;
  await submit('third task');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-THREE-START'), 10000, 'the third slow run'));
  await submit('/queue /help');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Queued: /help'), 4000, 'the queued command row'),
    ),
    '/queue /help shows the queued command row',
  );
  await waitRunEnd(mark);
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Commands'), 5000, 'the help text')),
    'the queued /help prints help after the run',
  );
  record(provider.requests.length === beforeCommand + 1, 'the queued /help sends nothing to the model');

  // D. Esc twice stops the run; a queued line still runs afterwards.
  provider.setScript([
    { text: SLOW('SLOW-FOUR-START'), chunks: 8, chunkMs: 400 },
    { text: 'Reply after the stop.' },
  ]);
  mark = output.length;
  const beforeStop = provider.requests.length;
  await submit('stop me');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('SLOW-FOUR-START'), 10000, 'the stopped run'));
  await submit('/queue after the stop');
  await attempt(() =>
    waitFor(() => plain(output.slice(mark)).includes('Queued: after the stop'), 4000, 'the queued line for the stop'),
  );
  send('\x1b');
  await sleep(120);
  send('\x1b');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Run ended: cancelled.'), 10000, 'the stopped run'),
    ),
    'Esc then Esc again during a run still stops it',
  );
  record(
    await attempt(() => waitFor(() => provider.requests.length >= beforeStop + 2, 15000, 'the queued line after the stop')),
    'a queued line still runs after a stop',
  );
  record(userText(beforeStop + 1) === 'after the stop', 'the queued line after the stop carries the exact text');
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Reply after the stop.'), 15000, 'the queued answer after the stop')),
    'the queued run answers after the stop',
  );

  // E. Bare /queue says what to write and starts nothing.
  await sleep(600);
  const beforeBare = provider.requests.length;
  await submit('/queue');
  record(
    await attempt(() =>
      waitFor(() => plain(output).includes('Nothing queued; write /queue <text>.'), 5000, 'the bare /queue answer'),
    ),
    'bare /queue says what to write',
  );
  record(provider.requests.length === beforeBare, 'bare /queue starts no run');
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
      'Plato CLI — steering and queue proof',
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
