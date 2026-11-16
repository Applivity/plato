import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { readAuthFile, saveKey } from '../src/keys.js';
import { runConfig } from '../src/configCommand.js';
import { runWizard } from '../src/setup.js';
import type { Prompter } from '../src/prompt.js';

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

function prompter(asks: string[], secrets: string[] = []): Prompter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async ask(question: string): Promise<string> {
      asked.push(question);
      return asks.shift() ?? '';
    },
    async secret(question: string): Promise<string> {
      asked.push(question);
      return secrets.shift() ?? '';
    },
  };
}

function models(entries: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data: entries }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('the setup wizard', () => {
  it('saves the connection, the key and the model in one flow', async () => {
    const env = environment();
    const out: string[] = [];
    const prompt = prompter(['3', '1'], ['sk-test-key']);
    const code = await runWizard({
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      prompter: prompt,
      keychain: null,
      fetchImpl: models([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]),
    });

    expect(code).toBe(0);
    const config = loadConfig(env);
    expect(config.model).toBe('deepseek:deepseek-chat');
    expect(config.connections).toEqual([
      { id: 'deepseek', kind: 'openai', baseUrl: 'https://api.deepseek.com' },
    ]);
    expect(readAuthFile(env).keys['deepseek']).toBe('sk-test-key');
    expect(out.join('')).toContain('Saved. Using deepseek:deepseek-chat.');
  });

  it('asks for a context length only when the endpoint advertises none', async () => {
    const env = environment();
    const out: string[] = [];
    const prompt = prompter(['11', 'http://localhost:8000', 'y', 'llama-3', '4096'], []);
    const code = await runWizard({
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      prompter: prompt,
      keychain: null,
      fetchImpl: models([{ id: 'llama-3' }]),
    });

    expect(code).toBe(0);
    const config = loadConfig(env);
    expect(config.connections[0]?.baseUrl).toBe('http://localhost:8000/v1');
    expect(config.connections[0]?.contextWindow).toBe(4096);
    expect(config.model).toBe('custom:llama-3');
    expect(prompt.asked.some((question) => question.includes('Context length'))).toBe(true);
  });

  it('does not ask for a context length the endpoint advertised', async () => {
    const env = environment();
    const prompt = prompter(['11', 'http://localhost:8000/v1', 'llama-3'], []);
    const code = await runWizard({
      env,
      streams: { out: () => {}, err: () => {} },
      prompter: prompt,
      keychain: null,
      fetchImpl: models([{ id: 'llama-3', context_length: 8192 }]),
    });

    expect(code).toBe(0);
    expect(loadConfig(env).connections[0]?.contextWindow).toBeUndefined();
    expect(prompt.asked.some((question) => question.includes('Context length'))).toBe(false);
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
      [
        'login',
        'litellm',
        '--base-url',
        'http://127.0.0.1:9/v1',
        '--key-stdin',
        '--model',
        'mine',
      ],
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

describe('a named provider in a terminal', () => {
  it('asks for the key and the model, and saves both', async () => {
    const env = environment();
    const out: string[] = [];
    const prompt = prompter(['1'], ['sk-deepseek']);
    const code = await runAuth(['login', 'deepseek'], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      input: (async function* () {})() as unknown as NodeJS.ReadableStream,
      prompter: prompt,
      keychain: null,
      fetchImpl: models([{ id: 'deepseek-chat' }]),
    });

    expect(code).toBe(0);
    const saved = loadConfig(env);
    expect(saved.model).toBe('deepseek:deepseek-chat');
    expect(saved.connections[0]?.baseUrl).toBe('https://api.deepseek.com');
    expect(readAuthFile(env).keys['deepseek']).toBe('sk-deepseek');
    expect(out.join('')).toContain('Saved. Using deepseek:deepseek-chat.');
  });

  it('offers Keep and keeps a working key', async () => {
    const env = environment();
    await saveKey('deepseek', 'sk-original', { env, keychain: null, forceFile: true });
    const { saveConfig } = await import('../src/config.js');
    saveConfig(
      {
        connections: [
          { id: 'deepseek', kind: 'openai', baseUrl: 'https://api.deepseek.com' },
        ],
        model: 'deepseek:deepseek-reasoner',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
    );
    const out: string[] = [];
    const prompt = prompter(['k', '1']);
    const code = await runAuth(['login', 'deepseek'], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      input: (async function* () {})() as unknown as NodeJS.ReadableStream,
      prompter: prompt,
      keychain: null,
      fetchImpl: models([{ id: 'deepseek-chat' }]),
    });

    expect(code).toBe(0);
    expect(out.join('')).toContain('A key is saved for deepseek: sk-o…');
    expect(readAuthFile(env).keys['deepseek']).toBe('sk-original');
    expect(loadConfig(env).model).toBe('deepseek:deepseek-chat');
    expect(prompt.asked.some((question) => question.includes('Keep, replace or clear'))).toBe(true);
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
    await saveKey(
      'deepseek',
      'sk-a-secret-value',
      { env, keychain: null, forceFile: true },
    );
    const out: string[] = [];
    const { saveConfig } = await import('../src/config.js');
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
