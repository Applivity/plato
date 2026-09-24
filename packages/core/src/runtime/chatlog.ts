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
 *
 * D49ag: a second fault of the same family, found by reading a run rather than
 * the code. The rules above were right and the DATA was empty: a tool row said
 * `{tool, phase}` and nothing else, so both readers of this log — the fold's
 * summariser and `requestFromLog` — could see that work had happened and never
 * what it was. `digestToolCall` is what a row now records, and it is deliberately
 * the argument and not the result: enough to say *what was done*, so the model
 * can re-read for the content.
 */
import { pathArgsOf } from '../security/paths.js';
import { parseTodos, todoSummary } from '../tools/todo.js';

/** The part of a chat-log row these rules read. */
export interface LogRow {
  readonly k: string;
  readonly cls?: string | undefined;
  readonly text?: string | undefined;
  /**
   * D49ag: what a TOOL row did, one line — see `digestToolCall`.
   *
   * Until this existed a tool row recorded only that a tool ran, so the log held
   * no account of the work at all: a fold summarising it could say "I read some
   * files" and nothing more, and a real summary admitted it — *"No files read
   * (contents not available in transcript)"*. A run is mostly tool calls
   * (measured: 80.8% of the final request on a 78-turn run), so the log was blind
   * to four fifths of what happened.
   *
   * It is the ARGUMENT, never the result: the point of a digest is that the model
   * can tell what was done and re-read for the content. Copying results in would
   * rebuild the very weight compaction exists to shed.
   */
  readonly digest?: string | undefined;
  /** Whether the tool succeeded. Only meaningful on a tool row. */
  readonly ok?: boolean | undefined;
  /** The tool's name. Only meaningful on a tool row. */
  readonly tool?: string | undefined;
  /** The tool row's phase, so a refusal reads differently from a failure. */
  readonly phase?: string | undefined;
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

/** True for a row recording a tool call. */
export function isToolRow(row: LogRow): boolean {
  return row.k === 'tool';
}

/** D49ag: the longest a single tool digest may be. */
export const DIGEST_MAX = 220;

/**
 * D49ag: one line saying what a tool call was FOR.
 *
 * The salient argument per tool, taken by name rather than by dumping `args` —
 * because `args` for `write_file` is the whole file body and for `apply_diff` is
 * the whole diff. A digest that carried those would be a second copy of the work
 * in the log, persisted to workspace state and re-sent on every run, which is the
 * opposite of the point.
 *
 * Returns '' when nothing salient is known — a tool row with no digest is
 * invisible to `requestFromLog` and reads as a bare name in a fold.
 */
export function digestToolCall(
  tool: string,
  args: Record<string, unknown>,
): string {
  const one = (v: unknown, max: number): string => {
    if (typeof v !== 'string') return '';
    const s = v.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };
  const parts: string[] = [];
  // The path-bearing tools share one source of truth (D49k) — a tool that gains
  // a path argument in `pathArgsOf` gets it in the digest with no change here.
  for (const p of pathArgsOf(tool, args)) {
    const s = one(p, 90);
    if (s.length > 0) parts.push(s);
  }
  switch (tool) {
    case 'grep': {
      const pat = one(args['pattern'], 70);
      if (pat.length > 0) parts.push('for ' + pat);
      const glob = one(args['glob'], 50);
      if (glob.length > 0) parts.push('in ' + glob);
      break;
    }
    case 'glob': {
      const pat = one(args['pattern'], 90);
      if (pat.length > 0) parts.push(pat);
      break;
    }
    case 'shell': {
      const cmd = one(args['command'], 140);
      if (cmd.length > 0) parts.push(cmd);
      // A background shell is still running when the row is written, which is
      // what the later `bash_output` / `kill_shell` rows refer to. Without this a
      // memory reads as a command that finished and two calls on a bare number.
      if (args['run_in_background'] === true) parts.push('(background)');
      break;
    }
    case 'web_fetch': {
      const url = one(args['url'], 140);
      if (url.length > 0) parts.push(url);
      break;
    }
    case 'git': {
      const verb = one(args['verb'], 20);
      if (verb.length > 0) parts.push(verb);
      break;
    }
    case 'ask_user': {
      const q = args['questions'];
      const n = Array.isArray(q) ? q.length : 0;
      parts.push(n === 1 ? '1 question' : n + ' questions');
      break;
    }
    case 'todo_write': {
      // D49ah: the plan's SHAPE, not its text. A fold or a later run should know
      // a plan exists, how far it got, and what was in hand — but ten item lines
      // in every digest would spend the log's room on a list the panel already
      // shows, and DIGEST_MAX would cut it mid-list, which is worse than a
      // summary. The items themselves stay in the tool result.
      const parsed = parseTodos(args['todos']);
      if ('todos' in parsed) parts.push(todoSummary(parsed.todos));
      break;
    }
    case 'bash_output':
    case 'kill_shell': {
      const id = one(args['id'], 24);
      if (id.length > 0) parts.push(id);
      break;
    }
    default:
      break;
  }
  const out = parts.join(' ').trim();
  return out.length > DIGEST_MAX ? out.slice(0, DIGEST_MAX - 1) + '…' : out;
}

/**
 * D49ag: the line a fold or a request shows for one tool row.
 *
 * A refusal and a failure are different facts and are said differently: "not
 * permitted in this mode" is not something to retry, and "the user declined" is
 * not something to retry either, while a failure often is.
 */
export function toolLine(row: LogRow): string {
  const name = row.tool ?? 'tool';
  const what = row.digest ?? '';
  const note =
    row.phase === 'denied'
      ? ' (not permitted in this mode)'
      : row.phase === 'declined'
        ? ' (the user declined)'
        : row.ok === false
          ? ' (failed)'
          : '';
  return (what.length > 0 ? `${name} ${what}` : name) + note;
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

/** D49ag: the heading a run of tool digests is carried under. */
export const ACTIVITY_LABEL = '[tool activity — what Plato ran]';

/**
 * What the model is sent: the running summary (if a fold has happened) followed
 * by the raw recent tail, capped so a skipped fold cannot send an unbounded
 * conversation.
 *
 * D49ag: the tail now carries its TOOL DIGESTS, grouped where they occurred.
 * Before that it carried the model's prose and nothing else — so a second message
 * in the same conversation arrived with no record of the files read or the
 * commands run, which is the same blindness the fold had. A tool row is folded
 * into the turn sequence as a bracketed note rather than a fake assistant
 * sentence, so nothing reads as words the model did not write.
 *
 * `maxTailPairs` still counts EXCHANGES, not rows: the cap bounds conversation,
 * and a run of tool rows belongs to the exchange it happened in. **A tool row
 * with no digest is skipped entirely**, so a log written before this change
 * produces byte-identical requests.
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
    const row = rows[i]!;
    if (isMessageRow(row)) {
      tail.push(row);
    } else if (isToolRow(row) && (row.digest ?? '').length > 0) {
      tail.push(row);
    }
  }
  const messages = tail.filter(isMessageRow);
  const kept = messages.slice(-maxTailPairs);
  const from = kept.length > 0 ? tail.indexOf(kept[0]!) : tail.length;
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    out.push({ role: 'user', text: ACTIVITY_LABEL + '\n' + pending.join('\n') });
    pending = [];
  };
  for (const row of tail.slice(from)) {
    if (isToolRow(row)) {
      pending.push('- ' + toolLine(row));
      continue;
    }
    flush();
    out.push({
      role: row.cls === 'you' ? 'user' : 'assistant',
      text: row.text ?? '',
    });
  }
  flush();
  return out;
}

/** A fold to perform: summarise `covered`, then write the summary at `insertAt`. */
export interface FoldPlan<T extends LogRow> {
  /** Absolute index the summary row is written at. Nothing before it moves. */
  insertAt: number;
  /**
   * Every row the summary must account for, oldest first — the message rows AND
   * the tool rows (D49ag).
   *
   * It used to be message rows only, and that is why a fold could summarise a
   * run and none of its work: on the founder's 78-turn run the tool rows were
   * 80.8% of what the model was sent, and the fold could not see one of them.
   * Order is kept because what happened *when* is most of what a summary is for.
   * A caller that wants the pair count filters with `isMessageRow`.
   */
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
    const row = rows[i]!;
    if (isMessageRow(row) || isToolRow(row)) covered.push(row);
  }
  return { insertAt, covered };
}

/**
 * D49ag: the prompt a fold sends, from the rows it must account for.
 *
 * In core rather than the shell for the reason D49aa gives for `applyFold`: the
 * shell has no unit tests, and this is the half of the change that decides
 * whether a fold records the work. The shell had its own copy of this loop, so a
 * regression here would have been invisible to every suite in the repo. Order is
 * the log's order, and a tool row renders through `toolLine` — the same line the
 * request carries, so a summary and a memory can never disagree about what ran.
 */
export function buildFoldPrompt(
  prior: string | null,
  covered: readonly LogRow[],
): string {
  const blocks: string[] = [
    'Summarise the following conversation so the assistant can continue ' +
      'without it. Be terse and fact-only.',
  ];
  if (prior !== null && prior.length > 0) {
    blocks.push('[existing summary of the earlier conversation]\n' + prior);
  }
  for (const row of covered) {
    if (isToolRow(row)) {
      blocks.push('--- TOOL ---\n' + toolLine(row));
      continue;
    }
    if (!isMessageRow(row)) continue;
    const who = row.cls === 'you' ? 'USER' : 'ASSISTANT';
    blocks.push(`--- ${who} ---\n${row.text ?? ''}`);
  }
  return blocks.join('\n\n');
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
