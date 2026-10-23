import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentLoop, resolveRecommended } from '../src/runtime/loop.js';
import { AgentBus, RunController } from '../src/runtime/bus.js';
import { createVault, placeholder } from '../src/security/mask.js';
import { isWindows } from '../src/tools/shellPlatform.js';
import { LONG_RUNNING, nodeCommand, readMatching } from './portable.js';
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

  it('keeps the resumed text in the sentence it was cut in', async () => {
    // The continuation is not a new paragraph: it is the same sentence, so the
    // accumulated text must not gain a break the model never wrote.
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        {
          content: [{ type: 'text', text: 'The top bug is ' }],
          usage: { inputTokens: 10, outputTokens: 16384 },
          stopReason: 'max_tokens',
        },
        {
          content: [{ type: 'text', text: 'in saveHttpHeaderValues.' }],
          usage: { inputTokens: 20, outputTokens: 5 },
          stopReason: 'stop',
        },
      ]),
    });
    expect(r.finalText).toBe('The top bug is in saveHttpHeaderValues.');
  });

  it('starts a new turn on its own line, so two turns do not read as one', async () => {
    // Turn 1 is narration before a tool call; turn 2 is the answer. Run
    // together, "I'll read the file.It is a …" is one broken sentence — and a
    // session saved from it cannot be told apart from a turn that never acted.
    const r = await runAgentLoop({
      ...BASE,
      provider: provider([
        {
          content: [
            { type: 'text', text: "I'll read the file." },
            { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
          ],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_use',
        },
        {
          content: [{ type: 'text', text: 'It is a helper class.' }],
          usage: { inputTokens: 20, outputTokens: 5 },
          stopReason: 'stop',
        },
      ]),
    });
    expect(r.finalText).toBe("I'll read the file.\nIt is a helper class.");
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

  /**
   * D49bh: the recommendation the model names, resolved against the options it
   * offered. The card used to compare the two strings EXACTLY, so a model that
   * abbreviated its own label recommended nothing, the marker silently vanished,
   * and nothing anywhere said so.
   */
  describe('a recommended option is resolved against the choices (D49bh)', () => {
    const OPTS = ['Keep signatures and correct minimally', 'Change and fix callers'];

    it('finds the option the model named exactly', () => {
      expect(resolveRecommended(OPTS, 'Change and fix callers')).toBe('Change and fix callers');
    });

    it('finds it when the spacing differs', () => {
      expect(resolveRecommended(OPTS, '  Change and fix callers ')).toBe('Change and fix callers');
    });

    it('finds it when the case differs — the common slip', () => {
      expect(resolveRecommended(OPTS, 'change AND fix callers')).toBe('Change and fix callers');
    });

    // The load-bearing one. Leniency that can pick a DIFFERENT option would put a
    // recommendation on screen that the model never made, which is worse than
    // showing none — so an ambiguous match resolves to nothing.
    it('refuses to choose when two options differ only in case', () => {
      expect(resolveRecommended(['Yes', 'yes'], 'yes')).toBeUndefined();
    });

    it('returns nothing for a name that matches no option', () => {
      expect(resolveRecommended(OPTS, 'Keep signatures')).toBeUndefined();
    });

    // A prefix is the tempting leniency, and it is the one that marks the wrong
    // option. It must not be accepted.
    it('does not accept a prefix of an option', () => {
      expect(resolveRecommended(OPTS, 'Change')).toBeUndefined();
    });

    it('returns nothing when the model recommended nothing', () => {
      expect(resolveRecommended(OPTS, undefined)).toBeUndefined();
      expect(resolveRecommended(OPTS, '   ')).toBeUndefined();
    });

    it('returns the OPTION string, so the card\'s own comparison still holds', () => {
      const opts = ['  Indented  '];
      const got = resolveRecommended(opts, 'indented');
      expect(got).toBe('  Indented  ');
      // Which is the point: strict equality against the option, as the view does.
      expect(opts.includes(got ?? '')).toBe(true);
    });
  });

  it('asks the question anyway when its recommendation names no option (D49bh)', async () => {
    let askedOptions: string[] | undefined;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [{
              type: 'tool_use',
              id: 'ask_rec',
              name: 'ask_user',
              input: {
                questions: [{
                  question: 'Which approach?',
                  options: ['Keep signatures and correct minimally', 'Change and fix callers'],
                  // Abbreviated its own label — the realistic miss.
                  recommended: 'Keep signatures',
                }],
              },
            }],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => { if (e.type === 'notice') { notices.push(e.text); } });

    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      askUser: async (req) => {
        askedOptions = req.questions[0]!.options;
        // The question is asked with every option intact; only the marker is gone.
        expect(req.questions[0]!.recommended).toBeUndefined();
        return ['Change and fix callers'];
      },
    });

    expect(r.reason).toBe('complete');
    // The ask happened — a missing marker must never withhold a question.
    expect(askedOptions).toEqual(['Keep signatures and correct minimally', 'Change and fix callers']);
    // And the drop is audible in the run record rather than silent.
    expect(notices.some((t) => /no recommendation was marked/.test(t))).toBe(true);
  });

  /**
   * D49bd: the tab label. Core's only job is to carry the model's one- or
   * two-word header to the host unchanged, and to turn a blank one into
   * nothing — the view then shows the question's number. Both halves are pinned
   * here because a blank header reaching the view would draw an empty pill, and
   * the view's fallback is what makes the field safe to add to the schema.
   */
  it('carries each question\'s short header through, and blanks it to undefined', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [{
              type: 'tool_use',
              id: 'ask_hdr',
              name: 'ask_user',
              input: {
                questions: [
                  { header: 'Contract', question: 'Change the signatures?', options: ['Yes', 'No'] },
                  { header: '   ', question: 'Any constraints?', options: ['None', 'Some'] },
                  { question: 'Which files?', options: ['A', 'B'] }
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
    let seen: Array<{ header?: string }> = [];
    await runAgentLoop({
      ...BASE,
      provider: p,
      askUser: async (req) => {
        seen = req.questions.map((q) => ({ header: q.header }));
        return ['Yes', 'None', 'A'];
      }
    });
    expect(seen[0]!.header).toBe('Contract');
    expect(seen[1]!.header).toBeUndefined();
    expect(seen[2]!.header).toBeUndefined();
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
    // D49bf: nothing advertised a window, and the shipped catalog no longer
    // claims one, so the event carries null and the UI says "ctx unknown"
    // rather than printing an assumption as a fact.
    expect(events[0]?.maxContext).toBeNull();
    expect(events[0]?.lastInputTokens).toBeUndefined();
  });

  it('carries the CONNECTION\'s window to the event, its only source (D49bf)', async () => {
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
    const seen: (number | null)[] = [];
    bus.on((e) => {
      if (e.type === 'context') seen.push(e.maxContext);
    });
    await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      advertised: { context: 131_072 },
    });
    expect(seen).toEqual([131_072]);
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
    // The window the connection ADVERTISED (D49bf: now the only source). At
    // 8000 with threshold 0.5 the trip point is 4000 — a 10×2000-char history
    // (about 5000 tokens) blows past it. Advertising it here rather than
    // leaning on a default keeps this test about the CROSSING, which is its
    // subject; the default has its own test below.
    await runAgentLoop({
      ...BASE,
      model: 'litellm:totally-unknown-model',
      provider: p,
      bus,
      advertised: { context: 8_000 },
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

  // D49bp: an empty summary used to be APPLIED — the older conversation was
  // dropped and replaced by nothing, and the run reported the compaction as
  // done. It must be reported and the context kept instead.
  it('keeps the conversation and reports it when the summariser returns nothing', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        if (req.system.startsWith('You are a context compactor')) {
          return {
            content: [],
            usage: { inputTokens: 50, outputTokens: 0 },
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
    const notices: string[] = [];
    let compactedSeen = false;
    let contextEvents = 0;
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
      if (e.type === 'context-compacted') compactedSeen = true;
      if (e.type === 'context') contextEvents += 1;
    });
    await runAgentLoop({
      ...BASE,
      model: 'litellm:totally-unknown-model',
      provider: p,
      bus,
      advertised: { context: 8_000 },
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
    expect(notices.join(' ')).toMatch(/no summary/);
    expect(compactedSeen).toBe(false);
    // A successful compaction re-emits `context` with the smaller total; a
    // declined one re-emits nothing, so the single pre-turn event stands.
    expect(contextEvents).toBe(1);
  });

  /**
   * D49bf: the default window is 128k, not 8,192. **This is the defect the
   * change exists to remove** — a run against an endpoint whose /models said
   * nothing used to fold a good session at about 6,500 tokens. The identical
   * history to the test above (about 5,000 tokens) now sits well under the line.
   *
   * Falsified by putting the old default back: with 8,192 the trip point is
   * 4,096 and this fails, which is what makes it a check rather than a comment.
   */
  it('does NOT auto-compact an unadvertised model at the OLD 8k trip point (D49bf)', async () => {
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
          usage: { inputTokens: 5, outputTokens: 2 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({
      ...BASE,
      model: 'litellm:totally-unknown-model',
      provider: p,
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
    expect(summariseCalls).toBe(0);
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

  // POSIX only: the read-only allowlist is a bash parser (M0, D49cf). On
  // Windows it is not consulted at all, and the sibling test below covers edit.
  it.skipIf(isWindows())('runs a read-only shell command in edit with no card at all (D49an)', async () => {
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
   * M0 (D49cf). The other half of the same rule: on Windows `edit` asks for
   * EVERY shell command, including one that looks read-only, because the bash
   * allowlist cannot describe `cmd.exe`. An approval still runs it.
   */
  it.skipIf(!isWindows())('asks for a shell command in edit on Windows, and runs it (M0)', async () => {
    let approvals = 0;
    const results: string[] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'e1',
                name: 'shell',
                input: { command: nodeCommand("console.log('ran')") },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        for (const b of req.messages[req.messages.length - 1]!.content) {
          if (b.type === 'tool_result') results.push(b.content);
        }
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      getMode: () => 'edit',
      platform: 'win32',
      approve: () => {
        approvals += 1;
        return Promise.resolve(true);
      },
    });
    expect(r.reason).toBe('complete');
    expect(approvals).toBe(1);
    expect(results.join(' ')).toContain('ran');
  });

  /**
   * M0 (D49cf). On Windows, plan denies EVERY shell command and draws no card,
   * because the bash allowlist cannot describe `cmd.exe`. The refusal must say
   * why, so the model knows to use the file tools or switch mode instead of
   * retrying the same command.
   */
  it('denies every shell command in plan on Windows, and says why (M0)', async () => {
    let approvals = 0;
    const results: string[] = [];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        if (req.messages.length === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'w1', name: 'shell', input: { command: 'git status' } },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            stopReason: 'tool_use',
          };
        }
        for (const b of req.messages[req.messages.length - 1]!.content) {
          if (b.type === 'tool_result') results.push(b.content);
        }
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      getMode: () => 'plan',
      platform: 'win32',
      approve: () => {
        approvals += 1;
        return Promise.resolve(true);
      },
    });
    expect(r.reason).toBe('complete');
    expect(approvals).toBe(0);
    expect(results.join(' ')).toContain(
      'Plato cannot prove a command is read-only on Windows',
    );
    expect(results.join(' ')).toContain('switch to edit');
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
                input: { command: LONG_RUNNING, run_in_background: true },
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
  /**
   * **This stub must do DISTINCT work, and that is now load-bearing.** It used
   * to call `read_file` on the same path every turn, which returns byte-identical
   * text every time — 55 identical calls with identical results. The repetition
   * bound (D49aw) correctly reads that as a stuck run and stops it, so this test
   * failed the moment the bound landed.
   *
   * The bound was right and the stub was wrong: a real agent working through 55
   * turns advances a plan, and those calls differ. Keeping it distinct is what
   * makes this test prove BOTH claims at once — no turn count bounds a run, and
   * the repetition bound never fires on work that is actually going somewhere.
   * A stub that repeats itself would silently stop testing the first claim.
   */
  const toolTurn = (n: number): TurnResponse => ({
    content: [{
      type: 'tool_use',
      id: 'call_' + n,
      name: 'todo_write',
      input: { todos: [{ content: `step ${n}`, status: 'in_progress' }] },
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

/**
 * D49av. The host gets one chance to add to a SUCCESSFUL write's result.
 *
 * This is how the editor's verdict on a file reaches the model in the same turn
 * — Plato writes, learns only that the write succeeded, and would otherwise have
 * no idea it just broke the code. Core stays ignorant of diagnostics: it appends
 * a non-empty string the host returns and knows nothing more.
 *
 * A failed write, a non-write, or a host that throws or returns nothing must all
 * leave the result EXACTLY as it was.
 */
describe('the host may add to a write result (D49av)', () => {
  /** The text of the last tool result the model was handed. */
  function lastToolResult(req: TurnRequest): string {
    // Scan backwards rather than reading the final message: the loop keeps
    // appending to the conversation after the request is made.
    for (let i = req.messages.length - 1; i >= 0; i -= 1) {
      for (const b of req.messages[i]?.content ?? []) {
        if (b.type === 'tool_result') return b.content;
      }
    }
    return '';
  }

  function capturing(turns: TurnResponse[]): {
    p: ChatProvider;
    requests: TurnRequest[];
  } {
    const requests: TurnRequest[] = [];
    let i = 0;
    return {
      requests,
      p: {
        id: 'anthropic',
        async completeTurn(req: TurnRequest): Promise<TurnResponse> {
          // SNAPSHOT the messages. The loop hands over its live array and keeps
          // mutating it, so a stored reference ends up showing later turns — the
          // first version of this helper read the final assistant message and
          // reported every tool result as empty.
          requests.push({
            ...req,
            messages: req.messages.map((m) => ({
              ...m,
              content: m.content.map((b) => ({ ...b })),
            })),
          });
          const t = turns[i];
          i += 1;
          if (t === undefined) throw new Error('unexpected extra turn');
          return t;
        },
      },
    };
  }

  const callTurn = (tool: string, input: Record<string, unknown>): TurnResponse => ({
    content: [{ type: 'tool_use', id: 't1', name: tool, input }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  });
  const done: TurnResponse = {
    content: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };

  /** A throwaway workspace, so a real write never lands in the repo. */
  function ws(): string {
    return mkdtempSync(join(tmpdir(), 'plato-diag-'));
  }

  it('appends what the host returns, keeping what the tool said', async () => {
    const root = ws();
    const { p, requests } = capturing([
      callTurn('write_file', { path: 'a.ts', content: 'x' }),
      done,
    ]);
    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      afterToolResult: () => Promise.resolve('EDITOR SAYS: 2 errors'),
    });
    const told = lastToolResult(requests[1]!);
    expect(told).toContain('EDITOR SAYS: 2 errors');
    // Appended, never substituted: the tool's own account must survive, or the
    // model loses the fact that the file was created at all.
    expect(told).toContain('created a.ts');
  });

  it('hands the host the tool, its arguments, and the run signal', async () => {
    const root = ws();
    const seen: { tool: string; path: unknown; aborted: boolean }[] = [];
    const { p } = capturing([
      callTurn('write_file', { path: 'b.ts', content: 'y' }),
      done,
    ]);
    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      afterToolResult: (e) => {
        seen.push({
          tool: e.tool,
          path: e.args['path'],
          aborted: e.signal.aborted,
        });
        return Promise.resolve(undefined);
      },
    });
    expect(seen).toEqual([{ tool: 'write_file', path: 'b.ts', aborted: false }]);
  });

  it('does not ask about a read, which changes nothing', async () => {
    const root = ws();
    writeFileSync(join(root, 'r.ts'), 'const a = 1;\n');
    let asked = 0;
    const { p, requests } = capturing([
      callTurn('read_file', { path: 'r.ts' }),
      done,
    ]);
    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      afterToolResult: () => {
        asked += 1;
        return Promise.resolve('SHOULD NOT APPEAR');
      },
    });
    expect(asked).toBe(0);
    expect(lastToolResult(requests[1]!)).not.toContain('SHOULD NOT APPEAR');
  });

  it('does not ask about a write that FAILED', async () => {
    // A failed write is not a change, so there is nothing to ask about — and the
    // result must not gain a block that reads like a verdict on code that was
    // never written.
    const root = ws();
    let asked = 0;
    const { p, requests } = capturing([
      callTurn('write_file', { path: 'c.ts' }), // no content -> the tool fails
      done,
    ]);
    const r = await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      afterToolResult: () => {
        asked += 1;
        return Promise.resolve('SHOULD NOT APPEAR');
      },
    });
    expect(asked).toBe(0);
    expect(r.reason).toBe('complete');
    expect(lastToolResult(requests[1]!)).not.toContain('SHOULD NOT APPEAR');
  });

  it('appends nothing when the host returns nothing', async () => {
    const root = ws();
    const { p, requests } = capturing([
      callTurn('write_file', { path: 'd.ts', content: 'z' }),
      done,
    ]);
    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      // '' is what "nothing to report" looks like, and it must leave the result
      // byte-identical rather than adding a blank separator.
      afterToolResult: () => Promise.resolve(''),
    });
    expect(lastToolResult(requests[1]!)).toBe('created d.ts');
  });

  it('survives a host that throws — a diagnostics fault must not fail a run', async () => {
    const root = ws();
    const { p, requests } = capturing([
      callTurn('write_file', { path: 'e.ts', content: 'q' }),
      done,
    ]);
    const r = await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      afterToolResult: () => Promise.reject(new Error('editor exploded')),
    });
    expect(r.reason).toBe('complete');
    expect(lastToolResult(requests[1]!)).toBe('created e.ts');
  });
});

/**
 * D49ax. Undo copies are written at the executor, and the loop is what files
 * them under the run's id — so this is the only place the two halves meet.
 *
 * The property that matters: a copy exists for what a write REPLACED, and for
 * nothing else. A read keeps nothing, a write that never happened keeps nothing,
 * and no store means nothing at all — the same shape as the diagnostics seam
 * above, and for the same reason: the host owns the policy, core owns the hook.
 */
describe('a write keeps what it replaced (D49ax)', () => {
  const callTurn = (tool: string, input: Record<string, unknown>): TurnResponse => ({
    content: [{ type: 'tool_use', id: 't1', name: tool, input }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  });
  const done: TurnResponse = {
    content: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };

  const ws = (): string => mkdtempSync(join(tmpdir(), 'plato-undo-loop-'));
  const store = (): string => mkdtempSync(join(tmpdir(), 'plato-undo-store-'));

  /** The one request the store holds, or null when it holds none. */
  function onlyRequest(dir: string): {
    id: string;
    files: { rel: string; existed: boolean; seq: number | null }[];
  } | null {
    if (!existsSync(join(dir, 'index.json'))) return null;
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { id: string; files: { rel: string; existed: boolean; seq: number | null }[] }[];
    };
    expect(index.requests).toHaveLength(1);
    return index.requests[0] ?? null;
  }

  it('files a write under the run, holding the bytes it replaced', async () => {
    const root = ws();
    const dir = store();
    writeFileSync(join(root, 'a.ts'), 'one\n');

    await runAgentLoop({
      ...BASE,
      root,
      provider: provider([
        callTurn('write_file', { path: 'a.ts', content: 'two\n', overwrite: true }),
        done,
      ]),
      undoStore: { dir },
    });

    const req = onlyRequest(dir)!;
    expect(req.files[0]?.rel).toBe('a.ts');
    expect(req.files[0]?.existed).toBe(true);
    // The copy on disk is what the file held BEFORE the write.
    const copy = readFileSync(join(dir, req.id, `${req.files[0]!.seq}.bin`), 'utf8');
    expect(copy).toBe('one\n');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('two\n');
  });

  it('keeps nothing for a read', async () => {
    const root = ws();
    const dir = store();
    writeFileSync(join(root, 'a.ts'), 'one\n');

    await runAgentLoop({
      ...BASE,
      root,
      provider: provider([callTurn('read_file', { path: 'a.ts' }), done]),
      undoStore: { dir },
    });

    expect(existsSync(join(dir, 'index.json'))).toBe(false);
  });

  it('keeps nothing for a write the mode denied', async () => {
    const root = ws();
    const dir = store();
    writeFileSync(join(root, 'a.ts'), 'one\n');

    await runAgentLoop({
      ...BASE,
      root,
      getMode: () => 'plan' as const, // plan denies every write
      provider: provider([
        callTurn('write_file', { path: 'a.ts', content: 'two\n', overwrite: true }),
        done,
      ]),
      undoStore: { dir },
    });

    expect(existsSync(join(dir, 'index.json'))).toBe(false);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('one\n');
  });

  it('keeps nothing when no store is configured', async () => {
    const root = ws();
    await runAgentLoop({
      ...BASE,
      root,
      provider: provider([
        callTurn('write_file', { path: 'a.ts', content: 'x' }),
        done,
      ]),
    });
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('x');
  });

  it('files every file of one request under one id', async () => {
    const root = ws();
    const dir = store();
    writeFileSync(join(root, 'a.ts'), 'one\n');
    writeFileSync(join(root, 'b.ts'), 'two\n');

    await runAgentLoop({
      ...BASE,
      root,
      provider: provider([
        callTurn('apply_patch', {
          patches: [
            { path: 'a.ts', diffs: [{ search: 'one', replace: 'ONE' }] },
            { path: 'b.ts', diffs: [{ search: 'two', replace: 'TWO' }] },
          ],
        }),
        done,
      ]),
      undoStore: { dir },
    });

    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { id: string; files: { rel: string }[] }[];
    };
    expect(index.requests).toHaveLength(1);
    expect(index.requests[0]?.files.map((f) => f.rel)).toEqual(['a.ts', 'b.ts']);
  });
});

/**
 * D49aw. The repetition bound, at the seam where it can actually hurt.
 *
 * The unit tests in `stuck.test.ts` pin the counting rules. These pin the three
 * things only the loop can get wrong: that a nudge reaches the MODEL, that the
 * user is only asked after the nudge failed, and that a run which is going
 * somewhere is never cut — the mistake the deleted turn cap made.
 */
describe('a stuck run is bounded by repetition, not by turns (D49aw)', () => {
  /** The same call, with the same result, every turn — a stuck model. */
  const sameTurn = (): TurnResponse => ({
    content: [
      {
        type: 'tool_use',
        id: 't',
        name: 'todo_write',
        input: { todos: [{ content: 'the same step', status: 'in_progress' }] },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  });

  const done: TurnResponse = {
    content: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };

  function scripted(
    repeats: number,
    tail: TurnResponse = done,
  ): { p: ChatProvider; requests: TurnRequest[]; served: () => number } {
    const requests: TurnRequest[] = [];
    let served = 0;
    return {
      requests,
      served: () => served,
      p: {
        id: 'anthropic',
        async completeTurn(req: TurnRequest): Promise<TurnResponse> {
          // Snapshot: the loop keeps mutating the array it hands over.
          requests.push({
            ...req,
            messages: req.messages.map((m) => ({
              ...m,
              content: m.content.map((b) => ({ ...b })),
            })),
          });
          served += 1;
          return served <= repeats ? sameTurn() : tail;
        },
      },
    };
  }

  /** Everything the model was shown, as text. */
  function textSeen(req: TurnRequest): string {
    return req.messages
      .map((m) =>
        m.content
          .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : ''))
          .join('\n'),
      )
      .join('\n');
  }

  it('tells the MODEL at the third identical call, and records that it did', async () => {
    const { p, requests } = scripted(3);
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
    });
    const r = await runAgentLoop({ ...BASE, provider: p, bus });
    expect(r.reason).toBe('complete');
    const shown = textSeen(requests[3]!);
    expect(shown).toContain('You have now made this exact call 3 times in a row');
    // The call is named by its digest, so the model (and the record) can see
    // WHICH call it is and what it was doing.
    expect(shown).toContain('updating its plan (the same step)');
    expect(shown).toContain('Change your approach');
    // Never silent, and never a dead end: the line the USER sees names the call
    // and says what happens next, rather than "it has been asked to try
    // something else", which tells them nothing.
    expect(notices.join('\n')).toContain('Plato is stuck on the same call');
    expect(notices.join('\n')).toContain('stop and ask you');
  });

  it('asks the user at the fifth, and hands their answer to the model', async () => {
    const { p, requests, served } = scripted(5);
    const asked: string[] = [];
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      onStuckAsk: async (req) => {
        asked.push(req.call ?? '');
        return { action: 'continue', guidance: 'the lockfile is the problem' };
      },
    });
    // Human words, not the log digest — this is the string the user reads.
    expect(asked).toEqual(['updating its plan (the same step)']);
    expect(r.reason).toBe('complete');
    expect(served()).toBe(6);
    // Both the fact of the question AND the user's own words reach the model.
    const shown = textSeen(requests[5]!);
    expect(shown).toContain('The user has told you to continue');
    expect(shown).toContain('the lockfile is the problem');
  });

  it('"stop" ends the run with a note that names what it was doing', async () => {
    const { p, served } = scripted(5);
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      onStuckAsk: async () => ({ action: 'stop' }),
    });
    expect(r.reason).toBe('stuck');
    expect(served()).toBe(5);
    // Names what Plato was doing, in words a person reads, AND what to do next.
    expect(r.stuckNote).toContain('updating its plan (the same step)');
    expect(r.stuckNote).toContain('Nothing was lost');
  });

  it('a run with NO way to ask stops rather than pretending it asked', async () => {
    const { p } = scripted(5);
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('stuck');
    expect(r.stuckNote).toBeDefined();
  });

  it('a user DECLINING the same call never raises the card — it is aimed at them', async () => {
    const turns = Array.from({ length: 7 }, () => ({
      content: [
        {
          type: 'tool_use' as const,
          id: 't',
          name: 'write_file',
          input: { path: 'never-written.txt', content: 'x' },
        },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'tool_use' as const,
    }));
    const requests: TurnRequest[] = [];
    let i = 0;
    const asking: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req): Promise<TurnResponse> {
        requests.push({
          ...req,
          messages: req.messages.map((m) => ({
            ...m,
            content: m.content.map((b) => ({ ...b })),
          })),
        });
        i += 1;
        return i <= turns.length ? turns[i - 1]! : done;
      },
    };
    const r = await runAgentLoop({
      ...BASE,
      provider: asking,
      approve: () => Promise.resolve(false),
      onStuckAsk: async () => ({ action: 'stop' }),
    });
    // Seven declined writes, and the run still ends the normal way.
    expect(r.reason).toBe('complete');
  });
});

