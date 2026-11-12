/**
 * The transcript line for an in-run compaction, and the token unit it uses.
 *
 * They live together because a field run read "(summary used 13 tok tokens)":
 * `fmtTokens` already ends in "tok", and the sentence appended the word again.
 * One definition, one sentence, one test — the two cannot drift apart again.
 */
export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}

export interface CompactedFacts {
  mode: string;
  beforeTokens: number;
  afterTokens: number;
  summaryTokens: number;
}

/** The row the chat shows when the run compacted its own context (D37a). */
export function compactedTranscriptLine(e: CompactedFacts): string {
  return `[plato] context compacted (${e.mode}) — `
    + `${fmtTokens(e.beforeTokens)} → ${fmtTokens(e.afterTokens)}`
    + ` (summary used ${fmtTokens(e.summaryTokens)})`;
}
