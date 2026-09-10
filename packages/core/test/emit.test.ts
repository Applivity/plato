import { describe, expect, it } from 'vitest';
import { parseTeamConfig } from '../src/teams/config.js';
import { emitTeamConfig, yamlScalar } from '../src/teams/emit.js';
import { defaultAcademyMembers } from '../src/teams/duo.js';

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

describe('emitTeamConfig', () => {
  it('round-trips an existing academy with no loss', () => {
    const parsed = parseTeamConfig(VALID);
    const emitted = emitTeamConfig(parsed);
    // Comments/whitespace aside, the emitted body parses back identically.
    const again = parseTeamConfig(emitted);
    expect(again).toEqual(parsed);
  });

  it('round-trips member roles that need quoting', () => {
    const cfg = {
      name: 'tricky',
      members: [
        {
          name: 'phil-a',
          model: 'anthropic:claude-sonnet-4-5',
          role: 'Fix bugs #1 and #2: then re-verify',
          kind: 'philosopher' as const,
        },
        {
          name: 'phil-b',
          model: 'anthropic:claude-haiku',
          kind: 'philosopher' as const,
          role: 'say "done" only after a: verify step',
          guidance: true,
          pause: false,
          cancel: false,
          maxInterventions: 2,
        },
      ],
    };
    const text = emitTeamConfig(cfg);
    expect(text).toContain('"Fix bugs #1 and #2: then re-verify"');
    const again = parseTeamConfig(text);
    expect(again).toEqual(cfg);
  });

  it('emits an unnamed academy header cleanly', () => {
    const text = emitTeamConfig({
      name: '',
      members: [
        { name: 'a', model: 'anthropic:claude-sonnet-4-5', kind: 'philosopher' },
        { name: 'b', model: 'anthropic:claude-sonnet-4-5', kind: 'philosopher' },
      ],
    });
    const again = parseTeamConfig(text);
    expect(again.name).toBe('');
    expect(again.members).toHaveLength(2);
  });

  // D47e: the starter council is philosophers only — Plato is the implicit
  // doer, so the emitted file carries no worker at all.
  it('emits the D47e starter council: philosophers only, personas intact', () => {
    const text = emitTeamConfig({
      name: '',
      members: defaultAcademyMembers('anthropic:claude-sonnet-4-5'),
    });
    expect(text).not.toContain('kind: worker');
    const again = parseTeamConfig(text);
    expect(again.members).toHaveLength(2);
    expect(again.members.every((m) => m.kind === 'philosopher')).toBe(true);
    expect(again.members.map((p) => p.persona)).toEqual(['aristotle', 'pythagoras']);
    expect(again.members.every((p) => p.guidance === true)).toBe(true);
  });

  // D47f regression: Open ACADEMY.yaml wrote a hollow council — no role, no
  // pause/cancel/maxInterventions — so the file it created showed a blank Role
  // and blank Powers when re-opened. The seed must be a complete spec.
  it('D47f: the starter council writes role, powers and colour', () => {
    const text = emitTeamConfig({
      name: 'lyceum',
      members: defaultAcademyMembers('anthropic:claude-sonnet-4-5'),
    });
    for (const key of ['role:', 'pause:', 'cancel:', 'maxInterventions:', 'color:']) {
      expect(text).toContain(key);
    }
    const again = parseTeamConfig(text);
    for (const m of again.members) {
      expect(m.role && m.role.length > 0).toBe(true);
      expect(m.pause).toBe(false);
      expect(m.cancel).toBe(false);
      expect(m.maxInterventions).toBe(5);
    }
    // Distinct so two philosophers never share one identity colour.
    const colors = again.members.map((m) => m.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('yamlScalar', () => {
  it('leaves plain scalars alone', () => {
    expect(yamlScalar('aristotle')).toBe('aristotle');
    expect(yamlScalar('anthropic:claude-sonnet-4-5')).toBe('anthropic:claude-sonnet-4-5');
  });

  it('quotes values a YAML reader would misread', () => {
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('#comment')).toBe('"#comment"');
    expect(yamlScalar('- dash')).toBe('"- dash"');
    expect(yamlScalar('  lead')).toBe('"  lead"');
    expect(yamlScalar('trail  ')).toBe('"trail  "');
  });

  it('quotes the empty string', () => {
    expect(yamlScalar('')).toBe('""');
  });

  it('picks single quotes when a quote-requiring value holds a double quote', () => {
    expect(yamlScalar('say "hi": then go')).toBe("'say \"hi\": then go'");
    // Both parsers strip single quotes, so the value reads back verbatim.
    const again = parseTeamConfig(
      'members:\n' +
        "  - name: phil-a\n    model: anthropic:claude-sonnet-4-5\n" +
        "    kind: philosopher\n" +
        "    role: 'say \"hi\": then go'\n" +
        "  - name: phil-b\n    model: anthropic:claude-haiku\n    kind: philosopher\n",
    );
    expect(again.members[0]?.role).toBe('say "hi": then go');
  });
});
