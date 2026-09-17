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

  // D49g. Without cache pricing, turning caching ON would make the displayed
  // cost FALL, because Anthropic reports `input_tokens` net of the cache — so
  // the bill would look cheaper exactly when it was larger.
  describe('prompt-cache pricing (D49g)', () => {
    it('bills a cache read at a tenth of the input rate', () => {
      const q = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 1_000_000, // total, all of it cached
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      });
      expect(q.usd).toBeCloseTo(0.3, 6); // 1M x $3 x 0.1
    });

    it('bills a cache write above the input rate', () => {
      const q = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      });
      expect(q.usd).toBeCloseTo(3.75, 6); // 1M x $3 x 1.25
    });

    it('prices a mixed turn as the sum of its parts', () => {
      const q = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 1_000_000, // 500k fresh + 300k written + 200k read
        outputTokens: 0,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 300_000,
      });
      // 0.5M x 3  +  0.3M x 3 x 1.25  +  0.2M x 3 x 0.1
      expect(q.usd).toBeCloseTo(1.5 + 1.125 + 0.06, 6);
    });

    it('never reads a cache figure larger than the total as negative input', () => {
      const q = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 5_000, // nonsense from a broken endpoint
      });
      expect(q.usd).toBeGreaterThanOrEqual(0);
    });

    it('leaves an uncached turn at exactly the old price', () => {
      const withFields = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 12_000,
        outputTokens: 800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const without = estimateCost('anthropic:claude-sonnet-4-5', {
        inputTokens: 12_000,
        outputTokens: 800,
      });
      expect(withFields.usd).toBeCloseTo(without.usd, 12);
    });
  });
});

