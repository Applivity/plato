/**
 * D49d: one error shape for every provider failure.
 *
 * The two adapters surfaced failures differently — the OpenAI-compatible path
 * threw a formatted string, the Anthropic path let the SDK's error escape raw —
 * and the shell then discarded whichever it received and showed a fixed
 * sentence ("Check the API key and network") for a 401, a 429 and a dead socket
 * alike. A typed error keeps the status code available for the retry policy and
 * lets the UI report what actually went wrong.
 */

export class ProviderError extends Error {
  constructor(
    /** HTTP status, or null for a transport failure (DNS, socket, abort). */
    readonly status: number | null,
    /** The provider's own message, already trimmed to a sane length. */
    readonly detail: string,
    /** Which adapter produced it, e.g. 'anthropic'. */
    readonly provider: string,
  ) {
    super(ProviderError.describe(status, detail, provider));
    this.name = 'ProviderError';
  }

  private static describe(
    status: number | null,
    detail: string,
    provider: string,
  ): string {
    const head =
      status === null ? `${provider} request failed` : `${provider} HTTP ${status}`;
    return detail.length > 0 ? `${head}: ${detail}` : head;
  }
}

/** A one-line, user-facing summary of any thrown value. */
export function describeError(e: unknown): string {
  if (e instanceof ProviderError) {
    return e.status === 429
      ? 'Rate limited by the provider. Wait a moment, or switch model.'
      : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Wraps an unknown value thrown by a provider call. The Anthropic SDK throws
 * `APIError` with a numeric `.status`; `fetch` rejects with a TypeError for a
 * transport failure, which has no status. Anything already typed passes through.
 */
export function toProviderError(e: unknown, provider: string): ProviderError {
  if (e instanceof ProviderError) {
    return e;
  }
  let status: number | null = null;
  if (typeof e === 'object' && e !== null && 'status' in e) {
    const s = (e as { status: unknown }).status;
    if (typeof s === 'number' && Number.isFinite(s)) {
      status = s;
    }
  }
  const raw = e instanceof Error ? e.message : String(e);
  return new ProviderError(status, raw.slice(0, 300), provider);
}
