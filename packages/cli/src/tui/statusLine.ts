import { compactTokens, displayWidth } from '../format/terminal.js';

/**
 * The status line, as data: the parts in reading order and the fit for the
 * terminal width. Pure, so the units, the bar and the drop order are tested
 * without a terminal.
 *
 * The line is one row. When it does not fit, parts leave in a fixed order —
 * team, duration, rate, tokens, model. The mode and the context share never
 * leave.
 */

export interface StatusLineInput {
  mode: string;
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
  /** A cold-start step that has lasted long enough to be worth naming. */
  waiting?: string;
}

export interface StatusPart {
  key: string;
  text: string;
}

/** Eight cells is a picture at a glance, not a gauge. */
const BAR_CELLS = 8;
/** The order parts leave when the line is too wide. */
const DROP_ORDER = ['team', 'duration', 'rate', 'tokens', 'model', 'waiting'] as const;

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

function widthOf(parts: readonly StatusPart[]): number {
  return (
    parts.reduce((sum, part) => sum + displayWidth(part.text), 0) +
    Math.max(0, parts.length - 1) * 3
  );
}

/**
 * The line for this width. Parts leave in `DROP_ORDER`. The mode and the share
 * are never removed, so a terminal too narrow for them is the one case a line
 * can be wider than the terminal.
 */
export function statusLine(input: StatusLineInput, columns: number): StatusPart[] {
  const parts: StatusPart[] = [{ key: 'mode', text: `mode: ${input.mode}` }];
  if (input.waiting !== undefined) {
    parts.push({ key: 'waiting', text: input.waiting });
  }
  parts.push({ key: 'team', text: `team: ${input.team}` });
  parts.push({ key: 'model', text: input.model });
  if (input.window !== undefined) {
    parts.push({
      key: 'share',
      text: shareText(input.usedTokens, input.window, input.windowApprox === true),
    });
  }
  if (input.contextDue === true) {
    parts.push({ key: 'due', text: 'summary due next run' });
  }
  parts.push({
    key: 'tokens',
    text: `↑${compactTokens(input.inputTokens)} ↓${compactTokens(input.outputTokens)}`,
  });
  if (input.rate !== undefined) {
    parts.push({ key: 'rate', text: `${input.rate} t/s` });
  }
  if (input.durationMs !== undefined) {
    parts.push({ key: 'duration', text: formatDuration(input.durationMs) });
  }

  if (widthOf(parts) <= columns) {
    return parts;
  }
  let shown: StatusPart[] = parts;
  for (const key of DROP_ORDER) {
    if (!shown.some((part) => part.key === key)) {
      continue;
    }
    shown = shown.filter((part) => part.key !== key);
    if (widthOf(shown) <= columns) {
      return shown;
    }
  }
  return shown;
}
