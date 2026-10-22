import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveConfig, type ConnectionConfig } from '../src/config.js';
import { modelPool, readModelCache, runModels, CACHE_TTL_MS } from '../src/models.js';

const dirs: string[] = [];

function tempEnv(extra: Record<string, string> = {}): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-models-'));
  dirs.push(dir);
  return { PLATO_DATA_DIR: dir, PLATO_CONFIG_DIR: dir, ...extra };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return { id: 'stub', kind: 'openai', baseUrl: 'http://stub/v1', ...overrides };
}

function stubFetch(rows: Record<string, unknown>[] = [{ id: 'm1', context_length: 128000, max_output_tokens: 32000 }]) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: rows }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  // Core also tries LiteLLM's /model/info as a best-effort bonus. Count the
  // discovery calls only.
  const modelCalls = (): string[] => calls.filter((url) => url.endsWith('/models'));
  return { calls, modelCalls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('model discovery', () => {
  it('fetches once and then serves the cache for 24 hours', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    const { modelCalls, fetchImpl } = stubFetch();
    const start = 1_000_000;

    const first = await modelPool(connection(), {
      env,
      keychain: null,
      fetchImpl,
      now: start,
    });
    expect(first.cached).toBe(false);
    expect(first.pool).toEqual([{ id: 'm1', maxContext: 128000, maxOutput: 32000 }]);

    const second = await modelPool(connection(), {
      env,
      keychain: null,
      fetchImpl,
      now: start + 60_000,
    });
    expect(second.cached).toBe(true);
    expect(modelCalls()).toHaveLength(1);
  });

  it('refetches after the cache expires', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    const { modelCalls, fetchImpl } = stubFetch();
    const start = 1_000_000;
    await modelPool(connection(), { env, keychain: null, fetchImpl, now: start });
    await modelPool(connection(), {
      env,
      keychain: null,
      fetchImpl,
      now: start + CACHE_TTL_MS + 1,
    });
    expect(modelCalls()).toHaveLength(2);
  });

  it('refetches when --refresh asks', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    const { modelCalls, fetchImpl } = stubFetch();
    const start = 1_000_000;
    await modelPool(connection(), { env, keychain: null, fetchImpl, now: start });
    await modelPool(connection(), {
      env,
      keychain: null,
      fetchImpl,
      now: start,
      refresh: true,
    });
    expect(modelCalls()).toHaveLength(2);
  });

  it('ignores a cache entry from a different base URL', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    const { modelCalls, fetchImpl } = stubFetch();
    const start = 1_000_000;
    await modelPool(connection(), { env, keychain: null, fetchImpl, now: start });
    await modelPool(connection({ baseUrl: 'http://other/v1' }), {
      env,
      keychain: null,
      fetchImpl,
      now: start,
    });
    expect(modelCalls()).toHaveLength(2);
    expect(readModelCache(env)['stub']?.baseUrl).toBe('http://other/v1');
  });

  it('does not let ANTHROPIC_BASE_URL move a configured connection', async () => {
    const env = tempEnv({ ANTHROPIC_BASE_URL: 'http://evil.example', PLATO_KEY_STUB: 'sk' });
    const { calls, fetchImpl } = stubFetch();
    await modelPool(connection(), { env, keychain: null, fetchImpl, now: 1 });
    expect(calls[0]).toBe('http://stub/v1/models');
  });

  it('names the connection on failure and suggests login when no key exists', async () => {
    const env = tempEnv();
    const fetchImpl = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    await expect(
      modelPool(connection(), { env, keychain: null, fetchImpl }),
    ).rejects.toThrow(/Cannot list models for stub: models 401/);
    await expect(
      modelPool(connection(), { env, keychain: null, fetchImpl }),
    ).rejects.toThrow(/plato auth login stub/);
  });

  it('prints one line per model with the limits the endpoint advertised', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    saveConfig(
      {
        connections: [connection()],
        model: 'stub:m1',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
    );
    const { fetchImpl } = stubFetch();
    const out: string[] = [];
    const err: string[] = [];
    const code = await runModels([], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => err.push(text) },
      keychain: null,
      fetchImpl,
      now: 1_000_000,
    });

    expect(code).toBe(0);
    expect(out.join('')).toContain('stub:m1');
    expect(out.join('')).toContain('ctx 128,000');
    expect(out.join('')).toContain('out 32,000');
  });

  it('says when a connection returned no models', async () => {
    const env = tempEnv({ PLATO_KEY_STUB: 'sk-test' });
    saveConfig(
      {
        connections: [connection()],
        model: 'stub:m1',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
    );
    const { fetchImpl } = stubFetch([]);
    const out: string[] = [];
    const code = await runModels([], {
      env,
      streams: { out: (text) => out.push(text), err: () => {} },
      keychain: null,
      fetchImpl,
    });
    expect(code).toBe(0);
    expect(out.join('')).toContain('returned no models');
  });

  it('rejects an unknown connection name with exit code 2', async () => {
    const env = tempEnv();
    const err: string[] = [];
    const code = await runModels(['nope'], {
      env,
      streams: { out: () => {}, err: (text) => err.push(text) },
      keychain: null,
    });
    expect(code).toBe(2);
    expect(err.join('')).toContain("no connection named 'nope'");
  });
});
