import { describe, expect, it } from 'vitest';
import {
  IdleFold,
  IDLE_FOLD_AFTER_MS,
  IDLE_FOLD_MIN_TOKENS,
} from '../src/runtime/idleFold.js';

/**
 * D49cm (2026-11-12): compaction while the chat sits idle, behind a setting
 * and OFF by default. Claude Code's two numbers are mirrored exactly; the rule
 * is tested with an injected timer so no hour passes in the suite.
 */
function harness(over: Partial<{
  enabled: boolean;
  tokens: number;
  busy: boolean;
  fold: () => Promise<void>;
}> = {}) {
  const state = {
    enabled: over.enabled ?? true,
    tokens: over.tokens ?? IDLE_FOLD_MIN_TOKENS,
    busy: over.busy ?? false,
    folds: 0,
    errors: 0,
  };
  let due: (() => void) | null = null;
  let delay = -1;
  let cleared = 0;
  const idle = new IdleFold({
    enabled: () => state.enabled,
    tokens: () => state.tokens,
    busy: () => state.busy,
    fold: async () => {
      state.folds += 1;
      if (over.fold) await over.fold();
    },
    onError: () => {
      state.errors += 1;
    },
    setTimer: (fn, ms) => {
      due = fn;
      delay = ms;
      return 1;
    },
    clearTimer: () => {
      cleared += 1;
      due = null;
    },
  });
  return {
    idle,
    state,
    get delay() { return delay; },
    get cleared() { return cleared; },
    get due() { return due; },
    fire() { due?.(); },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('IdleFold (D49cm)', () => {
  it('mirrors Claude Code: one hour and 200,000 tokens', () => {
    expect(IDLE_FOLD_AFTER_MS).toBe(60 * 60 * 1000);
    expect(IDLE_FOLD_MIN_TOKENS).toBe(200_000);
    const h = harness();
    h.idle.schedule();
    expect(h.delay).toBe(IDLE_FOLD_AFTER_MS);
  });

  it('folds when the setting is on and both conditions hold', async () => {
    const h = harness();
    h.idle.schedule();
    h.fire();
    await tick();
    expect(h.state.folds).toBe(1);
  });

  it('does nothing when the setting is off', async () => {
    const h = harness({ enabled: false });
    h.idle.schedule();
    h.fire();
    await tick();
    expect(h.state.folds).toBe(0);
  });

  it('does nothing under the token floor', async () => {
    const h = harness({ tokens: IDLE_FOLD_MIN_TOKENS - 1 });
    h.idle.schedule();
    h.fire();
    await tick();
    expect(h.state.folds).toBe(0);
  });

  it('does nothing while a run, approval or question is pending', async () => {
    const h = harness({ busy: true });
    h.idle.schedule();
    h.fire();
    await tick();
    expect(h.state.folds).toBe(0);
  });

  it('re-checks every condition at the moment it fires', async () => {
    const h = harness();
    h.idle.schedule();
    // The setting was turned off, or a message arrived, after the clock began.
    h.state.enabled = false;
    h.fire();
    await tick();
    expect(h.state.folds).toBe(0);
  });

  it('cancelling a pending fold means it never happens', async () => {
    const h = harness();
    h.idle.schedule();
    h.idle.cancel();
    expect(h.cleared).toBe(1);
    expect(h.due).toBeNull();
    await tick();
    expect(h.state.folds).toBe(0);
  });

  it('a second schedule replaces the first', () => {
    const h = harness();
    h.idle.schedule();
    const first = h.due;
    h.idle.schedule();
    expect(h.cleared).toBe(1);
    expect(h.due).not.toBe(first);
  });

  it('a failed fold is swallowed and leaves the caller able to retry', async () => {
    let calls = 0;
    const h = harness({
      fold: async () => {
        calls += 1;
        if (calls === 1) throw new Error('provider down');
      },
    });
    h.idle.schedule();
    h.fire();
    await tick();
    await tick();
    expect(h.state.errors).toBe(1);
    // The next run end schedules again; nothing is left stuck.
    h.idle.schedule();
    h.fire();
    await tick();
    expect(h.state.folds).toBe(2);
  });
});
