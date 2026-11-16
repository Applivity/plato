/**
 * Leaves the drawing, lets a command own the terminal, and comes back.
 *
 * Ink keeps its input listener on standard input, so the stream is paused
 * while the command reads and the terminal is put back in line mode. The next
 * render redraws the frame below the transcript the command left behind.
 * `/model add` uses this now; a later shortcut needs the same pause.
 */
export interface TerminalFrame {
  /** Erases the live frame, so the command starts on clean lines. */
  clear(): void;
  /** Draws the frame again after the command returns. */
  redraw(): void;
}

export async function withSuspendedTerminal(
  frame: TerminalFrame,
  input: NodeJS.ReadStream,
  run: () => Promise<void>,
): Promise<void> {
  frame.clear();
  process.stdout.write('\n');
  const tty =
    input.isTTY === true && typeof input.setRawMode === 'function' ? input : null;
  input.pause();
  if (tty !== null) {
    tty.setRawMode(false);
  }
  try {
    await run();
  } finally {
    if (tty !== null) {
      tty.setRawMode(true);
    }
    input.resume();
    frame.redraw();
  }
}
