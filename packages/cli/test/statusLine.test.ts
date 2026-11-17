import { describe, expect, it } from 'vitest';
import { displayWidth } from '../src/format/terminal.js';
import {
  formatDuration,
  shareText,
  statusLine,
  tokenRate,
  truncateToWidth,
  type StatusLineInput,
} from '../src/tui/statusLine.js';

/**
 * The line the founder asked for, with every part present. The numbers here
 * are the example's; the share's percentage is rounded from 16k/1M (1.53%),
 * so it reads 2% rather than the example's illustrative 0%.
 */
const FULL: StatusLineInput = {
  mode: 'edit',
  title: 'test run',
  model: 'deepseek:deepseek-v4-pro',
  team: 'solo',
  usedTokens: 16_000,
  window: 1_048_576,
  inputTokens: 5_600,
  outputTokens: 47,
  rate: 117,
  durationMs: 12_000,
};

const text = (parts: { text: string }[]): string => parts.map((part) => part.text).join(' · ');
const width = (parts: { text: string }[]): number =>
  parts.reduce((sum, part) => sum + displayWidth(part.text), 0) + (parts.length - 1) * 3;

describe('the token formatter', () => {
  it('prints a million as 1M and never as 1049k', () => {
    expect(shareText(0, 1_048_576)).toBe('0/1M ░░░░░░░░ 0%');
    expect(shareText(16_000, 1_048_576)).toBe('16k/1M ░░░░░░░░ 2%');
  });

  it('turns the bar and the percentage from the same fraction', () => {
    expect(shareText(500_000, 1_000_000)).toBe('500k/1M ████░░░░ 50%');
    expect(shareText(1_000_000, 1_000_000)).toBe('1M/1M ████████ 100%');
    expect(shareText(2_000_000, 1_000_000)).toBe('2M/1M ████████ 100%');
  });

  it('keeps the approximate marker on a fallback window', () => {
    expect(shareText(0, 131_072, true)).toBe('0/~131k ░░░░░░░░ 0%');
  });
});

describe('the duration and the rate', () => {
  it('reads seconds and minutes as a person does', () => {
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(80_000)).toBe('1m 20s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(3_660_000)).toBe('1h 1m');
  });

  it('invents no rate for a run that produced nothing', () => {
    expect(tokenRate(0, 3_000)).toBeUndefined();
    expect(tokenRate(47, 0)).toBeUndefined();
    expect(tokenRate(47, 500)).toBeUndefined();
    expect(tokenRate(47, 2_000)).toBe(24);
    expect(tokenRate(47, 1_000)).toBe(47);
  });
});

describe('cutting a title', () => {
  it('ends in an ellipsis and counts wide characters as two', () => {
    expect(truncateToWidth('test run', 8)).toBe('test run');
    expect(truncateToWidth('test run', 4)).toBe('tes…');
    expect(truncateToWidth('日本語', 5)).toBe('日本…');
    expect(truncateToWidth('abc', 1)).toBe('…');
  });
});

describe('the status line', () => {
  it('shows every part, in order, when it fits', () => {
    expect(text(statusLine(FULL, 120))).toBe(
      'mode: edit · test run · deepseek:deepseek-v4-pro · solo · ' +
        '16k/1M ░░░░░░░░ 2% · ↑5.6k ↓47 · 117 t/s · 12s',
    );
  });

  it('shortens the title before dropping anything', () => {
    const parts = statusLine(FULL, 100);
    expect(parts.map((part) => part.key)).toEqual([
      'mode',
      'title',
      'model',
      'team',
      'share',
      'tokens',
      'rate',
      'duration',
    ]);
    expect(parts.find((part) => part.key === 'title')?.text).toBe('tes…');
    expect(width(parts)).toBe(100);
  });

  it('drops team, duration, rate, tokens, model in that order', () => {
    const at80 = statusLine(FULL, 80);
    expect(at80.map((part) => part.key)).toEqual([
      'mode',
      'title',
      'model',
      'share',
      'tokens',
    ]);
    expect(width(at80)).toBeLessThanOrEqual(80);

    const at40 = statusLine(FULL, 40);
    expect(at40.map((part) => part.key)).toEqual(['mode', 'title', 'share']);
    expect(width(at40)).toBeLessThanOrEqual(40);
  });

  it('never drops the mode or the share, even too narrow for them', () => {
    const keys = statusLine(FULL, 20).map((part) => part.key);
    expect(keys).toContain('mode');
    expect(keys).toContain('share');
    expect(keys).not.toContain('model');
  });

  it('keeps a reserved title width when the figures grow', () => {
    // The full title needs 104 cells at 100. With its width reserved it stays
    // whole, and the team leaves instead.
    const pinned = statusLine({ ...FULL, titleWidth: 8 }, 100);
    expect(pinned.find((part) => part.key === 'title')?.text).toBe('test run');
    expect(pinned.map((part) => part.key)).not.toContain('team');
    expect(width(pinned)).toBeLessThanOrEqual(100);

    // A narrower reserved width is kept too, not recalculated.
    const narrow = statusLine({ ...FULL, titleWidth: 4 }, 100);
    expect(narrow.find((part) => part.key === 'title')?.text).toBe('tes…');
    expect(narrow.map((part) => part.key)).toContain('team');
  });

  it('truncates a long title with an ellipsis at 120', () => {
    const parts = statusLine({ ...FULL, title: 'x'.repeat(60) }, 120);
    expect(parts.map((part) => part.key)).toContain('team');
    expect(parts.find((part) => part.key === 'title')?.text.endsWith('…')).toBe(true);
    expect(width(parts)).toBeLessThanOrEqual(120);
  });

  it('has no title part before the first message', () => {
    const parts = statusLine({ ...FULL, title: '' }, 120);
    expect(parts.map((part) => part.key)).not.toContain('title');
    expect(parts[0]?.text).toBe('mode: edit');
  });

  it('always shows the team, solo included', () => {
    expect(text(statusLine(FULL, 120))).toContain(' · solo · ');
  });

  it('has no cost on the line', () => {
    expect(text(statusLine(FULL, 120))).not.toContain('$');
  });

  it('keeps the summary-due warning when it appears', () => {
    const line = text(statusLine({ ...FULL, contextDue: true }, 200));
    expect(line).toContain('summary due next run');
  });
});
