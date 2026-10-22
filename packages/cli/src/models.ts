import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchModelPool, type ModelPoolEntry } from '@applivity/plato-core';
import { loadConfig, type ConnectionConfig } from './config.js';
import { modelCachePath, type Env } from './paths.js';
import { readAuthFile, resolveKey, type Keychain, type StoredKeys } from './keys.js';
import type { Streams } from './io.js';

/** D49t's number, applied to the CLI: a discovered list is trusted for a day. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  baseUrl?: string;
  at: number;
  pool: ModelPoolEntry[];
}

export type ModelCache = Record<string, CacheEntry>;

export function readModelCache(env: Env = process.env): ModelCache {
  let text: string;
  try {
    text = readFileSync(modelCachePath(env), 'utf8');
  } catch {
    return {};
  }
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return {};
    }
    const cache: ModelCache = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const record = value as Record<string, unknown>;
      const at = record['at'];
      const pool = record['pool'];
      if (typeof at !== 'number' || !Array.isArray(pool)) {
        continue;
      }
      const entries: ModelPoolEntry[] = [];
      for (const item of pool as unknown[]) {
        if (typeof item !== 'object' || item === null) {
          continue;
        }
        const row = item as Record<string, unknown>;
        if (typeof row['id'] !== 'string' || row['id'].length === 0) {
          continue;
        }
        const entry: ModelPoolEntry = { id: row['id'] };
        if (typeof row['label'] === 'string') {
          entry.label = row['label'];
        }
        if (typeof row['maxContext'] === 'number') {
          entry.maxContext = row['maxContext'];
        }
        if (typeof row['maxOutput'] === 'number') {
          entry.maxOutput = row['maxOutput'];
        }
        entries.push(entry);
      }
      cache[id] = {
        at,
        pool: entries,
        ...(typeof record['baseUrl'] === 'string' ? { baseUrl: record['baseUrl'] } : {}),
      };
    }
    return cache;
  } catch {
    return {};
  }
}

function writeModelCache(cache: ModelCache, env: Env): void {
  // A cache is a convenience. A read-only home directory must not stop a list.
  try {
    const path = modelCachePath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Ignored on purpose.
  }
}

export interface PoolOptions {
  env?: Env;
  keychain?: Keychain | null;
  auth?: StoredKeys;
  fetchImpl?: typeof fetch;
  now?: number;
  refresh?: boolean;
  cache?: ModelCache;
}

export interface PoolResult {
  pool: ModelPoolEntry[];
  at: number;
  cached: boolean;
}

/**
 * The models a connection offers, from the 24-hour cache or from the endpoint.
 * The key is resolved through the same chain as a run, so `models` proves the
 * key works before the first task does.
 */
export async function modelPool(
  connection: ConnectionConfig,
  options: PoolOptions = {},
): Promise<PoolResult> {
  const env = options.env ?? process.env;
  const cache = options.cache ?? readModelCache(env);
  const now = options.now ?? Date.now();
  const hit = cache[connection.id];
  if (
    options.refresh !== true &&
    hit !== undefined &&
    hit.baseUrl === connection.baseUrl &&
    now - hit.at < CACHE_TTL_MS
  ) {
    return { pool: hit.pool, at: hit.at, cached: true };
  }

  const key = await resolveKey(connection, {
    env,
    keychain: options.keychain,
    auth: options.auth,
  });

  let pool: ModelPoolEntry[];
  try {
    pool = await fetchModelPool({
      kind: connection.kind,
      apiKey: key?.key ?? '',
      baseUrl: connection.baseUrl,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint =
      key === null && /\b401\b/.test(message)
        ? ` No key was found; run 'plato auth login ${connection.id}'.`
        : '';
    throw new Error(`Cannot list models for ${connection.id}: ${message}.${hint}`);
  }

  writeModelCache(
    {
      ...cache,
      [connection.id]: {
        at: now,
        pool,
        ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
      },
    },
    env,
  );
  return { pool, at: now, cached: false };
}

export interface ModelsContext {
  env: Env;
  streams: Streams;
  keychain?: Keychain | null;
  fetchImpl?: typeof fetch;
  now?: number;
}

export const MODELS_HELP = `Usage
  plato models [connection] [--refresh]

  List the models each connection offers, as 'connection:model'.
  The list is cached for 24 hours; --refresh asks the endpoint again.
`;

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseModelsArgs(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      refresh: { type: 'boolean' },
    },
  });
}

export async function runModels(
  args: readonly string[],
  context: ModelsContext,
): Promise<number> {
  let parsed: ReturnType<typeof parseModelsArgs>;
  try {
    parsed = parseModelsArgs(args);
  } catch (error) {
    context.streams.err(`plato models: ${(error as Error).message}\n`);
    return 2;
  }
  if (parsed.values.help === true) {
    context.streams.out(MODELS_HELP);
    return 0;
  }

  const config = loadConfig(context.env);
  const wanted = parsed.positionals;
  const targets: ConnectionConfig[] = [];
  for (const id of wanted) {
    const connection = config.connections.find((c) => c.id === id);
    if (connection === undefined) {
      context.streams.err(`plato models: no connection named '${id}'.\n`);
      return 2;
    }
    targets.push(connection);
  }
  const selected = targets.length > 0 ? targets : config.connections;

  if (selected.length === 0) {
    context.streams.out("No connections. Run 'plato auth login'.\n");
    return 0;
  }

  const auth = readAuthFile(context.env);
  let failed = false;
  for (const connection of selected) {
    let result: PoolResult;
    try {
      result = await modelPool(connection, {
        env: context.env,
        keychain: context.keychain,
        auth,
        fetchImpl: context.fetchImpl,
        now: context.now,
        refresh: parsed.values.refresh === true,
      });
    } catch (error) {
      context.streams.err(`plato: ${(error as Error).message}\n`);
      failed = true;
      continue;
    }

    if (result.pool.length === 0) {
      context.streams.out(`${connection.id}: the endpoint returned no models.\n`);
      continue;
    }

    const rows = result.pool.map((entry) => ({
      ref: `${connection.id}:${entry.id}`,
      context: entry.maxContext,
      output: entry.maxOutput,
    }));
    const width = Math.max(...rows.map((row) => row.ref.length));
    for (const row of rows) {
      const limits = [
        row.context === undefined ? 'ctx unknown' : `ctx ${withCommas(row.context)}`,
        row.output === undefined ? undefined : `out ${withCommas(row.output)}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join('  ');
      context.streams.out(`${row.ref.padEnd(width)}  ${limits}\n`);
    }
    if (result.cached) {
      context.streams.err(
        `${connection.id}: cached list from ${new Date(result.at).toISOString()}; use --refresh to update.\n`,
      );
    }
  }
  return failed ? 1 : 0;
}