/**
 * D49bb: the vault reaches the run, and the refusal stands aside for the tools
 * that can mask.
 *
 * The three assertions here are the seam rather than the masker: a masked read
 * must ARRIVE at the model masked, a shell command that names a protected file
 * must still be refused, and a result that carries a known value by some other
 * route must be scrubbed before the model sees it.
 */
describe('a protected file is readable, with its values masked (D49bb)', () => {
  const callTurn = (tool: string, input: Record<string, unknown>): TurnResponse => ({
    content: [{ type: 'tool_use', id: 't1', name: tool, input }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  });
  const done: TurnResponse = {
    content: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };
  function capturing(turns: TurnResponse[]): { p: ChatProvider; requests: TurnRequest[] } {
    const requests: TurnRequest[] = [];
    let i = 0;
    return {
      requests,
      p: {
        id: 'anthropic',
        async completeTurn(req: TurnRequest): Promise<TurnResponse> {
          requests.push(req);
          i += 1;
          const t = turns[i - 1];
          if (t === undefined) throw new Error('unexpected extra turn');
          return t;
        },
      },
    };
  }
  function lastToolResult(req: TurnRequest): string {
    for (let i = req.messages.length - 1; i >= 0; i -= 1) {
      for (const b of req.messages[i]?.content ?? []) {
        if (b.type === 'tool_result') return b.content;
      }
    }
    return '';
  }
  function ws(): string {
    return mkdtempSync(join(tmpdir(), 'plato-secret-'));
  }

  const ENV = 'API_KEY=sk-live-abc123456789\n';

  it('hands the model the masked text, and never the value', async () => {
    const root = ws();
    writeFileSync(join(root, '.env'), ENV);
    const { p, requests } = capturing([callTurn('read_file', { path: '.env' }), done]);

    const r = await runAgentLoop({ ...BASE, root, provider: p, secretVault: createVault() });

    expect(r.reason).toBe('complete');
    const result = lastToolResult(requests[1]!);
    expect(result).toContain('«masked:API_KEY»');
    expect(result).not.toContain('sk-live-abc123456789');
  });

  it('still REFUSES a shell command that names a protected file', async () => {
    const root = ws();
    writeFileSync(join(root, '.env'), ENV);
    const { p, requests } = capturing([callTurn('shell', { command: 'cat .env' }), done]);

    await runAgentLoop({ ...BASE, root, provider: p, secretVault: createVault() });

    const result = lastToolResult(requests[1]!);
    expect(result).toContain('protected file');
    expect(result).not.toContain('sk-live-abc123456789');
  });

  it('refuses it with no vault too', async () => {
    const root = ws();
    writeFileSync(join(root, '.env'), ENV);
    const { p, requests } = capturing([callTurn('read_file', { path: '.env' }), done]);

    await runAgentLoop({ ...BASE, root, provider: p });

    expect(lastToolResult(requests[1]!)).toContain('protected file');
  });

  it('previews a protected-file diff against the masked view', async () => {
    const root = ws();
    writeFileSync(join(root, '.env'), ENV);
    let preview = '';
    const { p } = capturing([
      callTurn('apply_diff', {
        path: '.env',
        // The SEARCH the model wrote is the masked line it was shown.
        diffs: [{ search: `API_KEY=${placeholder('API_KEY')}`, replace: 'API_KEY=rotated-000' }],
      }),
      done,
    ]);

    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      secretVault: createVault(),
      approve: (req) => {
        preview = req.preview ?? '';
        return Promise.resolve(true);
      },
    });

    // Without matching the masked view the preview reads "preview unavailable",
    // so the user is asked to approve a change they cannot see.
    expect(preview).not.toContain('preview unavailable');
    expect(preview).toContain('rotated-000');
    // The card shows the USER their own value. That is the point of the card,
    // and the preview never reaches disk (transcript.ts drops it).
    expect(preview).toContain('sk-live-abc123456789');
  });

  it('scrubs a value that arrived by another route before the model sees it', async () => {
    const root = ws();
    writeFileSync(join(root, '.env'), ENV);
    const { p, requests } = capturing([
      callTurn('read_file', { path: '.env' }),
      callTurn('shell', { command: nodeCommand("process.stdout.write('sk-live-abc123456789')") }),
      done,
    ]);

    await runAgentLoop({ ...BASE, root, provider: p, secretVault: createVault() });

    const result = lastToolResult(requests[2]!);
    expect(result).not.toContain('sk-live-abc123456789');
    expect(result).toContain('«masked:API_KEY»');
  });

  /**
   * D49bc: the seed happens BEFORE the first tool call.
   *
   * The value here reaches a tool result by the route the scrub could not see —
   * no `read_file`, no name the token scan recognises — which is exactly the
   * hole. If the seed ran after the first call, or not at all, the model would
   * be handed the value.
   */
  it('seeds the map before the first call, so an indirect read is scrubbed', async () => {
    const root = ws();
    // Protected by EXACT name, so a glob that expands to it is not that name.
    writeFileSync(join(root, 'local.properties'), 'apiKey=sk-live-indirect-0001\n');
    const { p, requests } = capturing([
      callTurn('shell', { command: readMatching('local.propert') }),
      done,
    ]);

    await runAgentLoop({ ...BASE, root, provider: p, secretVault: createVault() });

    const result = lastToolResult(requests[1]!);
    expect(result).not.toContain('sk-live-indirect-0001');
    expect(result).toContain('«masked:apiKey»');
  });

  /** D49bc: the reveal ask reaches the executor through the loop. */
  it('asks before showing a protected file the masker cannot parse', async () => {
    const root = ws();
    writeFileSync(join(root, 'secrets.json'), '{"API_KEY":"sk-live-blob-0001"}');
    const asked: string[] = [];
    const { p, requests } = capturing([
      callTurn('read_file', { path: 'secrets.json' }),
      done,
    ]);

    await runAgentLoop({
      ...BASE,
      root,
      provider: p,
      secretVault: createVault(),
      revealProtected: (rel) => {
        asked.push(rel);
        return Promise.resolve(true);
      },
    });

    expect(asked).toEqual(['secrets.json']);
    expect(lastToolResult(requests[1]!)).toContain('sk-live-blob-0001');
  });
});

