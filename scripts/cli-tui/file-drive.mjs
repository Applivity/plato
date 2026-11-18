/**
 * Drives the built CLI through `@` file completion.
 *
 *   node scripts/cli-tui/file-drive.mjs [--cli path/to/cli.js]
 *
 * One workspace with source files, an ignored folder, node_modules, .git and
 * sixty files for the cap:
 *  - the idle hint, the list, filtering, a folder kept open with `/`, a file
 *    completed, and nothing sent;
 *  - Enter on a folder appends `/` and keeps its contents listed;
 *  - an email opens nothing, and the list says when it is capped.
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
const IDLE_HINT =
  'Shift+Tab mode (plan · edit · auto) · @ files · /help · Alt+Enter newline';

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
const linesOf = (text) => text.split('\n').map((line) => line.replace(/\r$/, ''));
const lastLine = (output, prefix) =>
  linesOf(lastFrame(output)).filter((line) => line.startsWith(prefix)).at(-1) ?? '';
const lastComposer = (output) => lastLine(output, '› ');
const selectedChoice = (output) =>
  linesOf(lastFrame(output)).filter((line) => line.startsWith('❯ ')).at(-1) ?? '';
const menuOpen = (output) => lastFrame(output).includes('Enter inserts');

const provider = await startProvider({ context: 131_072 });
const root = mkdtempSync(join(tmpdir(), 'plato-cli-files-'));
const config = join(root, 'config');
const data = join(root, 'data');
const home = join(root, 'home');
const project = join(root, 'project');
for (const dir of [config, data, home, project]) mkdirSync(dir, { recursive: true });
const files = {
  'docs/readme.md': '# docs',
  'src/team.ts': 'team',
  'src/tui/App.tsx': 'app',
  'src/tui/menu.ts': 'menu',
  'ignored/hidden.txt': 'hidden',
  'node_modules/pkg/index.js': 'pkg',
  '.git/config': '[core]',
  '.gitignore': 'ignored/\n',
  '.env': 'SECRET=1\n',
};
for (const [path, body] of Object.entries(files)) {
  mkdirSync(join(project, path, '..'), { recursive: true });
  writeFileSync(join(project, path), body);
}
for (let index = 0; index < 60; index += 1) {
  const name = `many/file-${String(index).padStart(2, '0')}.txt`;
  mkdirSync(join(project, name, '..'), { recursive: true });
  writeFileSync(join(project, name), 'x');
}
writeFileSync(
  join(config, 'config.json'),
  `${JSON.stringify(
    {
      connections: [
        { id: 'fake', kind: 'openai', baseUrl: `http://127.0.0.1:${provider.port}/v1` },
      ],
      model: 'fake:file-model',
      team: 'solo',
      mode: 'edit',
      reasoning: 'off',
      compactionThreshold: 0.8,
      respectGitignore: true,
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

function pty(cols = 100) {
  const state = { output: '', exited: false };
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
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
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

async function session(name, run) {
  const ui = pty();
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
  // 1. The list, its filter, a folder, a file, and nothing sent.
  await session('list', async (ui) => {
    await waitFor(() => lastFrame(ui.output).includes(IDLE_HINT), 8000, 'the idle hint');
    record(true, 'the idle hint names @ files');
    record(lastFrame(ui.output).includes('@ files'), 'the hint says @ files');

    ui.send('@');
    await waitFor(() => menuOpen(ui.output), 5000, 'the file list');
    record(lastComposer(ui.output).includes('@'), 'the list does not hide the composer');
    record(
      lastFrame(ui.output).includes('docs/') && lastFrame(ui.output).includes('src/'),
      'the workspace folders are listed',
    );
    record(
      !lastFrame(ui.output).includes('node_modules') &&
        !lastFrame(ui.output).includes('ignored/') &&
        !lastFrame(ui.output).includes('.git/'),
      'ignored folders, .git and node_modules are skipped',
    );
    record(
      !lastFrame(ui.output).includes('.env'),
      'a protected file is never offered',
    );

    const first = selectedChoice(ui.output);
    ui.send('\x1b[B');
    await waitFor(
      () => selectedChoice(ui.output).length > 0 && selectedChoice(ui.output) !== first,
      5000,
      'the selection to move down',
    );
    record(true, 'Down moves the selection');
    ui.send('\x1b[A');
    await waitFor(() => selectedChoice(ui.output) === first, 5000, 'the selection to move back');
    record(true, 'Up moves it back');

    ui.send('src');
    await waitFor(() => !lastFrame(ui.output).includes('docs/'), 5000, 'the filtered list');
    record(lastFrame(ui.output).includes('src/'), 'typing after @ filters the list');

    ui.send('/tu');
    await waitFor(() => lastFrame(ui.output).includes('src/tui/'), 5000, 'the folder match');
    record(
      !lastFrame(ui.output).includes('src/team.ts'),
      'the filter narrows to the one folder',
    );

    ui.send('\t');
    await waitFor(() => lastComposer(ui.output).includes('@src/tui/'), 5000, 'the folder fill');
    record(menuOpen(ui.output), 'a folder keeps its slash and the list open');
    record(lastFrame(ui.output).includes('App.tsx'), 'the open folder lists its files');

    ui.send('\t');
    await waitFor(() => lastComposer(ui.output).includes('@src/tui/App.tsx'), 5000, 'the file fill');
    await waitFor(() => !menuOpen(ui.output), 5000, 'the list to close on a file');
    record(true, 'Tab completes a file and closes the list');
    await sleep(600);
    record(provider.requests.length === 0, 'completing a file sends nothing');
    record(!lastFrame(ui.output).includes('working…'), 'completing a file starts no run');
  });

  // 2. Enter on a folder inserts it and keeps its contents listed.
  await session('folder', async (ui) => {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    ui.send('@docs');
    await waitFor(() => menuOpen(ui.output) && lastFrame(ui.output).includes('docs/'), 5000, 'the docs folder');
    ui.send('\r');
    await waitFor(() => lastComposer(ui.output).includes('@docs/'), 5000, 'the folder in the composer');
    await waitFor(() => lastFrame(ui.output).includes('readme.md'), 5000, 'the folder contents');
    record(true, 'Enter on a folder appends / and keeps the list open');
    ui.send('\x1b');
    await waitFor(() => !menuOpen(ui.output), 5000, 'the closed list');
    record(lastComposer(ui.output).includes('@docs/'), 'Esc closes the list and leaves the line');

    // Enter on a file inserts its path and never sends the line.
    ui.send('read');
    await waitFor(() => menuOpen(ui.output) && lastFrame(ui.output).includes('readme.md'), 5000, 'the file match');
    ui.send('\r');
    await waitFor(
      () => lastComposer(ui.output).includes('@docs/readme.md'),
      5000,
      'the file in the composer',
    );
    await waitFor(() => !menuOpen(ui.output), 5000, 'the closed list');
    record(true, 'Enter inserts a file path and closes the list');
    await sleep(500);
    record(provider.requests.length === 0, 'the folder and file choices send nothing');
  });

  // 3. An email opens nothing; the cap says it is capped.
  await session('email and cap', async (ui) => {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    ui.send('user@host');
    await sleep(500);
    record(!menuOpen(ui.output), 'an email does not open the file list');
    for (let index = 0; index < 'user@host'.length; index += 1) {
      ui.send('\x7f');
      await sleep(30);
    }
    await waitFor(() => !lastFrame(ui.output).includes('user@host'), 5000, 'the cleared line');

    ui.send('@many/');
    await waitFor(() => menuOpen(ui.output), 5000, 'the capped list');
    record(lastFrame(ui.output).includes('first 50 of 60'), 'the capped list says how many match');
    record(lastComposer(ui.output).includes('@many/'), 'the capped list does not hide the composer');
    await sleep(500);
    record(provider.requests.length === 0, 'the cap run sends nothing');
  });
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  writeFileSync(
    join(here, 'file-capture.txt'),
    [
      'Plato CLI — @ file completion',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...captures.map((capture) => `===== ${capture.name} =====\n${capture.output}`),
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
console.log(`capture: ${join(here, 'file-capture.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
