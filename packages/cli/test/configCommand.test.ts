import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../src/config.js';
import { runConfig } from '../src/configCommand.js';
import { configPath } from '../src/paths.js';

const dirs: string[] = [];

function environment(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-config-'));
  dirs.push(dir);
  return { PLATO_CONFIG_DIR: join(dir, 'config'), PLATO_DATA_DIR: dir, PLATO_HOME: dir };
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
    streams: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

function seeded(): Record<string, string> {
  const env = environment();
  saveConfig(
    {
      ...DEFAULT_CONFIG,
      connections: [{ id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1' }],
      model: 'stub:test-model',
    },
    env,
  );
  return env;
}

describe('plato config', () => {
  it('shows every setting, and one on request', async () => {
    const env = seeded();
    const all = capture();
    expect(await runConfig([], { env, streams: all.streams })).toBe(0);
    expect(all.out()).toContain('model: stub:test-model');
    expect(all.out()).toContain('respectGitignore: false');
    expect(all.out()).toContain('compactionIdle: false');

    const one = capture();
    expect(await runConfig(['get', 'mode'], { env, streams: one.streams })).toBe(0);
    expect(one.out()).toBe('edit\n');
  });

  it('sets a boolean in each spelling and saves it', async () => {
    for (const [input, expected] of [
      ['on', true],
      ['true', true],
      ['yes', true],
      ['off', false],
      ['false', false],
      ['no', false],
    ] as const) {
      const env = seeded();
      const io = capture();
      expect(await runConfig(['set', 'respectGitignore', input], { env, streams: io.streams })).toBe(0);
      expect(loadConfig(env).respectGitignore).toBe(expected);
      expect(io.out()).toContain('saved in');
    }
  });

  it('turns idle compaction on and off, and refuses a word that is neither', async () => {
    const env = seeded();
    const on = capture();
    expect(await runConfig(['set', 'compactionIdle', 'on'], { env, streams: on.streams })).toBe(0);
    expect(loadConfig(env).compactionIdle).toBe(true);
    expect(on.out()).toContain('compactionIdle: true');

    const bad = capture();
    expect(await runConfig(['set', 'compactionIdle', 'sometimes'], { env, streams: bad.streams })).toBe(2);
    expect(bad.err()).toContain('compactionIdle must be true or false');
    expect(loadConfig(env).compactionIdle).toBe(true);
  });

  it('refuses a value it cannot use, and changes nothing', async () => {    const env = seeded();
    const io = capture();
    expect(await runConfig(['set', 'respectGitignore', 'maybe'], { env, streams: io.streams })).toBe(2);
    expect(io.err()).toContain('must be true or false');
    expect(loadConfig(env).respectGitignore).toBe(false);

    const mode = capture();
    expect(await runConfig(['set', 'mode', 'turbo'], { env, streams: mode.streams })).toBe(2);
    expect(loadConfig(env).mode).toBe(DEFAULT_CONFIG.mode);

    const model = capture();
    expect(await runConfig(['set', 'model', 'nope:gpt'], { env, streams: model.streams })).toBe(2);
    expect(model.err()).toContain('is not connection:model');

    const threshold = capture();
    expect(
      await runConfig(['set', 'compactionThreshold', '0.1'], { env, streams: threshold.streams }),
    ).toBe(2);
  });

  it('names an unknown setting instead of guessing', async () => {
    const env = seeded();
    const io = capture();
    expect(await runConfig(['set', 'colour', 'blue'], { env, streams: io.streams })).toBe(2);
    expect(io.err()).toContain("usage is 'plato config set <key> <value>'");
    const get = capture();
    expect(await runConfig(['get', 'colour'], { env, streams: get.streams })).toBe(2);
    expect(get.err()).toContain("unknown setting 'colour'");
  });

  it('never prints a key: the config has none', async () => {
    const env = seeded();
    env['PLATO_KEY_STUB'] = 'sk-secret-value';
    const io = capture();
    runConfig([], { env, streams: io.streams });
    expect(io.out()).not.toContain('sk-secret-value');
  });

  it('creates the config when none exists', async () => {
    const env = environment();
    const io = capture();
    expect(await runConfig(['set', 'mode', 'auto'], { env, streams: io.streams })).toBe(0);
    expect(loadConfig(env).mode).toBe('auto');
  });

  it('refuses to write over a config it cannot read', async () => {
    const env = environment();
    mkdirSync(env['PLATO_CONFIG_DIR']!, { recursive: true });
    writeFileSync(configPath(env), '{');
    const io = capture();
    expect(await runConfig(['set', 'mode', 'auto'], { env, streams: io.streams })).toBe(1);
    expect(io.err()).toContain('not valid JSON');
    expect(readFileSync(configPath(env), 'utf8')).toBe('{');
  });
});
