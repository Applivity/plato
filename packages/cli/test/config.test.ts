import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  validateConfig,
} from '../src/config.js';
import { configPath } from '../src/paths.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config', () => {
  it('returns the defaults when the file does not exist', () => {
    const env = { PLATO_CONFIG_DIR: tempDir() };
    const config = loadConfig(env);
    expect(config.connections).toEqual([]);
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(config.mode).toBe('edit');
    expect(config.team).toBe('solo');
  });

  it('round-trips a saved config', () => {
    const env = { PLATO_CONFIG_DIR: tempDir() };
    saveConfig(
      {
        connections: [{ id: 'litellm', kind: 'openai', baseUrl: 'http://localhost:4000/v1' }],
        model: 'litellm:gpt-4o',
        team: 'duo',
        mode: 'auto',
        reasoning: 'high',
        compactionThreshold: 0.7,
        respectGitignore: false,
      },
      env,
    );
    expect(loadConfig(env)).toEqual({
      connections: [{ id: 'litellm', kind: 'openai', baseUrl: 'http://localhost:4000/v1' }],
      model: 'litellm:gpt-4o',
      team: 'duo',
      mode: 'auto',
      reasoning: 'high',
      compactionThreshold: 0.7,
      respectGitignore: false,
    });
  });

  it('names the file and the position of a JSON error', () => {
    const env = { PLATO_CONFIG_DIR: tempDir() };
    writeFileSync(configPath(env), '{ "connections": [ }');
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/not valid JSON/);
  });

  it('rejects a connection with an unknown kind, naming the field', () => {
    expect(() =>
      validateConfig({ connections: [{ id: 'x', kind: 'google' }] }, 'config.json'),
    ).toThrow(/connections\[0\]\.kind/);
  });

  it('rejects duplicate connection ids', () => {
    expect(() =>
      validateConfig(
        {
          connections: [
            { id: 'same', kind: 'openai' },
            { id: 'same', kind: 'anthropic' },
          ],
        },
        'config.json',
      ),
    ).toThrow(/twice/);
  });

  it('rejects a compaction threshold outside 0.5 to 0.95', () => {
    expect(() => validateConfig({ compactionThreshold: 0.3 })).toThrow(/compactionThreshold/);
    expect(() => validateConfig({ compactionThreshold: 1 })).toThrow(/compactionThreshold/);
  });

  it('rejects a base URL that is not http or https', () => {
    expect(() =>
      validateConfig({ connections: [{ id: 'x', kind: 'openai', baseUrl: 'file:///etc/passwd' }] }),
    ).toThrow(/http or https/);
  });

  it('fills absent fields with defaults', () => {
    const config = validateConfig({ connections: [{ id: 'x', kind: 'anthropic' }] });
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(config.reasoning).toBe('off');
    expect(config.compactionThreshold).toBe(0.8);
  });
});
