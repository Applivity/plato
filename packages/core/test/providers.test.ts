import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_CATALOG,
  createProvider,
  findModel,
  modelSupportsReasoning,
  parseModelRef,
} from '../src/providers/registry.js';

describe('parseModelRef', () => {
  const KNOWN = ['anthropic', 'openai', 'litellm'];
  it('parses refs whose connection id is configured', () => {
    expect(parseModelRef('anthropic:claude-sonnet-4-5', KNOWN)).toEqual({
      connectionId: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
    expect(parseModelRef('litellm:gpt-4o', KNOWN)).toEqual({
      connectionId: 'litellm',
      model: 'gpt-4o',
    });
  });

  it('rejects unconfigured connections and malformed refs', () => {
    expect(parseModelRef('mistral:mixtral', KNOWN)).toBeNull();
    expect(parseModelRef('claude-sonnet-4-5', KNOWN)).toBeNull();
    expect(parseModelRef('openai:', KNOWN)).toBeNull();
    expect(parseModelRef('', KNOWN)).toBeNull();
  });
});

describe('catalog (bare model names)', () => {
  it('finds entries by bare name regardless of connection', () => {
    expect(findModel('o4-mini')?.label).toBe('o4-mini');
    expect(findModel('claude-opus-4-1')?.reasoning).toBe(true);
    expect(findModel('nope')).toBeUndefined();
  });

  it('flags reasoning only for catalog models that support it', () => {
    expect(modelSupportsReasoning('claude-sonnet-4-5')).toBe(true);
    expect(modelSupportsReasoning('gpt-4o')).toBe(false);
    expect(modelSupportsReasoning('totally-custom')).toBe(false);
  });

  it('prices every catalog entry that declares a price', () => {
    // Delete-price entries ([0,0]) are deliberate: we list some models
    // (e.g. Ornith) for maxOutput/reasoning but don't have authoritative
    // pricing, so they quote $0 (estimated:false) per D26c — never fake
    // precision. Assert the invariant on the models we DO price.
    for (const m of MODEL_CATALOG) {
      if (m.pricePerMTok[0] === 0 && m.pricePerMTok[1] === 0) {
        continue;
      }
      expect(m.pricePerMTok[0]).toBeGreaterThan(0);
      expect(m.pricePerMTok[1]).toBeGreaterThan(0);
    }
  });
});

const okBody = {
  choices: [
    {
      message: {
        content: 'hello',
        tool_calls: [
          {
            id: 'call_1',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

function mockFetch(payload: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('OpenAICompatProvider.completeTurn', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts to baseUrl/chat/completions with auth and canonical tools', async () => {
    const fetchMock = mockFetch(okBody);
    const p = createProvider('openai', {
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1/',
      fetchImpl: fetchMock,
    });
    const res = await p.completeTurn({
      model: 'openai:gpt-4o-mini',
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [
        {
          name: 'read_file',
          description: 'd',
          parameters: { type: 'object', properties: {} },
        },
      ],
      maxTokens: 100,
    });
    expect(res.content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(res.content[1]).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'read_file',
      input: { path: 'a.txt' },
    });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    const fn = fetchMock as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://router.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test',
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini');
    expect(Array.isArray(body.tools)).toBe(true);
    expect('reasoning_effort' in body).toBe(false);
  });

  it('attaches reasoning_effort when configured', async () => {
    const fetchMock = mockFetch({ choices: [{ message: {} }], usage: {} });
    const p = createProvider('openai', { apiKey: '', fetchImpl: fetchMock });
    await p.completeTurn({
      model: 'openai:o4-mini',
      system: 's',
      messages: [],
      tools: [],
      maxTokens: 10,
      reasoning: { effort: 'high' },
    });
    const fn = fetchMock as unknown as ReturnType<typeof vi.fn>;
    const init = fn.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe('high');
  });

  it('maps assistant tool_calls and user tool results both ways', async () => {
    const fetchMock = mockFetch({ choices: [{ message: {} }], usage: {} });
    const p = createProvider('openai', { apiKey: '', fetchImpl: fetchMock });
    await p.completeTurn({
      model: 'openai:gpt-4o',
      system: 's',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'c9', name: 'grep', input: { pattern: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'c9', content: 'hits', isError: false },
            { type: 'text', text: '[observer guidance] focus up' },
          ],
        },
      ],
      tools: [],
      maxTokens: 10,
    });
    const fn = fetchMock as unknown as ReturnType<typeof vi.fn>;
    const init2 = fn.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init2.body)) as {
      messages: Record<string, unknown>[];
    };
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        { id: 'c9', function: { name: 'grep', arguments: '{"pattern":"x"}' } },
      ],
    });
    expect(body.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'c9',
      content: 'hits',
    });
    expect(body.messages[3]).toEqual({
      role: 'user',
      content: '[observer guidance] focus up',
    });
  });

  it('throws a readable error on non-200', async () => {
    const p = createProvider('openai', {
      apiKey: 'k',
      fetchImpl: mockFetch({ error: 'nope' }, 401),
    });
    await expect(
      p.completeTurn({
        model: 'openai:gpt-4o',
        system: 's',
        messages: [],
        tools: [],
        maxTokens: 10,
      }),
    ).rejects.toThrow(/401/);
  });
});
