/**
 * D49aa: the chat log is append-only, and the model's context is DERIVED from it.
 *
 * The log is the user's transcript; the request is what the model sees. They are
 * two different things and they were the same array. A fold summarised the older
 * turns and then cleared the array and rebuilt it from the summary plus the kept
 * tail — which is a fine thing to do to a REQUEST and a catastrophic thing to do
 * to a transcript. The founder's scrollback disappeared the moment a run ended,
 * because the run ending scheduled a fold.
 *
 * The reader was never wrong: it already finds the last summary row and builds
 * [summary, ...everything after it]. Only the writer destroyed anything. So the
 * fold now WRITES A ROW at the cut instead of clearing the log, and both readers
 * keep working unchanged — the marker is the model's memory boundary, and it
 * doubles as the visible mark in the transcript where that boundary sits.
 *
 * These functions are the rules, kept here rather than in the shell so they can
 * be tested. `LogRow` is the structural shape they need; the shell's richer
 * `Entry` union satisfies it without being moved.
 */

/** The part of a chat-log row these rules read. */
export interface LogRow {
  readonly k: string;
  readonly cls?: string | undefined;
  readonly text?: string | undefined;
}

/** A message the model should see, in wire form. */
export interface RequestTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** True for a row the model conversed in — not a tool record or a card. */
export function isMessageRow(row: LogRow): boolean {
  return row.k === 'msg' && (row.cls === 'you' || row.cls === 'bot');
}

/** Index of the last summary row, or -1. The model's memory starts after it. */
export function lastSummaryIndex(rows: readonly LogRow[]): number {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]!.k === 'compact') return i;
  }
  return -1;
}

/** Message rows sitting after the last summary — the model's raw recent tail. */
export function tailPairs(rows: readonly LogRow[]): number {
  const start = lastSummaryIndex(rows) + 1;
  let n = 0;
  for (let i = start; i < rows.length; i += 1) {
    if (isMessageRow(rows[i]!)) n += 1;
  }
  return n;
}

/**
 * What the model is sent: the running summary (if a fold has happened) followed
 * by the raw recent tail, capped so a skipped fold cannot send an unbounded
 * conversation.
 */
export function requestFromLog(
  rows: readonly LogRow[],
  maxTailPairs: number,
): RequestTurn[] {
  const c = lastSummaryIndex(rows);
  const out: RequestTurn[] = [];
  if (c >= 0) {
    const s = rows[c]!;
    out.push({
      role: 'user',
      text: '[Summary of the earlier conversation]\n' + (s.text ?? ''),
    });
  }
  const tail: LogRow[] = [];
  for (let i = c + 1; i < rows.length; i += 1) {
    if (isMessageRow(rows[i]!)) tail.push(rows[i]!);
  }
  for (const row of tail.slice(-maxTailPairs)) {
    out.push({
      role: row.cls === 'you' ? 'user' : 'assistant',
      text: row.text ?? '',
    });
  }
  return out;
}

/** A fold to perform: summarise `covered`, then write the summary at `insertAt`. */
export interface FoldPlan<T extends LogRow> {
  /** Absolute index the summary row is written at. Nothing before it moves. */
  insertAt: number;
  /** The message rows the summary must account for, oldest first. */
  covered: readonly T[];
}

/**
 * Where a fold writes its summary, or null when the tail is still short enough.
 *
 * `insertAt` is the index of the first message the tail KEEPS, so the rows from
 * the last summary up to it are the ones being summarised. Returning null rather
 * than an empty plan keeps "nothing to do" distinct from "fold at the start".
 */
export function planFold<T extends LogRow>(
  rows: readonly T[],
  keepPairs: number,
): FoldPlan<T> | null {
  const start = lastSummaryIndex(rows) + 1;
  const pairs: number[] = [];
  for (let i = start; i < rows.length; i += 1) {
    if (isMessageRow(rows[i]!)) pairs.push(i);
  }
  if (pairs.length <= keepPairs) return null;
  const insertAt = pairs[pairs.length - keepPairs]!;
  const covered: T[] = [];
  for (let i = start; i < insertAt; i += 1) {
    if (isMessageRow(rows[i]!)) covered.push(rows[i]!);
  }
  return { insertAt, covered };
}

/**
 * The fold's ONE write to the transcript: put the summary row at the cut and
 * move nothing else.
 *
 * This is deliberately the whole of it. The fault this replaces was a rewrite —
 * `log.length = 0` followed by the summary and the kept tail — which is a
 * reasonable way to rebuild a REQUEST and a destructive way to treat a
 * transcript. Keeping the write in one tested function is what makes "the log
 * only ever grows" checkable rather than a claim about the shell.
 */
export function applyFold<T extends LogRow>(
  rows: readonly T[],
  plan: FoldPlan<T>,
  summaryRow: T,
): T[] {
  return [
    ...rows.slice(0, plan.insertAt),
    summaryRow,
    ...rows.slice(plan.insertAt),
  ];
}
