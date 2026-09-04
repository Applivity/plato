import { describe, expect, it } from 'vitest';
import { parseTeamConfig } from '../src/teams/config.js';
import { emitTeamConfig, yamlScalar } from '../src/teams/emit.js';

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
          name: 'plato',
          model: 'anthropic:claude-sonnet-4-5',
          role: 'Fix bugs #1 and #2: then re-verify',
          kind: 'worker' as const,
        },
        {
          name: 'phil',
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
        { name: 'plato', model: 'anthropic:claude-sonnet-4-5', kind: 'worker' },
      ],
    });
    const again = parseTeamConfig(text);
    expect(again.name).toBe('');
    expect(again.members).toHaveLength(1);
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
        "  - name: plato\n    model: anthropic:claude-sonnet-4-5\n    kind: worker\n" +
        "  - name: phil\n    model: anthropic:claude-haiku\n    kind: philosopher\n" +
        "    role: 'say \"hi\": then go'\n",
    );
    expect(again.members[1]?.role).toBe('say "hi": then go');
  });
});
