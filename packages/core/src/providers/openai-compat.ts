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
    /**
     * D49j: the streaming shape. Same information as `message`, delivered as
     * fragments — text arrives in pieces, and tool calls are split across
     * chunks keyed by `index`.
     */
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
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

/** A tool call reassembled from its fragments, keyed by the delta's `index`. */
interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

/** Why the turn ended, from either wire format. */
function stopReasonFrom(finish: string | null | undefined): TurnResponse['stopReason'] {
  return finish === 'length'
    ? 'max_tokens'
    : finish === 'tool_calls'
      ? 'tool_use'
      : finish === 'stop'
        ? 'stop'
        : 'other';
}

/**
 * D49j: reads a `text/event-stream` body and rebuilds the SAME response object
 * the non-streaming path parses, so both routes share `mapResponse` below and
 * cannot drift. Hand-written because this adapter carries no SDK by doctrine
 * (D07).
 *
 * `onDelta` fires per text fragment. Everything else accumulates.
 */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<ChatCompletionsResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let finish: string | null = null;
  let usage: ChatCompletionsResponse['usage'];
  const calls = new Map<number, ToolCallAcc>();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // `{stream: true}` keeps a multi-byte character split across chunk
    // boundaries whole; a `data:` line split across reads is handled by
    // holding the unterminated tail in `buf`.
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    let sawDone = false;
    for (const raw of lines) {
      // CRLF and bare LF both appear in the wild.
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      // ':' is the SSE heartbeat/comment; every other field is ignored
      // because only `data:` carries a payload here.
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        sawDone = true;
        break;
      }
      if (payload.length === 0) continue;
      let chunk: ChatCompletionsResponse;
      try {
        chunk = JSON.parse(payload) as ChatCompletionsResponse;
      } catch {
        continue; // a keep-alive that is not JSON; ignore it
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        onDelta(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = calls.get(idx) ?? { id: '', name: '', args: '' };
        // Only the first fragment carries the id; name and arguments arrive
        // in pieces and are concatenated by string.
        if (tc.id) acc.id += tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        calls.set(idx, acc);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }
    if (sawDone) break;
  }

  return {
    // Reassembled into the non-streaming shape. `content` stays null rather
    // than '' so the shared mapping applies the same emptiness rule to both.
    choices: [
      {
        finish_reason: finish,
        message: {
          content: text.length > 0 ? text : null,
          ...(calls.size > 0
            ? {
                tool_calls: [...calls.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, c]) => ({
                    id: c.id,
                    function: { name: c.name, arguments: c.args },
                  })),
              }
            : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

/**
 * D49j: the one response mapping, shared by the streaming and non-streaming
 * paths. `consumeSse` rebuilds the non-streaming JSON shape precisely so that
 * both routes land here — the wire format differs, the answer must not.
 */
function mapResponse(json: ChatCompletionsResponse): TurnResponse {
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
    stopReason: stopReasonFrom(json.choices?.[0]?.finish_reason),
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
      // D49n: an image forces the PARTS ARRAY form for this message, and text
      // and image must share one message — so this branch is checked first.
      // Text-only turns keep the bare-string form below, deliberately: older
      // self-hosted servers reject the array, and nothing here should change
      // for them just because images became possible.
      if (m.content.some((b) => b.type === 'image')) {
        const parts: Record<string, unknown>[] = [];
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            // Images ride the opening user turn, which carries no tool results.
            // Kept so the adapter stays honest if that ever changes, rather
            // than dropping one silently.
            messages.push({
              role: 'tool',
              tool_call_id: b.toolUseId,
              content: b.content,
            });
          } else if (b.type === 'text') {
            parts.push({ type: 'text', text: b.text });
          } else if (b.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${b.mime};base64,${b.data}` },
            });
          }
        }
        if (parts.length > 0) messages.push({ role: 'user', content: parts });
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
    if (req.onDelta) {
      // D49j: ask for usage on the final chunk. Some compatible servers do not
      // support `stream_options` and simply omit it — mapResponse then reports
      // {0,0} rather than inventing numbers.
      body.stream = true;
      body.stream_options = { include_usage: true };
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
        signal: req.signal,
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
    // D49j: some compatible servers ignore `stream: true` and answer with a
    // plain JSON body. Trusting the request flag would turn that into a
    // silently EMPTY answer, so the response content-type decides.
    if (
      req.onDelta &&
      res.body !== null &&
      (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ) {
      return mapResponse(await consumeSse(res.body, req.onDelta));
    }
    return mapResponse((await res.json()) as ChatCompletionsResponse);
  }
}
