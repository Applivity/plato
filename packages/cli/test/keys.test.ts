import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteKey,
  connectionEnvName,
  isWideMode,
  listStoredKeys,
  providerEnvName,
  readAuthFile,
  resolveKey,
  saveKey,
  setFileKey,
  type Keychain,
} from '../src/keys.js';
import { authPath } from '../src/paths.js';

const dirs: string[] = [];

function tempData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-keys-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeKeychain(initial: Record<string, string> = {}): Keychain & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(account) {
      return store.get(account) ?? null;
    },
    async set(account, secret) {
      store.set(account, secret);
    },
    async delete(account) {
      return store.delete(account);
    },
    async list() {
      return [...store.keys()];
    },
    async probe() {
      return true;
    },
  };
}

const anthropic = { id: 'anthropic', kind: 'anthropic' as const };
const openrouter = { id: 'openrouter', kind: 'openai' as const };

describe('key resolution', () => {
  it('builds the connection variable name from the id', () => {
    expect(connectionEnvName('my-litellm')).toBe('PLATO_KEY_MY_LITELLM');
    expect(connectionEnvName('a.b_c')).toBe('PLATO_KEY_A_B_C');
  });

  it('uses a vendor variable for a known preset, not the wire kind', () => {
    expect(providerEnvName(anthropic)).toBe('ANTHROPIC_API_KEY');
    expect(providerEnvName(openrouter)).toBe('OPENROUTER_API_KEY');
    expect(providerEnvName({ id: 'custom', kind: 'openai' })).toBe('OPENAI_API_KEY');
    expect(providerEnvName({ id: 'custom', kind: 'anthropic' })).toBe('ANTHROPIC_API_KEY');
  });

  it('prefers PLATO_KEY_<ID> over every other source', async () => {
    const env = {
      PLATO_KEY_ANTHROPIC: 'from-connection',
      ANTHROPIC_API_KEY: 'from-provider',
      PLATO_DATA_DIR: tempData(),
    };
    const keychain = fakeKeychain({ anthropic: 'from-keychain' });
    setFileKey('anthropic', 'from-file', env);
    const resolved = await resolveKey(anthropic, { env, keychain });
    expect(resolved).toEqual({
      key: 'from-connection',
      source: 'env-connection',
      detail: 'PLATO_KEY_ANTHROPIC',
    });
  });

  it('prefers the provider variable over the keychain and the file', async () => {
    const env = { OPENROUTER_API_KEY: 'from-provider', PLATO_DATA_DIR: tempData() };
    const keychain = fakeKeychain({ openrouter: 'from-keychain' });
    setFileKey('openrouter', 'from-file', env);
    const resolved = await resolveKey(openrouter, { env, keychain });
    expect(resolved?.source).toBe('env-provider');
    expect(resolved?.detail).toBe('OPENROUTER_API_KEY');
    expect(resolved?.key).toBe('from-provider');
  });

  it('prefers the keychain over the file', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'from-file', env);
    const resolved = await resolveKey(anthropic, {
      env,
      keychain: fakeKeychain({ anthropic: 'from-keychain' }),
    });
    expect(resolved).toEqual({ key: 'from-keychain', source: 'keychain', detail: 'keychain' });
  });

  it('falls through to the file when the keychain is absent', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'from-file', env);
    const resolved = await resolveKey(anthropic, { env, keychain: null });
    expect(resolved?.source).toBe('file');
    expect(resolved?.key).toBe('from-file');
  });

  it('falls through to the file when the keychain throws', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'from-file', env);
    const keychain: Keychain = {
      async get() {
        throw new Error('locked');
      },
      async set() {},
      async delete() {
        return false;
      },
      async list() {
        return [];
      },
      async probe() {
        return false;
      },
    };
    const resolved = await resolveKey(anthropic, { env, keychain });
    expect(resolved?.source).toBe('file');
  });

  it('ignores empty environment variables', async () => {
    const env = { ANTHROPIC_API_KEY: '', PLATO_DATA_DIR: tempData() };
    const resolved = await resolveKey(anthropic, { env, keychain: null });
    expect(resolved).toBeNull();
  });
});

