import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D49g. The Anthropic adapter had NO test at all before this — the plan flagged
 * that gap before phase 2 rewrites the file. The SDK is mocked so the request
 * body can be inspected, which is the only way to prove where the cache
 * breakpoints actually land.
 */
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
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
