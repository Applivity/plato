/**
 * Context accounting + compaction (D37).
 *
 * Two jobs live in one module because they share the same notion of
 * "how big is what we are about to send the model":
 *
 *   1. `promptBreakdown` and `estimateTokens` are the *estimator* half.
 *      The webview's context ring and the loop's auto-compaction trigger
 *      both read them. They are deliberately simple (chars/4 heuristic
 *      plus a per-block field count for tool inputs) and deliberately
 *      display-only: we never pretend they're exact counts. The provider
 *      always reports a more authoritative `inputTokens` on each turn;
 *      we surface that as a secondary line in the ring tooltip when
 *      available. Per D26c: never fake precision.
 *
 *   2. `compactMessages` and `buildCompactPrompt` are the *compactor*
 *      half. The primitive is the same in both Manual and Auto modes:
 *      summarise the older N messages, keep the most recent K verbatim,
 *      and prepend the summary to the system prompt. Manual is just a
 *      one-shot trigger from the UI; Auto triggers at a threshold the
 *      user sets. The summariser is the same model that did the run,
 *      so no extra key/config is needed.
 *
 * Compaction is a *prompt-shrinking* operation. The visible chat log in
 * `webview.ts` is unaffected — the transcript of what was said is
 * preserved; only what we send the model is condensed.
 */
import type {
  CanonicalContent,
  CanonicalMessage,
  CanonicalTool,
  TurnRequest,
} from '../providers/types.js';
import { maxOutputFor, splitModelRef } from '../providers/registry.js';

/** How many recent messages to keep verbatim across a compaction. */
export const MAX_RECENT_TO_KEEP = 6;

/** Conservative fallback when `maxContext` is unknown. */
export const UNKNOWN_CONTEXT_FLOOR = 8_192;

/** D37a: hard ceiling on the summary call's output budget. */
const COMPACT_MAX_TOKENS_CEILING = 2048;

/** D37a: hard floor so even a tiny-model summary is faithful. */
const COMPACT_MAX_TOKENS_FLOOR = 256;

/**
 * D37a: the summariser's output budget is model-aware. A cheap model
 * with a low per-call cap (e.g. Haiku 3.5 at 8192) doesn't deserve a
 * 16000-token summary; we cap at 1/4 of its own output budget so a
 * verbose model can't blow past its per-call limit. The ceiling keeps
 * costs bounded; the floor keeps a faithful summary possible on
 * tiny models. Unknown models land on the floor formula, which the
 * 8192 fallback resolves to 2048.
 */
export function compactMaxTokensFor(model: string): number {
  const bare = splitModelRef(model)?.model ?? model;
  const cap = maxOutputFor(bare);
  const quarter = Math.floor(cap / 4);
  return Math.max(
    COMPACT_MAX_TOKENS_FLOOR,
    Math.min(COMPACT_MAX_TOKENS_CEILING, quarter),
  );
}

/**
 * D37a: should the auto-compaction trigger? Pure function so the trip
 * math is testable without the loop. `maxContext` MUST come from
 * `maxContextFor(bare)` (catalog) — passing a value from a /models
 * payload is a bug; this helper assumes catalog-shaped input.
 *
 * The reasoning: discovered `context_length` fields (OpenRouter,
 * LiteLLM) are *informational* and may be stale, route-specific, or
 * outright wrong. Compaction timing has to be conservative — we'd
 * rather compact slightly early than trust an advertised number that
 * 400s on a real request. Unknown models fall back to
 * `UNKNOWN_CONTEXT_FLOOR` (8192) because silent unbounded growth is
 * the only worse failure mode than compacting too eagerly.
 */
export function shouldAutoCompact(
  estimatedTokens: number,
  maxContext: number | null,
  threshold: number,
): boolean {
  const ceiling = maxContext ?? UNKNOWN_CONTEXT_FLOOR;
  return estimatedTokens >= ceiling * threshold;
}

/** Heuristic token estimate: ~1 token per 4 chars of text. */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Renders a canonical content block to plain text, for size estimation.
 * Tool uses lose their structured input (we only care about the byte
 * budget) but keep their name + a short repr of the input.
 */
function blockToText(b: CanonicalContent): string {
  if (b.type === 'text') {
    return b.text;
  }
  const inputStr = JSON.stringify(b.input ?? {});
  return `[tool_use ${b.name} ${inputStr}]`;
}

function toolResultToText(b: {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}): string {
  return `[tool_result${b.isError ? ' (error)' : ''} ${b.content}]`;
}

/** Per-bucket token breakdown of what we'd send the model. */
export interface ContextBreakdown {
  system: number;
  user: number;
  assistant: number;
  tool: number;
  /** Convenience: sum of all buckets. */
  total: number;
}

/**
 * Estimates the size of a complete prompt: system + tools + every
 * message. Tools count as a fixed per-tool overhead (name + schema)
 * plus a small per-turn reservation, which keeps the user-facing
 * "tool calls are taking up room" intuition honest.
 */
export function promptBreakdown(
  system: string,
  messages: readonly CanonicalMessage[],
  tools: readonly CanonicalTool[],
): ContextBreakdown {
  const sys = estimateTokens(system);
  // ~120 tokens per tool: name + description + flattened schema. Loose,
  // but stable and roughly right for the JSON Schema bodies we send.
  const tool = tools.length * 120;
  let user = 0;
  let assistant = 0;
  let toolTok = 0;
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text') {
        if (m.role === 'user') {
          user += estimateTokens(b.text);
        } else {
          assistant += estimateTokens(b.text);
        }
      } else if (b.type === 'tool_use') {
        assistant += estimateTokens(blockToText(b));
      } else {
        toolTok += estimateTokens(toolResultToText(b));
      }
    }
  }
  return {
    system: sys,
    user,
    assistant,
    tool: toolTok + tool,
    total: sys + user + assistant + toolTok + tool,
  };
}