describe('the run record names the mode it began in (D49bj)', () => {
  it('records the STARTING mode even though every later decision reads the live one', async () => {
    const bus = new AgentBus();
    const started: string[] = [];
    bus.on((e) => {
      if (e.type === 'run-started') started.push(e.mode);
    });
    // The user switches to `auto` immediately after sending. The first read is
    // the run's start; every read after it is the switch. Both halves matter —
    // the record must keep the first, and the loop must still make the second.
    let reads = 0;
    const getMode = () => {
      reads += 1;
      return reads === 1 ? ('edit' as const) : ('auto' as const);
    };
    // `todo_write` because it is allowed in EVERY mode and touches nothing —
    // the tool is here only to make the loop reach its per-call decision, so it
    // must not be the thing the test is measuring.
    let i = 0;
    const turns: TurnResponse[] = [
      {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'todo_write',
            input: { todos: [{ content: 'think', status: 'in_progress' }] },
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'done' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      },
    ];
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        const t = turns[i];
        i += 1;
        if (t === undefined) throw new Error('unexpected extra turn');
        return t;
      },
    };

    const r = await runAgentLoop({ ...BASE, provider: p, bus, getMode });

    expect(r.reason).toBe('complete');
    // The run began in `edit`, and that is what the record says — even though
    // the very next decision, one line later, was made in `auto`.
    expect(started).toEqual(['edit']);
    // And the mode was genuinely re-read after the run started, which is what
    // makes those two facts different rather than one.
    expect(reads).toBeGreaterThan(1);
  });
});

