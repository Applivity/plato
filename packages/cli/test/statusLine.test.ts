import { describe, expect, it } from 'vitest';
import { displayWidth } from '../src/format/terminal.js';
import {
  formatDuration,
  shareText,
  statusLine,
  tokenRate,
  type StatusLineInput,
} from '../src/tui/statusLine.js';

/** The line the founder asked for, with every part present. */
const FULL: StatusLineInput = {
  mode: 'edit',
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

describe('the status line', () => {
  it('shows every part, in order, when it fits', () => {
    expect(text(statusLine(FULL, 120))).toBe(
      'mode: edit · team: solo · deepseek:deepseek-v4-pro · ' +
        '16k/1M ░░░░░░░░ 2% · ↑5.6k ↓47 · 117 t/s · 12s',
    );
  });

  it('labels the team, solo included', () => {
    expect(text(statusLine(FULL, 120))).toContain(' · team: solo · ');
  });

  it('drops team, duration, rate, tokens, model in that order', () => {
    const at80 = statusLine(FULL, 80);
    expect(at80.map((part) => part.key)).toEqual(['mode', 'model', 'share', 'tokens', 'rate']);
    expect(width(at80)).toBeLessThanOrEqual(80);

    const at60 = statusLine(FULL, 60);
    expect(at60.map((part) => part.key)).toEqual(['mode', 'model', 'share']);
    expect(width(at60)).toBeLessThanOrEqual(60);
  });

  it('never drops the mode or the share, even too narrow for them', () => {
    const keys = statusLine(FULL, 20).map((part) => part.key);
    expect(keys).toContain('mode');
    expect(keys).toContain('share');
    expect(keys).not.toContain('model');
  });

  it('has no title of its own', () => {
    const line = text(statusLine(FULL, 120));
    expect(line.startsWith('mode: edit · team: solo')).toBe(true);
    expect(line).not.toContain('test run');
  });

  it('has no cost on the line', () => {
    expect(text(statusLine(FULL, 120))).not.toContain('$');
  });

  it('keeps the summary-due warning when it appears', () => {
    const line = text(statusLine({ ...FULL, contextDue: true }, 200));
    expect(line).toContain('summary due next run');
  });

  it('names one cold-start step beside the mode, and drops it last', () => {
    const full = statusLine({ ...FULL, waiting: 'checking the model…' }, 200);
    expect(text(full)).toBe(
      'mode: edit · checking the model… · team: solo · deepseek:deepseek-v4-pro · ' +
        '16k/1M ░░░░░░░░ 2% · ↑5.6k ↓47 · 117 t/s · 12s',
    );
    const narrow = statusLine({ ...FULL, waiting: 'checking the model…' }, 60);
    expect(narrow.map((part) => part.key)).toContain('waiting');
    expect(narrow.map((part) => part.key)).not.toContain('model');
    expect((text(narrow).match(/checking the model…/g) ?? []).length).toBe(1);
  });
});
