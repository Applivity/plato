import { describe, expect, it } from 'vitest';
import {
  compactTokens,
  displayWidth,
  parseMarkdown,
  plainText,
  stripTerminalEscapes,
} from '../src/format/terminal.js';

describe('stripTerminalEscapes', () => {
  it('removes colours, screen control, and OSC hyperlinks', () => {
    expect(stripTerminalEscapes('\u001b[31mred\u001b[0m')).toBe('red');
    expect(stripTerminalEscapes('a\u001b[2Jb')).toBe('ab');
    // The link's visible label is content; only the sequence goes.
    expect(stripTerminalEscapes('a\u001b]8;;https://x\u0007link\u001b]8;;\u0007b')).toBe(
      'alinkb',
    );
    expect(stripTerminalEscapes('\u001b]0;title\u0007text')).toBe('text');
  });

  it('keeps tabs and newlines and drops the rest of the controls', () => {
    expect(stripTerminalEscapes('a\tb\nc')).toBe('a\tb\nc');
    expect(stripTerminalEscapes('a\u0000b\u0008c\u007fd')).toBe('abcd');
  });

  it('removes a lone escape rather than leaving its tail', () => {
    expect(stripTerminalEscapes('a\u001b')).toBe('a');
  });
});

describe('displayWidth', () => {
  it('counts a wide character as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('a日b')).toBe(4);
  });
});

describe('parseMarkdown', () => {
  it('drops the hash run and keeps the heading level', () => {
    const [block] = parseMarkdown('## Answer first');
    expect(block).toEqual({
      kind: 'heading',
      level: 2,
      spans: [{ kind: 'text', text: 'Answer first' }],
    });
  });

  it('parses bold, italic, inline code and a link', () => {
    const [block] = parseMarkdown('a **bold** *em* `code` [label](https://x)');
    expect(block?.kind).toBe('paragraph');
    if (block?.kind !== 'paragraph') return;
    expect(block.spans).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'em' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'label', href: 'https://x' },
    ]);
  });

  it('a fenced block keeps its body byte for byte', () => {
    const [block] = parseMarkdown('```ts\n## not a heading\nconst x = 1;\n```');
    expect(block).toEqual({
      kind: 'code',
      lang: 'ts',
      lines: ['## not a heading', 'const x = 1;'],
    });
  });

  it('an unclosed fence stays text, as the panel renders it', () => {
    const blocks = parseMarkdown('```js\nlet x = 1;');
    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: '```js let x = 1;' }] },
    ]);
  });

  it('groups consecutive bullets into one list', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
      },
    ]);
  });

  it('keeps an ordered list ordered', () => {
    const [block] = parseMarkdown('1. one\n2. two');
    expect(block?.kind).toBe('list');
    if (block?.kind === 'list') {
      expect(block.ordered).toBe(true);
      expect(block.items).toHaveLength(2);
    }
  });

  it('keeps the number an ordered list begins at', () => {
    const [block] = parseMarkdown('5. five\n6. six');
    expect(block?.kind).toBe('list');
    if (block?.kind === 'list') {
      expect(block.start).toBe(5);
    }
  });

  it('reads a quote and a rule', () => {
    expect(parseMarkdown('> quoted')).toEqual([
      { kind: 'quote', spans: [{ kind: 'text', text: 'quoted' }] },
    ]);
    expect(parseMarkdown('---')).toEqual([{ kind: 'rule' }]);
  });

  it('reads a table with alignment and cell styles', () => {
    const [block] = parseMarkdown('| a | b |\n|:--|--:|\n| 1 | **2** |');
    expect(block?.kind).toBe('table');
    if (block?.kind !== 'table') return;
    expect(block.align).toEqual(['left', 'right']);
    expect(block.header.map(plainText)).toEqual(['a', 'b']);
    expect(block.rows.map((row) => row.map(plainText))).toEqual([['1', '2']]);
    expect(block.rows[0]?.[1]).toEqual([{ kind: 'bold', text: '2' }]);
  });

  it('joins the soft-wrapped lines of a paragraph', () => {
    const [block] = parseMarkdown('one line\nand the next');
    expect(block?.kind).toBe('paragraph');
    if (block?.kind === 'paragraph') {
      expect(plainText(block.spans)).toBe('one line and the next');
    }
  });
});

describe('compactTokens', () => {
  it('reads small counts as they are', () => {
    expect(compactTokens(950)).toBe('950');
  });

  it('reads thousands with one decimal below ten thousand', () => {
    expect(compactTokens(1300)).toBe('1.3k');
    expect(compactTokens(9000)).toBe('9k');
  });

  it('reads larger counts in whole thousands', () => {
    expect(compactTokens(38_000)).toBe('38k');
    expect(compactTokens(131_072)).toBe('131k');
    expect(compactTokens(200_000)).toBe('200k');
  });
});
