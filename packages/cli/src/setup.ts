import { PROVIDER_PRESETS, type ProviderPreset } from '@applivity/plato-core';
import { loadConfig, saveConfig, type ConnectionConfig } from './config.js';
import type { Streams } from './io.js';
import {
  connectionNeedsKey,
  deleteKey,
  resolveKey,
  saveKey,
  type Keychain,
} from './keys.js';
import { modelPool } from './models.js';
import type { Env } from './paths.js';
import type { Prompter } from './prompt.js';

/**
 * The setup wizard (item A). It runs in the command-line layer, before Ink, so
 * `plato auth login` and `plato --plain` get the same questions. One run saves
 * the connection, the key and the model: there is no second command.
 */

/** The first screen. Anything else is under "More providers…". */
const TOP = [
  'anthropic',
  'openai',
  'deepseek',
  'openrouter',
  'groq',
  'xai',
  'mistral',
  'gemini',
  'ollama',
  'lmstudio',
];

const MORE = ['litellm', 'vllm', 'together', 'fireworks', 'cerebras', 'perplexity', 'huggingface'];

export interface SetupOptions {
  env: Env;
  streams: Streams;
  prompter: Prompter;
  keychain?: Keychain | null;
  /** Injected by tests; the real fetch otherwise. */
  fetchImpl?: typeof fetch;
}

function preset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((entry) => entry.id === id);
}

function label(id: string): string {
  return preset(id)?.label ?? id;
}

function printProviders(out: (text: string) => void, ids: readonly string[], offset = 0): void {
  ids.forEach((id, index) => {
    out(`  ${offset + index + 1}. ${label(id)}\n`);
  });
}

/**
 * The picker. A number, or the provider's name; Enter takes the first entry.
 * A provider that is not on the first screen is one screen away.
 */
async function pickProvider(options: SetupOptions): Promise<string | null> {
  const { streams, prompter } = options;
  for (;;) {
    streams.out('Provider\n');
    printProviders(streams.out, TOP);
    streams.out(`  ${TOP.length + 1}. Custom endpoint\n`);
    streams.out(`  ${TOP.length + 2}. More providers…\n`);
    const answer = (
      await prompter.ask('Provider (number or name): ', { default: '1' })
    ).trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= TOP.length) {
      return TOP[index - 1] ?? null;
    }
    if (index === TOP.length + 1) {
      return 'custom';
    }
    if (index === TOP.length + 2) {
      streams.out('More providers\n');
      printProviders(streams.out, MORE);
      const more = (await prompter.ask('Provider (number or name): ')).trim();
      const moreIndex = Number(more);
      if (Number.isInteger(moreIndex) && moreIndex >= 1 && moreIndex <= MORE.length) {
        return MORE[moreIndex - 1] ?? null;
      }
      if (MORE.includes(more.toLowerCase())) {
        return more.toLowerCase();
      }
      streams.out(`No provider called '${more}'.\n`);
      continue;
    }
    if (preset(answer.toLowerCase()) !== undefined) {
      return answer.toLowerCase();
    }
    streams.out(`No provider called '${answer}'. Type a number from the list.\n`);
  }
}

function uniqueId(env: Env, wanted: string): string {
  const config = loadConfig(env);
  if (!config.connections.some((connection) => connection.id === wanted)) {
    return wanted;
  }
  for (let number = 2; number < 100; number += 1) {
    const candidate = `${wanted}-${number}`;
    if (!config.connections.some((connection) => connection.id === candidate)) {
      return candidate;
    }
  }
  return `${wanted}-${Date.now()}`;
}

async function askUrl(options: SetupOptions): Promise<string | null> {
  const { streams, prompter } = options;
  const answer = (await prompter.ask('Endpoint URL: ')).trim();
  if (answer.length === 0) {
    streams.err('No URL given; nothing was saved.\n');
    return null;
  }
  let url: URL;
  try {
    url = new URL(answer);
  } catch {
    streams.err(`'${answer}' is not a web address.\n`);
    return null;
  }
  if (url.pathname === '' || url.pathname === '/') {
    const add = (
      await prompter.ask('Add /v1 to the address? [Y/n] ', { default: 'y' })
    ).trim().toLowerCase();
    if (add !== 'n' && add !== 'no') {
      return `${answer.replace(/\/$/, '')}/v1`;
    }
  }
  return answer;
}

