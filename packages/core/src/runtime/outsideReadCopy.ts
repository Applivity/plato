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

/** What the outside-read card says, and what its three buttons are called. */
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

export function outsideReadCard(
  tool: string,
  path: string,
  abs: string,
  folder: string,
): OutsideReadCard {
  const lines = [`Plato wants to read ${abs}.`];
  // A relative path that escapes, or a UNC address of an inside file, is worth
  // showing as itself: the user recognises what the model typed.
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
 * The tool result a DENIED outside read becomes.
 *
 * A denial is a normal result, not a failure: the model reads it, says what it
 * would have done, and the run continues. It never reaches the executor, so
 * nothing was read.
 */
export function outsideReadDeclined(tool: string, path: string): string {
  return (
    `${tool}: the user declined to read "${path}" outside the workspace. ` +
    'Nothing was read. Continue without it, and do not ask for the same file ' +
    'again unless they raise it.'
  );
}
