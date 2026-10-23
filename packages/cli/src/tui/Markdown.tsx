import { Box, Text } from 'ink';
import { useMemo, type ReactElement } from 'react';
import {
  displayWidth,
  parseMarkdown,
  plainText,
  type Align,
  type Block,
  type Span,
} from '../format/terminal.js';

/**
 * The model's Markdown, drawn with Ink. It is the terminal's half of the
 * formatting contract; the panel keeps its HTML renderer. A terminal has no
 * font sizes, so headings collapse to weight (h1 also takes an underline) and
 * code takes a left rule rather than a background.
 */
const COLOURS = process.env.NO_COLOR === undefined;

export function Markdown({ text, columns }: { text: string; columns: number }): ReactElement {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <Box key={index} flexDirection="column" marginBottom={index === blocks.length - 1 ? 0 : 1}>
          <BlockView block={block} columns={columns} />
        </Box>
      ))}
    </Box>
  );
}

function BlockView({ block, columns }: { block: Block; columns: number }): ReactElement {
  switch (block.kind) {
    case 'heading':
      return (
        <Text bold underline={block.level === 1}>
          <Spans spans={block.spans} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text>
          <Spans spans={block.spans} />
        </Text>
      );
    case 'code':
      return <CodeBlock block={block} />;
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, index) => (
            <Text key={index}>
              {block.ordered ? `${index + 1}. ` : '• '}
              <Spans spans={item} />
            </Text>
          ))}
        </Box>
      );
    case 'quote':
      // Indented rather than barred: the answer already has a left rule, and
      // two rules side by side read as a mistake.
      return (
        <Box paddingLeft={2}>
          <Text dimColor>
            <Spans spans={block.spans} />
          </Text>
        </Box>
      );
    case 'rule':
      return <Text dimColor>{'─'.repeat(Math.max(3, Math.min(columns, 40)))}</Text>;
    case 'table':
      return <Table block={block} columns={columns} />;
  }
}

function CodeBlock({ block }: { block: Extract<Block, { kind: 'code' }> }): ReactElement {
  // Indented, not boxed: the answer already carries a left rule.
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {block.lang.length > 0 ? <Text dimColor>{block.lang}</Text> : null}
      {block.lines.map((line, index) => (
        // An empty Text has no height, which would close a gap in the block.
        <Text key={index}>{line.length > 0 ? line : ' '}</Text>
      ))}
    </Box>
  );
}

function Table({
  block,
  columns,
}: {
  block: Extract<Block, { kind: 'table' }>;
  columns: number;
}): ReactElement {
  const widths = block.header.map((cell, index) =>
    Math.max(
      1,
      displayWidth(plainText(cell)),
      ...block.rows.map((row) => displayWidth(plainText(row[index] ?? []))),
    ),
  );
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 3;

  // A table wider than the window cannot be aligned. Keep every cell and let
  // the terminal wrap, rather than clipping a column.
  if (total > columns) {
    const rows = [block.header, ...block.rows].map((row) => row.map(plainText).join(' | '));
    return (
      <Box flexDirection="column">
        {rows.map((row, index) => (
          <Text key={index} bold={index === 0}>
            {row}
          </Text>
        ))}
      </Box>
    );
  }

  const line = (row: Span[][], bold: boolean): ReactElement => (
    <Text bold={bold}>
      {row.map((cell, index) => (
        <Text key={index}>
          {index > 0 ? ' │ ' : ''}
          <Cell spans={cell} width={widths[index] ?? 1} align={block.align[index] ?? 'left'} />
        </Text>
      ))}
    </Text>
  );

  return (
    <Box flexDirection="column">
      {line(block.header, true)}
      <Text dimColor>{widths.map((width) => '─'.repeat(width)).join('─┼─')}</Text>
      {block.rows.map((row, index) => (
        <Text key={index}>{line(row, false)}</Text>
      ))}
    </Box>
  );
}

function Cell({
  spans,
  width,
  align,
}: {
  spans: Span[];
  width: number;
  align: Align;
}): ReactElement {
  const gap = Math.max(0, width - displayWidth(plainText(spans)));
  const before = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0;
  return (
    <Text>
      {' '.repeat(before)}
      <Spans spans={spans} />
      {' '.repeat(gap - before)}
    </Text>
  );
}

function Spans({ spans }: { spans: readonly Span[] }): ReactElement {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case 'bold':
            return (
              <Text key={index} bold>
                {span.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={index} italic>
                {span.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={index} color={COLOURS ? 'cyan' : undefined}>
                {span.text}
              </Text>
            );
          case 'link':
            return (
              <Text key={index}>
                {span.text}
                {span.href === undefined ? null : <Text dimColor> ({span.href})</Text>}
              </Text>
            );
          default:
            return <Text key={index}>{span.text}</Text>;
        }
      })}
    </>
  );
}
