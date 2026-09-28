import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  undoCard,
  undoNothingText,
  undoResultText,
} from '../src/runtime/undoCopy.js';
import type { UndoPlan, UndoResult, UndoTarget } from '../src/runtime/undo.js';

/**
 * D49ax. The wording is part of the decision, and a first draft was rejected as
 * cryptic, so these tests pin the three things the founder asked for:
 *
 * 1. **Name the files.** A message that says "3 files" and nothing else makes the
 *    user go and count.
 * 2. **Name the commands that undo cannot cover.** The rejected line said
 *    "changes made by commands Plato ran are not affected" — which named nothing
 *    and told the user what did NOT happen instead of where to look.
 * 3. **End with what the user can do.** Every refusal says where else to go.
 */
function target(rel: string, action: 'restore' | 'delete' = 'restore'): UndoTarget {
  return {
    rel,
    action,
    seq: action === 'restore' ? 0 : null,
    beforeHash: 'h',
    size: 10,
    guard: { kind: 'hash', hash: 'h' },
  };
}

const plan = (over: Partial<UndoPlan> = {}): UndoPlan => ({
  id: 'r1',
  startedAtUtc: '2026-09-28T10:00:00.000Z',
  restore: [],
  refuse: [],
  alreadyThere: [],
  ...over,
});

const result = (over: Partial<UndoResult> = {}): UndoResult => ({
  id: 'r1',
  applied: [],
  failed: [],
  redoId: null,
  ...over,
});

