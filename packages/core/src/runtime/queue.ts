import type { RunEndReason } from './bus.js';

/**
 * D49bo: which queued follow-up, if any, is sent when a run ends.
 *
 * A run can end four ways, and only two of them mean "the work is finished, so
 * the next thing is wanted". The other two hold, and so does a run that failed
 * outright (`null`):
 *
 *  - `cancelled` — the user just asked Plato to stop. Starting the next item a
 *    moment later takes that back without being asked.
 *  - `stuck` — the model could not get out of a loop. The next item would be
 *    handed to the same loop.
 *  - no reason at all — the provider failed, so every queued message would be
 *    burned against the same broken connection, one run at a time.
 *
 * The first version of this rule was "advance unless cancelled", and that is
 * not enough: it lets a dead provider eat a queue of five.
 *
 * Pure: it neither reads nor writes the queue, and the caller owns the state.
 * Returning the item rather than an index keeps the decision testable without a
 * host, which is the whole reason it lives in core and not in the shell.
 */
export function nextQueued(
  queue: readonly string[],
  reason: RunEndReason | null,
): string | null {
  const next = queue[0];
  if (next === undefined) return null;
  return reason === 'complete' || reason === 'cap' ? next : null;
}
