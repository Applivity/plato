import { describe, expect, it } from 'vitest';
import { estimateCost } from '../src/runtime/cost.js';

describe('estimateCost', () => {
  it('prices anthropic:claude-sonnet-4-5 at $3/$15 per MTok', () => {
    const q = estimateCost('anthropic:claude-sonnet-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(q.estimated).toBe(true);
    expect(q.usd).toBeCloseTo(18, 6);
  });

  it('still prices legacy bare ids (old transcripts)', () => {
    const q = estimateCost('claude-sonnet-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(q.estimated).toBe(true);
    expect(q.usd).toBeCloseTo(3, 6);
  });

  it('prices openai models from the extended table', () => {
    const q = estimateCost('openai:o4-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(q.estimated).toBe(true);
    expect(q.usd).toBeCloseTo(5.5, 6);
  });

  it('resolves prices through arbitrary connection prefixes (D26a)', () => {
    const q = estimateCost('litellm:deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    // deepseek is not in the table → honest zero.
    expect(q).toEqual({ usd: 0, estimated: false });

    const q2 = estimateCost('litellm:gpt-4o', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(q2.estimated).toBe(true);
    expect(q2.usd).toBeCloseTo(2.5, 6);
  });

  it('handles realistic small runs', () => {
    const q = estimateCost('anthropic:claude-sonnet-4-5', {
      inputTokens: 12_000,
      outputTokens: 800,
    });
    expect(q.estimated).toBe(true);
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

