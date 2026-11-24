/**
 * A local OpenAI-compatible endpoint, for a credential-free prompt run.
 *
 * It serves `GET /v1/models` and `POST /v1/chat/completions` on 127.0.0.1.
 * The first turn asks for `todo_write` and `write_file`; the follow-up, which
 * carries a tool result, gives the final text. A 250 ms gap after the first
 * text chunk leaves a window for the cancel and concurrency cases.
 *
 * The profile also writes a Plato config into a temporary home that points at
 * this server. That part is Plato-specific; it is opt-in with
 * `--local-provider` and is documented in the README.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedEnv } from './env.mjs';

const MODEL = 'mock-model';
const DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sendJson(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function firstTurnTools() {
  return [
    {
      index: 0,
      id: 'call-todo',
      type: 'function',
      function: {
        name: 'todo_write',
        arguments: JSON.stringify({
          todos: [
            { content: 'Write the probe file', status: 'in_progress' },
            { content: 'Report the result', status: 'pending' },
          ],
        }),
      },
    },
    {
      index: 1,
      id: 'call-write',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          path: 'probe-write.txt',
          content: 'hello from the local provider\n',
        }),
      },
    },
  ];
}

function chunk(delta, finish = null) {
  return {
    id: 'chatcmpl-harness',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function completion(hasToolResult) {
  if (hasToolResult) {
    return {
      id: 'chatcmpl-harness',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'The file was created. Done.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
    };
  }
  return {
    id: 'chatcmpl-harness',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Working on it.',
          tool_calls: firstTurnTools().map((call) => ({
            id: call.id,
            type: 'function',
            function: call.function,
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
  };
}

function streamCompletion(res, hasToolResult) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  let closed = false;
  const close = () => {
    closed = true;
  };
  res.on('error', close);
  res.on('close', close);

  const write = (payload) => {
    if (closed || res.writableEnded || res.destroyed) return false;
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      closed = true;
      return false;
    }
  };

  void (async () => {
    if (hasToolResult) {
      write(chunk({ role: 'assistant', content: 'The file was created. Done.' }));
      write(chunk({}, 'stop'));
      if (!closed && !res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }

    write(chunk({ role: 'assistant', content: 'Working on it.' }));
    // Leave a window in which the client can cancel, or send a second prompt.
    await sleep(DELAY_MS);
    if (closed || res.writableEnded) return;
    write(chunk({ tool_calls: firstTurnTools() }));
    write(chunk({}, 'tool_calls'));
    if (!closed && !res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  })();
}

async function handle(req, res, requests) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: [
        {
          id: MODEL,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          context_length: 128_000,
          max_output_tokens: 4_096,
        },
      ],
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const raw = await readBody(req);
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: { message: 'invalid JSON' } });
      return;
    }
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const hasToolResult = messages.some((message) => message?.role === 'tool');
    requests.push({
      at: Date.now(),
      model: request.model,
      stream: request.stream === true,
      messages: messages.length,
      hasToolResult,
    });
    if (request.stream === true) streamCompletion(res, hasToolResult);
    else sendJson(res, 200, completion(hasToolResult));
    return;
  }

  sendJson(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}` } });
}

/** Start the server. Returns its base URL, a request log, and a close function. */
export async function startLocalProvider() {
  const requests = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    void handle(req, res, requests).catch((error) => {
      sendJson(res, 500, { error: { message: error?.message ?? 'server failed' } });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close() {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
    },
  };
}

/**
 * Write a Plato config into a new temporary home. It has one connection with an
 * `http://` base URL, which needs no key.
 */
export function createLocalProviderHome(baseUrl) {
  const home = mkdtempSync(join(tmpdir(), 'plato-acp-local-'));
  const dir = join(home, '.config', 'plato');
  mkdirSync(dir, { recursive: true });
  const config = {
    connections: [{ id: 'local', kind: 'openai', baseUrl }],
    model: `local:${MODEL}`,
    mode: 'edit',
    team: 'solo',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { home, env: isolatedEnv(home) };
}

export function removeLocalProviderHome(home) {
  rmSync(home, { recursive: true, force: true });
}
