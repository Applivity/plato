import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus, RunController } from '../src/runtime/bus.js';
import type {
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

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
  getMode: () => 'edit' as const,
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

  /**
   * D49ah, and the assertion the whole phase turns on: **the model is handed its
   * own plan back on the next turn.** The plan is what keeps a long run coherent
   * — the founder's runs reach 78 turns now that no cap exists (D49ab) — and it
   * only does that if the list is IN the conversation the next request carries,
   * not merely drawn in a panel beside it.
   */
  it('hands the model its own plan back on the next turn (D49ah)', async () => {
    let second: TurnRequest | undefined;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'plan_1',
                name: 'todo_write',
                input: {
                  todos: [
                    { content: 'Read the utility', status: 'completed' },
                    { content: 'Fix the formatter', status: 'in_progress' },
                    { content: 'Add a test', status: 'pending' },
                  ],
                },
              },
            ],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: 'tool_use',
          };
        }
        second = req;
        return {
          content: [{ type: 'text', text: 'carrying on' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('complete');

    const block = second?.messages
      .flatMap((m) => m.content)
      .find(
        (c): c is Extract<typeof c, { type: 'tool_result' }> =>
          c.type === 'tool_result' && c.toolUseId === 'plan_1',
      );
    expect(block).toBeDefined();
    expect(block!.isError).toBe(false);
    // The rendered list, item order and state included — the same string the
    // panel draws, so the two cannot disagree about what the plan is.
    expect(block!.content).toContain('[x] Read the utility');
    expect(block!.content).toContain('[>] Fix the formatter');
    expect(block!.content).toContain('[ ] Add a test');
    expect(block!.content).toContain('3 items, 1 done');
  });

  it('refuses a malformed plan without ending the run (D49ah)', async () => {
    let second: TurnRequest | undefined;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'plan_bad',
                name: 'todo_write',
                input: { todos: [{ content: 'Fix it', status: 'nearly' }] },
              },
            ],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: 'tool_use',
          };
        }
        second = req;
        return {
          content: [{ type: 'text', text: 'noted' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({ ...BASE, provider: p });
    // A refusal is a turn the model can correct, not a dead run.
    expect(r.reason).toBe('complete');
    const block = second?.messages
      .flatMap((m) => m.content)
      .find(
        (c): c is Extract<typeof c, { type: 'tool_result' }> =>
          c.type === 'tool_result' && c.toolUseId === 'plan_bad',
      );
    expect(block!.isError).toBe(true);
    expect(block!.content).toMatch(/pending, in_progress or completed/);
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

  // D49w: a known model gets its OWN limit. This asserted 16384, which was
  // Plato's invented ceiling — the test's name said "the full default" while
  // it pinned the cap that contradicted it. That ceiling truncated the
  // founder's run at exactly 16,384 output tokens.
  it('gives a higher-cap model its own limit, not Plato\'s ceiling (sonnet)', async () => {
    const p = provider([
      { content: [{ type: 'text', text: 'ok' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop' },
    ]);
    await runAgentLoop({
      ...BASE,
      model: 'anthropic:claude-sonnet-4-5',
      provider: p,
    });
    expect(p.seenMaxTokens[0]).toBe(64000);
  });
});

describe('runAgentLoop context + compaction (D37)', () => {
  it('emits a context event before every turn', async () => {
    // One-turn run: the assistant returns plain text and the loop
    // completes. We just verify a `context` event fires before the
    // model call and carries the right shape.
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 5, outputTokens: 2 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const events: { type: string; turn: number; total: number; maxContext: number | null; lastInputTokens?: number }[] = [];
    bus.on((e) => {
      if (e.type === 'context') {
        events.push({
          type: 'context',
          turn: e.turn,
          total: e.total,
          maxContext: e.maxContext,
          lastInputTokens: e.lastInputTokens,
        });
      }
    });
    await runAgentLoop({ ...BASE, provider: p, bus });
    expect(events.length).toBe(1);
    expect(events[0]?.turn).toBe(1);
    expect(events[0]?.total).toBeGreaterThan(0);
    // Catalog has haiku at 200k; first turn has no lastInputTokens.
    expect(events[0]?.maxContext).toBe(200_000);
    expect(events[0]?.lastInputTokens).toBeUndefined();
  });

  it('auto-compacts when the estimate crosses the threshold', async () => {
    let summariseCalls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        if (req.system.startsWith('You are a context compactor')) {
          summariseCalls += 1;
          return {
            content: [{ type: 'text', text: 'summary' }],
            usage: { inputTokens: 50, outputTokens: 10 },
            stopReason: 'stop',
          };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const compacted: { mode: 'manual' | 'auto'; before: number; after: number } = {
      mode: 'manual',
      before: 0,
      after: 0,
    };
    let compactedSeen = false;
    bus.on((e) => {
      if (e.type === 'context-compacted') {
        compacted.mode = e.mode;
        compacted.before = e.beforeTokens;
        compacted.after = e.afterTokens;
        compactedSeen = true;
      }
    });
    // Use a model id NOT in the catalog so the loop falls back to
    // UNKNOWN_CONTEXT_FLOOR (8192). With threshold 0.5 the trip point
    // is 4096 — a 10×2000-char history easily blows past it.
    await runAgentLoop({
      ...BASE,
      model: 'litellm:totally-unknown-model',
      provider: p,
      bus,
      history: [
        { role: 'user', text: 'a'.repeat(2_000) },
        { role: 'assistant', text: 'b'.repeat(2_000) },
        { role: 'user', text: 'c'.repeat(2_000) },
        { role: 'assistant', text: 'd'.repeat(2_000) },
        { role: 'user', text: 'e'.repeat(2_000) },
        { role: 'assistant', text: 'f'.repeat(2_000) },
        { role: 'user', text: 'g'.repeat(2_000) },
        { role: 'assistant', text: 'h'.repeat(2_000) },
        { role: 'user', text: 'i'.repeat(2_000) },
        { role: 'assistant', text: 'j'.repeat(2_000) },
      ],
      compact: { mode: 'auto', threshold: 0.5 },
    });
    expect(summariseCalls).toBeGreaterThanOrEqual(1);
    expect(compactedSeen).toBe(true);
    expect(compacted.mode).toBe('auto');
    expect(compacted.before).toBeGreaterThan(compacted.after);
  });

  it('compacts on controller.requestCompact() in manual mode', async () => {
    let summariseCalls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        if (req.system.startsWith('You are a context compactor')) {
          summariseCalls += 1;
          return {
            content: [{ type: 'text', text: 's' }],
            usage: { inputTokens: 5, outputTokens: 2 },
            stopReason: 'stop',
          };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const controller = new RunController();
    let mode: 'manual' | 'auto' | null = null;
    bus.on((e) => {
      if (e.type === 'context-compacted') {
        mode = e.mode;
      }
    });
    controller.requestCompact();
    await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      controller,
      compact: { mode: 'manual' },
      history: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' },
        { role: 'user', text: 'do it' },
      ],
    });
    expect(summariseCalls).toBe(1);
    expect(mode).toBe('manual');
  });

  it('manual mode never auto-triggers even when the estimate is high', async () => {
    let summariseCalls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        if (req.system.startsWith('You are a context compactor')) {
          summariseCalls += 1;
          return {
            content: [{ type: 'text', text: 's' }],
            usage: { inputTokens: 5, outputTokens: 2 },
            stopReason: 'stop',
          };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({
      ...BASE,
      provider: p,
      compact: { mode: 'manual' },
      history: [
        { role: 'user', text: 'a'.repeat(400) },
        { role: 'assistant', text: 'b'.repeat(400) },
        { role: 'user', text: 'c'.repeat(400) },
        { role: 'assistant', text: 'd'.repeat(400) },
      ],
    });
    expect(summariseCalls).toBe(0);
  });

  it('continues the run when a compaction call fails', async () => {
    let summariseCalls = 0;
    let mainCalls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        if (req.system.startsWith('You are a context compactor')) {
          summariseCalls += 1;
          throw new Error('summariser down');
        }
        mainCalls += 1;
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const controller = new RunController();
    controller.requestCompact();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') {
        notices.push(e.text);
      }
    });
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      controller,
      compact: { mode: 'manual' },
      history: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
        { role: 'user', text: 'do thing' },
      ],
    });
    expect(summariseCalls).toBe(1);
    expect(mainCalls).toBe(1);
    expect(r.reason).toBe('complete');
    expect(notices.join(' ')).toMatch(/compaction failed/);
  });
});

