import { describe, expect, it } from 'vitest';
import { ProviderError, parseRetryAfter } from '../src/providers/errors.js';
import { DEFAULT_RETRY, isRetryable, withRetry } from '../src/providers/retry.js';
import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus } from '../src/runtime/bus.js';
import type { ChatProvider, TurnResponse } from '../src/providers/types.js';

/** A recorded sleep so no test waits in real time. */
function recorder() {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

const http = (status: number, retryAfterMs: number | null = null) =>
  new ProviderError(status, 'x', 'openai', retryAfterMs);

describe('isRetryable (D49f)', () => {
  it('retries 429 and 5xx', () => {
    expect(isRetryable(http(429))).toBe(true);
    expect(isRetryable(http(500))).toBe(true);
    expect(isRetryable(http(503))).toBe(true);
  });

  it('retries a transport failure, which has no status', () => {
    expect(isRetryable(new ProviderError(null, 'socket hang up', 'openai'))).toBe(
      true,
    );
  });

  // Repeating these gets the same answer, so a retry only burns time and money.
  it('does NOT retry a request that is simply wrong', () => {
    expect(isRetryable(http(400))).toBe(false);
    expect(isRetryable(http(401))).toBe(false);
    expect(isRetryable(http(403))).toBe(false);
    expect(isRetryable(http(404))).toBe(false);
  });

  it('does not retry something that is not a ProviderError', () => {
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable('boom')).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(' 12 ')).toBe(12000);
  });

  it('reads an HTTP-date as a delay from now', () => {
    const when = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfter(when);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(25_000);
    expect(ms!).toBeLessThanOrEqual(30_000);
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('withRetry', () => {
  it('does not sleep or retry when the first attempt works', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { sleep },
    );
    expect(r).toBe('ok');
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it('retries a 429 and returns the later success', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw http(429);
        return 'recovered';
      },
      { sleep, random: () => 0 },
    );
    expect(r).toBe('recovered');
    expect(calls).toBe(2);
    expect(slept).toHaveLength(1);
  });

  it('prefers the provider Retry-After over its own backoff', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        // 7s from the provider, where the base backoff would be 1s.
        if (calls === 1) throw http(429, 7_000);
        return 'ok';
      },
      { sleep, random: () => 1 },
    );
    expect(slept[0]).toBe(7_000);
  });

  it('backs off exponentially when the provider gives no instruction', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls <= 3) throw http(503);
        return 'ok';
      },
      { sleep, random: () => 1 },
    );
    // base 1000, then 2000, then 4000 — full jitter at random()=1 keeps them.
    expect(slept).toEqual([1_000, 2_000, 4_000]);
  });

  it('gives up immediately on a 401 without sleeping', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw http(401);
        },
        { sleep },
      ),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it('throws the last error after exhausting attempts', async () => {
    const { slept, sleep } = recorder();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError(503, `failure ${calls}`, 'openai');
        },
        { sleep, policy: { ...DEFAULT_RETRY, attempts: 3 } },
      ),
    ).rejects.toThrow(/failure 3/);
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2); // 3 attempts means 2 waits
  });

  // A long Retry-After must not stall a run for minutes.
  it('stops when the next wait would run past the elapsed budget', async () => {
    const { slept, sleep } = recorder();
    let clock = 0;
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw http(429, 60_000); // provider asks for a minute
        },
        {
          sleep,
          now: () => clock,
          random: () => 1,
          policy: { ...DEFAULT_RETRY, attempts: 5, maxElapsedMs: 10_000 },
        },
      ),
    ).rejects.toThrow(/429/);
    // The first 60s wait already exceeds the 10s budget, so nothing is slept.
    expect(slept).toEqual([]);
    expect(calls).toBe(1);
  });

  it('reports each retry so the UI can explain the wait', async () => {
    const { sleep } = recorder();
    const seen: { attempt: number; reason: string }[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw http(429);
        return 'ok';
      },
      { sleep, onRetry: (i) => seen.push({ attempt: i.attempt, reason: i.reason }) },
    );
    expect(seen).toEqual([{ attempt: 1, reason: 'rate limited' }]);
  });
});

describe('the loop wires the retry policy (D49f)', () => {
  const BASE = {
    root: process.cwd(),
    task: 'test task',
    getMode: () => 'act' as const,
    approve: () => Promise.resolve(true),
    model: 'anthropic:claude-3-5-haiku-latest',
  };

  it('recovers a run whose first turn is rate limited, and says so', async () => {
    let calls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        calls++;
        if (calls === 1) throw http(429);
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 5, outputTokens: 2 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
    });
    const { sleep, slept } = recorder();

    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      // deterministic jitter, so the notice text is stable
      retry: { sleep, random: () => 0 },
    });

    expect(r.reason).toBe('complete');
    expect(r.finalText).toContain('done');
    expect(calls).toBe(2);
    expect(slept).toHaveLength(1);
    expect(notices.join('\n')).toMatch(/rate limited — retrying in \d+s \(attempt 2 of \d+\)/);
  });

  it('still fails the run when the failure is not retryable', async () => {
    let calls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        calls++;
        throw http(401);
      },
    };
    const { sleep, slept } = recorder();
    await expect(
      runAgentLoop({ ...BASE, provider: p, retry: { sleep } }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });
});
