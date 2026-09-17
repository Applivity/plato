/**
 * OpenAI-compatible adapter (D25b/D07): plain fetch against any
 * chat-completions endpoint — OpenAI, OpenRouter, Ollama, self-hosted —
 * selected via baseUrl. No SDK dependency. Tool calling uses function
 * tools; reasoning_effort is attached only when requested AND the caller
 * resolved that the model supports it (registry flag).
 */
import { ProviderError, parseRetryAfter, toProviderError } from './errors.js';
import type {
  CanonicalContent,
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from './types.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface ChatCompletionsResponse {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** D49g: OpenAI reports the implicitly-cached subset here. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class OpenAICompatProvider implements ChatProvider {
  readonly id = 'openai' as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl?: string,
    private readonly fetchImpl: FetchLike = (...a) => fetch(...a),
  ) {}

  private strip(ref: string): string {
    const i = ref.indexOf(':');
    return i >= 0 ? ref.slice(i + 1) : ref;
  }

  async completeTurn(req: TurnRequest): Promise<TurnResponse> {
    const messages: Record<string, unknown>[] = [
      { role: 'system', content: req.system },
    ];
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        const text = m.content
          .filter((b): b is Extract<CanonicalContent, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const calls = m.content.filter(
          (b): b is Extract<CanonicalContent, { type: 'tool_use' }> =>
            b.type === 'tool_use',
        );
        messages.push({
          role: 'assistant',
          content: text.length > 0 ? text : null,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.input),
                  },
                })),
              }
            : {}),
        });
        continue;
      }
      // user turn: tool results and optional guidance text
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          messages.push({
            role: 'tool',
            tool_call_id: b.toolUseId,
            content: b.content,
          });
        } else if (b.type === 'text') {
          messages.push({ role: 'user', content: b.text });
        }
        // tool_use inside a user turn is invalid; skipped.
      }
    }

    const body: Record<string, unknown> = {
      model: this.strip(req.model),
      max_tokens: req.maxTokens,
      messages,
    };
    // D40b: an empty tools array is a 400 on OpenAI-compatible
    // endpoints (minItems: 1). Omit the key entirely for tool-less
    // turns (e.g. the D40 conversation-title call).
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (req.reasoning) {
      const efforts = { low: 'low', medium: 'medium', high: 'high' } as const;
      body.reasoning_effort = efforts[req.reasoning.effort];
    }

    const base = (this.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.apiKey.length > 0) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      // D49d: a rejected fetch (DNS failure, refused socket) has no status —
      // keep it distinguishable from an HTTP error so the retry policy can
      // treat a transport failure as retryable.
      throw toProviderError(e, 'openai');
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new ProviderError(
        res.status,
        detail,
        'openai',
        parseRetryAfter(res.headers.get('retry-after')),
      );
    }
    const json = (await res.json()) as ChatCompletionsResponse;
    const msg = json.choices?.[0]?.message;

    const content: CanonicalContent[] = [];
    if (msg?.content && msg.content.length > 0) {
      content.push({ type: 'text', text: msg.content });
    }
    for (const c of msg?.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments) as Record<string, unknown>;
      } catch {
        input = { _raw: c.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: c.id,
        name: c.function.name,
        input,
      });
    }

    // D49g: `prompt_tokens` is GROSS (it already counts the cached ones), and
    // OpenAI caches implicitly — there is no `cache` request flag and no write
    // premium. Report the cached subset so the saving is visible; the total is
    // already correct, which is why this is the one adapter that needs no
    // arithmetic.
    const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
      stopReason:
        json.choices?.[0]?.finish_reason === 'length'
          ? 'max_tokens'
          : json.choices?.[0]?.finish_reason === 'tool_calls'
            ? 'tool_use'
            : json.choices?.[0]?.finish_reason === 'stop'
              ? 'stop'
              : 'other',
    };
  }
}
