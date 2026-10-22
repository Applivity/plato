#!/usr/bin/env node
/**
 * Scripted end-to-end runs against the BUILT file, not the source. The unit
 * tests prove the host; this proves the bundle a user installs.
 *
 * Each case starts a local OpenAI-compatible stub, writes a temporary config,
 * runs the CLI with a temporary PLATO_HOME, and asserts on stdout, stderr, the
 * exit code, and the files the run produced.
 *
 *   node scripts/e2e.mjs            run every case
 *   node scripts/e2e.mjs one-shot   run one case
 *
 * This file is not shipped in the tarball.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function temp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args, env, cwd, input = '') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

/** Starts the stub and hands back its base URL; the caller closes it. */
async function startStub(handle) {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => handle(request, response, body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

function json(response, payload) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function sse(response, chunks) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write('data: [DONE]\n\n');
  response.end();
}

function configFor(baseUrl) {
  return {
    connections: [{ id: 'stub', kind: 'openai', baseUrl }],
    model: 'stub:test',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
  };
}

function prepare(baseUrl, overrides = {}) {
  const home = temp('plato-e2e-');
  const workspace = temp('plato-e2e-work-');
  const configDir = join(home, 'config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({ ...configFor(baseUrl), ...overrides }),
  );
  const env = {
    ...process.env,
    PLATO_CONFIG_DIR: configDir,
    PLATO_DATA_DIR: join(home, 'data'),
    PLATO_HOME: join(home, 'home'),
    PLATO_DISABLE_KEYRING: '1',
    PLATO_KEY_STUB: 'sk-e2e',
  };
  return { home, workspace, env };
}

function cleanup(paths) {
  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }
}

