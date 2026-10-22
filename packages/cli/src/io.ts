/** Streams and input, separated from `cli.ts` so commands can import them. */
export interface Streams {
  out(text: string): void;
  err(text: string): void;
}

/**
 * The input the CLI reads from. `process.stdin` fits; a test can pass
 * `Readable.from(['key\n'])`, whose `isTTY` is simply absent.
 */
export interface CliInput extends AsyncIterable<string | Buffer> {
  isTTY?: boolean;
}
