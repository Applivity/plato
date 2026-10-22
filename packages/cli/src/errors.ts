/** A failure the user can act on. `usage` selects exit code 2. */
export class HostError extends Error {
  constructor(
    message: string,
    readonly usage = false,
  ) {
    super(message);
    this.name = 'HostError';
  }
}
