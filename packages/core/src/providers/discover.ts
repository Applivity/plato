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

/**
 * D49t: every positive candidate across several records, smallest first.
 *
 * When two places disagree about a context window, take the SMALLER. That is not
 * arbitrary: the two ways to be wrong are not symmetric. Too small means
 * summarising earlier than needed — degraded but working. Too large means
 * sending more than the model can hold — and on the most common local servers
 * that does not error, it TRUNCATES SILENTLY, which is the exact failure this
 * number exists to prevent. So the conservative direction is the only safe one.
 *
 * OpenRouter is the concrete case: `context_length` is a ceiling across every
 * endpoint serving that model, while `top_provider.context_length` is the route
 * actually being used and can be far smaller.
 */
function minNum(records: (Record<string, unknown> | undefined)[], keys: string[]): number | undefined {
  let best: number | undefined;
  for (const rec of records) {
    if (!rec) continue;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        best = best === undefined ? v : Math.min(best, v);
      }
    }
  }
  return best;
}

/**
 * D49t: LiteLLM's richer model list, which is where it actually reports window
 * sizes. `/v1/models` does not carry them (LiteLLM issue #25293); `/model/info`
 * does, as `data[].model_info.max_input_tokens` / `max_output_tokens`.
 *
 * **Best-effort by design.** It sits on LiteLLM's management routes, so a
 * restricted virtual key can be refused — an error here must never fail the
 * discovery it is decorating, and a shape we do not recognise is simply ignored.
 * Returns `id -> {context, output}` for the ids we could match.
 */
async function fetchLiteLlmModelInfo(
  base: string,
  apiKey: string,
  doFetch: FetchLike,
): Promise<Map<string, { context?: number; output?: number }>> {
  const out = new Map<string, { context?: number; output?: number }>();
  const headers: Record<string, string> = {};
  if (apiKey.length > 0) headers.authorization = `Bearer ${apiKey}`;
  // The base may or may not already end in /v1; LiteLLM serves both spellings.
  const urls = base.endsWith('/v1')
    ? [`${base}/model/info`]
    : [`${base}/model/info`, `${base}/v1/model/info`];
  for (const url of urls) {
    try {
      const res = await doFetch(url, { method: 'GET', headers });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data)) continue;
      for (const raw of json.data) {
        if (typeof raw !== 'object' || raw === null) continue;
        const rec = raw as Record<string, unknown>;
        const info = rec['model_info'];
        const infoRec =
          typeof info === 'object' && info !== null
            ? (info as Record<string, unknown>)
            : undefined;
        // `model_name` is the public (group) name the user selects; some builds
        // also expose the underlying id.
        const name = rec['model_name'] ?? infoRec?.['id'] ?? rec['id'];
        if (typeof name !== 'string' || name.length === 0) continue;
        const context = minNum([infoRec, rec], ['max_input_tokens']);
        const output = minNum([infoRec, rec], ['max_output_tokens']);
        if (context === undefined && output === undefined) continue;
        out.set(name, {
          ...(context !== undefined ? { context } : {}),
          ...(output !== undefined ? { output } : {}),
        });
      }
      if (out.size > 0) return out;
    } catch {
      // Refused, offline, or a non-JSON body: this is a bonus, not a dependency.
    }
  }
  return out;
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
  // D49t: kept so the LiteLLM enrichment below can reach the same host.
  let openAiBase: string | undefined;
  const headers: Record<string, string> = {};
  if (opts.kind === 'anthropic') {
    const base = (opts.baseUrl ?? ANTHROPIC_BASE).replace(/\/$/, '');
    url = `${base}/v1/models`;
    headers['x-api-key'] = opts.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    const base = (opts.baseUrl || OPENAI_BASE).replace(/\/$/, '');
    openAiBase = base;
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
    // Provider-specific field names. Only genuinely-window fields are accepted
    // as the window — see the `max_tokens` note below.
    let maxContext: number | undefined;
    let maxOutput: number | undefined;
    if (opts.kind === 'anthropic') {
      // Anthropic: `max_input_tokens` is the context window,
      // `max_tokens` is the per-call output cap.
      maxContext = pickNum(rec, ['max_input_tokens']);
      maxOutput = pickNum(rec, ['max_tokens']);
    } else {
      // D49t: `max_tokens` used to be accepted here as a WINDOW. It is not one —
      // it is the output cap — so a proxy echoing `max_tokens: 4096` had Plato
      // record 4096 as the model's whole memory. That was harmless while the
      // number only decorated a label; it becomes a fault the moment the number
      // drives compaction, which is what D49t does. Removed, not reordered.
      //
      // `max_model_len` is vLLM's field on the same endpoint: the window it is
      // ACTUALLY serving, already lowered by the operator to fit VRAM.
      const top = rec['top_provider'];
      const topRec =
        typeof top === 'object' && top !== null
          ? (top as Record<string, unknown>)
          : undefined;
      maxContext = minNum(
        [rec, topRec],
        ['context_length', 'max_input_tokens', 'max_context', 'max_model_len'],
      );
      maxOutput = minNum(
        [rec, topRec],
        ['max_output_tokens', 'max_completion_tokens'],
      );
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

  // D49t: LiteLLM reports window sizes on /model/info, not on /models. Enrich
  // rather than replace — and again take the SMALLER of the two, for the reason
  // spelled out on minNum.
  if (opts.kind === 'openai' && openAiBase !== undefined && out.length > 0) {
    const info = await fetchLiteLlmModelInfo(openAiBase, opts.apiKey, doFetch);
    if (info.size > 0) {
      for (const e of out) {
        const got = info.get(e.id);
        if (!got) continue;
        if (got.context !== undefined) {
          e.maxContext =
            e.maxContext === undefined
              ? got.context
              : Math.min(e.maxContext, got.context);
        }
        if (got.output !== undefined) {
          e.maxOutput =
            e.maxOutput === undefined
              ? got.output
              : Math.min(e.maxOutput, got.output);
        }
      }
    }
  }
  return out;
}
