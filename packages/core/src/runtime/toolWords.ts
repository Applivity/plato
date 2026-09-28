/**
 * D49ba: what a tool is CALLED when the user reads about it.
 *
 * Three places in the product named tools by their internal identifier — the
 * guard line (*"guard stopped write_file — it named a protected file"*), the
 * progress line (*"using shell"*), and the collapsed activity row
 * (*"read_file × 12 · shell × 2"*). A user does not know what `apply_diff` is,
 * and should not have to.
 *
 * **One table, three views, because a second list that must agree is a list that
 * will not.** Each tool has three forms and they are used by exactly one place
 * each:
 *
 *   - `noun`    — the object of a sentence: *"Plato did not run the command."*
 *   - `doing`   — present tense, for work in progress: *"running a command"*
 *   - `counted` — a plural for a tally: *"2 commands run"*
 *
 * The forms are written out rather than derived, because English will not let
 * them be: "run"/"running"/"commands run" is not a rule, it is three words. The
 * table is small and every entry is visible, which is the point — a tool added
 * without an entry falls back to the generic form rather than printing its
 * identifier.
 */
export interface ToolWords {
  /** The object of a sentence. */
  noun: string;
  /** Present tense, for a run in progress. */
  doing: string;
  /** A plural, for a count. */
  counted: string;
}

const GENERIC: ToolWords = {
  noun: 'the tool call',
  doing: 'using a tool',
  counted: 'tool calls',
};

const WORDS: Record<string, ToolWords> = {
  read_file: { noun: 'the read', doing: 'reading a file', counted: 'files read' },
  write_file: { noun: 'the write', doing: 'writing a file', counted: 'files written' },
  apply_diff: { noun: 'the edit', doing: 'editing a file', counted: 'files edited' },
  apply_patch: { noun: 'the edit', doing: 'editing files', counted: 'files edited' },
  list_dir: { noun: 'the listing', doing: 'listing a folder', counted: 'folders listed' },
  grep: { noun: 'the search', doing: 'searching', counted: 'searches' },
  glob: { noun: 'the search', doing: 'searching', counted: 'searches' },
  shell: { noun: 'the command', doing: 'running a command', counted: 'commands run' },
  bash_output: { noun: 'the output read', doing: 'reading the output', counted: 'outputs read' },
  kill_shell: { noun: 'the stop', doing: 'stopping a command', counted: 'commands stopped' },
  git: { noun: 'the git command', doing: 'running git', counted: 'git commands' },
  web_fetch: { noun: 'the fetch', doing: 'fetching a page', counted: 'pages fetched' },
  todo_write: { noun: 'the plan', doing: 'writing the plan', counted: 'plans written' },
  ask_user: { noun: 'the question', doing: 'asking you', counted: 'questions' },
};

export function toolWords(tool: string): ToolWords {
  return WORDS[tool] ?? GENERIC;
}

/**
 * Every tool's words, for the view.
 *
 * The webview runs as a plain script with no imports, so the table reaches it the
 * same way the slash-command menu does: posted once at ready. That keeps ONE
 * source of truth — the alternative is a second copy inside the template
 * literal, which is the failure this whole file exists to avoid.
 *
 * `ask_user` is deliberately included even though it never appears as a tool
 * row: the guard can refuse anything, and a refusal must never print an
 * identifier.
 */
export function toolWordsForView(): Record<string, ToolWords> {
  return { ...WORDS, _generic: GENERIC };
}
