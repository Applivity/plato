/**
 * SEARCH/REPLACE diff engine (D22b). Exact match, single location,
 * idempotent re-apply. Pure string logic; no filesystem access.
 */
export interface DiffBlock {
  search: string;
  replace: string;
  /**
   * D49l: replace EVERY occurrence rather than requiring exactly one. Off by
   * default, because the ambiguity error is the safety feature — renaming a
   * symbol used five times is the case this exists for, and it has to be asked
   * for explicitly.
   */
  replaceAll?: boolean;
}

export interface ApplyOutcome {
  content: string;
  applied: number;
  noop: number;
}

/**
 * Parses the model's `diffs` array into blocks. Throws with a plain reason so
 * both `apply_diff` and `apply_patch` reject malformed input identically.
 */
export function parseDiffBlocks(raw: unknown): DiffBlock[] {
  if (!Array.isArray(raw)) {
    throw new Error('diffs must be an array');
  }
  const blocks: DiffBlock[] = [];
  for (const d of raw) {
    const rec = d as unknown as Record<string, unknown>;
    if (
      typeof d === 'object' &&
      d !== null &&
      typeof rec['search'] === 'string' &&
      typeof rec['replace'] === 'string'
    ) {
      blocks.push({
        search: rec['search'],
        replace: rec['replace'],
        ...(rec['replace_all'] === true ? { replaceAll: true } : {}),
      });
    } else {
      throw new Error('each diff needs string search and replace');
    }
  }
  return blocks;
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
    if (b.replaceAll) {
      // split/join, NOT String.replace: in a replacement string `$&`, `$1` and
      // `$$` are substitution patterns, so `.replace()` would silently mangle
      // any replacement that legitimately contains them — a real hazard for
      // code that touches shell variables or regexes.
      next = next.split(b.search).join(b.replace);

      applied += 1;
      continue;
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
