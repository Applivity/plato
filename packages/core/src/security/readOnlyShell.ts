/**
 * D49an: which shell commands `edit` mode may run WITHOUT an approval card.
 *
 * **The founder's ask:** *"for read only shell commands the edit should not ask
 * permission."* His reasoning is the one that matters: a run that stops to
 * approve `git status` and `ls` is a run whose approvals the user starts clicking
 * through, and an approval nobody reads protects nothing.
 *
 * # Why an allowlist, and not a "does this command write?" check
 *
 * A shell command is a program, so deciding what it will do by reading its text
 * is a guess. This file does not make that guess. It answers a narrower and
 * answerable question: **is this command one of a small set of programs, given
 * only plain words, that cannot write?** Anything else — including every command
 * this file does not recognise — fails the test and asks as before.
 *
 * That direction is the whole safety property. **A false negative costs a click.
 * A false positive writes a file.** So every rule here is written to fail
 * closed, and the list is deliberately short: adding a program means auditing its
 * flags for one that writes, which is why `sort` (has `-o`), `sed` (has `-i`),
 * `awk` (has `system()`) and every network tool are absent.
 *
 * # The three ways a command escapes the list, all refused
 *
 * 1. **Becoming several commands, or writing.** Every shell metacharacter that
 *    chains, substitutes, redirects or expands disqualifies the command —
 *    `; & | < > $ ` ( ) { } !` and a newline. A command that passes is a plain
 *    sequence of words with no shell meaning left in it.
 * 2. **Globbing to a file the command does not name.** `*`, `?` and `[` are
 *    refused, and **this one is load-bearing for the secret deny-list**: the
 *    deny-list (D49ai) matches the file NAMES in the command text, so
 *    `cat *.properties` would name no secret and read one. Without globbing,
 *    a command can only open files it spells out.
 * 3. **Leaving the workspace.** An argument starting `/` or `~`, or containing
 *    `..`, is refused, so an auto-approved read stays inside the project — the
 *    same containment the file tools enforce (D49k).
 *
 * # What this does NOT guarantee, stated rather than implied
 *
 * - **A symlink defeats it.** A lexical check cannot see that `notes.txt` is a
 *   link to `keystore.properties`. The secret check has the same limit (D49ai),
 *   but in `edit` it used to be backed by a card the user read and now, for these
 *   commands, it is not. Recorded as residual risk in D49an.
 * - **`git status` is not strictly read-only.** It may refresh `.git/index`'s
 *   stat cache. Accepted: it changes no tracked content, and refusing it would
 *   remove the single most common thing a coding agent runs.
 * - **A provider-level flag nobody thought of.** The per-program flag lists below
 *   are audit results, not proofs. A flag that writes, added to one of these
 *   programs in a future release, would widen the hole until someone notices.
 */

/**
 * Characters with shell meaning. Any one of them disqualifies the command.
 *
 * This is a refusal list for *shell syntax*, never for "commands that look
 * dangerous" — a distinction worth keeping, because a text check that tried to
 * recognise writing would be the guess this file exists to avoid.
 */
const SHELL_SYNTAX = new Set([
  ';', '&', '|', '<', '>', '$', '`',
  '(', ')', '{', '}', '!',
  // A newline separates commands exactly as `;` does.
  '\n', '\r',
  // Globbing: see the header. `[` is a character class, which is why it is here.
  '*', '?', '[', ']',
]);

/**
 * Programs that cannot write, given plain arguments.
 *
 * Every one is a filter or a lister: it reads named files and prints. `git` is
 * the exception and is handled by subcommand below.
 */
const READ_ONLY_PROGRAMS = new Set([
  'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'tree',
  'du', 'df', 'which', 'type', 'basename', 'dirname', 'realpath',
  'readlink', 'echo', 'diff', 'comm', 'cut', 'tr', 'uniq', 'grep', 'rg',
  'find',
]);

/** `git` subcommands that only read. */
const READ_ONLY_GIT = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'describe', 'rev-parse',
  'ls-files', 'shortlog', 'whatchanged', 'grep',
]);

/**
 * Flags that turn a read-only program into a writer, per program.
 *
 * An entry matches the whole argument or a prefix of it, so `--output=x` is
 * caught by `--output`. Each list is an audit result for that one program, which
 * is the cost of adding a program to the allowlist: its flags must be read.
 * `tree -o` and `file -C` are here because both write, despite the programs being
 * listers.
 */
const WRITE_FLAGS: Record<string, string[]> = {
  git: ['--output', '-o', '--exec', '--edit'],
  diff: ['-o', '--output'],
  find: [
    '-exec', '-execdir', '-ok', '-okdir',
    '-delete', '-fprint', '-fprint0', '-fprintf', '-fls',
  ],
  tree: ['-o', '--output'],
  file: ['-C', '--compile'],
};

/** True when a path argument tries to leave the workspace. */
function escapesWorkspace(arg: string): boolean {
  if (arg.startsWith('/') || arg.startsWith('~')) return true;
  // A `..` segment anywhere, including inside a relative path.
  return arg.split('/').includes('..');
}

/**
 * Can this command only read named files inside the workspace?
 *
 * Pure: it decides from the text alone and never touches the filesystem, so it
 * is exhaustively testable — which matters, because a wrong `true` here is an
 * unapproved write.
 */
export function isReadOnlyShellCommand(command: string): boolean {
  if (typeof command !== 'string' || command.trim().length === 0) return false;

  for (const ch of command) {
    if (SHELL_SYNTAX.has(ch)) return false;
  }
  // A backslash can continue a line or escape a character; treat it as syntax.
  if (command.includes('\\')) return false;

  const argv = command.trim().split(/\s+/);
  const program = argv[0] ?? '';
  // A path-qualified program (`./x`, `/usr/bin/ls`) is not on the list.
  if (program.includes('/')) return false;

  const rest = argv.slice(1);
  for (const arg of rest) {
    if (escapesWorkspace(arg)) return false;
  }

  if (program === 'git') {
    const sub = rest[0];
    // `git --version` reads and writes nothing; keep the two obvious ones.
    if (sub === '--version' || sub === '--help') return true;
    if (sub === undefined || !READ_ONLY_GIT.has(sub)) return false;
  } else if (!READ_ONLY_PROGRAMS.has(program)) {
    return false;
  }

  const banned = WRITE_FLAGS[program] ?? [];
  for (const arg of rest) {
    if (banned.some((b) => arg === b || arg.startsWith(b))) return false;
  }
  return true;
}
