import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus } from '../src/runtime/bus.js';
import type {
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

const BASE = {
  root: process.cwd(),
  task: 'test task',
  getMode: () => 'act' as const,
  approve: () => Promise.resolve(true),
  model: 'anthropic:claude-sonnet-4-5',
};

/**
 * D49h. Always calls a read tool, so every turn has tool output and the loop
 * keeps going until something stops it. `inputTokens` is exact so the cost in
 * the assertions is predictable: sonnet is $3/MTok input.
 */
function toolLoopProvider(inputTokens: number): ChatProvider & { turns: number } {
  let n = 0;
  return {
    id: 'anthropic',
    get turns() {
      return n;
    },
    async completeTurn(_req: TurnRequest): Promise<TurnResponse> {
      n += 1;
      return {
        content: [
          { type: 'tool_use', id: 't' + n, name: 'list_dir', input: {} },
        ],
        usage: { inputTokens, outputTokens: 0 },
        stopReason: 'tool_use',
      };
    },
  };
}

describe('run budget (D49h)', () => {
  it('stops after the turn budget and reports it as a cap', async () => {
    const p = toolLoopProvider(10);
    const r = await runAgentLoop({ ...BASE, provider: p, budget: { turns: 2 } });
    expect(r.reason).toBe('cap');
    // `turns` must count turns that ACTUALLY ran, not the turn that was skipped.
    expect(r.turns).toBe(2);
    expect(r.finalText).toContain('turn budget reached (2 turns)');
    expect(p.turns).toBe(2);
  });

  it('stops when the estimated cost reaches the usd budget', async () => {
    // 1000 input tokens x $3/MTok = $0.003 per turn.
    const p = toolLoopProvider(1_000);
    const r = await runAgentLoop({ ...BASE, provider: p, budget: { usd: 0.003 } });
    expect(r.reason).toBe('cap');
    expect(r.turns).toBe(1);
    expect(r.finalText).toContain('run budget reached ($0.0030 of $0.00');
  });

  // A budget must never produce a run that did nothing at all.
  it('always runs the first turn, even against an already-exceeded budget', async () => {
    const p = toolLoopProvider(1_000);
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      budget: { usd: 0.000001 },
    });
    expect(r.turns).toBe(1);
    expect(p.turns).toBe(1);
  });

  it('treats usd: 0 as no cap, not as an instant stop', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({ ...BASE, provider: p, budget: { usd: 0 } });
    expect(r.reason).toBe('complete');
  });

  it('is unchanged when no budget is given', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const r = await runAgentLoop({ ...BASE, provider: p });
    expect(r.reason).toBe('complete');
  });

  // The stop is at a turn BOUNDARY, so the breaching turn's tools all ran.
  // Cutting mid-turn would leave the repo half-edited.
  it('lets the breaching turn finish its tools', async () => {
    const p = toolLoopProvider(1_000);
    const bus = new AgentBus();
    const done: string[] = [];
    bus.on((e) => {
      if (e.type === 'tool-event' && e.phase === 'done') {
        done.push(e.tool);
      }
    });
    const r = await runAgentLoop({
      ...BASE,
      provider: p,
      bus,
      budget: { turns: 2 },
    });
    expect(r.turns).toBe(2);
    expect(done).toHaveLength(2); // one per completed turn, none cut off
  });

  it('warns once when the run crosses 90% of the budget', async () => {
    // 3100 tok x $3/MTok = $0.0093 per turn; 90% of $0.01 is $0.009.
    const p = toolLoopProvider(3_100);
    const bus = new AgentBus();
    const notices: string[] = [];
    bus.on((e) => {
      if (e.type === 'notice') {
        notices.push(e.text);
      }
    });
    const r = await runAgentLoop({ ...BASE, provider: p, bus, budget: { usd: 0.01 } });
    expect(r.reason).toBe('cap');
    // `reason` alone is NOT evidence: the MAX_TURNS cap also reports 'cap', so a
    // run with no budget logic at all still ends that way after 40 turns. The
    // turn count is what proves the BUDGET stopped it.
    expect(r.turns).toBe(2);
    const warnings = notices.filter((n) => n.includes('approaching the run budget'));
    expect(warnings).toHaveLength(1); // once, not on every turn
  });
});
