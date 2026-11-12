import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Mode } from '@applivity/plato-core';
import { configPath, type Env } from './paths.js';

/**
 * `~/.config/plato/config.json` (D49bx). It holds connections, the default
 * model, the mode, the team, and compaction. It never holds a key.
 *
 * Validation is loud (D11): a hand-edited file with a wrong type stops the
 * command and names the field. An absent file is not an error; it means
 * defaults.
 */
export interface ConnectionConfig {
  id: string;
  kind: 'anthropic' | 'openai';
  baseUrl?: string;
}

export type Team = 'solo' | 'duo' | 'academy';
export type Reasoning = 'off' | 'low' | 'medium' | 'high';

export interface PlatoConfig {
  connections: ConnectionConfig[];
  /** `connection:model`, the same shape the extension stores. */
  model: string;
  team: Team;
  mode: Mode;
  reasoning: Reasoning;
  compactionThreshold: number;
  /**
   * D49bz: search skips what the repository's `.gitignore` excludes. Off by
   * default — a run sees everything and is told what the repository ignores.
   */
  respectGitignore: boolean;
  /**
   * D49cm: compact while the chat is idle. Off by default, because it
   * summarises BELOW the user's threshold — an hour of silence and at least
   * 200,000 estimated tokens of history. Optional so a config built by an older
   * caller (or a test) reads as off.
   */
  compactionIdle?: boolean;
}

export const DEFAULT_CONFIG: PlatoConfig = {
  connections: [],
  model: 'anthropic:claude-sonnet-4-5',
  team: 'solo',
  mode: 'edit',
  reasoning: 'off',
  compactionThreshold: 0.8,
  respectGitignore: false,
  compactionIdle: false,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ConfigError(`${where}.${key} must be a string`);
  }
  return value;
}

function enumAt<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  where: string,
): T {
  const value = raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ConfigError(`${where}.${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function connectionAt(value: unknown, where: string): ConnectionConfig {
  const raw = objectAt(value, where);
  const id = optionalString(raw, 'id', where);
  if (id === undefined || id.length === 0) {
    throw new ConfigError(`${where}.id is required`);
  }
  if (!CONNECTION_ID.test(id)) {
    throw new ConfigError(
      `${where}.id must start with a letter or digit and use only letters, digits, ".", "_", or "-"`,
    );
  }
  const kind = raw['kind'];
  if (kind !== 'anthropic' && kind !== 'openai') {
    throw new ConfigError(`${where}.kind must be "anthropic" or "openai"`);
  }
  const baseUrl = optionalString(raw, 'baseUrl', where);
  if (baseUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ConfigError(`${where}.baseUrl is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ConfigError(`${where}.baseUrl must use http or https`);
    }
  }
  return baseUrl === undefined ? { id, kind } : { id, kind, baseUrl };
}

export function validateConfig(value: unknown, where = 'config'): PlatoConfig {
  const raw = objectAt(value, where);

  const connectionsRaw = raw['connections'] ?? [];
  if (!Array.isArray(connectionsRaw)) {
    throw new ConfigError(`${where}.connections must be an array`);
  }
  const connections = connectionsRaw.map((entry, index) =>
    connectionAt(entry, `${where}.connections[${index}]`),
  );
  const ids = new Set<string>();
  for (const connection of connections) {
    if (ids.has(connection.id)) {
      throw new ConfigError(`${where}.connections has the id "${connection.id}" twice`);
    }
    ids.add(connection.id);
  }

  const model = optionalString(raw, 'model', where) ?? DEFAULT_CONFIG.model;
  const team = enumAt(raw, 'team', ['solo', 'duo', 'academy'] as const, DEFAULT_CONFIG.team, where);
  const mode = enumAt(raw, 'mode', ['plan', 'edit', 'auto'] as const, DEFAULT_CONFIG.mode, where);
  const reasoning = enumAt(
    raw,
    'reasoning',
    ['off', 'low', 'medium', 'high'] as const,
    DEFAULT_CONFIG.reasoning,
    where,
  );

  const threshold = raw['compactionThreshold'] ?? DEFAULT_CONFIG.compactionThreshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.95) {
    throw new ConfigError(`${where}.compactionThreshold must be a number from 0.5 to 0.95`);
  }

  const respectGitignore = raw['respectGitignore'] ?? DEFAULT_CONFIG.respectGitignore;
  if (typeof respectGitignore !== 'boolean') {
    throw new ConfigError(`${where}.respectGitignore must be true or false`);
  }

  const compactionIdle = raw['compactionIdle'] ?? DEFAULT_CONFIG.compactionIdle;
  if (typeof compactionIdle !== 'boolean') {
    throw new ConfigError(`${where}.compactionIdle must be true or false`);
  }

  return {
    connections,
    model,
    team,
    mode,
    reasoning,
    compactionThreshold: threshold,
    respectGitignore,
    compactionIdle,
  };
}

/** Loads the config. A missing file yields the defaults; a broken one throws. */
export function loadConfig(env: Env = process.env): PlatoConfig {
  const path = configPath(env);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_CONFIG, connections: [] };
    }
    throw new ConfigError(`Cannot read ${path}: ${(error as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  return validateConfig(raw, path);
}

/** Writes the config through a temporary file, so a crash cannot truncate it. */
export function saveConfig(config: PlatoConfig, env: Env = process.env): void {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temporary, path);
}

/** True when the file exists; used by the doctor's report. */
export function configExists(env: Env = process.env): boolean {
  return existsSync(configPath(env));
}
