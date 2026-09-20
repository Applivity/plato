import { describe, expect, it } from 'vitest';
import { absInRoot, containmentRefusal, pathArgsOf, resolveInRoot } from '../src/security/paths.js';

/**
 * D49k. Before this guard existed, every path-taking tool passed its argument
 * straight to `join(root, raw)`, so a tool call could read — and CREATE — files
 * outside the workspace. That was demonstrated, not theorised: `write_file`
 * with `../../../../tmp/x` created the file. These tests pin the rule.
 */
const ROOT = '/work/project';

describe('resolveInRoot', () => {
  it('accepts a plain relative path and returns it unchanged', () => {
    expect(resolveInRoot(ROOT, 'src/a.ts')).toBe('src/a.ts');
    expect(resolveInRoot(ROOT, './src/a.ts')).toBe('src/a.ts');
  });

  it('treats the root itself as the empty relative path', () => {
    expect(resolveInRoot(ROOT, '.')).toBe('');
  });

  it('accepts an absolute path that is inside the root', () => {
    expect(resolveInRoot(ROOT, '/work/project/src/a.ts')).toBe('src/a.ts');
  });

  // The escapes. Each of these reached the filesystem before D49k.
  it('refuses a relative path that climbs out', () => {
    expect(resolveInRoot(ROOT, '../a.ts')).toBeNull();
    expect(resolveInRoot(ROOT, '../../../../tmp/plato.txt')).toBeNull();
    expect(resolveInRoot(ROOT, 'src/../../outside.ts')).toBeNull();
  });

  it('refuses an absolute path outside the root', () => {
    expect(resolveInRoot(ROOT, '/etc/hosts')).toBeNull();
    expect(resolveInRoot(ROOT, '/work/other/a.ts')).toBeNull();
  });

  it('refuses a sibling directory that merely shares a prefix', () => {
    // The classic bug: a string-prefix check accepts `/work/project-evil`
    // because it starts with `/work/project`.
    expect(resolveInRoot(ROOT, '/work/project-evil/a.ts')).toBeNull();
  });

  it('refuses an empty path and one carrying a NUL byte', () => {
    expect(resolveInRoot(ROOT, '')).toBeNull();
    expect(resolveInRoot(ROOT, 'src/\0a.ts')).toBeNull();
  });

  // Deliberate limitation, recorded so it is not mistaken for a guarantee.
  it('is lexical — a symlink out of the root is not resolved', () => {
    expect(resolveInRoot(ROOT, 'link/a.ts')).toBe('link/a.ts');
  });
});

describe('absInRoot', () => {
  it('joins a contained path and refuses an escaping one', () => {
    expect(absInRoot(ROOT, 'src/a.ts')).toBe('/work/project/src/a.ts');
    expect(absInRoot(ROOT, '../a.ts')).toBeNull();
  });
});

describe('pathArgsOf', () => {
  it('finds the path of a single-file tool', () => {
    expect(pathArgsOf('read_file', { path: 'a.ts' })).toEqual(['a.ts']);
    expect(pathArgsOf('apply_diff', { path: 'a.ts', diffs: [] })).toEqual(['a.ts']);
  });

  // The subtle one: `content` and `pattern` are strings but not paths, so a
  // path check must not treat them as such.
  it('ignores string arguments that are not paths', () => {
    expect(pathArgsOf('write_file', { path: 'a.ts', content: '../x' })).toEqual(['a.ts']);
    expect(pathArgsOf('grep', { pattern: '../../etc' })).toEqual([]);
    expect(pathArgsOf('shell', { command: 'cd ..' })).toEqual([]);
  });

  it('finds every path inside a multi-file patch', () => {
    expect(
      pathArgsOf('apply_patch', {
        patches: [{ path: 'a.ts' }, { path: 'b.ts', diffs: [] }],
      }),
    ).toEqual(['a.ts', 'b.ts']);
  });

  it('returns [] for a tool with no path argument or a malformed one', () => {
    expect(pathArgsOf('list_dir', {})).toEqual([]);
    expect(pathArgsOf('apply_patch', { patches: 'nope' })).toEqual([]);
    expect(pathArgsOf('unknown_tool', { path: 'a.ts' })).toEqual([]);
  });
});

describe('containmentRefusal', () => {
  it('passes a contained call', () => {
    expect(containmentRefusal(ROOT, 'read_file', { path: 'src/a.ts' })).toBeNull();
    expect(containmentRefusal(ROOT, 'list_dir', {})).toBeNull();
  });

  it('refuses an escaping call and names the argument', () => {
    const reason = containmentRefusal(ROOT, 'write_file', { path: '../x.ts' });
    expect(reason).toContain('outside the workspace');
    expect(reason).toContain('../x.ts');
  });

  // One bad path in a multi-file patch must refuse the WHOLE call — a partial
  // application is exactly what apply_patch exists to prevent.
  it('refuses a multi-file patch when any single path escapes', () => {
    expect(
      containmentRefusal(ROOT, 'apply_patch', {
        patches: [{ path: 'ok.ts' }, { path: '../../etc/passwd' }],
      }),
    ).not.toBeNull();
  });
});
