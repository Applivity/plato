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
  it('auto-continues a truncated answer and completes on the resumption', async () => {
    // Turn 1 gets cut mid-sentence by the token cap. The loop must NOT end
    // there: it asks the model to resume, then the continuation finishes.
    const p = provider([
      {
        content: [{ type: 'text', text: 'The top bug is ' }],
        usage: { inputTokens: 10, outputTokens: 16384 },
        stopReason: 'max_tokens',
      },
      {
        content: [{ type: 'text', text: "in saveHttpHeaderValues." }],
        usage: { inputTokens: 20, outputTokens: 5 },
        stopReason: 'stop',
      },
    ]);
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('complete');
    expect(r.truncated).toBeFalsy();
    expect(r.finalText).toContain('The top bug is');
    expect(r.finalText).toContain('saveHttpHeaderValues');
    // Two API calls happened: the truncation + one continuation.
    expect(p.seenMaxTokens.length).toBe(2);
  });

  it('reports a double-truncated answer as a token-cap, never silent complete', async () => {
    // Continuation is also truncated (no tool calls): give up, mark cap.
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        { content: [], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
        { content: [], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
      ]),
    });
    expect(r.reason).toBe('cap');
    expect(r.truncated).toBe(true);
    expect(r.finalText).toContain('token cap');
  });

  it('auto-continues at most once — truncating forever does not loop', async () => {
    // First truncation triggers a continuation; a second truncation ends it.
    const p = provider([
      { content: [{ type: 'text', text: 'part ' }], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
      { content: [{ type: 'text', text: ' more ' }], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
    ]);
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('cap');
    expect(r.truncated).toBe(true);
    // Exactly two API calls, not three+.
    expect(p.seenMaxTokens.length).toBe(2);
  });

  it('reports a truncated no-tool turn that never completes as a cap', async () => {
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        { content: [], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
        { content: [], usage: { inputTokens: 10, outputTokens: 16384 }, stopReason: 'max_tokens' },
      ]),
    });
    expect(r.reason).toBe('cap');
    expect(r.finalText).toContain('token cap');
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

  it('routes ask_user to the callback and passes the answer as a tool_result', async () => {
    let capturedReq: TurnRequest | undefined;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        capturedReq = req;
        // First turn: model calls ask_user
        if (req.messages.length === 1) {
          return {
            content: [{
              type: 'tool_use',
              id: 'ask_1',
              name: 'ask_user',
              input: {
                questions: [{
                  question: 'Which path?',
                  options: ['A', 'B']
                }]
              }
            }],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: 'tool_use'
          };
        }
        // Second turn: model gets the answer and stops
        return {
          content: [{ type: 'text', text: 'got it' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop'
        };
      }
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      askUser: async (req) => {
        expect(req.questions.length).toBe(1);
        expect(req.questions[0]!.question).toBe('Which path?');
        expect(req.questions[0]!.options).toEqual(['A', 'B']);
        return ['I prefer B'];
      }
    });
    expect(r.reason).toBe('complete');
    
    // Check that the tool_result made it back to the model
    const userMsg = capturedReq?.messages.find(m => m.role === 'user' && m.content.some(c => c.type === 'tool_result'));
    expect(userMsg).toBeDefined();
    const result = userMsg?.content.find(c => c.type === 'tool_result' && (c as any).toolUseId === 'ask_1') as any;
    expect(result.content).toBe('I prefer B');
    expect(result.isError).toBe(false);
  });

  it('supports multiple questions in one ask_user call', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [{
              type: 'tool_use',
              id: 'ask_multi',
              name: 'ask_user',
              input: {
                questions: [
                  { question: 'Approach?', options: ['A', 'B'] },
                  { question: 'Framework?', context: 'pick a stack', options: ['X', 'Y'] }
                ]
              }
            }],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: 'tool_use'
          };
        }
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop'
        };
      }
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      askUser: async (req) => {
        expect(req.questions.length).toBe(2);
        expect(req.questions[1]!.context).toBe('pick a stack');
        return ['Approach A', 'Framework Y'];
      }
    });
    expect(r.reason).toBe('complete');
    expect(r.finalText).toBe('done');
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
