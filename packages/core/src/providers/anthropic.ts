/**
 * M0 provider: Anthropic streaming chat via the official SDK (D21a).
 * The provider abstraction for OpenAI-compatible endpoints arrives in a
 * later milestone; do not generalize early.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Model for M0 demos. */
export const M0_MODEL = 'claude-sonnet-4-5' as const;

const SYSTEM_PROMPT =
  'You answer questions about the user workspace from the provided file listing.';

/**
 * Thin wrapper around the official SDK. Keeps key handling with the caller
 * (the extension passes it per call, read from SecretStorage).
 */
export class AnthropicProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Streams `messages` and forwards text deltas to `onText`. Resolves with
   * the full concatenated answer text.
   */
  async streamChat(
    messages: ChatMessage[],
    onText: (delta: string) => void,
  ): Promise<string> {
    const stream = this.client.messages.stream({
      model: M0_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    stream.on('text', onText);
    const final = await stream.finalMessage();
    let text = '';
    for (const block of final.content) {
      if (block.type === 'text') {
        text += block.text;
      }
    }
    return text;
  }
}
