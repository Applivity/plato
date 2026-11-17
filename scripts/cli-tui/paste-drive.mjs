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
// Concurrent runs can keep their captures apart; the default is the evidence
// file next to this script.
const capturePath = process.env['PASTE_CAPTURE'] ?? join(here, 'paste-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The frame without its colours and cursor moves, for readable assertions. */
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** The last frame Ink drew, which is the screen the user is looking at. */
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
function userText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.filter((message) => message?.role === 'user').at(-1);
  return typeof user?.content === 'string' ? user.content : '';
}
/** The nth chat request, once it exists. Writes are slow under six-way load. */
async function requestAt(count) {
  await waitFor(() => provider.requests.length >= count, 30000, `request ${count}`);
  return provider.requests[count - 1];
}
/** The nth run summary, which means the run has settled before the next step. */
async function runEnded(count) {
  await waitFor(
    () => (plain(output).match(/\b1 turn\b/g) ?? []).length >= count,
    30000,
    `run summary ${count}`,
  );
}

try {
  await waitFor(() => output.includes('Type / for commands'), 20000, 'the start screen');

  // A. One line plus a trailing break is one line. The assertion waits for the
  // frame that carries the paste: a fixed sleep lost this under load.
  const oneLine = 'C:\\work\\file.png';
  child.stdin.write(`${oneLine}\n`);
  await waitFor(
    () => lastComposer(output).includes(oneLine),
    20000,
    'the one-line paste on screen',
  );
  const oneFrame = lastFrame(output);
  record(
    !oneFrame.includes('[line ') && !oneFrame.includes('[+') && oneFrame.includes('file.png'),
    'a one-line paste with a trailing break shows no chip',
  );
  record(provider.requests.length === 0, 'no request went out for the one-line paste');
  // One key per write, and each DELETE waits for its own effect: a burst under
  // load can arrive as one chunk instead of separate keys.
  for (let left = oneLine.length; left > 0; left -= 1) {
    const visible = oneLine.slice(0, left);
    child.stdin.write('\x7f');
    await waitFor(
      () => !lastComposer(output).includes(visible),
      10000,
      `backspace ${oneLine.length - left + 1}`,
    );
  }
  await waitFor(() => lastComposer(output).trim() === '›', 10000, 'the empty composer');

  // B. Two lines plus a trailing break is a two-line block.
  child.stdin.write('first\nsecond\n');
  await waitFor(
    () => lastFrame(output).includes('[line 2 of 2]'),
    20000,
    'the two-line chip',
  );
  record(true, 'a two-line paste with a trailing break reads as line 2 of 2');
  record(provider.requests.length === 0, 'no request went out for the two-line paste');
  child.stdin.write('\r');
  const first = await requestAt(1);
  record(
    userText(first) === 'first\nsecond',
    'Enter sent exactly two lines, with no trailing break',
  );
  await runEnded(1);

  // C. The chip follows the cursor and the edit, and the body matches the chip.
  child.stdin.write('A1\nA2\nA3');
  await waitFor(
    () => lastFrame(output).includes('[line 3 of 3]'),
    20000,
    'the three-line chip',
  );
  record(true, 'the block shows line 3 of 3 at its end');
  // A chip does not draw the cursor, so there is no frame to wait on for the
  // Left itself; the two writes stay in order and the edit is checked below.
  child.stdin.write('\x1b[D');
  await sleep(80);
  child.stdin.write('Z');
  await waitFor(
    () => lastFrame(output).includes('AZ3 [line 3 of 3]'),
    20000,
    'the edited line',
  );
  record(true, 'Left then Z shows the edited line, AZ3');
  record(provider.requests.length === 1, 'nothing was sent while the block was being edited');
  child.stdin.write('\r');
  const second = await requestAt(2);
  record(
    userText(second) === 'A1\nA2\nAZ3',
    'the request carries exactly the line the chip showed',
  );
  await runEnded(2);

  // D. Backspace at the end removes the block whole.
  child.stdin.write('B1\nB2');
  await waitFor(
    () => lastFrame(output).includes('[line 2 of 2]'),
    20000,
    'the draft to clear',
  );
  child.stdin.write('\x7f');
  await waitFor(
    () => !lastFrame(output).includes('[line 2 of 2]'),
    20000,
    'the chip to clear',
  );
  record(
    lastComposer(output).trim() === '›',
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
