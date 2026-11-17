/**
 * Drives the built CLI through the Ink setup screen.
 *
 *   node scripts/cli-tui/setup-drive.mjs [--cli path/to/cli.js]
 *
 * 1. A 401 endpoint: the key is rejected, Replace is offered, nothing is saved.
 * 2. The fake endpoint: the flow, the session, and the first request.
 * 3. `/model add`: no session frame during setup, the banner back after.
 * 4. Esc at each step, arrows on the model list, idle redraws at zero.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'setup-capture.txt');

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

const bad = await startProvider({ modelsStatus: 401 });
const good = await startProvider({ models: ['m-one', 'm-two'], context: undefined });
const add = await startProvider({ model: 'model-c', context: 8192 });
const baseBad = `http://127.0.0.1:${bad.port}/v1`;
const baseGood = `http://127.0.0.1:${good.port}/v1`;
const baseAdd = `http://127.0.0.1:${add.port}/v1`;

function freshEnv(config) {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-setup-'));
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
  if (config !== undefined) {
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
    if (text.length > 0) state.send(text);
    await sleep(140);
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
const configOf = (env) => JSON.parse(readFileSync(join(env.PLATO_CONFIG_DIR, 'config.json'), 'utf8'));
const hasConfig = (env) => existsSync(join(env.PLATO_CONFIG_DIR, 'config.json'));

try {
  // 1. A rejected key: named, Replace offered, nothing saved; Esc backs out.
  {
    const { root, env } = freshEnv(undefined);
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Provider'), 5000, 'the picker');
      await ui.line('custom');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
      await ui.line(baseBad);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('sk-rejected');
      await waitFor(() => plain(ui.output).includes('The key was rejected.'), 8000, 'the rejection');
      record(true, 'a rejected key is named');
      record(plain(ui.output).includes('Replace the key'), 'Replace is offered');
      ui.send('\x1b');
      await waitFor(() => plain(ui.output).includes('API key'), 4000, 'the key step again');
      ui.send('\x1b');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 4000, 'the URL step');
      ui.send('\x1b');
      await waitFor(() => plain(ui.output).includes('Provider'), 4000, 'the provider list');
      ui.send('\x1b');
      await sleep(800);
      record(!hasConfig(env), 'nothing is saved after a rejected key');
      record(!plain(ui.output).includes('Saved.'), 'no success is claimed');
      record(!plain(ui.output).includes('Type / for commands'), 'the session does not start');
      record(true, 'Esc backs out of each step');
    } catch (error) {
      record(false, `rejected key: ${error.message}`);
    } finally {
      captures.push({ name: 'rejected key', output: ui.output });
      ui.kill();
    }
  }

  // 2-4. A working setup, then the session and its first request.
  {
    const { root, env } = freshEnv(undefined);
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Provider'), 5000, 'the picker');
      // Arrows move in the list before typing filters it.
      ui.send('\x1b[B');
      await sleep(100);
      ui.send('\x1b[A');
      await sleep(100);
      await ui.line('custom');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
      await ui.line(baseGood);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('sk-good');
      await waitFor(
        () => plain(ui.output).includes('✓ key accepted · 2 models'),
        8000,
        'the model list',
      );
      record(true, 'a good key is validated and the models are listed');
      ui.send('\x1b');
      await waitFor(() => plain(ui.output).includes('API key'), 4000, 'the key step');
      record(true, 'Esc goes back from the model list');
      const revalidated = ui.output.length;
      await ui.line('');
      await waitFor(
        () => plain(ui.output.slice(revalidated)).includes('Type a model id…'),
        8000,
        'the list again',
      );
      // Arrows choose the second model, no number typed.
      ui.send('\x1b[B');
      await sleep(250);
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Context length in tokens'), 5000, 'the context');
      await ui.line('4096');
      await waitFor(() => plain(ui.output).includes('Saved. Using custom:m-two.'), 8000, 'the saved line');
      record(true, 'arrows choose a model and setup saves it');
      const saved = configOf(env);
      record(
        saved.model === 'custom:m-two' && saved.connections[0]?.contextWindow === 4096,
        'the config holds the model and the chosen window',
      );
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await ui.line('hello there');
      await waitFor(() => good.requests.length > 0, 10000, 'the first request');
      const body = good.requests.at(-1);
      const user = (body?.messages ?? []).filter((message) => message?.role === 'user').at(-1);
      record(
        body?.model === 'm-two' &&
          typeof user?.content === 'string' &&
          user.content.includes('hello there'),
        'the first request succeeds with the chosen model',
      );
    } catch (error) {
      record(false, `working setup: ${error.message}`);
    } finally {
      captures.push({ name: 'working setup', output: ui.output });
      ui.kill();
    }
  }

  // 3. /model add: no session frame during setup, the banner back after.
  {
    const { root, env } = freshEnv({
      connections: [{ id: 'connA', kind: 'openai', baseUrl: baseGood }],
      model: 'connA:m-one',
    });
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await ui.line('/model add');
      await waitFor(() => plain(ui.output).includes('Provider'), 8000, 'the setup screen');
      const during = ui.output.length;
      await ui.line('custom');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
      await ui.line(baseAdd);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Model'), 8000, 'the models');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Saved. Using custom:model-c.'), 8000, 'the saved line');
      const savedAt = ui.output.indexOf('Saved. Using custom:model-c.', during);
      const setupSegment = plain(ui.output.slice(during, savedAt));
      record(
        !setupSegment.includes('Plato · terminal'),
        'no session frame is drawn during setup',
      );
      await waitFor(
        () => plain(ui.output).includes('Provider setup finished'),
        8000,
        'the session to return',
      );
      const back = plain(ui.output.slice(savedAt));
      record(back.includes('Plato · terminal'), 'the session banner is back once');
      record(!back.includes('Type / for commands'), 'the banner is not the start screen again');
      await sleep(700);
      const idle = ui.output.length;
      await sleep(1200);
      record(ui.output.length === idle, 'an idle session draws nothing');
      await ui.line('/model');
      await waitFor(() => plain(ui.output).includes('custom:model-c'), 8000, 'the new model');
      record(true, 'the new connection is selectable without a restart');
      ui.send('\x1b');
      await sleep(300);
    } catch (error) {
      record(false, `model add: ${error.message}`);
    } finally {
      captures.push({ name: 'model add', output: ui.output });
      ui.kill();
    }
  }
} catch (error) {
  record(false, error.message);
} finally {
  await bad.close();
  await good.close();
  await add.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — setup screen proof',
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
