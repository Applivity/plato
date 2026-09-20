import { describe, expect, it } from 'vitest';
import { globToRegExp, matchGlob } from '../src/tools/glob.js';

/**
 * D49l. The matcher is shared by the `glob` tool and `grep`'s file filter, so a
 * wrong answer here is wrong in two places.
 */
describe('matchGlob (D49l)', () => {
  // The rule that matters most: a bare pattern matches the BASENAME, so `*.ts`
  // finds TypeScript at any depth. Matching the whole relative path instead
  // would make `*.ts` match nothing outside the root — surprising and useless.
  it('matches a basename pattern at any depth', () => {
    expect(matchGlob('*.ts', 'a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/deep/nested/a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/a.js')).toBe(false);
  });

  it('matches a pattern WITH a slash against the whole path', () => {
    expect(matchGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/deep/a.ts')).toBe(false);
    expect(matchGlob('src/**/*.ts', 'src/deep/a.ts')).toBe(true);
  });

  // `**/` must match ZERO directories too, or `**/*.ts` would miss a file at
  // the root — the most common case there is.
  it('lets **/ match zero directories', () => {
    expect(matchGlob('**/*.ts', 'a.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('**/*.test.ts', 'src/deep/a.test.ts')).toBe(true);
  });

  it('keeps a single * inside one directory segment', () => {
    expect(matchGlob('src/*', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/*', 'src/deep/a.ts')).toBe(false);
    expect(matchGlob('src/**', 'src/deep/a.ts')).toBe(true);
  });

  it('matches exactly one character with ?', () => {
    expect(matchGlob('?.ts', 'a.ts')).toBe(true);
    expect(matchGlob('?.ts', 'ab.ts')).toBe(false);
    expect(matchGlob('a?c.ts', 'abc.ts')).toBe(true);
    expect(matchGlob('a?c.ts', 'ac.ts')).toBe(false);
  });

  // A glob is not a regex. Every one of these would behave differently — or
  // throw — if the pattern were compiled without escaping.
  it('treats regex metacharacters literally', () => {
    expect(matchGlob('a.ts', 'a.ts')).toBe(true);
    expect(matchGlob('a.ts', 'axts')).toBe(false);
    expect(matchGlob('a+b.ts', 'a+b.ts')).toBe(true);
    expect(matchGlob('a+b.ts', 'aab.ts')).toBe(false);
    expect(matchGlob('f(x).ts', 'f(x).ts')).toBe(true);
    expect(matchGlob('f(x).ts', 'fx.ts')).toBe(false);
    expect(matchGlob('a|b.ts', 'a|b.ts')).toBe(true);
    expect(matchGlob('a|b.ts', 'a.ts')).toBe(false);
    expect(matchGlob('a{1}.ts', 'a{1}.ts')).toBe(true);
  });

  it('does not let * run past the end of the name', () => {
    expect(matchGlob('*.ts', 'a.tsx')).toBe(false);
    expect(matchGlob('*.ts', 'ats')).toBe(false);
  });

  it('handles the degenerate cases without throwing', () => {
    expect(matchGlob('', '')).toBe(true);
    expect(matchGlob('', 'a.ts')).toBe(false);
    expect(matchGlob('**', 'a.ts')).toBe(true);
    expect(matchGlob('*', 'src/a.ts')).toBe(true); // basename rule again
    expect(matchGlob('*.ts', '')).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('anchors both ends', () => {
    expect(globToRegExp('a*').test('xab')).toBe(false);
    expect(globToRegExp('a*').test('ab')).toBe(true);
  });
});
