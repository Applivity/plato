import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Mode } from '@applivity/plato-core';
import type { Team } from './config.js';
import { platoHome, projectKey, type Env } from './paths.js';

/**
 * The CLI's session store (M5): `~/.plato/sessions/<project-key>/<id>.json`.
 *
 * Unlike runs and undo, this is the CLI's own store: a session is the
 * conversation the composer resumes, not the record of what a run did. One
 * file per session, atomic writes, mode 0600 — a conversation can quote a
 * secret even when the transcript schema is careful.
 */
export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  mode: Mode;
  team: Team;
  history: { role: 'user' | 'assistant'; text: string }[];
}

export function sessionsDir(root: string, env: Env = process.env): string {
  return join(platoHome(env), 'sessions', projectKey(root));
}

export function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export function createSession(
  model: string,
  mode: Mode,
  team: Team,
  now = new Date(),
): StoredSession {
  const at = now.toISOString();
  return {
    id: newSessionId(now),
    title: '',
    createdAt: at,
    updatedAt: at,
    model,
    mode,
    team,
    history: [],
  };
}

/**
 * D49cq: the fixed opening of the header a run sees when another session sent
 * the message. It lives here so the title can skip such a turn: a session whose
 * first task came from a peer is not named after the wrapper.
 */
export const INBOUND_MARKER = '[Message from another Plato session —';

/** The name a session shows in saved lists and in the live registry. */
export function titleFor(history: StoredSession['history']): string {
  const first = history.find(
    (entry) => entry.role === 'user' && !entry.text.startsWith(INBOUND_MARKER),
  );
  if (first === undefined) {
    return '';
  }
  const line = first.text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function saveSession(
  root: string,
  env: Env,
  session: StoredSession,
  now = new Date(),
): void {
  const dir = sessionsDir(root, env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  session.updatedAt = now.toISOString();
  session.title = titleFor(session.history);
  const path = join(dir, `${session.id}.json`);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function parseSession(text: string): StoredSession | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record['id'] !== 'string' || !Array.isArray(record['history'])) {
      return null;
    }
    const history: StoredSession['history'] = [];
    for (const entry of record['history'] as unknown[]) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const role = row['role'];
      const textValue = row['text'];
      if ((role === 'user' || role === 'assistant') && typeof textValue === 'string') {
        history.push({ role, text: textValue });
      }
    }
    return {
      id: record['id'],
      title: typeof record['title'] === 'string' ? record['title'] : '',
      createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : '',
      updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '',
      model: typeof record['model'] === 'string' ? record['model'] : '',
      mode:
        record['mode'] === 'plan' || record['mode'] === 'auto' || record['mode'] === 'edit'
          ? record['mode']
          : 'edit',
      team:
        record['team'] === 'duo' || record['team'] === 'academy' ? record['team'] : 'solo',
      history,
    };
  } catch {
    return null;
  }
}

/** Newest first. A malformed file is skipped: the store is a convenience. */
export function listSessions(root: string, env: Env = process.env): StoredSession[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir(root, env));
  } catch {
    return [];
  }
  const sessions: StoredSession[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const parsed = parseSession(
        readFileSync(join(sessionsDir(root, env), name), 'utf8'),
      );
      if (parsed !== null) {
        sessions.push(parsed);
      }
    } catch {
      // Unreadable: skip it.
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Accepts a full id or a unique prefix. */
export function loadSession(
  root: string,
  env: Env,
  idOrPrefix: string,
): StoredSession | null {
  const sessions = listSessions(root, env);
  const exact = sessions.find((session) => session.id === idOrPrefix);
  if (exact !== undefined) {
    return exact;
  }
  const matches = sessions.filter((session) => session.id.startsWith(idOrPrefix));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function latestSession(root: string, env: Env = process.env): StoredSession | null {
  return listSessions(root, env)[0] ?? null;
}

export function deleteSession(
  root: string,
  env: Env,
  idOrPrefix: string,
): boolean {
  const session = loadSession(root, env, idOrPrefix);
  if (session === null) {
    return false;
  }
  try {
    rmSync(join(sessionsDir(root, env), `${session.id}.json`));
    return true;
  } catch {
    return false;
  }
}
