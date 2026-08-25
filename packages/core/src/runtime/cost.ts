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

/** USD per million tokens: [input, output], keyed by BARE model name. */
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3, 15],
  'claude-opus-4-1': [15, 75],
  'claude-3-5-haiku-latest': [0.8, 4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o4-mini': [1.1, 4.4],
};

export function estimateCost(model: string, usage: Usage): CostQuote {
  // Connection refs ('litellm:gpt-4o') resolve by their bare model part.
  const bare = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
  const price =
    PRICE_PER_MTOK[bare] ??
    PRICE_PER_MTOK[model] ?? // legacy bare ids without prefix
    undefined;
  if (!price) {
    return { usd: 0, estimated: false };
  }
  const usd =
    (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
  return { usd, estimated: true };
}
