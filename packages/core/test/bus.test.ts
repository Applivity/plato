import { describe, expect, it, vi } from 'vitest';
import { AgentBus, RunController } from '../src/runtime/bus.js';
import type { AgentEvent } from '../src/runtime/bus.js';

const started = (runId = 'r1'): AgentEvent => ({
  type: 'run-started',
  runId,
  task: 't',
  model: 'm',
  mode: 'edit',
});

describe('AgentBus', () => {
  it('delivers events to every listener in order', () => {
    const bus = new AgentBus();
    const seen: string[] = [];
    bus.on((e) => seen.push(`a:${e.type}`));
    bus.on((e) => seen.push(`b:${e.type}`));
    bus.emit(started());
    expect(seen).toEqual(['a:run-started', 'b:run-started']);
  });

  it('isolates a throwing listener so others still run', () => {
    const bus = new AgentBus();
    const good = vi.fn();
    bus.on(() => {
      throw new Error('observer exploded');
    });
    bus.on(good);
    expect(() => bus.emit(started())).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops delivery', () => {
    const bus = new AgentBus();
    const fn = vi.fn();
    const off = bus.on(fn);
    off();
    bus.emit(started());
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('RunController', () => {
  it('drains guidance FIFO and clears the queue', () => {
    const c = new RunController();
    c.sendGuidance('first');
    c.sendGuidance('second');
    c.sendGuidance('   '); // whitespace-only is dropped
    expect(c.drainGuidance()).toEqual(['first', 'second']);
    expect(c.drainGuidance()).toEqual([]);
  });

  it('gate resolves true immediately when idle', async () => {
    const c = new RunController();
    await expect(c.gate()).resolves.toBe(true);
  });

  it('gate blocks while paused and resumes', async () => {
    const c = new RunController();
    c.pause();
    let result: boolean | null = null;
    const p = c.gate().then((v) => {
      result = v;
      return v;
    });
    await Promise.resolve(); // let gate() reach its wait
    expect(result).toBeNull(); // still blocked
    c.resume();
    await expect(p).resolves.toBe(true);
  });

  it('cancel breaks a pause immediately with false', async () => {
    const c = new RunController();
    c.pause();
    const p = c.gate();
    c.cancel();
    await expect(p).resolves.toBe(false);
  });

  it('cancel makes an idle gate return false once', async () => {
    const c = new RunController();
    c.cancel();
    await expect(c.gate()).resolves.toBe(false);
  });
});

/**
 * D49bm. `pause()` states a request; only `gate()` knows the run has stopped.
 * These pin the two edges, because a UI that flips its own button on the click
 * claims the run is paused while nothing has looked at the flag yet — and the
 * loop may never look at all.
 */
describe('RunController park signal (D49bm)', () => {
  /** Lets every pending microtask run, so the loop has re-entered its wait. */
  const tick = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

  it('announces the park, then the release, exactly once each', async () => {
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    c.pause();
    const p = c.gate();
    // Entering the wait announces synchronously, so the button can stop saying
    // "paused" the instant the run is not.
    expect(seen).toEqual([true]);
    c.resume();
    await expect(p).resolves.toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('announces nothing when the loop never parks', async () => {
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    await expect(c.gate()).resolves.toBe(true);
    expect(seen).toEqual([]);
  });

  it('announces nothing when a pause is requested and released before any gate', async () => {
    // This is the core-level shape of "the run finished before the pause took
    // effect": the request existed, the loop never looked, and no lie is told.
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    c.pause();
    c.resume();
    await expect(c.gate()).resolves.toBe(true);
    expect(seen).toEqual([]);
  });

  it('releases the park when the run is cancelled instead of resumed', async () => {
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    c.pause();
    const p = c.gate();
    expect(seen).toEqual([true]);
    c.cancel();
    await expect(p).resolves.toBe(false);
    // The run is over, so nothing is parked any more — the UI must be told.
    expect(seen).toEqual([true, false]);
  });

  it('a second resume announces only the one release', async () => {
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    c.pause();
    const p = c.gate();
    c.resume();
    c.resume(); // inert: there is no waiter left
    await expect(p).resolves.toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('a pause re-requested inside one wait does not announce a second park', async () => {
    const seen: boolean[] = [];
    const c = new RunController({ onPark: (p) => seen.push(p) });
    c.pause();
    const p = c.gate();
    c.resume();
    c.pause(); // re-requested before the loop wakes
    await tick();
    expect(seen).toEqual([true]); // still parked — it never left
    c.resume();
    await expect(p).resolves.toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('a throwing listener does not reject gate — the controller is as isolated as the bus', async () => {
    const c = new RunController({
      onPark: () => {
        throw new Error('the UI exploded');
      },
    });
    c.pause();
    const p = c.gate();
    c.resume();
    // Without the guard inside notify() this rejects, and a broken UI callback
    // would kill the very run it was trying to report on.
    await expect(p).resolves.toBe(true);
  });
});
