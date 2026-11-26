import { renderToString } from 'ink';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RowView } from '../src/tui/App.js';
import type { Row } from '../src/session.js';

const COLUMNS = 60;

/** The drawn lines of one row, with the blank margin row above it dropped. */
function draw(row: Omit<Row, 'id'>): string[] {
  const out = renderToString(createElement(RowView, { row: { id: 1, ...row }, columns: COLUMNS }), {
    columns: COLUMNS,
  });
  return out.split('\n').filter((line) => line.trim().length > 0);
}

describe('a turn in the transcript', () => {
  // Over 80 characters, so at 60 columns the turn cannot fit on one line.
  const long =
    'ok now again share the summary of what changes are necessary step by step, no code change yet please';

  it('hangs a wrapped turn under its own text, not at the column of a tool line', () => {
    const lines = draw({ kind: 'user', text: long });
    expect(lines.length).toBeGreaterThan(1);
    // The glyph opens the first line, and the text begins at column 2.
    expect(lines[0]?.startsWith('› ')).toBe(true);
    expect(lines[0]?.slice(2).startsWith('ok now again')).toBe(true);
    // Each continuation begins at the text's own column: at column 0 it would
    // read as a bare tool line.
    for (const line of lines.slice(1)) {
      expect(line.startsWith('  ')).toBe(true);
      expect(line.startsWith('›')).toBe(false);
    }
    // Nothing overflows the terminal.
    expect(lines.every((line) => [...line].length <= COLUMNS)).toBe(true);
  });

  it('leaves the other kinds at column 0', () => {
    const tool = draw({ kind: 'tool', text: '● shell · ls' });
    expect(tool[0]?.startsWith('●')).toBe(true);

    const answer = draw({ kind: 'assistant', text: 'a reply that is short' });
    expect(answer[0]?.startsWith('│')).toBe(true);
  });
});
