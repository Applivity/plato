/**
 * D49aw: bounding a run by REPETITION, not by volume.
 *
 * The 40-turn cap was deleted (D49ab) because it counted the wrong thing: it cut
 * a *working* run at two-thirds after the user had approved eleven writes. Turns
 * bound neither money nor time — one measured run spent 10,442 output tokens
 * across 40 turns, and a thinking model can spend more than that in three. Every
 * bound that survived in the field (Cline, Roo, OpenCode, Gemini CLI, OpenHands)
 * counts *wasted effort* instead, and resets the moment anything succeeds. That
 * is the difference: this caps spinning, never progress.
 *
 * **Two triggers, one interruption.** A call repeated until it says nothing new,
 * and a run of turns in which nothing succeeded. Both are facts about the run,
 * neither is a guess about intent.
 *
 * **The rule that keeps it from becoming a nuisance is the KEY.** Repetition is
 * judged on the call AND the result it produced, not the call alone. An agent
 * that re-runs the test suite after every edit issues the same command many
 * times over and is doing its job — but the output differs every time, because
 * the code changed. Pairing them removes that whole class of false positive,
 * and OpenHands is the only shipped agent doing it (it requires four).
 *
 * **What is deliberately NOT detected.** Alternating patterns (edit → build →
 * edit → build is both the normal working cycle and a textbook oscillation, so
 * detecting it would flag nearly every sane run), a workspace that has not
 * changed (reading, grepping and planning legitimately change nothing), and
 * paraphrased repeats (they need embeddings, and similar-intent-different-words
 * is exactly what real progress looks like). A guard built on any of those
 * misfires on ordinary work.
 *
 * **Nothing here ends a run on its own.** The first trip asks the MODEL to
 * change approach; only a repeat after that is put to the user, who decides.
 * Cline and Roo both pause and ask rather than aborting, and OpenCode raises a
 * permission prompt — no shipping agent kills a run silently, because a silent
 * stop is indistinguishable from success, which is the failure this codebase
 * keeps re-learning.
 */

import { digestToolCall } from './chatlog.js';
import { parseTodos } from '../tools/todo.js';
import { pathArgsOf } from '../security/paths.js';

/** Consecutive repeats that earn the model a nudge. Matches Cline's CLI. */
export const STUCK_NUDGE_AT = 3;

/**
 * Consecutive repeats that are put to the user. Matches Cline's CLI, which
 * ships soft 3 / hard 5 on exactly this signal.
 *
 * Three then five deliberately gives the model two chances to change course
 * after being told, before the user is interrupted at all.
 */
export const STUCK_ASK_AT = 5;

/**
 * What a call turned out to be. The distinction that matters most is
 * `declined`: the user's own refusal must never count toward a card aimed at
 * the user, or five declines in `edit` mode would raise "you look stuck"
 * *because you said no*.
 */
export type CallOutcome = 'ok' | 'failed' | 'blocked' | 'declined';

export interface StuckCall {
  tool: string;
  args: Record<string, unknown>;
  /** What the model was shown — the tool result after any suffix was added. */
  result: string;
  outcome: CallOutcome;
}

export interface StuckRequest {
  kind: 'repeat' | 'no-progress';
  /** `repeat`: times the same call repeated. `no-progress`: turns in the streak. */
  count: number;
  /** `repeat` only: the call as one line, e.g. `shell: pnpm build`. */
  call?: string;
  /** `no-progress` only: calls that failed across the streak. */
  failures?: number;
  /** The last call that worked, e.g. `write_file: src/DateHelper.java`, or ''. */
  lastSuccess: string;
}

export type StuckVerdict =
  | { kind: 'ok' }
  | { kind: 'nudge'; text: string; note: string }
  | { kind: 'ask'; request: StuckRequest };

