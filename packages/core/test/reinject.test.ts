import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RECENT_WORK_FILES,
  RECENT_WORK_TOKENS,
  recentWorkBlock,
  recentWorkPaths,
} from '../src/runtime/reinject.js';
import type { LogRow } from '../src/runtime/chatlog.js';

/**
 * D49cn (2026-11-12): after a summary, the model is shown the CURRENT state of
 * the work it can no longer see. Correctness, not a preference: no setting.
 */
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-reinject-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const you = (text: string): LogRow => ({ k: 'msg', cls: 'you', text });
const bot = (text: string): LogRow => ({ k: 'msg', cls: 'bot', text });
const summary = (text: string): LogRow => ({ k: 'compact', text });
const read = (path: string): LogRow => ({ k: 'tool', tool: 'read_file', digest: path });
const edited = (path: string): LogRow => ({ k: 'tool', tool: 'apply_diff', digest: path });

describe('recentWorkBlock (D49cn)', () => {
  it('is absent before a fold, so nothing is carried twice', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.txt'), 'alpha');
    const rows = [you('q'), read('a.txt'), bot('a')];
    expect(await recentWorkBlock(rows, { root })).toBeNull();
  });

  it('carries the newest files by their CURRENT content after a fold', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.txt'), 'alpha as it is now');
    writeFileSync(join(root, 'b.txt'), 'beta as it is now');
    const rows = [
      read('a.txt'),
      bot('read a'),
      summary('earlier'),
      you('and b?'),
      edited('b.txt'),
      read('a.txt'),
      bot('b changed'),
    ];
    const block = await recentWorkBlock(rows, {
      root,
      git: async () => null,
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[recent work');
    expect(block).toContain('alpha as it is now');
    expect(block).toContain('beta as it is now');
    // Newest first: a.txt was read again after b.txt was edited, and a file
    // touched twice appears once.
    expect(block!.indexOf('--- a.txt ---')).toBeLessThan(
      block!.indexOf('--- b.txt ---'),
    );
    expect(block!.match(/--- a\.txt ---/g)).toHaveLength(1);
    expect(block).toContain('A summary is in effect');
  });

  it('names at most five files, newest first', async () => {
    const root = tempDir();
    const rows: LogRow[] = [summary('s')];
    for (let i = 0; i < 7; i += 1) {
      writeFileSync(join(root, `f${i}.txt`), `content ${i}`);
      rows.push(read(`f${i}.txt`));
    }
    expect(recentWorkPaths(rows)).toEqual([
      'f6.txt',
      'f5.txt',
      'f4.txt',
      'f3.txt',
      'f2.txt',
    ]);
    expect(RECENT_WORK_FILES).toBe(5);
    const block = await recentWorkBlock(rows, { root, git: async () => null });
    expect(block).not.toContain('f1.txt');
    expect(block).not.toContain('f0.txt');
  });

  it('stops including content at the token cap and says which file it stopped', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'small.txt'), 'a');
    // 1 token per 4 chars: 200 chars is 50 tokens, more than the 10 allowed.
    writeFileSync(join(root, 'large.txt'), 'x'.repeat(200));
    const rows = [summary('s'), read('small.txt'), read('large.txt')];
    const block = await recentWorkBlock(rows, {
      root,
      maxTokens: 10,
      git: async () => null,
    });
    expect(block).toContain('--- large.txt --- (not included: over the size budget)');
    expect(block).toContain('--- small.txt ---');
    expect(RECENT_WORK_TOKENS).toBe(5_000);
  });

  it('never quotes a protected file', async () => {
    const root = tempDir();
    writeFileSync(join(root, '.env'), 'API_KEY=sk-real\n');
    const rows = [summary('s'), read('.env')];
    const block = await recentWorkBlock(rows, { root, git: async () => null });
    expect(block).toContain('(not included: on the protected list)');
    expect(block).not.toContain('sk-real');
  });

  it('lists a deleted file instead of inventing it', async () => {
    const root = tempDir();
    const rows = [summary('s'), read('gone.txt')];
    const block = await recentWorkBlock(rows, { root, git: async () => null });
    expect(block).toContain('--- gone.txt --- (not included: no longer exists)');
  });

  it('lists a file outside the workspace as a path only', async () => {
    const root = tempDir();
    const away = tempDir();
    writeFileSync(join(away, 'outside.txt'), 'outside content');
    const rows = [summary('s'), read(join(away, 'outside.txt'))];
    const block = await recentWorkBlock(rows, { root, git: async () => null });
    expect(block).toContain('outside.txt --- (not included: outside the workspace)');
    expect(block).not.toContain('outside content');
  });

  it('reads the repository state as it is NOW', async () => {
    const root = tempDir();
    const git = (...args: string[]): void => {
      execFileSync(
        'git',
        ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args],
        { cwd: root, stdio: 'ignore' },
      );
    };
    git('init');
    writeFileSync(join(root, 'tracked.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'init');
    // Uncommitted and unstaged: the state at RUN TIME, not at fold time.
    writeFileSync(join(root, 'tracked.txt'), 'two\n');
    const rows = [summary('s'), read('tracked.txt')];
    const block = await recentWorkBlock(rows, { root });
    expect(block).toMatch(/^Current branch: /m);
    expect(block).toMatch(/^ M tracked\.txt$/m);
    expect(block).toContain('two\n');
  });

  it('says nothing when there is no file and no repository', async () => {
    const rows = [summary('s')];
    const block = await recentWorkBlock(rows, {
      root: tempDir(),
      git: async () => null,
    });
    expect(block).toBeNull();
  });
});
