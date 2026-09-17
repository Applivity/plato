/**
 * D49f: retry a provider call.
 *
 * Before this there was **no retry anywhere in the repo** — a single 429 or a
 * dropped socket ended the run and lost the work up to that turn. The HTTP
 * status carried by `ProviderError` (D49d) is what decides retryability.
 *
 * **Where this is applied, and why not everywhere.** Only the loop's worker turn
 * is wrapped. Compaction and the observer call `completeTurn` directly and both
 * already degrade gracefully — a failed compaction emits a notice and continues,
 * a failed observation degrades to `noop` — so neither can kill a run, and
 * wrapping them would add a second, silently different retry budget.
 */
import { ProviderError } from './errors.js';

export interface RetryPolicy {
  /** Total attempts, including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Stop once this much wall-clock has passed, even with attempts left. */
  maxElapsedMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  maxElapsedMs: 90_000,
};

/**
 * Retry only what a second attempt can plausibly fix. Any other 4xx means the
 * request itself is wrong — a bad key (401), an unknown model (404), a malformed
 * body (400) — and repeating it burns time and money for the same answer.
 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ProviderError)) {
    return false;
  }
  if (e.status === null) {
    return true; // transport failure: DNS, reset socket, timeout
  }
  if (e.status === 429) {
    return true;
  }
  return e.status >= 500 && e.status <= 599;
}

export interface RetryAttempt {
  /** The attempt that just failed, 1-based. */
  attempt: number;
  /** How long we will wait before the next one. */
  delayMs: number;
  /** A short phrase for the user, e.g. "rate limited". */
  reason: string;
}

export interface RetryOptions {
  policy?: RetryPolicy;
  onRetry?: (info: RetryAttempt) => void;
  /** Injected so a test does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function retryReason(e: unknown): string {
  if (e instanceof ProviderError) {
    if (e.status === 429) {
      return 'rate limited';
    }
    if (e.status === null) {
      return 'connection failed';
    }
    return `HTTP ${e.status}`;
  }
  return 'provider error';
}

/**
 * Runs `fn`, retrying a retryable failure until the policy is exhausted.
 * Resolves with `fn`'s value, or throws the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const policy = opts.policy ?? DEFAULT_RETRY;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const started = now();

  let last: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryable(e) || attempt === policy.attempts) {
        throw e;
      }

      // Prefer the provider's own instruction — it knows when it will accept
      // work again, and guessing wastes an attempt.
      const wanted =
        (e instanceof ProviderError ? e.retryAfterMs : null) ??
        policy.baseDelayMs * 2 ** (attempt - 1);
      const capped = Math.min(policy.maxDelayMs, wanted);
      // Full jitter: runs throttled together must not come back in lockstep and
      // be throttled together again.
      const delayMs = Math.max(0, Math.round(capped * (0.5 + random() * 0.5)));

      // Do not start a wait that would run past the budget.
      if (now() - started + delayMs > policy.maxElapsedMs) {
        throw e;
      }

      opts.onRetry?.({ attempt, delayMs, reason: retryReason(e) });
      await sleep(delayMs);
    }
  }
  /* istanbul ignore next — the loop returns or throws. */
  throw last;
}
