/**
 * Live model discovery (D28): GET {baseUrl}/models works across every
 * OpenAI-compatible endpoint and Anthropic native alike, so users never
 * type model ids. Injected fetch keeps this testable without network.
 *
 * D37: the rich variant `fetchModelPool` opportunistically reads
 * provider-advertised context windows (`max_input_tokens` on Anthropic,
 * `context_length` / `max_completion_tokens` on OpenRouter, etc.). When
 * the provider doesn't expose the field (e.g. plain OpenAI's /models),
 * the corresponding values stay `undefined` and the UI shows "ctx
 * unknown" — never a guess (D26c).
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com/v1';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** One row in the discovered model pool. */
export interface ModelPoolEntry {
  id: string;
  /** Human-friendly name when the provider supplies one. */
  label?: string;
  /** Provider-advertised input context window. Undefined = unknown. */
  maxContext?: number;
  /** Provider-advertised max output tokens. Undefined = unknown. */
  maxOutput?: number;
}

/** Pick the first defined finite number across a set of candidate keys. */
function pickNum(
  rec: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return v;
    }
  }
  return undefined;
}

export async function fetchModelIds(opts: {
  kind: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const pool = await fetchModelPool(opts);
  return pool.map((e) => e.id);
}

/**
 * Rich model discovery: returns the full pool, opportunistically
 * including context-window / max-output numbers when the provider
 * exposes them. Fields stay `undefined` (not guessed) otherwise.
 */
export async function fetchModelPool(opts: {
  kind: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<ModelPoolEntry[]> {
  const doFetch =
    opts.fetchImpl ??
    ((url: string, init: RequestInit) => fetch(url, init));
  let url: string;
  const headers: Record<string, string> = {};
  if (opts.kind === 'anthropic') {
    const base = (opts.baseUrl ?? ANTHROPIC_BASE).replace(/\/$/, '');
    url = `${base}/v1/models`;
    headers['x-api-key'] = opts.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    const base = (opts.baseUrl || OPENAI_BASE).replace(/\/$/, '');
    url = `${base}/models`;
    if (opts.apiKey.length > 0) {
      headers.authorization = `Bearer ${opts.apiKey}`;
    }
  }

  const res = await doFetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`models ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as {
    data?: Record<string, unknown>[];
  };
  const entries: ModelPoolEntry[] = [];
  for (const raw of json.data ?? []) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const rec = raw as Record<string, unknown>;
    const id = rec['id'];
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    // Provider-specific field names; the order reflects which we'd
    // trust most for that slot.
    let maxContext: number | undefined;
    let maxOutput: number | undefined;
    if (opts.kind === 'anthropic') {
      // Anthropic: `max_input_tokens` is the context window,
      // `max_tokens` is the per-call output cap.
      maxContext = pickNum(rec, ['max_input_tokens']);
      maxOutput = pickNum(rec, ['max_tokens']);
    } else {
      // OpenAI-compatible: OpenRouter shape (`context_length`,
      // `top_provider.context_length`) is the common one. Some
      // proxies echo `max_input_tokens` / `max_tokens` instead.
      const top = rec['top_provider'];
      const topRec =
        typeof top === 'object' && top !== null
          ? (top as Record<string, unknown>)
          : undefined;
      maxContext = pickNum(rec, [
        'context_length',
        'max_input_tokens',
        'max_context',
        'max_tokens',
      ]);
      if (maxContext === undefined && topRec) {
        maxContext = pickNum(topRec, ['context_length', 'max_input_tokens']);
      }
      maxOutput = pickNum(rec, [
        'max_output_tokens',
        'max_completion_tokens',
      ]);
      if (maxOutput === undefined && topRec) {
        maxOutput = pickNum(topRec, [
          'max_completion_tokens',
          'max_output_tokens',
        ]);
      }
    }
    const labelRaw = rec['display_name'] ?? rec['name'];
    const entry: ModelPoolEntry = { id };
    if (maxContext !== undefined) {
      entry.maxContext = maxContext;
    }
    if (maxOutput !== undefined) {
      entry.maxOutput = maxOutput;
    }
    if (typeof labelRaw === 'string' && labelRaw.length > 0) {
      entry.label = labelRaw;
    }
    entries.push(entry);
  }
  // Stable, de-duplicated, sorted by id for predictable UI.
  const seen = new Set<string>();
  const out: ModelPoolEntry[] = [];
  for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(e.id)) {
      continue;
    }
    seen.add(e.id);
    out.push(e);
  }
  return out;
}
