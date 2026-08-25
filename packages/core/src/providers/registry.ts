/**
 * Model registry (D25b/d): the known-model catalog, composite-ref
 * parsing, capability flags, and the provider factory. Unknown models
 * are allowed through (custom endpoints) but price at $0/unestimated
 * and never receive reasoning parameters.
 */
import type { ChatProvider } from './types.js';
import { AnthropicNativeProvider } from './anthropic-native.js';
import { OpenAICompatProvider } from './openai-compat.js';

export interface ModelEntry {
  /** Composite ref: 'provider:model'. */
  id: string;
  label: string;
  /** USD per million tokens [input, output]. */
  pricePerMTok: [number, number];
  reasoning: boolean;
}

export const MODEL_CATALOG: ModelEntry[] = [
  { id: 'anthropic:claude-sonnet-4-5', label: 'Claude Sonnet 4.5', pricePerMTok: [3, 15], reasoning: true },
  { id: 'anthropic:claude-opus-4-1', label: 'Claude Opus 4.1', pricePerMTok: [15, 75], reasoning: true },
  { id: 'anthropic:claude-3-5-haiku-latest', label: 'Claude Haiku 3.5', pricePerMTok: [0.8, 4], reasoning: false },
  { id: 'openai:gpt-4o', label: 'GPT-4o', pricePerMTok: [2.5, 10], reasoning: false },
  { id: 'openai:gpt-4o-mini', label: 'GPT-4o mini', pricePerMTok: [0.15, 0.6], reasoning: false },
  { id: 'openai:o4-mini', label: 'o4-mini', pricePerMTok: [1.1, 4.4], reasoning: true },
];

export function parseModelRef(
  ref: string,
): { provider: 'anthropic' | 'openai'; model: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0) {
    return null;
  }
  const provider = ref.slice(0, i);
  if (provider !== 'anthropic' && provider !== 'openai') {
    return null;
  }
  const model = ref.slice(i + 1).trim();
  return model.length > 0 ? { provider, model } : null;
}

export function findModel(ref: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === ref);
}

/** Reasoning params are only ever attached for catalog-flagged models. */
export function modelSupportsReasoning(ref: string): boolean {
  return findModel(ref)?.reasoning ?? false;
}

export function createProvider(
  provider: 'anthropic' | 'openai',
  opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch },
): ChatProvider {
  if (provider === 'anthropic') {
    return new AnthropicNativeProvider(opts.apiKey);
  }
  return new OpenAICompatProvider(
    opts.apiKey,
    opts.baseUrl,
    opts.fetchImpl as undefined,
  );
}
