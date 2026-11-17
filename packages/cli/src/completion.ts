/**
 * The session's slash commands, in one table (D49cd).
 *
 * Three readers share it: the composer's menu, `/help`, and the dispatcher's
 * vocabulary. Adding a command here — or a menu entry there — cannot leave the
 * other two behind, which is exactly the drift a second list would invite.
 * The words a first argument accepts live here too, so the menu after
 * `/mode ` and the usage `/help` prints are the same facts.
 */
export interface SlashChoice {
  /** The word after the command name. */
  value: string;
  /** One short line, shown beside the word. */
  summary: string;
}

export interface SlashCommand {
  /** The word after the slash, without it. */
  name: string;
  /** One line, for the menu and for `/help`. */
  summary: string;
  /** The words the first argument accepts, with one line each. */
  choices?: readonly SlashChoice[];
  /** A free-form first argument that is also accepted, e.g. `connection:model`. */
  takes?: string;
  /** The argument is prose: no word list, just what the command does. */
  freeText?: true;
}

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: 'mode',
    summary: 'Switch mode (Shift+Tab cycles)',
    choices: [
      { value: 'plan', summary: 'Read and propose; make no changes' },
      { value: 'edit', summary: 'Ask before each write or command' },
      { value: 'auto', summary: 'Write and run without asking' },
    ],
  },
  {
    name: 'model',
    summary: 'Use another model',
    choices: [{ value: 'add', summary: 'Set up another provider' }],
    takes: 'connection:model',
  },
  {
    name: 'team',
    summary: 'Choose the team for the next run',
    choices: [
      { value: 'solo', summary: 'The worker works alone' },
      { value: 'duo', summary: 'One watcher reads the work and can advise' },
      { value: 'academy', summary: 'A panel of watchers reads the work' },
    ],
  },
  {
    name: 'gitignore',
    summary: 'Skip what .gitignore excludes in search',
    choices: [
      { value: 'on', summary: 'Skip .gitignore paths in search' },
      { value: 'off', summary: 'Include them, marked in results' },
    ],
  },
  {
    name: 'compact',
    summary: 'Summarise the conversation; mid-run, ask it to compact',
    freeText: true,
  },
  { name: 'new', summary: 'Start a new conversation' },
  { name: 'undo', summary: 'Put back the files the last run wrote' },
  { name: 'sessions', summary: 'List saved sessions' },
  { name: 'help', summary: 'Show this help' },
  { name: 'exit', summary: 'Leave Plato' },
];

/** The argument words the command accepts, in usage form. */
function usageOf(command: SlashCommand): string | undefined {
  const words = (command.choices ?? []).map((choice) => choice.value);
  if (command.takes !== undefined) words.push(command.takes);
  return words.length === 0 ? undefined : words.join('|');
}

/** A command as the user types it: `/mode plan|edit|auto`. */
export function slashText(command: SlashCommand): string {
  const usage = usageOf(command);
  return usage === undefined ? `/${command.name}` : `/${command.name} ${usage}`;
}

/** The command-name fragment being typed, or null when the menu should stay down. */
export function slashQuery(text: string): string | null {
  // A command is the whole line and starts at the first character. A space
  // means the name is finished and the user is typing arguments.
  if (!text.startsWith('/') || text.includes('\n') || /\s/.test(text)) {
    return null;
  }
  return text.slice(1);
}

/** The commands whose name starts with the fragment, case-insensitive. */
export function suggest(query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  return COMMANDS.filter((command) => command.name.startsWith(needle));
}

/** How many rows the menu may take. A long list scrolls rather than filling the screen. */
export const MENU_ROWS = 10;

/**
 * The slice of the list to draw. The selection is always inside it, and the
 * window moves one row at a time as the selection reaches either edge — so
 * arrow keys scroll the list, and the top of the screen is never a surprise.
 */
export function menuWindow(
  total: number,
  selected: number,
  rows: number = MENU_ROWS,
): { start: number; end: number } {
  const size = Math.min(rows, total);
  const start = Math.max(0, Math.min(selected - size + 1, total - size));
  return { start, end: start + size };
}

