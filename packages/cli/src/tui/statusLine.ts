import { compactTokens, displayWidth } from '../format/terminal.js';

/**
 * The status line, as data: the parts in reading order and the fit for the
 * terminal width. Pure, so the units, the bar and the drop order are tested
 * without a terminal.
 *
 * The line is one row. When it does not fit, the title shortens first; then
 * the parts leave in a fixed order — team, duration, rate, tokens, model. The
 * mode and the context share never leave.
 */

export interface StatusLineInput {
  mode: string;
  /** The conversation's own title. Empty before its first message. */
  title: string;
  model: string;
  team: string;
  usedTokens: number;
  /** Absent until the window is resolved. */
  window?: number;
  /** True when `window` is the fallback rather than a supplied number. */
  windowApprox?: boolean;
  /** The conversation's running totals. */
  inputTokens: number;
  outputTokens: number;
  /** Tokens per second: live during a run, the last run's rate when idle. */
  rate?: number;
  /** The current or last run's wall time, milliseconds. */
  durationMs?: number;
  /** The next run would fold at the user's threshold. */
  contextDue?: boolean;
  /**
   * A width to keep for the title for this conversation, chosen when the title
   * first appeared. With it, later token or rate growth drops other parts and
   * never rewrites the title under the reader's eyes.
   */
  titleWidth?: number;
}

export interface StatusPart {
  key: string;
  text: string;
}

/** Eight cells is a picture at a glance, not a gauge. */
const BAR_CELLS = 8;
/** A title narrower than this is not saying anything. */
const MIN_TITLE = 2;
/** The order parts leave when the line is too wide. */
const DROP_ORDER = ['team', 'duration', 'rate', 'tokens', 'model'] as const;

/**
 * `16k/1M ░░░░░░░░░ 2%`: the used and window figures, a bar of the same
 * fraction, and its rounded percentage. The bar comes from the same number,
 * so it cannot disagree with the figures.
 */
export function shareText(used: number, window: number, approximate = false): string {
  const fraction = window > 0 ? Math.max(0, Math.min(1, used / window)) : 0;
  const filled = Math.round(fraction * BAR_CELLS);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(BAR_CELLS - filled)}`;
  const percent = Math.round(fraction * 100);
  return `${compactTokens(used)}/${approximate ? '~' : ''}${compactTokens(window)} ${bar} ${percent}%`;
}

/** `12s`, `1m 20s`, `1h 2m`: a run's wall time as a person reads it. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

/**
 * Output tokens over the time they took. Nothing is shown for a run that has
 * produced nothing, or has not yet run for a whole second: the line's clock
 * counts in seconds, and dividing by a few milliseconds would print a rate
 * nobody measured.
 */
export function tokenRate(outputTokens: number, ms: number): number | undefined {
  if (outputTokens <= 0 || ms < 1000) {
    return undefined;
  }
  return Math.round(outputTokens / (ms / 1000));
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

function widthOf(parts: readonly StatusPart[]): number {
  return (
    parts.reduce((sum, part) => sum + displayWidth(part.text), 0) +
    Math.max(0, parts.length - 1) * 3
  );
}

/**
 * The line for this width. The title takes every cell the other parts leave;
 * when that is not enough, the parts leave in `DROP_ORDER`. The mode and the
 * share are never removed, so a terminal too narrow for them is the one case
 * a line can be wider than the terminal.
 */
export function statusLine(input: StatusLineInput, columns: number): StatusPart[] {
  const all: StatusPart[] = [{ key: 'mode', text: `mode: ${input.mode}` }];
  const title = input.title.trim();
  if (title.length > 0) {
    all.push({
      key: 'title',
      text:
        input.titleWidth === undefined
          ? title
          : truncateToWidth(title, input.titleWidth),
    });
  }
  all.push({ key: 'model', text: input.model });
  all.push({ key: 'team', text: input.team });
  if (input.window !== undefined) {
    all.push({
      key: 'share',
      text: shareText(input.usedTokens, input.window, input.windowApprox === true),
    });
  }
  if (input.contextDue === true) {
    all.push({ key: 'due', text: 'summary due next run' });
  }
  all.push({
    key: 'tokens',
    text: `↑${compactTokens(input.inputTokens)} ↓${compactTokens(input.outputTokens)}`,
  });
  if (input.rate !== undefined) {
    all.push({ key: 'rate', text: `${input.rate} t/s` });
  }
  if (input.durationMs !== undefined) {
    all.push({ key: 'duration', text: formatDuration(input.durationMs) });
  }

  let parts: StatusPart[] = all;
  if (widthOf(parts) <= columns) {
    return parts;
  }

  // 1. An unfixed title gives way first, down to what is still a title. A
  // fixed one keeps its width: the figures may grow, but the title must not
  // change while the reader is looking at it.
  if (input.titleWidth === undefined && title.length > 0) {
    parts = withTitle(parts, title, MIN_TITLE);
    if (widthOf(parts) <= columns) {
      return titleFilled(parts, title, columns);
    }
  }

  // 2. Then whole parts, in the stated order, until the line fits.
  for (const key of DROP_ORDER) {
    if (!parts.some((part) => part.key === key)) {
      continue;
    }
    parts = parts.filter((part) => part.key !== key);
    if (widthOf(parts) <= columns) {
      return input.titleWidth === undefined ? titleFilled(parts, title, columns) : parts;
    }
  }
  return input.titleWidth === undefined ? titleFilled(parts, title, columns) : parts;
}

function withTitle(parts: StatusPart[], title: string, width: number): StatusPart[] {
  return parts.map((part) =>
    part.key === 'title' ? { ...part, text: truncateToWidth(title, width) } : part,
  );
}

/** Gives the title whatever room the surviving parts leave. */
function titleFilled(parts: StatusPart[], title: string, columns: number): StatusPart[] {
  if (title.length === 0) {
    return parts;
  }
  const without = parts.map((part) => (part.key === 'title' ? { ...part, text: '' } : part));
  const room = columns - widthOf(without);
  return withTitle(parts, title, Math.max(MIN_TITLE, room));
}
