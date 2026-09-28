import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UNDO_KEEP_REQUESTS,
  UNDO_MAX_FILE_BYTES,
  applyUndo,
  isUndoStoreId,
  planUndo,
  recordWrites,
  sha1Hex,
  sweepDeadProjects,
  sweepProject,
} from '../src/runtime/undo.js';

/**
 * D49ax. The properties this file exists to pin, in the order they matter:
 *
 * 1. **The user's own work is never thrown away.** A file changed since Plato
 *    wrote it is REFUSED, not overwritten. That is Kilo Code's reported bug
 *    ("Restore checkpoint removed all the changes of mine also"), closed by
 *    construction rather than by care.
 * 2. **A delete cannot leave the store.** Every removal is built from the store
 *    root and checked against it.
 * 3. **A corrupt index deletes nothing.** Reconcile drops what the index does not
 *    name, so an index that names nothing would take the whole store with it.
 * 4. **What is stored is the before, never the after** — plus a hash, which can
 *    answer "has this changed" and cannot reconstruct anything.
 */
const NOW = new Date('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

interface Scratch {
  root: string;
  dir: string;
}

/** A workspace and a store, both throwaway. */
function scratch(): Scratch {
  const base = mkdtempSync(join(tmpdir(), 'plato-undo-'));
  const root = join(base, 'ws');
  const dir = join(base, 'store');
  mkdirSync(root);
  mkdirSync(dir);
  return { root, dir };
}

function put(root: string, rel: string, text: string): void {
  writeFileSync(join(root, rel), text);
}

function get(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/** One write, as the executor reports it. */
function write(rel: string, before: string | null, after: string) {
  return { rel, kind: 'write' as const, before, after };
}

describe('recordWrites', () => {
  it('keeps the bytes that were replaced, and never the bytes that replaced them', () => {
    const { root, dir } = scratch();
    put(root, 'a.ts', 'const one = 1;\n');

    recordWrites(dir, root, 'r1', [write('a.ts', 'const one = 1;\n', 'const two = 2;\n')], NOW);

    const bin = readdirSync(join(dir, 'r1'));
    expect(bin).toEqual(['0.bin']);
    const stored = readFileSync(join(dir, 'r1', '0.bin'), 'utf8');
    expect(stored).toBe('const one = 1;\n');
    // The whole point: what Plato wrote is nowhere in the store.
    const index = readFileSync(join(dir, 'index.json'), 'utf8');
    expect(index.includes('const two')).toBe(false);
    expect(index.includes('const one')).toBe(false);
  });

  it('records a created file as having had no before', () => {
    const { root, dir } = scratch();
    put(root, 'new.ts', 'hello\n');
    recordWrites(dir, root, 'r1', [write('new.ts', null, 'hello\n')], NOW);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { files: { existed: boolean; copied: boolean; seq: number | null }[] }[];
    };
    expect(index.requests[0]?.files[0]?.existed).toBe(false);
    expect(index.requests[0]?.files[0]?.copied).toBe(false);
    expect(readdirSync(join(dir, 'r1'))).toEqual([]);
  });

  it('skips a file over the per-file cap, and says so rather than dropping it', () => {
    const { root, dir } = scratch();
    const big = 'x'.repeat(UNDO_MAX_FILE_BYTES + 1);
    put(root, 'out.bin', big);
    recordWrites(dir, root, 'r1', [write('out.bin', big, 'smaller')], NOW);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { files: { copied: boolean; rel: string }[] }[];
    };
    expect(index.requests[0]?.files[0]?.copied).toBe(false);
    expect(index.requests[0]?.files[0]?.rel).toBe('out.bin');
  });

  it('stores nothing for a path outside the workspace', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('../../etc/passwd', 'x', 'y')], NOW);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { files: unknown[] }[];
    };
    expect(index.requests[0]?.files).toEqual([]);
  });

  it('never throws, whatever it is handed', () => {
    const { root, dir } = scratch();
    // A request id that would traverse if it were trusted.
    expect(() => recordWrites(dir, root, '../../evil', [write('a.ts', 'a', 'b')], NOW)).not.toThrow();
    expect(existsSync(join(dir, '..', 'evil'))).toBe(false);
    // A store directory that cannot be created (a file stands where it goes).
    writeFileSync(join(dir, 'blocked'), '');
    expect(() => recordWrites(join(dir, 'blocked'), root, 'r1', [write('a.ts', 'a', 'b')], NOW)).not.toThrow();
  });

  it('keeps several writes to one file as separate copies', () => {
    const { root, dir } = scratch();
    put(root, 'a.ts', 'three\n');
    recordWrites(dir, root, 'r1', [write('a.ts', 'one\n', 'two\n')], NOW);
    recordWrites(dir, root, 'r1', [write('a.ts', 'two\n', 'three\n')], NOW);
    expect(readdirSync(join(dir, 'r1')).sort()).toEqual(['0.bin', '1.bin']);
  });
});

