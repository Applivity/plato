/**
 * Cost estimation (D24d). Hardcoded per-MTok USD prices for the models
 * Plato actually uses; unknown models quote $0 with estimated:false.
 * Display-only — never authoritative for billing; prices drift.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostQuote {
  usd: number;
  estimated: boolean;
}

/** USD per million tokens: [input, output]. */
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3, 15],
  'claude-opus-4-1': [15, 75],
  'claude-3-5-haiku-latest': [0.8, 4],
};

export function estimateCost(model: string, usage: Usage): CostQuote {
  const price = PRICE_PER_MTOK[model];
  if (!price) {
    return { usd: 0, estimated: false };
  }
  const usd =
    (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
  return { usd, estimated: true };
}
