import { describe, expect, it } from 'vitest';
import {
  askNote,
  continueText,
  nudgeText,
  nudgeNote,
  stuckCard,
  stuckStopNote,
  StuckWatch,
  STUCK_ASK_AT,
  STUCK_NUDGE_AT,
  type CallOutcome,
  type StuckCall,
} from '../src/runtime/stuck.js';

/**
 * D49aw. Bounding a run by repetition, not by volume.
 *
 * **The rule under every test here: this caps wasted effort, never progress.**
 * The deleted turn cap counted the wrong thing and cut a working run; every
 * assertion below exists to make sure the replacement cannot do the same. The
 * load-bearing ones are the false-positive guards — same call with a DIFFERENT
 * result must not count (that is the test suite after each edit), a call the
 * USER declined must not count at all (or five declines in `edit` mode would
 * raise "you look stuck" because you said no), and any success must reset.
 */

let seq = 0;

function call(over: Partial<StuckCall> = {}): StuckCall {
  seq += 1;
  return {
    tool: 'shell',
    args: { command: `cmd-${seq}` },
    result: `out-${seq}`,
    outcome: 'failed',
    ...over,
  };
}

/** One call that is identical every time — the shape a stuck model produces. */
function same(over: Partial<StuckCall> = {}): StuckCall {
  return {
    tool: 'shell',
    args: { command: 'pnpm build' },
    result: 'error TS2304: cannot find name foo',
    outcome: 'failed',
    ...over,
  };
}

/** A turn: some calls, then the boundary. Returns every verdict in order. */
function turn(w: StuckWatch, outcomes: CallOutcome[]): ReturnType<StuckWatch['endTurn']>[] {
  const out = outcomes.map((o) => w.observe(call({ outcome: o })));
  out.push(w.endTurn());
  return out;
}

function lastVerdict<T extends { kind: string }>(list: T[]): T {
  return list[list.length - 1]!;
}

describe('repetition — the call AND its result', () => {
  it('nudges at the third identical call, not the second', () => {
    const w = new StuckWatch();
    expect(w.observe(same()).kind).toBe('ok');
    expect(w.observe(same()).kind).toBe('ok');
    const third = w.observe(same());
    expect(third.kind).toBe('nudge');
    expect(third.kind === 'nudge' && third.text).toContain('pnpm build');
  });

  it('asks at the fifth, and only once', () => {
    const w = new StuckWatch();
    const kinds: string[] = [];
    for (let i = 0; i < 8; i += 1) kinds.push(w.observe(same()).kind);
    expect(kinds).toEqual(['ok', 'ok', 'nudge', 'ok', 'ask', 'ok', 'ok', 'ok']);
  });

  it('does NOT count the same call when its result changed — the test suite after an edit', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 8; i += 1) {
      const v = w.observe(same({ result: `2 passing, ${i} failing`, outcome: 'failed' }));
      expect(v.kind).toBe('ok');
    }
  });

  it('does not count the same call with different arguments — a different file each time', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 8; i += 1) {
      expect(w.observe(same({ args: { command: `pnpm build --pkg ${i}` } })).kind).toBe('ok');
    }
  });

  it('counts a repeated call that is BLOCKED — deterministic text, and the model is not adapting', () => {
    const w = new StuckWatch();
    const blocked: Partial<StuckCall> = {
      result: 'blocked: shell is not permitted in plan mode',
      outcome: 'blocked',
    };
    expect(w.observe(same(blocked)).kind).toBe('ok');
    expect(w.observe(same(blocked)).kind).toBe('ok');
    expect(w.observe(same(blocked)).kind).toBe('nudge');
  });

  it('nudges again after the run of repeats breaks and starts over', () => {
    const w = new StuckWatch();
    w.observe(same());
    w.observe(same());
    expect(w.observe(same()).kind).toBe('nudge');
    expect(w.observe(call()).kind).toBe('ok'); // a different call — the run is broken
    expect(w.observe(same()).kind).toBe('ok');
    expect(w.observe(same()).kind).toBe('ok');
    expect(w.observe(same()).kind).toBe('nudge');
  });

  it('names the call in the nudge, and gives the model both ways out', () => {
    const text = nudgeText({
      kind: 'repeat',
      count: 3,
      call: 'shell: pnpm build',
      lastSuccess: 'write_file: src/a.ts',
    });
    expect(text).toContain('shell: pnpm build');
    expect(text).toContain('3 times in a row');
    expect(text).toContain('Change your approach');
    expect(text).toContain('what is blocking you');
  });
});

describe('a call the USER declined never counts', () => {
  it('five declines raise nothing — the card would be aimed at the user', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 8; i += 1) {
      expect(w.observe(same({ outcome: 'declined', result: 'user declined this action' })).kind).toBe(
        'ok',
      );
    }
  });

  it('a decline does not reset the streak either — it is neutral', () => {
    const w = new StuckWatch();
    turn(w, ['failed']);
    turn(w, ['failed']);
    turn(w, ['declined']);
    turn(w, ['failed']);
    turn(w, ['failed']);
    // streak is 4: two, then the decline neither adds nor clears, then two more
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ask');
  });
});

