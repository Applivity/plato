/**
 * Drives the built CLI through the context-window questions.
 *
 *   node scripts/cli-tui/window-drive.mjs [--cli path/to/cli.js]
 *
 * 1. A DeepSeek-shaped endpoint advertises `context_window`: `plato models`
 *    prints the real 1,048,576 and not `ctx unknown`.
 * 2. The same, in a session behind a cache entry that has no window: the cache
 *    is stale, the session refetches, and the status line is not 131k.
 * 3. An endpoint that advertises nothing: the status line says `~131k`, never
 *    the bare number.
 * 4. A provider that is not Custom but advertises nothing still gets the
 *    context question, and the answer is shown as a known number.
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
const capturePath = join(here, 'window-capture.txt');

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

const deepseek = await startProvider({
  model: 'deepseek-chat',
  context: 1_048_576,
  windowField: 'context_window',
});
// LM Studio's preset address is http://localhost:1234/v1. The endpoint here
// advertises no window, which is the case the question exists for.
const local = await startProvider({ port: 1234, model: 'lm-model' });
const quiet = await startProvider({ model: 'quiet-model' });
const baseDeepseek = `http://127.0.0.1:${deepseek.port}/v1`;
const baseQuiet = `http://127.0.0.1:${quiet.port}/v1`;

function freshEnv(config, cache) {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-window-'));
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
  if (cache !== undefined) {
    writeFileSync(join(env.PLATO_DATA_DIR, 'models.json'), JSON.stringify(cache));
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
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

try {
  // 1. `plato models` reads DeepSeek's own field.
  {
    const { env } = freshEnv({
      connections: [
        { id: 'deepseek', kind: 'openai', baseUrl: baseDeepseek },
      ],
      model: 'deepseek:deepseek-chat',
    });
    const answer = await runOnce(env, ['models']);
    const text = plain(answer.output);
    record(
      text.includes('ctx 1,048,576'),
      'plato models prints the advertised 1,048,576',
    );
    record(!text.includes('ctx unknown'), 'the window is not unknown');
  }

  // 2. A fresh cache entry with no window is stale: the session asks again.
  {
    const { root, env } = freshEnv(
      {
        connections: [{ id: 'deepseek', kind: 'openai', baseUrl: baseDeepseek }],
        model: 'deepseek:deepseek-chat',
      },
      {
        deepseek: {
          at: Date.now(),
          baseUrl: baseDeepseek,
          pool: [{ id: 'deepseek-chat' }],
        },
      },
    );
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await waitFor(() => plain(ui.output).includes('0 of 1049k'), 8000, 'the advertised window');
      record(true, 'a cached entry with no window is refetched and the real window shows');
      record(!plain(ui.output).includes('0 of ~131k'), 'the fallback is not shown as the window');
      const cached = JSON.parse(readFileSync(join(env.PLATO_DATA_DIR, 'models.json'), 'utf8'));
      record(
        cached.deepseek?.pool?.[0]?.maxContext === 1_048_576,
        'the refreshed cache holds the real window',
      );
    } catch (error) {
      record(false, `deepseek session: ${error.message}`);
    } finally {
      captures.push({ name: 'deepseek window', output: ui.output });
      ui.kill();
    }
  }

  // 3. No advertised window: the number is marked as the fallback.
  {
    const { root, env } = freshEnv({
      connections: [{ id: 'quiet', kind: 'openai', baseUrl: baseQuiet }],
      model: 'quiet:quiet-model',
    });
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      await waitFor(() => plain(ui.output).includes('0 of ~131k'), 8000, 'the approximate window');
      record(true, 'a fallback window is shown as approximate');
      record(!plain(ui.output).includes('0 of 131k'), 'the fallback never reads as a fact');
    } catch (error) {
      record(false, `fallback session: ${error.message}`);
    } finally {
      captures.push({ name: 'fallback window', output: ui.output });
      ui.kill();
    }
  }

  // 4. A preset that advertises nothing is asked the context question.
  {
    const { root, env } = freshEnv(undefined);
    const ui = pty(env, root);
    try {
      await waitFor(() => plain(ui.output).includes('Set one up now?'), 8000, 'the offer');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('Provider'), 5000, 'the picker');
      await ui.line('lmstudio');
      await waitFor(() => plain(ui.output).includes('API key'), 5000, 'the key');
      await ui.line('');
      await waitFor(() => plain(ui.output).includes('lm-model'), 8000, 'the model list');
      record(true, 'LM Studio lists its model');
      await ui.line('');
      await waitFor(
        () => plain(ui.output).includes('Context length in tokens'),
        5000,
        'the context question',
      );
      record(true, 'a non-custom provider with no window is asked for the context length');
      await ui.line('4096');
      await waitFor(() => plain(ui.output).includes('Saved. Using lmstudio:lm-model.'), 8000, 'the save');
      await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
      record(true, 'the chosen window is saved without starting a session early');
      await waitFor(() => plain(ui.output).includes('0 of 4.1k'), 8000, 'the chosen window');
      record(true, 'the status line shows the chosen window as a known number');
      record(!plain(ui.output).includes('0 of ~4.1k'), 'a chosen window is not marked approximate');
    } catch (error) {
      record(false, `lm studio setup: ${error.message}`);
    } finally {
      captures.push({ name: 'lm studio setup', output: ui.output });
      ui.kill();
    }
  }
} catch (error) {
  record(false, error.message);
} finally {
  await deepseek.close();
  await local.close();
  await quiet.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — context window proof',
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