const CASES = {
  async 'one-shot'() {
    const { server, baseUrl } = await startStub((request, response) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      if (request.method === 'POST' && request.url.endsWith('/chat/completions')) {
        sse(response, [
          { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
          {
            choices: [{ delta: { content: ' from the stub.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 9, completion_tokens: 4 },
          },
        ]);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const { home, workspace, env } = prepare(baseUrl);
    try {
      const result = await runCli(['-p', 'say hi', '--mode', 'auto'], env, workspace);
      assert(result.code === 0, `exit ${result.code}: ${result.err}`);
      assert(
        result.out === 'Hello from the stub.\n',
        `stdout was ${JSON.stringify(result.out)}`,
      );
      assert(result.err.includes('1 turn'), `stderr was ${JSON.stringify(result.err)}`);
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },

  async resume() {
    const bodies = [];
    const { server, baseUrl } = await startStub((request, response, body) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      if (request.method === 'POST' && request.url.endsWith('/chat/completions')) {
        bodies.push(body);
        sse(response, [
          { choices: [{ delta: { content: 'Hello.' }, finish_reason: 'stop' }] },
        ]);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const { home, workspace, env } = prepare(baseUrl);
    try {
      const first = await runCli(['-p', 'first task', '--mode', 'auto'], env, workspace);
      assert(first.code === 0, `first exit ${first.code}: ${first.err}`);
      const second = await runCli(['-p', '-c', 'second task', '--mode', 'auto'], env, workspace);
      assert(second.code === 0, `second exit ${second.code}: ${second.err}`);

      assert(bodies.length === 2, `expected 2 provider calls, saw ${bodies.length}`);
      assert(bodies[1].includes('first task'), 'the resumed run lost the first task');
      assert(bodies[1].includes('second task'), 'the resumed run lost the new task');

      const list = await runCli(['sessions', 'list'], env, workspace);
      assert(list.code === 0, `list exit ${list.code}`);
      assert(list.out.includes('first task'), `list was ${JSON.stringify(list.out)}`);

      const exported = await runCli(['sessions', 'export'], env, workspace);
      const session = JSON.parse(exported.out);
      assert(session.history.length === 4, `history was ${JSON.stringify(session.history)}`);
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },

  async duo() {
    let workerTurns = 0;
    const { server, baseUrl } = await startStub((request, response, body) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
        response.writeHead(404);
        response.end();
        return;
      }
      const payload = JSON.parse(body);
      const isObserver = !Array.isArray(payload.tools) || payload.tools.length === 0;
      if (isObserver) {
        json(response, {
          choices: [
            {
              message: {
                content: '{"action":"guidance","message":"check the nulls"}',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        });
        return;
      }
      workerTurns += 1;
      if (workerTurns === 1) {
        sse(response, [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: {
                        name: 'read_file',
                        arguments: JSON.stringify({ path: 'a.txt' }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
        return;
      }
      // Give the observer's check time to land before the run ends.
      setTimeout(() => {
        sse(response, [
          { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
        ]);
      }, 400);
    });
    const { home, workspace, env } = prepare(baseUrl, { team: 'duo' });
    writeFileSync(join(workspace, 'a.txt'), 'hello');
    try {
      const result = await runCli(['-p', 'read the file', '--mode', 'auto'], env, workspace);
      assert(result.code === 0, `exit ${result.code}: ${result.err}`);
      assert(result.out.includes('Done.'), `stdout was ${JSON.stringify(result.out)}`);
      assert(
        result.err.includes('[Aristotle] guidance: check the nulls'),
        `stderr was ${JSON.stringify(result.err)}`,
      );
      assert(
        result.err.includes('observer') && result.err.includes('intervention'),
        `no observer summary in ${JSON.stringify(result.err)}`,
      );
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },

  async academy() {
    const { server, baseUrl } = await startStub((request, response) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      sse(response, [
        { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
      ]);
    });
    const { home, workspace, env } = prepare(baseUrl, { team: 'academy' });
    try {
      const result = await runCli(['-p', 'say hi', '--mode', 'auto'], env, workspace);
      assert(result.code === 0, `exit ${result.code}: ${result.err}`);
      assert(result.err.includes('[Aristotle] watching'), `stderr was ${JSON.stringify(result.err)}`);
      assert(result.err.includes('[Pythagoras] watching'), `stderr was ${JSON.stringify(result.err)}`);
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },

  async plain() {
    const { server, baseUrl } = await startStub((request, response) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      if (request.method === 'POST' && request.url.endsWith('/chat/completions')) {
        sse(response, [
          {
            choices: [{ delta: { content: 'Hello from the stub.' }, finish_reason: 'stop' }],
          },
        ]);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const { home, workspace, env } = prepare(baseUrl);
    try {
      const result = await runCli(['--plain'], env, workspace, 'say hi\n/exit\n');
      assert(result.code === 0, `exit ${result.code}: ${result.err}`);
      assert(
        result.out.includes('Hello from the stub.'),
        `stdout was ${JSON.stringify(result.out)}`,
      );
      assert(result.err.includes('1 turn'), `stderr was ${JSON.stringify(result.err)}`);
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },

  async 'non-tty-approval'() {
    let turn = 0;
    const { server, baseUrl } = await startStub((request, response) => {
      if (request.method === 'GET' && request.url.endsWith('/models')) {
        json(response, { data: [{ id: 'test' }] });
        return;
      }
      if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
        response.writeHead(404);
        response.end();
        return;
      }
      turn += 1;
      if (turn === 1) {
        sse(response, [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({ path: 'note.txt', content: 'x' }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
        return;
      }
      sse(response, [
        { choices: [{ delta: { content: 'The write was refused.' }, finish_reason: 'stop' }] },
      ]);
    });
    const { home, workspace, env } = prepare(baseUrl);
    try {
      const result = await runCli(['-p', 'write a file', '--mode', 'edit'], env, workspace);
      assert(result.code === 0, `exit ${result.code}: ${result.err}`);
      assert(
        !existsSync(join(workspace, 'note.txt')),
        'the file was written although no one could approve it',
      );
      assert(
        result.err.includes('No terminal to ask for approval'),
        `stderr was ${JSON.stringify(result.err)}`,
      );
      assert(
        result.out.includes('The write was refused.'),
        `stdout was ${JSON.stringify(result.out)}`,
      );
    } finally {
      cleanup([home, workspace]);
      server.close();
    }
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(CASES);
let failed = 0;
for (const name of names) {
  const run = CASES[name];
  if (run === undefined) {
    console.error(`e2e: unknown case '${name}'. Cases: ${Object.keys(CASES).join(', ')}`);
    failed += 1;
    continue;
  }
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exitCode = failed === 0 ? 0 : 1;
