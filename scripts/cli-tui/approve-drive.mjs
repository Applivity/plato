/**
 * Drives the built CLI in a real terminal through the approval card.
 *
 *   node scripts/cli-tui/approve-drive.mjs [--cli path/to/cli.js]
 *
 * 1. The card carries its hint; Esc denies, stops the run in that press, and
 *    the composer takes input again.
 * 2. Arrows then Enter on No: denied, and the run continues.
 * 3. Digit + Enter chooses "approved for this session", and the second call of
 *    the same tool shows no second card.
 * 4. Every decision is read back from the run records under PLATO_HOME/runs.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'approve-capture.txt');

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
async function attempt(run) {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-approve-'));
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
      model: 'fake:approve-model',
      team: 'solo',
      mode: 'edit',
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
const submit = async (text) => {
  send(text);
  await sleep(150);
  send('\r');
};
async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 15000, 'the run summary');
  await sleep(400);
}
function runDecisions() {
  const base = join(home, 'runs');
  const found = [];
  let projects = [];
  try {
    projects = readdirSync(base);
  } catch {
    return found;
  }
  for (const projectKey of projects) {
    const dir = join(base, projectKey);
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        if (line.length === 0) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event?.type === 'approval-decided') found.push(event);
      }
    }
  }
  return found;
}

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  // 1. Hint line, Esc denies and stops in one press, composer lives again.
  provider.setScript([
    { tool: 'write_file', args: { path: 'one.txt', content: 'one' } },
    { text: 'After one.' },
  ]);
  let mark = output.length;
  await submit('write one');
  const cardShown = await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Allow write_file?'), 8000, 'the approval card'));
  record(cardShown, 'the approval card is shown');
  const cardFrame = plain(output.slice(mark));
  record(
    cardFrame.includes('Enter answers · No declines and continues · Esc denies and stops'),
    'the card says what the keys do, including both answers',
  );

  send('\x1b');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Denied and stopped — writing a file.'), 4000, 'the denied-and-stopped row'),
    ),
    'Esc denies and stops the run',
  );
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Run ended: cancelled.'), 8000, 'the stopped run'),
    ),
    'the run ends on that same press',
  );
  const typedAt = output.length;
  send('composer is back');
  await sleep(300);
  record(
    plain(output.slice(typedAt)).includes('› composer is back'),
    'the composer takes input again after the stop',
  );
  for (let index = 0; index < 'composer is back'.length; index += 1) {
    send('\x7f');
    await sleep(30);
  }
  await sleep(300);

  // 2. Arrows then Enter on No: declined, and the run continues.
  provider.setScript([
    { tool: 'write_file', args: { path: 'two.txt', content: 'two' } },
    { text: 'After two.' },
  ]);
  mark = output.length;
  await submit('write two');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Allow write_file?'), 8000, 'the second card'));
  send('\x1b[B');
  await sleep(120);
  send('\x1b[A');
  await sleep(120);
  send('\r');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Declined — writing a file.'), 4000, 'the declined row'),
    ),
    'arrows then Enter on No records a decline',
  );
  record(
    await attempt(() => waitFor(() => plain(output.slice(mark)).includes('After two.'), 8000, 'the run to continue')),
    'No denies and the run continues',
  );
  await waitRunEnd(mark);

  // 3. Digit + Enter: approved for this session; the second call shows no card.
  provider.setScript([
    { tool: 'write_file', args: { path: 'three.txt', content: 'three' } },
    { tool: 'write_file', args: { path: 'three.txt', content: 'three' } },
    { text: 'After three.' },
  ]);
  mark = output.length;
  await submit('write three twice');
  await attempt(() => waitFor(() => plain(output.slice(mark)).includes('Allow write_file?'), 8000, 'the third card'));
  send('3');
  await sleep(150);
  send('\r');
  record(
    await attempt(() =>
      waitFor(() => plain(output.slice(mark)).includes('Approved for this session — writing a file.'), 4000, 'the session-approval row'),
    ),
    'a digit then Enter chooses "approved for this session"',
  );
  await waitRunEnd(mark);
  const third = plain(output.slice(mark));
  const afterDecision = third.slice(third.indexOf('Approved for this session'));
  record(
    !afterDecision.includes('Allow write_file?'),
    'the second call of the same tool shows no second card',
  );
  record(third.includes('After three.'), 'the remembered call runs and the answer lands');

  // 4. The run records carry each decision with the tool and the answer.
  const decisions = runDecisions();
  notes.push(
    `approval-decided entries: ${decisions.length} — ${decisions
      .map((event) => `${event.tool}:${event.allowed}`)
      .join(', ')}`,
  );
  record(
    decisions.length === 4 && decisions.every((event) => event.tool === 'write_file'),
    'every decision is written with the tool',
  );
  record(
    decisions.filter((event) => event.allowed === false).length === 2 &&
      decisions.filter((event) => event.allowed === true).length === 2,
    'every decision is written with its answer',
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
      'Plato CLI — approval card proof',
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
