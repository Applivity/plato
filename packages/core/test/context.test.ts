import { describe, expect, it } from 'vitest';
import {
  COMPACT_SYSTEM_PROMPT,
  MAX_RECENT_TO_KEEP,
  buildCompactPrompt,
  compactMaxTokensFor,
  compactMessages,
  compactionSplit,
  estimateTokens,
  promptBreakdown,
  shouldAutoCompact,
} from '../src/runtime/context.js';
import type {
  CanonicalMessage,
  TurnResponse,
} from '../src/providers/types.js';

const user = (text: string): CanonicalMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const asst = (text: string): CanonicalMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
});

describe('estimateTokens', () => {
  it('rounds up at 1 token per 4 chars', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('promptBreakdown', () => {
  it('partitions text by role and includes tool overhead', () => {
    const sys = 'You are a coder.';
    const msgs: CanonicalMessage[] = [
      user('hi there'),
      asst('hello there friend'),
      user('do thing'),
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 't1', content: 'out', isError: false },
        ],
      },
    ];
    const tools = [
      { name: 'a', description: 'd', parameters: {} },
      { name: 'b', description: 'd', parameters: {} },
    ];
    const b = promptBreakdown(sys, msgs, tools);
    expect(b.system).toBe(Math.ceil(sys.length / 4));
    expect(b.user).toBeGreaterThan(0);
    expect(b.assistant).toBeGreaterThan(0);
    expect(b.tool).toBeGreaterThanOrEqual(2 * 120);
    expect(b.total).toBe(
      b.system + b.user + b.assistant + b.tool,
    );
  });
});

describe('compactionSplit', () => {
  it('returns empty when there are no messages', () => {
    expect(compactionSplit([])).toEqual({ older: [], keep: [] });
  });

  it('keeps the last N and condenses the rest', () => {
    const msgs = [user('a'), asst('b'), user('c'), asst('d'), user('e')];
    const r = compactionSplit(msgs, 2);
    expect(r.older).toEqual([user('a'), asst('b'), user('c')]);
    expect(r.keep).toEqual([asst('d'), user('e')]);
  });

  it('clamps keepRecent to [1, length-1]', () => {
    const msgs = [user('a'), asst('b'), user('c')];
    // keepRecent=0 clamps UP to 1: keep the last message only.
    expect(compactionSplit(msgs, 0).keep).toEqual([user('c')]);
    // keepRecent=99 clamps DOWN to length-1=2: keep the last two.
    expect(compactionSplit(msgs, 99).keep).toEqual([asst('b'), user('c')]);
  });

  it('default keep is MAX_RECENT_TO_KEEP', () => {
    const msgs = Array.from({ length: MAX_RECENT_TO_KEEP + 4 }, (_, i) =>
      user('m' + i),
    );
    const r = compactionSplit(msgs);
    expect(r.keep.length).toBe(MAX_RECENT_TO_KEEP);
    expect(r.older.length).toBe(4);
  });
});

describe('buildCompactPrompt', () => {
  it('renders each message with a header', () => {
    const out = buildCompactPrompt([user('hi'), asst('hello')]);
    expect(out).toContain('--- USER #1 ---');
    expect(out).toContain('hi');
    expect(out).toContain('--- ASSISTANT #2 ---');
    expect(out).toContain('hello');
  });
});

