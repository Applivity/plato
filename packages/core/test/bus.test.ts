import { describe, expect, it, vi } from 'vitest';
import { AgentBus, RunController } from '../src/runtime/bus.js';
import type { AgentEvent } from '../src/runtime/bus.js';

const started = (runId = 'r1'): AgentEvent => ({
  type: 'run-started',
  runId,
  task: 't',
  model: 'm',
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
