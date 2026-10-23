import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool } from '../src/tools/execute.js';
import { ShellManager } from '../src/tools/background.js';
import { LONG_RUNNING, nodeCommand } from './portable.js';

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

/**
 * D49k. The executor is the guarantee; the loop's pre-flight check is only for
 * the user's benefit. These are the demonstrations that motivated the guard —
 * before it, the write below landed on disk outside the workspace.
 */
describe('workspace containment (D49k)', () => {
  it('refuses to read outside the workspace', async () => {
    const root = tempRoot();
    const outside = join(root, '..', 'plato-outside-probe.txt');
    writeFileSync(outside, 'not yours');
    try {
      const r = await executeTool(root, 'read_file', {
        path: '../plato-outside-probe.txt',
      });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('outside the workspace');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('refuses to CREATE outside the workspace', async () => {
    const root = tempRoot();
    const outside = join(root, '..', 'plato-escape-probe.txt');
    try {
      const r = await executeTool(root, 'write_file', {
        path: '../plato-escape-probe.txt',
        content: 'escaped',
      });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('outside the workspace');
      // The point of the test: nothing was written.
      expect(existsSync(outside)).toBe(false);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('refuses an absolute path outside the workspace', async () => {
    const root = tempRoot();
    const r = await executeTool(root, 'write_file', {
      path: '/tmp/plato-absolute-probe.txt',
      content: 'escaped',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside the workspace');
  });

  it('refuses apply_diff outside the workspace', async () => {
    const root = tempRoot();
    const outside = join(root, '..', 'plato-diff-probe.txt');
    writeFileSync(outside, 'before');
    try {
      const r = await executeTool(root, 'apply_diff', {
        path: '../plato-diff-probe.txt',
        diffs: [{ search: 'before', replace: 'after' }],
      });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('outside the workspace');
      expect(readFileSync(outside, 'utf8')).toBe('before');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  // Containment must not break ordinary work — including a path that merely
  // LOOKS suspicious but stays inside.
  it('still allows a normal nested path and a dotted filename', async () => {
    const root = tempRoot();
    const r = await executeTool(root, 'write_file', {
      path: 'a/b/c.ts',
      content: 'ok',
    });
    expect(r.ok).toBe(false); // no parent directory yet — but refused for THAT
    expect(r.output).not.toContain('outside the workspace');
    const dot = await executeTool(root, 'write_file', {
      path: './dot.ts',
      content: 'ok',
    });
    expect(dot.ok).toBe(true);
    expect(readFileSync(join(root, 'dot.ts'), 'utf8')).toBe('ok');
  });
});

/** Seeds a small tree so the search tools have something real to walk. */
function seedTree(): string {
  const root = tempRoot();
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'const x = 1;\nfunction foo() {}\nconst y = 2;\n');
  writeFileSync(join(root, 'src', 'deep', 'b.ts'), 'const x = 1;\n');
  writeFileSync(join(root, 'notes.md'), 'const x = 1 is written as x\n');
  return root;
}

describe('grep (D49l)', () => {
  it('skips a binary file instead of searching its decoded bytes', async () => {
    // A binary decodes to replacement characters rather than throwing, so a
    // search that only catches read errors walks it as text and can return
    // lines of it. A `.jks` is skipped by name; a `.bin` is not.
    const root = tempRoot();
    writeFileSync(join(root, 'notes.txt'), 'needle in text\n');
    writeFileSync(
      join(root, 'blob.bin'),
      Buffer.from([0x00, 0xfe, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xff, 0x00]),
    );
    const r = await executeTool(root, 'grep', { pattern: 'needle' });
    expect(r.output).toContain('notes.txt');
    expect(r.output).not.toContain('blob.bin');
  });

  it('matches a literal pattern by default, across files', async () => {
    const r = await executeTool(seedTree(), 'grep', { pattern: 'const x = 1' });
    expect(r.ok).toBe(true);
    expect(r.output.split('\n')).toHaveLength(3);
    expect(r.output).toContain('notes.md:1:');
  });

  // The point of "literal by default", using ONE pattern whose meaning differs
  // between the two modes: `.` is a full stop, not "any character".
  it('treats the pattern as a literal unless regex is set', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.txt'), 'version 1.2.3\nversion 1x2\n');
    const literal = await executeTool(root, 'grep', { pattern: '1.2' });
    expect(literal.output.split('\n')).toHaveLength(1);
    expect(literal.output).toContain('1.2.3');
    const asRegex = await executeTool(root, 'grep', { pattern: '1.2', regex: true });
    expect(asRegex.output.split('\n')).toHaveLength(2);
  });

  // A literal pattern full of regex syntax must be found as written.
  it('finds a literal pattern containing regex syntax', async () => {
    const r = await executeTool(seedTree(), 'grep', { pattern: 'foo() {}' });
    expect(r.output).toContain('a.ts:2:');
  });

  it('matches a JavaScript regex when asked', async () => {
    const r = await executeTool(seedTree(), 'grep', {
      pattern: 'const [xy] = \\d',
      regex: true,
    });
    // a.ts holds both `const x = 1` and `const y = 2`; b.ts and notes.md one each.
    expect(r.output.split('\n')).toHaveLength(4);
  });

  it('reports an unusable regex instead of searching for it', async () => {
    const r = await executeTool(seedTree(), 'grep', { pattern: 'a(', regex: true });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('invalid regex');
  });

  it('filters files with a glob', async () => {
    const r = await executeTool(seedTree(), 'grep', {
      pattern: 'const x = 1',
      glob: '*.ts',
    });
    expect(r.output.split('\n')).toHaveLength(2);
    expect(r.output).not.toContain('notes.md');
  });

  it('returns only file names in files_with_matches mode', async () => {
    const r = await executeTool(seedTree(), 'grep', {
      pattern: 'const x = 1',
      mode: 'files_with_matches',
    });
    expect(r.output.split('\n').sort()).toEqual([
      'notes.md',
      'src/a.ts',
      'src/deep/b.ts',
    ]);
  });

  it('counts per file in count mode', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'twice.ts'), 'hit\nhit\nnot\n');
    writeFileSync(join(root, 'once.ts'), 'hit\n');
    const r = await executeTool(root, 'grep', { pattern: 'hit', mode: 'count' });
    expect(r.output).toContain('twice.ts:2');
    expect(r.output).toContain('once.ts:1');
    expect(r.output).toContain('[total 3 matches in 2 files]');
  });

  it('caps the output at limit and says it did', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'many.txt'), Array.from({ length: 20 }, (_, i) => `hit ${i}`).join('\n'));
    const r = await executeTool(root, 'grep', { pattern: 'hit', limit: 5 });
    expect(r.output.split('\n')).toHaveLength(6); // 5 hits + the note
    expect(r.output).toContain('stopped at 5 hits');
  });

  it('says no matches rather than returning nothing', async () => {
    const r = await executeTool(seedTree(), 'grep', { pattern: 'zzz-not-there' });
    expect(r.output).toBe('no matches');
  });
});

describe('glob tool (D49l)', () => {
  it('finds files by name pattern at any depth', async () => {
    const r = await executeTool(seedTree(), 'glob', { pattern: '*.ts' });
    expect(r.output.split('\n').sort()).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  it('finds by an explicit path pattern', async () => {
    const r = await executeTool(seedTree(), 'glob', { pattern: 'src/deep/*.ts' });
    expect(r.output).toBe('src/deep/b.ts');
  });

  it('says so when nothing matches', async () => {
    const r = await executeTool(seedTree(), 'glob', { pattern: '*.rs' });
    expect(r.output).toBe('no files match');
  });
});

describe('list_dir with a path (D49l)', () => {
  it('lists the whole workspace when no path is given', async () => {
    const root = seedTree();
    const r = await executeTool(root, 'list_dir', {});
    expect(r.output).toContain('src/a.ts');
    expect(r.output).toContain('notes.md');
  });

  it('lists only the subtree, still rooted-relative', async () => {
    const r = await executeTool(seedTree(), 'list_dir', { path: 'src' });
    expect(r.output.split('\n').sort()).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  // "no files" and "no such directory" are different answers.
  it('distinguishes a missing directory from an empty one', async () => {
    const root = seedTree();
    const missing = await executeTool(root, 'list_dir', { path: 'nope' });
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain('no such directory');
    mkdirSync(join(root, 'empty'));
    const empty = await executeTool(root, 'list_dir', { path: 'empty' });
    expect(empty.ok).toBe(true);
    expect(empty.output).toContain('no files under empty');
  });

  it('refuses a path that is a file, and one that escapes', async () => {
    const root = seedTree();
    const file = await executeTool(root, 'list_dir', { path: 'notes.md' });
    expect(file.ok).toBe(false);
    expect(file.output).toContain('not a directory');
    const escape = await executeTool(root, 'list_dir', { path: '../..' });
    expect(escape.ok).toBe(false);
    expect(escape.output).toContain('outside the workspace');
  });
});

describe('apply_diff replace_all (D49l)', () => {
  // Renaming a symbol used many times was impossible in one call: the engine
  // errors on multiple matches, which is the right default.
  it('still refuses an ambiguous SEARCH without replace_all', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'old\nold\n');
    const r = await executeTool(root, 'apply_diff', {
      path: 'a.ts',
      diffs: [{ search: 'old', replace: 'new' }],
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('more than one location');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('old\nold\n');
  });

  it('replaces every occurrence when replace_all is set', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'old\nkeep\nold\n');
    const r = await executeTool(root, 'apply_diff', {
      path: 'a.ts',
      diffs: [{ search: 'old', replace: 'new', replace_all: true }],
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('new\nkeep\nnew\n');
  });

  /**
   * The reason the engine uses split/join rather than String.replace: in a
   * replacement string `$&`, `$1` and `$$` are substitution patterns, so
   * `.replace()` would turn the replacement below into `XY`. Code that touches
   * shell variables or regexes contains these constantly.
   */
  it('inserts a replacement containing $& literally', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'X\nX\n');
    const r = await executeTool(root, 'apply_diff', {
      path: 'a.ts',
      diffs: [{ search: 'X', replace: '$&Y', replace_all: true }],
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('$&Y\n$&Y\n');
  });

  it('counts an already-applied replace_all block as a no-op', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'new\nnew\n');
    const r = await executeTool(root, 'apply_diff', {
      path: 'a.ts',
      diffs: [{ search: 'old', replace: 'new', replace_all: true }],
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('no-op 1');
  });
});

describe('apply_patch atomicity (D49l)', () => {
  function twoFiles(): string {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'alpha\n');
    writeFileSync(join(root, 'b.ts'), 'beta\n');
    return root;
  }

  it('applies edits to several files in one call', async () => {
    const root = twoFiles();
    const r = await executeTool(root, 'apply_patch', {
      patches: [
        { path: 'a.ts', diffs: [{ search: 'alpha', replace: 'ALPHA' }] },
        { path: 'b.ts', diffs: [{ search: 'beta', replace: 'BETA' }] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('patched 2 file(s)');
    expect(r.output).toContain('a.ts: 1 block(s)');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('ALPHA\n');
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('BETA\n');
  });

  /**
   * THE point of the tool. The third file fails, so the first two must be
   * untouched — a half-applied multi-file change is the outcome apply_patch
   * exists to prevent, and it is what several apply_diff calls would produce.
   */
  it('changes NOTHING when any one patch fails', async () => {
    const root = twoFiles();
    const r = await executeTool(root, 'apply_patch', {
      patches: [
        { path: 'a.ts', diffs: [{ search: 'alpha', replace: 'ALPHA' }] },
        { path: 'b.ts', diffs: [{ search: 'not-there', replace: 'x' }] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('b.ts');
    expect(r.output).toContain('SEARCH not found');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('alpha\n');
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('beta\n');
  });

  // With several files in flight, "SEARCH not found" alone does not say which.
  it('names the file a failure came from', async () => {
    const root = twoFiles();
    const r = await executeTool(root, 'apply_patch', {
      patches: [{ path: 'b.ts', diffs: [{ search: 'nope', replace: 'x' }] }],
    });
    expect(r.ok).toBe(false);
    expect(r.output.startsWith('b.ts:')).toBe(true);
  });

  it('refuses the same file twice, a missing path, and an empty list', async () => {
    const root = twoFiles();
    const dup = await executeTool(root, 'apply_patch', {
      patches: [
        { path: 'a.ts', diffs: [{ search: 'alpha', replace: 'A' }] },
        { path: './a.ts', diffs: [{ search: 'A', replace: 'B' }] },
      ],
    });
    expect(dup.ok).toBe(false);
    expect(dup.output).toContain('appears twice');

    const noPath = await executeTool(root, 'apply_patch', {
      patches: [{ diffs: [] }],
    });
    expect(noPath.ok).toBe(false);
    expect(noPath.output).toContain('needs a path');

    const empty = await executeTool(root, 'apply_patch', { patches: [] });
    expect(empty.ok).toBe(false);
    expect(empty.output).toContain('non-empty array');
  });

  it('refuses a patch that reaches outside the workspace', async () => {
    const root = twoFiles();
    const r = await executeTool(root, 'apply_patch', {
      patches: [{ path: '../escape.ts', diffs: [{ search: 'a', replace: 'b' }] }],
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside the workspace');
  });

  it('reports no changes when every block is already applied', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'a.ts'), 'ALPHA\n');
    const r = await executeTool(root, 'apply_patch', {
      patches: [{ path: 'a.ts', diffs: [{ search: 'alpha', replace: 'ALPHA' }] }],
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('no changes');
  });
});

/**
 * D49ai. **The executor is the guarantee; the loop's refusal is the courtesy**
 * (D49k's doctrine, applied to the secret invariant).
 *
 * Found by writing an unrelated test. `isSecretPath` takes the BASENAME of the
 * whole string, so `cat app/keystore.properties` was refused and `cat
 * keystore.properties` — the natural spelling, since the proving-ground repo
 * keeps the file at its root — ran and returned the file. `shell` is `allow` in
 * `auto`, so nothing asked. These tests run the command for real against a
 * workspace that HAS the file, which is the only way to prove the content did not
 * come back.
 */
describe('a shell command may not read a protected file (D49ai)', () => {
  const withSecret = (): string => {
    const root = tempRoot();
    writeFileSync(join(root, 'keystore.properties'), 'storePassword=SUPERSECRET\n');
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'local.properties'), 'sdk.dir=/secret\n');
    return root;
  };

  it('refuses the bare name, which the whole-string check could not see', async () => {
    const r = await executeTool(withSecret(), 'shell', {
      command: 'cat keystore.properties',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
  });

  it('refuses it however the command is spelled', async () => {
    for (const command of [
      'cat ./keystore.properties',
      'cp keystore.properties /tmp/leak',
      'grep -R password keystore.properties',
      'cat app/local.properties',
    ]) {
      const r = await executeTool(withSecret(), 'shell', { command });
      expect(r.ok, command).toBe(false);
      expect(r.output, command).toContain('protected file');
    }
  });

  it('still runs an ordinary command', async () => {
    const r = await executeTool(withSecret(), 'shell', {
      command: 'echo ordinary output',
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('ordinary output');
  });
});

describe('background shells through the tool surface (D49m)', () => {
  it('refuses run_in_background when no manager is available', async () => {
    const r = await executeTool(tempRoot(), 'shell', {
      command: 'echo hi',
      run_in_background: true,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('unavailable');
  });

  it('starts a background shell and tells the model what it got', async () => {
    const m = new ShellManager();
    const r = await executeTool(
      tempRoot(),
      'shell',
      { command: LONG_RUNNING, run_in_background: true },
      { shells: m },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain('started shell 1');
    // The model must not plan on the server outliving the run.
    expect(r.output).toContain('stopped when the run ends');
    await m.killAll();
  });

  it('reads new output through bash_output, waiting when asked', async () => {
    const m = new ShellManager();
    const ctx = { shells: m };
    const root = tempRoot();
    const started = await executeTool(
      root,
      'shell',
      { command: nodeCommand("setTimeout(()=>console.log('built'),300)"), run_in_background: true },
      ctx,
    );
    expect(started.ok).toBe(true);
    const out = await executeTool(root, 'bash_output', { id: '1', wait_ms: 5000 }, ctx);
    expect(out.ok).toBe(true);
    expect(out.output).toContain('built');
    await m.killAll();
  });

  it('stops a shell with kill_shell, accepting a numeric id', async () => {
    const m = new ShellManager();
    const ctx = { shells: m };
    const root = tempRoot();
    await executeTool(root, 'shell', { command: LONG_RUNNING, run_in_background: true }, ctx);
    const k = await executeTool(root, 'kill_shell', { id: 1 }, ctx);
    expect(k.ok).toBe(true);
    expect(k.output).toContain('killed');
  });

  it('reports a missing or unknown id rather than pretending', async () => {
    const m = new ShellManager();
    const ctx = { shells: m };
    const root = tempRoot();
    expect((await executeTool(root, 'bash_output', {}, ctx)).output).toContain('missing id');
    expect((await executeTool(root, 'bash_output', { id: '7' }, ctx)).ok).toBe(false);
    expect((await executeTool(root, 'kill_shell', { id: '7' }, ctx)).ok).toBe(false);
    expect(
      (await executeTool(root, 'bash_output', { id: '1' }, {})).output,
    ).toContain('unavailable');
  });
});

describe('the .gitignore switch governs search, not access', () => {
  it('edits a file the user names, even while search skips it', async () => {
    // The switch answers "which files does a SEARCH return". A file the user
    // names is a different question, and the answer must not change: Plato
    // reads and writes it. Otherwise turning the switch on would quietly make
    // a generated file un-editable.
    const root = tempRoot();
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'vendor/\n');
    writeFileSync(join(root, 'vendor', 'lib.ts'), 'old\n');

    const write = await executeTool(
      root,
      'write_file',
      { path: 'vendor/lib.ts', content: 'new\n', overwrite: true },
      { respectGitignore: true },
    );
    expect(write.ok).toBe(true);
    expect(readFileSync(join(root, 'vendor', 'lib.ts'), 'utf8')).toBe('new\n');

    // And the same setting still hides it from a search.
    const search = await executeTool(root, 'grep', { pattern: 'new' }, { respectGitignore: true });
    expect(search.output).toBe('no matches');

    const open = await executeTool(
      root,
      'read_file',
      { path: 'vendor/lib.ts' },
      { respectGitignore: true },
    );
    expect(open.ok).toBe(true);
    expect(open.output).toContain('new');
  });
});

describe('ignored paths are visible by default and labelled', () => {
  function tree(): string {
    const root = tempRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'vendor/\n*.log\n');
    writeFileSync(join(root, 'src', 'a.ts'), 'const needle = 1;\n');
    writeFileSync(join(root, 'vendor', 'lib.ts'), 'const needle = 2;\n');
    writeFileSync(join(root, 'debug.log'), 'needle in a log\n');
    return root;
  }

  it('searches ignored files and says they are ignored', async () => {
    const r = await executeTool(tree(), 'grep', { pattern: 'needle' });
    expect(r.output).toContain('vendor/lib.ts');
    expect(r.note).toContain('paths that .gitignore excludes');
    expect(r.note).toContain('vendor/lib.ts');
  });

  it('skips them, with no note, when the switch is on', async () => {
    const r = await executeTool(tree(), 'grep', { pattern: 'needle' }, { respectGitignore: true });
    expect(r.output).not.toContain('vendor/lib.ts');
    expect(r.note).toBeUndefined();
  });

  it('labels a glob whose results are ignored', async () => {
    const r = await executeTool(tree(), 'glob', { pattern: '*.log' });
    expect(r.output).toContain('debug.log');
    expect(r.note).toContain('debug.log');
  });

  it('labels a listing that includes ignored files', async () => {
    const r = await executeTool(tree(), 'list_dir', {});
    expect(r.output).toContain('debug.log');
    expect(r.note).toContain('debug.log');
  });

  it('says so when a named file is ignored, whichever way the switch is set', async () => {
    const open = await executeTool(tree(), 'read_file', { path: 'debug.log' });
    expect(open.note).toBe('this file is excluded by .gitignore');
    const strict = await executeTool(
      tree(),
      'read_file',
      { path: 'debug.log' },
      { respectGitignore: true },
    );
    expect(strict.note).toBe('this file is excluded by .gitignore');
    const plain = await executeTool(tree(), 'read_file', { path: 'src/a.ts' });
    expect(plain.note).toBeUndefined();
  });
});