describe('compactMessages', () => {
  it('produces a trimmed message list, a summary in the system prompt, and counts the summary cost', async () => {
    const fake: TurnResponse = {
      content: [{ type: 'text', text: '  - file x was edited\n- bug fixed  ' }],
      usage: { inputTokens: 80, outputTokens: 25 },
      stopReason: 'stop',
    };
    const client = {
      calls: [] as unknown[],
      async completeTurn(): Promise<TurnResponse> {
        this.calls.push(1);
        return fake;
      },
    };
    const msgs: CanonicalMessage[] = [
      user('first'),
      asst('first reply'),
      user('second'),
      asst('second reply'),
      user('third'),
      asst('third reply'),
    ];
    const result = await compactMessages(
      client as unknown as Parameters<typeof compactMessages>[0],
      {
        model: 'anthropic:claude-sonnet-4-5',
        system: 'SYSTEM',
        messages: msgs,
        tools: [],
        keepRecent: 2,
      },
    );
    expect(result.messages).toEqual([user('third'), asst('third reply')]);
    expect(result.system).toMatch(/^SYSTEM/);
    expect(result.system).toContain('[Conversation summary so far]');
    expect(result.system).toContain('file x was edited');
    expect(result.summary).toContain('file x was edited');
    expect(result.summaryTokens).toBe(105);
    expect(result.beforeOlderTokens).toBeGreaterThan(0);
    expect(result.keepTokens).toBeGreaterThan(0);
    expect(client.calls.length).toBe(1);
  });

  it('keeps the system prompt untouched when the summary is empty', async () => {
    const fake: TurnResponse = {
      content: [],
      usage: { inputTokens: 10, outputTokens: 0 },
      stopReason: 'stop',
    };
    const client = {
      async completeTurn(): Promise<TurnResponse> {
        return fake;
      },
    };
    const r = await compactMessages(
      client as unknown as Parameters<typeof compactMessages>[0],
      {
        model: 'anthropic:claude-sonnet-4-5',
        system: 'BASE',
        messages: [user('a'), asst('b'), user('c')],
        tools: [],
        keepRecent: 1,
      },
    );
    expect(r.system).toBe('BASE');
    expect(r.summary).toBe('');
  });

  it('uses the compact system prompt and a model-aware summary cap (D37a)', async () => {
    const seen: unknown[] = [];
    const fake: TurnResponse = {
      content: [{ type: 'text', text: 'summary' }],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const client = {
      async completeTurn(req: {
        system: string;
        maxTokens: number;
        tools: unknown[];
      }): Promise<TurnResponse> {
        seen.push(req);
        return fake;
      },
    };
    // Haiku 3.5: maxOutput=8192 → quarter=2048 → ceiling caps at 2048.
    await compactMessages(
      client as unknown as Parameters<typeof compactMessages>[0],
      {
        model: 'anthropic:claude-3-5-haiku-latest',
        system: 'BASE',
        messages: [user('a'), asst('b'), user('c')],
        tools: [{ name: 't', description: 'd', parameters: {} }],
        keepRecent: 1,
      },
    );
    const req = seen[0] as {
      system: string;
      maxTokens: number;
      tools: unknown[];
    };
    expect(req.system).toBe(COMPACT_SYSTEM_PROMPT);
    expect(req.maxTokens).toBe(2048);
    expect(req.tools).toEqual([]);
  });

  it('propagates provider errors so the caller can surface them', async () => {
    const client = {
      async completeTurn(): Promise<TurnResponse> {
        throw new Error('boom');
      },
    };
    await expect(
      compactMessages(
        client as unknown as Parameters<typeof compactMessages>[0],
        {
          model: 'anthropic:claude-sonnet-4-5',
          system: 'BASE',
          messages: [user('a'), asst('b'), user('c')],
          tools: [],
          keepRecent: 1,
        },
      ),
    ).rejects.toThrow(/boom/);
  });
});

describe('compactMaxTokensFor (D37a)', () => {
  it('gives cheap models a 1/4-budget summary capped at 2048', () => {
    // Haiku 3.5: maxOutput=8192 → quarter=2048 → cap 2048.
    expect(compactMaxTokensFor('anthropic:claude-3-5-haiku-latest')).toBe(2048);
  });

  it('caps big-model summaries at 2048 (not their full 1/4 budget)', () => {
    // Sonnet 4.5: maxOutput=64000 → quarter=16000 → ceiling caps at 2048.
    expect(compactMaxTokensFor('anthropic:claude-sonnet-4-5')).toBe(2048);
    // Opus 4.1: maxOutput=32768 → quarter=8192 → ceiling caps at 2048.
    expect(compactMaxTokensFor('anthropic:claude-opus-4-1')).toBe(2048);
    // o4-mini: maxOutput=100000 → quarter=25000 → ceiling caps at 2048.
    expect(compactMaxTokensFor('openai:o4-mini')).toBe(2048);
  });

  it('falls back to the 8192 → 2048 formula for unknown models', () => {
    // Unknown model: maxOutputFor returns 8192 → quarter=2048.
    expect(compactMaxTokensFor('litellm:totally-unknown')).toBe(2048);
  });

  it('strips the connection prefix before resolving', () => {
    // Both forms of the same bare model should produce the same answer.
    const a = compactMaxTokensFor('anthropic:claude-3-5-haiku-latest');
    const b = compactMaxTokensFor('claude-3-5-haiku-latest');
    expect(a).toBe(b);
  });

  it('never returns below the 256-token floor', () => {
    // Defensive: a hypothetical 512-token-output model would otherwise
    // yield 128; the floor keeps summaries faithful.
    expect(compactMaxTokensFor('anthropic:claude-3-5-haiku-latest')).toBeGreaterThanOrEqual(256);
  });
});

describe('shouldAutoCompact (D37a trip guard)', () => {
  it('triggers when the estimate reaches threshold × maxContext', () => {
    expect(shouldAutoCompact(8000, 10000, 0.8)).toBe(true);
    expect(shouldAutoCompact(7999, 10000, 0.8)).toBe(false);
  });

  it('uses UNKNOWN_CONTEXT_FLOOR (8192) for null maxContext', () => {
    // 8192 × 0.5 = 4096
    expect(shouldAutoCompact(4096, null, 0.5)).toBe(true);
    expect(shouldAutoCompact(4095, null, 0.5)).toBe(false);
    // 8192 × 0.8 = 6553.6
    expect(shouldAutoCompact(6554, null, 0.8)).toBe(true);
    expect(shouldAutoCompact(6553, null, 0.8)).toBe(false);
  });

  it('honors custom thresholds (0.5–0.95)', () => {
    expect(shouldAutoCompact(1000, 1000, 0.5)).toBe(true);
    expect(shouldAutoCompact(499, 1000, 0.5)).toBe(false);
    expect(shouldAutoCompact(950, 1000, 0.95)).toBe(true);
    expect(shouldAutoCompact(949, 1000, 0.95)).toBe(false);
  });

  it('boundary inclusive at the trip point', () => {
    // The loop uses `>=` — exact match at the trip point counts as
    // tripped. This is the documented contract.
    expect(shouldAutoCompact(800, 1000, 0.8)).toBe(true);
  });
});

/**
 * Reproduces the first real-run crash (2026-09-22, DeepSeek via LiteLLM):
 *
 *   openai HTTP 400: Messages with role 'tool' must be a response to a
 *   preceding message with 'tool_calls'
 *
 * `compactionSplit` is a blind slice by count. When the cut lands inside a tool
 * exchange, the kept tail begins with tool RESULTS whose assistant message
 * (carrying the `tool_calls`) was summarised away — so the request has a
 * `role:'tool'` message with nothing to answer. Anthropic has the same rule for
 * `tool_result` blocks, so this is not an OpenAI-only fault.
 */
describe('compactionSplit keeps tool exchanges whole', () => {
  const toolUse = (id: string, text = ''): CanonicalMessage => ({
    role: 'assistant',
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      { type: 'tool_use' as const, id, name: 'read_file', input: { path: 'x' } },
    ],
  });
  const toolResults = (...ids: string[]): CanonicalMessage => ({
    role: 'user',
    content: ids.map((id) => ({
      type: 'tool_result' as const,
      toolUseId: id,
      content: 'ok',
      isError: false,
    })),
  });

  /** The wire invariant: a run of tool results must answer a preceding tool_use. */
  function orphanedToolResults(msgs: readonly CanonicalMessage[]): number {
    let prevToolUse = false;
    let prevResults = false;
    let orphans = 0;
    for (const m of msgs) {
      const hasResults = m.content.some((b) => b.type === 'tool_result');
      const hasToolUse = m.content.some((b) => b.type === 'tool_use');
      if (hasResults && !prevToolUse && !prevResults) orphans += 1;
      prevResults = hasResults;
      prevToolUse = hasToolUse;
    }
    return orphans;
  }

  /** The shape the failing run had: two completed exchanges, then a third. */
  const conversation = (): CanonicalMessage[] => [
    user('review these three files'),
    toolUse('a1', 'I will start by reading them'),
    toolResults('a1'),
    toolUse('b1'),
    toolResults('b1'),
  ];

  it('never leaves an orphaned tool result, at ANY keep count', () => {
    const msgs = conversation();
    for (let keep = 1; keep < msgs.length; keep++) {
      const { keep: tail } = compactionSplit(msgs, keep);
      expect(orphanedToolResults(tail), `keepRecent=${keep}`).toBe(0);
    }
  });

  it('pulls the owning assistant message back in rather than dropping it', () => {
    // keepRecent=1 would otherwise strand the last tool results on their own.
    const { keep } = compactionSplit(conversation(), 1);
    expect(keep[0]!.role).toBe('assistant');
    expect(orphanedToolResults(keep)).toBe(0);
  });

  it('still splits somewhere sensible when the list has no tool traffic', () => {
    const plain = [user('one'), asst('two'), user('three'), asst('four')];
    const { older, keep } = compactionSplit(plain, 2);
    expect(older).toHaveLength(2);
    expect(keep).toHaveLength(2);
    expect(keep[0]!.role).toBe('user');
  });
});