/** Stable across key order, so two identical calls produce one key. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableJson(o[k]))
      .join(',') +
    '}'
  );
}

/** The call without its result — what an exemption and the nag-guard key on. */
function callKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}\u0000${stableJson(args)}`;
}

export class StuckWatch {
  private readonly nudgeAt: number;
  private readonly askAt: number;

  /** The last call + result seen. Repetition is judged against this. */
  private lastFull = '';
  private repeatCount = 0;
  /** Cleared whenever the repeat run breaks, so one run of repeats nudges once. */
  private nudged = false;
  private asked = false;
  /**
   * Calls the user told us to leave alone — "keep going", in answer to a repeat
   * card. Per run, so the same call is never put to them twice, while a NEW
   * stuck pattern is still caught.
   */
  private readonly exempt = new Set<string>();

  /** Turns whose calls all failed, and the calls that failed across them. */
  private failStreak = 0;
  private streakFailures = 0;
  private streakNudged = false;
  private streakAsked = false;
  private turnFailures = 0;
  private turnSuccesses = 0;

  private lastSuccess = '';

  /**
   * The question currently on screen, if any. Kept so the answer cannot be
   * applied to a different call than the one that was asked about.
   */
  private pending: { kind: StuckRequest['kind']; key: string } | null = null;

  constructor(opts: { nudgeAt?: number; askAt?: number } = {}) {
    this.nudgeAt = opts.nudgeAt ?? STUCK_NUDGE_AT;
    this.askAt = opts.askAt ?? STUCK_ASK_AT;
  }

  /** One tool call, as the loop produced it. */
  observe(rec: StuckCall): StuckVerdict {
    if (rec.outcome === 'declined') return { kind: 'ok' };

    const key = callKey(rec.tool, rec.args);
    const full = `${key}\u0000${rec.result}`;
    if (full === this.lastFull) {
      this.repeatCount += 1;
    } else {
      this.lastFull = full;
      this.repeatCount = 1;
      this.nudged = false;
      this.asked = false;
    }

    if (rec.outcome === 'ok') {
      this.lastSuccess = describeCall(rec.tool, rec.args);
      this.turnSuccesses += 1;
    } else if (rec.outcome === 'failed') {
      this.turnFailures += 1;
    }

    // Exempted only after the user's answer, and only for `repeat` — see
    // `resolve`. A no-progress run of the same call is a different signal.
    if (this.asked || this.exempt.has(key)) return { kind: 'ok' };

    if (this.repeatCount >= this.askAt) {
      this.asked = true;
      this.pending = { kind: 'repeat', key };
      return { kind: 'ask', request: this.repeatRequest(rec) };
    }
    if (this.repeatCount >= this.nudgeAt && !this.nudged) {
      this.nudged = true;
      const request = this.repeatRequest(rec);
      return { kind: 'nudge', text: nudgeText(request), note: nudgeNote(request) };
    }
    return { kind: 'ok' };
  }

  /**
   * The end of a turn — the point at which "nothing succeeded" is a fact rather
   * than a snapshot mid-turn.
   *
   * A turn that neither succeeded nor failed (every call was blocked, or the
   * user declined them all) is NEUTRAL: it neither extends the streak nor
   * resets it. Resetting on it would let a model escape the guard by mixing in
   * a refused call; extending it would count the user's own "no" against them.
   */
  endTurn(): StuckVerdict {
    if (this.turnSuccesses > 0) {
      this.failStreak = 0;
      this.streakFailures = 0;
      this.streakNudged = false;
      this.streakAsked = false;
    } else if (this.turnFailures > 0) {
      this.failStreak += 1;
      this.streakFailures += this.turnFailures;
    }
    this.turnFailures = 0;
    this.turnSuccesses = 0;

    if (this.streakAsked) return { kind: 'ok' };
    if (this.failStreak >= this.askAt) {
      this.streakAsked = true;
      this.pending = { kind: 'no-progress', key: '' };
      return { kind: 'ask', request: this.streakRequest() };
    }
    if (this.failStreak >= this.nudgeAt && !this.streakNudged) {
      this.streakNudged = true;
      const request = this.streakRequest();
      return { kind: 'nudge', text: nudgeText(request), note: nudgeNote(request) };
    }
    return { kind: 'ok' };
  }

  /**
   * The user's answer to a `repeat` card.
   *
   * `continue` exempts that ONE call for the rest of the run — the "I know, it
   * is re-running the build, leave me alone" case — while a different repeated
   * call is still caught. For `no-progress` there is nothing to exempt, so the
   * streak simply starts again; being told once more after another five failed
   * turns is information, not nagging.
   */
  resolve(answer: 'continue' | 'stop'): void {
    const pending = this.pending;
    this.pending = null;
    if (pending === null || answer === 'stop') return;
    if (pending.kind === 'no-progress') {
      this.failStreak = 0;
      this.streakFailures = 0;
      this.streakNudged = false;
      this.streakAsked = false;
      return;
    }
    this.lastFull = '';
    this.repeatCount = 0;
    this.nudged = false;
    this.asked = false;
    this.exempt.add(pending.key);
  }

  /**
   * New information arrived — the user typed guidance, or answered with some.
   * The model deserves a fresh chance, so no card is raised on the strength of
   * turns that happened before the user spoke.
   */
  reset(): void {
    this.lastFull = '';
    this.repeatCount = 0;
    this.nudged = false;
    this.asked = false;
    this.failStreak = 0;
    this.streakFailures = 0;
    this.streakNudged = false;
    this.streakAsked = false;
  }

  private repeatRequest(rec: StuckCall): StuckRequest {
    return {
      kind: 'repeat',
      count: this.repeatCount,
      call: describeCall(rec.tool, rec.args),
      lastSuccess: this.lastSuccess,
    };
  }

  private streakRequest(): StuckRequest {
    return {
      kind: 'no-progress',
      count: this.failStreak,
      failures: this.streakFailures,
      lastSuccess: this.lastSuccess,
    };
  }
}

/** How long a single quoted argument may be before it is clipped. */
const MAX_ARG = 80;

function clip(s: string, max = MAX_ARG): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/** The tools a person would describe as an action on a file. */
const FILE_VERB: Record<string, string> = {
  read_file: 'reading',
  read_image: 'looking at',
  write_file: 'writing',
  apply_diff: 'editing',
  apply_patch: 'editing',
};

/**
 * The call as a PERSON reads it — `running pnpm build`, `reading src/DateHelper.java`.
 *
 * **Deliberately NOT `digestToolCall`.** That is the LOG's vocabulary: it is
 * written for a fold and for the next run's model, and it renders as
 * `todo_write: 1 item, 0 done, in progress: …`. Shown to a user that is machine
 * noise, and the founder's review said so. This leads with the verb instead,
 * because the verb is the part a person recognises. An unknown tool falls back
 * to the digest, which beats a bare name.
 */
export function describeCall(tool: string, args: Record<string, unknown>): string {
  const verb = FILE_VERB[tool];
  if (verb !== undefined) {
    const path = pathArgsOf(tool, args)[0];
    return path !== undefined ? `${verb} ${clip(path)}` : `${verb} a file`;
  }
  const one = (key: string, max = MAX_ARG): string =>
    typeof args[key] === 'string' ? clip(String(args[key]), max) : '';
  switch (tool) {
    case 'shell': {
      const cmd = one('command');
      return cmd.length > 0 ? `running ${cmd}` : 'running a command';
    }
    case 'grep': {
      const pat = one('pattern', 50);
      return pat.length > 0 ? `searching for ${pat}` : 'searching the code';
    }
    case 'glob': {
      const pat = one('pattern', 50);
      return pat.length > 0 ? `finding files matching ${pat}` : 'finding files';
    }
    case 'list_dir':
      return 'listing a folder';
    case 'git': {
      const v = one('verb', 20);
      return v.length > 0 ? `running git ${v}` : 'running git';
    }
    case 'web_fetch': {
      const url = one('url');
      return url.length > 0 ? `fetching ${url}` : 'fetching a page';
    }
    case 'ask_user':
      return 'asking you a question';
    case 'todo_write': {
      const parsed = parseTodos(args['todos']);
      const now = 'todos' in parsed ? parsed.todos.find((t) => t.status === 'in_progress') : undefined;
      return now !== undefined && now.content.length > 0
        ? `updating its plan (${clip(now.content, 60)})`
        : 'updating its plan';
    }
    default: {
      const digest = digestToolCall(tool, args);
      return digest.length > 0 ? `${tool} (${digest})` : tool;
    }
  }
}

function times(n: number): string {
  return n === 1 ? 'once' : `${n} times`;
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

/**
 * What the MODEL is told. The point is to say the thing the model cannot see —
 * that the call it is about to make again has already been made and answered —
 * and to leave it two honest ways out: change approach, or say what is blocking.
 */
export function nudgeText(req: StuckRequest): string {
  const tail =
    'Repeating it will not produce a different answer. Change your approach, ' +
    'or say what is blocking you.';
  if (req.kind === 'repeat') {
    return (
      `[plato] You have now made this exact call ${times(req.count)} in a row and it returned ` +
      `the same thing each time:\n  ${req.call}\n${tail}`
    );
  }
  return (
    `[plato] The last ${req.count} turns all failed — ${req.failures} call${plural(
      req.failures ?? 1,
    )}, none of them worked. ${lastWorked(req)}\n${tail}`
  );
}

function lastWorked(req: StuckRequest): string {
  return req.lastSuccess.length > 0
    ? `The last thing that worked was ${req.lastSuccess}.`
    : 'Nothing has worked yet in this run.';
}

/**
 * The line the user reads when the model has been nudged.
 *
 * This line exists so the pause is never a surprise, so it must say the two
 * things a surprise costs: what is happening, and WHAT HAPPENS NEXT. The
 * previous wording — "It has been asked to try something else" — was passive and
 * told the user nothing they could act on; the founder's review called it vague
 * and he was right.
 */
export function nudgeNote(req: StuckRequest): string {
  const next =
    'It has been told to try something different, and if that does not work it will stop and ask you.';
  if (req.kind === 'repeat') {
    return `Plato is stuck on the same call — ${req.call}, ${times(req.count)} so far. ${next}`;
  }
  return `${req.count} turns in a row have failed. ${next}`;
}

/**
 * The card, as wording. The shell renders it; the sentences live here so they
 * are testable.
 *
 * Four parts, and the last one is the point: `lead` says what happened, `call`
 * is the specific thing, `detail` is where it got to, and **`help` tells the
 * user what they can do now**. A card that only describes the problem leaves
 * the user with no way out, which is the failure the founder flagged.
 */
export interface StuckCard {
  title: string;
  /** What happened, in one sentence a person reads. */
  lead: string;
  /** The repeated call, shown on its own line. Absent for no-progress. */
  call?: string;
  /** Where it got to. Absent for repetition, which is not about progress. */
  detail?: string;
  /** What the user can do about it. Always present. */
  help: string;
}

/** The same closing advice on every card, so the options are never a guess. */
const HELP =
  'Tell Plato what to do instead, or press Stop and rephrase your request.';

/**
 * D49ba: the half of "Keep going" that the button cannot carry.
 *
 * Answering it does TWO things — it resumes the run, and it exempts that one
 * call for the rest of the run, so Plato never asks about it again. A control
 * states what it does, but a label holding two ideas is a label nobody reads, so
 * the button keeps its two words and the card says the rest.
 *
 * **Repeat cards only.** On a no-progress card there is no single call to
 * exempt, so this sentence would be false there.
 */
const HELP_EXEMPT =
  'Keep going resumes the run, and Plato will not ask about this same call again.';

export function stuckCard(req: StuckRequest): StuckCard {
  if (req.kind === 'repeat') {
    return {
      title: 'Plato is stuck',
      lead: `It has made the same call ${times(req.count)} and got the same answer every time:`,
      ...(req.call !== undefined ? { call: req.call } : {}),
      // Says the SO WHAT without pretending to know why: repeating a call whose
      // answer has not changed can only produce that answer again.
      help: `Repeating it will only give the same answer. ${HELP} ${HELP_EXEMPT}`,
    };
  }
  return {
    title: `${req.count} turns in a row have failed`,
    lead: `Nothing has worked in the last ${req.count} turns — ${req.failures} call${plural(
      req.failures ?? 1,
    )}, and none of them succeeded.`,
    detail: lastWorked(req),
    help: `Trying the same things again will not help. ${HELP}`,
  };
}

/** The record line raised with the card, so the wait is never invisible. */
export function askNote(req: StuckRequest): string {
  if (req.kind === 'repeat') {
    return `Plato is stuck on the same call — ${req.call}, ${times(req.count)} — and is waiting for you.`;
  }
  return `${req.count} turns in a row have failed. Plato is waiting for you.`;
}

/**
 * How the run explains itself when the user chose to stop, or when there was
 * nobody to ask.
 *
 * It closes the loop the card opened: the run says what happened **and what the
 * user can do next**, because this line is the last thing they read. The old
 * wording ended on a machine digest — "the same call 5 times (todo_write: 1 item,
 * 0 done, in progress: …)" — which is log vocabulary in a person's closing line.
 */
export function stuckStopNote(req: StuckRequest): string {
  const next = 'Nothing was lost — tell Plato what to do differently, or rephrase your request.';
  if (req.kind === 'repeat') {
    return `Stopped — Plato was stuck on the same call (${req.call}) and kept getting the same answer. ${next}`;
  }
  return `Stopped — the last ${req.count} turns all failed. ${lastWorked(req)} ${next}`;
}

/** What the model is told when the user answers "keep going". */
export function continueText(req: StuckRequest, guidance: string): string {
  const what =
    req.kind === 'repeat'
      ? `You have made this same call ${times(req.count)} (${req.call})`
      : `The last ${req.count} turns all failed`;
  const said = guidance.trim().length > 0 ? `\nThe user says: ${guidance.trim()}` : '';
  return `[plato] ${what}. The user has told you to continue. If it is not working, change your approach or say what is blocking you.${said}`;
}
