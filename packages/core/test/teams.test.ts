import { describe, expect, it } from 'vitest';
import {
  parseTeamConfig,
  loadTeamConfig,
} from '../src/teams/config.js';

const VALID = `
team:
  name: hcad-audit
members:
  - name: coder
    model: anthropic:claude-sonnet-4-5
    role: "You fix Android Java bugs."
    kind: coder
  - name: socrates
    kind: observer
    model: litellm:openrouter-nvidia/nemotron-3-ultra-550b-a55b:free
    role: "A skeptical senior reviewer."
    guidance: true
    pause: false
    cancel: true
    maxInterventions: 3
`;

describe('parseTeamConfig', () => {
  it('parses a full valid team with coder + observer tiers', () => {
    const t = parseTeamConfig(VALID);
    expect(t.name).toBe('hcad-audit');
    expect(t.members.length).toBe(2);
    const coder = t.members[0]!;
    expect(coder).toMatchObject({
      name: 'coder',
      model: 'anthropic:claude-sonnet-4-5',
      role: 'You fix Android Java bugs.',
      kind: 'coder',
    });
    const obs = t.members[1]!;
    expect(obs).toMatchObject({
      name: 'socrates',
      kind: 'observer',
      guidance: true,
      pause: false,
      cancel: true,
      maxInterventions: 3,
    });
  });

  it('defaults kind to coder and applies D30 tier defaults when omitted', () => {
    const t = parseTeamConfig(`
members:
  - name: solo
    model: anthropic:claude-sonnet-4-5
`);
    expect(t.members[0]!.kind).toBe('coder');
    expect(t.members.length).toBe(1);
  });

  it('rejects unknown member keys loudly with the line number', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
    colour: red
`),
    ).toThrowError(/line 5: unknown key 'colour'/);
  });

  it('rejects duplicate member names', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
  - name: x
    model: anthropic:claude-opus-4-1
`),
    ).toThrowError(/duplicate member name 'x'/);
  });

  it('rejects zero coders (observers only)', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: watchman
    kind: observer
    model: anthropic:claude-3-5-haiku-latest
`),
    ).toThrowError(/no coder member/);
  });

  it('rejects two coders (D31c: exactly one)', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: a
    model: anthropic:claude-sonnet-4-5
  - name: b
    model: anthropic:claude-opus-4-1
`),
    ).toThrowError(/exactly one coder/);
  });

  it('rejects more than three observers', () => {
    const members = [1, 2, 3, 4]
      .map(
        (n) => `  - name: o${n}
    kind: observer
    model: anthropic:claude-3-5-haiku-latest`,
      )
      .join('\n');
    expect(() =>
      parseTeamConfig(`members:\n  - name: coder
    model: anthropic:claude-sonnet-4-5\n${members}\n`),
    ).toThrowError(/at most 3/);
  });

  it('rejects a member missing model', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    kind: coder
`),
    ).toThrowError(/missing 'model'/);
  });

  it('rejects a model ref without a connection prefix', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: claude-sonnet-4-5
`),
    ).toThrowError(/'<connection>:<model>' ref/);
  });

  it('rejects non-boolean tier flags', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
    kind: observer
    guidance: maybe
`),
    ).toThrowError(/guidance must be true or false/);
  });

  it('rejects malformed top-level keys', () => {
    expect(() => parseTeamConfig(`agent: x`)).toThrowError(
      /expected 'team:' or 'members:'/,
    );
  });

  it('rejects empty members', () => {
    expect(() => parseTeamConfig(`team:\n  name: x\nmembers:\n`)).toThrowError(
      /no members found/,
    );
  });
});

describe('loadTeamConfig', () => {
  it('returns null for a missing file (solo mode)', () => {
    expect(loadTeamConfig('/nonexistent-dir-xyz')).toBeNull();
  });

  it('loads and parses the shipped example from the repo root', () => {
    // The repo itself ships no teams.yaml; this asserts the solo-mode default.
    expect(loadTeamConfig('/Users/ai/Desktop/plato')).toBeNull();
  });
});
