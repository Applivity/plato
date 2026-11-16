/**
 * Drives the built CLI through the setup wizard in a real terminal.
 *
 *   node scripts/cli-tui/setup-drive.mjs [--cli path/to/cli.js]
 *
 * 1. Empty config, bare `plato`: the offer, the wizard, a working session.
 * 2. The same offer answered No: exit, one command named.
 * 3. The one-command path with a piped key, then `plato config`.
 * 4. A custom endpoint that omits its window asks once; one that advertises
 *    does not ask.
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

const results = [];
const notes = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

/** A fresh home/config for one scenario. */
function freshEnv() {
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
  return { root, env };
}

/** Runs the CLI under a PTY and collects everything it writes. */
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

const configOf = (env) => JSON.parse(readFileSync(join(env.PLATO_CONFIG_DIR, 'config.json'), 'utf8'));

const providerA = await startProvider({ context: 8192 });
const providerB = await startProvider({});
const baseA = `http://127.0.0.1:${providerA.port}/v1`;
const baseB = `http://127.0.0.1:${providerB.port}/v1`;
const sessions = [];
const captures = [];

try {
  // 1. Empty config: the offer, the wizard, a session that talks to the model.
  {
    const { root, env } = freshEnv();
    const ui = pty(env, root);
    sessions.push(ui);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the first-run offer');
      record(true, 'an empty config offers setup once');
      await ui.line('y');
      await waitFor(() => plain(ui.output).includes('Provider (number or name)'), 5000, 'the provider picker');
      await ui.line('11');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL question');
      await ui.line(baseA);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key question');
      await ui.line('sk-local-test');
      await waitFor(() => plain(ui.output).includes('Model (number or id)'), 8000, 'the model list');
      record(
        plain(ui.output).includes('paste-model'),
        'the model list comes from the endpoint',
      );
      await ui.line('1');
      await waitFor(() => plain(ui.output).includes('Saved. Using custom:paste-model.'), 5000, 'the saved line');
      record(true, 'one flow saves the connection and the model');
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      record(true, 'the session starts without another command');
      await ui.line('hello there');
      await waitFor(() => providerA.requests.length > 0, 10000, 'the first request');
      const body = providerA.requests.at(-1);
      const user = (body?.messages ?? []).filter((message) => message?.role === 'user').at(-1);
      record(
        typeof user?.content === 'string' && user.content.includes('hello there'),
        'the provider receives the first request',
      );
      const saved = configOf(env);
      record(
        saved.model === 'custom:paste-model' &&
          saved.connections[0]?.baseUrl === baseA,
        'the config holds the connection and the model',
      );
    } catch (error) {
      record(false, `first run: ${error.message}`);
    } finally {
      captures.push({ name: 'first run', output: ui.output });
      ui.kill();
    }
  }

  // 2. The offer answered No: exit, and name one command.
  {
    const { root, env } = freshEnv();
    const ui = pty(env, root);
    sessions.push(ui);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('n');
      await waitFor(() => plain(ui.output).includes("Run 'plato auth login'"), 5000, 'the command');
      record(!plain(ui.output).includes('Type / for commands'), 'No exits without starting a session');
      record(true, 'No names the one command');
    } catch (error) {
      record(false, `offer answered No: ${error.message}`);
    } finally {
      captures.push({ name: 'offer answered No', output: ui.output });
      ui.kill();
    }
  }

  // 3. One command, a piped key, then `plato config`.
  {
    const { root, env } = freshEnv();
    const login = await runOnce(
      env,
      [
        'auth',
        'login',
        'mine',
        '--kind',
        'openai',
        '--base-url',
        baseB,
        '--key-stdin',
        '--model',
        'paste-model',
      ],
      'sk-piped-key\n',
    );
    record(
      login.code === 0 && plain(login.output).includes('Saved. Using mine:paste-model.'),
      'one command saves the connection, the key and the model',
    );
    const saved = configOf(env);
    record(
      saved.connections[0]?.id === 'mine' && saved.model === 'mine:paste-model',
      'the one command writes the connection and the model',
    );
    const listed = await runOnce(env, ['config']);
    const listing = plain(listed.output);
    record(
      listing.includes('mine  openai') && listing.includes(baseB) && listing.includes('key: file'),
      'plato config lists the connection and where its key comes from',
    );
    record(!listing.includes('sk-piped-key'), 'plato config never prints the key');
  }

  // 4. A custom endpoint asks for a window only when it did not advertise one.
  {
    const { root, env } = freshEnv();
    const ui = pty(env, root);
    sessions.push(ui);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('y');
      await waitFor(() => plain(ui.output).includes('Provider (number or name)'), 5000, 'the picker');
      await ui.line('11');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
      await ui.line(baseB);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Model (number or id)'), 8000, 'the model');
      await ui.line('1');
      await waitFor(() => plain(ui.output).includes('Context length in tokens'), 5000, 'the context question');
      record(true, 'an endpoint with no window is asked once');
      await ui.line('4096');
      await waitFor(() => plain(ui.output).includes('Saved. Using custom:paste-model.'), 5000, 'the saved line');
      record(configOf(env).connections[0]?.contextWindow === 4096, 'the answer is saved on the connection');
    } catch (error) {
      record(false, `custom endpoint, no window: ${error.message}`);
    } finally {
      captures.push({ name: 'custom endpoint, no window', output: ui.output });
      ui.kill();
    }
  }
  {
    const { root, env } = freshEnv();
    const ui = pty(env, root);
    sessions.push(ui);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('y');
      await waitFor(() => plain(ui.output).includes('Provider (number or name)'), 5000, 'the picker');
      await ui.line('11');
      await waitFor(() => plain(ui.output).includes('Endpoint URL'), 5000, 'the URL');
      await ui.line(baseA);
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Model (number or id)'), 8000, 'the model');
      await ui.line('1');
      await waitFor(() => plain(ui.output).includes('Saved. Using custom:paste-model.'), 5000, 'the saved line');
      record(
        !plain(ui.output).includes('Context length in tokens'),
        'an advertised window is not asked again',
      );
      record(configOf(env).connections[0]?.contextWindow === undefined, 'no window is invented');
    } catch (error) {
      record(false, `custom endpoint, advertised window: ${error.message}`);
    } finally {
      captures.push({ name: 'custom endpoint, advertised window', output: ui.output });
      ui.kill();
    }
  }
  // 5. The one-command flags under a real terminal: no questions at all.
  {
    const { root, env } = freshEnv();
    const provider = await startProvider({});
    const base = `http://127.0.0.1:${provider.port}/v1`;
    const ui = pty(env, root, [
      'auth',
      'login',
      'zed',
      '--kind',
      'openai',
      '--base-url',
      base,
      '--key-stdin',
      '--model',
      'paste-model',
    ]);
    sessions.push(ui);
    try {
      await sleep(400);
      ui.send('sk-tty-key\n');
      await waitFor(
        () => plain(ui.output).includes('Saved. Using zed:paste-model.'),
        8000,
        'the saved line under a terminal',
      );
      record(!plain(ui.output).includes('Base URL:'), 'a terminal does not turn flags into questions');
      const saved = configOf(env);
      record(
        saved.connections[0]?.id === 'zed' &&
          saved.connections[0]?.baseUrl === base &&
          saved.model === 'zed:paste-model',
        'the one command under a terminal saves the connection and the model',
      );
    } catch (error) {
      record(false, `one command under a terminal: ${error.message}`);
    } finally {
      captures.push({ name: 'one command under a terminal', output: ui.output });
      ui.kill();
    }
    await provider.close();
  }

  // 6. A named provider is the wizard with the provider chosen: key, model,
  // save; and a second run offers Keep without losing the working key.
  {
    const { root, env } = freshEnv();
    const provider = await startProvider({ port: 8000, context: 8192 });
    const ui = pty(env, root, ['auth', 'login', 'vllm']);
    sessions.push(ui);
    try {
      await waitFor(() => plain(ui.output).includes('API key'), 8000, 'the key question');
      await ui.line('sk-vllm');
      await waitFor(() => plain(ui.output).includes('Model (number or id)'), 8000, 'the model list');
      await ui.line('1');
      await waitFor(
        () => plain(ui.output).includes('Saved. Using vllm:paste-model.'),
        8000,
        'the saved line',
      );
      record(
        !plain(ui.output).includes('Custom endpoint') && !plain(ui.output).includes('Anthropic'),
        'a named provider skips the picker',
      );
      const saved = configOf(env);
      record(
        saved.model === 'vllm:paste-model' &&
          saved.connections[0]?.baseUrl === 'http://localhost:8000/v1',
        'the preset URL is used and the model is saved',
      );
    } catch (error) {
      record(false, `named provider: ${error.message}`);
    } finally {
      captures.push({ name: 'named provider', output: ui.output });
      ui.kill();
    }

    const again = pty(env, root, ['auth', 'login', 'vllm']);
    sessions.push(again);
    try {
      await waitFor(
        () => plain(again.output).includes('A key is saved for vllm: sk-v'),
        8000,
        'the existing key',
      );
      await waitFor(
        () => plain(again.output).includes('Keep, replace or clear'),
        5000,
        'the keep question',
      );
      await again.line('k');
      await waitFor(() => plain(again.output).includes('Model (number or id)'), 8000, 'the model list');
      await again.line('1');
      await waitFor(
        () => plain(again.output).includes('Saved. Using vllm:paste-model.'),
        8000,
        'the saved line',
      );
      const stored = JSON.parse(readFileSync(join(env.PLATO_DATA_DIR, 'auth.json'), 'utf8'));
      record(stored.keys['vllm'] === 'sk-vllm', 'Keep does not lose the working key');
    } catch (error) {
      record(false, `keep an existing key: ${error.message}`);
    } finally {
      captures.push({ name: 'named provider, existing key', output: again.output });
      again.kill();
    }
    await provider.close();
  }
} catch (error) {
  record(false, error.message);
} finally {
  for (const ui of sessions) {
    ui.kill();
  }
  await providerA.close();
  await providerB.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — setup wizard proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      ...captures.flatMap((capture) => [
        `--- ${capture.name} ---`,
        capture.output,
        '',
      ]),
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
for (const line of notes) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
