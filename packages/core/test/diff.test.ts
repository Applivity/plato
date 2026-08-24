import { describe, expect, it } from 'vitest';
import { applyBlocks, previewDiff } from '../src/tools/diff.js';

describe('applyBlocks', () => {
  it('applies a simple replacement', () => {
    const out = applyBlocks('hello world', [
      { search: 'world', replace: 'plato' },
    ]);
    expect(out.content).toBe('hello plato');
    expect(out.applied).toBe(1);
  });

  it('is idempotent: re-applying an applied change is a no-op', () => {
    const original = 'int x = 0;';
    const blocks = [{ search: 'int x = 0;', replace: 'int x = 1;' }];
    const once = applyBlocks(original, blocks);
    expect(once.applied).toBe(1);
    const twice = applyBlocks(once.content, blocks);
    expect(twice.applied).toBe(0);
    expect(twice.noop).toBe(1);
    expect(twice.content).toBe(once.content);
  });

  it('rejects ambiguous SEARCH (multiple matches)', () => {
    expect(() =>
      applyBlocks('a a a', [{ search: 'a', replace: 'b' }]),
    ).toThrow('more than one');
  });

  it('rejects missing SEARCH when REPLACE is not present either', () => {
    expect(() =>
      applyBlocks('abc', [{ search: 'zzz', replace: 'yyy' }]),
    ).toThrow('SEARCH not found');
  });

  it('rejects empty SEARCH', () => {
    expect(() => applyBlocks('abc', [{ search: '', replace: 'x' }])).toThrow(
      'empty SEARCH',
    );
  });

  it('applies multiple blocks in order', () => {
    const out = applyBlocks('one two three', [
      { search: 'two', replace: 'TWO' },
      { search: 'three', replace: 'THREE' },
    ]);
    expect(out.content).toBe('one TWO THREE');
    expect(out.applied).toBe(2);
  });
});

describe('previewDiff', () => {
  it('marks changed lines and keeps context', () => {
    const d = previewDiff('a\nb\nc', 'a\nB\nc');
    expect(d).toContain('- b');
    expect(d).toContain('+ B');
    expect(d).toContain('  a');
  });
});
