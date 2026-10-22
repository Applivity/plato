import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface, type Interface } from 'node:readline/promises';
import type { CliInput } from './io.js';

/**
 * Prompts for `auth login` at M1. The interactive terminal (M3) replaces the
 * SELECT and the secret entry with Ink components; the flow and its questions
 * stay the same.
 */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export interface Prompter {
  /** A visible question with an optional default. */
  ask(question: string, options?: { default?: string }): Promise<string>;
  /** A key: never echoed, and read from a pipe when there is no terminal. */
  secret(question: string): Promise<string>;
}

/**
 * `readline` leaves a pending question unsettled when the input ends, so Ctrl+D
 * or a pipe that runs out hangs the CLI forever. This rejects instead, and the
 * caller treats that as no answer.
 */
export function withCloseRejection(rl: Interface): (question: string) => Promise<string> {
  const closed = new Promise<never>((_, reject) => {
    rl.once('close', () => reject(new Error('the input closed')));
  });
  closed.catch(() => {});
  return async (question) => await Promise.race([rl.question(question), closed]);
}

/** Reads one line from a pipe. Used for the headless login path. */
export async function readLine(input: CliInput): Promise<string> {
  let buffer = '';
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const newline = buffer.indexOf('\n');
    if (newline >= 0) {
      return buffer.slice(0, newline).replace(/\r$/, '');
    }
  }
  return buffer.replace(/\r$/, '');
}

function readHidden(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  question: string,
): Promise<string> {
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  output.write(question);

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (): void => {
      input.setRawMode(false);
      input.pause();
      input.off('keypress', onKeypress);
    };
    const onKeypress = (text: string, key: Key): void => {
      if (key.ctrl && key.name === 'c') {
        finish();
        output.write('\n');
        reject(new CancelledError());
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        output.write('\n');
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (key.ctrl || key.meta) {
        return;
      }
      value += text;
    };
    input.on('keypress', onKeypress);
  });
}

export function createPrompter(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): Prompter {
  return {
    async ask(question, options = {}) {
      const rl = createInterface({ input, output });
      try {
        const answer = (await withCloseRejection(rl)(question)).trim();
        return answer.length > 0 ? answer : (options.default ?? '');
      } finally {
        rl.close();
      }
    },
    async secret(question) {
      if (input.isTTY !== true) {
        return await readLine(input);
      }
      return await readHidden(input, output, question);
    },
  };
}
