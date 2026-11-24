import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, TurnRequest, TurnResponse } from '@applivity/plato-core';
import { AcpAgent, type AcpOptions } from '../src/acp/agent.js';
import type { Env } from '../src/paths.js';
import { run } from '../src/cli.js';
import { executeTask } from '../src/host.js';

/**
 * W1's proof. The harness that drives a real client lives in scripts/acp/
 * (another workstream); this file pins the wire itself: framing, ids, the
 * standard errors, and prompts end to end over an in-memory stdio pair.
 */
const dirs: string[] = [];
function tempDir(prefix = 'plato-acp-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Lines pushed here behave like the client's stdin. */
class Feed {
  private readonly queue: string[] = [];
  private waiters: (() => void)[] = [];
  private ended = false;

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return { next: (): Promise<IteratorResult<string>> => this.next() };
  }

  send(message: object): void {
    this.raw(`${JSON.stringify(message)}\n`);
  }

  raw(text: string): void {
    this.queue.push(text);
    this.wake();
  }

  end(): void {
    this.ended = true;
    this.wake();
  }

  private async next(): Promise<IteratorResult<string>> {
    while (this.queue.length === 0 && !this.ended) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    const line = this.queue.shift();
    return line === undefined ? { done: true, value: undefined } : { done: false, value: line };
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

/** Collects stdout, parsing every line — a non-JSON line throws, by design. */
class Client {
  readonly messages: Record<string, unknown>[] = [];
  errors = '';
  private buffer = '';
  private waiters: (() => void)[] = [];

  constructor(private readonly onMessage?: (message: Record<string, unknown>) => void) {}

  out = (text: string): void => {
    this.buffer += text;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim().length > 0) {
        const message = JSON.parse(line) as Record<string, unknown>;
        this.messages.push(message);
        this.onMessage?.(message);
        for (const waiter of this.waiters.splice(0)) waiter();
      }
      index = this.buffer.indexOf('\n');
    }
  };

  err = (text: string): void => {
    this.errors += text;
  };

  async waitFor(
    predicate: (message: Record<string, unknown>) => boolean,
    what = 'a matching message',
  ): Promise<Record<string, unknown>> {
    const found = this.messages.find(predicate);
    if (found !== undefined) {
      return found;
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), 5_000);
      const check = (): void => {
        const match = this.messages.find(predicate);
        if (match !== undefined) {
          clearTimeout(timer);
          resolve(match);
        } else {
          this.waiters.push(check);
        }
      };
      this.waiters.push(check);
    });
  }

  updates(sessionId: string): Record<string, unknown>[] {
    return this.messages
      .filter((message) => message['method'] === 'session/update')
      .map((message) => message['params'] as Record<string, unknown>)
      .filter((params) => params['sessionId'] === sessionId)
      .map((params) => params['update'] as Record<string, unknown>);
  }
}

interface Running {
  feed: Feed;
  client: Client;
  done: Promise<void>;
}

function start(env: Env, options: AcpOptions = {}, onMessage?: (m: Record<string, unknown>) => void): Running {
  const feed = new Feed();
  const client = new Client(onMessage);
  const agent = new AcpAgent({ input: feed, out: client.out, err: client.err }, {
    env,
    execute: fakeExecute(),
    ...options,
  });
  const done = agent.run();
  return { feed, client, done };
}

/** A config directory plus the three homes, so no test reads the real ones. */
function isolatedEnv(withConnection: boolean): Env {
  const config = tempDir('plato-acp-config-');
  if (withConnection) {
    writeFileSync(
      join(config, 'config.json'),
      JSON.stringify({
        connections: [{ id: 'test', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1' }],
        model: 'test:fake-model',
        mode: 'edit',
      }),
    );
  }
  return {
    ...process.env,
    PLATO_CONFIG_DIR: config,
    PLATO_DATA_DIR: tempDir('plato-acp-data-'),
    PLATO_HOME: tempDir('plato-acp-home-'),
  };
}

function workspace(): string {
  const dir = tempDir('plato-acp-work-');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const offline = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;

/** The real executeTask, with a scripted model instead of a network call. */
function fakeExecute(turns: TurnResponse[] = []) {
  return async (
    options: Parameters<typeof executeTask>[0],
    sink: Parameters<typeof executeTask>[1],
    controller: Parameters<typeof executeTask>[2],
  ) => {
    const provider = scripted(turns);
    return await executeTask(
      { ...options, provider, fetchImpl: offline, platform: 'linux' },
      sink,
      controller,
    );
  };
}

function scripted(turns: TurnResponse[]): ChatProvider {
  let index = 0;
  return {
    id: 'openai',
    async completeTurn(): Promise<TurnResponse> {
      const next = turns[index];
      if (next === undefined) throw new Error('unexpected extra turn');
      index += 1;
      return next;
    },
  };
}

function answer(text: string): TurnResponse {
  return {
    content: [{ type: 'text', text }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };
}

function toolCall(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  text?: string,
): TurnResponse {
  return {
    content: [
      ...(text === undefined ? [] : [{ type: 'text' as const, text }]),
      ...calls.map((call) => ({ type: 'tool_use' as const, ...call })),
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: 1, clientCapabilities: { terminal: true } },
};

async function openSession(running: Running, cwd: string): Promise<string> {
  running.feed.send(INITIALIZE);
  running.feed.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd, mcpServers: [] } });
  const created = await running.client.waitFor((message) => message['id'] === 2);
  return (created['result'] as Record<string, unknown>)['sessionId'] as string;
}

function prompt(feed: Feed, sessionId: string, text: string): void {
  feed.send({
    jsonrpc: '2.0',
    id: 3,
    method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text }] },
  });
}