describe('planUndo and applyUndo', () => {
  it('puts the file back exactly as it was', () => {
    const { root, dir } = scratch();
    put(root, 'a.ts', 'const one = 1;\n');
    recordWrites(dir, root, 'r1', [write('a.ts', 'const one = 1;\n', 'const two = 2;\n')], NOW);
    put(root, 'a.ts', 'const two = 2;\n');

    const plan = planUndo(dir, root, 'last');
    expect(plan?.restore.map((t) => t.rel)).toEqual(['a.ts']);
    expect(plan?.refuse).toEqual([]);

    applyUndo(dir, root, plan!);
    expect(get(root, 'a.ts')).toBe('const one = 1;\n');
  });

  it('REFUSES a file the user edited since, rather than throwing their work away', () => {
    const { root, dir } = scratch();
    put(root, 'Probe.ts', 'plato wrote this\n');
    recordWrites(
      dir,
      root,
      'r1',
      [
        write('Probe.ts', 'before\n', 'plato wrote this\n'),
        write('Safe.ts', 'old\n', 'new\n'),
      ],
      NOW,
    );
    put(root, 'Probe.ts', 'plato wrote this\nthe user added this line\n');
    put(root, 'Safe.ts', 'new\n');

    const plan = planUndo(dir, root, 'request')!;
    expect(plan.refuse.map((r) => r.rel)).toEqual(['Probe.ts']);
    expect(plan.refuse[0]?.why).toBe('edited');
    expect(plan.restore.map((t) => t.rel)).toEqual(['Safe.ts']);

    applyUndo(dir, root, plan);
    // The user's line survived, which is the entire point.
    expect(get(root, 'Probe.ts')).toBe('plato wrote this\nthe user added this line\n');
    expect(get(root, 'Safe.ts')).toBe('old\n');
  });

  it('refuses a file that was deleted since, rather than resurrecting it', () => {
    const { root, dir } = scratch();
    put(root, 'gone.ts', 'before\n');
    recordWrites(dir, root, 'r1', [write('gone.ts', 'before\n', 'after\n')], NOW);
    rmSync(join(root, 'gone.ts'));

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.refuse.map((r) => r.rel)).toEqual(['gone.ts']);
    expect(plan.restore).toEqual([]);
  });

  it('undoes a created file by removing it', () => {
    const { root, dir } = scratch();
    put(root, 'made.ts', 'plato made this\n');
    recordWrites(dir, root, 'r1', [write('made.ts', null, 'plato made this\n')], NOW);

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.restore[0]?.action).toBe('delete');
    applyUndo(dir, root, plan);
    expect(existsSync(join(root, 'made.ts'))).toBe(false);
  });

  it('refuses to remove a created file the user has edited', () => {
    const { root, dir } = scratch();
    put(root, 'made.ts', 'plato made this\nthe user added this\n');
    recordWrites(dir, root, 'r1', [write('made.ts', null, 'plato made this\n')], NOW);

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.restore).toEqual([]);
    expect(plan.refuse[0]?.why).toBe('edited');
    applyUndo(dir, root, plan);
    expect(existsSync(join(root, 'made.ts'))).toBe(true);
  });

  it('reports a file with no copy as too big, with its size', () => {
    const { root, dir } = scratch();
    const big = 'x'.repeat(UNDO_MAX_FILE_BYTES + 1);
    recordWrites(dir, root, 'r1', [write('out.bin', big, 'smaller')], NOW);
    put(root, 'out.bin', 'smaller'); // what Plato left behind

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.restore).toEqual([]);
    expect(plan.refuse[0]?.why).toBe('too-big');
    expect(plan.refuse[0]?.size).toBe(big.length);
  });

  it('refuses a copy that cannot be read back as what was stored', () => {
    const { root, dir } = scratch();
    put(root, 'a.ts', 'after\n');
    recordWrites(dir, root, 'r1', [write('a.ts', 'before\n', 'after\n')], NOW);
    // Corrupt the copy, as a bad disk or a scrambled index would.
    writeFileSync(join(dir, 'r1', '0.bin'), 'something else\n');

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.restore).toEqual([]);
    expect(plan.refuse[0]?.why).toBe('damaged');
    applyUndo(dir, root, plan);
    expect(get(root, 'a.ts')).toBe('after\n');
  });

  it('has nothing to undo before anything is recorded', () => {
    const { root, dir } = scratch();
    expect(planUndo(dir, root, 'last')).toBeNull();
  });
});

