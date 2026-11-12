/**
 * D49cm (2026-11-12): compaction while the chat sits idle.
 *
 * The founder's decision: add Claude Code's idle compaction, but behind a
 * setting and OFF by default — it summarises BELOW the user's threshold, which
 * is exactly the surprise the memory fold was fixed to stop. A user who turns
 * it on has asked for it.
 *
 * The two numbers are Claude Code's, mirrored exactly, and named here rather
 * than buried in the shell because the shell has no unit tests:
 *
 *   - one hour of no activity;
 *   - at least 200,000 estimated tokens of history.
 *
 * Both must hold, the setting must be on, and nothing may be running or
 * waiting (a run, an approval, a question, a stuck prompt). The timer is
 * cancellable: a new message, a new chat, or switching the setting off means
 * the pending fold does not happen.
 *
 * The clock and the timers are injected so the rule can be tested without an
 * hour passing.
 */
export const IDLE_FOLD_AFTER_MS = 60 * 60 * 1000;
export const IDLE_FOLD_MIN_TOKENS = 200_000;

export interface IdleFoldOptions {
  /** Read at fire time, so turning the setting off cancels the effect. */
  enabled: () => boolean;
  /** Estimated tokens in the history the model would be sent. */
  tokens: () => number;
  /** True while a run, an approval, a question or a stuck prompt is pending. */
  busy: () => boolean;
  /** The fold itself; the host supplies it. */
  fold: () => Promise<void>;
  afterMs?: number;
  minTokens?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (e: unknown) => void;
}

/** One pending idle fold, never two. */
export class IdleFold {
  private handle: unknown = null;

  constructor(private readonly opts: IdleFoldOptions) {}

  /** (Re)start the idle clock. Calling it again replaces the pending fold. */
  schedule(): void {
    this.cancel();
    const set =
      this.opts.setTimer ??
      ((fn: () => void, ms: number): unknown => {
        const h = setTimeout(fn, ms);
        // A pending fold is not a reason to keep the process alive.
        (h as { unref?: () => void }).unref?.();
        return h;
      });
    const after = this.opts.afterMs ?? IDLE_FOLD_AFTER_MS;
    this.handle = set(() => {
      this.handle = null;
      void this.fire();
    }, after);
  }

  /** The conversation changed, or the chat ended: no fold from the old clock. */
  cancel(): void {
    if (this.handle === null) return;
    const clear =
      this.opts.clearTimer ??
      ((h: unknown): void => clearTimeout(h as NodeJS.Timeout));
    clear(this.handle);
    this.handle = null;
  }

  /** The timer fired. Every condition is re-checked at THIS moment. */
  async fire(): Promise<void> {
    if (!this.opts.enabled()) return;
    if (this.opts.busy()) return;
    if (this.opts.tokens() < (this.opts.minTokens ?? IDLE_FOLD_MIN_TOKENS)) {
      return;
    }
    try {
      await this.opts.fold();
    } catch (e) {
      // A failure leaves the log untouched; the next run end reschedules.
      this.opts.onError?.(e);
    }
  }
}
