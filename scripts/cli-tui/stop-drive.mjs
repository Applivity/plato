/**
 * Drives the built CLI in a real terminal through a long tool and a stop.
 *
 *   node scripts/cli-tui/stop-drive.mjs [--cli path/to/cli.js]
 *
 * A. A three-second tool: the status line names it and its seconds increase.
 * B. Esc while an answer streams: the stop is acknowledged at once, the part
 *    that arrived stays, and the run summary follows.
 * C. Idle: no clock interval runs, so a second of silence draws nothing.
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
const capturePath = join(here, 'stop-capture.txt');

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

const PARTIAL = [
  'SLOW-ANSWER-START',
  '',
  'This paragraph arrives a piece at a time so the stop can land in the middle of it.',
  'The rest of the answer would follow, but the user stops the run instead.',
].join('\n');

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-stop-'));
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
      model: 'fake:stop-model',
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
const inner = `stty cols 120; exec node ${JSON.stringify(cli)}`;
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

async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 20000, 'the run summary');
  await sleep(400);
}

const secondsIn = (text) => {
  const matches = [...plain(text).matchAll(/t\/s · (\d+)s/g)];
  return matches.length === 0 ? null : Number(matches.at(-1)[1]);
};

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  // A. The status line names the tool and its seconds increase.
  provider.setScript([
    { tool: 'shell', args: { command: 'node -e "setTimeout(() => {}, 3000)"' } },
    { text: 'The command finished.' },
  ]);
  let mark = output.length;
  await submit('run the slow command');
  try {
    await waitFor(
      () => /\d+ t\/s · \d+s/.test(plain(output.slice(mark))),
      5000,
      'the running line with a rate and seconds',
    );
  } catch {
    // Recorded below: the old line says only "running".
  }
  const first = secondsIn(output.slice(mark));
  await sleep(1200);
  const second = secondsIn(output.slice(mark));
  notes.push(`seconds: ${first} then ${second}`);
  record(first !== null && second !== null && second > first, 'the running line shows a rate and ticks');
  await waitRunEnd(mark);

  // B. Esc during a streaming answer is acknowledged at once, and the part
  // that arrived stays on screen.
  provider.setScript([{ text: PARTIAL, chunks: 10, chunkMs: 400 }]);
  mark = output.length;
  await submit('write the slow answer');
  await waitFor(() => plain(output.slice(mark)).includes('SLOW-ANSWER-START'), 8000, 'the answer to start');
  const stoppedAt = Date.now();
  send('\x1b');
  let acknowledged = true;
  try {
    await waitFor(
      () => plain(output.slice(mark)).includes('Stopping after this step.'),
      1500,
      'the stopping notice',
    );
  } catch {
    acknowledged = false;
  }
  notes.push(`stop acknowledged in ${Date.now() - stoppedAt} ms`);
  record(acknowledged && Date.now() - stoppedAt <= 1000, 'the stop is acknowledged within a second');
  await waitFor(
    () => plain(output.slice(mark)).includes('Run ended: cancelled.'),
    10000,
    'the cancelled run to end',
  );
  await sleep(500);
  const after = plain(output.slice(mark));
  // The committed row comes first, then its marker and the end notice. A live
  // frame can also draw the row, but never in that order.
  const kept =
    /│ SLOW-ANSWER-START[^\n]*\r?\nStopped — the answer above is what had arrived\.\r?\nRun ended: cancelled\./.test(
      after,
    );
  record(kept, 'the part of the answer that arrived is still on screen');
  record(after.includes('Stopped — the answer above is what had arrived.'), 'the kept part is marked as stopped');
  record((after.match(/Stopping after this step\./g) ?? []).length === 1, 'the stop is acknowledged once');
  record(/\b1 turn\b/.test(after), 'the run summary follows the stopped answer');

  // C. An idle terminal draws nothing: no clock interval is left running.
  const idleAt = output.length;
  await sleep(1200);
  record(output.length === idleAt, 'an idle terminal draws nothing for a second');
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
      'Plato CLI — long step and stop proof',
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