describe('scope', () => {
  it('puts each file back to how it was BEFORE the request, not a half-way state', () => {
    const { root, dir } = scratch();
    // Two writes to one file inside one request, then a different file.
    recordWrites(dir, root, 'r1', [write('a.ts', 'original\n', 'step two\n')], NOW);
    recordWrites(dir, root, 'r1', [write('a.ts', 'step two\n', 'final\n')], NOW);
    put(root, 'a.ts', 'final\n');
    put(root, 'b.ts', 'plato\n');
    recordWrites(dir, root, 'r1', [write('b.ts', null, 'plato\n')], NOW);

    const plan = planUndo(dir, root, 'request')!;
    expect(plan.restore.map((t) => t.rel).sort()).toEqual(['a.ts', 'b.ts']);
    applyUndo(dir, root, plan);
    expect(get(root, 'a.ts')).toBe('original\n');
    expect(existsSync(join(root, 'b.ts'))).toBe(false);
  });

  it('undoes only the last write when asked for the last write', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('a.ts', 'one\n', 'two\n')], NOW);
    recordWrites(dir, root, 'r1', [write('b.ts', 'three\n', 'four\n')], NOW);
    put(root, 'a.ts', 'two\n');
    put(root, 'b.ts', 'four\n');

    const plan = planUndo(dir, root, 'last')!;
    expect(plan.restore.map((t) => t.rel)).toEqual(['b.ts']);
    applyUndo(dir, root, plan);
    expect(get(root, 'b.ts')).toBe('three\n');
    expect(get(root, 'a.ts')).toBe('two\n'); // untouched
  });
});

describe('redo', () => {
  it('puts the change back, because a restore is itself a write', () => {
    const { root, dir } = scratch();
    put(root, 'a.ts', 'before\n');
    recordWrites(dir, root, 'r1', [write('a.ts', 'before\n', 'after\n')], NOW);
    put(root, 'a.ts', 'after\n');

    applyUndo(dir, root, planUndo(dir, root, 'last')!);
    expect(get(root, 'a.ts')).toBe('before\n');

    const back = planUndo(dir, root, 'last')!;
    expect(back.restore.map((t) => t.rel)).toEqual(['a.ts']);
    applyUndo(dir, root, back);
    expect(get(root, 'a.ts')).toBe('after\n');
  });

  it('brings back a file Plato created and undo removed', () => {
    const { root, dir } = scratch();
    put(root, 'made.ts', 'plato made this\n');
    recordWrites(dir, root, 'r1', [write('made.ts', null, 'plato made this\n')], NOW);

    applyUndo(dir, root, planUndo(dir, root, 'last')!);
    expect(existsSync(join(root, 'made.ts'))).toBe(false);

    applyUndo(dir, root, planUndo(dir, root, 'last')!);
    expect(get(root, 'made.ts')).toBe('plato made this\n');
  });
});

describe('deletion is confined to the store', () => {
  it('refuses a path outside the store', () => {
    // The helper every removal path is built on.
    expect(isUndoStoreId('../escape')).toBe(false);
    expect(isUndoStoreId('..')).toBe(false);
    expect(isUndoStoreId('a/b')).toBe(false);
    expect(isUndoStoreId('r1')).toBe(true);
    expect(isUndoStoreId('undo-m3x-abc123')).toBe(true);
  });

  it('leaves a workspace file alone when the store is swept', () => {
    const { root, dir } = scratch();
    put(root, 'keep.ts', 'mine\n');
    recordWrites(dir, root, 'r1', [write('keep.ts', 'mine\n', 'changed\n')], NOW);
    // An orphan directory is what a crash mid-write leaves behind.
    mkdirSync(join(dir, 'orphan'));
    writeFileSync(join(dir, 'orphan', '0.bin'), 'x');

    const report = sweepProject(dir, NOW);

    expect(report.valid).toBe(true);
    expect(report.orphans).toEqual(['orphan']);
    expect(existsSync(join(dir, 'orphan'))).toBe(false);
    expect(get(root, 'keep.ts')).toBe('mine\n');
  });
});

