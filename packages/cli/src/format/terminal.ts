/**
 * Terminal text: what the model wrote, made safe to print and split into the
 * shapes a terminal can draw.
 *
 * The model writes Markdown, and a terminal has no renderer for it. This module
 * is the terminal's half of the formatting contract; the VS Code panel keeps its
 * HTML renderer (`packages/core/src/format/markdown.ts`). The two support the
 * same subset on purpose, and each file says so where the subset is defined.
 *
 * It is pure: no React and no Ink, so the parser and the width rules are tested
 * without a terminal.
 */

/** A run of text with one style. Lists and table cells hold these. */
export interface Span {
  kind: 'text' | 'bold' | 'italic' | 'code' | 'link';
  text: string;
  href?: string;
}

export type Align = 'left' | 'right' | 'center';

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'list'; ordered: boolean; start?: number; items: Span[][] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'rule' }
  | { kind: 'table'; align: Align[]; header: Span[][]; rows: Span[][][] };

/**
 * Removes every control sequence from model or file text before it reaches a
 * terminal. Ink keeps colour and OSC-8 sequences (measured), and the plain
 * `-p` path does not go through Ink at all, so neither can be relied on.
 *
 * Deletion is the rule, not escaping: the text is legitimately plain, so a
 * sequence is either an accident or an injection. Tabs and newlines stay.
 */
export function stripTerminalEscapes(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[P^_X][\s\S]*?\u001b\\/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[^\n]/g, '')
    .replace(/\u001b/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

/** How many terminal columns a string occupies. Wide characters count twice. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32) {
      continue;
    }
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x11_00 && cp <= 0x11_5f) ||
    (cp >= 0x2e_80 && cp <= 0xa4_cf) ||
    (cp >= 0xac_00 && cp <= 0xd7_a3) ||
    (cp >= 0xf9_00 && cp <= 0xfa_ff) ||
    (cp >= 0xfe_30 && cp <= 0xfe_4f) ||
    (cp >= 0xff_00 && cp <= 0xff_60) ||
    (cp >= 0xff_e0 && cp <= 0xff_e6) ||
    (cp >= 0x1_f3_00 && cp <= 0x1_f6_4f) ||
    (cp >= 0x1_f9_00 && cp <= 0x1_f9_ff) ||
    (cp >= 0x2_00_00 && cp <= 0x3_ff_fd)
  );
}

/**
 * A token count a status line can read at a glance: 950, 1.3k, 8.2k, 38k,
 * 131k, 1M, 1.5M. A window and a used figure use the same formatter, so
 * 1,048,576 is `1M` and never `1049k`.
 */
export function compactTokens(count: number): string {
  if (count < 1000) {
    return String(Math.max(0, Math.round(count)));
  }
  if (count < 10_000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  const thousands = Math.round(count / 1000);
  if (thousands >= 1000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  return `${thousands}k`;
}

/**
 * Cut text into pieces that fit `width` terminal cells, without a marker: used
 * where the rest of the text is on the next line, not thrown away.
 */
export function chunkToWidth(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const pieces: string[] = [];
  let current = '';
  let used = 0;
  for (const char of text) {
    const cells = displayWidth(char);
    if (used > 0 && used + cells > limit) {
      pieces.push(current);
      current = '';
      used = 0;
    }
    current += char;
    used += cells;
  }
  if (current.length > 0 || pieces.length === 0) {
    pieces.push(current);
  }
  return pieces;
}

/**
 * The same cut with a hanging prefix, so a wrapped line continues under the
 * text it belongs to (a code block's own indent, a long tool target) rather
 * than starting at column zero.
 */
export function wrapToWidth(text: string, width: number, hanging = ''): string[] {
  const prefixWidth = Math.min(
    displayWidth(hanging),
    Math.max(0, Math.max(1, width) - 1),
  );
  const prefix = ' '.repeat(prefixWidth);
  const room = Math.max(1, width - prefixWidth);
  return chunkToWidth(text, room).map((piece, index) =>
    index === 0 ? piece : prefix + piece,
  );
}

/** Cuts to `width` cells, ending in `…` when anything was removed. */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) {
    return text;
  }
  if (width <= 0) {
    return '';
  }
  const room = width - 1;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const cells = displayWidth(ch);
    if (used + cells > room) {
      break;
    }
    out += ch;
    used += cells;
  }
  return `${out}…`;
}

