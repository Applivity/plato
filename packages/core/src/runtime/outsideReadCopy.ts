/**
 * D49dk (2026-11-12): what Plato SAYS when a read reaches outside the project.
 *
 * The founder's instruction: do what Claude Code does — do not make the user
 * enumerate rules, let the agent read what it needs, with the user's say-so,
 * asked at the moment the model tries. On the client's Windows machine a UNC
 * address of a file that sits INSIDE the workspace through its drive path was
 * refused; the address is a different string and the workspace rule is lexical,
 * so the right answer is a question, not a wall.
 *
 * The copy lives in core, beside `approvalCopy` and `secretCopy`, for the
 * reason D49ba records: it is the text a user reads and a model acts on, and
 * copy only the shell can reach is copy nothing checks.
 */
import { toolWords } from './toolWords.js';

/**
 * The card the CURRENT hosts draw for the superseded read-only hook. Kept
 * unchanged — folder choice included — so those hosts compile and behave as
 * they did until phase 2 moves them to `outsidePathCard`. New code uses
 * `OutsidePathCard`.
 */
export interface OutsideReadCard {
  /** The tool that asked. The card uses it for the WHY line. */
  tool: string;
  /** The path as the model wrote it. */
  path: string;
  /** The absolute path Plato resolved it to. */
  abs: string;
  /** What "this folder" would cover. */
  folder: string;
  title: string;
  lines: string[];
  why: string;
  once: string;
  folderLabel: string;
  deny: string;
}

export type OutsideKind = 'read' | 'write';

/**
 * One answer a renderer prints as its label plus its hint. The hint travels
 * with the label so a host never invents wording; `choice` is the value the
 * host maps onto its own remembered scope.
 */
export interface OutsideAnswer {
  choice: 'once' | 'session' | 'deny';
  label: string;
  hint: string;
}

/** One path the card must name: the argument as written, and its absolute form. */
export interface OutsideEntry {
  /** The path as the model wrote it. */
  path: string;
  /** The absolute path Plato resolved it to. */
  abs: string;
}

/**
 * D49dk (widened 2026-11-13, corrected by the founder the same day): what Plato
 * says when paths leave the project, for a read or a write.
 *
 * THREE answers, each with one short line, and no per-folder choice: once
 * covers this call's paths wherever they are; the session choice covers every
 * outside path until the chat ends; deny reads and writes nothing. The
 * remembered scope is the HOST's state — core decides one call at a time.
 *
 * The card names EVERY outside path the call carries, because a call can carry
 * several (apply_patch): an answer given while one path was shown would be a
 * consent the user could not have meant.
 */
export interface OutsidePathCard {
  /** The tool that asked. The card uses it for the WHY line. */
  tool: string;
  /** Every path the call carries, as arguments and absolute forms. */
  entries: readonly OutsideEntry[];
  /** The first entry's argument, kept for a single-path renderer. */
  path: string;
  /** The first entry's absolute path, kept for a single-path renderer. */
  abs: string;
  kind: OutsideKind;
  title: string;
  lines: string[];
  why: string;
  answers: readonly OutsideAnswer[];
}

/** How many absolute paths a several-path card lists before "and N more". */
const OUTSIDE_MAX_LISTED = 8;

export function outsidePathCard(
  kind: OutsideKind,
  tool: string,
  entries: readonly OutsideEntry[],
): OutsidePathCard {
  const action = kind === 'write' ? 'write to' : 'read';
  const lines: string[] = [];
  if (entries.length <= 1) {
    const entry = entries[0] ?? { path: '', abs: '' };
    lines.push(`Plato wants to ${action} ${entry.abs}.`);
    // A relative path that escapes, or a UNC address of an inside file, is
    // worth showing as itself: the user recognises what the model typed.
    if (entry.path !== entry.abs) {
      lines.push(`The model asked for "${entry.path}".`);
    }
    lines.push('That path is outside the project folder.');
  } else {
    lines.push(
      `Plato wants to ${kind === 'write' ? 'write' : 'read'} ${entries.length} files outside the project:`,
    );
    for (const entry of entries.slice(0, OUTSIDE_MAX_LISTED)) {
      lines.push(entry.abs);
    }
    if (entries.length > OUTSIDE_MAX_LISTED) {
      lines.push(`and ${entries.length - OUTSIDE_MAX_LISTED} more`);
    }
    lines.push('These paths are outside the project folder.');
  }
  if (kind === 'write') {
    // A statement of fact, not a warning: the undo store keeps workspace-
    // relative paths, and skips an outside one.
    lines.push("Plato's undo covers files inside the project, so this change is outside it.");
  }
  return {
    tool,
    entries,
    path: entries[0]?.path ?? '',
    abs: entries[0]?.abs ?? '',
    kind,
    title:
      kind === 'write'
        ? 'Write a file outside the project?'
        : 'Read a file outside the project?',
    lines,
    why: `Plato is ${toolWords(tool).doing}. The path it was given is not inside the project.`,
    answers: [
      { choice: 'once', label: 'Allow once', hint: 'Just this one request.' },
      {
        choice: 'session',
        label: 'Allow for this session',
        hint: 'Anything outside the project until this chat ends.',
      },
      {
        choice: 'deny',
        label: 'Deny',
        hint: kind === 'write' ? 'Nothing is changed.' : 'Nothing is read.',
      },
    ],
  };
}

/** The READ card the current hosts draw; superseded, unchanged on purpose. */
export function outsideReadCard(
  tool: string,
  path: string,
  abs: string,
  folder: string,
): OutsideReadCard {
  const lines = [`Plato wants to read ${abs}.`];
  if (path !== abs) {
    lines.push(`The model asked for "${path}".`);
  }
  lines.push('That file is outside the project folder.');
  lines.push(
    'Allow once reads this file for this one call. The folder choice lasts until this chat ends. Plato saves neither in your settings.',
  );
  return {
    tool,
    path,
    abs,
    folder,
    title: 'Read a file outside the project?',
    lines,
    why: `Plato is ${toolWords(tool).doing}. The path it was given is not inside the project.`,
    once: 'Allow once',
    folderLabel: 'Allow this folder for this session',
    deny: 'Deny',
  };
}

/**
 * The tool result a DENIED outside path becomes, read or write.
 *
 * A denial is a normal result, not a failure: the model reads it, says what it
 * would have done, and the run continues. It never reaches the executor, so
 * nothing was read or written.
 */
export function outsidePathDeclined(
  kind: OutsideKind,
  tool: string,
  path: string,
): string {
  const action = kind === 'write' ? 'write' : 'read';
  const done = kind === 'write' ? 'Nothing was written.' : 'Nothing was read.';
  return (
    `${tool}: the user declined to ${action} "${path}" outside the workspace. ` +
    `${done} Continue without it, and ask for it again only if the task ` +
    'genuinely cannot be done otherwise.'
  );
}

/** The READ-only spelling, kept for callers that predate the write approval. */
export function outsideReadDeclined(tool: string, path: string): string {
  return outsidePathDeclined('read', tool, path);
}
