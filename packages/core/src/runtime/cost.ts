/**
 * Cost estimation (D24d, extended D25e). Prices keyed by composite
 * 'provider:model' refs; bare legacy Anthropic ids still resolve.
 * Reasoning/thinking tokens arrive inside outputTokens for both wire
 * protocols, so they are billed as output automatically. Unknown models
 * quote $0 with estimated:false. Display-only — never authoritative;
 * prices drift.
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
  'anthropic:claude-sonnet-4-5': [3, 15],
  'anthropic:claude-opus-4-1': [15, 75],
  'anthropic:claude-3-5-haiku-latest': [0.8, 4],
  'openai:gpt-4o': [2.5, 10],
  'openai:gpt-4o-mini': [0.15, 0.6],
  'openai:o4-mini': [1.1, 4.4],
};

/** Pre-abstraction ids (kept so old transcripts still price). */
const LEGACY_ALIASES: Record<string, string> = {
  'claude-sonnet-4-5': 'anthropic:claude-sonnet-4-5',
  'claude-opus-4-1': 'anthropic:claude-opus-4-1',
  'claude-3-5-haiku-latest': 'anthropic:claude-3-5-haiku-latest',
};

export function estimateCost(model: string, usage: Usage): CostQuote {
  const key = PRICE_PER_MTOK[model]
    ? model
    : LEGACY_ALIASES[model];
  const price = key ? PRICE_PER_MTOK[key] : undefined;
  if (!price) {
    return { usd: 0, estimated: false };
  }
  const usd =
    (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
  return { usd, estimated: true };
}
