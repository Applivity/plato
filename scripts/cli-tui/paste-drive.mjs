/**
 * Drives the built CLI in a real terminal and proves how pasted text behaves.
 *
 *   node scripts/cli-tui/paste-drive.mjs [--cli path/to/cli.js]
 *
 * A local fake provider records what Plato actually sent. The checks:
 *   A. a one-line paste with a trailing newline is ordinary text: no chip, no send
 *   B. a two-line block with a trailing newline keeps one line after the first,
 *      and Enter sends exactly two lines (no trailing break)
 *   C. Left then a keystroke inside a block changes the visible line, and the
 *      request body is exactly what the chip showed
 *   D. Backspace at the end removes the draft whole
 * The capture is written next to this script.
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
const capturePath = join(here, 'paste-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The frame without its colours and cursor moves, for readable assertions. */
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-tui-'));
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
      model: 'fake:paste-model',
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
// `script` refuses a socketpair as its stdin (Node's pipes are sockets on
// macOS), so `cat` gives it a real pipe; `$0` is the CLI path.
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
  // Its own group, so the shell, `cat` and the CLI all stop together.
  detached: true,
});
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const results = [];
const record = (ok, what) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};
const lastUserText = () => {
  const body = provider.requests.at(-1);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.filter((message) => message?.role === 'user').at(-1);
  return typeof user?.content === 'string' ? user.content : '';
};

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  // A. One line plus a trailing break is one line.
  let mark = output.length;
  const oneLine = 'C:\\work\\file.png';
  child.stdin.write(`${oneLine}\n`);
  await sleep(900);
  let segment = plain(output.slice(mark));
  record(
    !segment.includes('[line ') && !segment.includes('[+') && segment.includes('file.png'),
    'a one-line paste with a trailing break shows no chip',
  );
  record(provider.requests.length === 0, 'no request went out for the one-line paste');
  // One key per write: a burst of DEL bytes is one chunk, not sixteen keys.
  for (let index = 0; index < oneLine.length; index += 1) {
    child.stdin.write('\x7f');
    await sleep(35);
  }
  await sleep(400);

  // B. Two lines plus a trailing break is a two-line block.
  mark = output.length;
  child.stdin.write('first\nsecond\n');
  try {
    await waitFor(() => plain(output.slice(mark)).includes('[line 2 of 2]'), 4000, 'the two-line chip');
    record(true, 'a two-line paste with a trailing break reads as line 2 of 2');
  } catch {
    record(false, 'a two-line paste with a trailing break reads as line 2 of 2');
  }
  record(provider.requests.length === 0, 'no request went out for the two-line paste');
  child.stdin.write('\r');
  try {
    await waitFor(() => provider.requests.length === 1, 8000, 'the first run');
    record(lastUserText() === 'first\nsecond', 'Enter sent exactly two lines, with no trailing break');
  } catch {
    record(false, 'Enter sent exactly two lines, with no trailing break');
  }
  await sleep(1200);

  // C. The chip follows the cursor and the edit, and the body matches the chip.
  mark = output.length;
  child.stdin.write('A1\nA2\nA3');
  try {
    await waitFor(() => plain(output.slice(mark)).includes('[line 3 of 3]'), 4000, 'the three-line chip');
    record(true, 'the block shows line 3 of 3 at its end');
  } catch {
    record(false, 'the block shows line 3 of 3 at its end');
  }
  child.stdin.write('\x1b[D');
  await sleep(150);
  child.stdin.write('Z');
  try {
    await waitFor(() => plain(output.slice(mark)).includes('AZ3 [line 3 of 3]'), 4000, 'the edited line');
    record(true, 'Left then Z shows the edited line, AZ3');
  } catch {
    record(false, 'Left then Z shows the edited line, AZ3');
  }
  record(provider.requests.length === 1, 'nothing was sent while the block was being edited');
  child.stdin.write('\r');
  try {
    await waitFor(() => provider.requests.length === 2, 8000, 'the second run');
    record(lastUserText() === 'A1\nA2\nAZ3', 'the request carries exactly the line the chip showed');
  } catch {
    record(false, 'the request carries exactly the line the chip showed');
  }
  await sleep(1200);

  // D. Backspace at the end removes the block whole.
  mark = output.length;
  child.stdin.write('B1\nB2');
  await waitFor(() => plain(output.slice(mark)).includes('[line 2 of 2]'), 4000, 'the draft to clear');
  const beforeBackspace = output.length;
  child.stdin.write('\x7f');
  await sleep(800);
  const afterBackspace = plain(output.slice(beforeBackspace));
  record(
    afterBackspace.length > 0 && !afterBackspace.includes('[line 2 of 2]'),
    'Backspace at the end removed the block as one unit',
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
      'Plato CLI — pasted text proof',
      `cli: ${cli}`,
      '',
      ...results,
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
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
