/**
 * Live model discovery (D28): GET {baseUrl}/models works across every
 * OpenAI-compatible endpoint and Anthropic native alike, so users never
 * type model ids. Injected fetch keeps this testable without network.
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com/v1';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchModelIds(opts: {
  kind: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
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
    data?: { id?: unknown }[];
  };
  const ids = (json.data ?? [])
    .map((m) => m.id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(ids)].sort();
}
