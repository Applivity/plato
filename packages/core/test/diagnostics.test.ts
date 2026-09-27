import { describe, expect, it } from 'vitest';
import {
  DIAG_MAX_ITEMS,
  diagnosticKey,
  diagnosticsToReport,
  formatDiagnostics,
  newDiagnostics,
  type EditorDiagnostic,
  type PreWrite,
} from '../src/runtime/diagnostics.js';

/**
 * D49av. What the editor knows about a file Plato just changed, reduced to the
 * part that must not be wrong.
 *
 * **The rule under every test here: the ABSENCE of diagnostics is not evidence of
 * correctness.** `getDiagnostics` answers `[]` both for a clean file and for a
 * file no language server has ever opened. A design that conflated them would
 * hand the agent every pre-existing error in a file the editor had never looked
 * at, and send it to fix things nobody asked about — which is how a helpful
 * feature becomes an infuriating one. `PreWrite`'s three cases exist for that.
 */

const err = (
  message: string,
  line = 1,
  path = '/root/a.ts',
  source?: string,
): EditorDiagnostic => ({
  path,
  line,
  column: 1,
  message,
  ...(source === undefined ? {} : { source }),
});

describe('diagnosticKey (D49av)', () => {
  it('ignores the position, because an edit shifts every line below it', () => {
    // The whole reason the key is not positional: inserting a line at the top of
    // a file would otherwise make every existing error look newly introduced.
    expect(diagnosticKey(err('cannot find symbol', 10))).toBe(
      diagnosticKey(err('cannot find symbol', 99)),
    );
  });

  it('separates two servers that report the same words', () => {
    expect(diagnosticKey(err('bad', 1, '/root/a.ts', 'ts'))).not.toBe(
      diagnosticKey(err('bad', 1, '/root/a.ts', 'eslint')),
    );
  });
});

describe('newDiagnostics (D49av)', () => {
  it('reports an error that was not there before', () => {
    expect(newDiagnostics([], [err('cannot find symbol')])).toEqual([
      err('cannot find symbol'),
    ]);
  });

  it('does not report one that was already there', () => {
    expect(newDiagnostics([err('cannot find symbol')], [err('cannot find symbol')])).toEqual([]);
  });

  it('reports a SECOND copy of an error that already existed once', () => {
    // The case a plain set difference silently drops: same message, one more
    // instance. Counted per key, so the new one survives. A check that cannot
    // see this is a check that cannot fail, which is the fault this repo keeps
    // re-learning — so it is counted, not compared as sets.
    const after = [err('cannot find symbol', 3), err('cannot find symbol', 40)];
    expect(newDiagnostics([err('cannot find symbol', 3)], after)).toHaveLength(1);
  });

  it('drops an error the edit removed', () => {
    // "Fixed" is not reported. The block is about what is wrong NOW, and telling
    // the model about errors it already dealt with is noise on the next step.
    expect(newDiagnostics([err('a'), err('b')], [err('b')])).toEqual([]);
  });

  it('is not order-dependent', () => {
    const before = [err('a', 1), err('b', 2)];
    const after = [err('b', 2), err('a', 1), err('c', 3)];
    expect(newDiagnostics(before, after)).toEqual([err('c', 3)]);
  });
});

describe('diagnosticsToReport (D49av)', () => {
  const after = [err('the new one')];

  it('treats a file that did not exist as legitimately empty', () => {
    // A file that was not there had no errors. This is the common case for a file
    // Plato is creating, and it must report everything wrong with it.
    const before: PreWrite = { kind: 'absent' };
    expect(diagnosticsToReport(before, after)).toEqual(after);
  });

  it('compares against a list a server had actually produced', () => {
    const before: PreWrite = { kind: 'analysed', diagnostics: [err('old')] };
    expect(diagnosticsToReport(before, [err('old'), err('new')])).toEqual([err('new')]);
  });

  it('reports NOTHING when no server had ever looked at the file', () => {
    // The fatal case. An existing file the editor has never analysed looks
    // exactly like a clean file, and guessing "clean" would report the whole
    // post-write list — every pre-existing error — as newly introduced.
    const before: PreWrite = { kind: 'unknown' };
    expect(diagnosticsToReport(before, [err('pre-existing 1'), err('pre-existing 2')])).toEqual(
      [],
    );
  });
});

describe('formatDiagnostics (D49av)', () => {
  const opts = { root: '/root' };

  it('says nothing at all when there is nothing to say', () => {
    // '' and not a header with no items: the caller appends nothing, rather than
    // an empty block that reads like a finding.
    expect(formatDiagnostics([], opts)).toBe('');
  });

  it('names the file relative to the workspace, and the line', () => {
    const out = formatDiagnostics([err('cannot find symbol', 40, '/root/app/a.ts')], opts);
    expect(out).toContain('app/a.ts:40:1');
    expect(out).toContain('cannot find symbol');
  });

  it('counts and uses the singular for one error', () => {
    expect(formatDiagnostics([err('x')], opts)).toContain('1 error in the file');
    expect(formatDiagnostics([err('x'), err('y')], opts)).toContain('2 errors in the files');
  });

  it('says the errors are new OR CHANGED, never that the agent broke them', () => {
    // An edit that rewrites the message on a pre-existing error legitimately
    // reads as new, so the stronger claim would be false. The repo has spent
    // entries removing exactly this kind of overclaim.
    const out = formatDiagnostics([err('x')], opts);
    expect(out).toContain('new or changed since your edit');
    expect(out).not.toMatch(/you broke/i);
  });

  it('gives the model the escape hatch that stops this becoming scope creep', () => {
    const out = formatDiagnostics([err('x')], opts);
    expect(out).toContain('say why they are not yours to fix');
  });

  it('is deterministic, because the editor does not guarantee an order', () => {
    // Two calls with the same set in different orders must be byte-identical, or
    // the block is untestable and the transcript is not reproducible.
    const a = err('aaa', 9, '/root/z.ts');
    const b = err('bbb', 2, '/root/a.ts');
    expect(formatDiagnostics([a, b], opts)).toBe(formatDiagnostics([b, a], opts));
  });

  it('caps the count and admits what it dropped', () => {
    const many = Array.from({ length: DIAG_MAX_ITEMS + 5 }, (_, i) =>
      err(`error number ${i}`, i + 1, '/root/a.ts'),
    );
    const out = formatDiagnostics(many, opts);
    expect(out).toContain(`[+5 more]`);
    // The cap must not SILENTLY truncate: a cut list that looks whole is how a
    // reader is told there are 20 problems when there are 25.
    const items = out
      .split('\n')
      .filter((l) => l.startsWith('  ') && !l.startsWith('  …'));
    expect(items.length).toBe(DIAG_MAX_ITEMS);
  });

  it('shortens a runaway message rather than pasting it whole', () => {
    const out = formatDiagnostics([err('x'.repeat(5_000))], opts);
    expect(out.length).toBeLessThan(1_000);
    expect(out).toContain('…');
  });

  it('bounds the whole block even when every item is legal', () => {
    // Twenty messages at the per-message cap is still too much to sit between two
    // tool calls, so the total is bounded as well as the count.
    const many = Array.from({ length: DIAG_MAX_ITEMS }, (_, i) =>
      err('y'.repeat(200), i + 1, '/root/a.ts'),
    );
    expect(formatDiagnostics(many, opts).length).toBeLessThanOrEqual(4_100);
  });
});
