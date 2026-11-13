/**
 * Drives the built CLI in a real terminal and proves the answer does not
 * reflow when it lands.
 *
 *   node scripts/cli-tui/stream-drive.mjs [--cli path/to/cli.js]
 *
 * The fake provider streams a Markdown answer slowly, then holds before it
 * finishes, so the last streaming frame can be read. The check compares that
 * frame's answer lines with the frame that prints the committed row.
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
const capturePath = join(here, 'stream-capture.txt');

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

/** Every frame Ink draws, with the offset it starts at. */
function framesFrom(text, from = 0) {
  const frames = [];
  let at = from;
  while (at < text.length) {
    const start = text.indexOf('\x1b[?2026h', at);
    if (start < 0) break;
    const end = text.indexOf('\x1b[?2026h', start + 1);
    frames.push({ at: start, text: text.slice(start, end < 0 ? text.length : end) });
    if (end < 0) break;
    at = end;
  }
  return frames;
}

/**
 * The answer lines of a live frame. The committed row is printed after the
 * frame's own terminator inside the same write, so it is cut off first.
 */
function bodyLines(frame) {
  const live = frame.text.split('\x1b[?2026l')[0] ?? '';
  return plain(live)
    .split('\n')
    .filter((line) => line.startsWith('│'))
    .map((line) => line.replace(/^│ ?/, '').replace(/\r$/, ''));
}

function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    width += (cp >= 0x11_00 && cp <= 0x11_5f) || (cp >= 0x2e_80 && cp <= 0xa4_cf) ||
      (cp >= 0xac_00 && cp <= 0xd7_a3) || (cp >= 0xf9_00 && cp <= 0xfa_ff) ||
      (cp >= 0xfe_30 && cp <= 0xfe_4f) || (cp >= 0xff_00 && cp <= 0xff_60) ||
      (cp >= 0x1_f3_00 && cp <= 0x1_f6_4f) || (cp >= 0x2_00_00 && cp <= 0x3_ff_fd)
      ? 2
      : 1;
  }
  return width;
}

const ANSWER = [
  'Here is the result.',
  '',
  '**Bold claim** with `code` and a [link](https://example.com).',
  '',
  '- item one',
  '- item two',
  '',
  '```js',
  'const total = 1;',
  '```',
  '',
  `漢字かな and a long token: ${'x'.repeat(140)} END-OF-ANSWER`,
].join('\n');

const FENCED = 'Before the fence.\n```js\nconst open = 1;\n';

const PARAGRAPH = `The quick brown fox jumps over the lazy dog ${'y'.repeat(30)}.\nA second line in the same paragraph.\nA third line closes it.`;
const LONG = `${`${PARAGRAPH}\n\n`.repeat(120).slice(0, 9950)}\nEND-OF-LONG`;

const provider = await startProvider();
const root = mkdtempSync(join(tmpdir(), 'plato-cli-stream-'));
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
      model: 'fake:stream-model',
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
// Text and Enter arrive as two events, as they do from a keyboard.
const submit = async (text) => {
  send(text);
  await sleep(150);
  send('\r');
};

