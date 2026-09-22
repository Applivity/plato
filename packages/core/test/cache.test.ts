import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D49g. The Anthropic adapter had NO test at all before this — the plan flagged
 * that gap before phase 2 rewrites the file. The SDK is mocked so the request
 * body can be inspected, which is the only way to prove where the cache
 * breakpoints actually land.
 */
const { mockCreate, ctorCalls } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  // D49u: what Plato hands the SDK, which is the only thing it controls.
  ctorCalls: [] as Record<string, unknown>[],
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
    constructor(opts: Record<string, unknown>) {
      ctorCalls.push(opts);
    }
  },
}));

import { AnthropicNativeProvider } from '../src/providers/anthropic-native.js';
import { createProvider } from '../src/providers/registry.js';
import type { CanonicalTool, TurnResponse } from '../src/providers/types.js';

const tool = (name: string): CanonicalTool => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});

const REPLY = {
  content: [{ type: 'text', text: 'hi' }],
  usage: {
    input_tokens: 10,
    output_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  stop_reason: 'end_turn',
};

function anthopicTurn(over: Record<string, unknown> = {}) {
  return {
    model: 'anthropic:claude-sonnet-4-5',
    system: 'SYS',
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'q' }] }],
    tools: [tool('a'), tool('b')],
    maxTokens: 100,
    ...over,
  };
}

describe('Anthropic prompt caching (D49g)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(REPLY);
  });

  it('marks the system prompt cacheable', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(anthopicTurn({ cache: true }));
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body['system']).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
    ]);
  });

  // A breakpoint on the last tool is what caches the whole tool array.
  it('marks only the LAST tool cacheable', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(anthopicTurn({ cache: true }));
    const body = mockCreate.mock.calls[0]![0] as {
      tools: { name: string; cache_control?: unknown }[];
    };
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]!.cache_control).toBeUndefined();
    expect(body.tools[1]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends a plain system string and no tool breakpoints when cache is off', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(anthopicTurn());
    const body = mockCreate.mock.calls[0]![0] as {
      system: unknown;
      tools: { cache_control?: unknown }[];
    };
    expect(body.system).toBe('SYS');
    expect(body.tools.every((t) => t.cache_control === undefined)).toBe(true);
  });

  it('does not crash on a tool-less turn with cache on', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(anthopicTurn({ cache: true, tools: [] }));
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body['tools']).toBeUndefined(); // D40b: omitted, not empty
  });

  // Anthropic reports input_tokens NET of cache, so the adapter must add the
  // cache figures back or the context ring and the cost would both be wrong.
  it('normalises inputTokens to the true total', async () => {
    mockCreate.mockResolvedValue({
      ...REPLY,
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 700,
      },
    });
    const p = new AnthropicNativeProvider('sk-test');
    const res: TurnResponse = await p.completeTurn(anthopicTurn({ cache: true }));
    expect(res.usage.inputTokens).toBe(1010);
    expect(res.usage.cacheWriteTokens).toBe(300);
    expect(res.usage.cacheReadTokens).toBe(700);
  });
});

describe('OpenAI-compatible cache reporting (D49g)', () => {
  const mockFetch = (payload: unknown, status = 200) =>
    vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

  const REPLY_JSON = (usage: Record<string, unknown>) => ({
    choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
    usage,
  });

  const ask = async (fetchMock: typeof fetch) => {
    const p = createProvider('openai', {
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1/',
      fetchImpl: fetchMock,
    });
    return p.completeTurn({
      model: 'openai:gpt-4o',
      system: 'SYS',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      tools: [],
      maxTokens: 100,
      cache: true,
    });
  };

  // OpenAI caches implicitly: `prompt_tokens` is already GROSS, so unlike
  // Anthropic there is no arithmetic to do — only the subset to report.
  it('reports the cached subset without changing the total', async () => {
    const res = await ask(
      mockFetch(REPLY_JSON({ prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 800 } })),
    );
    expect(res.usage.inputTokens).toBe(1000);
    expect(res.usage.cacheReadTokens).toBe(800);
    expect(res.usage.cacheWriteTokens).toBe(0);
  });

  it('reports zero when the endpoint omits the details object', async () => {
    const res = await ask(
      mockFetch(REPLY_JSON({ prompt_tokens: 1000, completion_tokens: 20 })),
    );
    expect(res.usage.inputTokens).toBe(1000);
    expect(res.usage.cacheReadTokens).toBe(0);
  });
});

/**
 * D49u. The Anthropic SDK defaults `baseURL` to `process.env.ANTHROPIC_BASE_URL`
 * and `authToken` to `process.env.ANTHROPIC_AUTH_TOKEN`. Plato passed neither,
 * so the ambient environment overruled its own configuration: a connection whose
 * settings said api.anthropic.com was sent to whatever that variable named, and
 * an unrelated environment token rode along on every request.
 *
 * The founder hit it exactly — every "Anthropic" connection was going to his
 * LiteLLM proxy, which refused the model, while the model LIST shown beside it
 * had been fetched correctly (discovery always passed a base URL). Two surfaces
 * disagreeing about which server they were talking to.
 *
 * The assertion is on what Plato PASSES. That is the whole defect: with the
 * environment left in charge there is nothing to assert, because the SDK decides.
 */
describe('the Anthropic client never inherits from the environment (D49u)', () => {
  it('passes an explicit endpoint and refuses an ambient token', () => {
    ctorCalls.length = 0;
    new AnthropicNativeProvider('sk-plato');
    expect(ctorCalls[0]).toEqual({
      apiKey: 'sk-plato',
      baseURL: 'https://api.anthropic.com',
      authToken: null,
    });
  });

  it('uses the connection\'s own base URL when it has one', () => {
    ctorCalls.length = 0;
    new AnthropicNativeProvider('sk-plato', 'https://gateway.internal/v1');
    expect(ctorCalls[0]!['baseURL']).toBe('https://gateway.internal/v1');
    expect(ctorCalls[0]!['authToken']).toBeNull();
  });

  // The route from connection config to the client, which is where the base URL
  // used to be dropped on the floor.
  it('carries the base URL through createProvider', () => {
    ctorCalls.length = 0;
    createProvider('anthropic', {
      apiKey: 'sk-plato',
      baseUrl: 'https://gateway.internal/v1',
    });
    expect(ctorCalls[0]!['baseURL']).toBe('https://gateway.internal/v1');
  });
});