/**
 * D49cb: `request_mode` is the model's sanctioned way to ask. Core validates
 * the request and reaches the host, but it never changes the mode itself — the
 * host's card does that, and its answer comes back as the tool result.
 */
describe('the model can ask for a mode, and only the host can change it (D49cb)', () => {
  const ask = {
    type: 'tool_use' as const,
    id: 't1',
    name: 'request_mode',
    input: { mode: 'edit', reason: 'plan cannot write the file' },
  };

  function recording(turns: TurnResponse[]): {
    p: ChatProvider;
    requests: TurnRequest[];
  } {
    const requests: TurnRequest[] = [];
    let i = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req): Promise<TurnResponse> {
        requests.push(req);
        if (i >= turns.length) throw new Error('unexpected extra turn');
        return turns[i++]!;
      },
    };
    return { p, requests };
  }

  function lastToolResult(req: TurnRequest): string {
    for (let i = req.messages.length - 1; i >= 0; i -= 1) {
      for (const b of req.messages[i]?.content ?? []) {
        if (b.type === 'tool_result') return b.content;
      }
    }
    return '';
  }

  const stop: TurnResponse = {
    content: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };
  const toolTurn: TurnResponse = {
    content: [ask],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  };

  it('offers the tool in plan mode and hands the host’s answer back to the model', async () => {
    const seen: { mode: string; reason: string }[] = [];
    const { p, requests } = recording([toolTurn, stop]);
    const r = await runAgentLoop({
      ...BASE,
      getMode: () => 'plan' as const,
      provider: p,
      requestMode: async (req) => {
        seen.push(req);
        return {
          ok: true,
          note: 'The user approved. Plato is now in edit mode. Continue the task.',
        };
      },
    });
    expect(r.reason).toBe('complete');
    // Offered where it is needed most: the mode that refuses the work.
    expect(requests[0]!.tools.some((t) => t.name === 'request_mode')).toBe(true);
    expect(seen).toEqual([{ mode: 'edit', reason: 'plan cannot write the file' }]);
    // The host's note is the tool result, so the model learns the mode changed.
    expect(lastToolResult(requests[1]!)).toContain('The user approved');
    expect(lastToolResult(requests[1]!)).toContain('edit mode');
  });

  it('does not offer the tool to a host without the card', async () => {
    const { p, requests } = recording([stop]);
    await runAgentLoop({ ...BASE, provider: p });
    expect(requests[0]!.tools.some((t) => t.name === 'request_mode')).toBe(false);
  });

  it('a decline reaches the model and core changes nothing', async () => {
    const { p, requests } = recording([toolTurn, stop]);
    const r = await runAgentLoop({
      ...BASE,
      getMode: () => 'plan' as const,
      provider: p,
      requestMode: async () => ({
        ok: false,
        note: 'The user declined. Plato is still in plan mode.',
      }),
    });
    expect(r.reason).toBe('complete');
    expect(lastToolResult(requests[1]!)).toContain('The user declined');
    expect(lastToolResult(requests[1]!)).toContain('still in plan mode');
  });

  it('refuses an unknown mode without asking the host at all', async () => {
    let called = 0;
    const { p, requests } = recording([
      { ...toolTurn, content: [{ ...ask, input: { mode: 'sudo', reason: 'x' } }] },
      stop,
    ]);
    await runAgentLoop({
      ...BASE,
      getMode: () => 'plan' as const,
      provider: p,
      requestMode: async () => {
        called += 1;
        return { ok: true, note: 'should not happen' };
      },
    });
    expect(called).toBe(0);
    expect(lastToolResult(requests[1]!)).toContain('mode must be plan, edit or auto');
  });

  it('does not ask the host for the mode already in force', async () => {
    let called = 0;
    const { p, requests } = recording([
      { ...toolTurn, content: [{ ...ask, input: { mode: 'plan', reason: 'x' } }] },
      stop,
    ]);
    await runAgentLoop({
      ...BASE,
      getMode: () => 'plan' as const,
      provider: p,
      requestMode: async () => {
        called += 1;
        return { ok: true, note: 'should not happen' };
      },
    });
    expect(called).toBe(0);
    expect(lastToolResult(requests[1]!)).toContain('already in plan mode');
  });
});

