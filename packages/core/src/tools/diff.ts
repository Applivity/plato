/**
 * SEARCH/REPLACE diff engine (D22b). Exact match, single location,
 * idempotent re-apply. Pure string logic; no filesystem access.
 */
export interface DiffBlock {
  search: string;
  replace: string;
}

export interface ApplyOutcome {
  content: string;
  applied: number;
  noop: number;
}

/**
 * Applies blocks in order. Each SEARCH must occur exactly once; if it is
 * absent but REPLACE is already present, the block counts as a no-op
 * (idempotence). Anything ambiguous throws with a plain reason.
 */
export function applyBlocks(
  content: string,
  blocks: DiffBlock[],
): ApplyOutcome {
  let next = content;
  let applied = 0;
  let noop = 0;
  for (const b of blocks) {
    if (b.search.length === 0) {
      throw new Error('empty SEARCH block');
    }
    const first = next.indexOf(b.search);
    if (first === -1) {
      if (next.includes(b.replace)) {
        noop += 1;
        continue;
      }
      throw new Error('SEARCH not found');
    }
    const second = next.indexOf(b.search, first + b.search.length);
    if (second !== -1) {
      throw new Error('SEARCH matches more than one location');
    }
    next = next.slice(0, first) + b.replace + next.slice(first + b.search.length);
    applied += 1;
  }
  return { content: next, applied, noop };
}

/** Builds a unified-style diff preview (used by the approval UI). */
export function previewDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b !== a) {
      if (b !== undefined) lines.push(`- ${b}`);
      if (a !== undefined) lines.push(`+ ${a}`);
    } else {
      lines.push(`  ${b ?? ''}`);
    }
  }
  return lines.join('\n');
}