async function chooseModel(
  connection: ConnectionConfig,
  options: SetupOptions,
): Promise<{ model: string; advertised?: number } | null> {
  const { streams, prompter } = options;
  let entries: { id: string; maxContext?: number }[] = [];
  try {
    const pool = await modelPool(connection, {
      env: options.env,
      keychain: options.keychain,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    entries = pool.pool;
  } catch {
    // An endpoint that cannot list its models is not a dead end: type the id.
  }
  if (entries.length > 0) {
    streams.out('Model\n');
    entries.slice(0, 25).forEach((entry, index) => {
      streams.out(`  ${index + 1}. ${entry.id}\n`);
    });
    const answer = (await prompter.ask('Model (number or id): ', { default: '1' })).trim();
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= Math.min(25, entries.length)) {
      const entry = entries[index - 1];
      return entry === undefined ? null : { model: entry.id, ...(entry.maxContext === undefined ? {} : { advertised: entry.maxContext }) };
    }
    if (answer.length > 0) {
      const named = entries.find((entry) => entry.id === answer);
      return {
        model: answer,
        ...(named?.maxContext === undefined ? {} : { advertised: named.maxContext }),
      };
    }
    const first = entries[0];
    return first === undefined ? null : { model: first.id, ...(first.maxContext === undefined ? {} : { advertised: first.maxContext }) };
  }
  streams.out('The endpoint did not list any models.\n');
  const typed = (await prompter.ask('Model id: ')).trim();
  return typed.length === 0 ? null : { model: typed };
}

async function chooseKey(
  connection: ConnectionConfig,
  options: SetupOptions,
): Promise<{ key?: string; kept: boolean }> {
  const { streams, prompter } = options;
  const existing = await resolveKey(connection, {
    env: options.env,
    keychain: options.keychain,
  });
  if (existing !== null) {
    streams.out(`A key is saved for ${connection.id}: ${existing.key.slice(0, 4)}…\n`);
    const answer = (
      await prompter.ask('Keep, replace or clear it? [K/r/c] ', { default: 'k' })
    ).trim().toLowerCase();
    if (answer === '' || answer === 'k' || answer === 'keep') {
      return { kept: true };
    }
    if (answer === 'c' || answer === 'clear') {
      await deleteKey(connection.id, { env: options.env, keychain: options.keychain });
      streams.out('The saved key was removed.\n');
    }
  }
  const needed = connectionNeedsKey(connection);
  const question = needed ? 'API key: ' : 'API key (Enter skips this one): ';
  const key = (await prompter.secret(question)).trim();
  return { kept: false, ...(key.length === 0 ? {} : { key }) };
}

/**
 * The whole flow. It returns a process code; a refusal prints one sentence and
 * saves nothing.
 */
export async function runWizard(options: SetupOptions): Promise<number> {
  const { streams, prompter } = options;
  const picked = await pickProvider(options);
  if (picked === null) {
    return 1;
  }

  let connection: ConnectionConfig;
  let custom = false;
  if (picked === 'custom') {
    custom = true;
    const url = await askUrl(options);
    if (url === null) {
      return 1;
    }
    connection = { id: uniqueId(options.env, 'custom'), kind: 'openai', baseUrl: url };
  } else {
    const found = preset(picked);
    if (found === undefined) {
      streams.err(`No provider called '${picked}'.\n`);
      return 1;
    }
    const config = loadConfig(options.env);
    const existing = config.connections.find((entry) => entry.id === found.id);
    connection =
      existing === undefined
        ? { id: found.id, kind: found.kind, baseUrl: found.baseUrl }
        : { ...existing };
  }

  const chosenKey = await chooseKey(connection, options);
  const chosen = await chooseModel(connection, options);
  if (chosen === null) {
    streams.err('No model chosen; nothing was saved.\n');
    return 1;
  }

  // A custom endpoint that did not say how large its window is gets one
  // question, once. The fold and the status line both use it.
  if (custom && chosen.advertised === undefined) {
    const answer = (
      await prompter.ask('Context length in tokens (Enter skips): ')
    ).trim();
    const size = Number(answer);
    if (answer.length > 0 && Number.isInteger(size) && size > 0) {
      connection = { ...connection, contextWindow: size };
    }
  }

  const config = loadConfig(options.env);
  const without = config.connections.filter((entry) => entry.id !== connection.id);
  const next = { ...config, connections: [...without, connection] };
  next.model = `${connection.id}:${chosen.model}`;
  saveConfig(next, options.env);

  if (!chosenKey.kept && chosenKey.key !== undefined) {
    await saveKey(connection.id, chosenKey.key, {
      env: options.env,
      keychain: options.keychain,
    });
  } else if (!chosenKey.kept && connectionNeedsKey(connection)) {
    streams.out(
      `No key saved. Set ${`PLATO_KEY_${connection.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`} before the first run.\n`,
    );
  }

  streams.out(`Saved. Using ${next.model}.\n`);
  return 0;
}
