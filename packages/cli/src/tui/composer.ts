import { displayWidth } from '../format/terminal.js';

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

/** The parser's fence, list and heading rules; their lines are drawn whole. */
const FENCE = /^\s*```\s*([^\s`]*)\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * The tail of a streaming answer the live area may draw, cut at a whole block.
 *
 * A frame taller than the window cannot be redrawn in place, and Ink then loses
 * the row that commits the answer. The tail keeps the frame short. The cut is
 * moved forward to a blank line outside a code fence, so the lines that are
 * drawn are the lines that will be drawn after the answer lands — a cut inside
 * a fence would draw code as prose and then change.
 */
export function liveTail(text: string, maxRows: number, columns: number): string {
  const lines = text.split('\n');
  const width = Math.max(1, columns);
  let rows = 0;
  let start = lines.length;
  while (start > 0) {
    const cost = Math.max(1, Math.ceil(displayWidth(lines[start - 1] ?? '') / width));
    if (rows + cost > maxRows) {
      break;
    }
    rows += cost;
    start -= 1;
  }
  if (start === 0) {
    return text;
  }
  // The fence state BEFORE each line, so a cut can be moved back to the
  // opening fence instead of landing inside the block.
  const open: boolean[] = [];
  let fence = false;
  for (const line of lines) {
    open.push(fence);
    if (FENCE.test(line)) {
      fence = !fence;
    }
  }
  if (open[start] === true) {
    while (start > 0 && !(open[start] === false && FENCE.test(lines[start] ?? ''))) {
      start -= 1;
    }
    return lines.slice(start).join('\n');
  }
  // Fill the frame but never exceed it: among the block boundaries that fit,
  // take the earliest. The row cut is the latest line that fits, so an earlier
  // whole block is chosen only when it fits as well.
  const rowsFrom = (index: number): number => {
    let used = 0;
    for (let at = index; at < lines.length; at += 1) {
      used += Math.max(1, Math.ceil(displayWidth(lines[at] ?? '') / width));
    }
    return used;
  };
  const boundaries: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (open[index] === false && (lines[index] ?? '').trim().length === 0 && index + 1 < lines.length) {
      boundaries.push(index + 1);
    }
  }
  // A list item and a heading are one row each and are drawn as they are, so
  // the cut may start there without changing how the line reads.
  if (LIST_ITEM.test(lines[start] ?? '') || HEADING.test(lines[start] ?? '')) {
    boundaries.push(start);
  }
  boundaries.sort((a, b) => a - b);
  const fitting = boundaries.filter((index) => rowsFrom(index) <= maxRows);
  if (fitting.length > 0) {
    return lines.slice(fitting[0] ?? start).join('\n');
  }
  return lines.slice(start).join('\n');
}
