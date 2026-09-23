import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_CATALOG,
  createProvider,
  findModel,
  maxContextFor,
  maxOutputFor,
  modelSupportsReasoning,
  parseModelRef,
  pickEffectiveModel,
  resolveMaxContext,
  resolveMaxOutput,
  resolveOfferedModels,
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

  it('declares a non-null maxContext for every catalog entry', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.maxContext).not.toBeNull();
      expect(m.maxContext).toBeTypeOf('number');
      expect(m.maxContext).toBeGreaterThan(0);
    }
  });
});

describe('maxContextFor / maxOutputFor (D37)', () => {
  it('returns catalog maxContext for known bare names', () => {
    expect(maxContextFor('claude-sonnet-4-5')).toBe(200000);
    expect(maxContextFor('gpt-4o')).toBe(128000);
  });

  it('returns null for unknown models — never guesses (D26c)', () => {
    expect(maxContextFor('totally-custom')).toBeNull();
  });

  it('maxOutputFor still falls back to 8192 for unknown models', () => {
    expect(maxOutputFor('claude-3-5-haiku-latest')).toBe(8192);
    expect(maxOutputFor('totally-custom')).toBe(8192);
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
    // D49g widened TurnUsage with the cache figures; an endpoint that reports
    // no cached tokens must still yield an explicit zero, not undefined.
    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

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

  it('omits the tools key entirely for tool-less turns (D40b)', async () => {
    // OpenAI-compatible endpoints 400 on an empty tools array
    // (minItems: 1) — the D40 conversation-title call hit exactly this.
    const fetchMock = mockFetch({ choices: [{ message: { content: 't' } }] });
    const p = createProvider('openai', { apiKey: 'k', fetchImpl: fetchMock });
    await p.completeTurn({
      model: 'openai:gpt-4o',
      system: 's',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [],
      maxTokens: 10,
    });
    const fn = fetchMock as unknown as ReturnType<typeof vi.fn>;
    const init = fn.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect('tools' in body).toBe(false);
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

/**
 * D49t: the catalog and the user's connection can both claim a context window,
 * and the run has to pick. The rule is "the smaller wins" — see resolveMaxContext.
 */
describe('resolveMaxContext / resolveMaxOutput (D49t)', () => {
  it('uses the catalog when the connection says nothing', () => {
    expect(resolveMaxContext('claude-sonnet-4-5')).toBe(200000);
    expect(resolveMaxOutput('claude-sonnet-4-5')).toBe(64000);
  });

  it('uses the connection when the model is unknown to the catalog', () => {
    expect(resolveMaxContext('my-litellm-group', 163840)).toBe(163840);
    expect(resolveMaxOutput('my-litellm-group', 64000)).toBe(64000);
  });

  /**
   * A connection can serve a SMALLER window than the model is capable of — a
   * LiteLLM route capped to fit a GPU, say. Believing the catalog there means
   * sending more than the route accepts.
   */
  it('takes the smaller when both speak', () => {
    expect(resolveMaxContext('claude-sonnet-4-5', 32768)).toBe(32768);
    expect(resolveMaxContext('claude-sonnet-4-5', 500000)).toBe(200000);
    expect(resolveMaxOutput('claude-sonnet-4-5', 4096)).toBe(4096);
  });

  it('still reports unknown when neither speaks', () => {
    expect(resolveMaxContext('my-litellm-group')).toBeNull();
  });

  /**
   * The output cap's fallback must NOT be treated as knowledge: taking a minimum
   * against 8192 would pin every unknown model to 8192 and defeat the wiring.
   */
  it('lets an advertised output cap beat the 8192 fallback', () => {
    expect(resolveMaxOutput('my-litellm-group')).toBe(8192);
    expect(resolveMaxOutput('my-litellm-group', 100000)).toBe(100000);
  });
});

/**
 * D49x: the founder's report — `ornith` unchecked in Settings, yet still the
 * model the chat would run. A preference naming a model that is no longer
 * offered must NOT be honoured; a restricted key answers 403 for a model it does
 * not allow, so the stale preference is a failed run rather than a no-op.
 *
 * These assertions pin the rule the shell asks for. The shell used to ask a
 * weaker question ("does the connection exist?"), which is true for a deselected
 * model and was the whole defect — so the case below is the one that separates
 * the two rules.
 */
describe('pickEffectiveModel (D49x)', () => {
  const OFFERED = ['litellm:claude-sonnet-5', 'anthropic:claude-sonnet-4-5'];

  it('keeps the preference while the connections still offer it', () => {
    expect(pickEffectiveModel(OFFERED, 'anthropic:claude-sonnet-4-5'))
      .toBe('anthropic:claude-sonnet-4-5');
  });

  it('leaves a deselected model for one the same connection offers', () => {
    expect(pickEffectiveModel(OFFERED, 'litellm:ornith-1.5-35b-a3b'))
      .toBe('litellm:claude-sonnet-5');
  });

  // Another connection can mean another vendor, another price and another key,
  // so losing a model is not a reason to change providers.
  it('does not cross connections while the named one has anything left', () => {
    expect(pickEffectiveModel(
      ['openai:gpt-4o', 'litellm:claude-sonnet-5'],
      'litellm:ornith-1.5-35b-a3b',
    )).toBe('litellm:claude-sonnet-5');
  });

  it('falls back to the first offered model when the connection is gone', () => {
    expect(pickEffectiveModel(['openai:gpt-4o'], 'litellm:claude-sonnet-5'))
      .toBe('openai:gpt-4o');
  });

  // A workspace whose connection list has not loaded yet must keep the model it
  // would have used, not have it blanked.
  it('keeps the preference when nothing is offered at all', () => {
    expect(pickEffectiveModel([], 'litellm:claude-sonnet-5'))
      .toBe('litellm:claude-sonnet-5');
  });

  it('handles an empty preference', () => {
    expect(pickEffectiveModel(OFFERED, '')).toBe('litellm:claude-sonnet-5');
    expect(pickEffectiveModel([], '')).toBe('');
  });
});

/**
 * D49z: every fetched model is offered. The case that matters is the config
 * written while the checkbox existed — a narrow `models` beside a wider
 * `allModels` — because reading the narrow one there would preserve, rather than
 * fix, a model reference that points at something the key refuses.
 */
describe('resolveOfferedModels (D49z)', () => {
  const FETCHED = ['a', 'b', 'c', 'd'];

  it('offers the whole fetched list, in its stored order', () => {
    expect(resolveOfferedModels(FETCHED, ['b'])).toEqual(['a', 'b', 'c', 'd']);
  });

  // A config hand-written before any fetch has no fetched list to prefer.
  it('falls back to the stored selection when nothing was fetched', () => {
    expect(resolveOfferedModels(undefined, ['gpt-4o'])).toEqual(['gpt-4o']);
    expect(resolveOfferedModels([], ['gpt-4o'])).toEqual(['gpt-4o']);
  });

  it('reports nothing when the connection has no list at all', () => {
    expect(resolveOfferedModels(undefined, undefined)).toEqual([]);
  });

  it('does not hand the caller a live config array', () => {
    const stored = ['a'];
    expect(resolveOfferedModels(stored, undefined)).not.toBe(stored);
  });
});
