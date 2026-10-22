/**
 * The session's slash commands, in one table (D49cd).
 *
 * Three readers share it: the composer's menu, `/help`, and the dispatcher's
 * vocabulary. Adding a command here — or a menu entry there — cannot leave the
 * other two behind, which is exactly the drift a second list would invite.
 */
export interface SlashCommand {
  /** The word after the slash, without it. */
  name: string;
  /** What the command takes, in usage form. Absent when it takes nothing. */
  args?: string;
  /** One line, for the menu and for `/help`. */
  summary: string;
}

export const COMMANDS: readonly SlashCommand[] = [
  { name: 'mode', args: 'plan|edit|auto', summary: 'Switch mode (Shift+Tab cycles)' },
  { name: 'model', args: 'connection:model', summary: 'Use another model' },
  { name: 'team', args: 'solo|duo|academy', summary: 'Choose the team for the next run' },
  { name: 'gitignore', args: 'on|off', summary: 'Skip what .gitignore excludes in search' },
  { name: 'compact', summary: 'Ask the current run to compact now' },
  { name: 'new', summary: 'Start a new conversation' },
  { name: 'undo', summary: 'Put back the files the last run wrote' },
  { name: 'sessions', summary: 'List saved sessions' },
  { name: 'help', summary: 'Show this help' },
  { name: 'exit', summary: 'Leave Plato' },
];

/** A command as the user types it: `/mode plan|edit|auto`. */
export function slashText(command: SlashCommand): string {
  return command.args === undefined ? `/${command.name}` : `/${command.name} ${command.args}`;
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
  return command.args === undefined
    ? { text: `/${command.name}`, run: true }
    : { text: `/${command.name} `, run: false };
}
