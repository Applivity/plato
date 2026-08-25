/**
 * Anthropic-native adapter (D25b): maps the canonical turn contract onto
 * the official SDK. Behavior matches the pre-abstraction loop exactly;
 * extended thinking is enabled only when a reasoning config is supplied.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type {
  CanonicalContent,
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from './types.js';

function stripPrefix(ref: string): string {
  const i = ref.indexOf(':');
  return i >= 0 ? ref.slice(i + 1) : ref;
}

export class AnthropicNativeProvider implements ChatProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async completeTurn(req: TurnRequest): Promise<TurnResponse> {
    const messages: MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content.map((b): ContentBlockParam | ToolResultBlockParam => {
        if (b.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_use_id: b.toolUseId,
            content: b.content,
            is_error: b.isError,
          };
        }
        if (b.type === 'tool_use') {
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        }
        return { type: 'text', text: b.text };
      }),
    }));

    let maxTokens = req.maxTokens;
    let extra: { thinking?: { type: 'enabled'; budget_tokens: number } } = {};
    if (req.reasoning) {
      const budgets = { low: 2048, medium: 8192, high: 16384 } as const;
      const budget = budgets[req.reasoning.effort];
      if (budget >= maxTokens) {
        maxTokens = budget + 4096; // Anthropic requires max > budget
      }
      extra = { thinking: { type: 'enabled', budget_tokens: budget } };
    }

    const res = await this.client.messages.create({
      model: stripPrefix(req.model),
      max_tokens: maxTokens,
      system: req.system,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
      })),
      messages,
      ...extra,
    });

    const content: CanonicalContent[] = [];
    for (const block of res.content as ContentBlockParam[]) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      usage: {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      },
    };
  }
}
