import { renderToString } from 'ink';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/tui/Markdown.js';
import { RowView } from '../src/tui/App.js';

function draw(text: string, columns = 80): string {
  return renderToString(createElement(Markdown, { text, columns }), { columns });
}

describe('the terminal Markdown view', () => {
  it('draws a heading without its hashes', () => {
    const out = draw('## Answer first');
    expect(out).toContain('Answer first');
    expect(out).not.toContain('##');
  });

  it('draws bold, italic and inline code without their markers', () => {
    const out = draw('a **bold** *em* `code`');
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
    expect(out).toContain('bold');
    expect(out).toContain('em');
    expect(out).toContain('code');
  });

  it('draws a fence as a block, keeping its body', () => {
    const out = draw('```ts\nconst x: number = 1;\n```');
    expect(out).toContain('  const x: number = 1;');
    expect(out).not.toContain('```');
    expect(out).toContain('ts');
  });

  it('draws bullets, quotes and rules', () => {
    const out = draw('- one\n- two\n\n> quoted\n\n---');
    expect(out).toContain('• one');
    expect(out).toContain('• two');
    expect(out).toContain('  quoted');
    expect(out).toContain('───');
  });

  it('aligns a table and drops the pipe soup', () => {
    const out = draw('| OpenCode | Plato |\n|---|---|\n| `plan` | plan mode |');
    const lines = out.split('\n');
    expect(lines.some((line) => line.includes('OpenCode') && line.includes('Plato'))).toBe(true);
    expect(lines.some((line) => line.includes('│') && line.includes('plan mode'))).toBe(true);
    // The delimiter row is drawn, not printed.
    expect(out).not.toContain('|---|');
    expect(out).not.toContain('OpenCode | Plato');
  });

  it('falls back to literal rows when a table cannot fit', () => {
    // Narrow enough that aligned columns cannot fit: the cells stay literal
    // and the terminal wraps them, but no column is clipped.
    const out = draw('| a | b |\n|---|---|\n| one | two |', 6);
    expect(out).toContain('a | b');
    expect(out).not.toContain('┼');
  });

  it('shows a link as its label and URL', () => {
    const out = draw('[docs](https://example.com)');
    expect(out).toContain('docs (https://example.com)');
  });

  it('never prints an escape sequence the model wrote', () => {
    const out = draw('before \u001b[31mred\u001b[0m after');
    expect(out).not.toContain('\u001b[31m');
    expect(out).toContain('red');
  });
});

describe('the two roles are distinguishable', () => {
  it('frames the answer with a left rule and leaves the user line alone', () => {
    const answer = renderToString(
      createElement(RowView, {
        row: { id: 1, kind: 'assistant', text: '## Heading\n\nbody' },
        columns: 40,
      }),
      { columns: 40 },
    );
    // The row opens with a blank margin line, so the rule is the first drawn row.
    expect(answer.trimStart().split('\n')[0]).toContain('│ Heading');
    expect(answer).not.toContain('##');

    const user = renderToString(
      createElement(RowView, {
        row: { id: 2, kind: 'user', text: 'my question' },
        columns: 40,
      }),
      { columns: 40 },
    );
    expect(user).toContain('› my question');
    expect(user).not.toContain('│');
  });
});
