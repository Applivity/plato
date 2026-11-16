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
  state.line = async (text) => {
    state.send(text);
    await sleep(150);
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

// The slash menu fills `/model ` in on the first Enter; the second runs it.
const openPicker = async (ui) => {
  ui.send('/model');
  await sleep(150);
  ui.send('\r');
  await sleep(300);
  ui.send('\r');
};

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
      await openPicker(ui);
      await waitFor(() => plain(ui.output).includes('Add a provider…'), 8000, 'the picker');
      record(plain(ui.output).includes('connA:model-a  (current)'), 'the picker marks the current model');
      const before = providerA.requests.length + providerB.requests.length;
      ui.send('\x1b[B');
      await sleep(150);
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

      // 3. /model add: the wizard runs inside the session.
      await ui.line('/model add');
      const wizard = await attempt(() =>
        waitFor(() => plain(ui.output).includes('Provider (number or name)'), 8000, 'the wizard'),
      );
      record(wizard, '/model add suspends into the setup wizard');
      if (wizard) {
        await ui.line('11');
        await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
        await ui.line(baseC);
        await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
        await ui.line('');
        await waitFor(() => plain(ui.output).includes('Model (number or id)'), 8000, 'the model');
        await ui.line('1');
        await waitFor(() => plain(ui.output).includes('Saved. Using custom:model-c.'), 8000, 'the saved line');
        await waitFor(
          () => plain(ui.output).includes('Provider setup finished'),
          8000,
          'the session to come back',
        );
        record(true, 'the session returns after setup');
        await openPicker(ui);
        await waitFor(() => plain(ui.output).includes('custom:model-c'), 8000, 'the new model in the picker');
        record(true, 'the new connection is selectable without a restart');
        await ui.line('3');
        await waitFor(() => plain(ui.output).includes('Model: custom:model-c.'), 5000, 'the new model chosen');
        record(true, 'the new model can be chosen');
      }

      // 4. Esc changes nothing.
      await openPicker(ui);
      await waitFor(() => plain(ui.output).includes('Esc closes'), 8000, 'the picker again');
      const current = configOf(env).model;
      ui.send('\x1b');
      await sleep(600);
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
