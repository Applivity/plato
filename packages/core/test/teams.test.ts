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
  name: lyceum
members:
  - name: aristotle
    kind: philosopher
    model: anthropic:claude-sonnet-4-5
    role: "A skeptical senior reviewer."
    guidance: true
    pause: false
    cancel: true
    maxInterventions: 3
  - name: pythagoras
    kind: philosopher
    model: litellm:openrouter-nvidia/nemotron-3-ultra-550b-a55b:free
    role: "Checks structure and counts."
    guidance: true
`;

describe('parseTeamConfig', () => {
  it('parses a council of philosophers with tiers', () => {
    const t = parseTeamConfig(VALID);
    expect(t.name).toBe('lyceum');
    expect(t.members.length).toBe(2);
    const phil = t.members[0]!;
    expect(phil).toMatchObject({
      name: 'aristotle',
      kind: 'philosopher',
      model: 'anthropic:claude-sonnet-4-5',
      role: 'A skeptical senior reviewer.',
      guidance: true,
      pause: false,
      cancel: true,
      maxInterventions: 3,
    });
    expect(t.members[1]!.name).toBe('pythagoras');
  });

  // D47d: a philosopher may name a PERSONAS id as its identity anchor.
  it('parses the optional persona key on a philosopher', () => {
    const t = parseTeamConfig(
      'members:\n' +
        '  - name: aristotle\n    model: anthropic:claude-sonnet-4-5\n' +
        "    kind: philosopher\n    persona: aristotle\n    guidance: true\n" +
        '  - name: pythagoras\n    model: anthropic:claude-sonnet-4-5\n' +
        "    kind: philosopher\n    persona: pythagoras\n    guidance: true\n",
    );
    expect(t.members[0]?.persona).toBe('aristotle');
    expect(t.members[1]?.persona).toBe('pythagoras');
  });

  // D47e: the file carries no worker — Plato is the implicit doer.
  it("rejects 'kind: worker' with a clear message (D47e)", () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: plato
    model: anthropic:claude-sonnet-4-5
    kind: worker
  - name: aristotle
    model: anthropic:claude-sonnet-4-5
`),
    ).toThrowError(/no longer a member/);
  });

  it('accepts the legacy team: header (renamed but tolerated)', () => {
    const t = parseTeamConfig(`
team:
  name: legacy
members:
  - name: a
    model: anthropic:claude-sonnet-4-5
  - name: b
    model: anthropic:claude-sonnet-4-5
`);
    expect(t.name).toBe('legacy');
  });

  it('defaults kind to philosopher when omitted', () => {
    const t = parseTeamConfig(`
members:
  - name: a
    model: anthropic:claude-sonnet-4-5
  - name: b
    model: anthropic:claude-sonnet-4-5
`);
    expect(t.members[0]!.kind).toBe('philosopher');
    expect(t.members.length).toBe(2);
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

  // D47e: a council needs at least two philosophers.
  it('rejects a single-philosopher council', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: only
    kind: philosopher
    model: anthropic:claude-3-5-haiku-latest
`),
    ).toThrowError(/at least 2/);
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
      parseTeamConfig(`members:\n${members}\n`),
    ).toThrowError(/at most 5/);
  });

  it('rejects a member missing model', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    kind: philosopher
  - name: y
    kind: philosopher
`),
    ).toThrowError(/missing 'model'/);
  });

  it('rejects a model ref without a connection prefix', () => {
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: claude-sonnet-4-5
  - name: y
    model: anthropic:claude-sonnet-4-5
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
  - name: y
    model: anthropic:claude-sonnet-4-5
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
    ).toThrowError(/renamed — use 'philosopher'/);
    expect(() =>
      parseTeamConfig(`
members:
  - name: x
    model: anthropic:claude-sonnet-4-5
    kind: observer
`),
    ).toThrowError(/renamed — use 'philosopher'/);
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

  it('loads ACADEMY.yaml from the config dir (D46: ~/.plato)', () => {
    writeFileSync(
      join(dir, 'ACADEMY.yaml'),
      'members:\n  - name: a\n    model: anthropic:claude-sonnet-4-5\n'
        + '  - name: b\n    model: anthropic:claude-sonnet-4-5\n',
    );
    const t = loadTeamConfig(dir);
    expect(t?.members[0]?.name).toBe('a');
    expect(t?.members[0]?.kind).toBe('philosopher');
  });
});

