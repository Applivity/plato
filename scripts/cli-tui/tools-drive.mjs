/**
 * Drives the built CLI through the tool-row detail, code rendering and resize.
 *
 *   node scripts/cli-tui/tools-drive.mjs [--cli path/to/cli.js]
 *
 * 1. A finished shell row opens with Ctrl+O: the full command, its start time,
 *    its duration and its outcome; Ctrl+O closes it again. No result is shown.
 * 2. A long indented code line wraps under its own indent, and a diff keeps
 *    its +/- lines in distinct colours.
 * 3. The terminal resizes from 100 to 60 columns while a run streams: the live
 *    area re-measures. Committed <Static> rows cannot be re-rendered, and the
 *    capture shows that limit rather than hiding it.
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
const COMMAND =
  'sleep 1; echo finished-with-a-long-tail-0123456789abcdefghijklmnopqrstuvwxyz';
const ANSWER = [
  'The code and the change:',
  '',
  '```js',
  "    const value = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';",
  '```',
  '',
  '```diff',
  '-const old = 1;',
  '+const now = 2;',
  ' context line',
  '```',
].join('\n');
const LONG = 'A long answer line that must be re-wrapped when the terminal becomes narrower than it was.';

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const lastFrame = (output) => {
  const start = output.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(output);
  const end = output.lastIndexOf('\x1b[?2026l');
  return plain(output.slice(start, end > start ? end : undefined));
};
const maxWidth = (output) =>
  Math.max(0, ...lastFrame(output).split('\n').map((line) => line.replace(/\r$/, '').length));
const panelOpen = (output) => lastFrame(output).includes('Tool detail · Ctrl+O closes');

const provider = await startProvider({ context: 131_072, model: 'tools-model' });
const root = mkdtempSync(join(tmpdir(), 'plato-cli-tools-'));
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
      model: 'fake:tools-model',
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
const env = {
  ...process.env,
  TERM: 'xterm-256color',
  PLATO_CONFIG_DIR: config,
  PLATO_DATA_DIR: data,
  PLATO_HOME: home,
};

const resizeFlag = join(root, 'resize-now');

function pty(cols, withResize = false) {
  const state = { output: '', exited: false };
  const resize = withResize
    ? `(while [ ! -f ${JSON.stringify(resizeFlag)} ]; do sleep 0.1; done; stty -f /dev/tty cols 60) &`
    : '';
  const inner = `stty cols ${cols}; ${resize} exec node ${JSON.stringify(cli)}`;
  const child = spawn(
    'sh',
    ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`],
    { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true },
  );
  child.stdout.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  child.on('close', () => {
    state.exited = true;
  });
  state.send = (text) => child.stdin.write(text);
  state.submit = async (text) => {
    const mark = state.output.length;
    state.send(text);
    const probe = text.slice(0, 20);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(probe),
      5000,
      `the text '${probe}' on screen`,
    );
    state.send('\r');
  };
  state.quit = async () => {
    state.send('\x03');
    await sleep(400);
    state.send('\x03');
    await sleep(700);
    try {
      child.stdin.end();
    } catch {
      // Already gone.
    }
    await waitFor(() => state.exited, 8000, 'the process to exit');
  };
  state.kill = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };
  return state;
}

const results = [];
const captures = [];
const notes = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

try {
  // 1 and 2: the detail panel, the wrapped code and the coloured diff.
  provider.setScript([
    { tool: 'shell', args: { command: COMMAND } },
    { text: ANSWER },
  ]);
  const detail = pty(60);
  try {
    await waitFor(() => plain(detail.output).includes('Type / for commands'), 8000, 'the session');
    await detail.submit('show me the code');
    await waitFor(
      () => plain(detail.output).includes('The code and the change:'),
      8000,
      'the run',
    );
    await waitFor(
      () => plain(detail.output).includes('+const now = 2;'),
      20000,
      'the answer',
    );
    await waitFor(() => plain(detail.output).includes('2 turns'), 20000, 'the run summary');

    detail.send('\x0f');
    await waitFor(() => panelOpen(detail.output), 5000, 'the tool detail');
    record(true, 'Ctrl+O opens the latest tool row’s detail');
    record(
      lastFrame(detail.output).includes('sleep 1; echo finished-with-a-long-tail-0123456789abcdef') &&
        lastFrame(detail.output).includes('ghijklmnopqrstuvwxyz'),
      'the detail shows the whole command, wrapped under its indent',
    );
    record(
      /started \d\d:\d\d:\d\d/.test(lastFrame(detail.output)),
      'the detail says when the call started',
    );
    record(
      /took \d+(ms|s)/.test(lastFrame(detail.output)),
      'the detail says how long it took',
    );
    record(lastFrame(detail.output).includes('outcome: done'), 'the detail says how it ended');
    record(
      !/output:|stdout:|stderr:/.test(lastFrame(detail.output)),
      'the detail invents no tool output',
    );
    detail.send('\x0f');
    await waitFor(() => !panelOpen(detail.output), 5000, 'the panel to close');
    record(true, 'Ctrl+O closes it again');

    const answer = plain(detail.output);
    record(
      /│ {7,}a{10,}/.test(answer),
      'a wrapped code line hangs under the code’s own indent',
    );
    record(
      !/│ {2,3}a{10,}/.test(answer),
      'no continuation starts at the box’s padding',
    );
    record(
      /\x1b\[32m[^\x1b\r\n]*\+const now = 2;/.test(detail.output) &&
        /\x1b\[31m[^\x1b\r\n]*-const old = 1;/.test(detail.output),
      'a diff keeps + green and - red',
    );
    notes.push(`detail max width: ${maxWidth(detail.output)}`);
  } catch (error) {
    record(false, `detail: ${error.message}`);
  } finally {
    captures.push({ name: 'detail and rendering', output: detail.output });
    if (!detail.exited) detail.quit().catch(() => detail.kill());
  }

  // 3: the live area re-measures after a resize; committed rows cannot.
  provider.setScript([
    { text: LONG },
    { text: `${LONG} ${LONG}`, chunks: 12, chunkMs: 180, holdMs: 2500 },
  ]);
  const resized = pty(100, true);
  try {
    await waitFor(() => plain(resized.output).includes('Type / for commands'), 8000, 'the session');
    await resized.submit('a committed answer');
    await waitFor(
      () => plain(resized.output).includes('A long answer line'),
      20000,
      'the committed answer',
    );
    await waitFor(() => plain(resized.output).includes('1 turn'), 20000, 'the first summary');
    await sleep(300);
    const before = maxWidth(resized.output);
    record(before >= 90, 'before the resize the frame uses the wide terminal');

    writeFileSync(resizeFlag, 'now');
    await waitFor(() => maxWidth(resized.output) <= 60, 8000, 'a frame at 60 columns');
    record(true, 'the live frame re-measures to the new width');

    await resized.submit('a streaming answer');
    await waitFor(() => lastFrame(resized.output).includes('working…'), 8000, 'the run');
    await waitFor(
      () => maxWidth(resized.output) <= 60 && lastFrame(resized.output).includes('A long answer'),
      8000,
      'the live answer at 60 columns',
    );
    record(true, 'the live answer wraps at the new width');
    notes.push(`resize widths: before ${before}, after ${maxWidth(resized.output)}`);
    notes.push(
      'limit: rows already printed through <Static> cannot be re-rendered on a resize; only the live area below them re-measures.',
    );
  } catch (error) {
    record(false, `resize: ${error.message}`);
  } finally {
    captures.push({ name: 'resize', output: resized.output });
    if (!resized.exited) resized.quit().catch(() => resized.kill());
  }
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  writeFileSync(
    join(here, 'tools-capture.txt'),
    [
      'Plato CLI — tool detail, code rendering and resize',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      ...captures.map((capture) => `===== ${capture.name} =====\n${capture.output}`),
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
for (const note of notes) console.log(note);
console.log(`capture: ${join(here, 'tools-capture.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
