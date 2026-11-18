/**
 * Drives the built CLI in a real terminal and proves every hint state at 80
 * and 120 columns.
 *
 *   node scripts/cli-tui/hint-drive.mjs [--cli path/to/cli.js]
 *
 * The rule: Alt+Enter is advertised only while the composer has a draft. At
 * idle the full mode explanations are shown instead, because they teach the
 * control people trip over. Every hint must be one whole line at both widths:
 * the exact string is present, and it is neither wrapped nor truncated.
 *
 * States per width:
 *   idle, empty        — explanations · @ files · /help, no Alt+Enter
 *   idle, draft        — explanations · Alt+Enter newline
 *   running, empty     — enter steers · esc pauses · ctrl+c stops, no Alt+Enter
 *   running, draft     — the same plus alt+enter newline
 *   paused, empty      — paused · enter steers · /continue resumes · esc esc stops
 *   paused, draft      — the same plus alt+enter newline
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
const capturePath = join(here, 'hint-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const lastFrame = (text) => {
  const start = text.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(text);
  const end = text.lastIndexOf('\x1b[?2026l');
  return plain(text.slice(start, end > start ? end : undefined));
};
const HINT_STARTS = ['Shift+Tab mode', 'enter steers', 'paused —', 'pausing —'];
const hintLine = (text) =>
  lastFrame(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => HINT_STARTS.some((start) => line.startsWith(start)))
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
const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const captures = [];

const IDLE = 'Shift+Tab mode (plan read-only · edit asks · auto trusted) · @ files · /help';
const IDLE_DRAFT =
  'Shift+Tab mode (plan read-only · edit asks · auto trusted) · Alt+Enter newline';
const IDLE_DRAFT_WIDE =
  'Shift+Tab mode (plan read-only · edit asks · auto trusted) · @ files · /help · Alt+Enter newline';
const RUNNING = 'enter steers · esc pauses · ctrl+c stops';
const RUNNING_DRAFT = 'enter steers · esc pauses · ctrl+c stops · alt+enter newline';
const PAUSED = 'paused — enter steers · /continue resumes · esc esc stops';
const PAUSED_DRAFT = `${PAUSED} · alt+enter newline`;

function launch(cols) {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-hint-'));
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
        model: 'fake:hint-model',
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
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
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
  const proc = {
    child,
    output: '',
    send: (text) => child.stdin.write(text),
    submit: async (text) => {
      child.stdin.write(text);
      await sleep(150);
      child.stdin.write('\r');
    },
    waitHint: (text, what) =>
      waitFor(() => hintLine(proc.output) === text, 15000, what ?? `the hint ${text}`),
    kill: () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    },
  };
  child.stdout.on('data', (chunk) => {
    proc.output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    proc.output += chunk.toString();
  });
  return proc;
}

/** One state check: exact line, no truncation, and no wrap. */
async function check(proc, cols, label, wanted, hasAlt) {
  const shown = await attempt(() => proc.waitHint(wanted, `${label} at ${cols}`));
  const line = hintLine(proc.output);
  record(
    shown && line === wanted && !line.includes('…') && line.length <= cols,
    `${label} at ${cols} columns: one whole line${hasAlt ? ' with Alt+Enter' : ' without Alt+Enter'}`,
  );
  record(
    hasAlt ? /alt\+enter newline/i.test(line) : !/alt\+enter/i.test(line),
    `${label} at ${cols} columns: Alt+Enter ${hasAlt ? 'is shown' : 'is not shown'}`,
  );
}

async function drive(cols) {
  const proc = launch(cols);
  try {
    await waitFor(() => proc.output.includes('Type / for commands'), 20000, 'the start screen');

    // Idle, empty.
    await check(proc, cols, 'idle, empty box', IDLE, false);

    // Idle, draft. Only 80 needs the concession; 100+ keeps @ files and /help.
    proc.send('x');
    const draftHint = cols >= 100 ? IDLE_DRAFT_WIDE : IDLE_DRAFT;
    await check(proc, cols, 'idle, draft', draftHint, true);
    if (cols >= 100) {
      record(
        hintLine(proc.output).includes('@ files') && hintLine(proc.output).includes('/help'),
        `the idle draft hint keeps @ files and /help at ${cols} columns`,
      );
    }
    proc.send('\x7f');
    await attempt(() => proc.waitHint(IDLE, 'the idle hint after clearing'));

    // Running, empty.
    const stream = Array.from({ length: 60 }, (_, i) => `HINT-${String(i).padStart(2, '0')}`).join(' ');
    provider.setScript([{ text: stream, chunks: 60, chunkMs: 120 }]);
    await proc.submit('hold the run for hints');
    await waitFor(() => proc.output.includes('HINT-00'), 20000, 'the run to start');
    await check(proc, cols, 'running, empty box', RUNNING, false);

    // Running, draft.
    proc.send('y');
    await check(proc, cols, 'running, draft', RUNNING_DRAFT, true);
    proc.send('\x7f');
    await attempt(() => proc.waitHint(RUNNING, 'the running hint after clearing'));

    // Paused, empty. The pause lands when the stream finishes.
    proc.send('\x1b');
    await check(proc, cols, 'paused, empty box', PAUSED, false);
    record(
      hintLine(proc.output).includes('esc esc stops'),
      `the paused hint says "esc esc stops" at ${cols} columns`,
    );

    // Paused, draft.
    proc.send('z');
    await check(proc, cols, 'paused, draft', PAUSED_DRAFT, true);

    return proc.output;
  } finally {
    proc.kill();
    await sleep(200);
  }
}

try {
  captures.push(`=== 80 columns ===\n${await drive(80)}`);
  captures.push(`=== 120 columns ===\n${await drive(120)}`);
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — hint state proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      '--- terminal captures ---',
      ...captures,
      '',
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
