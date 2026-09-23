/**
 * Model registry (D25b/d, D26a): the known-model catalog is keyed by
 * BARE model name so prices and reasoning flags work through any
 * connection (OpenRouter, LiteLLM, direct). Model refs are
 * '<connection-id>:<model>'; parseModelRef validates the prefix against
 * the configured connection ids. Unknown bare models are allowed
 * through but price at $0/unestimated and never get reasoning params.
 */
import type { ChatProvider } from './types.js';
import { AnthropicNativeProvider } from './anthropic-native.js';
import { OpenAICompatProvider } from './openai-compat.js';

export interface ModelEntry {
  /** Bare model name, no connection prefix. */
  id: string;
  label: string;
  /** USD per million tokens [input, output]. */
  pricePerMTok: [number, number];
  reasoning: boolean;
  /** Hard provider cap on output tokens; requesting above it is a 400. */
  maxOutput: number;
  /** Provider-advertised input context window. null = unknown. */
  maxContext: number | null;
}

export const MODEL_CATALOG: ModelEntry[] = [
  // Context windows verified against each provider's own /models or docs.
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', pricePerMTok: [3, 15], reasoning: true, maxOutput: 64000, maxContext: 200000 },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', pricePerMTok: [15, 75], reasoning: true, maxOutput: 32768, maxContext: 200000 },
  { id: 'claude-3-5-haiku-latest', label: 'Claude Haiku 3.5', pricePerMTok: [0.8, 4], reasoning: false, maxOutput: 8192, maxContext: 200000 },
  { id: 'gpt-4o', label: 'GPT-4o', pricePerMTok: [2.5, 10], reasoning: false, maxOutput: 16384, maxContext: 128000 },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', pricePerMTok: [0.15, 0.6], reasoning: false, maxOutput: 16384, maxContext: 128000 },
  { id: 'o4-mini', label: 'o4-mini', pricePerMTok: [1.1, 4.4], reasoning: true, maxOutput: 100000, maxContext: 200000 },
];

export function splitModelRef(ref: string): {
  connectionId: string;
  model: string;
} | null {
  const i = ref.indexOf(':');
  if (i <= 0) {
    return null;
  }
  const connectionId = ref.slice(0, i);
  const model = ref.slice(i + 1).trim();
  return model.length > 0 ? { connectionId, model } : null;
}

/** Validates that the connection prefix is one of the configured ids. */
export function parseModelRef(
  ref: string,
  knownConnectionIds: readonly string[],
): { connectionId: string; model: string } | null {
  const parts = splitModelRef(ref);
  if (!parts || !knownConnectionIds.includes(parts.connectionId)) {
    return null;
  }
  return parts;
}

export function findModel(bareName: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === bareName);
}

/** Reasoning params are only ever attached for catalog-flagged models. */
export function modelSupportsReasoning(bareName: string): boolean {
  return findModel(bareName)?.reasoning ?? false;
}

/**
 * Hard output cap for a model. Unknown models (discovered via /models,
 * OpenRouter routes) get a conservative 8192 — most providers accept it,
 * and a too-high request is a hard 400 while a too-low one merely
 * truncates, which the loop now surfaces via stopReason.
 */
export function maxOutputFor(bareName: string): number {
  return findModel(bareName)?.maxOutput ?? 8192;
}

/**
 * Provider-advertised input context window in tokens. null = unknown
 * (discovered model whose /models payload didn't carry the field, or
 * provider that doesn't expose it). Per D26c we never fake precision:
 * the UI shows "ctx unknown" rather than guessing.
 */
export function maxContextFor(bareName: string): number | null {
  return findModel(bareName)?.maxContext ?? null;
}

/**
 * D49t: the window to actually run with, from the two places that claim one.
 *
 * The catalog is a shipped table for well-known names; the **advertised** number
 * is what the user's own connection reported (see discover.ts). When both speak,
 * take the SMALLER — the two ways to be wrong are not symmetric. Too small means
 * summarising earlier than needed, which works. Too large means sending more than
 * the model can hold, and on the common local servers that does not raise an
 * error, it truncates silently. So the conservative reading is the only safe one.
 *
 * A connection that reports nothing leaves the catalog value in place; a model in
 * neither leaves `null`, and the caller decides what to do about not knowing.
 */
export function resolveMaxContext(
  bareName: string,
  advertised?: number,
): number | null {
  const known = maxContextFor(bareName);
  if (known === null) return advertised ?? null;
  if (advertised === undefined) return known;
  return Math.min(known, advertised);
}

/**
 * D49t: the same resolution for the output cap, which `maxOutputFor` cannot do
 * because it always returns a number (8192 for an unknown model). Taking a
 * minimum against that fallback would pin every unknown model to 8192 and defeat
 * the point — so the fallback is applied only when NEITHER source has a value.
 */
export function resolveMaxOutput(
  bareName: string,
  advertised?: number,
): number {
  const known = findModel(bareName)?.maxOutput;
  if (known === undefined) return advertised ?? 8192;
  if (advertised === undefined) return known;
  return Math.min(known, advertised);
}

/**
 * D49x: the model a session actually runs with, from a preference and what the
 * connections can currently offer.
 *
 * The two disagree when the user unchecks a model in Settings while it is still
 * the selected one — `plato.model` keeps naming it, because nothing rewrites
 * that setting when the active set shrinks. Running it anyway is the worst
 * answer: a key scoped to a model list answers 403 rather than ignoring the
 * name, so a deselected model turns into a failed run.
 *
 * A sibling on the SAME connection is preferred over the first available model,
 * because the fallback should not cross providers: another connection can mean
 * another vendor, another price and another key, which is a bigger decision than
 * "this model went away". Only when the connection itself offers nothing does
 * the choice move to another one, and only when nothing at all is offered does
 * the preference survive — a workspace whose connection list has not loaded yet
 * must not have its model silently blanked.
 */
export function pickEffectiveModel(
  available: readonly string[],
  preferred: string,
): string {
  if (preferred.length > 0 && available.includes(preferred)) {
    return preferred;
  }
  const colon = preferred.indexOf(':');
  if (colon > 0) {
    const prefix = preferred.slice(0, colon + 1);
    const sibling = available.find((v) => v.startsWith(prefix));
    if (sibling !== undefined) {
      return sibling;
    }
  }
  return available[0] ?? preferred;
}

export function createProvider(
  kind: 'anthropic' | 'openai',
  opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch },
): ChatProvider {
  if (kind === 'anthropic') {
    // D49u: the base URL is passed through, not dropped. Dropping it was how
    // the SDK's own ANTHROPIC_BASE_URL fallback took over.
    return new AnthropicNativeProvider(opts.apiKey, opts.baseUrl);
  }
  return new OpenAICompatProvider(
    opts.apiKey,
    opts.baseUrl,
    opts.fetchImpl as undefined,
  );
}
