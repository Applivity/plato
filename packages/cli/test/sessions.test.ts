import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSession,
  deleteSession,
  latestSession,
  listSessions,
  loadSession,
  saveSession,
  sessionsDir,
} from '../src/sessions.js';
import { runSessions } from '../src/sessionsCommand.js';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup() {
  const root = tempDir('plato-sessions-root-');
  const home = tempDir('plato-sessions-home-');
  const env = { PLATO_HOME: home };
  return { root, env };
}

describe('session store', () => {
  it('saves, lists, and loads a session', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    session.history.push({ role: 'user', text: 'fix the parser' });
    session.history.push({ role: 'assistant', text: 'Done.' });
    saveSession(root, env, session);

    const sessions = listSessions(root, env);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(session.id);
    expect(sessions[0]?.title).toBe('fix the parser');
    expect(loadSession(root, env, session.id)).toMatchObject({
      model: 'stub:test',
      history: [
        { role: 'user', text: 'fix the parser' },
        { role: 'assistant', text: 'Done.' },
      ],
    });
  });

  it.skipIf(process.platform === 'win32')('writes the file with mode 0600', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, session);
    const path = join(sessionsDir(root, env), `${session.id}.json`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('finds a session by a unique prefix and refuses an ambiguous one', () => {
    const { root, env } = setup();
    const first = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, first);
    expect(loadSession(root, env, first.id.slice(0, 8))?.id).toBe(first.id);

    const twin = { ...first, id: `${first.id.slice(0, 8)}ffff` };
    saveSession(root, env, twin);
    expect(loadSession(root, env, first.id.slice(0, 8))).toBeNull();
  });

  it('returns the newest session last-saved first', () => {
    const { root, env } = setup();
    const older = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, older, new Date('2026-01-01T00:00:00Z'));
    const newer = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, newer, new Date('2026-02-01T00:00:00Z'));
    expect(latestSession(root, env)?.id).toBe(newer.id);
  });

  it('skips a malformed file', () => {
    const { root, env } = setup();
    const dir = sessionsDir(root, env);
    const good = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, good);
    writeFileSync(join(dir, 'broken.json'), '{');
    expect(listSessions(root, env)).toHaveLength(1);
  });

  it('deletes by id and reports a miss', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, session);
    expect(deleteSession(root, env, session.id)).toBe(true);
    expect(listSessions(root, env)).toEqual([]);
    expect(deleteSession(root, env, session.id)).toBe(false);
    expect(readdirSync(sessionsDir(root, env))).toEqual([]);
  });
});

describe('sessions command', () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      streams: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
      out: () => out.join(''),
      err: () => err.join(''),
    };
  }

  it('lists saved conversations', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    session.history.push({ role: 'user', text: 'fix it' });
    saveSession(root, env, session);
    const io = capture();
    expect(runSessions(['list'], { root, env, streams: io.streams })).toBe(0);
    expect(io.out()).toContain(session.id);
    expect(io.out()).toContain('fix it');
  });

  it('exports JSON and the latest by default', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, session);
    const io = capture();
    expect(runSessions(['export'], { root, env, streams: io.streams })).toBe(0);
    expect((JSON.parse(io.out()) as { id: string }).id).toBe(session.id);
  });

  it('deletes and reports an unknown id', () => {
    const { root, env } = setup();
    const session = createSession('stub:test', 'edit', 'solo');
    saveSession(root, env, session);

    const first = capture();
    expect(runSessions(['delete', session.id], { root, env, streams: first.streams })).toBe(0);

    const second = capture();
    expect(runSessions(['delete', 'missing'], { root, env, streams: second.streams })).toBe(1);
    expect(second.err()).toContain('no session');
  });

  it('needs a subcommand', () => {
    const { root, env } = setup();
    const io = capture();
    expect(runSessions([], { root, env, streams: io.streams })).toBe(2);
    expect(io.err()).toContain('Usage');
  });
});
