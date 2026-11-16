import { modelPool, readModelCache } from './models.js';
import type { PlatoConfig } from './config.js';
import type { Env } from './paths.js';

/**
 * What each connection can offer, for the shell command and the session
 * picker. A connection that cannot list its models right now keeps the ones
 * already known, with a plain note — an empty list would hide a working model.
 */
export interface ConnectionModels {
  id: string;
  models: string[];
  /** Said in the picker, in plain words. */
  note?: string;
}

export async function connectionModels(
  config: PlatoConfig,
  options: { env: Env; fetchImpl?: typeof fetch },
): Promise<ConnectionModels[]> {
  const found: ConnectionModels[] = [];
  for (const connection of config.connections) {
    try {
      const pool = await modelPool(connection, {
        env: options.env,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
      found.push({ id: connection.id, models: pool.pool.map((entry) => entry.id) });
    } catch {
      const cached = readModelCache(options.env)[connection.id];
      const known = cached?.pool.map((entry) => entry.id) ?? [];
      found.push({
        id: connection.id,
        models: known,
        note:
          known.length > 0
            ? 'could not list its models just now; these are the ones already known'
            : 'did not answer, so no models are known yet',
      });
    }
  }
  return found;
}

/** Every model as `connection:model`, in connection order. */
export function modelRefs(lists: readonly ConnectionModels[]): string[] {
  return lists.flatMap((list) => list.models.map((model) => `${list.id}:${model}`));
}
