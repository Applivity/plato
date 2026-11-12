import {
  COMPACT_SYSTEM_PROMPT,
  DEFAULT_CONTEXT_WINDOW,
  applyFold,
  buildFoldPrompt,
  compactMaxTokensFor,
  historyTokens,
  isMessageRow,
  lastSummaryIndex,
  parseModelRef,
  planFold,
  planRequest,
  splitModelRef,
  type ChatProvider,
  type LogRow,
  type RequestTurn,
} from '@applivity/plato-core';
import type { PlatoConfig } from './config.js';
import { modelPool } from './models.js';
import type { Env } from './paths.js';

/**
 * D49aa and D44d amended, carried into the terminal (D49ct parity round).
 *
 * The CLI used to keep the conversation as a flat list of role/text pairs. That
 * is enough to replay a chat and not enough to compact one: a fold needs to
 * know which rows were messages and which were tool calls, and it needs a place
 * to WRITE its summary so the transcript it leaves behind is never rewritten.
 *
 * The rules themselves live in core (`chatlog.ts`), where they are tested and
 * shared with the desktop chat. This module is the CLI's side of that contract:
 * the row shape a saved session stores, the request every later run is sent, and
 * the one fold all three triggers (reached the threshold, the user asked, an
 * hour of silence) go through.
 */
export type ChatRow = LogRow & {
  k: 'msg' | 'tool' | 'compact';
  cls?: 'you' | 'bot' | 'in';
};

/** Why a fold ran. The notice names the cause, never just "compacted". */
export type FoldCause = 'auto' | 'manual' | 'idle';

export interface FoldRequest {
  rows: readonly ChatRow[];
  provider: ChatProvider;
  /** `connection:model`, as the config stores it. */
  model: string;
  /** The model's context window — the run's own resolved value. */
  maxContext: number;
  /** The user's compaction threshold (0..1), the same one the run uses. */
  threshold: number;
  cause: FoldCause;
  /** `/compact <text>`: what the user asked the summary to keep. */
  focus?: string;
}

export interface FoldOutcome {
  rows: ChatRow[];
  folded: boolean;
  /** What the host shows. Null means there was nothing to fold. */
  notice: string | null;
  /** Measured share of the window, for the "nothing to compact" line. */
  share: number;
  tokens: number;
}

/** The flat pairs the session store has always held. */
export type HistoryPair = { role: 'user' | 'assistant'; text: string };

/**
 * A saved conversation from before the log existed is a flat pair list. It is
 * read as message rows, so an old session resumes exactly as it did.
 */
export function chatRowsFromHistory(history: readonly HistoryPair[]): ChatRow[] {
  return history.map((entry) => ({
    k: 'msg',
    cls: entry.role === 'user' ? 'you' : 'bot',
    text: entry.text,
  }));
}

/** The message rows, in the shape the old store (and `titleFor`) reads. */
export function historyFromRows(rows: readonly LogRow[]): HistoryPair[] {
  const out: HistoryPair[] = [];
  for (const row of rows) {
    if (row.k !== 'msg') continue;
    if (row.cls === 'you') out.push({ role: 'user', text: row.text ?? '' });
    else if (row.cls === 'bot') out.push({ role: 'assistant', text: row.text ?? '' });
  }
  return out;
}

/**
 * What every later run is sent: the running summary, the recent tail, and — only
 * after a summary exists — the current state of the files the conversation
 * touched (added by the host, because it needs the workspace).
 *
 * The cap is the user's own line (threshold x window), measured in tokens. The
 * log loses nothing when it bites; the model is told in the request.
 */
export function requestHistory(
  rows: readonly ChatRow[],
  maxContext: number,
  threshold: number,
): { turns: RequestTurn[]; omitted: number } {
  return planRequest(rows, Math.floor(maxContext * threshold));
}

/** True when a fold has happened and a summary is the model's memory boundary. */
export function summaryInEffect(rows: readonly LogRow[]): boolean {
  return lastSummaryIndex(rows) >= 0;
}

