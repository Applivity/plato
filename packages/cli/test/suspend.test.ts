import { describe, expect, it } from 'vitest';
import { withSuspendedTerminal } from '../src/suspend.js';

describe('withSuspendedTerminal', () => {
  it('unmounts before the command and mounts after it', async () => {
    const order: string[] = [];
    const frame = {
      unmount: () => order.push('unmount'),
      mount: () => order.push('mount'),
    };
    await withSuspendedTerminal(frame, async () => {
      order.push('run');
    });
    expect(order).toEqual(['unmount', 'run', 'mount']);
  });

  it('mounts again even when the command throws', async () => {
    const order: string[] = [];
    const frame = {
      unmount: () => order.push('unmount'),
      mount: () => order.push('mount'),
    };
    await expect(
      withSuspendedTerminal(frame, async () => {
        throw new Error('editor failed');
      }),
    ).rejects.toThrow('editor failed');
    expect(order).toEqual(['unmount', 'mount']);
  });
});
