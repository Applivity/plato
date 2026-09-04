import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  parseTeamConfig,
  loadTeamConfig,
} from '../src/teams/config.js';
import { PERSONAS, findPersona } from '../src/teams/personas.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plato-academy-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const VALID = `
academy:
  name: hcad-audit
members:
  - name: plato
    model: anthropic:claude-sonnet-4-5
    role: "You fix Android Java bugs."
    kind: worker
  - name: aristotle
    kind: philosopher
    model: litellm:openrouter-nvidia/nemotron-3-ultra-550b-a55b:free
    role: "A skeptical senior reviewer."
    guidance: true
    pause: false
    cancel: true
    maxInterventions: 3
`;

describe('parseTeamConfig', () => {
  it('parses a full valid academy with worker + philosopher tiers', () => {
    const t = parseTeamConfig(VALID);
    expect(t.name).toBe('hcad-audit');
    expect(t.members.length).toBe(2);
    const worker = t.members[0]!;
    expect(worker).toMatchObject({
      name: 'plato',
      model: 'anthropic:claude-sonnet-4-5',
      role: 'You fix Android Java bugs.',
      kind: 'worker',
    });
    const phil = t.members[1]!;
    expect(phil).toMatchObject({
      name: 'aristotle',
      kind: 'philosopher',
      guidance: true,
      pause: false,
      cancel: true,
      maxInterventions: 3,
    });
  });

  it('accepts the legacy team: header (renamed but tolerated)', () => {
    const t = parseTeamConfig(`
team:
  name: legacy
members:
  - name: w
    model: anthropic:claude-sonnet-4-5
`);
    expect(t.name).toBe('legacy');
  });

  it('defaults kind to worker when omitted', () => {
    const t = parseTeamConfig(`
members:
  - name: solo
    model: anthropic:claude-sonnet-4-5
`);
    expect(t.members[0]!.kind).toBe('worker');
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

  it('rejects zero workers (philosophers only)', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: watchman
    kind: philosopher
    model: anthropic:claude-3-5-haiku-latest
`),
    ).toThrowError(/no worker member/);
  });

  it('rejects two workers (D31c: exactly one)', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: a
    model: anthropic:claude-sonnet-4-5
  - name: b
    model: anthropic:claude-opus-4-1
`),
    ).toThrowError(/exactly one worker/);
  });

  it('rejects more than five philosophers', () => {
    const members = [1, 2, 3, 4, 5, 6]
      .map(
        (n) => `  - name: p${n}
    kind: philosopher
    model: anthropic:claude-3-5-haiku-latest`,
      )
      .join('\n');
    expect(() =>
      parseTeamConfig(`members:\n  - name: w
    model: anthropic:claude-sonnet-4-5\n${members}\n`),
    ).toThrowError(/at most 5/);
  });

  it('rejects a member missing model', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    kind: worker
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
    kind: philosopher
    guidance: maybe
`),
    ).toThrowError(/guidance must be true or false/);
  });

  it('rejects malformed top-level keys', () => {
    expect(() => parseTeamConfig(`agent: x`)).toThrowError(
      /expected 'academy:' or 'members:'/,
    );
  });

  it('rejects empty members', () => {
    expect(() =>
      parseTeamConfig(`academy:\n  name: x\nmembers:\n`),
    ).toThrowError(/no members found/);
  });

  it('names the D32 rename when it sees old kind values', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
    kind: coder
`),
    ).toThrowError(/renamed — use 'worker' or 'philosopher'/);
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
    kind: observer
`),
    ).toThrowError(/renamed — use 'worker' or 'philosopher'/);
  });
});

describe('personas (D32b)', () => {
  it('ships five philosophers with distinct role prompts', () => {
    expect(PERSONAS.map((p) => p.name)).toEqual([
      'Aristotle',
      'Heraclitus',
      'Diogenes',
      'Pythagoras',
      'Thales',
    ]);
    for (const p of PERSONAS) {
      expect(p.role.length).toBeGreaterThan(40);
    }
    expect(new Set(PERSONAS.map((p) => p.role)).size).toBe(5);
  });

  it('finds a persona by id', () => {
    expect(findPersona('diogenes')?.epithet).toBe('the Cynic');
    expect(findPersona('nope')).toBeUndefined();
  });
});

describe('loadTeamConfig', () => {
  it('returns null for a missing file (solo mode)', () => {
    expect(loadTeamConfig(dir)).toBeNull();
  });

  it('loads academy.yaml from the config dir (D46: ~/.plato)', () => {
    writeFileSync(
      join(dir, 'academy.yaml'),
      'members:\n  - name: w\n    model: anthropic:claude-sonnet-4-5\n',
    );
    const t = loadTeamConfig(dir);
    expect(t?.members[0]?.name).toBe('w');
    expect(t?.members[0]?.kind).toBe('worker');
  });
});

