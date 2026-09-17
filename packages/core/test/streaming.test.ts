import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D49j. Streaming must be invisible to everything EXCEPT when the text appears:
 * the assembled TurnResponse has to be identical to the blocking one, or the
 * transcript, the observer and the cost display would all disagree depending on
 * whether anyone happened to be watching. These tests pin that parity for both
 * adapters, because "the wire format changed" is exactly the kind of change
 * that silently alters an answer.
 */
const H = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: H.create, stream: H.stream };
  },
}));

import { AnthropicNativeProvider } from '../src/providers/anthropic-native.js';
import { ProviderError } from '../src/providers/errors.js';
import { createProvider } from '../src/providers/registry.js';
import { AgentBus } from '../src/runtime/bus.js';
import { runAgentLoop } from '../src/runtime/loop.js';
import type {
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

const REPLY = {
  content: [{ type: 'text', text: 'Hello' }],
  usage: {
    input_tokens: 10,
    output_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  stop_reason: 'end_turn',
};

const turn = (over: Partial<TurnRequest> = {}): TurnRequest => ({
  model: 'anthropic:claude-sonnet-4-5',
  system: 'SYS',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
  tools: [],
  maxTokens: 100,
  ...over,
});

/** A stand-in for the SDK's MessageStream: deltas, then the assembled message. */
function fakeAnthropicStream(final: unknown, deltas: string[]) {
  const handlers: ((t: string) => void)[] = [];
  const s = {
    on(ev: string, fn: (t: string) => void) {
      if (ev === 'text') handlers.push(fn);
      return s;
    },
    async finalMessage() {
      for (const d of deltas) {
        for (const h of handlers) h(d);
      }
      return final;
    },
  };
  return s;
}

describe('AnthropicNativeProvider streaming (D49j)', () => {
  beforeEach(() => {
    H.create.mockReset();
    H.stream.mockReset();
    H.create.mockResolvedValue(REPLY);
  });

  it('streams only when a delta sink is supplied', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(turn());
    expect(H.create).toHaveBeenCalledTimes(1);
    expect(H.stream).not.toHaveBeenCalled();

    H.stream.mockImplementation(() => fakeAnthropicStream(REPLY, ['Hello']));
    await p.completeTurn(turn({ onDelta: () => {} }));
    expect(H.stream).toHaveBeenCalledTimes(1);
  });

  it('forwards every text delta', async () => {
    H.stream.mockImplementation(() => fakeAnthropicStream(REPLY, ['He', 'll', 'o']));
    const seen: string[] = [];
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(turn({ onDelta: (t) => seen.push(t) }));
    expect(seen).toEqual(['He', 'll', 'o']);
  });

  // The whole design rests on this: finalMessage() returns the SAME assembled
  // Message create() would have, so the two paths must map identically.
  it('returns a response identical to the blocking path', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    const blocking = await p.completeTurn(turn());

    H.stream.mockImplementation(() => fakeAnthropicStream(REPLY, ['Hel', 'lo']));
    const streamed = await p.completeTurn(turn({ onDelta: () => {} }));

    expect(streamed).toEqual(blocking);
  });

  it('passes the abort signal to the stream', async () => {
    H.stream.mockImplementation(() => fakeAnthropicStream(REPLY, []));
    const ctrl = new AbortController();
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(turn({ onDelta: () => {}, signal: ctrl.signal }));
    const opts = H.stream.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(opts.signal).toBe(ctrl.signal);
  });

  it('normalises a mid-stream failure into a ProviderError', async () => {
    H.stream.mockImplementation(() => ({
      on() {
        return this;
      },
      async finalMessage() {
        const e = new Error('overloaded') as Error & { status: number };
        e.status = 529;
        throw e;
      },
    }));
    const p = new AnthropicNativeProvider('sk-test');
    await expect(p.completeTurn(turn({ onDelta: () => {} }))).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

// ---------------------------------------------------------------------------

const enc = new TextEncoder();

/** A `text/event-stream` response whose body is delivered in these chunks. */
function sse(chunks: string[], contentType = 'text/event-stream'): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': contentType } },
  );
}

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function fetchReturning(res: Response) {
  return vi.fn(
    async (_url: string, _init: RequestInit) => res,
  ) as unknown as typeof fetch;
}

const line = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

const ask = (
  fetchImpl: typeof fetch,
  onDelta?: (t: string) => void,
): Promise<TurnResponse> =>
  createProvider('openai', {
    apiKey: 'sk-test',
    baseUrl: 'https://router.example/v1/',
    fetchImpl,
  }).completeTurn(turn({ model: 'openai:gpt-4o', onDelta }));

describe('OpenAICompatProvider SSE parsing (D49j)', () => {
  it('asks for a stream and for usage on the final chunk', async () => {
    const f = fetchReturning(sse([line({ choices: [{ delta: {} }] }), 'data: [DONE]\n\n']));
    await ask(f, () => {});
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('does not request a stream when nobody is watching', async () => {
    const f = fetchReturning(json({ choices: [{ message: { content: 'hi' } }] }));
    await ask(f);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect('stream' in body).toBe(false);
  });

  // A `data:` line CAN be split across two reads; naively parsing per chunk
  // would drop the answer entirely.
  it('reassembles a data line split across reads', async () => {
    const whole = line({ choices: [{ delta: { content: 'Hello' } }] });
    const cut = Math.floor(whole.length / 2);
    const f = fetchReturning(
      sse([whole.slice(0, cut), whole.slice(cut), 'data: [DONE]\n\n']),
    );
    const seen: string[] = [];
    const res = await ask(f, (t) => seen.push(t));
    expect(res.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(seen.join('')).toBe('Hello');
  });

  it('concatenates every delta of a turn', async () => {
    const f = fetchReturning(
      sse([
        line({ choices: [{ delta: { content: 'The ' } }] }),
        line({ choices: [{ delta: { content: 'bug ' } }] }),
        line({ choices: [{ delta: { content: 'is here' }, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.content).toEqual([{ type: 'text', text: 'The bug is here' }]);
    expect(res.stopReason).toBe('stop');
  });

  // Arguments arrive as string fragments keyed by `index`; the id and name
  // appear on the first fragment only.
  it('reassembles a tool call fragmented across chunks', async () => {
    const f = fetchReturning(
      sse([
        line({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } },
                ],
              },
            },
          ],
        }),
        line({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } },
          ],
        }),
        line({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.txt' } },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });

  it('keeps interleaved tool calls apart and in index order', async () => {
    const f = fetchReturning(
      sse([
        line({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 1, id: 'b', function: { name: 'grep', arguments: '{"p"' } },
                ],
              },
            },
          ],
        }),
        line({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'a', function: { name: 'read_file', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
        line({
          choices: [
            { delta: { tool_calls: [{ index: 1, function: { arguments: ':"x"}' } }] } },
          ],
        }),
        'data: [DONE]\n\n',
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'read_file', input: {} },
      { type: 'tool_use', id: 'b', name: 'grep', input: { p: 'x' } },
    ]);
  });

  it('tolerates CRLF endings and heartbeat comments', async () => {
    const f = fetchReturning(
      sse([
        ': keep-alive\r\n\r\n',
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\r\n\r\n`,
        'data: [DONE]\r\n\r\n',
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('stops at the [DONE] sentinel and ignores what follows', async () => {
    const f = fetchReturning(
      sse([
        line({ choices: [{ delta: { content: 'first' } }] }),
        'data: [DONE]\n\n',
        line({ choices: [{ delta: { content: 'after' } }] }),
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.content).toEqual([{ type: 'text', text: 'first' }]);
  });

  it('reports usage from the final chunk when the endpoint sends it', async () => {
    const f = fetchReturning(
      sse([
        line({ choices: [{ delta: { content: 'hi' } }] }),
        line({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 30, completion_tokens: 4 },
        }),
        'data: [DONE]\n\n',
      ]),
    );
    const res = await ask(f, () => {});
    expect(res.usage).toEqual({
      inputTokens: 30,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('reports zero rather than pretending when usage is absent', async () => {
    const f = fetchReturning(
      sse([line({ choices: [{ delta: { content: 'hi' } }] }), 'data: [DONE]\n\n']),
    );
    const res = await ask(f, () => {});
    expect(res.usage.inputTokens).toBe(0);
    expect(res.usage.outputTokens).toBe(0);
  });

  // Some compatible servers accept `stream: true` and answer with plain JSON.
  // Trusting the request flag would produce a silently EMPTY answer.
  it('falls back to JSON when the server ignores stream:true', async () => {
    const f = fetchReturning(
      json({ choices: [{ message: { content: 'not streamed' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
    );
    const seen: string[] = [];
    const res = await ask(f, (t) => seen.push(t));
    expect(res.content).toEqual([{ type: 'text', text: 'not streamed' }]);
    expect(seen).toEqual([]);
  });

  /**
   * The parity claim, directly: the same answer delivered as SSE and as JSON
   * must produce the same TurnResponse. Includes a tool call so the
   * reassembly path is covered, not just the text.
   */
  it('produces the same response streamed and unstreamed', async () => {
    const body = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'thinking',
            tool_calls: [
              { id: 'call_9', function: { name: 'grep', arguments: '{"pattern":"x"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 4 } },
    };
    const blocking = await ask(fetchReturning(json(body)));

    const f = fetchReturning(
      sse([
        line({ choices: [{ delta: { content: 'thin' } }] }),
        line({ choices: [{ delta: { content: 'king' } }] }),
        line({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_9', function: { name: 'grep', arguments: '{"pattern"' } },
                ],
              },
            },
          ],
        }),
        line({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] } },
          ],
        }),
        line({
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        }),
        'data: [DONE]\n\n',
      ]),
    );
    const streamed = await ask(f, () => {});
    expect(streamed).toEqual(blocking);
  });
});

// ---------------------------------------------------------------------------

function scriptedProvider(
  script: (req: TurnRequest, attempt: number) => Promise<TurnResponse>,
): ChatProvider & { attempts: number; lastReq: TurnRequest | null } {
  const p = {
    id: 'anthropic' as const,
    attempts: 0,
    lastReq: null as TurnRequest | null,
    async completeTurn(req: TurnRequest): Promise<TurnResponse> {
      p.lastReq = req;
      p.attempts += 1;
      return script(req, p.attempts);
    },
  };
  return p;
}

const BASE = {
  root: process.cwd(),
  task: 'test task',
  getMode: () => 'act' as const,
  approve: () => Promise.resolve(true),
  model: 'anthropic:claude-3-5-haiku-latest',
  bus: new AgentBus(),
};

describe('loop streaming wiring (D49j)', () => {
  it('does not ask for a stream when no delta sink is given', async () => {
    const p = scriptedProvider(async () => ({
      content: [{ type: 'text', text: 'plain' }],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'stop',
    }));
    await runAgentLoop({ ...BASE, provider: p });
    expect(p.lastReq!.onDelta).toBeUndefined();
  });

  it('reports the turn text so far, not the newest fragment', async () => {
    const p = scriptedProvider(async (req) => {
      for (const piece of ['Hel', 'lo', ' there']) req.onDelta!(piece);
      return {
        content: [{ type: 'text', text: 'Hello there' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    });
    const seen: string[] = [];
    await runAgentLoop({ ...BASE, provider: p, onTextDelta: (t) => seen.push(t) });
    expect(seen).toEqual(['Hel', 'Hello', 'Hello there']);
  });

  /**
   * The retry trap: attempt 1 delivers text and then dies. A shared
   * accumulator would report "HelHello" — text the model never produced.
   */
  it('restarts the accumulator on a retried attempt', async () => {
    const p = scriptedProvider(async (req, attempt) => {
      if (attempt === 1) {
        req.onDelta!('Hel');
        throw new ProviderError(500, 'server error', 'anthropic');
      }
      for (const piece of ['Hello']) req.onDelta!(piece);
      return {
        content: [{ type: 'text', text: 'Hello' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    });
    const seen: string[] = [];
    await runAgentLoop({
      ...BASE,
      provider: p,
      onTextDelta: (t) => seen.push(t),
      retry: { sleep: async () => {}, random: () => 0 },
    });
    expect(p.attempts).toBe(2);
    expect(seen).toEqual(['Hel', 'Hello']);
    // The abandoned attempt's text must not survive into the retry.
    expect(seen[seen.length - 1]).not.toContain('HelHello');
  });

  // The committed block is what the transcript and the observer read, so it
  // must stay exactly one event per block no matter how the text arrived.
  it('still emits one text event per committed block', async () => {
    const p = scriptedProvider(async (req) => {
      req.onDelta!('AB');
      return {
        content: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    });
    const bus = new AgentBus();
    const texts: string[] = [];
    bus.on((e) => {
      if (e.type === 'text') texts.push(e.text);
    });
    await runAgentLoop({ ...BASE, bus, provider: p, onTextDelta: () => {} });
    // Deltas ride a channel of their own, so the transcript gets two events —
    // not one per fragment — and the observer's digest is unchanged.
    expect(texts).toEqual(['A', 'B']);
  });
});