/**
 * The summariser's system prompt. Deliberately short: it tells the
 * model to be terse, fact-only, and never invent code or paths.
 */
export const COMPACT_SYSTEM_PROMPT =
  'You are a context compactor. Produce a concise, factual summary of the ' +
  'conversation so far so the assistant can continue without the original ' +
  'messages. Preserve: file paths, function/class names, exact error ' +
  'messages, decisions taken, and any user-stated constraints. Drop: ' +
  'greetings, redundant narration, code that is already on disk. Use ' +
  'short bullet points. Never invent content; if a detail is not in the ' +
  'transcript, omit it.';

/**
 * Builds a single user turn that asks the model to summarise the given
 * transcript. Kept separate from `compactMessages` so tests can pin
 * the exact form.
 */
export function buildCompactPrompt(
  messages: readonly CanonicalMessage[],
): string {
  const lines: string[] = [
    'Summarise the following conversation so the assistant can continue ' +
      'without it. Be terse and fact-only.',
    '',
  ];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const role = m.role === 'user' ? 'USER' : 'ASSISTANT';
    const body = m.content
      .map((b) => {
        if (b.type === 'text') {
          return b.text;
        }
        if (b.type === 'tool_use') {
          return `[tool_use ${b.name} ${JSON.stringify(b.input ?? {})}]`;
        }
        return `[tool_result${b.isError ? ' (error)' : ''} ${b.content}]`;
      })
      .join('\n');
    lines.push(`--- ${role} #${i + 1} ---`);
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Picks the split point for compaction: keep the last `keepRecent`
 * messages intact, condense everything before that. `keepRecent` is
 * clamped to [1, messages.length - 1] so we always condense at least
 * one message when the input is non-empty.
 */
export function compactionSplit(
  messages: readonly CanonicalMessage[],
  keepRecent: number = MAX_RECENT_TO_KEEP,
): { older: CanonicalMessage[]; keep: CanonicalMessage[] } {
  if (messages.length === 0) {
    return { older: [], keep: [] };
  }
  const k = Math.max(1, Math.min(keepRecent, messages.length - 1));
  return {
    older: messages.slice(0, messages.length - k),
    keep: messages.slice(messages.length - k),
  };
}

/**
 * The result of one compaction: the new system prompt (base + summary
 * prefix) and the trimmed message list. The summary is prefixed on
 * the system side so the model's prior conversational context is
 * present in the next call but the verbatim old turns are gone.
 */
export interface CompactedContext {
  system: string;
  messages: CanonicalMessage[];
  /** Tokens in the dropped-older block (estimated, pre-compaction). */
  beforeOlderTokens: number;
  /** Tokens in the kept block (estimated, unchanged by compaction). */
  keepTokens: number;
  /** Tokens in the produced summary, as the provider reported it. */
  summaryTokens: number;
  /** Provider-reported input+output cost of the summary call. */
  summaryCostUsd: number;
  /** Raw summary text the model produced. */
  summary: string;
}

/**
 * Runs a compaction end-to-end: splits, summarises via the same
 * provider the run is using, and returns a ready-to-use
 * `{ system, messages }` pair plus the metrics. The summariser runs
 * with `maxTokens` clamped to a small value (1024) so it cannot blow
 * the budget by trying to be thorough.
 *
 * Errors propagate. Callers should `try/catch` and surface a friendly
 * message — a failed compaction must not silently break the run.
 */
export async function compactMessages(
  client: { completeTurn(req: TurnRequest): Promise<{ content: CanonicalContent[]; usage: { inputTokens: number; outputTokens: number } }> },
  opts: {
    model: string;
    system: string;
    messages: readonly CanonicalMessage[];
    tools: readonly CanonicalTool[];
    /** Optional override; defaults to MAX_RECENT_TO_KEEP. */
    keepRecent?: number;
  },
): Promise<CompactedContext> {
  const { older, keep } = compactionSplit(opts.messages, opts.keepRecent);
  const beforeOlderTokens = promptBreakdown(opts.system, older, []).total;
  const keepTokens = promptBreakdown(opts.system, keep, []).total;
  const prompt = buildCompactPrompt(older);
  const res = await client.completeTurn({
    model: opts.model,
    system: COMPACT_SYSTEM_PROMPT,
    // Tools are useless for a summarisation turn and would inflate the
    // input — drop them.
    tools: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    // D37a: model-aware summary cap. A 1/4 budget of the model's own
    // output cap, capped at 2048 / floored at 256. See
    // `compactMaxTokensFor`.
    maxTokens: compactMaxTokensFor(opts.model),
  });
  const summaryBlock = res.content.find(
    (b): b is Extract<CanonicalContent, { type: 'text' }> => b.type === 'text',
  );
  const summary = (summaryBlock?.text ?? '').trim();
  const summaryTokens = res.usage.inputTokens + res.usage.outputTokens;
  // Cost is computed by the loop from `usage` so we don't need a
  // circular import on cost.ts; leave it to the caller.
  const summaryCostUsd = 0;
  const baseSystem = opts.system;
  const system = summary.length > 0
    ? `${baseSystem}\n\n[Conversation summary so far]\n${summary}`
    : baseSystem;
  return {
    system,
    messages: keep,
    beforeOlderTokens,
    keepTokens,
    summaryTokens,
    summaryCostUsd,
    summary,
  };
}

