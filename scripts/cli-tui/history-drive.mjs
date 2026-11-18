/**
 * Drives the built CLI through the run-state hint, history search and the
 * external editor.
 *
 *   node scripts/cli-tui/history-drive.mjs [--cli path/to/cli.js]
 *
 * 1. One process: the idle hint, the running hint (and back), a card keeping the
 *    idle hint, and the history file it leaves behind.
 * 2. A second process in the same workspace: Ctrl+R finds a line from the first
 *    process, steps through matches, Enter fills without sending, Esc restores.
 * 3. Ctrl+G with a real editor script: the edited text is in the composer,
 *    cursor at the end, nothing sent, and the transcript is not written twice.
 * 4. Ctrl+G with a missing editor: one sentence, the draft kept.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const IDLE_HINT =
  'Shift+Tab mode (plan · edit · auto) · @ files · /help · Alt+Enter newline';
const RUNNING_HINT = 'enter steers · esc pauses · ctrl+c stops · alt+enter newline';
const ALPHA = 'history probe alpha from the previous process';
const BETA = 'history probe beta from the previous process';
const EDITOR_ERROR =
  'Could not start /nonexistent/plato-editor-xyz; your draft is unchanged.';

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
const linesOf = (text) =>
  text.split('\n').map((line) => line.replace(/\r$/, ''));
const lastLine = (output, prefix) =>
  linesOf(lastFrame(output)).filter((line) => line.startsWith(prefix)).at(-1) ?? '';
const lastComposer = (output) => lastLine(output, '› ');
const lastSearch = (output) => lastLine(output, '(reverse-i-search)');
const lastHeader = (output) =>
  linesOf(lastFrame(output)).filter((line) => line.trimStart().startsWith('Plato · terminal')).at(-1) ?? '';

const provider = await startProvider({ context: 131_072 });
const base = `http://127.0.0.1:${provider.port}/v1`;
const root = mkdtempSync(join(tmpdir(), 'plato-cli-history-'));
const config = join(root, 'config');
const dataRoot = join(root, 'data');
const home = join(root, 'home');
const project = join(root, 'project');
for (const dir of [config, dataRoot, home, project]) mkdirSync(dir, { recursive: true });
const baseEnv = {
  ...process.env,
  TERM: 'xterm-256color',
  PLATO_CONFIG_DIR: config,
  PLATO_DATA_DIR: dataRoot,
  PLATO_HOME: home,
};
writeFileSync(
  join(config, 'config.json'),
  `${JSON.stringify(
    {
      connections: [{ id: 'fake', kind: 'openai', baseUrl: base }],
      model: 'fake:history-model',
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

const editorDir = mkdtempSync(join(tmpdir(), 'plato-cli-editor-'));
const editorScript = join(editorDir, 'editor.sh');
writeFileSync(
  editorScript,
  '#!/bin/sh\nprintf \'EDITOR-RAN\\n\'\nprintf \'\\nedited by the test editor\\n\' >> "$1"\n',
  { mode: 0o700 },
);
chmodSync(editorScript, 0o700);

function pty(env, cols) {
  const state = { output: '', exited: false };
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
  const child = spawn(
    'sh',
    ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`],
    {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    },
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
  // The text is on screen before Enter, so the two cannot arrive as one paste.
  state.submit = async (text) => {
    const mark = state.output.length;
    state.send(text);
    const probe = text.slice(0, 20);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(probe),
      5000,
      `the text '${probe}' to be on screen`,
    );
    state.send('\r');
  };
  state.type = async (text) => {
    const mark = state.output.length;
    state.send(text);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(text.slice(0, 20)),
      5000,
      `the draft '${text}' to be on screen`,
    );
  };
  // Ctrl+C twice is the app's exit. The `cat` in front of `script` keeps our
  // stdin open, so the pipeline only closes once we close it too.
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

const SLOW = { text: 'Answer for the history run.', chunks: 3, chunkMs: 200, holdMs: 1200 };

async function session(name, env, run) {
  const ui = pty(env, 100);
  try {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    await run(ui);
  } catch (error) {
    record(false, `${name}: ${error.message}`);
  } finally {
    captures.push({ name, output: ui.output });
    if (!ui.exited) ui.kill();
  }
}

try {
  // 1. The hint, and the history file the runs leave.
  await session('process one', baseEnv, async (ui) => {
    await waitFor(() => plain(ui.output).includes(IDLE_HINT), 8000, 'the idle hint');
    record(true, 'idle shows the three modes and /help');
    // Idle, Esc does nothing. A hint that says it stops would be advertising an
    // action that cannot happen — the exact defect the run hint was fixed for.
    const idleLine =
      lastFrame(ui.output)
        .split('\n')
        .find((line) => line.startsWith('Shift+Tab mode')) ?? '';
    record(!/esc stops/i.test(idleLine), 'the idle hint does not advertise a stop');
    record(
      idleLine.includes('@ files') && idleLine.includes('/help'),
      'the idle hint still names the keys that work at idle',
    );

    provider.setScript([SLOW]);
    await ui.submit(ALPHA);
    const running = await attempt(() =>
      waitFor(() => lastFrame(ui.output).includes(RUNNING_HINT), 8000, 'the running hint'),
    );
    record(running, 'a run replaces the hint with the keys that work during it');
    record(
      running && !lastFrame(ui.output).includes(IDLE_HINT),
      'the idle hint is gone while the run is in progress',
    );
    await waitFor(() => /\b1 turn\b/.test(plain(ui.output)), 20000, 'the first run summary');
    await waitFor(() => lastFrame(ui.output).includes(IDLE_HINT), 5000, 'the idle hint again');
    record(true, 'the hint returns to idle when the run ends');

    provider.setScript([SLOW]);
    const secondMark = ui.output.length;
    await ui.submit(BETA);
    await waitFor(
      () => /\b1 turn\b/.test(plain(ui.output.slice(secondMark))),
      20000,
      'the second run summary',
    );
    await waitFor(() => lastFrame(ui.output).includes(IDLE_HINT), 5000, 'idle after the second run');

    // A card owns the footer; the hint stays as the idle one.
    provider.setScript([
      { tool: 'write_file', args: { path: 'history.txt', content: 'x' } },
      { text: 'Done.' },
    ]);
    const mark = ui.output.length;
    await ui.submit('write a file');
    await waitFor(
      () => plain(ui.output.slice(mark)).includes('Allow write_file?'),
      8000,
      'the approval card',
    );
    record(lastFrame(ui.output).includes(IDLE_HINT), 'an open card leaves the idle hint in place');
    record(!lastFrame(ui.output).includes(RUNNING_HINT), 'an open card does not advertise the run keys');
    ui.send('\x1b');
    await waitFor(
      () => plain(ui.output.slice(mark)).includes('Denied and stopped'),
      5000,
      'the denied row',
    );

    await ui.quit();
    record(true, 'the first process exits');

    // The file is under the data home, private, and holds the submitted lines.
    const historyDir = join(dataRoot, 'history');
    const files = readdirSync(historyDir).filter((file) => file.endsWith('.json'));
    record(files.length === 1, 'one history file for the workspace');
    const historyFile = join(historyDir, files[0] ?? '');
    const stored = JSON.parse(readFileSync(historyFile, 'utf8')).entries;
    record(
      stored.map((entry) => entry.text).join(' | ') === `${ALPHA} | ${BETA} | write a file`,
      'the submitted lines are on disk, in order',
    );
    record(
      stored.every((entry) => typeof entry.at === 'string' && !Number.isNaN(Date.parse(entry.at))),
      'every stored line has a usable time',
    );
    record(
      (statSync(historyFile).mode & 0o777) === 0o600,
      'the history file is private (0600)',
    );
    record(!historyFile.startsWith(project), 'the history is not in the project');
    // The CLI keys on the cwd it sees, which macOS resolves through /var.
    const expectedKey = createHash('sha1').update(realpathSync(project)).digest('hex').slice(0, 8);
    notes.push(
      `history: ${historyFile} (project key ${files[0]?.replace(/\.json$/, '')}, expected ${expectedKey})`,
    );
  });

  // 2. A new process searches the previous process's lines.
  await session('process two', baseEnv, async (ui) => {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    await ui.type('draft to keep');
    await waitFor(() => lastComposer(ui.output).includes('draft to keep'), 5000, 'the draft');
    const sent = provider.requests.length;

    ui.send('\x12');
    await waitFor(
      () => lastFrame(ui.output).includes('(reverse-i-search)'),
      5000,
      'the search row',
    );
    record(
      lastComposer(ui.output).includes('draft to keep'),
      'the search does not hide the composer',
    );

    ui.send('probe');
    await waitFor(() => lastSearch(ui.output).includes(BETA), 5000, 'the newest match');
    record(true, 'a search finds a line from the previous process');
    record(
      /just now|\d+[mhdw] ago/.test(lastSearch(ui.output)),
      'the match says how recent it is',
    );
    record(lastSearch(ui.output).includes("`probe'"), 'the search shows its query');
    record(
      lastComposer(ui.output).includes('draft to keep'),
      'typing in the search does not edit the composer',
    );

    ui.send('\x12');
    await waitFor(() => lastSearch(ui.output).includes(ALPHA), 5000, 'the older match');
    record(true, 'Ctrl+R again steps to the older match');
    ui.send('\x1b[B');
    await waitFor(() => lastSearch(ui.output).includes(BETA), 5000, 'the newer match');
    record(true, 'Down steps back toward the newest match');
    ui.send('\x1b[A');
    await waitFor(() => lastSearch(ui.output).includes(ALPHA), 5000, 'the older match again');
    record(true, 'Up steps to the older match');

    ui.send('\x1b');
    await waitFor(
      () => !lastFrame(ui.output).includes('(reverse-i-search)'),
      5000,
      'the closed search',
    );
    record(
      lastComposer(ui.output).includes('draft to keep'),
      'Esc closes the search and leaves the line as it was',
    );

    // Enter takes the match without sending it.
    ui.send('\x12');
    await waitFor(
      () => lastFrame(ui.output).includes('(reverse-i-search)'),
      5000,
      'the search row again',
    );
    ui.send('probe');
    await waitFor(() => lastSearch(ui.output).includes(BETA), 5000, 'the match again');
    const before = provider.requests.length;
    ui.send('\r');
    await waitFor(
      () => !lastFrame(ui.output).includes('(reverse-i-search)'),
      5000,
      'the search to close on Enter',
    );
    await waitFor(() => lastComposer(ui.output).includes(BETA), 5000, 'the filled composer');
    await sleep(800);
    record(provider.requests.length === before, 'Enter from search sends nothing');
    record(!lastFrame(ui.output).includes('working…'), 'Enter from search starts no run');
    record(provider.requests.length === sent, 'the whole search sent nothing to the model');
    notes.push(`process two composer: ${lastComposer(ui.output)}`);
    await ui.quit();
  });

  // 3. Ctrl+G with a real editor: the text comes back, nothing is sent.
  await session('process three', { ...baseEnv, EDITOR: editorScript }, async (ui) => {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    // A transcript row makes a replayed <Static> visible.
    await ui.submit('/help');
    await waitFor(() => plain(ui.output).includes('Commands'), 5000, 'the help row');
    const helpBefore = plain(ui.output).split('Commands').length - 1;

    await ui.type('draft for the editor');
    await waitFor(() => lastComposer(ui.output).includes('draft for the editor'), 5000, 'the draft');
    const before = provider.requests.length;
    const mark = ui.output.length;
    ui.send('\x07');
    await waitFor(
      () => plain(ui.output.slice(mark)).includes('EDITOR-RAN'),
      8000,
      'the editor to run',
    );
    await waitFor(
      () => lastComposer(ui.output).includes('edited by the test editor'),
      8000,
      'the edited text in the composer',
    );
    record(true, 'Ctrl+G puts the edited text back in the composer');
    record(
      lastComposer(ui.output).includes('[line 2 of 2]'),
      'the cursor is at the end of a two-line edit',
    );
    record(lastHeader(ui.output).length > 0, 'the app is mounted again after the editor');
    await sleep(500);
    record(provider.requests.length === before, 'the editor sends nothing');
    record(!lastFrame(ui.output).includes('working…'), 'the editor starts no run');
    record(
      plain(ui.output).split('Commands').length - 1 === helpBefore,
      'the transcript is not written twice after a remount',
    );

    ui.send('\x01');
    await waitFor(
      () => lastComposer(ui.output).includes('draft for the editor'),
      5000,
      'the first line of the edit',
    );
    record(
      lastComposer(ui.output).includes('[line 1 of 2]'),
      'the first line of the draft survived the edit',
    );
    notes.push(`process three composer: ${lastComposer(ui.output)}`);
    await ui.quit();
  });

  // 4. A missing editor: one sentence and the draft stays.
  await session(
    'process four',
    { ...baseEnv, EDITOR: '/nonexistent/plato-editor-xyz' },
    async (ui) => {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await ui.type('keep this draft');
      await waitFor(() => lastComposer(ui.output).includes('keep this draft'), 5000, 'the draft');
      const before = provider.requests.length;
      const mark = ui.output.length;
      ui.send('\x07');
      await waitFor(
        () => plain(ui.output.slice(mark)).includes(EDITOR_ERROR),
        8000,
        'the editor error',
      );
      record(true, 'a missing editor is reported');
      record(
        plain(ui.output).split(EDITOR_ERROR).length - 1 === 1,
        'the missing editor is one sentence',
      );
      record(
        !plain(ui.output.slice(mark)).includes('command not found') &&
          !plain(ui.output.slice(mark)).includes('No such file'),
        'the missing editor leaves no shell noise',
      );
      await waitFor(
        () => lastComposer(ui.output).includes('keep this draft'),
        5000,
        'the kept draft',
      );
      record(true, 'a missing editor keeps the draft');
      await sleep(500);
      record(provider.requests.length === before, 'a missing editor sends nothing');
      await ui.quit();
    },
  );
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  writeFileSync(
    join(here, 'history-capture.txt'),
    [
      'Plato CLI — run-state hint, history search and the external editor',
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
console.log(`capture: ${join(here, 'history-capture.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
