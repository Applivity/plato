import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/runtime/loop.js';
import type { ChatProvider, TurnRequest, TurnResponse } from '../src/providers/types.js';

function provider(turns: TurnResponse[]): ChatProvider & { seenMaxTokens: number[] } {
  let i = 0;
  const seenMaxTokens: number[] = [];
  return {
    id: 'anthropic',
    seenMaxTokens,
    async completeTurn(req: TurnRequest): Promise<TurnResponse> {
      seenMaxTokens.push(req.maxTokens);
      if (i >= turns.length) {
        throw new Error('unexpected extra turn');
      }
      return turns[i++]!;
    },
  };
}

const BASE = {
  root: process.cwd(),
  task: 'test task',
  getMode: () => 'act' as const,
  approve: () => Promise.resolve(true),
  model: 'anthropic:claude-3-5-haiku-latest',
};

describe('runAgentLoop truncation handling', () => {
  it('reports a truncated no-tool turn as a cap, never a silent complete', async () => {
    // Reproduces the founder trial: thinking ate the whole output budget,
    // so the turn had no text and no tool calls, and the provider flagged
    // the token cap. The run must not claim a complete answer.
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        {
          content: [],
          usage: { inputTokens: 10, outputTokens: 16384 },
          stopReason: 'max_tokens',
        },
      ]),
    });
    expect(r.reason).toBe('cap');
    expect(r.finalText).toContain('token cap');
  });

  it('reports a partial answer cut by the token cap as a cap with a note', async () => {
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        {
          content: [{ type: 'text', text: 'The top bug is ' }],
          usage: { inputTokens: 10, outputTokens: 16384 },
          stopReason: 'max_tokens',
        },
      ]),
    });
    expect(r.reason).toBe('cap');
    expect(r.finalText).toContain('token cap');
    expect(r.finalText).toContain('The top bug is ');
  });

  it('still reports a natural text-only turn as complete', async () => {
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        {
          content: [{ type: 'text', text: 'all done' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        },
      ]),
    });
    expect(r.reason).toBe('complete');
    expect(r.finalText).toBe('all done');
  });

  it('clamps maxTokens to the model hard cap (haiku 8192), never above', async () => {
    const p = provider([
      { content: [{ type: 'text', text: 'ok' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop' },
    ]);
    await runAgentLoop({
      ...BASE,
      model: 'anthropic:claude-3-5-haiku-latest',
      provider: p,
    });
    expect(p.seenMaxTokens[0]).toBe(8192);
  });

  it('allows the full default for models with a higher cap (sonnet)', async () => {
    const p = provider([
      { content: [{ type: 'text', text: 'ok' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop' },
    ]);
    await runAgentLoop({
      ...BASE,
      model: 'anthropic:claude-sonnet-4-5',
      provider: p,
    });
    expect(p.seenMaxTokens[0]).toBe(16384);
  });
});
