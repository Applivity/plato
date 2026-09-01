import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_PRESETS } from '../src/providers/presets.js';
import { fetchModelIds, fetchModelPool } from '../src/providers/discover.js';

describe('PROVIDER_PRESETS', () => {
  it('offers the curated 15-20 provider list', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(15);
    expect(PROVIDER_PRESETS.length).toBeLessThanOrEqual(20);
  });

  it('has unique ids and valid kinds/urls', () => {
    const ids = new Set(PROVIDER_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PROVIDER_PRESETS.length);
    for (const p of PROVIDER_PRESETS) {
      expect(['anthropic', 'openai']).toContain(p.kind);
      expect(p.baseUrl.startsWith('http')).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

describe('fetchModelIds', () => {
  it('queries openai-compatible /models with bearer auth, sorted ids', async () => {
    const fn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'm2' }, { id: 'm1' }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const models = await fetchModelIds({
      kind: 'openai',
      apiKey: 'sk-x',
      baseUrl: 'https://router.example/v1',
      fetchImpl: fn,
    });
    expect(models).toEqual(['m1', 'm2']);
    const [url, init] = (fn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://router.example/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-x',
    );
  });

  it('uses anthropic headers on the anthropic route', async () => {
    const fn = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const models = await fetchModelIds({
      kind: 'anthropic',
      apiKey: 'ak-x',
      fetchImpl: fn,
    });
    expect(models).toEqual(['claude-x']);
    const [url, init] = (fn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('ak-x');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });

  it('throws a readable error on non-200', async () => {
    const fn = vi.fn(async () =>
      new Response('denied', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchModelIds({ kind: 'openai', apiKey: 'k', fetchImpl: fn }),
    ).rejects.toThrow(/401/);
  });
});

describe('fetchModelPool (D37)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads Anthropic max_input_tokens + max_tokens', async () => {
    const fn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-5', max_input_tokens: 200000, max_tokens: 64000 },
            { id: 'claude-haiku', max_input_tokens: 200000, max_tokens: 8192 },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const pool = await fetchModelPool({
      kind: 'anthropic',
      apiKey: 'sk',
      fetchImpl: fn,
    });
    expect(pool).toEqual([
      { id: 'claude-haiku', maxContext: 200000, maxOutput: 8192 },
      { id: 'claude-sonnet-4-5', maxContext: 200000, maxOutput: 64000 },
    ]);
  });

  it('reads OpenRouter context_length and top_provider.context_length', async () => {
    const fn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'openai/gpt-4o',
              context_length: 128000,
              top_provider: { max_completion_tokens: 16384 },
            },
            {
              id: 'meta/llama-3',
              top_provider: { context_length: 8192, max_completion_tokens: 4096 },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const pool = await fetchModelPool({
      kind: 'openai',
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl: fn,
    });
    expect(pool).toEqual([
      { id: 'meta/llama-3', maxContext: 8192, maxOutput: 4096 },
      { id: 'openai/gpt-4o', maxContext: 128000, maxOutput: 16384 },
    ]);
  });

  it('leaves fields undefined when the provider does not expose them', async () => {
    // Plain OpenAI /v1/models: only id/object/created/owned_by. No
    // context window. Per D26c we don't fake it.
    const fn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-4o-mini', object: 'model' },
            { id: 'gpt-4o', object: 'model' },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const pool = await fetchModelPool({
      kind: 'openai',
      apiKey: 'k',
      fetchImpl: fn,
    });
    expect(pool).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]);
  });

  it('skips entries without a string id and dedupes by id', async () => {
    const fn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: '' },
            { id: 42 },
            null,
            { id: 'dup', max_input_tokens: 100, max_tokens: 10 },
            { id: 'dup', max_input_tokens: 200, max_tokens: 20 },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const pool = await fetchModelPool({
      kind: 'anthropic',
      apiKey: 'k',
      fetchImpl: fn,
    });
    expect(pool).toEqual([{ id: 'dup', maxContext: 100, maxOutput: 10 }]);
  });
});
