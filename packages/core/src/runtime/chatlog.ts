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
 *
 * D44d amended (2026-11-12): the cross-run fold was a COUNT — it ran at 26
 * message rows and kept 12 — while the settings slider, the ring and the run's
 * own compaction were all about a share of the model's window. A real client run
 * on a 1,000,000-token window (prompt peak 203,228 tokens, 20%) was folded anyway
 * and told the user so. The trigger is now the measured size of the history
 * against the window and the SAME threshold the run uses
 * (`shouldAutoCompact`), and how much is kept verbatim is a token budget —
 * `FOLD_KEEP_FRACTION` of the window — never a row count.
 */
import { INBOUND_MARKER, REPLY_MARKER } from '../live.js';
import { pathArgsOf } from '../security/paths.js';
import { parseTodos, todoSummary } from '../tools/todo.js';
import { estimateTokens, shouldAutoCompact } from './context.js';

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
  /**
   * D49cq: who sent a message from another session, as the row shows it
   * ("From <name>"), and which host it came from. Read when a later run replays
   * the row, so the model is told again that this was not the user.
   */
  readonly who?: string | undefined;
  readonly from?: string | undefined;
  /**
   * D49cq (amended): this inbound row was the answer to a message this session
   * sent. A later run replays it with the reply header, so the model is told
   * again that the exchange is over and it must not answer back.
   */
  readonly reply?: boolean | undefined;
}

/** A message the model should see, in wire form. */
export interface RequestTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * True for a row the model conversed in — not a tool record or a card.
 *
 * D49cq: `in` is a message another session sent. It is a message row because
 * the run it started is part of this conversation: a later run must remember
 * the exchange, and a fold must be able to summarise it. It is NOT replayed as
 * the user's own words — `requestFromLog` gives it a provenance header.
 */