describe('the credential file', () => {
  it.skipIf(process.platform === 'win32')('is written with mode 0600', () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'sk-secret', env);
    expect(statSync(authPath(env)).mode & 0o777).toBe(0o600);
    expect(readAuthFile(env).keys).toEqual({ anthropic: 'sk-secret' });
  });

  it('reports a wider mode', () => {
    expect(isWideMode(0o644)).toBe(true);
    expect(isWideMode(0o600)).toBe(false);
    expect(isWideMode(undefined)).toBe(false);
  });

  it('reports a malformed file instead of throwing', () => {
    const dir = tempData();
    const env = { PLATO_DATA_DIR: dir };
    setFileKey('anthropic', 'sk-secret', env);
    const path = authPath(env);
    writeFileSync(path, 'not json');
    const stored = readAuthFile(env);
    expect(stored.keys).toEqual({});
    expect(stored.error).toMatch(/not valid JSON/);
  });
});

describe('saving a key', () => {
  it('uses the keychain and removes a stale file copy', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'old-file', env);
    const keychain = fakeKeychain();
    const result = await saveKey('anthropic', 'sk-new', { env, keychain });
    expect(result.store).toBe('keychain');
    expect(keychain.store.get('anthropic')).toBe('sk-new');
    expect(readAuthFile(env).keys['anthropic']).toBeUndefined();
  });

  it('writes the file and removes a stale keychain copy when asked', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    const keychain = fakeKeychain({ anthropic: 'old-keychain' });
    const result = await saveKey('anthropic', 'sk-new', { env, keychain, forceFile: true });
    expect(result.store).toBe('file');
    expect(result.path).toBe(authPath(env));
    expect(readAuthFile(env).keys['anthropic']).toBe('sk-new');
    expect(keychain.store.has('anthropic')).toBe(false);
  });

  it('falls back to the file when the keychain write throws', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    const keychain: Keychain = {
      ...fakeKeychain(),
      async set() {
        throw new Error('locked');
      },
    };
    const result = await saveKey('anthropic', 'sk-new', { env, keychain });
    expect(result.store).toBe('file');
    expect(readAuthFile(env).keys['anthropic']).toBe('sk-new');
  });

  it('skips the keychain entirely when PLATO_DISABLE_KEYRING is set', async () => {
    const env = { PLATO_DATA_DIR: tempData(), PLATO_DISABLE_KEYRING: '1' };
    const result = await saveKey('anthropic', 'sk-new', { env });
    expect(result.store).toBe('file');
  });
});

describe('listing and deleting', () => {
  it('lists both stores without the keys', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'sk-file', env);
    const stored = await listStoredKeys(env, fakeKeychain({ openrouter: 'sk-chain' }));
    expect([...stored.keys()].sort()).toEqual(['anthropic', 'openrouter']);
    expect([...(stored.get('anthropic') ?? [])]).toEqual(['file']);
    expect([...(stored.get('openrouter') ?? [])]).toEqual(['keychain']);
  });

  it('removes both copies and reports what was removed', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    setFileKey('anthropic', 'sk-file', env);
    const keychain = fakeKeychain({ anthropic: 'sk-chain' });
    const removed = await deleteKey('anthropic', { env, keychain });
    expect(removed).toEqual({ keychain: true, file: true });
    expect(readAuthFile(env).keys['anthropic']).toBeUndefined();
    expect(keychain.store.has('anthropic')).toBe(false);
  });

  it('reports nothing to remove', async () => {
    const env = { PLATO_DATA_DIR: tempData() };
    const removed = await deleteKey('absent', { env, keychain: fakeKeychain() });
    expect(removed).toEqual({ keychain: false, file: false });
  });
});
