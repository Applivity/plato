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
}

/**
 * D49bf: the catalog carries NO context window, and that is the decision.
 *
 * It used to hold one per model, verified by hand from each provider's docs. A
 * shipped window is a claim about somebody else's machine: it rots silently
 * when a name is re-released with a different window, it cannot describe a
 * self-hosted route capped to fit a GPU, and it is exactly the number that
 * decides when a long session is folded away. **The connection is the only
 * party that knows what it will accept**, so the window comes from `/models`
 * (see `discover.ts`) and from nowhere else.
 *
 * `maxOutput` and the prices STAY, and the asymmetry is the reason: a
 * too-high output request is a hard 400 the user cannot miss, while a wrong
 * window only changes when Plato folds. One is a mistake; the other is a
 * preference, and only the first is worth shipping a table for.
 */
export const MODEL_CATALOG: ModelEntry[] = [
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', pricePerMTok: [3, 15], reasoning: true, maxOutput: 64000 },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', pricePerMTok: [15, 75], reasoning: true, maxOutput: 32768 },
  { id: 'claude-3-5-haiku-latest', label: 'Claude Haiku 3.5', pricePerMTok: [0.8, 4], reasoning: false, maxOutput: 8192 },
  { id: 'gpt-4o', label: 'GPT-4o', pricePerMTok: [2.5, 10], reasoning: false, maxOutput: 16384 },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', pricePerMTok: [0.15, 0.6], reasoning: false, maxOutput: 16384 },
  { id: 'o4-mini', label: 'o4-mini', pricePerMTok: [1.1, 4.4], reasoning: true, maxOutput: 100000 },
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
 * D49bf: the window to run with — what the user's own connection advertised, and
 * nothing else.
 *
 * This used to take the SMALLER of a shipped catalog value and the advertised
 * one. **The catalog half is gone** (founder, 2026-10-06): a hand-maintained
 * window is misleading exactly where it matters, because it is a claim about a
 * machine Plato is not talking to. See the note on `MODEL_CATALOG`.
 *
 * `null` when the connection said nothing, and the caller decides what to do
 * about not knowing — the UI still says "context unknown" rather than printing
 * an assumption as a fact (D26c). What to ASSUME for compaction in that case is
 * a separate decision with its own home: `DEFAULT_CONTEXT_WINDOW` in
 * `runtime/context.ts`.
 */
export function resolveMaxContext(advertised?: number): number | null {
  return advertised ?? null;
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

/**
 * D49z: the models a connection OFFERS — every model it fetched, in the order
 * they are stored.
 *
 * A connection used to carry two lists: `models`, the subset the user had
 * ticked, and `allModels`, everything the endpoint returned. Only the ticked
 * subset was offered, which is what let a stored model reference outlive its
 * own availability — the chat, and every Duo/Academy member, could name a model
 * the user had since unticked, and a key scoped to a model list answers 403 for
 * a name it does not allow. Nothing narrows the list any more, so the two are
 * the same list whenever a fetch has run.
 *
 * `selected` is read as a FALLBACK, for a config that was narrowed before this
 * change or hand-written before any fetch. Preferring the wider list is the
 * whole point: reading the narrower one would preserve the fault.
 */
export function resolveOfferedModels(
  fetched: readonly string[] | undefined,
  selected: readonly string[] | undefined,
): string[] {
  if (fetched !== undefined && fetched.length > 0) {
    return [...fetched];
  }
  return selected !== undefined ? [...selected] : [];
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
