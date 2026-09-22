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
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      approve: () => {
        approvals += 1;
        return Promise.resolve(true);
      },
    });
    expect(r.reason).toBe('complete');
    // The card never appeared, and the model was told why.
    expect(approvals).toBe(0);
    expect(refusals.join(' ')).toContain('outside the workspace');
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
                  input: { command: 'echo hi' },
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
    // 64000 beats the 8192 fallback; the loop's own 16384 ceiling still applies.
    expect(r.maxTokens).toBe(16384);
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