describe('no-progress — turns in which nothing succeeded', () => {
  it('nudges at three failed turns', () => {
    const w = new StuckWatch();
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ok');
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ok');
    const v = lastVerdict(turn(w, ['failed']));
    expect(v.kind).toBe('nudge');
    expect(v.kind === 'nudge' && v.text).toContain('The last 3 turns all failed');
  });

  it('a turn with ANY success resets it — this is the whole point', () => {
    const w = new StuckWatch();
    turn(w, ['failed']);
    turn(w, ['failed']);
    turn(w, ['failed', 'ok']);
    turn(w, ['failed']);
    turn(w, ['failed']);
    // three fresh failures only — the reset means no card is due yet
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('nudge');
  });

  it('also resets on a LATER success, not only a clean turn', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 4; i += 1) turn(w, ['failed']);
    turn(w, ['failed', 'ok']); // success clears the streak
    for (let i = 0; i < 4; i += 1) turn(w, ['failed']);
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ask');
  });

  it('a turn of only declines neither extends nor clears the streak', () => {
    const w = new StuckWatch();
    turn(w, ['failed']);
    turn(w, ['failed']);
    turn(w, ['declined', 'declined']);
    turn(w, ['failed']);
    turn(w, ['failed']);
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ask');
  });

  it('asks at five failed turns and reports the calls and the last success', () => {
    const w = new StuckWatch();
    w.observe(call({ outcome: 'ok', tool: 'write_file', args: { path: 'src/DateHelper.java' } }));
    w.endTurn();
    const kinds: string[] = [];
    for (let i = 0; i < 5; i += 1) kinds.push(lastVerdict(turn(w, ['failed'])).kind);
    expect(kinds).toEqual(['ok', 'ok', 'nudge', 'ok', 'ask']);
    const ask = turn(w, ['failed']); // the sixth — already asked, so nothing more
    expect(lastVerdict(ask).kind).toBe('ok');
    const req = {
      kind: 'no-progress' as const,
      count: 5,
      failures: 5,
      lastSuccess: 'write_file: src/DateHelper.java',
    };
    expect(stuckCard(req).lines[1]).toContain('write_file: src/DateHelper.java');
  });
});

describe('the user answers', () => {
  it('"keep going" exempts THAT call for the run, and still catches a new one', () => {
    const w = new StuckWatch();
    let asked = false;
    for (let i = 0; i < 5; i += 1) {
      if (w.observe(same()).kind === 'ask') asked = true;
    }
    expect(asked).toBe(true);
    w.resolve('continue');
    for (let i = 0; i < 10; i += 1) expect(w.observe(same()).kind).toBe('ok');
    // a DIFFERENT repeated call is still caught
    const other: Partial<StuckCall> = { args: { command: 'pnpm test' }, result: 'nope' };
    w.observe(same(other));
    w.observe(same(other));
    expect(w.observe(same(other)).kind).toBe('nudge');
  });

  it('"keep going" on a no-progress card starts the streak again', () => {
    const w = new StuckWatch();
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) seen.push(lastVerdict(turn(w, ['failed'])).kind);
    expect(seen).toContain('ask');
    w.resolve('continue');
    for (let i = 0; i < 4; i += 1) {
      expect(lastVerdict(turn(w, ['failed'])).kind === 'ask').toBe(false);
    }
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ask');
  });

  it('"stop" changes nothing — the loop is ending anyway', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 5; i += 1) w.observe(same());
    expect(() => w.resolve('stop')).not.toThrow();
    expect(typeof w.observe(same()).kind).toBe('string');
  });

  it('guidance from the user clears both counters', () => {
    const w = new StuckWatch();
    w.observe(same());
    w.observe(same());
    turn(w, ['failed']);
    turn(w, ['failed']);
    w.reset();
    expect(w.observe(same()).kind).toBe('ok');
    expect(lastVerdict(turn(w, ['failed'])).kind).toBe('ok');
  });
});

describe('the wording', () => {
  it('never says "the same call repeated" — it names what Plato was doing', () => {
    const note = stuckStopNote({
      kind: 'repeat',
      count: 5,
      call: 'shell: pnpm build',
      lastSuccess: '',
    });
    expect(note).toContain('shell: pnpm build');
    expect(note).toContain('5 times in a row');
    expect(stuckCard({ kind: 'repeat', count: 5, call: 'shell: pnpm build', lastSuccess: '' }).title)
      .toBe('Plato is repeating itself');
  });

  it('says what last worked, so the user can see how far it got', () => {
    const card = stuckCard({
      kind: 'no-progress',
      count: 5,
      failures: 9,
      lastSuccess: 'write_file: src/DateHelper.java',
    });
    expect(card.title).toBe('5 turns in a row have failed');
    expect(card.lines[0]).toContain('9 calls');
    expect(card.lines[1]).toContain('src/DateHelper.java');
  });

  it('says so plainly when nothing has ever worked', () => {
    expect(
      stuckCard({ kind: 'no-progress', count: 5, failures: 3, lastSuccess: '' }).lines[1],
    ).toBe('Nothing has worked yet in this run.');
    expect(stuckStopNote({ kind: 'no-progress', count: 5, failures: 3, lastSuccess: '' })).toContain(
      'Nothing has worked yet in this run.',
    );
  });

  it('gets singular right', () => {
    expect(
      stuckCard({ kind: 'no-progress', count: 5, failures: 1, lastSuccess: '' }).lines[0],
    ).toContain('1 call,');
  });

  it('hands the user guidance to the model when they say keep going', () => {
    const text = continueText(
      { kind: 'repeat', count: 5, call: 'shell: pnpm build', lastSuccess: '' },
      'the lockfile is the problem',
    );
    expect(text).toContain('the lockfile is the problem');
    expect(text).toContain('shell: pnpm build');
  });

  it('the record lines say the wait is happening', () => {
    expect(askNote({ kind: 'repeat', count: 5, call: 'shell: pnpm build', lastSuccess: '' })).toContain(
      'Waiting for you',
    );
    expect(nudgeNote({ kind: 'no-progress', count: 3, lastSuccess: '' })).toContain(
      'asked to try something else',
    );
  });
});

describe('the thresholds are the ones Cline ships', () => {
  it('3 and 5', () => {
    expect(STUCK_NUDGE_AT).toBe(3);
    expect(STUCK_ASK_AT).toBe(5);
  });
});
