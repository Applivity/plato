import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/runtime/loop.js';
import type { ChatProvider, TurnRequest, TurnResponse } from '../src/providers/types.js';

function provider(turns: TurnResponse[]): ChatProvider {
  let i = 0;
  return {
    id: 'anthropic',
    async completeTurn(_req: TurnRequest): Promise<TurnResponse> {
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
});
