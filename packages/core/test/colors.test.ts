import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PHILOSOPHER_COLORS,
  NEUTRAL_COLOR,
  colorHex,
  findColor,
  firstUnusedColor,
} from '../src/teams/colors.js';
import { parseTeamConfig, ROLE_MAX_CHARS } from '../src/teams/config.js';
import { emitTeamConfig, oneLine } from '../src/teams/emit.js';
import { parseDuoConfig } from '../src/teams/duo.js';
import { emitDuoConfig } from '../src/teams/emit.js';

describe('philosopher colours (D47f)', () => {
  it('offers one colour per council slot', () => {
    expect(PHILOSOPHER_COLORS).toHaveLength(5);
    expect(new Set(PHILOSOPHER_COLORS.map((c) => c.id)).size).toBe(5);
    expect(new Set(PHILOSOPHER_COLORS.map((c) => c.hex)).size).toBe(5);
  });

  it('resolves an id to its hex and falls back to neutral', () => {
    expect(colorHex('violet')).toBe(PHILOSOPHER_COLORS[0]!.hex);
    expect(colorHex('nope')).toBe(NEUTRAL_COLOR.hex);
    expect(colorHex(undefined)).toBe(NEUTRAL_COLOR.hex);
    expect(findColor('teal')?.id).toBe('teal');
  });

  it('hands out the first unused colour', () => {
    expect(firstUnusedColor([])).toBe('violet');
    expect(firstUnusedColor(['violet'])).toBe('blue');
    expect(firstUnusedColor(['violet', 'blue', 'teal'])).toBe('amber');
    // Unknown/empty entries do not consume a slot.
    expect(firstUnusedColor(['', undefined, 'violet'])).toBe('blue');
  });

  // The founder's requirement: assignments are STORED, so removing a
  // philosopher never re-colours the survivors.
  it('does not shift colours when a member is removed', () => {
    const text = emitTeamConfig({
      name: 'lyceum',
      members: [
        { name: 'aristotle', model: 'anthropic:m', persona: 'aristotle', kind: 'philosopher', color: 'violet' },
        { name: 'pythagoras', model: 'anthropic:m', persona: 'pythagoras', kind: 'philosopher', color: 'blue' },
        { name: 'thales', model: 'anthropic:m', persona: 'thales', kind: 'philosopher', color: 'teal' },
      ],
    });
    const three = parseTeamConfig(text);
    expect(three.members.map((m) => m.color)).toEqual(['violet', 'blue', 'teal']);

    // Drop the middle philosopher and re-emit: the other two keep their colour.
    const after = emitTeamConfig({
      name: three.name,
      members: three.members.filter((m) => m.name !== 'pythagoras'),
    });
    const two = parseTeamConfig(after);
    expect(two.members.map((m) => m.color)).toEqual(['violet', 'teal']);
  });

  it('round-trips color through ACADEMY.yaml', () => {
    const text = emitTeamConfig({
      name: '',
      members: [
        { name: 'a', model: 'anthropic:m', persona: 'aristotle', kind: 'philosopher', color: 'amber' },
        { name: 'b', model: 'anthropic:m', persona: 'thales', kind: 'philosopher', color: 'rose' },
      ],
    });
    expect(text).toContain('color: amber');
    const again = parseTeamConfig(text);
    expect(again.members.map((m) => m.color)).toEqual(['amber', 'rose']);
  });

  it('rejects an unknown colour loudly', () => {
    expect(() =>
      parseTeamConfig(
        'members:\n' +
          '  - name: a\n    model: anthropic:m\n    color: chartreuse\n' +
          '  - name: b\n    model: anthropic:m\n',
      ),
    ).toThrow(/unknown color 'chartreuse'/);
  });

  it('round-trips color through DUO.yaml', () => {
    const text = emitDuoConfig({
      philosopher: { persona: 'aristotle', color: 'rose' },
    });
    expect(parseDuoConfig(text).philosopher.color).toBe('rose');
  });

  it('rejects an unknown colour in DUO.yaml too', () => {
    expect(() => parseDuoConfig('philosopher:\n  persona: aristotle\n  color: nope\n'))
      .toThrow(/unknown color 'nope'/);
  });
});

describe('role cap + one-line folding (D47g)', () => {
  const mk = (role: string) =>
    'members:\n' +
    `  - name: a\n    model: anthropic:m\n    role: ${JSON.stringify(role)}\n` +
    '  - name: b\n    model: anthropic:m\n';

  it('accepts a role exactly at the cap', () => {
    const r = 'x'.repeat(ROLE_MAX_CHARS);
    expect(parseTeamConfig(mk(r)).members[0]?.role?.length).toBe(ROLE_MAX_CHARS);
  });

  // The founder's requirement: a hand-pasted 2000-char line must NOT be
  // acceptable — the parser, not just the UI, has to refuse it.
  it('rejects a role over the cap, naming the count', () => {
    const r = 'x'.repeat(ROLE_MAX_CHARS + 1);
    expect(() => parseTeamConfig(mk(r))).toThrow(
      new RegExp(`role is ${ROLE_MAX_CHARS + 1} characters`),
    );
  });

  it('rejects an over-long role in DUO.yaml too', () => {
    const r = 'y'.repeat(ROLE_MAX_CHARS + 5);
    expect(() =>
      parseDuoConfig(
        `philosopher:\n  persona: aristotle\n  role: ${JSON.stringify(r)}\n`,
      ),
    ).toThrow(/maximum is 1000/);
  });

  // The defect found while writing D47g: the Role box is a textarea, so a
  // stray Enter used to emit a raw newline that our own parser then rejected,
  // losing the save. The emitter folds it, so every caller writes a parseable
  // file.
  it('folds a newline in the role so the file still parses', () => {
    const body = emitTeamConfig({
      name: '',
      members: [
        { name: 'a', model: 'anthropic:m', kind: 'philosopher', role: 'line one\nline two' },
        { name: 'b', model: 'anthropic:m', kind: 'philosopher' },
      ],
    });
    expect(body).not.toContain('line one\nline two');
    expect(parseTeamConfig(body).members[0]?.role).toBe('line one line two');
  });

  it('folds tabs and runs of spaces to a single space', () => {
    expect(oneLine('  a\t\tb   c  ')).toBe('a b c');
    const body = emitDuoConfig({
      philosopher: { persona: 'aristotle', role: 'stay\n\nconcise' },
    });
    expect(parseDuoConfig(body).philosopher.role).toBe('stay concise');
  });

  // The webview is a TEMPLATE LITERAL, so its copy of oneLine needs a double
  // backslash. A single one is eaten by the literal and compiles to /s+/ —
  // which matches the letter "s", so the fold silently does nothing. That bug
  // shipped once (D47g); pin the compiled output so it cannot return.
  it('the webview copy of the fold regex survived the template literal', () => {
    const src = readFileSync(
      new URL('../../vscode/src/webview.ts', import.meta.url),
      'utf8',
    );
    const m = /const oneLine = \(s\) => String\(s\)\.replace\(\/(.*?)\/g/.exec(src);
    expect(m, 'the webview oneLine helper must exist').not.toBeNull();
    // In the .ts source the regex body must be TWO backslashes.
    expect(m?.[1]).toBe('\\\\s+');
  });
});
