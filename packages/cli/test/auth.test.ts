import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { readAuthFile, setFileKey, type Keychain } from '../src/keys.js';
import { authPath } from '../src/paths.js';
import type { CliInput } from '../src/io.js';

const dirs: string[] = [];

interface Env {
  [key: string]: string | undefined;
  PLATO_CONFIG_DIR?: string;
  PLATO_DATA_DIR?: string;
  PLATO_DISABLE_KEYRING?: string;
  ANTHROPIC_API_KEY?: string;
  PLATO_KEY_ANTHROPIC?: string;
}

function tempEnv(extra: Env = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-auth-'));
  dirs.push(dir);
  return { PLATO_CONFIG_DIR: dir, PLATO_DATA_DIR: dir, ...extra };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

function stdin(text: string): CliInput {
  return Readable.from([text]);
}

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

describe('auth login', () => {
  it('saves a standard provider key to the file when the keychain is disabled', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    const io = capture();
    const code = await runAuth(['login', 'anthropic'], {
      env,
      streams: io.streams,
      input: stdin('sk-test-secret\n'),
    });

    expect(code).toBe(0);
    expect(io.out()).toContain('anthropic saved to');
    expect(io.out()).toContain('mode 0600');
    expect(io.out()).not.toContain('sk-test-secret');

    const config = loadConfig(env);
    expect(config.connections).toEqual([
      { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
    ]);
    expect(readAuthFile(env).keys['anthropic']).toBe('sk-test-secret');
    expect(statSync(authPath(env)).mode & 0o777).toBe(0o600);
  });

  it('writes to the keychain by default and never prints the key', async () => {
    const env = tempEnv();
    const keychain = fakeKeychain();
    const io = capture();
    const code = await runAuth(['login', 'openrouter'], {
      env,
      streams: io.streams,
      input: stdin('sk-or-secret\n'),
      keychain,
    });

    expect(code).toBe(0);
    expect(io.out()).toContain('OS keychain');
    expect(io.out()).not.toContain('sk-or-secret');
    expect(keychain.store.get('openrouter')).toBe('sk-or-secret');
    expect(readAuthFile(env).keys['openrouter']).toBeUndefined();
    expect(loadConfig(env).connections[0]).toEqual({
      id: 'openrouter',
      kind: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('writes the file when --no-keyring is passed, even with a keychain', async () => {
    const env = tempEnv();
    const keychain = fakeKeychain({ anthropic: 'stale' });
    const io = capture();
    const code = await runAuth(['login', 'anthropic', '--no-keyring'], {
      env,
      streams: io.streams,
      input: stdin('sk-file\n'),
      keychain,
    });

    expect(code).toBe(0);
    expect(io.out()).toContain(authPath(env));
    expect(readAuthFile(env).keys['anthropic']).toBe('sk-file');
    expect(keychain.store.has('anthropic')).toBe(false);
  });

  it('configures a connection without a key when the input is empty', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    const io = capture();
    const code = await runAuth(['login', 'litellm'], {
      env,
      streams: io.streams,
      input: stdin('\n'),
    });

    expect(code).toBe(0);
    expect(io.out()).toContain('No key saved');
    expect(loadConfig(env).connections[0]?.id).toBe('litellm');
    expect(readAuthFile(env).keys['litellm']).toBeUndefined();
  });

  it('needs a connection name when there is no terminal', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth(['login'], {
      env,
      streams: io.streams,
      input: stdin(''),
    });
    expect(code).toBe(2);
    expect(io.err()).toContain('name a connection');
  });

  it('needs a base URL for a custom OpenAI-compatible endpoint', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth(['login', 'mine', '--kind', 'openai'], {
      env,
      streams: io.streams,
      input: stdin('sk-x\n'),
    });
    expect(code).toBe(2);
    expect(io.err()).toContain('--base-url');
  });

  it('accepts a custom endpoint with a base URL', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    const io = capture();
    const code = await runAuth(
      ['login', 'mine', '--kind', 'openai', '--base-url', 'http://localhost:9999/v1'],
      { env, streams: io.streams, input: stdin('sk-x\n') },
    );
    expect(code).toBe(0);
    expect(loadConfig(env).connections[0]).toEqual({
      id: 'mine',
      kind: 'openai',
      baseUrl: 'http://localhost:9999/v1',
    });
  });
});

describe('auth status', () => {
  it('names the source and never the key', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env-secret' });
    const io = capture();
    // Create the connection through login first, with the file disabled.
    await runAuth(['login', 'anthropic', '--no-keyring'], {
      env,
      streams: capture().streams,
      input: stdin('\n'),
    });

    const code = await runAuth(['status'], { env, streams: io.streams, input: stdin('') });
    expect(code).toBe(0);
    expect(io.out()).toContain('env:ANTHROPIC_API_KEY');
    expect(io.out()).not.toContain('sk-env-secret');
  });

  it('reports a file with a wider mode', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    await runAuth(['login', 'anthropic'], {
      env,
      streams: capture().streams,
      input: stdin('sk-file\n'),
    });
    chmodSync(authPath(env), 0o644);

    const io = capture();
    await runAuth(['status'], { env, streams: io.streams, input: stdin('') });
    expect(io.err()).toContain('expected 0600');
    expect(io.err()).toContain('0644');
  });
});