/** The text of a run of spans, without its styles. */
export function plainText(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('');
}

const INLINE =
  /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * Splits one line into styled runs. Nesting is not interpreted: bold inside
 * bold is text, which is what the model's output needs and no more.
 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) {
      spans.push({ kind: 'text', text: text.slice(last, at) });
    }
    if (match[2] !== undefined) {
      spans.push({ kind: 'bold', text: match[2] });
    } else if (match[4] !== undefined) {
      spans.push({ kind: 'italic', text: match[4] });
    } else if (match[5] !== undefined) {
      spans.push({ kind: 'code', text: match[5] });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      spans.push({ kind: 'link', text: match[6], href: match[7] });
    }
    last = at + match[0].length;
  }
  if (last < text.length) {
    spans.push({ kind: 'text', text: text.slice(last) });
  }
  const merged = mergeText(spans);
  return merged.length === 0 ? [{ kind: 'text', text }] : merged;
}

function mergeText(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const previous = out[out.length - 1];
    if (span.kind === 'text' && previous?.kind === 'text') {
      previous.text += span.text;
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

const FENCE = /^\s*```\s*([^\s`]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DELIMITER_CELL = /^:?-{1,}:?$/;

function isDelimiterRow(line: string): boolean {
  if (!line.includes('-')) {
    return false;
  }
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell.trim()));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) {
    return 'center';
  }
  return right ? 'right' : 'left';
}

/**
 * Reads the model's Markdown into the block shapes the terminal draws. An
 * unclosed fence stays literal, matching the panel's renderer, so a half-sent
 * code block is not silently swallowed.
 */
export function parseMarkdown(source: string): Block[] {
  const text = stripTerminalEscapes(source).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      let end = i + 1;
      while (end < lines.length && !FENCE.test(lines[end] ?? '')) {
        end += 1;
      }
      if (end < lines.length) {
        blocks.push({ kind: 'code', lang: fence[1] ?? '', lines: lines.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      // Unclosed: the fence is text, as it is in the panel.
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        spans: parseInline(heading[2] ?? ''),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isDelimiterRow(lines[i + 1] ?? '')) {
      const header = splitRow(line).map(parseInline);
      const align = splitRow(lines[i + 1] ?? '').map(alignOf);
      i += 2;
      const rows: Span[][][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? '').map(parseInline));
        i += 1;
      }
      blocks.push({ kind: 'table', align, header, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const first = Number.parseInt(item[1] ?? '', 10);
      const ordered = Number.isInteger(first);
      const items: Span[][] = [];
      let cursor = i;
      while (cursor < lines.length) {
        const next = LIST_ITEM.exec(lines[cursor] ?? '');
        if (!next) {
          break;
        }
        items.push(parseInline(next[2] ?? ''));
        cursor += 1;
      }
      blocks.push({ kind: 'list', ordered, ...(ordered ? { start: first } : {}), items });
      i = cursor;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const quoted: string[] = [quote[1] ?? ''];
      let cursor = i + 1;
      while (cursor < lines.length) {
        const next = QUOTE.exec(lines[cursor] ?? '');
        if (!next) {
          break;
        }
        quoted.push(next[1] ?? '');
        cursor += 1;
      }
      blocks.push({ kind: 'quote', spans: parseInline(quoted.join(' ')) });
      i = cursor;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph: string[] = [line.trim()];
    let cursor = i + 1;
    while (cursor < lines.length) {
      const next = lines[cursor] ?? '';
      if (
        next.trim().length === 0 ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        RULE.test(next) ||
        LIST_ITEM.test(next) ||
        QUOTE.test(next) ||
        (next.includes('|') && isDelimiterRow(lines[cursor + 1] ?? ''))
      ) {
        break;
      }
      paragraph.push(next.trim());
      cursor += 1;
    }
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) });
    i = cursor;
  }

  return blocks;
}
