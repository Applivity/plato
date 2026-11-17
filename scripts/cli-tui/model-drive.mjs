/**
 * Drives the built CLI through the model pickers.
 *
 *   node scripts/cli-tui/model-drive.mjs [--cli path/to/cli.js]
 *
 * 1. `plato model` lists both connections, marks the current one, and switches.
 * 2. `/model` picks another model, changes the status line, sends nothing, and
 *    the next request carries that model.
 * 3. `/model add` suspends, runs the wizard, and the new provider is selectable.
 * 4. Esc closes the picker and changes nothing.
 * 5. A connection that cannot answer keeps its known models with a note.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'model-capture.txt');

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

const providerA = await startProvider({ model: 'model-a', context: 8192 });
const providerB = await startProvider({ model: 'model-b', context: 8192 });
const providerC = await startProvider({ model: 'model-c', context: 8192 });
const baseA = `http://127.0.0.1:${providerA.port}/v1`;
const baseB = `http://127.0.0.1:${providerB.port}/v1`;
const baseC = `http://127.0.0.1:${providerC.port}/v1`;

function freshEnv(config, cache) {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-model-'));
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
        ...config,
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
  if (cache !== undefined) {
    const at = Date.now();
    const entries = Object.fromEntries(
      Object.entries(cache).map(([id, models]) => [id, { at, pool: models.map((model) => ({ id: model })) }]),
    );
    writeFileSync(join(env.PLATO_DATA_DIR, 'models.json'), JSON.stringify(entries));
  }
  return { root, env };
}

function pty(env, cwd, argv = []) {
  const state = { output: '' };
  const inner = `stty cols 100; exec node ${[cli, ...argv].map(JSON.stringify).join(' ')}`;
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
  // Enter waits until the text is on screen. A fixed pause let the two writes
  // land in one read under load; Ink then saw a paste, kept the text and
  // swallowed the Enter, so the command never ran.
  state.line = async (text) => {
    if (text.length === 0) {
      state.send('\r');
      return;
    }
    const mark = state.output.length;
    state.send(text);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(text),
      5000,
      `the text '${text}' to be on screen`,
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

// One Enter: the exact name runs, so the picker opens at once. The Enter waits
// for the text to be drawn, for the reason given on `state.line`.
const openPicker = async (ui) => {
  const mark = ui.output.length;
  ui.send('/model');
  await waitFor(
    () => plain(ui.output.slice(mark)).includes('/model'),
    4000,
    'the /model text',
  );
  ui.send('\r');
};

function runOnce(env, argv, input = '') {
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
    child.stdin.end(input);
  });
}

const results = [];
const captures = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const configOf = (env) => JSON.parse(readFileSync(join(env.PLATO_CONFIG_DIR, 'config.json'), 'utf8'));
const lastUser = (body) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.filter((message) => message?.role === 'user').at(-1);
};

try {
  // 1. The shell command.
  {
    const { root, env } = freshEnv({
      connections: [
        { id: 'connA', kind: 'openai', baseUrl: baseA },
        { id: 'connB', kind: 'openai', baseUrl: baseB },
      ],
      model: 'connA:model-a',
    });
    const ui = pty(env, root, ['model']);
    try {
      await waitFor(() => plain(ui.output).includes('connA:model-a  (current)'), 8000, 'the marked current model');
      record(
        plain(ui.output).includes('connB:model-b'),
        'plato model lists both connections',
      );
      record(
        plain(ui.output).includes('connA:model-a  (current)'),
        'plato model marks the current model',
      );
      await ui.line('2');
      await waitFor(() => plain(ui.output).includes('Using connB:model-b.'), 5000, 'the switch');
      record(configOf(env).model === 'connB:model-b', 'choosing a number changes the config');
      const refusedNumber = await runOnce(env, ['model'], '9\n');
      record(
        refusedNumber.code === 2 &&
          plain(refusedNumber.output).includes("'9' was not one of the choices"),
        'a number out of range is refused with a sentence',
      );
      const refusedWord = await runOnce(env, ['model'], 'abc\n');
      record(
        refusedWord.code === 2 &&
          plain(refusedWord.output).includes("'abc' was not one of the choices"),
        'a word is refused the same way',
      );
      record(
        configOf(env).model === 'connB:model-b',
        'a refused answer changes nothing',
      );
    } catch (error) {
      record(false, `shell model command: ${error.message}`);
    } finally {
      captures.push({ name: 'plato model', output: ui.output });
      ui.kill();
    }
  }

  // 2-4. In a session: picker, add a provider, Esc.
  {
    const { root, env } = freshEnv({
      connections: [
        { id: 'connA', kind: 'openai', baseUrl: baseA },
        { id: 'connB', kind: 'openai', baseUrl: baseB },
      ],
      model: 'connA:model-a',
    });
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      // A partial name is still completed by Enter.
      await ui.line('/mod');
      record(
        await attempt(() =>
          waitFor(() => plain(ui.output).includes('› /mode '), 4000, 'the completed line'),
        ),
        'a partial name is completed, not run',
      );
      // That line is filled and waiting. Ctrl+W clears it; the next check is
      // the picker, and Enter on an empty argument now completes a choice.
      // Wait for the argument menu it opened to close, not for the clock.
      ui.send('\x17');
      await waitFor(
        () => !lastFrame(ui.output).includes('Enter runs an exact choice'),
        4000,
        'the cleared line',
      );
      await openPicker(ui);
      await waitFor(() => plain(ui.output).includes('Add a provider…'), 8000, 'the picker');
      record(plain(ui.output).includes('connA:model-a  (current)'), 'the picker marks the current model');
      const before = providerA.requests.length + providerB.requests.length;
      const beforeArrow = ui.output.length;
      ui.send('\x1b[B');
      // The picker marks the row it will choose; wait for the mark to move.
      await waitFor(
        () => plain(ui.output.slice(beforeArrow)).includes('❯ connB:model-b'),
        4000,
        'the selection on the second model',
      );
      ui.send('\r');
      await waitFor(() => plain(ui.output).includes('Model: connB:model-b.'), 5000, 'the new model');
      record(
        providerA.requests.length + providerB.requests.length === before,
        'choosing a model sends nothing',
      );
      await ui.line('hello there');
      await waitFor(() => providerB.requests.length > 0, 10000, 'the next request');
      const body = providerB.requests.at(-1);
      record(body?.model === 'model-b', 'the next request carries the chosen model');
      record(
        plain(ui.output).includes('connB:model-b'),
        'the status line shows the chosen model',
      );

      // 3. /model add: the setup screen runs inside the session.
      const beforeWizard = ui.output.length;
      await ui.line('/model add');
      const wizard = await attempt(() =>
        waitFor(
          () => plain(ui.output.slice(beforeWizard)).includes('Provider'),
          8000,
          'the setup screen',
        ),
      );
      record(wizard, '/model add opens the setup screen inside the session');
      if (wizard) {
        await ui.line('custom');
        await waitFor(() => plain(ui.output.slice(beforeWizard)).includes('Endpoint URL'), 5000, 'the URL');
        await ui.line(baseC);
        await waitFor(() => plain(ui.output.slice(beforeWizard)).includes('API key'), 5000, 'the key');
        await ui.line('');
        await waitFor(
          () => plain(ui.output.slice(beforeWizard)).includes('✓ key accepted · 1 model'),
          8000,
          'the model list',
        );
        await ui.line('');
        await waitFor(
          () => plain(ui.output.slice(beforeWizard)).includes('Saved. Using custom:model-c.'),
          8000,
          'the saved line',
        );
        const savedAt = ui.output.indexOf('Saved. Using custom:model-c.', beforeWizard);
        await waitFor(
          () => plain(ui.output.slice(savedAt)).includes('Plato · terminal'),
          8000,
          'the session to come back',
        );
        record(true, 'the session returns after setup');
        const beforeList = ui.output.length;
        await openPicker(ui);
        await waitFor(
          () => plain(ui.output.slice(beforeList)).includes('Add a provider…'),
          8000,
          'the picker after setup',
        );
        record(
          plain(ui.output.slice(beforeList)).includes('custom:model-c'),
          'the new connection is selectable without a restart',
        );
        // The picker starts on the current model, so Enter chooses it. No digit
        // is typed: a card does not echo one, and a wait needs something to see.
        await waitFor(
          () => plain(ui.output.slice(beforeList)).includes('❯ custom:model-c'),
          4000,
          'the current model marked',
        );
        ui.send('\r');
        await waitFor(() => plain(ui.output).includes('Model: custom:model-c.'), 5000, 'the new model chosen');
        record(true, 'the new model can be chosen');
      }

      // 4. Esc changes nothing.
      const beforePicker = ui.output.length;
      await openPicker(ui);
      // `Add a provider…` exists only in the model card. `Esc closes` is also
      // in the command menu that `/model` draws before Enter, so waiting for
      // it would return before the picker existed and the next key would be
      // lost in the composer.
      await waitFor(
        () => plain(ui.output.slice(beforePicker)).includes('Add a provider…'),
        8000,
        'the picker again',
      );
      const beforeRefusal = ui.output.length;
      ui.send('9');
      record(
        await attempt(() =>
          waitFor(
            () => plain(ui.output.slice(beforeRefusal)).includes("'9' is not a choice"),
            4000,
            'the out-of-range note',
          ),
        ),
        'the session says an out-of-range number is not a choice',
      );
      const beforeWord = ui.output.length;
      ui.send('abc');
      record(
        await attempt(() =>
          waitFor(
            () => plain(ui.output.slice(beforeWord)).includes("'abc' is not a choice"),
            4000,
            'the word note',
          ),
        ),
        'the session answers a word the same way',
      );
      record(
        plain(ui.output.slice(beforePicker)).includes('Add a provider…'),
        'the picker stays open after a refused answer',
      );
      const current = configOf(env).model;
      ui.send('\x1b');
      // The card is gone only when a frame without its rows is on screen.
      await waitFor(
        () => !lastFrame(ui.output).includes('Add a provider…'),
        4000,
        'the picker to close',
      );
      record(configOf(env).model === current, 'Esc closes the picker and changes nothing');
    } catch (error) {
      record(false, `session picker: ${error.message}`);
    } finally {
      captures.push({ name: 'session picker', output: ui.output });
      ui.kill();
    }
  }

  // 5. A connection that cannot answer keeps its known models.
  {
    const { root, env } = freshEnv(
      {
        connections: [
          { id: 'connA', kind: 'openai', baseUrl: baseA },
          { id: 'connDead', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1' },
        ],
        model: 'connA:model-a',
      },
      { connA: ['model-a'], connDead: ['model-dead'] },
    );
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await openPicker(ui);
      const shown = await attempt(() =>
        waitFor(() => plain(ui.output).includes('connDead:model-dead'), 8000, 'the known model'),
      );
      record(shown, 'an unreachable connection keeps its known models');
      record(
        plain(ui.output).includes('could not list its models just now'),
        'the picker says the endpoint did not answer',
      );
      ui.send('\x1b');
      await sleep(300);
    } catch (error) {
      record(false, `unreachable connection: ${error.message}`);
    } finally {
      captures.push({ name: 'unreachable connection', output: ui.output });
      ui.kill();
    }
  }
} catch (error) {
  record(false, error.message);
} finally {
  await providerA.close();
  await providerB.close();
  await providerC.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — model picker proof',
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