describe('ACP v1 framing and handshake (W1)', () => {
  it('initialize answers with protocol 1, agentInfo, and terminal auth before any config exists', async () => {
    const { feed, client, done } = start(isolatedEnv(false));
    feed.send(INITIALIZE);
    const response = await client.waitFor((message) => message['id'] === 1);
    feed.end();
    await done;

    const result = response['result'] as Record<string, unknown>;
    expect(result['protocolVersion']).toBe(1);
    expect((result['agentInfo'] as Record<string, unknown>)['name']).toBe('plato');
    const methods = result['authMethods'] as Record<string, unknown>[];
    expect(methods).toHaveLength(1);
    // Appended to `plato --acp`, which is how the registry's validator builds it.
    expect(methods[0]).toMatchObject({ type: 'terminal', args: ['--login'] });
    expect(methods[0]?.['_meta']).toMatchObject({
      'terminal-auth': { command: 'plato', args: ['auth', 'login'] },
    });
    // Nothing but JSON-RPC reached stdout, and no diagnostic reached stderr.
    expect(client.messages.every((message) => message['jsonrpc'] === '2.0')).toBe(true);
    expect(client.errors).toBe('');
  });

  it('session/new answers auth_required (a JSON-RPC error) when no provider is configured', async () => {
    const running = start(isolatedEnv(false));
    running.feed.send(INITIALIZE);
    running.feed.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: workspace(), mcpServers: [] },
    });
    const response = await running.client.waitFor((message) => message['id'] === 2);
    running.feed.end();
    await running.done;
    const error = response['error'] as Record<string, unknown>;
    expect(error['code']).toBe(-32000);
    expect(String(error['message'])).toContain('plato auth login');
  });

  it('echoes string request ids and never answers a notification', async () => {
    const { feed, client, done } = start(isolatedEnv(false));
    feed.send({ ...INITIALIZE, id: 'abc-1' });
    feed.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'nope' } });
    const response = await client.waitFor((message) => message['id'] === 'abc-1');
    feed.end();
    await done;
    expect(response['id']).toBe('abc-1');
    expect(client.messages.filter((message) => message['id'] === 'nope')).toHaveLength(0);
  });

  it('answers malformed input with the standard errors', async () => {
    const { feed, client, done } = start(isolatedEnv(false));
    feed.raw('this is not json\n');
    feed.send({ jsonrpc: '2.0', id: 2, method: 'does/not/exist' });
    feed.send({ jsonrpc: '2.0', id: 3, method: 'session/new', params: {} });
    const parse = await client.waitFor(
      (message) =>
        ((message['error'] as Record<string, unknown> | undefined)?.['code'] as number) === -32700,
    );
    const missing = await client.waitFor((message) => message['id'] === 2);
    const badParams = await client.waitFor((message) => message['id'] === 3);
    feed.end();
    await done;
    expect(parse['id']).toBeNull();
    expect((missing['error'] as Record<string, unknown>)['code']).toBe(-32601);
    expect((badParams['error'] as Record<string, unknown>)['code']).toBe(-32602);
  });

  it('one prompt streams text, a tool call, a permission card, and returns end_turn', async () => {
    const root = workspace();
    let feed: Feed | null = null;
    const client = new Client((message) => {
      if (message['method'] === 'session/request_permission') {
        feed?.send({
          jsonrpc: '2.0',
          id: message['id'],
          result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
        });
      }
    });
    const input = new Feed();
    feed = input;
    const agent = new AcpAgent(
      { input, out: client.out, err: client.err },
      {
        env: isolatedEnv(true),
        execute: fakeExecute([
          toolCall(
            [{ id: 'c1', name: 'write_file', input: { path: 'made.txt', content: 'from acp' } }],
            'working',
          ),
          answer('finished'),
        ]),
      },
    );
    const done = agent.run();

    input.send(INITIALIZE);
    input.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: root, mcpServers: [] } });
    const created = await client.waitFor((message) => message['id'] === 2);
    const sessionId = (created['result'] as Record<string, unknown>)['sessionId'] as string;
    prompt(input, sessionId, 'make the file');
    const response = await client.waitFor((message) => message['id'] === 3);
    input.end();
    await done;

    expect((response['result'] as Record<string, unknown>)['stopReason']).toBe('end_turn');
    const permission = client.messages.find(
      (message) => message['method'] === 'session/request_permission',
    );
    expect(permission).toBeDefined();
    const asked = permission?.['params'] as Record<string, unknown>;
    expect(asked['sessionId']).toBe(sessionId);
    expect((asked['options'] as unknown[]).length).toBe(3);

    const updates = client.updates(sessionId);
    const text = updates
      .filter((update) => update['sessionUpdate'] === 'agent_message_chunk')
      .map((update) => String((update['content'] as Record<string, unknown>)['text']))
      .join('');
    expect(text).toContain('working');
    expect(text).toContain('finished');

    const createdCall = updates.find((update) => update['sessionUpdate'] === 'tool_call');
    expect(createdCall).toMatchObject({ name: 'write_file', status: 'pending', kind: 'edit' });
    const statuses = updates
      .filter((update) => update['sessionUpdate'] === 'tool_call_update')
      .map((update) => update['status']);
    expect(statuses).toEqual(['in_progress', 'completed']);
    // The tool really ran, in the session's cwd.
    expect(readFileSync(join(root, 'made.txt'), 'utf8')).toBe('from acp');
  });

  it('publishes todo_write as a plan update', async () => {
    const root = workspace();
    const { feed, client, done } = start(isolatedEnv(true), {
      execute: fakeExecute([
        toolCall([
          {
            id: 'c1',
            name: 'todo_write',
            input: {
              todos: [
                { content: 'write it', status: 'in_progress' },
                { content: 'test it', status: 'pending' },
              ],
            },
          },
        ]),
        answer('done'),
      ]),
    });
    const sessionId = await openSession({ feed, client, done }, root);
    prompt(feed, sessionId, 'plan it');
    await client.waitFor((message) => message['id'] === 3);
    feed.end();
    await done;

    const plan = client.updates(sessionId).find((update) => update['sessionUpdate'] === 'plan');
    expect(plan?.['entries']).toEqual([
      { content: 'write it', priority: 'medium', status: 'in_progress' },
      { content: 'test it', priority: 'medium', status: 'pending' },
    ]);
  });

  it('session/cancel stops the run and the prompt returns cancelled', async () => {
    const root = workspace();
    const feed = new Feed();
    const client = new Client();
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting: ChatProvider = {
      id: 'openai',
      async completeTurn(request: TurnRequest): Promise<TurnResponse> {
        started();
        return await new Promise<TurnResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    };
    const agent = new AcpAgent(
      { input: feed, out: client.out, err: client.err },
      {
        env: isolatedEnv(true),
        execute: async (options, sink, controller) =>
          await executeTask(
            { ...options, provider: waiting, fetchImpl: offline, platform: 'linux' },
            sink,
            controller,
          ),
      },
    );
    const done = agent.run();
    feed.send(INITIALIZE);
    feed.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: root, mcpServers: [] } });
    const created = await client.waitFor((message) => message['id'] === 2);
    const sessionId = (created['result'] as Record<string, unknown>)['sessionId'] as string;
    prompt(feed, sessionId, 'hang');
    await running;
    feed.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    const response = await client.waitFor((message) => message['id'] === 3);
    feed.end();
    await done;
    expect((response['result'] as Record<string, unknown>)['stopReason']).toBe('cancelled');
  });

  it('run() serves --acp, so the flag cannot fall into the unknown-option path', async () => {
    const feed = new Feed();
    const client = new Client();
    const code = run(['--acp'], { out: client.out, err: client.err, input: feed });
    feed.send(INITIALIZE);
    const response = await client.waitFor((message) => message['id'] === 1);
    feed.end();
    expect(await code).toBe(0);
    expect((response['result'] as Record<string, unknown>)['protocolVersion']).toBe(1);
    expect(client.errors).toBe('');
  });
});
