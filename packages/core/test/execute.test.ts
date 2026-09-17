import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool } from '../src/tools/execute.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'plato-exec-'));
}

describe('write_file (D49b)', () => {
  it('creates a file that does not exist', async () => {
    const root = tempRoot();
    const r = await executeTool(root, 'write_file', {
      path: 'new.txt',
      content: 'hello',
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('created');
    expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('hello');
  });

  // The dead end D49b removed. write_file used to refuse EVERY existing path
  // (it tested existence, not emptiness), and apply_diff cannot seed an empty
  // file because it rejects an empty SEARCH — so an existing empty file was
  // unreachable by every write tool and forced the model onto `shell`, which
  // plan and edit mode deny.
  it('writes an existing EMPTY file — the case no tool could reach', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'placeholder.ts'), '');
    const r = await executeTool(root, 'write_file', {
      path: 'placeholder.ts',
      content: 'export {};\n',
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'placeholder.ts'), 'utf8')).toBe(
      'export {};\n',
    );
  });

  it('refuses an existing NON-empty file without overwrite, and says how', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'keep.txt'), 'original');
    const r = await executeTool(root, 'write_file', {
      path: 'keep.txt',
      content: 'replaced',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('overwrite: true');
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('original');
  });

  it('replaces a non-empty file when overwrite is true', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'keep.txt'), 'original');
    const r = await executeTool(root, 'write_file', {
      path: 'keep.txt',
      content: 'replaced',
      overwrite: true,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('overwrote');
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('replaced');
  });

  it('refuses a secret deny-list path and writes nothing', async () => {
    const root = tempRoot();
    const r = await executeTool(root, 'write_file', {
      path: '.env.local',
      content: 'TOKEN=1',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
    expect(existsSync(join(root, '.env.local'))).toBe(false);
  });
});

describe('read_file paging (D49c)', () => {
  /** Ten lines, no trailing newline. */
  const TEN = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10';

  it('returns a small file byte-for-byte and adds no marker', async () => {
    const root = tempRoot();
    // The trailing newline must survive: the model builds apply_diff SEARCH
    // strings out of this text, and a lost newline is a spurious "not found".
    writeFileSync(join(root, 'a.txt'), 'alpha\nbeta\n');
    const r = await executeTool(root, 'read_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.output).toBe('alpha\nbeta\n');
    expect(r.output).not.toContain('[truncated');
  });

  it('pages with offset and limit and states which lines it returned', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'ten.txt'), TEN);
    const r = await executeTool(root, 'read_file', {
      path: 'ten.txt',
      offset: 3,
      limit: 4,
    });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('L3\nL4\nL5\nL6')).toBe(true);
    expect(r.output).toContain('showing lines 3-6 of 10');
    expect(r.output).toContain('Pass offset=7 to continue.');
  });

  it('treats a trailing newline as a terminator, not an extra line', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'ten.txt'), TEN + '\n');
    const r = await executeTool(root, 'read_file', {
      path: 'ten.txt',
      offset: 1,
      limit: 2,
    });
    expect(r.output).toContain('showing lines 1-2 of 10');
  });

  // A line budget alone is not a size limit: one minified line can be megabytes.
  it('caps a single line that exceeds the char budget and says so', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'min.js'), 'x'.repeat(100_000));
    const r = await executeTool(root, 'read_file', { path: 'min.js' });
    expect(r.ok).toBe(true);
    expect(r.output.length).toBeLessThan(70_000);
    expect(r.output).toContain('[truncated:');
    expect(r.output).toContain('cut at 60000 chars');
  });

  it('reports an offset past the end instead of returning an empty body', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'ten.txt'), TEN);
    const r = await executeTool(root, 'read_file', {
      path: 'ten.txt',
      offset: 99,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('past the end');
  });

  it('refuses a secret deny-list path', async () => {
    const root = tempRoot();
    writeFileSync(join(root, '.env'), 'SECRET=1');
    const r = await executeTool(root, 'read_file', { path: '.env' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
  });
});

describe('apply_diff and the empty-file dead end (D49b)', () => {
  it('cannot seed an empty file — which is why write_file must handle it', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'empty.ts'), '');
    const r = await executeTool(root, 'apply_diff', {
      path: 'empty.ts',
      diffs: [{ search: '', replace: 'export {};' }],
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('empty SEARCH block');
  });
});
