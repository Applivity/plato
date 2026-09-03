/**
 * D44c slash commands: the canonical registry. Commands are NOT text
 * expanders — each is a real action the host executes (`slash-run` in the
 * VS Code shell): compact a live run, flip auto-compaction, or import a
 * past conversation as context. Core keeps only the metadata the webview
 * menu renders; behavior lives in the host because it needs the run
 * controller, VS Code config, and the chat archive.
 */
export type SlashCommandId = 'compact' | 'autocompact' | 'history';

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  usage: string;
  /** One-line menu description, shown under the label. */
  blurb: string;
}

const COMMANDS: readonly SlashCommand[] = [
  {
    id: 'compact',
    label: 'Compact',
    usage: '/compact',
    blurb: 'Compress the active run at the next safe point',
  },
  {
    id: 'autocompact',
    label: 'Auto-compact',
    usage: '/autocompact',
    blurb: 'Toggle auto-compaction on or off',
  },
  {
    id: 'history',
    label: 'History',
    usage: '/history',
    blurb: 'Import a past conversation as context',
  },
];

export const SLASH_COMMANDS: readonly SlashCommand[] = COMMANDS;

export function slashCommand(
  id: string | undefined,
): SlashCommand | undefined {
  if (id === undefined) return undefined;
  return COMMANDS.find((c) => c.id === id);
}

/** Webview-safe display rows (label/usage/blurb only, never prompt text). */
export function slashMenu(): {
  id: SlashCommandId;
  label: string;
  usage: string;
  blurb: string;
}[] {
  return COMMANDS.map((c) => ({
    id: c.id,
    label: c.label,
    usage: c.usage,
    blurb: c.blurb,
  }));
}