describe('runAgentLoop worker system prompt (D45a)', () => {
  function capturingProvider(): ChatProvider & { seenSystem: string[] } {
    const seenSystem: string[] = [];
    return {
      id: 'anthropic',
      seenSystem,
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        seenSystem.push(req.system);
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
  }

  it('sends DEFAULT_PLATO_BODY when no project files exist', async () => {
    const { DEFAULT_PLATO_BODY } = await import('../src/runtime/workerRole.js');
    const p = capturingProvider();
    // BASE.root = process.cwd(). The Plato repo has no PLATO.md/AGENTS.md
    // at the root, so the bundled default is the PLATO layer. The join
    // is empty-override + default + missing-AGENTS, so the system string
    // is just the default PLATO body.
    await runAgentLoop({ ...BASE, provider: p });
    expect(p.seenSystem.length).toBeGreaterThan(0);
    expect(p.seenSystem[0]).toContain(DEFAULT_PLATO_BODY);
  });

  it('appends opts.role to the joined worker prompt when present', async () => {
    const { DEFAULT_PLATO_BODY } = await import('../src/runtime/workerRole.js');
    const p = capturingProvider();
    await runAgentLoop({
      ...BASE,
      provider: p,
      role: 'YOU ARE A FIX-BOT',
    });
    // Override is layered on top of the default PLATO body.
    expect(p.seenSystem[0]).toContain('YOU ARE A FIX-BOT');
    expect(p.seenSystem[0]).toContain(DEFAULT_PLATO_BODY);
    expect(p.seenSystem[0]!.indexOf('YOU ARE A FIX-BOT')).toBeLessThan(
      p.seenSystem[0]!.indexOf(DEFAULT_PLATO_BODY),
    );
  });
});

/**
 * D49k. The executor is the guarantee; this is the courtesy. A path that leaves
 * the workspace must be refused BEFORE the user is asked to approve an action
 * that could never run — in `act` mode a write is `ask`, so without the
 * pre-flight check the card would appear and then fail.
 */
describe('runAgentLoop workspace containment (D49k)', () => {
  it('refuses an escaping path without asking the user to approve it', async () => {
    let approvals = 0;
    const refusals: string[] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'w1',
                name: 'write_file',
                input: { path: '../../escape.ts', content: 'x' },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        for (const b of req.messages[req.messages.length - 1]!.content) {
          if (b.type === 'tool_result') refusals.push(b.content);
        }
        return {
          content: [{ type: 'text', text: 'understood' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const refused: { tool: string; reason?: string; args?: unknown }[] = [];
    bus.on((e) => {
      if (e.type === 'tool-event' && e.phase === 'refused') {
        refused.push({
          tool: e.tool,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
          args: e.args,
        });
      }
    });
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      approve: () => {
        approvals += 1;
        return Promise.resolve(true);
      },
    });
    expect(r.reason).toBe('complete');
    // The card never appeared, and the model was told why.
    expect(approvals).toBe(0);
    expect(refusals.join(' ')).toContain('outside the workspace');
    // D49aq: and the refusal is now AUDIBLE. It used to emit nothing at all, so
    // the transcript could not tell "the guard refused this" from "the model
    // never called a tool" — the two produced the same empty file.
    // D49as: it carries `args` too, LIKE EVERY OTHER tool-event. That is not
    // decoration: the host bridge (`onToolEvent`) forwards only an event that
    // has args, so without this the live log could never be told about a
    // refusal — which is exactly why the guard was invisible in the chat while
    // the transcript view showed it. A revert to an args-less event breaks this
    // assertion AND the live line.
    expect(refused).toEqual([
      {
        tool: 'write_file',
        reason: 'containment',
        args: { path: '../../escape.ts', content: 'x' },
      },
    ]);
  });

  it('runs a read-only shell command in edit with no card at all (D49an)', async () => {
    let approvals = 0;
    const declined: string[] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [{ type: 'tool_use', id: 's1', name: 'shell', input: { command: 'ls' } }],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        for (const b of req.messages[req.messages.length - 1]!.content) {
          if (b.type === 'tool_result') declined.push(b.content);
        }
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE, // BASE is `edit`
      provider: p,
      approve: () => {
        approvals += 1;
        return Promise.resolve(false); // a denial, so a card WOULD be visible
      },
    });
    expect(r.reason).toBe('complete');
    // This is the whole feature: no card, and the command was not declined.
    expect(approvals).toBe(0);
    expect(declined.join(' ')).not.toContain('user declined');
  });

  /**
   * D49an. The read-only-shell allowance makes `cat keystore.properties` an
   * `allow`, because reading is all it does. **What stops it is the ORDER:** the
   * secret refusal runs before the mode decision, so the command is refused
   * outright and — unlike before the allowance existed — no approval card is even
   * shown for it. This asserts the order end-to-end, which is the only place it
   * can be observed; the unit test in `readOnlyShell.test.ts` pins the pairing
   * from the other side.
   */
  it('refuses a read-only shell command that names a protected file, without asking (D49an)', async () => {
    let approvals = 0;
    const refusals: string[] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 's1',
                name: 'shell',
                // Read-only by every rule in the allowlist, and it names a
                // protected file — so the allowlist alone would let it run.
                input: { command: 'cat keystore.properties' },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        for (const b of req.messages[req.messages.length - 1]!.content) {
          if (b.type === 'tool_result') refusals.push(b.content);
        }
        return {
          content: [{ type: 'text', text: 'understood' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const refused: { tool: string; reason?: string; args?: unknown }[] = [];
    bus.on((e) => {
      if (e.type === 'tool-event' && e.phase === 'refused') {
        refused.push({
          tool: e.tool,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
          args: e.args,
        });
      }
    });
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      approve: () => {
        approvals += 1;
        return Promise.resolve(true);
      },
    });
    expect(r.reason).toBe('complete');
    expect(approvals).toBe(0);
    expect(refusals.join(' ')).toContain('protected file');
    // D49aq: the reason code distinguishes the two guards.
    // D49as: the arguments ride the bus like every other tool-event, and the
    // transcript still strips them (D24c) — the command text never reaches the
    // file. They must be HERE, because the host bridge forwards only an event
    // that has them, which is what makes the refusal visible in the live chat.
    expect(refused).toEqual([
      { tool: 'shell', reason: 'secret', args: { command: 'cat keystore.properties' } },
    ]);
  });

  it('still asks before an ordinary in-workspace write', async () => {
    let approvals = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'w1',
                name: 'write_file',
                input: { path: 'plato-containment-probe.tmp', content: 'x' },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({
      ...BASE,
      provider: p,
      approve: () => {
        approvals += 1;
        return Promise.resolve(false); // decline: do not litter the repo
      },
    });
    expect(approvals).toBe(1);
  });
});

/**
 * D49l. Approving an apply_patch must show every file it will change — the
 * safety argument for approving a write is seeing what changes, and a
 * multi-file patch approved blind would be worse than a single-file one.
 */
describe('runAgentLoop apply_patch preview (D49l)', () => {
  it('previews every file in the patch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plato-patch-preview-'));
    writeFileSync(join(root, 'a.ts'), 'alpha\n');
    writeFileSync(join(root, 'b.ts'), 'beta\n');
    let preview = '';
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'p1',
                name: 'apply_patch',
                input: {
                  patches: [
                    { path: 'a.ts', diffs: [{ search: 'alpha', replace: 'ALPHA' }] },
                    { path: 'b.ts', diffs: [{ search: 'beta', replace: 'BETA' }] },
                  ],
                },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      // Decline: the preview is the assertion, and nothing must be written.
      approve: (req) => {
        preview = req.preview ?? '';
        return Promise.resolve(false);
      },
    });
    expect(preview).toContain('a.ts');
    expect(preview).toContain('b.ts');
    expect(preview).toContain('- alpha');
    expect(preview).toContain('+ ALPHA');
    expect(preview).toContain('- beta');
    expect(preview).toContain('+ BETA');
    // Declined, so the files are untouched.
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('alpha\n');
  });
});

