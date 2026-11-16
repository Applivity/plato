import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, TurnResponse } from '@applivity/plato-core';
import { loadConfig, type PlatoConfig } from '../src/config.js';
import { runModel } from '../src/modelCommand.js';
import { Session } from '../src/session.js';
import type { Prompter } from '../src/prompt.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function environment(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-model-'));
  dirs.push(dir);
  const env: Record<string, string> = {
    PLATO_CONFIG_DIR: join(dir, 'config'),
    PLATO_DATA_DIR: join(dir, 'data'),
    PLATO_HOME: join(dir, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
  for (const key of ['PLATO_CONFIG_DIR', 'PLATO_DATA_DIR', 'PLATO_HOME'] as const) {
    mkdirSync(env[key] ?? '', { recursive: true });
  }
  return env;
}

function config(): PlatoConfig {
  return {
    connections: [
      { id: 'connA', kind: 'openai', baseUrl: 'http://localhost:1/v1' },
      { id: 'connB', kind: 'openai', baseUrl: 'http://localhost:2/v1' },
    ],
    model: 'connA:m-a',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

/** The 24-hour cache, written the way the CLI writes it. */
function seedCache(env: Record<string, string>, entries: Record<string, string[]>): void {
  const at = Date.now();
  const cache: Record<string, unknown> = {};
  for (const [id, models] of Object.entries(entries)) {
    cache[id] = { at, pool: models.map((model) => ({ id: model })) };
  }
  writeFileSync(join(env.PLATO_DATA_DIR ?? '', 'models.json'), JSON.stringify(cache));
}

const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

function prompter(answers: string[]): Prompter {
  return {
    async ask(): Promise<string> {
      return answers.shift() ?? '';
    },
    async secret(): Promise<string> {
      return '';
    },
  };
}

function scripted(): ChatProvider {
  return {
    id: 'openai',
    async completeTurn(): Promise<TurnResponse> {
      return {
        content: [{ type: 'text', text: 'Done.' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    },
  };
}

async function waitForCard(session: Session, kind: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const card = session.getSnapshot().card;
    if (card !== null && card.kind === kind) {
      return card;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${kind} card appeared`);
}

describe('plato model', () => {
  it('lists each model and switches to the chosen one', async () => {
    const env = environment();
    seedCache(env, { connA: ['m-a'], connB: ['m-b'] });
    const { saveConfig } = await import('../src/config.js');
    saveConfig(config(), env);
    const out: string[] = [];

    const code = await runModel([], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      prompter: prompter(['2']),
      fetchImpl: offline,
    });

    expect(code).toBe(0);
    expect(out.join('')).toContain('connA:m-a  (current)');
    expect(out.join('')).toContain('connB:m-b');
    expect(loadConfig(env).model).toBe('connB:m-b');
  });

  it('sets a model given directly', async () => {
    const env = environment();
    const { saveConfig } = await import('../src/config.js');
    saveConfig(config(), env);
    const out: string[] = [];
    const code = await runModel(['connB:m-b'], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      fetchImpl: offline,
    });
    expect(code).toBe(0);
    expect(loadConfig(env).model).toBe('connB:m-b');
  });

  it('keeps known models and says so when a connection cannot answer', async () => {
    const env = environment();
    seedCache(env, { connA: ['m-a'], connB: ['m-b'] });
    const { saveConfig } = await import('../src/config.js');
    saveConfig(config(), env);
    const out: string[] = [];
    await runModel([], {
      env,
      streams: { out: (text) => out.push(text), err: (text) => out.push(text) },
      fetchImpl: offline,
    });
    const listing = out.join('');
    expect(listing).toContain('connA:m-a');
    expect(listing).toContain('connB:m-b');
    expect(listing).toContain('could not list its models just now');
  });
});

describe('/model', () => {
  function session(env: Record<string, string>): Session {
    return new Session({
      root: env.PLATO_HOME ?? '/tmp',
      config: config(),
      env,
      provider: scripted(),
      fetchImpl: offline,
    });
  }

  it('opens a picker, marks the current model, and changes nothing on Esc', async () => {
    const env = environment();
    seedCache(env, { connA: ['m-a'], connB: ['m-b'] });
    const active = session(env);
    const answered = active.handleCommand('/model');
    const card = await waitForCard(active, 'model');
    expect(card.kind).toBe('model');
    if (card.kind === 'model') {
      expect(card.options).toContain('connA:m-a  (current)');
      expect(card.options.at(-1)).toBe('Add a provider…');
    }
    active.cardCancel();
    await answered;
    expect(active.model).toBe('connA:m-a');
  });

  it('chooses another model without starting a run', async () => {
    const env = environment();
    seedCache(env, { connA: ['m-a'], connB: ['m-b'] });
    const active = session(env);
    const answered = active.handleCommand('/model');
    await waitForCard(active, 'model');
    active.cardMove(1);
    active.cardConfirm();
    await answered;
    expect(active.model).toBe('connB:m-b');
    expect(active.getSnapshot().running).toBe(false);
  });

  it('runs the setup hook from the last entry', async () => {
    const env = environment();
    seedCache(env, { connA: ['m-a'], connB: ['m-b'] });
    const active = session(env);
    let added = 0;
    active.setAddProvider(async () => {
      added += 1;
    });
    const answered = active.handleCommand('/model');
    const card = await waitForCard(active, 'model');
    if (card.kind === 'model') {
      active.cardMove(card.options.length - 1 - card.selected);
    }
    active.cardConfirm();
    await answered;
    expect(added).toBe(1);
  });
});
