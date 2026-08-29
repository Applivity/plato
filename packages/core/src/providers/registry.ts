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

export const MODEL_CATALOG: ModelEntry[] = [
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', pricePerMTok: [3, 15], reasoning: true, maxOutput: 64000 },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', pricePerMTok: [15, 75], reasoning: true, maxOutput: 32768 },
  { id: 'claude-3-5-haiku-latest', label: 'Claude Haiku 3.5', pricePerMTok: [0.8, 4], reasoning: false, maxOutput: 8192 },
  { id: 'gpt-4o', label: 'GPT-4o', pricePerMTok: [2.5, 10], reasoning: false, maxOutput: 16384 },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', pricePerMTok: [0.15, 0.6], reasoning: false, maxOutput: 16384 },
  { id: 'o4-mini', label: 'o4-mini', pricePerMTok: [1.1, 4.4], reasoning: true, maxOutput: 100000 },
  // Ornith 1.5 35B A3B (LiteLLM). Verified from provider metadata:
  // context_window 262144, max_output_tokens 32768. Priced as unknown
  // (cost.ts has no entry; quotes $0, estimated:false) per D26c — never
  // fake precision. reasoning stays false until confirmed supported.
  { id: 'ornith-1.5-35b-a3b', label: 'Ornith 1.5 35B A3B', pricePerMTok: [0, 0], reasoning: false, maxOutput: 32768 },
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

export function createProvider(
  kind: 'anthropic' | 'openai',
  opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch },
): ChatProvider {
  if (kind === 'anthropic') {
    return new AnthropicNativeProvider(opts.apiKey);
  }
  return new OpenAICompatProvider(
    opts.apiKey,
    opts.baseUrl,
    opts.fetchImpl as undefined,
  );
}
