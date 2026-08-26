import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_PRESETS } from '../src/providers/presets.js';
import { fetchModelIds } from '../src/providers/discover.js';

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