export function isMessageRow(row: LogRow): boolean {
  return row.k === 'msg' && (row.cls === 'you' || row.cls === 'bot' || row.cls === 'in');
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
    case 'request_mode': {
      // D49cb: the TARGET only. The reason is model prose written for a card,
      // and the digest is persisted and replayed into folds — a reason could
      // quote anything the model had in front of it, so it stays out of the
      // record exactly as tool arguments do.
      const mode = one(args['mode'], 20);
      if (mode.length > 0) parts.push(mode);
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
    case 'send_to_session': {
      // D49cq: the TARGET and the SIZE, not the text. The digest is persisted
      // and replayed into folds, and the text is model prose written for
      // another session — it stays out of the record exactly as `request_mode`'s
      // reason does (D49cb). The receiving session holds the text itself, and
      // the sender's own conversation shows it.
      const to = one(args['to'], 60);
      if (to.length > 0) parts.push('to ' + to);
      const text = args['text'];
      if (typeof text === 'string' && text.length > 0) {
        parts.push(`(${text.length} chars)`);
      }
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

/** D49ag: the heading a run of tool digests is carried under. */
export const ACTIVITY_LABEL = '[tool activity — what Plato ran]';

/**
 * D44d amended (2026-11-12): the share of the model's window a fold keeps WORD
 * FOR WORD.
 *
 * This replaces `KEEP_AFTER_FOLD = 12` message ROWS, which was a cadence rather
 * than a size. A quarter of the window is chosen deliberately:
 *
 *   - it is enough recent conversation to continue a long one naturally — on a
 *     200,000-token window it is ~50,000 tokens of verbatim context;
 *   - it is below every threshold the slider allows (its floor is 0.5), so a
 *     fold always brings the history back under the user's line with room to
 *     grow: at the 0.8 default the kept tail can more than double before the
 *     next fold, which is what stops folding from thrashing;
 *   - it matches the rule already used for the summary's own output budget
 *     (`compactMaxTokensFor`: a quarter of the model's output cap, D37a).
 */
export const FOLD_KEEP_FRACTION = 0.25;

/**
 * The newest exchange is kept whatever the budget says. A floor for coherence,
 * not a cadence: a continuation whose last question was summarised instead of
 * quoted is not a continuation. One exchange can exceed the budget only when it
 * alone is a quarter of the window.
 */
const FOLD_KEEP_FLOOR_MESSAGES = 2;

/** Estimated tokens one row costs in the request (0 for a row it does not send). */
function sentTokens(row: LogRow): number {
  if (isToolRow(row)) {
    return (row.digest ?? '').length > 0 ? estimateTokens('- ' + toolLine(row)) : 0;
  }
  return isMessageRow(row) ? estimateTokens(row.text ?? '') : 0;
}

/** Indexes of the rows after `start` that a request actually carries. */
function sentIndexes(rows: readonly LogRow[], start: number): number[] {
  const out: number[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (isMessageRow(row) || (isToolRow(row) && (row.digest ?? '').length > 0)) {
      out.push(i);
    }
  }
  return out;
}

/**
 * Tokens in `sent[from..to)`, measured the way `planRequest` renders them: the
 * tool activity label is emitted once per contiguous group of tool rows.
 */
function spanTokens(
  rows: readonly LogRow[],
  sent: readonly number[],
  from: number,
  to: number,
): number {
  let n = 0;
  let tools = false;
  for (let p = from; p < to; p += 1) {
    const row = rows[sent[p]!]!;
    const t = sentTokens(row);
    if (t > 0) {
      n += t;
      if (isToolRow(row)) tools = true;
    }
  }
  if (tools) n += estimateTokens(ACTIVITY_LABEL);
  return n;
}

/**
 * The first sent row a token budget keeps, and how many message rows fall
 * before it. Walks backwards from the newest exchange; a tool row always
 * belongs to the message before it, so a cut cannot strand one.
 */
function keepFrom(
  rows: readonly LogRow[],
  sent: readonly number[],
  budget: number,
): { from: number; omitted: number } {
  if (sent.length === 0) return { from: rows.length, omitted: 0 };
  const msgPos: number[] = [];
  for (let p = 0; p < sent.length; p += 1) {
    if (isMessageRow(rows[sent[p]!]!)) msgPos.push(p);
  }
  if (msgPos.length === 0) return { from: sent[0]!, omitted: 0 };
  const floorP = Math.max(0, msgPos.length - FOLD_KEEP_FLOOR_MESSAGES);
  let fromP = msgPos[floorP]!;
  let used = spanTokens(rows, sent, fromP, sent.length);
  for (let k = floorP - 1; k >= 0; k -= 1) {
    const cost = spanTokens(rows, sent, msgPos[k]!, msgPos[k + 1]!);
    if (used + cost > budget) break;
    used += cost;
    fromP = msgPos[k]!;
  }
  let omitted = 0;
  for (const p of msgPos) {
    if (p < fromP) omitted += 1;
  }
  return { from: sent[fromP]!, omitted };
}

/** What a request would carry: its turns, and message rows the cap left out. */
export interface RequestPlan {
  turns: RequestTurn[];
  /**
   * Message rows beyond the token cap that are NOT in this request. The log is
   * untouched — this is what the model is not sent, never what the user loses.
   */
  omitted: number;
}

/**
 * What the model is sent: the running summary (if a fold has happened) followed
 * by the raw recent tail, capped by a TOKEN budget so a skipped fold cannot send
 * an unbounded conversation.
 *
 * D44d amended (2026-11-12): the cap used to be `MAX_TAIL_PAIRS = 60` message
 * rows and it dropped the older ones in silence. A cap is a safety net, not a
 * rule, so it is measured now — and when it bites, the request says so rather
 * than the model believing the conversation began at the cut. In normal
 * operation the fold keeps the tail far below it; only a fold that keeps failing
 * reaches this.
 *
 * D49ag: the tail carries its TOOL DIGESTS, grouped where they occurred. A tool
 * row with no digest is skipped entirely, so a log written before that change
 * produces byte-identical requests.
 */
export function planRequest(
  rows: readonly LogRow[],
  maxTailTokens: number = Number.POSITIVE_INFINITY,
): RequestPlan {
  const c = lastSummaryIndex(rows);
  const out: RequestTurn[] = [];
  if (c >= 0) {
    out.push({
      role: 'user',
      text: '[Summary of the earlier conversation]\n' + (rows[c]!.text ?? ''),
    });
  }
  const sent = sentIndexes(rows, c + 1);
  let from = sent.length > 0 ? sent[0]! : rows.length;
  let omitted = 0;
  if (Number.isFinite(maxTailTokens)) {
    const keep = keepFrom(rows, sent, maxTailTokens);
    from = keep.from;
    omitted = keep.omitted;
  }
  if (omitted > 0) {
    out.push({
      role: 'user',
      text:
        "[Earlier messages omitted to fit this model's context]\n" +
        (omitted === 1
          ? '1 older message is'
          : omitted + ' older messages are') +
        ' not in this request.',
    });
  }
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    out.push({ role: 'user', text: ACTIVITY_LABEL + '\n' + pending.join('\n') });
    pending = [];
  };
  for (let i = from; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (isToolRow(row)) {
      if ((row.digest ?? '').length > 0) pending.push('- ' + toolLine(row));
      continue;
    }
    if (!isMessageRow(row)) continue;
    flush();
    const inbound = row.cls === 'in';
    out.push({
      role: row.cls === 'you' || inbound ? 'user' : 'assistant',
      text: inbound ? inboundTurn(row) : (row.text ?? ''),
    });
  }
  flush();
  return { turns: out, omitted };
}

/** The turns alone — the shape most callers want; see `planRequest` for the cap. */
export function requestFromLog(
  rows: readonly LogRow[],
  maxTailTokens: number = Number.POSITIVE_INFINITY,
): RequestTurn[] {
  return planRequest(rows, maxTailTokens).turns;
}

/**
 * The estimated size of the history a model would be sent: the summary plus the
 * tail, by the same chars/4 estimator the run's context ring uses.
 */
export function historyTokens(rows: readonly LogRow[]): number {
  let n = 0;
  for (const turn of requestFromLog(rows)) n += estimateTokens(turn.text);
  return n;
}

/**
 * D49cq: how a message from another session is replayed on a LATER run. The
 * row keeps the message as it arrived; the provenance is added here, so the
 * model reads it as somebody else's words every time — not only in the run
 * that first received it. The opening marker is the same one the sending host
 * uses for the live task, so both paths read alike to the model.
 */
function inboundTurn(row: LogRow): string {
  const name = (row.who ?? '').replace(/^(?:From|Reply from)\s+/i, '').trim();
  const host = (row.from ?? '').trim();
  const who = name.length > 0 ? `name "${name}"` : 'an unnamed session';
  const provenance = `${who}${host.length > 0 ? `, host ${host}` : ''}`;
  if (row.reply === true) {
    return (
      `${REPLY_MARKER} ${provenance}. This is not from the user: it is the answer to the ` +
      `message this session sent. The exchange ends here — do not reply again.]\n${row.text ?? ''}`
    );
  }
  return (
    `${INBOUND_MARKER} ${provenance}. ` +
    `This is not from the user.]\n${row.text ?? ''}`
  );
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
  /** The measured size of the history when the plan was made, in tokens. */
  tokens: number;
}

/** What decides whether a fold runs, and how much it keeps. */
export interface FoldBudget {
  /** The model's context window — the run's own `resolveMaxContext` result. */
  maxContext: number;
  /** The user's compaction threshold (0..1) — the SAME one the run uses. */
  threshold: number;
  /**
   * True when the user asked (`/compact`): the request is the trigger, so the
   * size trigger is skipped. How much is kept is STILL the token budget — there
   * must be something older than it to summarise, or there is nothing to do.
   */
  manual?: boolean;
}

/**
 * Where a fold writes its summary, or null when the history does not call for
 * one.
 *
 * D44d amended: the trigger is the size of the history the model would be sent
 * — the summary plus the tail — against the model's window and the user's
 * threshold, through `shouldAutoCompact`, the SAME function and numbers the
 * run's in-run compaction uses. There is no message count anywhere: a few very
 * large messages fold long before many short ones do.
 *
 * The cut is a token budget (`FOLD_KEEP_FRACTION` of the window), minus the
 * summary already in the log because it is sent with the tail. `insertAt` is the
 * index of the first row the tail keeps, so the rows from the last summary up to
 * it are the ones being summarised. Returning null rather than an empty plan
 * keeps "nothing to do" distinct from "fold at the start".
 */
export function planFold<T extends LogRow>(
  rows: readonly T[],
  budget: FoldBudget,
): FoldPlan<T> | null {
  const start = lastSummaryIndex(rows) + 1;
  const tokens = historyTokens(rows);
  if (
    budget.manual !== true &&
    !shouldAutoCompact(tokens, budget.maxContext, budget.threshold)
  ) {
    return null;
  }
  const summaryTokens =
    start > 0 ? estimateTokens(rows[start - 1]!.text ?? '') : 0;
  const room = Math.floor(budget.maxContext * FOLD_KEEP_FRACTION) - summaryTokens;
  const keep = keepFrom(rows, sentIndexes(rows, start), room);
  if (keep.omitted === 0) return null;
  const covered: T[] = [];
  for (let i = start; i < keep.from; i += 1) {
    const row = rows[i]!;
    if (isMessageRow(row) || isToolRow(row)) covered.push(row);
  }
  return { insertAt: keep.from, covered, tokens };
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
  focus?: string,
): string {
  const blocks: string[] = [
    'Summarise the following conversation so the assistant can continue ' +
      'without it. Be terse and fact-only.',
  ];
  if (prior !== null && prior.length > 0) {
    blocks.push('[existing summary of the earlier conversation]\n' + prior);
  }
  // D49do: `/compact <text>` carries the user's own instruction about what the
  // summary must keep. It sits before the transcript, where an instruction
  // belongs, and is absent when the user gave none.
  const keep = (focus ?? '').trim();
  if (keep.length > 0) {
    blocks.push('[the user asked the summary to keep]\n' + keep);
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

/** What the display cap removed, by kind of row. */
export interface TrimRemoved {
  /** Tool records — the work. */
  tools: number;
  /** Message rows — the user's own words and the assistant's replies. */
  messages: number;
  /** Cards, notes and the summary row itself. */
  other: number;
  /** The model's summary was among the rows removed; the caller must say so. */
  lostSummary: boolean;
}

/**
 * D49aa amended (2026-11-12): apply the transcript's display cap, dropping the
 * WORK before the CONVERSATION.
 *
 * Every row counted against one cap, so a client chat with 265 tool records hit
 * it and lost its opening question and answer first — the transcript he then
 * read began with an answer to a question he could no longer see. The order is
 * now: tool rows, oldest first; then other bookkeeping rows; and only when
 * nothing else is left, message rows. A transcript bounded by losing its
 * conversation is not a bounded transcript, it is a different one.
 *
 * `trim` rows are never dropped: they ARE the record of this cap, and the
 * caller writes one. The caller keeps the log within `max` itself, including
 * that note.
 */
export function planTrim<T extends LogRow>(
  rows: readonly T[],
  max: number,
): { rows: T[]; removed: TrimRemoved } {
  const kept = [...rows];
  const removed: TrimRemoved = {
    tools: 0,
    messages: 0,
    other: 0,
    lostSummary: false,
  };
  let need = kept.length - max;
  const take = (
    match: (row: T) => boolean,
    kind: 'tools' | 'messages' | 'other',
  ): void => {
    for (let i = 0; i < kept.length && need > 0; ) {
      const row = kept[i]!;
      if (!match(row)) {
        i += 1;
        continue;
      }
      if (row.k === 'compact') removed.lostSummary = true;
      kept.splice(i, 1);
      removed[kind] += 1;
      need -= 1;
    }
  };
  if (need > 0) take((r) => r.k === 'tool', 'tools');
  if (need > 0) {
    take((r) => r.k !== 'tool' && r.k !== 'trim' && !isMessageRow(r), 'other');
  }
  if (need > 0) take(isMessageRow, 'messages');
  return { rows: kept, removed };
}
