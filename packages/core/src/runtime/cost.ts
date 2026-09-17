/**
 * Cost estimation (D24d, extended D25e). Prices keyed by composite
 * 'provider:model' refs; bare legacy Anthropic ids still resolve.
 * Reasoning/thinking tokens arrive inside outputTokens for both wire
 * protocols, so they are billed as output automatically. Unknown models
 * quote $0 with estimated:false. Display-only — never authoritative;
 * prices drift.
 */

export interface Usage {
  /** TOTAL input tokens — cache reads and writes included. See TurnUsage. */
  inputTokens: number;
  outputTokens: number;
  /** D49g: tokens served from the prompt cache, billed at `cacheRead`. */
  cacheReadTokens?: number;
  /** D49g: tokens written into the prompt cache, billed at `cacheWrite`. */
  cacheWriteTokens?: number;
}

export interface CostQuote {
  usd: number;
  estimated: boolean;
}

interface Price {
  /** USD per million tokens. */
  input: number;
  output: number;
  /** Multiplier on `input` for tokens written into the cache. */
  cacheWrite: number;
  /** Multiplier on `input` for tokens served from the cache. */
  cacheRead: number;
}

/** Anthropic: a cache write costs 25% more, a read costs a tenth. */
const ANTHROPIC_CACHE = { cacheWrite: 1.25, cacheRead: 0.1 };
/** OpenAI: cached input is half price, and a write carries no premium. */
const OPENAI_CACHE = { cacheWrite: 1, cacheRead: 0.5 };

/** USD per million tokens, keyed by BARE model name. */
const PRICE_PER_MTOK: Record<string, Price> = {
  'claude-sonnet-4-5': { input: 3, output: 15, ...ANTHROPIC_CACHE },
  'claude-opus-4-1': { input: 15, output: 75, ...ANTHROPIC_CACHE },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4, ...ANTHROPIC_CACHE },
  'gpt-4o': { input: 2.5, output: 10, ...OPENAI_CACHE },
  'gpt-4o-mini': { input: 0.15, output: 0.6, ...OPENAI_CACHE },
  'o4-mini': { input: 1.1, output: 4.4, ...OPENAI_CACHE },
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
  // D49g: without this the cache would UNDERSTATE the bill, because turning
  // caching on moves most of the prompt out of `inputTokens` (Anthropic reports
  // it net of cache) — the displayed cost would fall exactly when the real cost
  // rose. Split the total into fresh, written and read, and price each.
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const fresh = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const usd =
    (fresh * price.input +
      cacheWrite * price.input * price.cacheWrite +
      cacheRead * price.input * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;
  return { usd, estimated: true };
}
