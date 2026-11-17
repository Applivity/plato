import { displayWidth, truncateToWidth } from '../format/terminal.js';

/**
 * The header's right side: the conversation's title.
 *
 * The header is identity — app, transport, and the conversation's name — and
 * it has space the status line does not. The title can be a sentence, so its
 * width is chosen when it first appears and kept for the conversation: it
 * truncates from the right once and then holds still while the run figures
 * change.
 */

/** The widest the left side ever gets, while a run is in progress. */
export const HEADER_LEFT_WIDTH = displayWidth('Plato · terminal · working…');
/** At least this much air between the left side and the title. */
export const HEADER_GAP = 2;
/** Fewer cells than this and a title would be a letter and an ellipsis. */
export const MIN_HEADER_TITLE = 8;

/** The cells a title may use in a terminal this wide, in any run state. */
export function headerTitleRoom(columns: number): number {
  return Math.max(0, columns - HEADER_LEFT_WIDTH - HEADER_GAP);
}

/**
 * The title as the header shows it. `reserved` is the width chosen when the
 * title first appeared; without it the whole room is available. Below the
 * minimum the title is left off entirely rather than drawn as `a…`.
 */
export function headerTitle(text: string, room: number, reserved?: number): string {
  const width = reserved ?? room;
  if (width < MIN_HEADER_TITLE) {
    return '';
  }
  return truncateToWidth(text, width);
}