describe('a run that sees .gitignore paths', () => {
  function ignoredRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'plato-ignored-'));
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'vendor/\n');
    writeFileSync(join(root, 'vendor', 'lib.ts'), 'const needle = 1;\n');
    writeFileSync(join(root, 'src.ts'), 'const other = 2;\n');
    return root;
  }

  it('tells the model with the result, and the user once per run', async () => {
    const root = ignoredRoot();
    const seen: string[] = [];
    let turn = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        turn += 1;
        seen.push(JSON.stringify(req.messages));
        if (turn === 1 || turn === 2) {
          return {
            content: [
              {
                type: 'tool_use',
                id: `call-${turn}`,
                name: 'grep',
                input: { pattern: 'needle' },
              },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'Done.' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
    });

    await runAgentLoop({ ...BASE, root, provider: p, bus });

    // The model is told with each result — twice here.
    expect(seen[1]).toContain('paths that .gitignore excludes');
    expect(seen[2]).toContain('paths that .gitignore excludes');
    // The user is told once, not once per call.
    const ignoreNotices = notices.filter((n) => n.includes('.gitignore'));
    expect(ignoreNotices).toHaveLength(1);
    expect(ignoreNotices[0]).toContain('vendor/lib.ts');
  });

  it('says nothing when the switch is on', async () => {
    const root = ignoredRoot();
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') notices.push(e.text);
    });
    let turn = 0;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        turn += 1;
        if (turn === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'call-1', name: 'grep', input: { pattern: 'needle' } },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'Done.' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({ ...BASE, root, provider: p, bus, respectGitignore: true });
    expect(r.finalText).toBe('Done.');
    expect(notices.join('\n')).not.toContain('.gitignore');
  });
});
