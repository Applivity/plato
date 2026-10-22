import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConnectionConfig } from './config.js';
import { authPath, type Env } from './paths.js';

/**
 * Key resolution (D49bx): `PLATO_KEY_<ID>` > the provider's own variable > the
 * OS keychain > `~/.local/share/plato/auth.json` (mode 0600). The config file
 * never holds a key.
 *
 * A known preset uses its vendor variable. This matters for a connection whose
 * wire kind is `openai` but whose vendor is not OpenAI: sending `OPENAI_API_KEY`
 * to OpenRouter would send the wrong account's key to the wrong host.
 */
export type KeySource = 'env-connection' | 'env-provider' | 'keychain' | 'file';

export interface ResolvedKey {
  key: string;
  source: KeySource;
  /** The variable name, "keychain", or the file path. Never the key. */
  detail: string;
}

const VENDOR_ENV: Record<string, { name: string; kind?: 'anthropic' | 'openai' }> = {
  anthropic: { name: 'ANTHROPIC_API_KEY', kind: 'anthropic' },
  openai: { name: 'OPENAI_API_KEY', kind: 'openai' },
  openrouter: { name: 'OPENROUTER_API_KEY', kind: 'openai' },
  groq: { name: 'GROQ_API_KEY', kind: 'openai' },
  mistral: { name: 'MISTRAL_API_KEY', kind: 'openai' },
  deepseek: { name: 'DEEPSEEK_API_KEY', kind: 'openai' },
  xai: { name: 'XAI_API_KEY', kind: 'openai' },
  together: { name: 'TOGETHER_API_KEY', kind: 'openai' },
  fireworks: { name: 'FIREWORKS_API_KEY', kind: 'openai' },
  cerebras: { name: 'CEREBRAS_API_KEY', kind: 'openai' },
  perplexity: { name: 'PERPLEXITY_API_KEY', kind: 'openai' },
  gemini: { name: 'GEMINI_API_KEY', kind: 'openai' },
  huggingface: { name: 'HF_TOKEN', kind: 'openai' },
};

/**
 * A remote endpoint needs a key before the run starts, so the user reads one
 * sentence instead of a provider's 401 halfway through. A plain-HTTP endpoint
 * (Ollama, LM Studio, a local LiteLLM) may legitimately take none.
 */
