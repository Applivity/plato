import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectKey } from '../src/paths.js';
import {
  HISTORY_LIMIT,
  historyPath,
  loadHistory,
  parseHistory,
  recordHistory,
  relativeTime,
  saveHistory,
  searchHistory,
  type HistoryEntry,
} from '../src/history.js';

const at = (iso: string) => new Date(iso);

function entry(text: string, iso = '2026-11-17T10:00:00.000Z'): HistoryEntry {
  return { text, at: iso };
}

describe('recording history', () => {
  it('appends a line with its time', () => {
    const next = recordHistory([entry('first')], 'second', at('2026-11-17T10:01:00.000Z'));
    expect(next).toEqual([
      entry('first'),
      { text: 'second', at: '2026-11-17T10:01:00.000Z' },
    ]);
  });

  it('keeps one entry for consecutive repeats and refreshes its time', () => {
    const once = recordHistory([], 'same', at('2026-11-17T10:00:00.000Z'));
    const twice = recordHistory(once, 'same', at('2026-11-17T10:05:00.000Z'));
    expect(twice).toEqual([{ text: 'same', at: '2026-11-17T10:05:00.000Z' }]);
    // A repeat that is not consecutive is a separate line.
    const apart = recordHistory([...twice, entry('other')], 'same');
    expect(apart.map((item) => item.text)).toEqual(['same', 'other', 'same']);
  });

  it('keeps only the last N lines', () => {
    let entries: HistoryEntry[] = [];
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      entries = recordHistory(entries, `line ${index}`);
    }
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0]?.text).toBe('line 5');
    expect(entries.at(-1)?.text).toBe(`line ${HISTORY_LIMIT + 4}`);
  });

  it('records nothing for an empty or whitespace line', () => {
    const entries = [entry('kept')];
    expect(recordHistory(entries, '   ')).toEqual(entries);
  });
});

describe('the history file', () => {
  const root = '/work/one';

  it('lives in the data home, one file per workspace', () => {
    const env = { PLATO_DATA_DIR: '/data/plato' };
    expect(historyPath(root, env)).toBe(
      join('/data/plato', 'history', `${projectKey(root)}.json`),
    );
    expect(historyPath('/work/two', env)).not.toBe(historyPath(root, env));
    expect(historyPath(root, env).startsWith(root)).toBe(false);
  });

  it('reads only the shape it wrote', () => {
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"entries":[{"text":"a","at":"nope"},{"text":"","at":"2026-11-17T10:00:00.000Z"}]}')).toEqual([]);
    expect(
      parseHistory('{"entries":[{"text":"a","at":"2026-11-17T10:00:00.000Z","extra":1}]}'),
    ).toEqual([entry('a')]);
  });

  it('round-trips through a private file', () => {
    const data = mkdtempSync(join(tmpdir(), 'plato-history-test-'));
    const env = { PLATO_DATA_DIR: data };
    saveHistory(root, env, [entry('a'), entry('b')]);
    expect(loadHistory(root, env)).toEqual([entry('a'), entry('b')]);
    if (process.platform !== 'win32') {
      expect(statSync(historyPath(root, env)).mode & 0o777).toBe(0o600);
    }
  });

  it('is empty when the file does not exist or cannot be parsed', () => {
    const data = mkdtempSync(join(tmpdir(), 'plato-history-test-'));
    const env = { PLATO_DATA_DIR: data };
    expect(loadHistory(root, env)).toEqual([]);
    mkdirSync(join(data, 'history'), { recursive: true });
    writeFileSync(historyPath(root, env), '{"entries":"no"}');
    expect(loadHistory(root, env)).toEqual([]);
  });

  it('caps a hand-written file at the limit when it is read', () => {
    const data = mkdtempSync(join(tmpdir(), 'plato-history-test-'));
    const env = { PLATO_DATA_DIR: data };
    const entries = Array.from({ length: HISTORY_LIMIT + 3 }, (_, index) =>
      entry(`line ${index}`),
    );
    saveHistory(root, env, entries);
    expect(loadHistory(root, env)).toHaveLength(HISTORY_LIMIT);
    expect(JSON.parse(readFileSync(historyPath(root, env), 'utf8')).entries).toHaveLength(
      HISTORY_LIMIT + 3,
    );
  });
});

describe('reverse search', () => {
  const entries = [entry('older probe', '2026-11-17T10:00:00.000Z'), entry('newer probe', '2026-11-17T10:01:00.000Z'), entry('unrelated')];

  it('starts at the most recent match and filters without case', () => {
    expect(searchHistory(entries, 'PROBE').map((item) => item.text)).toEqual([
      'newer probe',
      'older probe',
    ]);
  });

  it('returns everything newest first for an empty query', () => {
    expect(searchHistory(entries, '').map((item) => item.text)).toEqual([
      'unrelated',
      'newer probe',
      'older probe',
    ]);
  });

  it('returns nothing when no line contains the query', () => {
    expect(searchHistory(entries, 'missing')).toEqual([]);
  });
});

describe('how recent a line is', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');

  it('reads the ages a person uses', () => {
    expect(relativeTime('2026-11-17T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-11-17T11:57:00.000Z', now)).toBe('3m ago');
    expect(relativeTime('2026-11-17T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-11-14T12:00:00.000Z', now)).toBe('3d ago');
    expect(relativeTime('2026-11-01T12:00:00.000Z', now)).toBe('2w ago');
  });

  it('does not go negative on a clock that moved back', () => {
    expect(relativeTime('2026-11-17T12:05:00.000Z', now)).toBe('just now');
    expect(relativeTime('not a date', now)).toBe('');
  });
});
