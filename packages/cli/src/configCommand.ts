import { parseModelRef, type Mode } from '@applivity/plato-core';
import {
  ConfigError,
  loadConfig,
  saveConfig,
  type PlatoConfig,
  type Reasoning,
  type Team,
} from './config.js';
import type { Streams } from './io.js';
import { configPath, type Env } from './paths.js';

/**
 * `plato config` edits the settings a person changes between runs. Connections
 * and keys belong to `plato auth`; this command never reads, writes, or prints
 * a key, because the config file does not hold one.
 *
 * Every value is parsed and checked here rather than written raw: a setting the
 * CLI cannot use is a setting that should be refused at the moment it is typed,
 * not at the next run.
 */
export const CONFIG_HELP = `Usage
  plato config                       Show every setting
  plato config get <key>             Show one setting
  plato config set <key> <value>     Change one setting

Keys
  model                 connection:model, e.g. anthropic:claude-sonnet-4-5
  mode                  plan | edit | auto
  team                  solo | duo | academy
  reasoning             off | low | medium | high
  compactionThreshold   0.5 to 0.95
  respectGitignore      true | false — skip what .gitignore excludes
  compactionIdle        true | false — summarise after an hour idle, off by default

  true/false also accept on/off and yes/no.
`;

type Key =
  | 'model'
  | 'mode'
  | 'team'
  | 'reasoning'
  | 'compactionThreshold'
  | 'respectGitignore'
  | 'compactionIdle';

const KEYS: readonly Key[] = [
  'model',
  'mode',
  'team',
  'reasoning',
  'compactionThreshold',
  'respectGitignore',
  'compactionIdle',
];

function isKey(value: string): value is Key {
  return (KEYS as readonly string[]).includes(value);
}

function show(config: PlatoConfig, key: Key): string {
  return String(config[key]);
}

function parseBoolean(value: string): boolean | null {
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'on' || lower === 'yes') return true;
  if (lower === 'false' || lower === 'off' || lower === 'no') return false;
  return null;
}

/**
 * The new config, or a sentence saying what is wrong with the value. Parsing is
 * per key so a wrong value names the accepted ones instead of repeating the
 * schema.
 */
function withValue(
  config: PlatoConfig,
  key: Key,
  value: string,
): { next: PlatoConfig } | { error: string } {
  switch (key) {
    case 'model': {
      if (parseModelRef(value, config.connections.map((c) => c.id)) === null) {
        return {
          error: `'${value}' is not connection:model for a configured connection. Run 'plato auth login' to add one.`,
        };
      }
      return { next: { ...config, model: value } };
    }
    case 'mode': {
      if (value !== 'plan' && value !== 'edit' && value !== 'auto') {
        return { error: 'mode must be plan, edit, or auto' };
      }
      return { next: { ...config, mode: value as Mode } };
    }
    case 'team': {
      if (value !== 'solo' && value !== 'duo' && value !== 'academy') {
        return { error: 'team must be solo, duo, or academy' };
      }
      return { next: { ...config, team: value as Team } };
    }
    case 'reasoning': {
      if (value !== 'off' && value !== 'low' && value !== 'medium' && value !== 'high') {
        return { error: 'reasoning must be off, low, medium, or high' };
      }
      return { next: { ...config, reasoning: value as Reasoning } };
    }
    case 'compactionThreshold': {
      const threshold = Number(value);
      if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.95) {
        return { error: 'compactionThreshold must be a number from 0.5 to 0.95' };
      }
      return { next: { ...config, compactionThreshold: threshold } };
    }
    case 'respectGitignore': {
      const parsed = parseBoolean(value);
      if (parsed === null) {
        return { error: 'respectGitignore must be true or false' };
      }
      return { next: { ...config, respectGitignore: parsed } };
    }
    case 'compactionIdle': {
      const parsed = parseBoolean(value);
      if (parsed === null) {
        return { error: 'compactionIdle must be true or false' };
      }
      return { next: { ...config, compactionIdle: parsed } };
    }
  }
}

export function runConfig(
  args: readonly string[],
  options: { env: Env; streams: Streams },
): number {
  const { streams } = options;
  const [sub, key, value] = args;
  if (sub === '-h' || sub === '--help') {
    streams.out(CONFIG_HELP);
    return 0;
  }

  let config: PlatoConfig;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    streams.err(`plato: ${error instanceof ConfigError ? error.message : String(error)}\n`);
    return 1;
  }

  if (sub === undefined || (sub === 'get' && key === undefined)) {
    for (const name of KEYS) {
      streams.out(`${name}: ${show(config, name)}\n`);
    }
    return 0;
  }

  if (sub === 'get') {
    const name = key ?? '';
    if (!isKey(name)) {
      streams.err(`plato config: unknown setting '${name}'.\n${CONFIG_HELP}\n`);
      return 2;
    }
    streams.out(`${show(config, name)}\n`);
    return 0;
  }

  if (sub === 'set') {
    const name = key ?? '';
    if (!isKey(name) || value === undefined) {
      streams.err(`plato config: usage is 'plato config set <key> <value>'.\n${CONFIG_HELP}\n`);
      return 2;
    }
    const result = withValue(config, name, value);
    if ('error' in result) {
      streams.err(`plato config: ${result.error}\n`);
      return 2;
    }
    try {
      saveConfig(result.next, options.env);
    } catch (error) {
      streams.err(`plato: could not save the config: ${(error as Error).message}\n`);
      return 1;
    }
    streams.out(`${name}: ${show(result.next, name)} (saved in ${configPath(options.env)})\n`);
    return 0;
  }

  streams.err(`plato config: unknown command '${sub}'.\n${CONFIG_HELP}\n`);
  return 2;
}
