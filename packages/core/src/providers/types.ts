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
  inputTokens: number;
  outputTokens: number;
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
}

/** One non-streaming API turn. Instances bind their credentials. */
export interface ChatProvider {
  readonly id: 'anthropic' | 'openai';
  completeTurn(req: TurnRequest): Promise<TurnResponse>;
}