export function connectionNeedsKey(connection: {
  kind: 'anthropic' | 'openai';
  baseUrl?: string;
}): boolean {
  const base =
    connection.baseUrl ??
    (connection.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
  return base.startsWith('https://');
}

export function connectionEnvName(id: string): string {
  return `PLATO_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function providerEnvName(connection: Pick<ConnectionConfig, 'id' | 'kind'>): string {
  const vendor = VENDOR_ENV[connection.id];
  if (vendor !== undefined && (vendor.kind === undefined || vendor.kind === connection.kind)) {
    return vendor.name;
  }
  return connection.kind === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

export interface Keychain {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<boolean>;
  list(): Promise<string[]>;
  /** A read-only check that the store can be reached. */
  probe(): Promise<boolean>;
}

const KEYCHAIN_SERVICE = 'plato';

export function keyringDisabled(env: Env = process.env): boolean {
  const value = (env['PLATO_DISABLE_KEYRING'] ?? '').toLowerCase();
  return value === '1' || value === 'true';
}

let loaded: Promise<Keychain | null> | undefined;

/**
 * Loads `@napi-rs/keyring` once. It is an optional dependency, so a missing
 * module or a machine without a usable store is a normal state, not an error:
 * the chain falls through to the file (D49bx).
 */
export async function loadKeychain(
  env: Env = process.env,
  ignoreDisable = false,
): Promise<Keychain | null> {
  if (!ignoreDisable && keyringDisabled(env)) {
    return null;
  }
  loaded ??= import('@napi-rs/keyring')
    .then((mod) => {
      const Entry = mod.AsyncEntry;
      const entry = (account: string): InstanceType<typeof Entry> =>
        new Entry(KEYCHAIN_SERVICE, account);
      return {
        async get(account: string) {
          return (await entry(account).getPassword()) ?? null;
        },
        async set(account: string, secret: string) {
          await entry(account).setPassword(secret);
        },
        async delete(account: string) {
          return await entry(account).deleteCredential();
        },
        async list() {
          return mod.findCredentials(KEYCHAIN_SERVICE).map((credential) => credential.account);
        },
        async probe() {
          await entry('__probe__').getPassword();
          return true;
        },
      } satisfies Keychain;
    })
    .catch(() => null);
  return await loaded;
}

export interface StoredKeys {
  keys: Record<string, string>;
  /** The file's mode, when it exists. */
  mode?: number;
  /** A read error to report, never a key. */
  error?: string;
}

export function readAuthFile(env: Env = process.env): StoredKeys {
  const path = authPath(env);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { keys: {} };
    }
    return { keys: {}, error: `Cannot read ${path}: ${(error as Error).message}` };
  }

  let mode: number | undefined;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }

  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return { keys: {}, mode, error: `${path} is not a JSON object` };
    }
    const keysRaw = (raw as Record<string, unknown>)['keys'];
    if (typeof keysRaw !== 'object' || keysRaw === null) {
      return { keys: {}, mode, error: `${path} has no "keys" object` };
    }
    const keys: Record<string, string> = {};
    for (const [id, value] of Object.entries(keysRaw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) {
        keys[id] = value;
      }
    }
    return { keys, mode };
  } catch (error) {
    return { keys: {}, mode, error: `${path} is not valid JSON: ${(error as Error).message}` };
  }
}

function writeAuthFile(keys: Record<string, string>, env: Env): void {
  const path = authPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, keys }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
  // The rename keeps the temporary file's mode; this also repairs a file that
  // was written earlier with a wider mode.
  chmodSync(path, 0o600);
}

export function setFileKey(id: string, key: string, env: Env = process.env): void {
  const stored = readAuthFile(env);
  stored.keys[id] = key;
  writeAuthFile(stored.keys, env);
}

export function removeFileKey(id: string, env: Env = process.env): boolean {
  const stored = readAuthFile(env);
  if (stored.keys[id] === undefined) {
    return false;
  }
  delete stored.keys[id];
  writeAuthFile(stored.keys, env);
  return true;
}

export interface ResolveOptions {
  env?: Env;
  /** `null` means the keychain is unavailable; omit to load it. */
  keychain?: Keychain | null;
  /** Injected by tests; read from disk otherwise. */
  auth?: StoredKeys;
}

export async function resolveKey(
  connection: Pick<ConnectionConfig, 'id' | 'kind'>,
  opts: ResolveOptions = {},
): Promise<ResolvedKey | null> {
  const env = opts.env ?? process.env;

  const connectionVariable = connectionEnvName(connection.id);
  const fromConnection = env[connectionVariable];
  if (fromConnection !== undefined && fromConnection.length > 0) {
    return { key: fromConnection, source: 'env-connection', detail: connectionVariable };
  }

  const providerVariable = providerEnvName(connection);
  const fromProvider = env[providerVariable];
  if (fromProvider !== undefined && fromProvider.length > 0) {
    return { key: fromProvider, source: 'env-provider', detail: providerVariable };
  }

  const keychain = opts.keychain === undefined ? await loadKeychain(env) : opts.keychain;
  if (keychain !== null) {
    try {
      const fromKeychain = await keychain.get(connection.id);
      if (fromKeychain !== null && fromKeychain.length > 0) {
        return { key: fromKeychain, source: 'keychain', detail: 'keychain' };
      }
    } catch {
      // A locked or unavailable store is not a failure: try the file.
    }
  }

  const auth = opts.auth ?? readAuthFile(env);
  const fromFile = auth.keys[connection.id];
  if (fromFile !== undefined && fromFile.length > 0) {
    return { key: fromFile, source: 'file', detail: authPath(env) };
  }

  return null;
}

export interface SaveResult {
  store: 'keychain' | 'file';
  path?: string;
}

/**
 * Saves a key to the keychain, or to the 0600 file when the keychain is
 * unavailable or disabled. A successful save removes the other copy, so a
 * stale entry can never shadow the key the user just set (the keychain is
 * checked first).
 */
export async function saveKey(
  id: string,
  key: string,
  opts: { env?: Env; keychain?: Keychain | null; forceFile?: boolean } = {},
): Promise<SaveResult> {
  const env = opts.env ?? process.env;
  const keychain =
    opts.keychain === undefined
      ? await loadKeychain(env)
      : opts.keychain;

  if (!opts.forceFile && keychain !== null) {
    try {
      await keychain.set(id, key);
      try {
        removeFileKey(id, env);
      } catch {
        // Leaving a stale file copy behind is not worth failing the login.
      }
      return { store: 'keychain' };
    } catch {
      // Fall through to the file. The user is not asked to install anything.
    }
  }

  setFileKey(id, key, env);
  // Even when the keyring is disabled it may hold an older key, and the
  // keychain is read first. Best effort: a locked store must not fail a login.
  const cleanup =
    keychain ?? (opts.keychain === undefined ? await loadKeychain(env, true) : null);
  if (cleanup !== null) {
    try {
      await cleanup.delete(id);
    } catch {
      // Nothing to remove, or the store is locked.
    }
  }
  return { store: 'file', path: authPath(env) };
}

export interface DeleteResult {
  keychain: boolean;
  file: boolean;
}

/** Removes every copy of a connection's key. The connection itself stays. */
export async function deleteKey(
  id: string,
  opts: { env?: Env; keychain?: Keychain | null } = {},
): Promise<DeleteResult> {
  const env = opts.env ?? process.env;
  const keychain = opts.keychain === undefined ? await loadKeychain(env, true) : opts.keychain;
  let removedFromKeychain = false;
  if (keychain !== null) {
    try {
      removedFromKeychain = await keychain.delete(id);
    } catch {
      removedFromKeychain = false;
    }
  }
  let removedFromFile = false;
  try {
    removedFromFile = removeFileKey(id, env);
  } catch {
    removedFromFile = false;
  }
  return { keychain: removedFromKeychain, file: removedFromFile };
}

/** The file's mode as four octal digits, for `auth status` and `doctor`. */
export function formatMode(mode: number): string {
  return mode.toString(8).padStart(4, '0');
}

/** True when the file is readable by anyone but its owner. */
export function isWideMode(mode: number | undefined): boolean {
  return mode !== undefined && (mode & 0o077) !== 0;
}

/** Where a saved key lives, used by `auth list`. Not the key itself. */
export async function listStoredKeys(
  env: Env = process.env,
  keychain?: Keychain | null,
): Promise<Map<string, Set<'keychain' | 'file'>>> {
  const store = keychain === undefined ? await loadKeychain(env) : keychain;
  const found = new Map<string, Set<'keychain' | 'file'>>();
  if (store !== null) {
    try {
      for (const account of await store.list()) {
        const existing = found.get(account) ?? new Set();
        existing.add('keychain');
        found.set(account, existing);
      }
    } catch {
      // An unavailable store contributes nothing.
    }
  }
  for (const id of Object.keys(readAuthFile(env).keys)) {
    const existing = found.get(id) ?? new Set();
    existing.add('file');
    found.set(id, existing);
  }
  return found;
}