describe('formatBytes', () => {
  it('picks the unit a person would use', () => {
    expect(formatBytes(17)).toBe('17 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(4 * 1024 * 1024 + 200 * 1024)).toBe('4.2 MB');
  });
});

describe('undoCard', () => {
  it('separates what WILL happen from what will NOT', () => {
    // The founder read one line of the first version — a single unlabelled list
    // holding both kinds of row, under a button reading "Put these back" — and
    // could not tell whether the refused file was included. Hence two lists.
    const card = undoCard(
      plan({
        restore: [target('src/a.ts'), target('src/b.ts')],
        refuse: [{ rel: 'Probe.ts', why: 'edited', size: 120 }],
      }),
    )!;
    expect(card.title).toBe('Undo your last request?');
    expect(card.willChange).toHaveLength(2);
    expect(card.willNotChange).toHaveLength(1);
    // Every row names what happens TO THAT FILE, so no row needs the heading to
    // be understood.
    expect(card.willChange[0]).toContain('src/a.ts');
    expect(card.willChange[0]).toContain('puts back the old copy');
    expect(card.willNotChange[0]).toContain('Probe.ts');
    expect(card.willNotChange[0]).toContain('you edited it after Plato wrote it');
  });

  it('says a created file is DELETED, because that is what the click does', () => {
    const card = undoCard(plan({ restore: [target('made.ts', 'delete')] }))!;
    expect(card.willChange[0]).toContain('made.ts');
    expect(card.willChange[0]).toContain('deletes it');
  });

  it('names the size and the limit for a file that was too big to copy', () => {
    const card = undoCard(
      plan({
        restore: [target('src/a.ts')],
        refuse: [{ rel: 'build/output.bin', why: 'too-big', size: 4404019 }],
      }),
    )!;
    expect(card.willNotChange[0]).toContain('build/output.bin');
    expect(card.willNotChange[0]).toContain('4.2 MB');
    expect(card.willNotChange[0]).toContain('1 MB');
    // A refusal that leaves the user nowhere to go is the cryptic draft again.
    expect(card.willNotChange[0]).toContain('git');
  });

  it('names an unreadable copy by its file, like every other row', () => {
    const card = undoCard(
      plan({
        restore: [target('src/a.ts')],
        refuse: [{ rel: 'src/b.ts', why: 'damaged', size: 10 }],
      }),
    )!;
    expect(card.willNotChange[0]?.startsWith('src/b.ts')).toBe(true);
  });

  it('is null when there is nothing to change', () => {
    expect(
      undoCard(plan({ refuse: [{ rel: 'a.ts', why: 'edited', size: 1 }] })),
    ).toBeNull();
  });
});

describe('the buttons say what the click does', () => {
  it('names the verb and the count when the request is all restores', () => {
    const card = undoCard(
      plan({ restore: [target('a.ts'), target('b.ts')] }),
    )!;
    expect(card.confirm).toBe('Put back 2 files');
  });

  it('says DELETE when the click removes a file, not "put back"', () => {
    const card = undoCard(plan({ restore: [target('made.ts', 'delete')] }))!;
    expect(card.confirm).toBe('Delete 1 file');
  });

  it('names BOTH actions when the click does both', () => {
    const card = undoCard(
      plan({ restore: [target('a.ts'), target('b.ts'), target('made.ts', 'delete')] }),
    )!;
    expect(card.confirm).toBe('Put back 2, delete 1');
  });

  it('offers the narrower action ONLY when it differs, and NAMES the file', () => {
    // "Just the last change" left the user to work out both the scope and the
    // target. A label with the file in it cannot be misread.
    const two = plan({ restore: [target('a.ts'), target('b.ts')] });
    expect(undoCard(two, 'b.ts')!.onlyLast).toBe('Put back only b.ts');

    // One file: the two actions are the same, so a second button is a choice the
    // user has to read for nothing.
    expect(undoCard(plan({ restore: [target('a.ts')] }), 'a.ts')!.onlyLast).toBeNull();

    // The last write is a file with no copy, so undo will refuse it: a button
    // naming it would do nothing at all.
    const withRefusal = plan({
      restore: [target('a.ts'), target('b.ts')],
      refuse: [{ rel: 'c.ts', why: 'edited', size: 1 }],
    });
    expect(undoCard(withRefusal, 'c.ts')!.onlyLast).toBeNull();

    // No target known: no button.
    expect(undoCard(two, null)!.onlyLast).toBeNull();

    // A created file is DELETED by the narrower action too, so its button says
    // delete — naming the file without naming the effect is what the audit
    // caught: "Only made.ts" could be read as "only this one" or as an exclusion.
    const created = plan({
      restore: [target('kept.ts'), target('made.ts', 'delete')],
    });
    expect(undoCard(created, 'made.ts')!.onlyLast).toBe('Delete only made.ts');
  });
});

describe('undoResultText', () => {
  it('says what was put back, and names the commands it could not cover', () => {
    const p = plan({
      restore: [target('src/a.ts'), target('src/b.ts'), target('src/c.ts')],
    });
    const r = result({
      applied: [
        { rel: 'src/a.ts', how: 'restored' },
        { rel: 'src/b.ts', how: 'restored' },
        { rel: 'src/c.ts', how: 'restored' },
      ],
    });
    const text = undoResultText(p, r, ['pnpm install', './gradlew build']);
    expect(text).toContain('Undone. Plato put back the 3 files it edited.');
    expect(text).toContain('pnpm install');
    expect(text).toContain('./gradlew build');
    expect(text).toContain('cannot undo those');
    // The way out, which the rejected draft did not give.
    expect(text).toContain('where to look');
  });

  it('counts what ACTUALLY happened, not what was intended', () => {
    const p = plan({
      restore: [target('a.ts'), target('b.ts'), target('c.ts')],
    });
    // The third write failed, so three were intended and two happened.
    const r = result({
      applied: [
        { rel: 'a.ts', how: 'restored' },
        { rel: 'b.ts', how: 'restored' },
      ],
      failed: [{ rel: 'c.ts', why: 'the write failed' }],
    });
    const text = undoResultText(p, r, []);
    expect(text).toContain('Partly undone');
    expect(text).toContain('put back the 2 files it edited');
    // Both counts are present: what it did, and what it did not.
    expect(text).toContain('and did not change 1 file:');
    expect(text).toContain('c.ts');
  });

  it('never calls a REMOVED file "put back"', () => {
    // The bug a screenshot caught in a real window: a request that created one
    // file and refused another reported "put back 1 file of the 1 it was going
    // to change" — the wrong verb for a file that is now gone from the tree,
    // and a denominator that made a partial undo read as a complete one.
    const p = plan({
      restore: [target('made.ts', 'delete')],
      refuse: [{ rel: 'kept.ts', why: 'edited', size: 10 }],
    });
    const r = result({ applied: [{ rel: 'made.ts', how: 'deleted' }] });
    const text = undoResultText(p, r, []);
    expect(text).toContain('removed 1 file it created');
    expect(text).not.toContain('put back');
    expect(text).toContain('and did not change 1 file:');
    expect(text).toContain('kept.ts');
  });

  it('says both verbs when a request both restored and removed', () => {
    const p = plan({
      restore: [target('a.ts'), target('made.ts', 'delete')],
      refuse: [{ rel: 'kept.ts', why: 'edited', size: 10 }],
    });
    const r = result({
      applied: [
        { rel: 'a.ts', how: 'restored' },
        { rel: 'made.ts', how: 'deleted' },
      ],
    });
    const text = undoResultText(p, r, []);
    expect(text).toContain('put back the file it edited and removed 1 file it created');
  });

  it('says a file was already back, rather than reporting a failure', () => {
    // The user deleted a file Plato created, then asked for the undo.
    const p = plan({ alreadyThere: ['made.ts'] });
    expect(undoResultText(p, result(), [])).toContain('already back to how they were');
  });

  it('does not claim a file was put back when nothing was', () => {
    const p = plan({
      restore: [target('a.ts')],
      refuse: [{ rel: 'b.ts', why: 'edited', size: 3 }],
    });
    const r = result(); // nothing applied
    const text = undoResultText(p, r, []);
    expect(text).toContain('Undo did not change any file.');
    expect(text).toContain('b.ts');
    expect(text).not.toContain('Undone.');
  });

  it('says a created file was removed, and does not call it a restore', () => {
    const p = plan({ restore: [target('made.ts', 'delete')] });
    const r = result({ applied: [{ rel: 'made.ts', how: 'deleted' }] });
    const text = undoResultText(p, r, []);
    expect(text).toContain('Plato removed 1 file it created.');
    expect(text).not.toContain('put back');
  });

  it('leaves the command paragraph out when no command ran', () => {
    const p = plan({ restore: [target('a.ts')] });
    const r = result({ applied: [{ rel: 'a.ts', how: 'restored' }] });
    expect(undoResultText(p, r, [])).not.toContain('command');
  });

  it('caps a long command list and says how many it left out', () => {
    const p = plan({ restore: [target('a.ts')] });
    const r = result({ applied: [{ rel: 'a.ts', how: 'restored' }] });
    const text = undoResultText(p, r, ['a', 'b', 'c', 'd', 'e']);
    expect(text).toContain('a, b and c');
    expect(text).toContain('and 2 more');
  });
});

describe('undoNothingText', () => {
  it('says why there is nothing, and does not sound like a failure', () => {
    const text = undoNothingText();
    expect(text).toContain('Nothing to undo');
    expect(text).toContain('has not changed a file here yet');
  });
});
