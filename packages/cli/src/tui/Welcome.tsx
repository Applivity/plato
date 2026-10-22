import { Box, Text, useWindowSize } from 'ink';
import { homedir } from 'node:os';
import type { ReactElement } from 'react';
import { VERSION } from '../version.js';

/**
 * The start screen (D49ce): the owl from the extension's mark, drawn from the
 * same geometry — ear tufts, a round head, two big eyes, a small beak — with
 * the wordmark beside it.
 *
 * It shows only on an empty conversation. Once there is a transcript, every
 * line belongs to the work, and a banner above it would be costing space in
 * every scrollback for the rest of the session.
 */

/** The owl, one string per character row. `beak` is the column span of the beak. */
const OWL: { text: string; beak?: [number, number] }[] = [
  { text: '     █████          █████' },
  { text: '     ▀███▀          ▀███▀' },
  { text: '     ▄██████████████████▄' },
  { text: '   ▄██████████████████████▄' },
  { text: '  ████▀     ▀████▀     ▀████' },
  { text: '  ███   ▄▄▄   ██   ▄▄▄   ███' },
  { text: '  ███   ███   ██   ███   ███' },
  { text: '  ███   ▀▀▀   ██   ▀▀▀   ███' },
  { text: '  ████▄     ▄████▄     ▄████', beak: [13, 17] },
  { text: '  ██████████████████████████', beak: [14, 16] },
  { text: '  ▀████████████████████████▀', beak: [14, 16] },
  { text: '    ▀████████████████████▀' },
  { text: '      ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀' },
];

const OWL_WIDTH = 28;

/**
 * Six letters-rows of full blocks: two-pixel stems and bars, so the word holds
 * its own beside a solid owl (it is 46% of the owl's height, where four thin
 * rows were 31% and read as a caption). The P closes its bowl and carries two
 * rows of stem with no ink under the bowl's right side — the cue that once made
 * it read as an R.
 */
const WORDMARK = [
  '██████ ██       ███   ██████ ██████',
  '██  ██ ██      ██ ██    ██   ██  ██',
  '██  ██ ██     ██   ██   ██   ██  ██',
  '██████ ██     ███████   ██   ██  ██',
  '██     ██     ██   ██   ██   ██  ██',
  '██     ██████ ██   ██   ██   ██████',
];

const TIPS = 'Type / for commands · Shift+Tab switches mode · Esc interrupts';

/**
 * Ink's own colours ignore NO_COLOR here (measured; the rest of the TUI has the
 * same gap), so this screen checks it itself. Bold and dim are size, not paint,
 * and are left alone.
 */
const COLOURS = process.env.NO_COLOR === undefined;

/** The same tip, shortened so it never wraps in a narrow window. */
function tipsFor(columns: number): string {
  if (columns >= 64) {
    return TIPS;
  }
  if (columns >= 40) {
    return 'Type / for commands · Shift+Tab mode';
  }
  return 'Type / for commands';
}

export type WelcomeLayout = 'side' | 'wordmark' | 'line';

/**
 * Which form fits. The lockup is 28 + 3 + 35 = 66 columns and 13 rows, and with
 * the header, status, and composer it needs 24 rows; two columns of slack are
 * kept because a line exactly as wide as the window can wrap. A smaller window
 * gets the wordmark alone rather than a banner that pushes the prompt away.
 */
export function welcomeLayout(columns: number, rows: number): WelcomeLayout {
  if (columns >= 68 && rows >= 24) {
    return 'side';
  }
  if (columns >= 37) {
    return 'wordmark';
  }
  return 'line';
}

/** `~` for the home directory, and the middle dropped rather than the end. */
export function shortCwd(cwd: string, limit = 44): string {
  const home = homedir();
  const shown = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  if (shown.length <= limit) {
    return shown;
  }
  const head = Math.floor((limit - 1) * 0.4);
  return `${shown.slice(0, head)}…${shown.slice(-(limit - 1 - head))}`;
}

function OwlLine({ text, beak }: { text: string; beak?: [number, number] }): ReactElement {
  if (beak === undefined) {
    return <Text color={COLOURS ? 'cyan' : undefined}>{text.padEnd(OWL_WIDTH)}</Text>;
  }
  const [start, end] = beak;
  return (
    <Text color={COLOURS ? 'cyan' : undefined}>
      {text.slice(0, start)}
      <Text color={COLOURS ? 'yellow' : undefined}>{text.slice(start, end)}</Text>
      {text.padEnd(OWL_WIDTH).slice(end)}
    </Text>
  );
}

function Tagline(): ReactElement {
  return (
    <Text>
      Plato by Applivity
      <Text dimColor> · {VERSION}</Text>
    </Text>
  );
}

export function Welcome(): ReactElement {
  const { columns, rows } = useWindowSize();
  const layout = welcomeLayout(columns, rows);
  // The line is the last thing that may be cut: a path is a fact, a wrapped
  // path is a puzzle.
  const cwd = shortCwd(process.cwd(), Math.max(20, Math.min(44, columns - 2)));
  const tips = tipsFor(columns);

  if (layout === 'line') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color={COLOURS ? 'cyan' : undefined}>◉◉ </Text>
          Plato by Applivity
          <Text dimColor> · {VERSION}</Text>
        </Text>
        <Text dimColor>{tips}</Text>
      </Box>
    );
  }

  if (layout === 'wordmark') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {WORDMARK.map((line) => (
          <Text key={line} color={COLOURS ? 'cyan' : undefined}>
            {line}
          </Text>
        ))}
        <Text> </Text>
        <Tagline />
        <Text dimColor>{cwd}</Text>
        <Text dimColor>{tips}</Text>
      </Box>
    );
  }

  // Optical centre: the owl's ink is bottom-heavy, so round up rather than down.
  const top = Math.round((OWL.length - WORDMARK.length) / 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      {OWL.map((row, index) => (
        <Box key={row.text}>
          <OwlLine text={row.text} beak={row.beak} />
          <Text>{'   '}</Text>
          <Text>{WORDMARK[index - top] ?? ''}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Tagline />
      {/* At the height of a 24-row window the path is the line that goes: the
          owl, the name, and the way in are what the screen is for. */}
      {rows < 27 ? null : <Text dimColor>{cwd}</Text>}
      <Text dimColor>{tips}</Text>
    </Box>
  );
}
