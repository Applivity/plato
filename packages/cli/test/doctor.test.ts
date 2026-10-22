import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveConfig } from '../src/config.js';
import { runDoctor } from '../src/doctor.js';
import type { Keychain } from '../src/keys.js';
import { configPath, runsDir } from '../src/paths.js';

const dirs: string[] = [];

function tempEnv(extra: Record<string, string> = {}): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'plato-cli-doctor-'));
  dirs.push(dir);
  // PLATO_HOME matters as much as the other two: doctor writes to all three,
  // and a test that leaves it unset would write into the real ~/.plato.
  return {
    PLATO_CONFIG_DIR: dir,
    PLATO_DATA_DIR: dir,
    PLATO_HOME: join(dir, 'home'),
    ...extra,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function validConfig(env: Record<string, string>): void {
  saveConfig(
    {
      connections: [{ id: 'anthropic', kind: 'anthropic' }],
      model: 'anthropic:claude-sonnet-4-5',
      team: 'solo',
      mode: 'edit',
      reasoning: 'off',
      compactionThreshold: 0.8,
      respectGitignore: false,
    },
    env,
  );
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('doctor', () => {
  it('passes with a readable config and an environment key', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const io = capture();
    const code = await runDoctor({
      env,
      streams: io.streams,
      keychain: null,
    });
    expect(code).toBe(0);
    expect(io.out()).toContain('✓ Config');
    expect(io.out()).toContain('env:ANTHROPIC_API_KEY');
    expect(io.out()).not.toContain('sk-env');
  });

  it('fails when the default connection has no key', async () => {
    const env = tempEnv();
    validConfig(env);
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null });
    expect(code).toBe(1);
    expect(io.out()).toContain('✗ Key anthropic: no key');
    expect(io.out()).toContain("plato auth login anthropic");
  });

  it('fails on a config that is not valid JSON', async () => {
    const env = tempEnv();
    writeFileSync(configPath(env), '{');
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null });
    expect(code).toBe(1);
    expect(io.out()).toContain('✗ Config');
    expect(io.out()).toContain('not valid JSON');
  });

  it('fails when the default model names an unknown connection', async () => {
    const env = tempEnv();
    saveConfig(
      {
        connections: [{ id: 'other', kind: 'openai', baseUrl: 'http://localhost:1/v1' }],
        model: 'missing:gpt-4o',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
    );
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null });
    expect(code).toBe(1);
    expect(io.out()).toContain("the connection 'missing' is not configured");
  });

  it('fails on Node older than 22', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const io = capture();
    const code = await runDoctor({
      env,
      streams: io.streams,
      keychain: null,
      nodeVersion: '20.11.0',
    });
    expect(code).toBe(1);
    expect(io.out()).toContain('older than 22');
  });

  it('warns, but does not fail, when the keychain probe throws', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const keychain: Keychain = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {
        return false;
      },
      async list() {
        return [];
      },
      async probe() {
        throw new Error('locked');
      },
    };
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain });
    expect(code).toBe(0);
    expect(io.out()).toContain('! Keychain: locked');
  });
});

describe('doctor: state and the last run', () => {
  function runs(env: Record<string, string>, root: string) {
    const dir = runsDir(root, env);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('reports that it can write all three homes, and leaves nothing behind', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root: '/tmp/project' });
    expect(code).toBe(0);
    expect(io.out()).toContain('State');
    expect(io.out()).toContain('Search includes .gitignore paths');
    expect(io.out()).toContain('✓ Writes to');
    expect(io.out()).not.toMatch(/\.plato-doctor-/);
  });

  it('fails when a home cannot be written', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    mkdirSync(env['PLATO_HOME']!, { recursive: true });
    // chmod 0500 on a directory the owner does not own the parent of still
    // blocks creation of new files for a normal user.
    const { chmodSync } = await import('node:fs');
    chmodSync(env['PLATO_HOME']!, 0o500);
    try {
      const io = capture();
      const code = await runDoctor({
        env,
        streams: io.streams,
        keychain: null,
        root: '/tmp/project',
      });
      expect(code).toBe(1);
      expect(io.out()).toContain('✗ Cannot write');
    } finally {
      chmodSync(env['PLATO_HOME']!, 0o700);
    }
  });

  it('says when this directory has never been run', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root: '/tmp/never-run' });
    expect(code).toBe(0);
    expect(io.out()).toContain('! No runs yet in /tmp/never-run');
  });

  it('reports the newest run and how it ended', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const root = '/tmp/project-a';
    const dir = runs(env, root);
    writeFileSync(
      join(dir, '2026-01-01T00-00-00-000Z-old.jsonl'),
      `${JSON.stringify({ kind: 'header', startedAt: '2026-01-01T00:00:00.000Z' })}\n`,
    );
    writeFileSync(
      join(dir, '2026-10-21T10-00-00-000Z-new.jsonl'),
      [
        JSON.stringify({ kind: 'header', startedAt: new Date().toISOString() }),
        JSON.stringify({ type: 'run-completed', reason: 'complete', turns: 3 }),
        '',
      ].join('\n'),
    );
    const io = capture();
    await runDoctor({ env, streams: io.streams, keychain: null, root });
    expect(io.out()).toContain('✓ Last run just now: complete, 3 turns');
    expect(io.out()).toContain('(2 runs)');
    expect(io.out()).toContain('new.jsonl');
  });

  it('warns, without failing, when the last run failed', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const root = '/tmp/project-b';
    const dir = runs(env, root);
    writeFileSync(
      join(dir, '2026-10-21T10-00-00-000Z-failed.jsonl'),
      [
        JSON.stringify({ kind: 'header', startedAt: new Date().toISOString() }),
        JSON.stringify({ type: 'run-failed', error: 'provider returned 401' }),
        '',
      ].join('\n'),
    );
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root });
    expect(code).toBe(0);
    expect(io.out()).toContain('! Last run');
    expect(io.out()).toContain('failed: provider returned 401');
  });

  it('survives a transcript whose last line was never finished', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const root = '/tmp/project-c';
    const dir = runs(env, root);
    writeFileSync(
      join(dir, '2026-10-21T10-00-00-000Z-cut.jsonl'),
      `${JSON.stringify({ kind: 'header', startedAt: new Date().toISOString() })}\n{"type":"turn-sta`,
    );
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root });
    expect(code).toBe(0);
    expect(io.out()).toContain('no outcome was recorded');
  });

  it('mentions a run directory it cannot read without crashing', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    validConfig(env);
    const root = '/tmp/project-d';
    const dir = runs(env, root);
    writeFileSync(join(dir, '2026-10-21T10-00-00-000Z-x.jsonl'), '');
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root });
    expect(code).toBe(0);
    expect(io.out()).toContain('no outcome was recorded');
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBe(1);
  });
});

describe('doctor: the search setting', () => {
  it('says when search skips .gitignore paths', async () => {
    const env = tempEnv({ ANTHROPIC_API_KEY: 'sk-env' });
    saveConfig(
      {
        connections: [{ id: 'anthropic', kind: 'anthropic' }],
        model: 'anthropic:claude-sonnet-4-5',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: true,
      },
      env,
    );
    const io = capture();
    const code = await runDoctor({ env, streams: io.streams, keychain: null, root: '/tmp/p' });
    expect(code).toBe(0);
    expect(io.out()).toContain('✓ Search skips .gitignore paths');
  });
});
