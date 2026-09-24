import { describe, expect, it, vi } from 'vitest';

/**
 * D49i. `RunController.gate()` can only stop the loop at a safe point; a
 * provider call already in flight was unstoppable, so a hung request hung the
 * whole run. These tests cover the three places the signal has to reach: the
 * controller, the loop, and the transport.
 */
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { AnthropicNativeProvider } from '../src/providers/anthropic-native.js';
import { ProviderError } from '../src/providers/errors.js';
import { withRetry } from '../src/providers/retry.js';
import { createProvider } from '../src/providers/registry.js';
import { runAgentLoop } from '../src/runtime/loop.js';
import { RunController } from '../src/runtime/bus.js';
import type {
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

describe('RunController.signal (D49i)', () => {
  it('is not aborted until cancel is called', () => {
    const c = new RunController();
    expect(c.signal.aborted).toBe(false);
    c.cancel();
    expect(c.signal.aborted).toBe(true);
  });

  it('pause and resume do not abort', () => {
    const c = new RunController();
    c.pause();
    c.resume();
    expect(c.signal.aborted).toBe(false);
  });
});

describe('withRetry respects an abort (D49i)', () => {
  // An aborted request looks EXACTLY like a transport failure — status null,
  // which is retryable — so without an explicit guard a cancel would be
  // answered with a fresh round of retries instead of stopping.
  it('does not retry a call that was aborted', async () => {
    const ac = new AbortController();
    const slept: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          ac.abort(); // cancelled while this call was in flight
          throw new ProviderError(null, 'aborted', 'openai');
        },
        { sleep: async (ms) => void slept.push(ms), signal: ac.signal },
      ),
    ).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it('still retries a transport failure when NOT aborted', async () => {
    const ac = new AbortController();
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new ProviderError(null, 'socket hang up', 'openai');
        return 'ok';
      },
      { sleep: async () => undefined, signal: ac.signal },
    );
    expect(calls).toBe(2);
  });
});

describe('the loop treats an abort as cancellation (D49i)', () => {
  it('ends as cancelled, not as a failure, and does not throw', async () => {
    const ctrl = new RunController();
    let signalReady!: () => void;
    const ready = new Promise<void>((r) => {
      signalReady = r;
    });
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        signalReady();
        return new Promise<TurnResponse>((_, reject) => {
          if (req.signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    };
    const run = runAgentLoop({
      root: process.cwd(),
      task: 'test task',
      getMode: () => 'edit' as const,
      approve: () => Promise.resolve(true),
      model: 'anthropic:claude-sonnet-4-5',
      provider: p,
      controller: ctrl,
    });
    await ready;
    ctrl.cancel();
    const r = await run;
    expect(r.reason).toBe('cancelled');
  });
});

describe('the signal reaches the transport (D49i)', () => {
  it('the OpenAI adapter passes it to fetch', async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const p = createProvider('openai', {
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1/',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await p.completeTurn({
      model: 'openai:gpt-4o',
      system: 'S',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      tools: [],
      maxTokens: 10,
      signal: ac.signal,
    });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(ac.signal);
  });

  it('the Anthropic adapter passes it to the SDK', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });
    const ac = new AbortController();
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn({
      model: 'anthropic:claude-sonnet-4-5',
      system: 'S',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      tools: [],
      maxTokens: 10,
      signal: ac.signal,
    });
    // The SDK takes request options as the SECOND argument.
    expect(mockCreate.mock.calls[0]![1]).toEqual({ signal: ac.signal });
  });
});
