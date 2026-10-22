import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { describe, expect, it } from 'vitest';
import { withCloseRejection } from '../src/prompt.js';

describe('a question on readline', () => {
  it('answers when a line arrives', async () => {
    const input = new PassThrough();
    const question = withCloseRejection(createInterface({ input }));
    const pending = question('› ');
    input.write('hello\n');
    await expect(pending).resolves.toBe('hello');
  });

  it('rejects when the input closes first, instead of hanging', async () => {
    const input = new PassThrough();
    const question = withCloseRejection(createInterface({ input }));
    const pending = question('› ');
    input.end();
    await expect(pending).rejects.toThrow('the input closed');
  });
});