/**
 * The window a fold and a request plan against: what the connection advertised
 * for this model, and core's own 128k assumption when it said nothing. Both
 * hosts resolve it the same way, so the terminal and the desktop chat cannot
 * disagree about when a conversation is full.
 */
export async function resolveContextWindow(options: {
  config: PlatoConfig;
  model: string;
  env: Env;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<number> {
  const parts = parseModelRef(
    options.model,
    options.config.connections.map((connection) => connection.id),
  );
  if (parts === null) return DEFAULT_CONTEXT_WINDOW;
  const connection = options.config.connections.find(
    (entry) => entry.id === parts.connectionId,
  );
  if (connection === undefined) return DEFAULT_CONTEXT_WINDOW;
  try {
    const pool = await modelPool(connection, {
      env: options.env,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    return (
      pool.pool.find((model) => model.id === parts.model)?.maxContext ??
      DEFAULT_CONTEXT_WINDOW
    );
  } catch {
    // A connection that cannot answer is not a failed fold.
    return DEFAULT_CONTEXT_WINDOW;
  }
}

/** A token count a person can read at a glance. */
function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The notice a fold leaves. It names the cause, says the transcript is intact,
 * and — for the automatic trigger — the user's own threshold, because that is
 * the number that decided it.
 */
export function foldNotice(
  cause: FoldCause,
  messages: number,
  tokens: number,
  threshold: number,
): string {
  const label = messages === 1 ? 'message' : 'messages';
  if (cause === 'manual') {
    return (
      `Summary added for ${messages} earlier ${label}, as you asked. ` +
      'Nothing was removed from the transcript.'
    );
  }
  if (cause === 'idle') {
    return (
      `Compacted while idle at ${count(tokens)} — earlier messages were summarised ` +
      'so the conversation stays within the context window. ' +
      'Nothing was removed from the transcript.'
    );
  }
  return (
    `Conversation reached ${Math.round(threshold * 100)}% of this model's context — ` +
    'earlier messages were summarised so the whole conversation still fits. ' +
    'Nothing was removed from the transcript.'
  );
}

/** The provider call one fold makes, through the same connection the run uses. */
function summaryRequest(prompt: string, model: string): Parameters<ChatProvider['completeTurn']>[0] {
  const bare = splitModelRef(model)?.model ?? model;
  return {
    model,
    system: COMPACT_SYSTEM_PROMPT,
    tools: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: compactMaxTokensFor(bare),
  };
}

/**
 * Fold everything older than the keep budget into a summary row, or say there
 * was nothing old enough. The rows the summary covers STAY in the log; only a
 * later request omits them. That is what makes "nothing was removed from the
 * transcript" true rather than reassuring.
 */
export async function foldConversation(request: FoldRequest): Promise<FoldOutcome> {
  const rows = [...request.rows];
  const tokens = historyTokens(rows);
  const share =
    request.maxContext > 0 ? Math.round((tokens / request.maxContext) * 100) : 0;
  // The idle trigger has already decided it is time; like `/compact`, it is
  // allowed to summarise below the size threshold, because the user turned the
  // setting on. Only the automatic trigger is gated by size.
  const plan = planFold(rows, {
    maxContext: request.maxContext,
    threshold: request.threshold,
    manual: request.cause !== 'auto',
  });
  if (plan === null) {
    return { rows, folded: false, notice: null, share, tokens };
  }

  const priorIndex = lastSummaryIndex(rows);
  const prior =
    priorIndex >= 0 ? (rows[priorIndex]?.text ?? null) : null;
  const prompt = buildFoldPrompt(prior, plan.covered, request.focus);
  const response = await request.provider.completeTurn(
    summaryRequest(prompt, request.model),
  );
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim();
  if (text.length === 0) {
    return {
      rows,
      folded: false,
      notice: 'Compaction produced no summary — the conversation was kept as it was.',
      share,
      tokens,
    };
  }

  const summaryRow: ChatRow = { k: 'compact', text };
  const folded = applyFold(rows, plan, summaryRow);
  const messages = plan.covered.filter(isMessageRow).length;
  return {
    rows: folded,
    folded: true,
    notice: foldNotice(request.cause, messages, plan.tokens, request.threshold),
    share,
    tokens,
  };
}