/**
 * What Enter does with the highlighted command. A command that takes nothing
 * runs, because a second Enter to say "yes, that one" would be noise; a command
 * that takes arguments is filled in and waits for them.
 */
export function accepted(command: SlashCommand): { text: string; run: boolean } {
  const takesArguments = (command.choices ?? []).length > 0 || command.takes !== undefined;
  return takesArguments
    ? { text: `/${command.name} `, run: false }
    : { text: `/${command.name}`, run: true };
}

/**
 * What Enter does with the highlighted command. Text that already IS the
 * command is run, however many arguments it usually takes: a completion only
 * helps a partial name. A partial name is filled in as before.
 */
export function enterAction(
  text: string,
  command: SlashCommand,
): { action: 'run' | 'fill'; text: string } {
  const typed = text.trim();
  if (typed === `/${command.name}`) {
    return { action: 'run', text: typed };
  }
  const pick = accepted(command);
  return pick.run ? { action: 'run', text: pick.text } : { action: 'fill', text: pick.text };
}

/** A command name followed by a space, and the first argument being typed. */
export interface ArgumentQuery {
  command: SlashCommand;
  /** The first argument as typed. Empty right after the space. */
  fragment: string;
}

/**
 * The argument being typed, for the menu under the composer. Only a single
 * line counts, and only a command name that exists. Arguments that contain a
 * space are free text: no choice can match them.
 */
export function argumentQuery(text: string): ArgumentQuery | null {
  if (!text.startsWith('/') || text.includes('\n')) return null;
  const match = /^\/(\S+) (.*)$/.exec(text);
  if (match === null) return null;
  const name = match[1] ?? '';
  const command = COMMANDS.find((entry) => entry.name === name);
  if (command === undefined) return null;
  return { command, fragment: match[2] ?? '' };
}

/** The choices whose word starts with the fragment, case-insensitive. */
export function argumentChoices(query: ArgumentQuery): SlashChoice[] {
  const needle = query.fragment.toLowerCase();
  return (query.command.choices ?? []).filter((choice) =>
    choice.value.toLowerCase().startsWith(needle),
  );
}

/** What the menu under the composer shows after the command name. */
export interface ArgumentMenu {
  command: SlashCommand;
  /** The argument being typed; empty right after the space. */
  fragment: string;
  /** The matching choice words, in table order. */
  choices: SlashChoice[];
  /**
   * True for a free-text command with nothing typed yet: the menu says what
   * the command does and offers no list.
   */
  described: boolean;
}

/**
 * The argument menu, or null when there is nothing to show. A command whose
 * list matches nothing closes: a wrong argument typed by hand is left for the
 * command itself to answer. A command that takes free text shows its one line
 * while the argument is still empty, then gets out of the way.
 */
export function argumentMenu(text: string): ArgumentMenu | null {
  const query = argumentQuery(text);
  if (query === null) return null;
  const choices = argumentChoices(query);
  if (choices.length > 0) {
    return { ...query, choices, described: false };
  }
  const freeText = query.command.freeText === true;
  if (freeText && query.fragment.length === 0) {
    return { ...query, choices: [], described: true };
  }
  return null;
}

/**
 * What Enter does in the argument menu: run only when the line is exactly a
 * choice (`/mode plan`); otherwise complete the highlighted choice, because a
 * partial word is not a decision. Null means the ordinary Enter applies — a
 * free-text command runs, or a wrong argument reaches the command and gets its
 * own error. (An exact command name is `enterAction`'s rule, above.)
 */
export function argumentEnter(
  text: string,
  menu: ArgumentMenu,
  pick: SlashChoice | undefined,
): { action: 'run' | 'fill'; text: string } | null {
  if (pick === undefined) return null;
  const chosen = `/${menu.command.name} ${pick.value}`;
  if (text.trim() === chosen) {
    return { action: 'run', text: chosen };
  }
  return { action: 'fill', text: chosen };
}
