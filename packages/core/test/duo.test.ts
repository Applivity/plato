import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  parseDuoConfig,
  loadDuoConfig,
  defaultDuoPhilosopher,
  duoObserverSpec,
  DuoConfigError,
} from '../src/teams/duo.js';
import { emitDuoConfig } from '../src/teams/emit.js';
import { findPersona } from '../src/teams/personas.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FULL = `
philosopher:
  persona: heraclitus
  name: Heraclitus
  role: "Watch what changes."
  model: anthropic:claude-sonnet-4-5
  pause: true
  cancel: false
  maxInterventions: 3
`;

describe('parseDuoConfig', () => {
  it('parses a full philosopher with overrides', () => {
    const c = parseDuoConfig(FULL);
    expect(c.philosopher).toEqual({
      persona: 'heraclitus',
      name: 'Heraclitus',
      role: 'Watch what changes.',
      model: 'anthropic:claude-sonnet-4-5',
      pause: true,
      cancel: false,
      maxInterventions: 3,
    });
  });

  it('parses a minimal persona-only file', () => {
    const c = parseDuoConfig('philosopher:\n  persona: diogenes\n');
    expect(c.philosopher).toEqual({ persona: 'diogenes' });
  });

  it('accepts quoted and unquoted persona ids', () => {
    expect(parseDuoConfig('philosopher:\n  persona: "thales"\n').philosopher.persona).toBe('thales');
  });

  it('rejects a missing persona', () => {
    expect(() => parseDuoConfig('philosopher:\n  pause: true\n')).toThrow(/missing 'persona'/);
  });

  it('rejects an unknown persona naming the valid ids', () => {
    expect(() => parseDuoConfig('philosopher:\n  persona: plato\n')).toThrow(/aristotle/);
  });

  it('rejects an unknown key', () => {
    expect(() =>
      parseDuoConfig('philosopher:\n  persona: aristotle\n  watcher: true\n'),
    ).toThrow(/unknown key 'watcher'/);
  });

  it('rejects a bad boolean', () => {
    expect(() =>
      parseDuoConfig('philosopher:\n  persona: aristotle\n  pause: yes\n'),
    ).toThrow(/pause must be true or false/);
  });

  it('rejects a bad maxInterventions', () => {
    expect(() =>
      parseDuoConfig('philosopher:\n  persona: aristotle\n  maxInterventions: -1\n'),
    ).toThrow(/maxInterventions/);
  });

  it('rejects a wrong top-level key with the file name in the message', () => {
    try {
      parseDuoConfig('members:\n  - name: x\n');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DuoConfigError);
      expect((e as DuoConfigError).message).toMatch(/duo\.yaml/);
      expect((e as DuoConfigError).message).toMatch(/philosopher:/);
    }
  });
});

describe('emitDuoConfig round-trip', () => {
  it('re-parses to exactly what was emitted (all fields)', () => {
    const cfg = {
      philosopher: {
        persona: 'heraclitus',
        name: 'Heraclitus the watcher',
        role: 'Watch what changes: re-run and verify.',
        model: 'litellm:gpt-4o',
        pause: true,
        cancel: true,
        maxInterventions: 0,
      },
    };
    const again = parseDuoConfig(emitDuoConfig(cfg));
    expect(again.philosopher).toEqual(cfg.philosopher);
  });

  it('fills the default pause/cancel/max so a minimal file round-trips stably', () => {
    const again = parseDuoConfig(emitDuoConfig({ philosopher: { persona: 'aristotle' } }));
    expect(again.philosopher).toEqual({
      persona: 'aristotle',
      pause: false,
      cancel: false,
      maxInterventions: 5,
    });
  });

  it('quotes a role that a YAML reader would otherwise misread', () => {
    const cfg = {
      philosopher: { persona: 'pythagoras', role: 'Check the numbers: 2 of 3 match # invariants', name: 'Pythagoras' },
    };
    const text = emitDuoConfig(cfg);
    expect(text).toContain('"Check the numbers: 2 of 3 match # invariants"');
    expect(parseDuoConfig(text).philosopher.role).toBe('Check the numbers: 2 of 3 match # invariants');
  });
});

describe('loadDuoConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plato-duo-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when duo.yaml is absent', () => {
    expect(loadDuoConfig(dir)).toBeNull();
  });

  it('reads + parses a present duo.yaml', () => {
    writeFileSync(join(dir, 'duo.yaml'), FULL, 'utf8');
    expect(loadDuoConfig(dir)?.philosopher.persona).toBe('heraclitus');
  });
});

describe('duoObserverSpec', () => {
  it('default philosopher resolves to Aristotle with the worker ref', () => {
    const spec = duoObserverSpec(defaultDuoPhilosopher(), 'anthropic:claude-sonnet-4-5');
    expect(spec).toMatchObject({
      name: 'Aristotle',
      ref: 'anthropic:claude-sonnet-4-5',
      role: findPersona('aristotle')!.role,
      guidance: true,
      pause: false,
      cancel: false,
      maxInterventions: 5,
    });
  });

  it('explicit name/role/model override the persona', () => {
    const spec = duoObserverSpec(
      { persona: 'aristotle', name: 'Strict Aristotle', role: 'Be strict.', model: 'anthropic:haiku', pause: true, maxInterventions: 0 },
      'anthropic:claude-sonnet-4-5',
    );
    expect(spec.name).toBe('Strict Aristotle');
    expect(spec.role).toBe('Be strict.');
    expect(spec.ref).toBe('anthropic:haiku');
    expect(spec.pause).toBe(true);
    expect(spec.maxInterventions).toBe(0);
  });

  it('empty name/role/model fall back to persona + worker ref', () => {
    const spec = duoObserverSpec(
      { persona: 'diogenes', name: '', role: '', model: '' },
      'fallback:model',
    );
    expect(spec.name).toBe(findPersona('diogenes')!.name);
    expect(spec.role).toBe(findPersona('diogenes')!.role);
    expect(spec.ref).toBe('fallback:model');
  });
});
