import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the CLI keeps its files (D49bx). Three homes, each with one job:
 *
 * - the config directory holds settings and connections, and never a key;
 * - the data directory holds credentials and the model cache;
 * - `~/.plato` is the state shared with the extension: runs, undo, MCP,
 *   teams, and `PLATO.md` (D49bw).
 *
 * Every function takes the environment so a test never has to touch the real
 * home directory.
 */
export type Env = Record<string, string | undefined>;

export function configDir(env: Env = process.env): string {
  return env['PLATO_CONFIG_DIR'] || join(homedir(), '.config', 'plato');
}

export function configPath(env: Env = process.env): string {
  return join(configDir(env), 'config.json');
}

export function dataDir(env: Env = process.env): string {
  return env['PLATO_DATA_DIR'] || join(homedir(), '.local', 'share', 'plato');
}

export function authPath(env: Env = process.env): string {
  return join(dataDir(env), 'auth.json');
}

export function modelCachePath(env: Env = process.env): string {
  return join(dataDir(env), 'models.json');
}

/** The extension's per-project key: the first 8 hex of the SHA-1 of the root. */
export function projectKey(root: string): string {
  return createHash('sha1').update(root).digest('hex').slice(0, 8);
}

/** The extension's home, shared with this host (D49bw). `PLATO_HOME` is for tests and containers. */
export function platoHome(env: Env = process.env): string {
  return env['PLATO_HOME'] || join(homedir(), '.plato');
}

/** Where this project's run transcripts live, one directory per project. */
export function runsDir(root: string, env: Env = process.env): string {
  return join(platoHome(env), 'runs', projectKey(root));
}