/** Wait until the app is idle again after a run, and return its summary. */
async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 15000, 'the run summary');
  await sleep(400);
}

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');

  // 1-2. The streaming frame and the committed frame carry the same lines.
  provider.setScript([{ text: ANSWER, chunks: 10, chunkMs: 180, holdMs: 1200 }]);
  let mark = output.length;
  await submit('show me the answer');
  await waitFor(() => plain(output.slice(mark)).includes('END-OF-ANSWER'), 8000, 'the last chunk');
  await sleep(250);
  const liveFrames = framesFrom(output, mark).filter((frame) => bodyLines(frame).length > 0);
  const liveFrame = liveFrames.at(-1);
  const liveLines = liveFrame === undefined ? [] : bodyLines(liveFrame);
  record(liveLines.length >= 5, `the streaming frame shows the rendered answer (${liveLines.length} lines)`);
  record(!liveLines.join('\n').includes('**'), 'Markdown markers are rendered while the answer streams');
  record(!liveLines.join('\n').includes('```'), 'a code fence is drawn as code while it streams');
  record(liveLines.some((line) => line.includes('• item one')), 'a list is a list while it streams');

  await waitRunEnd(mark);
  // A committed row is printed to the scrollback directly, not inside a
  // synchronized frame: it follows the live frame's own terminator.
  const terminator = '\x1b[?2026l';
  const liveEnd = output.lastIndexOf(terminator, liveFrame.at + liveFrame.text.length);
  const afterLive = plain(output.slice(liveEnd + terminator.length));
  const committedLines = afterLive
    .split('\n')
    .filter((line) => line.startsWith('│'))
    .map((line) => line.replace(/^│ ?/, '').replace(/\r$/, ''));
  record(
    liveLines.length > 0 &&
      committedLines.length >= liveLines.length &&
      liveLines.every(
        (line, index) => line === committedLines[committedLines.length - liveLines.length + index],
      ),
    'the committed row shows exactly the lines the streaming frame showed',
  );
  record(
    committedLines.filter((line) => line === liveLines[0]).length === 1,
    'the answer is printed once, not once live and once as a row',
  );
  const widths = liveLines.map((line) => displayWidth(line));
  record(
    widths.every((width) => width <= 78),
    'every answer line fits the terminal width, wide characters included',
  );
  notes.push(`streaming widths: ${widths.join(',')}`);

  // 3. An unclosed fence mid-stream is text, not a crash.
  provider.setScript([{ text: FENCED, chunks: 3, chunkMs: 100, holdMs: 300 }]);
  mark = output.length;
  await submit('show me the fence');
  await waitRunEnd(mark);
  const fenced = plain(output.slice(mark));
  record(fenced.includes('const open = 1;'), 'an unclosed fence keeps its text visible');
  await submit('/help');
  await waitFor(() => plain(output.slice(mark)).includes('Commands'), 4000, 'the app to answer after the fence');
  record(true, 'the app keeps running after an unclosed fence');

  // 4. A tool row still renders in the same run.
  provider.setScript([
    { tool: 'list_dir', args: { path: '.' } },
    { text: 'The listing is done.' },
  ]);
  mark = output.length;
  await submit('list this folder');
  await waitRunEnd(mark);
  const withTool = plain(output.slice(mark));
  record(withTool.includes('→ listing a folder'), 'a tool row still shows what is being done');
  record(withTool.includes('✓ listing a folder'), 'a tool row still shows that it finished');
  record(withTool.includes('The listing is done.'), 'the answer after a tool still lands');

  // 5. A long answer keeps the same tail lines, and still commits its row.
  provider.setScript([{ text: LONG, chunks: 25, chunkMs: 40, holdMs: 1200 }]);
  mark = output.length;
  const started = Date.now();
  await submit('write a long answer');
  await waitFor(() => plain(output.slice(mark)).includes('END-OF-LONG'), 10000, 'the long answer');
  await sleep(150);
  const longLiveFrames = framesFrom(output, mark).filter((frame) => bodyLines(frame).length > 0);
  const longLive = longLiveFrames.at(-1);
  const longLiveLines = longLive === undefined ? [] : bodyLines(longLive);
  await waitRunEnd(mark);
  const elapsed = Date.now() - started;
  const perFrame = (elapsed - 24 * 40 - 1200 - 400) / 25;
  notes.push(`long answer: ${LONG.length} chars, 25 chunks, ${elapsed} ms total, ~${perFrame.toFixed(1)} ms per frame`);
  notes.push(`long answer: ${longLiveFrames.length} frames, ${longLiveLines.length} lines in the last one`);
  const longTerminator = '\x1b[?2026l';
  const longEnd = longLive === undefined
    ? 0
    : output.lastIndexOf(longTerminator, longLive.at + longLive.text.length);
  const longCommitted = plain(output.slice(longEnd + longTerminator.length))
    .split('\n')
    .filter((line) => line.startsWith('│'))
    .map((line) => line.replace(/^│ ?/, '').replace(/\r$/, ''));
  record(longCommitted.length > 0, 'the long answer still commits its row');
  record(
    longLiveLines.length > 0 &&
      longCommitted.length >= longLiveLines.length &&
      longLiveLines.every(
        (line, index) => line === longCommitted[longCommitted.length - longLiveLines.length + index],
      ),
    'the long answer shows the same tail lines when it lands',
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
      'Plato CLI — streaming answer proof',
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
