/**
 * Drives the built CLI through the header title and the redesigned status line.
 *
 *   node scripts/cli-tui/status-drive.mjs [--cli path/to/cli.js]
 *
 * The same conversation at 100, 80 and 120 columns:
 *  - at 100: the fresh empty header right side, the first message filling it,
 *    the mode hint row, a live rate and duration, and the kept last-run figures;
 *  - at 80: a long title truncates and stays put while the figures grow, and
 *    the status line drops `team: solo` first, then the duration;
 *  - at 120: the full line, the title in the header, and `plato --plain` apart.
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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const HINT =
  'Shift+Tab mode (plan read-only · edit asks · auto trusted) · @ files · /help · Esc stops';
const LONG = 'a conversation title that is far longer than this line can show even at one hundred and twenty columns';

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
const lastFrame = (output) => {
  const start = output.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(output);
  const end = output.lastIndexOf('\x1b[?2026l');
  return plain(output.slice(start, end > start ? end : undefined));
};
const linesOf = (output) =>
  plain(output)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
const statusLines = (output) => linesOf(output).filter((line) => line.startsWith('mode: '));
const lastStatus = (output) => statusLines(output).at(-1) ?? '';
const headerLines = (output) =>
  linesOf(output).filter((line) => line.trimStart().startsWith('Plato · terminal'));
const lastHeader = (output) => headerLines(output).at(-1) ?? '';
// The right side of the header starts after the first double space; the left
// side (`Plato · terminal[ · working…]`) never contains one.
const headerText = (line) => {
  const at = line.indexOf('  ');
  return at < 0 ? '' : line.slice(at).trim();
};
const widthOf = (line) => line.length;

const provider = await startProvider({
  model: 'deepseek-v4-pro',
  context: 1_048_576,
});
const base = `http://127.0.0.1:${provider.port}/v1`;
const STEPS = [
  { tool: 'list_dir', args: { path: '.' } },
  { text: 'The answer is ready.', chunks: 3, chunkMs: 200, holdMs: 1800 },
];

function freshEnv() {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-status-'));
  const config = join(root, 'config');
  const data = join(root, 'data');
  const home = join(root, 'home');
  const project = join(root, 'project');
  for (const dir of [config, data, home, project]) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(config, 'config.json'),
    `${JSON.stringify(
      {
        connections: [{ id: 'deepseek', kind: 'openai', baseUrl: base }],
        model: 'deepseek:deepseek-v4-pro',
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
  return {
    root,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PLATO_CONFIG_DIR: config,
      PLATO_DATA_DIR: data,
      PLATO_HOME: home,
    },
  };
}

function pty(env, cwd, cols) {
  const state = { output: '' };
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
  const child = spawn('sh', ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  state.send = (text) => child.stdin.write(text);
  // The Enter waits for the text to be drawn, so the two cannot arrive as one
  // paste chunk (a paste keeps the text and swallows the Enter).
  state.submit = async (text) => {
    const mark = state.output.length;
    state.send(text);
    // A long line wraps in the composer, so wait for a prefix that fits on
    // one row. Seeing it means the whole input event was processed; Enter is
    // then a separate read and cannot merge with the text.
    const probe = text.slice(0, 20);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(probe),
      5000,
      `the text '${probe}' to be on screen`,
    );
    state.send('\r');
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

function runOnce(env, argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cli, ...argv], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (code) => done({ code, output }));
    child.stdin.end();
  });
}

const results = [];
const captures = [];
const notes = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

async function session(cols, run) {
  const { root, env } = freshEnv();
  provider.setScript(STEPS.map((step) => ({ ...step })));
  const ui = pty(env, root, cols);
  try {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    await run(ui, env);
  } catch (error) {
    record(false, `${cols} columns: ${error.message}`);
  } finally {
    captures.push({ name: `${cols} columns`, output: ui.output });
    ui.kill();
  }
}

try {
  // 100 columns: empty header, the title arrives, the full line, a live run.
  await session(100, async (ui, env) => {
    await waitFor(() => lastStatus(ui.output).includes('0/1M'), 8000, 'the fresh share');
    const fresh = lastStatus(ui.output);
    record(fresh.includes('mode: edit'), 'the mode says it is a setting');
    record(fresh.split(' · ')[1] === 'team: solo', 'the team is labelled beside the mode');
    record(fresh.includes('0/1M ░░░░░░░░ 0%'), 'a fresh conversation shows 0 of 1M');
    record(fresh.includes('↑0 ↓0'), 'a fresh conversation shows zero session tokens');
    record(!fresh.includes('$'), 'the cost is not on the status line');
    record(headerText(lastHeader(ui.output)) === '', 'a fresh conversation has an empty right header');
    record(
      !lastHeader(ui.output).includes(' edit') && !lastHeader(ui.output).includes(' mode'),
      'the mode has left the header',
    );
    await waitFor(() => plain(ui.output).includes(HINT), 5000, 'the hint row');
    record(true, 'the hint row explains the three modes');

    await ui.submit('test run');
    await waitFor(
      () => headerText(lastHeader(ui.output)) === 'test run',
      8000,
      'the title in the header',
    );
    record(true, 'the first message fills the header title');
    const live = await attempt(async () => {
      await waitFor(() => lastFrame(ui.output).includes('working…'), 10000, 'the running header');
      await waitFor(
        () => / · \d+ t\/s · \d+s$/.test(lastStatus(ui.output)),
        10000,
        'a live rate and duration',
      );
    });
    record(live, 'a run shows a live rate and duration');
    if (live) notes.push(`100 live: ${lastStatus(ui.output)}`);
    await waitFor(() => /\b2 turns\b/.test(plain(ui.output)), 20000, 'the run summary');
    const idle = lastStatus(ui.output);
    const parts = idle.split(' · ');
    notes.push(`100 idle: ${idle}`);
    record(parts[0] === 'mode: edit' && parts[1] === 'team: solo', 'the mode and team lead the line');
    record(parts[2] === 'deepseek:deepseek-v4-pro', 'the model follows the team');
    record(/ · \d+ t\/s · \d+s$/.test(idle), 'the last run keeps its rate and duration');
    record(/ · ↑\d+[kM]? ↓\d+[kM]? · /.test(idle), 'the session tokens are running totals');
    record(widthOf(idle) <= 100, 'the 100-column status line is one row');
    record(headerText(lastHeader(ui.output)) === 'test run', 'the header title is unchanged after the run');
    record(widthOf(lastHeader(ui.output)) <= 100, 'the 100-column header is one row');

    // `/new` empties the right side; the next message names the new one.
    await ui.submit('/new');
    await waitFor(
      () => headerText(lastHeader(ui.output)) === '',
      5000,
      'the cleared header title',
    );
    record(true, '/new clears the header title');
    await ui.submit('a new task');
    await waitFor(
      () => headerText(lastHeader(ui.output)) === 'a new task',
      8000,
      'the new title',
    );
    record(true, 'the next message names the new conversation');

    const piped = await runOnce(env, ['-p', 'hello']);
    record(
      piped.code === 0 &&
        !plain(piped.output).includes('mode: edit') &&
        !plain(piped.output).includes('team: solo') &&
        !plain(piped.output).includes('Plato · terminal'),
      'plato --plain draws no header or status line',
    );
  });

  // 80 columns: a long title truncates once, and the team leaves first.
  await session(80, async (ui) => {
    await waitFor(() => lastStatus(ui.output).includes('0/1M'), 8000, 'the fresh share');
    await ui.submit(LONG);
    await waitFor(
      () => headerText(lastHeader(ui.output)).endsWith('…'),
      8000,
      'the truncated header title',
    );
    const firstTitle = headerText(lastHeader(ui.output));
    record(firstTitle.length > 0, 'the 80-column title is truncated, not dropped');
    await waitFor(() => /\b2 turns\b/.test(plain(ui.output)), 20000, 'the run summary');
    const idle = lastStatus(ui.output);
    notes.push(`80 idle: ${idle}`);
    record(widthOf(idle) <= 80, 'the 80-column status line is one row');
    record(widthOf(lastHeader(ui.output)) <= 80, 'the 80-column header is one row');
    record(
      headerText(lastHeader(ui.output)) === firstTitle,
      'the truncated title keeps its width while the figures grow',
    );
    record(!idle.includes('team:'), 'the team is the first part to leave at 80');
    record(!/ · \d+s$/.test(idle), 'the duration leaves after the team');
    record(idle.includes(' t/s'), 'the rate stays when the line has room for it');
    record(idle.startsWith('mode: edit · '), 'the mode stays at 80');
    record(idle.includes('/1M ░'), 'the share stays at 80');
    record(idle.includes('deepseek:deepseek-v4-pro'), 'the model stays at 80');
    record(/ · ↑\d+[kM]? ↓\d+[kM]? · /.test(idle), 'the tokens stay at 80');
  });

  // 120 columns: the full line, and the title held in the header.
  await session(120, async (ui) => {
    await waitFor(() => lastStatus(ui.output).includes('0/1M'), 8000, 'the fresh share');
    await ui.submit(LONG);
    await waitFor(() => /\b2 turns\b/.test(plain(ui.output)), 20000, 'the run summary');
    const idle = lastStatus(ui.output);
    notes.push(`120 idle: ${idle}`);
    record(widthOf(idle) <= 120, 'the 120-column status line is one row');
    record(idle.split(' · ')[0] === 'mode: edit', 'the mode leads the line');
    record(idle.split(' · ')[1] === 'team: solo', 'the team is labelled at 120');
    record(/ · \d+ t\/s · \d+s$/.test(idle), 'the rate and duration stay at 120');
    record(!idle.includes('conversation title'), 'the status line has no title of its own');
    record(headerText(lastHeader(ui.output)).length > 0, 'the title is in the header at 120');
    record(widthOf(lastHeader(ui.output)) <= 120, 'the 120-column header is one row');
    record(!lastHeader(ui.output).includes(' edit'), 'the header carries no mode at 120');
  });
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  for (const width of [100, 80, 120]) {
    const found = captures.find((capture) => capture.name === `${width} columns`);
    writeFileSync(
      join(here, `status-capture-${width}.txt`),
      [
        `Plato CLI — header and status line at ${width} columns`,
        `cli: ${cli}`,
        '',
        ...results,
        '',
        ...notes,
        '',
        found?.output ?? '',
      ].join('\n'),
    );
  }
}

for (const line of results) console.log(line);
for (const note of notes) console.log(note);
console.log(`captures: ${join(here, 'status-capture-{100,80,120}.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