/**
 * D49m. A background shell must not outlive its run: there is no UI that lists
 * them, so one left behind is invisible and unstoppable — the user would have
 * to hunt the process list for whatever still holds a port.
 */
describe('runAgentLoop background shell teardown (D49m)', () => {
  it('stops background shells at the end of the run, and records it', async () => {
    const bus = new AgentBus();
    const seen: string[] = [];
    bus.on((e) => {
      if (e.type === 'shell-event') seen.push(`${e.phase}:${e.id}`);
      if (e.type === 'notice' && e.text.includes('background shell')) {
        seen.push('notice');
      }
    });
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 's1',
                name: 'shell',
                input: { command: 'sleep 20', run_in_background: true },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'started' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      getMode: () => 'auto' as const,
    });
    expect(r.reason).toBe('complete');
    // Started, then killed with the run, then reported.
    expect(seen).toEqual(['started:1', 'exited:1', 'notice']);
  });

  it('reports no notice when nothing was left running', async () => {
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
    });
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'nothing to do' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({ ...BASE, provider: p, bus, getMode: () => 'auto' as const });
    expect(notices.filter((n) => n.includes('background shell'))).toEqual([]);
  });
});

/**
 * D49p: `web_fetch` follows its own redirects (execute.ts). The loop's only
 * web_fetch-specific job is to tell the shell WHICH HOST an approval covers, so
 * a session approval cannot silently widen from a host to the whole tool.
 */
