/**
 * Drives the built CLI through the argument lists under the composer.
 *
 *   node scripts/cli-tui/argument-drive.mjs [--cli path/to/cli.js]
 *
 * 1. `/model ` shows `add` with its line and the connection:model hint.
 * 2. `/mode ` lists plan/edit/auto; arrows move, Tab completes, Enter runs.
 * 3. A partial argument completes on Enter and runs only on the second one.
 * 4. An exact choice runs on the first Enter.
 * 5. A wrong argument closes the menu and reaches the command's own error.
 * 6. `/team ` lists its words, keeps the composer on screen, and Esc closes.
 * 7. `/compact ` says what it does, offers no list, and takes free text.
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
const capturePath = join(here, 'argument-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** The text of the newest frame Ink drew, so an old row cannot answer for it. */
function lastFrame(output) {
  const start = output.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(output);
  const end = output.lastIndexOf('\x1b[?2026l');
  return plain(output.slice(start, end > start ? end : undefined));
}

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

const provider = await startProvider({ model: 'menu-model', context: 8192 });
const base = `http://127.0.0.1:${provider.port}/v1`;

function freshSession() {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-argument-'));
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    PLATO_CONFIG_DIR: join(root, 'config'),
    PLATO_DATA_DIR: join(root, 'data'),
    PLATO_HOME: join(root, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
  for (const key of ['PLATO_CONFIG_DIR', 'PLATO_DATA_DIR', 'PLATO_HOME']) {
    mkdirSync(env[key], { recursive: true });
  }
  writeFileSync(
    join(env.PLATO_CONFIG_DIR, 'config.json'),
    `${JSON.stringify(
      {
        connections: [{ id: 'menu', kind: 'openai', baseUrl: base }],
        model: 'menu:menu-model',
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
  return { root, env };
}

function pty(env, cwd) {
  const state = { output: '' };
  const inner = `stty cols 100; exec node ${JSON.stringify(cli)}`;
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
  state.child = child;
  state.send = (text) => child.stdin.write(text);
  state.type = async (text, ms = 30) => {
    for (const ch of text) {
      state.send(ch);
      await sleep(ms);
    }
  };
  state.line = async (text) => {
    await state.type(text, 20);
    await sleep(120);
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

const results = [];
const captures = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

async function session(name, run) {
  const { root, env } = freshSession();
  const ui = pty(env, root);
  try {
    await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
    await run(ui);
  } catch (error) {
    record(false, `${name}: ${error.message}`);
  } finally {
    captures.push({ name, output: ui.output });
    ui.kill();
  }
}

try {
  // 1. `/model `: the one word, its line, and the ref hint.
  await session('model arguments', async (ui) => {
    await ui.type('/model ');
    await waitFor(() => plain(ui.output).includes('Set up another provider'), 5000, 'the add line');
    record(true, '/model shows add with its description');
    record(
      plain(ui.output).includes('a connection:model ref is also accepted'),
      'the model list says a connection:model ref is also accepted',
    );
    ui.send('\r');
    await waitFor(() => plain(ui.output).includes('› /model add'), 4000, 'the completed line');
    record(true, 'Enter on an empty argument completes the choice');
    record(
      !plain(ui.output).includes('Endpoint URL'),
      'a completed argument does not run the command',
    );
  });

  // 2. `/mode `: arrows move, Tab completes, Enter runs the exact choice.
  await session('mode arguments', async (ui) => {
    await ui.type('/mode ');
    await waitFor(() => plain(ui.output).includes('make no changes'), 5000, 'the mode lines');
    record(
      plain(ui.output).includes('Ask before each write or command') &&
        plain(ui.output).includes('Write and run without asking'),
      '/mode lists plan, edit and auto with one line each',
    );
    record(plain(ui.output).includes('› /mode'), 'the composer stays on screen under the list');
    ui.send('\x1b[B');
    await sleep(80);
    ui.send('\x1b[B');
    await sleep(150);
    ui.send('\t');
    await waitFor(() => plain(ui.output).includes('› /mode auto'), 4000, 'the tab completion');
    record(true, 'arrows move and Tab completes the highlighted word');
    const before = plain(ui.output).length;
    ui.send('\r');
    await waitFor(
      () => plain(ui.output.slice(before)).includes('Mode: auto.'),
      4000,
      'the mode notice',
    );
    record(true, 'Enter on an exact choice runs it');
  });

  // 3. A partial argument completes, then runs.
  await session('partial argument', async (ui) => {
    await ui.line('/mode p');
    await waitFor(() => plain(ui.output).includes('› /mode plan'), 4000, 'the completed plan');
    record(true, 'a partial argument is completed by Enter');
    record(!plain(ui.output).includes('Mode: plan.'), 'a partial argument does not run');
    ui.send('\r');
    await waitFor(() => plain(ui.output).includes('Mode: plan.'), 4000, 'the plan notice');
    record(true, 'the following Enter runs the completed choice');
  });

  // 4. An exact choice typed in full runs on the first Enter.
  await session('exact choice', async (ui) => {
    await ui.line('/gitignore on');
    await waitFor(
      () => plain(ui.output).includes('Search now skips .gitignore paths.'),
      4000,
      'the gitignore notice',
    );
    record(true, 'an exact choice typed in full runs on Enter');
  });

  // 5. A wrong argument is not hidden by the menu.
  await session('wrong argument', async (ui) => {
    await ui.line('/mode pink');
    await waitFor(
      () => plain(ui.output).includes('Usage: /mode plan|edit|auto'),
      4000,
      'the usage line',
    );
    record(true, 'a wrong argument reaches the command and gets its own error');
  });

  // 6. `/team `: three words, the composer, then Esc.
  await session('team arguments', async (ui) => {
    await ui.type('/team ');
    await waitFor(() => plain(ui.output).includes('The worker works alone'), 5000, 'the team lines');
    record(
      plain(ui.output).includes('One watcher reads the work and can advise') &&
        plain(ui.output).includes('A panel of watchers reads the work'),
      '/team lists solo, duo and academy with one line each',
    );
    record(plain(ui.output).includes('› /team'), 'the team list does not hide the composer');
    const before = plain(ui.output).length;
    ui.send('\x1b');
    await sleep(400);
    record(
      plain(ui.output.slice(before)).includes('› /team'),
      'Esc closes the list and leaves the line alone',
    );
  });

  // 7. `/compact `: a description and no list; free text reaches the command.
  await session('compact arguments', async (ui) => {
    await ui.type('/compact ');
    await waitFor(
      () => plain(ui.output).includes('Summarise the conversation; mid-run'),
      5000,
      'the compact line',
    );
    record(true, '/compact shows its one-line description after the space');
    record(
      await attempt(() =>
        waitFor(
          () => plain(ui.output).includes('Enter runs · Esc closes'),
          3000,
          'the free-text footer',
        ),
      ),
      '/compact offers no word list',
    );
    const before = plain(ui.output).length;
    await ui.type('keep the schemas');
    await waitFor(
      () => lastFrame(ui.output).includes('› /compact keep the schemas'),
      4000,
      'the free text in the composer',
    );
    record(
      !lastFrame(ui.output).includes('Summarise the conversation; mid-run'),
      'typing free text closes the description',
    );
    ui.send('\r');
    const answered = await attempt(() =>
      waitFor(
        () =>
          /nothing to compact yet|Summary added for/.test(plain(ui.output.slice(before))),
        5000,
        'the compact answer',
      ),
    );
    record(answered, 'free text reaches /compact and it answers');
  });
} catch (error) {
  record(false, error.message);
} finally {
  await provider.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — argument list proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...captures.flatMap((capture) => [`--- ${capture.name} ---`, capture.output, '']),
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
