/**
 * How the composer holds pasted text (round 1).
 *
 * A paste that carries a line break inside it is DRAFT text: it is never sent
 * by itself, its breaks are kept exactly, and Enter sends the whole block. A
 * break at the very end is the end of the paste, not a line after it, so a
 * one-line paste ends up as ordinary text.
 */

/**
 * The text a chunk carries, with CRLF and a bare CR made LF and ONE trailing
 * break removed. A second trailing break is a real blank line and stays.
 */
export function pastedText(input: string): string {
  const normalised = input.replace(/\r\n?/g, '\n');
  return normalised.endsWith('\n') ? normalised.slice(0, -1) : normalised;
}

/**
 * The composer's one-line view of a draft: the line the cursor is on, its
 * number, and the count. Nothing about the edit is hidden — a keystroke or an
 * arrow moves this view before Enter can send anything.
 */
export function draftChip(
  text: string,
  cursor: number,
): { line: string; at: number; total: number } {
  const lines = text.split('\n');
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const at = Math.min(lines.length, before.split('\n').length);
  return { line: lines[at - 1] ?? '', at, total: lines.length };
}

/** Backspace at the end of a draft block removes the block as one unit. */
export function removesWholeDraft(text: string, cursor: number): boolean {
  return text.includes('\n') && cursor >= text.length;
}