describe('sweepProject', () => {
  it('deletes NOTHING when the index cannot be read', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('a.ts', 'a', 'b')], NOW);
    writeFileSync(join(dir, 'index.json'), '{ this is not json');

    const report = sweepProject(dir, NOW);

    expect(report.valid).toBe(false);
    expect(report.evicted).toEqual([]);
    expect(readdirSync(join(dir, 'r1'))).toEqual(['0.bin']);
  });

  it('evicts a request older than the age limit, and its copies with it', () => {
    const { root, dir } = scratch();
    // Eleven requests, all recorded at the same instant, so nothing is evicted
    // while they are being written.
    for (let i = 0; i <= UNDO_KEEP_REQUESTS; i += 1) {
      recordWrites(dir, root, `r${i}`, [write('a.ts', 'a', 'b')], NOW);
    }

    // Swept 31 days later: the oldest is past the limit and is not one of the
    // ten the store promises to keep.
    const report = sweepProject(dir, new Date(NOW.getTime() + 31 * DAY));

    expect(report.evicted).toEqual(['r0']);
    expect(existsSync(join(dir, 'r0'))).toBe(false);
    expect(existsSync(join(dir, 'r1'))).toBe(true);
  });

  it('never evicts the most recent ten, however old they are', () => {
    const { root, dir } = scratch();
    for (let i = 0; i < UNDO_KEEP_REQUESTS; i += 1) {
      recordWrites(dir, root, `r${i}`, [write('a.ts', 'a', 'b')], new Date(NOW.getTime() - 90 * DAY));
    }

    const report = sweepProject(dir, NOW);

    expect(report.evicted).toEqual([]);
    for (let i = 0; i < UNDO_KEEP_REQUESTS; i += 1) {
      expect(existsSync(join(dir, `r${i}`))).toBe(true);
    }
  });

  it('drops an unnamed copy but leaves an unnamed file the user put there', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('a.ts', 'a', 'b')], NOW);
    writeFileSync(join(dir, 'r1', '99.bin'), 'orphan copy');
    writeFileSync(join(dir, 'notes.txt'), 'the user put this here');

    sweepProject(dir, NOW);

    expect(readdirSync(join(dir, 'r1'))).toEqual(['0.bin']);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
  });

  it('leaves a store with no index at all untouched', () => {
    const { dir } = scratch();
    mkdirSync(join(dir, 'something'));
    const report = sweepProject(dir, NOW);
    expect(report.valid).toBe(false);
    expect(existsSync(join(dir, 'something'))).toBe(true);
  });
});

describe('sweepDeadProjects', () => {
  it('reclaims the store of a workspace that no longer exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'plato-undo-root-'));
    const undoRoot = join(base, 'undo');
    const live = join(base, 'live');
    const dead = join(base, 'dead');
    mkdirSync(live);
    mkdirSync(dead);
    recordWrites(join(undoRoot, 'k1'), live, 'r1', [write('a.ts', 'a', 'b')], NOW);
    recordWrites(join(undoRoot, 'k2'), dead, 'r1', [write('a.ts', 'a', 'b')], NOW);
    rmSync(dead, { recursive: true });

    const removed = sweepDeadProjects(undoRoot);

    expect(removed).toEqual(['k2']);
    expect(existsSync(join(undoRoot, 'k1'))).toBe(true);
    expect(existsSync(join(undoRoot, 'k2'))).toBe(false);
  });

  it('keeps a store whose index cannot be read, because it cannot prove whose it is', () => {
    const base = mkdtempSync(join(tmpdir(), 'plato-undo-root-'));
    const undoRoot = join(base, 'undo');
    mkdirSync(join(undoRoot, 'k1'), { recursive: true });
    writeFileSync(join(undoRoot, 'k1', 'index.json'), 'not json');

    expect(sweepDeadProjects(undoRoot)).toEqual([]);
    expect(existsSync(join(undoRoot, 'k1'))).toBe(true);
  });

  it('ignores a loose file at the store root', () => {
    const base = mkdtempSync(join(tmpdir(), 'plato-undo-root-'));
    const undoRoot = join(base, 'undo');
    mkdirSync(undoRoot, { recursive: true });
    writeFileSync(join(undoRoot, 'stray.txt'), 'x');
    expect(sweepDeadProjects(undoRoot)).toEqual([]);
    expect(existsSync(join(undoRoot, 'stray.txt'))).toBe(true);
  });
});

describe('the hash', () => {
  it('is taken over the bytes, so the same text is the same hash', () => {
    expect(sha1Hex(Buffer.from('abc', 'utf8'))).toBe(sha1Hex(Buffer.from('abc', 'utf8')));
    expect(sha1Hex(Buffer.from('abc', 'utf8'))).not.toBe(sha1Hex(Buffer.from('abd', 'utf8')));
  });
});

describe('the index', () => {
  it('is written whole, with no temporary left behind', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('a.ts', 'a', 'b')], NOW);
    expect(existsSync(join(dir, 'index.json.tmp'))).toBe(false);
    expect(statSync(join(dir, 'index.json')).isFile()).toBe(true);
  });

  it('records sizes so the cap is arithmetic on one file', () => {
    const { root, dir } = scratch();
    recordWrites(dir, root, 'r1', [write('a.ts', '12345', 'x')], NOW);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      requests: { bytes: number }[];
    };
    expect(index.requests[0]?.bytes).toBe(5);
  });
});
