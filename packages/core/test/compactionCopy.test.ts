import { describe, expect, it } from 'vitest';
import {
  compactedTranscriptLine,
  fmtTokens,
} from '../src/runtime/compactionCopy.js';

/**
 * A field run read "(summary used 13 tok tokens)": `fmtTokens` ends in "tok"
 * and the sentence appended the word again. The unit and the sentence are one
 * module so this cannot come back.
 */
describe('compaction copy', () => {
  it('the token unit carries its own "tok"', () => {
    expect(fmtTokens(13)).toBe('13 tok');
    expect(fmtTokens(13_000)).toBe('13.0k tok');
  });

  it('the compacted line names the unit exactly once', () => {
    const line = compactedTranscriptLine({
      mode: 'auto',
      beforeTokens: 13_000,
      afterTokens: 3_000,
      summaryTokens: 13,
    });
    expect(line).toBe(
      '[plato] context compacted (auto) — 13.0k tok → 3.0k tok'
        + ' (summary used 13 tok)',
    );
    expect(line).not.toMatch(/tok\s+tok/);
    expect(line).not.toMatch(/tok tokens/);
  });
});
