import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir, projectKey, type Env } from './paths.js';

/**
 * The composer's history, per workspace (round 2).
 *
 * The file lives in the data home, never in the project: a line can quote a
 * secret, so it is private to the user and written mode 0600 like a session.
 * One file per workspace keeps `plato` run in another directory from mixing
 * its lines into this one's search.
 */
export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  text: string;
  /** ISO time the line was last used, for "3m ago" in the search row. */
  at: string;
}

export function historyPath(root: string, env: Env = process.env): string {
  return join(dataDir(env), 'history', `${projectKey(root)}.json`);
}

/** Reads only what this module writes; anything else is ignored, not trusted. */
export function parseHistory(text: string): HistoryEntry[] {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return [];
    }
    const entries = (raw as Record<string, unknown>)['entries'];
    if (!Array.isArray(entries)) {
      return [];
    }
    const parsed: HistoryEntry[] = [];
    for (const value of entries) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const entry = value as Record<string, unknown>;
      const line = entry['text'];
      const at = entry['at'];
      if (
        typeof line !== 'string' ||
        line.trim().length === 0 ||
        typeof at !== 'string' ||
        Number.isNaN(Date.parse(at))
      ) {
        continue;
      }
      parsed.push({ text: line, at });
    }
    return parsed.slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function loadHistory(root: string, env: Env = process.env): HistoryEntry[] {
  try {
    return parseHistory(readFileSync(historyPath(root, env), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * The next history. A consecutive repeat keeps one entry and refreshes its
 * time: the same line typed twice in a row is one line in the search, and its
 * age tells how recent the latest use was.
 */
export function recordHistory(
  entries: readonly HistoryEntry[],
  line: string,
  at = new Date(),
): HistoryEntry[] {
  const text = line.trim();
  if (text.length === 0) {
    return [...entries];
  }
  const next = [...entries];
  const last = next.at(-1);
  if (last?.text === text) {
    next[next.length - 1] = { text, at: at.toISOString() };
  } else {
    next.push({ text, at: at.toISOString() });
  }
  return next.slice(-HISTORY_LIMIT);
}

/** Best effort: a history that cannot be saved must not stop the session. */
export function saveHistory(
  root: string,
  env: Env,
  entries: readonly HistoryEntry[],
): void {
  const path = historyPath(root, env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** Newest first, because reverse search starts at the most recent match. */
export function searchHistory(
  entries: readonly HistoryEntry[],
  query: string,
): HistoryEntry[] {
  const needle = query.toLowerCase();
  const found: HistoryEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && entry.text.toLowerCase().includes(needle)) {
      found.push(entry);
    }
  }
  return found;
}

export function relativeTime(at: string, now = Date.now()): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return `${Math.floor(days / 7)}w ago`;
}
