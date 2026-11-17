/**
 * Leaves the terminal to a command and comes back.
 *
 * The Ink instance is fully unmounted first, so no frame can be drawn while the
 * command owns the terminal; the caller renders again in `mount`. Setup does
 * NOT use this — it is an Ink screen of its own — but an external editor
 * (Ctrl+G) needs exactly this.
 */
export interface TerminalFrame {
  /** Removes the Ink instance and restores the terminal to line mode. */
  unmount(): void;
  /** Renders the app again, after the command has finished. */
  mount(): void;
}

export async function withSuspendedTerminal(
  frame: TerminalFrame,
  run: () => Promise<void>,
): Promise<void> {
  frame.unmount();
  try {
    await run();
  } finally {
    frame.mount();
  }
}
