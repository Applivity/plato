import { createElement } from 'react';
import { render } from 'ink';
import { PROVIDER_PRESETS, fetchModelPool } from '@applivity/plato-core';
import { loadConfig, saveConfig, type ConnectionConfig } from './config.js';
import type { Streams } from './io.js';
import { saveKey, type Keychain } from './keys.js';
import type { Env } from './paths.js';
import { SetupScreen, type SetupResult } from './tui/Setup.js';

/**
 * Setup: one screen, used by the first run, `plato auth login`, and
 * `/model add`. The questions are Ink, not readline, so nothing draws over
 * them. The logic below is what the screen saves and what it asks the endpoint.
 */

/** The first screen. The rest of the presets follow, then Custom endpoint. */
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

export interface ProviderChoice {
  id: string;
  label: string;
  kind: 'anthropic' | 'openai';
  baseUrl?: string;
  custom?: true;
}

export function providerChoices(): ProviderChoice[] {
  const byId = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));
  const ordered = [
    ...TOP.map((id) => byId.get(id)).filter((preset) => preset !== undefined),
    ...PROVIDER_PRESETS.filter((preset) => !TOP.includes(preset.id)),
  ];
  return [
    ...ordered.map((preset) => ({
      id: preset.id,
      label: preset.label,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
    })),
    { id: 'custom', label: 'Custom endpoint', kind: 'openai', custom: true },
  ];
}

export function connectionFor(choice: ProviderChoice, url?: string): ConnectionConfig {
  if (choice.custom === true) {
    return { id: 'custom', kind: 'openai', ...(url === undefined ? {} : { baseUrl: url }) };
  }
  return {
    id: choice.id,
    kind: choice.kind,
    ...(choice.baseUrl === undefined ? {} : { baseUrl: choice.baseUrl }),
  };
}

/** What `/models` said, in three plain cases. */
export type ModelAnswer =
  | { kind: 'ok'; entries: { id: string; maxContext?: number }[] }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unreachable'; reason: string };

export async function askModels(
  connection: ConnectionConfig,
  apiKey: string,
  options: { fetchImpl?: typeof fetch },
): Promise<ModelAnswer> {
  try {
    const entries = await fetchModelPool({
      kind: connection.kind,
      apiKey,
      ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    return {
      kind: 'ok',
      entries: entries.map((entry) => ({
        id: entry.id,
        ...(entry.maxContext === undefined ? {} : { maxContext: entry.maxContext }),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b(401|403)\b/.test(message)) {
      return { kind: 'rejected', reason: 'the endpoint said the key is not accepted' };
    }
    const short = message.replace(/^Cannot list models for [^:]+:\s*/, '').slice(0, 120);
    return { kind: 'unreachable', reason: short };
  }
}

export interface SaveSetupInput {
  env: Env;
  keychain?: Keychain | null;
  connection: ConnectionConfig;
  /** A key to save. Absent when an existing key is kept. */
  key?: string;
  model: string;
  contextWindow?: number;
}

/** Writes the connection, the key and the model together. */
export async function saveSetup(input: SaveSetupInput): Promise<string> {
  const connection: ConnectionConfig = {
    ...input.connection,
    ...(input.contextWindow === undefined ? {} : { contextWindow: input.contextWindow }),
  };
  const config = loadConfig(input.env);
  const without = config.connections.filter((entry) => entry.id !== connection.id);
  const next = { ...config, connections: [...without, connection] };
  next.model = `${connection.id}:${input.model}`;
  saveConfig(next, input.env);
  if (input.key !== undefined && input.key.length > 0) {
    await saveKey(connection.id, input.key, {
      env: input.env,
      keychain: input.keychain,
    });
  }
  return next.model;
}

/**
 * Standalone: the first run and `plato auth login`. It renders the same screen
 * and unmounts it when the screen is done, so the caller can start the session.
 */
export async function runSetup(options: {
  env: Env;
  streams: Streams;
  fetchImpl?: typeof fetch;
  offer?: boolean;
  provider?: string;
}): Promise<{ code: number; declined: boolean; model?: string }> {
  return await new Promise((resolve) => {
    let instance: ReturnType<typeof render> | undefined;
    const finish = (result: SetupResult): void => {
      instance?.unmount();
      if (result.declined === true) {
        options.streams.out(
          "No provider is set up. Run 'plato auth login' when you are ready.\n",
        );
      } else if (!result.saved) {
        options.streams.out('Setup cancelled; nothing changed.\n');
      }
      resolve({
        code: result.saved ? 0 : 1,
        declined: result.declined === true,
        ...(result.model === undefined ? {} : { model: result.model }),
      });
    };
    instance = render(
      createElement(SetupScreen, {
        env: options.env,
        offer: options.offer === true,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        onDone: finish,
      }),
      { exitOnCtrlC: false },
    );
  });
}
