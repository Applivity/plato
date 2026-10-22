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
 *   - `noun`       — the object of a sentence: *"Plato did not run the command."*
 *   - `doing`      — present tense, for work in progress: *"running a command"*
 *   - `counted`    — a plural for a tally: *"2 commands run"*
 *   - `countedOne` — the same tally at one: *"1 command run"*
 *
 * `countedOne` exists because the summary line printed *"1 files edited"*: a
 * tally of one was reading the plural form, because there was no other form to
 * read. It is a separate word rather than a rule for the same reason the rest of
 * this table is written out — "commands run" → "command run" is not a rule that
 * survives "searches".
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
  /** The same count at one, for a tally of a single call. */
  countedOne: string;
}

const GENERIC: ToolWords = {
  noun: 'the tool call',
  doing: 'using a tool',
  counted: 'tool calls',
  countedOne: 'tool call',
};

const WORDS: Record<string, ToolWords> = {
  read_file: { noun: 'the read', doing: 'reading a file', counted: 'files read', countedOne: 'file read' },
  write_file: { noun: 'the write', doing: 'writing a file', counted: 'files written', countedOne: 'file written' },
  apply_diff: { noun: 'the edit', doing: 'editing a file', counted: 'files edited', countedOne: 'file edited' },
  apply_patch: { noun: 'the edit', doing: 'editing files', counted: 'files edited', countedOne: 'file edited' },
  list_dir: { noun: 'the listing', doing: 'listing a folder', counted: 'folders listed', countedOne: 'folder listed' },
  grep: { noun: 'the search', doing: 'searching', counted: 'searches', countedOne: 'search' },
  glob: { noun: 'the search', doing: 'searching', counted: 'searches', countedOne: 'search' },
  shell: { noun: 'the command', doing: 'running a command', counted: 'commands run', countedOne: 'command run' },
  bash_output: { noun: 'the output read', doing: 'reading the output', counted: 'outputs read', countedOne: 'output read' },
  kill_shell: { noun: 'the stop', doing: 'stopping a command', counted: 'commands stopped', countedOne: 'command stopped' },
  git: { noun: 'the git command', doing: 'running git', counted: 'git commands', countedOne: 'git command' },
  web_fetch: { noun: 'the fetch', doing: 'fetching a page', counted: 'pages fetched', countedOne: 'page fetched' },
  todo_write: { noun: 'the plan', doing: 'writing the plan', counted: 'plans written', countedOne: 'plan written' },
  ask_user: { noun: 'the question', doing: 'asking you', counted: 'questions', countedOne: 'question' },
  // D49cb: a request that the user decides; the words name that, not a switch
  // the model made.
  request_mode: { noun: 'the mode request', doing: 'asking for a mode change', counted: 'requests', countedOne: 'request' },
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
