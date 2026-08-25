import { describe, expect, it } from 'vitest';
import { estimateCost } from '../src/runtime/cost.js';

describe('estimateCost', () => {
  it('prices claude-sonnet-4-5 at $3/$15 per MTok', () => {
    const q = estimateCost('claude-sonnet-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(q.estimated).toBe(true);
    expect(q.usd).toBeCloseTo(18, 6);
  });

  it('handles realistic small runs', () => {
    const q = estimateCost('claude-sonnet-4-5', {
      inputTokens: 12_000,
      outputTokens: 800,
    });
    expect(q.estimated).toBe(true);
    // 12000*3 + 800*15 = 36000 + 12000 = 48000 millionths of a dollar.
    expect(q.usd).toBeCloseTo(0.048, 6);
  });

  it('quotes zero for unknown models, flagged not-estimated', () => {
    const q = estimateCost('gpt-jellyfish-9', {
      inputTokens: 999,
      outputTokens: 999,
    });
    expect(q).toEqual({ usd: 0, estimated: false });
  });
});