describe('web_fetch approvals carry a host (D49p)', () => {
  it('reports the host of the URL being approved', async () => {
    let calls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        calls += 1;
        return calls === 1
          ? {
              content: [
                {
                  type: 'tool_use',
                  id: 'w1',
                  name: 'web_fetch',
                  input: { url: 'https://docs.example.com/x' },
                },
              ],
              usage: { inputTokens: 5, outputTokens: 5 },
              stopReason: 'tool_use',
            }
          : {
              content: [{ type: 'text', text: 'done' }],
              usage: { inputTokens: 5, outputTokens: 5 },
              stopReason: 'stop',
            };
      },
    };
    const seen: (string | undefined)[] = [];
    await runAgentLoop({
      ...BASE,
      provider: p,
      approve: (req) => {
        seen.push(req.host);
        return Promise.resolve(false);
      },
    });
    expect(seen).toEqual(['docs.example.com']);
  });

  // A tool that contacts nobody must not acquire a host, or its session
  // approval would be keyed on an empty string and stop matching.
  it('gives no host to a tool that contacts nobody', async () => {
    let calls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        calls += 1;
        return calls === 1
          ? {
              content: [
                {
                  type: 'tool_use',
                  id: 's1',
                  name: 'shell',
                  // A command that still asks. `echo hi` used to sit here, and
                  // D49an made it auto-approved in `edit` — which is correct and
                  // would have left this test asserting a card that no longer
                  // appears. The subject here is the HOST field, so any asking
                  // tool serves.
                  input: { command: 'npm run build' },
                },
              ],
              usage: { inputTokens: 5, outputTokens: 5 },
              stopReason: 'tool_use',
            }
          : {
              content: [{ type: 'text', text: 'done' }],
              usage: { inputTokens: 5, outputTokens: 5 },
              stopReason: 'stop',
            };
      },
    };
    const seen: (string | undefined)[] = [];
    await runAgentLoop({
      ...BASE,
      provider: p,
      approve: (req) => {
        seen.push(req.host);
        return Promise.resolve(false);
      },
    });
    expect(seen).toEqual([undefined]);
  });
});

