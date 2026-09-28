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
  it('lists what goes back, one file per line', () => {
    const card = undoCard(
      plan({ restore: [target('src/a.ts'), target('src/b.ts'), target('README.md')] }),
    )!;
    expect(card.title).toBe('Put back the 3 files from your last request?');
    expect(card.restore).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(card.refuse).toEqual([]);
  });

  it('says a created file is REMOVED, because that is what the click does', () => {
    const card = undoCard(plan({ restore: [target('made.ts', 'delete')] }))!;
    expect(card.title).toBe('Put back the file from your last request?');
    expect(card.restore[0]).toContain('made.ts');
    expect(card.restore[0]).toContain('removed');
  });

  it('shows the refusals on the same card, so the offer is never a surprise', () => {
    const card = undoCard(
      plan({
        restore: [target('src/a.ts')],
        refuse: [{ rel: 'Probe.ts', why: 'edited', size: 120 }],
      }),
    )!;
    expect(card.refuse[0]).toContain('Probe.ts');
    expect(card.refuse[0]).toContain('you changed it after Plato did');
  });

  it('names the size and the limit for a file that was too big to copy', () => {
    const card = undoCard(
      plan({
        restore: [target('src/a.ts')],
        refuse: [{ rel: 'build/output.bin', why: 'too-big', size: 4404019 }],
      }),
    )!;
    expect(card.refuse[0]).toContain('build/output.bin');
    expect(card.refuse[0]).toContain('4.2 MB');
    expect(card.refuse[0]).toContain('1 MB');
    // A refusal that leaves the user nowhere to go is the cryptic draft again.
    expect(card.refuse[0]).toContain('git');
  });

  it('is null when there is nothing to put back', () => {
    expect(
      undoCard(plan({ refuse: [{ rel: 'a.ts', why: 'edited', size: 1 }] })),
    ).toBeNull();
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
    expect(text).toContain('2 files');
    expect(text).toContain('c.ts was not put back');
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
    expect(text).toContain('Nothing was put back.');
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
