import { describe, expect, it } from 'vitest';
import { nextQueued } from '../src/runtime/queue.js';
import type { RunEndReason } from '../src/runtime/bus.js';

/**
 * D49bo. The rule the whole feature turns on: a queued follow-up is sent when a
 * run FINISHED, and held whenever the run stopped for any other reason. Every
 * case here is a way a run can end, so a future reason added to `RunEndReason`
 * that nothing thought about holds the queue rather than draining it.
 */
describe('nextQueued (D49bo)', () => {
  const queue = ['first', 'second'];

  it('sends the head of the queue when the run completed', () => {
    expect(nextQueued(queue, 'complete')).toBe('first');
  });

  it('sends the head when the run stopped on the token cap', () => {
    // A capped run got as far as it could; the user still wants the next thing.
    expect(nextQueued(queue, 'cap')).toBe('first');
  });

  it('holds when the user cancelled the run', () => {
    // Starting the next item straight after a stop would take the stop back.
    expect(nextQueued(queue, 'cancelled')).toBeNull();
  });

  it('holds when the run was stuck', () => {
    // The next item would be handed to the same loop that could not escape.
    expect(nextQueued(queue, 'stuck')).toBeNull();
  });

  it('holds when the run failed outright', () => {
    // No reason means the provider threw. Draining would burn every queued
    // message against the same broken connection, one run at a time.
    expect(nextQueued(queue, null)).toBeNull();
  });

  it('returns nothing at all for an empty queue, whatever the reason', () => {
    const reasons: (RunEndReason | null)[] = [
      'complete',
      'cap',
      'cancelled',
      'stuck',
      null,
    ];
    for (const r of reasons) {
      expect(nextQueued([], r)).toBeNull();
    }
  });

  it('takes the head only — it never reorders or mutates what it is given', () => {
    const q = ['first', 'second'];
    nextQueued(q, 'complete');
    expect(q).toEqual(['first', 'second']);
  });
});