/**
 * Reproduces the SECOND real-run crash (2026-09-22, DeepSeek via LiteLLM):
 *
 *   openai HTTP 400: Invalid assistant message: content or tool_calls must be set
 *
 * A turn cut by the output cap that produced NO visible content (a reasoning
 * model can spend the whole budget on tokens Plato does not read) was still
 * recorded as an assistant message. The loop then pushed its "continue exactly
 * where you left off" instruction and sent the pair — and the assistant turn
 * carried neither text nor a tool call, which the wire contract forbids.
 *
 * It also exposed a semantic fault underneath: there was nothing to continue
 * from. Asking a model to resume where it left off, when it left off nowhere,
 * is a request that cannot succeed.
 */
describe('a turn that produced nothing is never sent (D49s)', () => {
  const emptyTurn = (): TurnResponse => ({
    content: [],
    usage: { inputTokens: 10, outputTokens: 16384 },
    stopReason: 'max_tokens',
  });

  it('ends as a cap instead of continuing from an empty turn', async () => {
    let calls = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        calls += 1;
        return calls === 1
          ? emptyTurn()
          : {
              content: [{ type: 'text', text: 'resumed' }],
              usage: { inputTokens: 10, outputTokens: 5 },
              stopReason: 'stop',
            };
      },
    };
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('cap');
    // The point: no second request was made, so no invalid turn was sent.
    expect(calls).toBe(1);
    expect(r.finalText).toContain('token cap');
  });

  it('never sends an assistant turn with neither text nor a tool call', async () => {
    let calls = 0;
    const requests: { role: string; content: { type: string }[] }[][] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        // SNAPSHOT, not the live array: the loop keeps mutating `messages`
        // after this call returns, so holding the reference would assert
        // against post-run state rather than against what was actually sent.
        requests.push(JSON.parse(JSON.stringify(req.messages)) as never);
        calls += 1;
        if (calls === 1) return emptyTurn();
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({ ...BASE, provider: p });
    for (const msgs of requests) {
      for (const m of msgs) {
        if (m.role !== 'assistant') continue;
        expect(
          m.content.some((b) => b.type === 'text' || b.type === 'tool_use'),
          'an assistant turn carried nothing',
        ).toBe(true);
      }
    }
  });
});