describe('auth list and logout', () => {
  it('lists stored connections without keys', async () => {
    const env = tempEnv({ PLATO_DATA_DIR: mkdtempSync(join(tmpdir(), 'plato-cli-list-')) });
    dirs.push(env.PLATO_DATA_DIR as string);
    setFileKey('anthropic', 'sk-secret', env);
    const io = capture();
    const code = await runAuth(['list'], {
      env,
      streams: io.streams,
      input: stdin(''),
      keychain: fakeKeychain({ openrouter: 'sk-or' }),
    });
    expect(code).toBe(0);
    expect(io.out()).toContain('anthropic');
    expect(io.out()).toContain('openrouter');
    expect(io.out()).not.toContain('sk-secret');
    expect(io.out()).not.toContain('sk-or');
  });

  it('removes a saved key and leaves the connection', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    await runAuth(['login', 'anthropic'], {
      env,
      streams: capture().streams,
      input: stdin('sk-file\n'),
    });

    const io = capture();
    const code = await runAuth(['logout', 'anthropic'], {
      env,
      streams: io.streams,
      input: stdin(''),
    });
    expect(code).toBe(0);
    expect(io.out()).toContain('Removed');
    expect(readAuthFile(env).keys['anthropic']).toBeUndefined();
    expect(loadConfig(env).connections).toHaveLength(1);
  });

  it('says when there is no saved key', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth(['logout', 'anthropic'], {
      env,
      streams: io.streams,
      input: stdin(''),
      keychain: fakeKeychain(),
    });
    expect(code).toBe(0);
    expect(io.out()).toContain('No saved key');
  });
});

describe('auth dispatch', () => {
  it('shows help for a bare auth command and fails the exit code', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth([], { env, streams: io.streams, input: stdin('') });
    expect(code).toBe(2);
    expect(io.err()).toContain('Usage');
  });

  it('shows help for --help', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth(['--help'], { env, streams: io.streams, input: stdin('') });
    expect(code).toBe(0);
    expect(io.out()).toContain('plato auth login');
  });

  it('rejects an unknown subcommand', async () => {
    const env = tempEnv();
    const io = capture();
    const code = await runAuth(['frobnicate'], { env, streams: io.streams, input: stdin('') });
    expect(code).toBe(2);
    expect(io.err()).toContain("unknown command 'frobnicate'");
  });

  it('keeps the config file free of the key', async () => {
    const env = tempEnv({ PLATO_DISABLE_KEYRING: '1' });
    await runAuth(['login', 'anthropic'], {
      env,
      streams: capture().streams,
      input: stdin('sk-must-not-land\n'),
    });
    const configText = readFileSync(join(env.PLATO_CONFIG_DIR as string, 'config.json'), 'utf8');
    expect(configText).not.toContain('sk-must-not-land');
  });
});
