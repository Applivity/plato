import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAuth } from '../src/auth.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { runConfig } from '../src/configCommand.js';
import { readAuthFile, saveKey } from '../src/keys.js';
import { askModels, connectionFor, providerChoices, saveSetup } from '../src/setup.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function environment(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-setup-'));
  dirs.push(dir);
  return {
    PLATO_CONFIG_DIR: join(dir, 'config'),
    PLATO_DATA_DIR: join(dir, 'data'),
    PLATO_HOME: join(dir, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
}

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('the provider list', () => {
  it('puts the ten first, then the rest, then Custom endpoint', () => {
    const choices = providerChoices();
    expect(choices.slice(0, 3).map((entry) => entry.id)).toEqual([
      'anthropic',
      'openai',
      'deepseek',
    ]);
    expect(choices.map((entry) => entry.id)).toContain('vllm');
    expect(choices.at(-1)?.id).toBe('custom');
  });

  it('builds a preset connection with its own address', () => {
    const deepseek = providerChoices().find((entry) => entry.id === 'deepseek');
    expect(deepseek).toBeDefined();
    if (deepseek !== undefined) {
      expect(connectionFor(deepseek).baseUrl).toBe('https://api.deepseek.com');
    }
  });
});

describe('what the endpoint says', () => {
  const connection = { id: 'c', kind: 'openai' as const, baseUrl: 'http://localhost:1/v1' };

  it('reads the model list on success', async () => {
    const answer = await askModels(connection, 'k', {
      fetchImpl: (async () =>
        response({ data: [{ id: 'm1', context_length: 4096 }] })) as unknown as typeof fetch,
    });
    expect(answer).toEqual({ kind: 'ok', entries: [{ id: 'm1', maxContext: 4096 }] });
  });

  it('reports an empty list as an answer, not a failure', async () => {
    const answer = await askModels(connection, 'k', {
      fetchImpl: (async () => response({ data: [] })) as unknown as typeof fetch,
    });
    expect(answer).toEqual({ kind: 'ok', entries: [] });
  });

  it('names a rejected key', async () => {
    const answer = await askModels(connection, 'k', {
      fetchImpl: (async () => response({ error: 'invalid key' }, 401)) as unknown as typeof fetch,
    });
    expect(answer.kind).toBe('rejected');
  });

  it('names an unreachable endpoint', async () => {
    const answer = await askModels(connection, 'k', {
      fetchImpl: (async () => {
        throw new Error('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(answer.kind).toBe('unreachable');
  });
});

describe('saving setup', () => {
  it('writes the connection, the key, the model and a chosen window', async () => {
    const env = environment();
    const model = await saveSetup({
      env,
      keychain: null,
      connection: { id: 'mine', kind: 'openai', baseUrl: 'http://localhost:9/v1' },
      key: 'sk-test',
      model: 'm1',
      contextWindow: 4096,
    });
    expect(model).toBe('mine:m1');
    const saved = loadConfig(env);
    expect(saved.model).toBe('mine:m1');
    expect(saved.connections[0]).toEqual({
      id: 'mine',
      kind: 'openai',
      baseUrl: 'http://localhost:9/v1',
      contextWindow: 4096,
    });
    expect(readAuthFile(env).keys['mine']).toBe('sk-test');
  });
});

describe('a piped key with no key', () => {
  it('says the connection is saved and the key is not, and does not claim success', async () => {
    const env = environment();
    const out: string[] = [];
    const code = await runAuth(
      [
        'login',
        'c1',
        '--kind',
        'openai',
        '--base-url',
        'https://example.test/v1',
        '--key-stdin',
        '--model',
        'm1',
      ],
      {
        env,
        streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
        input: (async function* () {})() as unknown as NodeJS.ReadableStream,
        keychain: null,
      },
    );

    expect(code).toBe(1);
    const printed = out.join('');
    expect(printed).toContain('no key was saved');
    expect(printed).not.toContain('Saved. Using');
    expect(loadConfig(env).connections[0]?.id).toBe('c1');
    expect(readAuthFile(env).keys['c1']).toBeUndefined();
  });
});

describe('a terminal does not turn flags into questions', () => {
  it('saves a named connection from flags without asking anything', async () => {
    const env = environment();
    const out: string[] = [];
    const asked: string[] = [];
    const prompt = {
      async ask(question: string): Promise<string> {
        asked.push(question);
        return '';
      },
      async secret(question: string): Promise<string> {
        asked.push(question);
        return '';
      },
    };
    const input = (async function* () {
      yield 'sk-tty-key\n';
    })();
    const code = await runAuth(
      [
        'login',
        'zed',
        '--kind',
        'openai',
        '--base-url',
        'http://127.0.0.1:9/v1',
        '--key-stdin',
        '--model',
        'z-model',
      ],
      {
        env,
        streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
        input: input as unknown as NodeJS.ReadableStream,
        prompter: prompt,
        keychain: null,
      },
    );

    expect(code).toBe(0);
    expect(asked).toEqual([]);
    const saved = loadConfig(env);
    expect(saved.connections[0]?.baseUrl).toBe('http://127.0.0.1:9/v1');
    expect(saved.model).toBe('zed:z-model');
  });

  it('lets --base-url override a preset address', async () => {
    const env = environment();
    const input = (async function* () {
      yield 'sk-key\n';
    })();
    const code = await runAuth(
      ['login', 'litellm', '--base-url', 'http://127.0.0.1:9/v1', '--key-stdin', '--model', 'mine'],
      {
        env,
        streams: { out: () => {}, err: () => {} },
        input: input as unknown as NodeJS.ReadableStream,
        keychain: null,
      },
    );
    expect(code).toBe(0);
    expect(loadConfig(env).connections[0]?.baseUrl).toBe('http://127.0.0.1:9/v1');
  });
});

describe('one command', () => {
  it('sets the connection, the key and the model with a piped key', async () => {
    const env = environment();
    const out: string[] = [];
    const input = (async function* () {
      yield 'sk-piped-key\n';
    })();
    const code = await runAuth(['login', 'deepseek', '--key-stdin', '--model', 'deepseek-chat'], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      input: input as unknown as NodeJS.ReadableStream,
      keychain: null,
    });

    expect(code).toBe(0);
    const config = loadConfig(env);
    expect(config.model).toBe('deepseek:deepseek-chat');
    expect(config.connections[0]).toEqual({
      id: 'deepseek',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(readAuthFile(env).keys['deepseek']).toBe('sk-piped-key');
    expect(out.join('')).toBe('Saved. Using deepseek:deepseek-chat.\n');
  });

  it('stores a key variable name, not its value', async () => {
    const env = environment();
    const out: string[] = [];
    const code = await runAuth(
      [
        'login',
        'mine',
        '--kind',
        'openai',
        '--base-url',
        'http://localhost:9999/v1',
        '--key-env',
        'MINE_KEY',
        '--model',
        'llama-3',
      ],
      {
        env,
        streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
        input: (async function* () {})() as unknown as NodeJS.ReadableStream,
        keychain: null,
      },
    );

    expect(code).toBe(0);
    const config = loadConfig(env);
    expect(config.connections[0]?.keyEnv).toBe('MINE_KEY');
    expect(readAuthFile(env).keys['mine']).toBeUndefined();
    expect(config.model).toBe('mine:llama-3');
  });
});

describe('plato config', () => {
  it('lists each connection and where its key comes from, never the key', async () => {
    const env = environment();
    await saveKey('deepseek', 'sk-a-secret-value', { env, keychain: null, forceFile: true });
    saveConfig(
      {
        connections: [
          {
            id: 'deepseek',
            kind: 'openai',
            baseUrl: 'https://api.deepseek.com',
            keyEnv: 'DEEPSEEK_KEY',
          },
        ],
        model: 'deepseek:deepseek-chat',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
    );

    const out: string[] = [];
    const code = await runConfig([], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
    });

    expect(code).toBe(0);
    const listing = out.join('');
    expect(listing).toContain('deepseek  openai  https://api.deepseek.com');
    expect(listing).toContain('key: file');
    expect(listing).not.toContain('sk-a-secret-value');
  });
});
