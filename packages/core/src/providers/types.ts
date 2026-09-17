/**
 * Canonical provider contract (D25b). The agent loop speaks ONLY these
 * types; each adapter maps them onto its wire protocol. Keeping the loop
 * provider-blind is what lets Anthropic-native and OpenAI-compatible
 * endpoints share one supervision pipeline.
 */

export type CanonicalContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/** A tool result flowing back to the model inside a user turn. */
export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface CanonicalMessage {
  role: 'user' | 'assistant';
  content: (CanonicalContent | ToolResultBlock)[];
}

export interface CanonicalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ReasoningConfig {
  effort: 'low' | 'medium' | 'high';
}

export interface TurnUsage {
  /**
   * TOTAL input tokens for the turn — cache reads and cache writes included.
   * Normalised across adapters on purpose: Anthropic reports `input_tokens`
   * net of cache and OpenAI reports `prompt_tokens` gross, so mapping either
   * one straight through would make the context ring and the cost display
   * silently disagree between providers.
   */
  inputTokens: number;
  outputTokens: number;
  /** D49g: input tokens served from the prompt cache, billed at a discount. */
  cacheReadTokens?: number;
  /** D49g: input tokens written into the prompt cache, billed at a premium. */
  cacheWriteTokens?: number;
}

export interface TurnResponse {
  content: CanonicalContent[];
  usage: TurnUsage;
  /**
   * Why the turn ended. 'max_tokens' means the output was truncated by the
   * token cap — callers must not treat such a turn as a complete answer.
   */
  stopReason?: 'stop' | 'max_tokens' | 'tool_use' | 'other';
}

export interface TurnRequest {
  /** Composite ref ('provider:model'); adapters strip their own prefix. */
  model: string;
  system: string;
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  maxTokens: number;
  reasoning?: ReasoningConfig;
  /**
   * D49g: ask the adapter to mark the STABLE PREFIX (the system prompt and the
   * tool schemas) as cacheable, when the provider has explicit prompt caching.
   * A no-op where caching is automatic (OpenAI) or absent.
   *
   * Only the stable prefix is marked. The conversation is deliberately left
   * out: compaction REPLACES the history, so a history cache would be thrown
   * away and re-written at a premium every time it fired.
   */
  cache?: boolean;
  /**
   * D49i: aborts the in-flight request. Without it a cancel could only be
   * honoured at a safe point, so a hung provider call hung the whole run.
   * Adapters pass it to their HTTP layer.
   */
  signal?: AbortSignal;
  /**
   * D49j: receives the turn's text as it comes off the wire. When set the
   * adapter streams; when absent it makes one blocking request. The returned
   * TurnResponse is IDENTICAL either way — streaming changes only WHEN the
   * text is visible, never what it says — so no caller has to branch on it.
   */
  onDelta?: (text: string) => void;
}

/** One API turn. Instances bind their credentials. */
export interface ChatProvider {
  readonly id: 'anthropic' | 'openai';
  completeTurn(req: TurnRequest): Promise<TurnResponse>;
}