/**
 * D49t: the loop used to resolve the context window from the shipped catalog
 * only — so a LiteLLM group or a self-hosted model was unknown and got the
 * 8192 floor. Compaction then tripped after three files, and the output cap it
 * sent was 8192, which a reasoning model exhausts on thinking alone.
 *
 * These pin the wire, not the parsing (discover.test.ts covers that).
 */
describe('advertised model limits reach the run (D49t)', () => {
  const textTurn = (): TurnResponse => ({
    content: [{ type: 'text', text: 'ok' }],
    usage: { inputTokens: 5, outputTokens: 5 },
    stopReason: 'stop',
  });

  /** Runs one turn and reports what the loop decided. */
  async function observe(advertised?: {
    context?: number;
    maxOutput?: number;
  }): Promise<{ maxContext: number | null; maxTokens: number }> {
    const bus = new AgentBus();
    let seenCtx: number | null = null;
    bus.on((e) => {
      if (e.type === 'context') seenCtx = e.maxContext;
    });
    let maxTokens = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        maxTokens = req.maxTokens;
        return textTurn();
      },
    };
    await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      // A name the catalog has never heard of — the LiteLLM case.
      model: 'litellm:Auto-Act',
      getMode: () => 'auto' as const,
      ...(advertised ? { advertised } : {}),
    });
    return { maxContext: seenCtx, maxTokens };
  }

  // Nothing known stays REPORTED as unknown — `null` is what makes the header
  // say "ctx unknown" rather than inventing a number. The conservative floor is
  // applied deeper, inside shouldAutoCompact, where it decides timing only.
  it('reports unknown, and runs on the floor, when nothing was advertised', async () => {
    const r = await observe();
    expect(r.maxContext).toBeNull();
    expect(r.maxTokens).toBe(8192);
  });

  it('uses the window the connection reported', async () => {
    const r = await observe({ context: 163840, maxOutput: 64000 });
    expect(r.maxContext).toBe(163840);
    // D49w: the model's own limit, used as given. This used to be clamped to
    // Plato's 16,384 — the ceiling that truncated the founder's run at exactly
    // 16,384 output tokens after it had spent the budget thinking.
    expect(r.maxTokens).toBe(64000);
  });

  /**
   * The conservative direction: a connection may serve LESS than the model can
   * hold. Believing the larger number means sending more than it accepts.
   */
  it('takes the smaller when the catalog and the connection disagree', async () => {
    const bus = new AgentBus();
    let seenCtx: number | null = null;
    bus.on((e) => {
      if (e.type === 'context') seenCtx = e.maxContext;
    });
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return textTurn();
      },
    };
    await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      model: 'anthropic:claude-sonnet-4-5', // catalog says 200000
      getMode: () => 'auto' as const,
      advertised: { context: 32768 },
    });
    expect(seenCtx).toBe(32768);
  });
});

/**
 * D49ab. `MAX_TURNS = 40` bounded every run and **no test ever described it** —
 * which is why removing it broke nothing and why it survived three weeks of
 * changes unchallenged. What it cost was real: a run in `edit` mode was stopped
 * at turn 40 with a third of its task untouched, after the user had approved
 * eleven writes. The user was the backstop and the cap fired anyway.
 *
 * The run now ends when the model stops calling tools. These pin that, so a
 * future count cannot come back without a test failing.
 */
describe('a run is not bounded by a turn count (D49ab)', () => {
  const toolTurn = (n: number): TurnResponse => ({
    content: [{
      type: 'tool_use',
      id: 'call_' + n,
      name: 'read_file',
      input: { path: 'packages/core/package.json' },
    }],
    usage: { inputTokens: 10, outputTokens: 10 },
    stopReason: 'tool_use',
  });

  it('keeps working past 40 turns while the model still calls tools', async () => {
    const TURNS = 55; // well past the old 40
    let served = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        served += 1;
        return served <= TURNS ? toolTurn(served) : {
          content: [{ type: 'text', text: 'finished at last' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus: new AgentBus(),
      controller: new RunController(),
      getMode: () => 'auto' as const,
    });
    expect(r.reason).toBe('complete');
    expect(r.turns).toBe(TURNS + 1);
    expect(r.finalText).toBe('finished at last');
  });

  it('never reports a turn cap — only a truncated answer is a cap', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus: new AgentBus(),
      controller: new RunController(),
      getMode: () => 'auto' as const,
    });
    expect(r.reason).toBe('complete');
    expect(r.finalText).not.toContain('turn cap');
  });
});
