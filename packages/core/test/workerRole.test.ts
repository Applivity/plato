import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildWorkerRole,
  DEFAULT_PLATO_BODY,
  DEFAULT_MAX_LAYER_CHARS,
  loadProjectFile,
} from '../src/runtime/workerRole.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plato-workerrole-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const full = join(dir, rel);
  const parent = full.slice(0, full.lastIndexOf('/'));
  if (parent !== full) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(full, body, 'utf8');
}


describe('loadProjectFile', () => {
  it('reads an on-disk file under the cap', async () => {
    write('PLATO.md', 'disk plato');
    const r = await loadProjectFile('PLATO.md', dir);
    expect(r).toEqual({ found: true, body: 'disk plato', source: 'disk' });
  });

  it('returns missing when the file is absent', async () => {
    const r = await loadProjectFile('PLATO.md', dir);
    expect(r).toEqual({ found: false, body: '', source: 'missing' });
  });

  it('refuses secret deny-list names even at the basename', async () => {
    write('keystore.properties', 'should be ignored');
    const r = await loadProjectFile('keystore.properties', dir);
    expect(r.found).toBe(false);
    if (!r.found) {
      expect(r.source).toBe('secret');
    }
  });

  it('flags files that exceed the per-layer cap', async () => {
    write('AGENTS.md', 'x'.repeat(DEFAULT_MAX_LAYER_CHARS + 10));
    const r = await loadProjectFile('AGENTS.md', dir, DEFAULT_MAX_LAYER_CHARS);
    expect(r.found).toBe(false);
    if (!r.found) {
      expect(r.source).toBe('too-big');
    }
  });

  it('accepts nested paths via the parent dir', async () => {
    // loadProjectFile takes a basename-style arg, but root can be any dir.
    // Sanity: a file directly in root reads fine.
    write('CLAUDE.md', 'alias');
    const r = await loadProjectFile('CLAUDE.md', dir);
    expect(r).toEqual({ found: true, body: 'alias', source: 'disk' });
  });
});


describe('buildWorkerRole', () => {
  it('falls back to DEFAULT_PLATO_BODY when no files exist', async () => {
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain(DEFAULT_PLATO_BODY);
    expect(r.layers.find((l) => l.layer === 'plato')?.source).toBe('fallback');
    expect(r.layers.find((l) => l.layer === 'agents')?.source).toBe('missing');
  });

  it('uses on-disk PLATO.md when present', async () => {
    write('PLATO.md', 'PROJECT TUNING: be terse.');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('PROJECT TUNING: be terse.');
    expect(r.layers.find((l) => l.layer === 'plato')?.source).toBe('disk');
  });

  it('uses the global ~/.plato PLATO.md when the project has none (D46)', async () => {
    const global = mkdtempSync(join(tmpdir(), 'plato-global-'));
    try {
      writeFileSync(join(global, 'PLATO.md'), 'GLOBAL TUNING: be concise.');
      const r = await buildWorkerRole({ root: dir, globalConfigDir: global });
      expect(r.system).toContain('GLOBAL TUNING: be concise.');
      expect(r.layers.find((l) => l.layer === 'plato')?.source).toBe('global');
    } finally {
      rmSync(global, { recursive: true, force: true });
    }
  });

  it('prefers the project PLATO.md over the global one (D46)', async () => {
    const global = mkdtempSync(join(tmpdir(), 'plato-global-'));
    try {
      write('PLATO.md', 'PROJECT WINS');
      writeFileSync(join(global, 'PLATO.md'), 'GLOBAL LOSES');
      const r = await buildWorkerRole({ root: dir, globalConfigDir: global });
      expect(r.system).toContain('PROJECT WINS');
      expect(r.system).not.toContain('GLOBAL LOSES');
      expect(r.layers.find((l) => l.layer === 'plato')?.source).toBe('disk');
    } finally {
      rmSync(global, { recursive: true, force: true });
    }
  });

  it('reads AGENTS.md when present', async () => {
    write('AGENTS.md', 'AGENTS BODY: build with gradle.');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('AGENTS BODY: build with gradle.');
    expect(r.layers.find((l) => l.layer === 'agents')?.source).toBe('disk');
  });

  it('falls back to CLAUDE.md when AGENTS.md is missing', async () => {
    write('CLAUDE.md', 'CLAUDE BODY: run vitest.');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('CLAUDE BODY: run vitest.');
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.source).toBe('disk');
    if (agents && agents.source === 'disk') {
      expect(agents.filename).toBe('CLAUDE.md');
    }
  });

  it('prefers AGENTS.md over CLAUDE.md when both exist', async () => {
    write('AGENTS.md', 'AGENTS WINS');
    write('CLAUDE.md', 'CLAUDE LOST');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('AGENTS WINS');
    expect(r.system).not.toContain('CLAUDE LOST');
  });

  it('joins layers in the spec order: override >> PLATO >> AGENTS', async () => {
    write('PLATO.md', 'PLATO-MID');
    write('AGENTS.md', 'AGENTS-END');
    const r = await buildWorkerRole({ override: 'OVERRIDE-TOP', root: dir });
    expect(r.system.indexOf('OVERRIDE-TOP')).toBeLessThan(r.system.indexOf('PLATO-MID'));
    expect(r.system.indexOf('PLATO-MID')).toBeLessThan(r.system.indexOf('AGENTS-END'));
  });

  it('skips empty layers (no stray leading newline when no override)', async () => {
    write('PLATO.md', 'P');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system.startsWith('\n')).toBe(false);
    expect(r.system).toContain('P');
  });

  it('skips the override layer when it is empty', async () => {
    write('PLATO.md', 'P');
    const r = await buildWorkerRole({ override: '   ', root: dir });
    const override = r.layers.find((l) => l.layer === 'override');
    expect(override?.present).toBe(false);
  });

  it('truncates oversized layers at a sensible boundary with a marker', async () => {
    // Build a giant AGENTS.md and force a small cap via the helper.
    const big = Array.from({ length: 200 }, (_, i) => `line ${i} some text`).join('\n');
    write('AGENTS.md', big);
    const r = await buildWorkerRole({ root: dir, maxLayerChars: 400 });
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.source).toBe('disk');
    if (agents && agents.source === 'disk') {
      expect(agents.chars).toBeLessThanOrEqual(400 + 30); // marker length slack
    }
    expect(r.system).toContain('[…truncated…]');
  });

  it('truncates an oversized on-disk PLATO.md (read succeeds, clip at cap)', async () => {
    write('PLATO.md', 'y'.repeat(DEFAULT_MAX_LAYER_CHARS + 200));
    const r = await buildWorkerRole({ root: dir });
    const plato = r.layers.find((l) => l.layer === 'plato');
    expect(plato?.source).toBe('disk');
    expect(r.system).toContain('[…truncated…]');
    // The truncation marker plus the slice should still be ~cap-sized.
    if (plato && plato.source === 'disk') {
      expect(plato.chars).toBeLessThanOrEqual(DEFAULT_MAX_LAYER_CHARS + 30);
    }
  });

  it('returns a layer trace with stable shape (override/plato/agents)', async () => {
    const r = await buildWorkerRole({ root: dir });
    expect(r.layers.map((l) => l.layer)).toEqual(['override', 'plato', 'agents']);
  });
});


/**
 * D49ae. The bundled prompt told the model to report what it could not verify —
 * but only once, for the whole report. A real run then wrote one correct caveat
 * ("I could not compile anything") beside a wrong CONFIRMED claim about what
 * SimpleDateFormat emits, and the fix rested on that claim.
 *
 * The missing rule was per-claim, and mode-independent: an unavailable tool
 * limits what you may claim, it does not license a guess. `edit` mode denies the
 * shell — so if accuracy depended on the mode, `edit` would be the mode where
 * findings are least trustworthy, which is backwards.
 */
/**
 * D49ah. The tool alone is not the feature: the plan exists to survive a long
 * run, and the model only reaches for it if the prompt says so. A tool the model
 * is never told to use is a panel the user never sees — so the instruction is
 * asserted here, next to the guideline it extends ("for multi-step tasks, state a
 * brief plan").
 */
describe('the worker prompt tells the model to keep its plan (D49ah)', () => {
  it('sends the plan to the tool, not only into the reply', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Record that plan with the todo_write tool');
  });

  it('says the list is the model’s own thread across a long task', () => {
    expect(DEFAULT_PLATO_BODY).toContain('thread of a long task');
  });

  it('carries the three rules that keep the list honest', () => {
    // Line-stable fragments: the prompt is hard-wrapped source, so a phrase that
    // spans a line break is not in the string (the same constraint the D49ae
    // assertions work under).
    expect(DEFAULT_PLATO_BODY).toContain('the whole list each time');
    expect(DEFAULT_PLATO_BODY).toContain('keep exactly one step marked in_progress');
    expect(DEFAULT_PLATO_BODY).toContain('completed only once you have verified it');
  });

  // The tool is not for a one-step task; a prompt that demanded it always would
  // make the panel noise and cost a turn per trivial ask.
  it('exempts a task that is one step', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Skip it for a task that is one step');
  });
});

describe('the worker prompt requires per-claim evidence (D49ae)', () => {
  it('names the three kinds of claim', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Observed:');
    expect(DEFAULT_PLATO_BODY).toContain('Read:');
    expect(DEFAULT_PLATO_BODY).toContain('Inferred:');
  });

  it('calls third-party library behaviour the high-risk case', () => {
    expect(DEFAULT_PLATO_BODY).toContain(
      "A third-party library's behaviour is the high-risk case",
    );
  });

  // The founder's constraint, in the words that make it hold in every mode.
  it('makes a missing tool a limit on claims, never a licence to guess', () => {
    expect(DEFAULT_PLATO_BODY).toContain('It never licenses a guess');
    expect(DEFAULT_PLATO_BODY).toContain('This holds in every mode');
  });

  it('requires a fix to name the assumption it rests on', () => {
    expect(DEFAULT_PLATO_BODY).toContain(
      'A fix must name the assumption it rests on',
    );
  });

  it('asks for findings before the first edit', () => {
    expect(DEFAULT_PLATO_BODY).toContain(
      'write the findings out before the first edit',
    );
  });
});

/**
 * D49av. The diagnostics block in a tool result is only worth appending if the
 * model treats it as evidence rather than background noise — and only if it does
 * NOT treat it as a licence to go and fix pre-existing problems nobody asked
 * about. Both halves are asserted, because either one alone is a defect: a prompt
 * that ignores the block wastes the feature, and a prompt that says "fix every
 * error you are shown" turns it into scope creep on any repo with legacy errors.
 */
describe('the worker prompt says what to do with the editor’s errors (D49av)', () => {
  it('makes them an observation, not an opinion', () => {
    expect(DEFAULT_PLATO_BODY).toContain('that is an OBSERVATION');
    expect(DEFAULT_PLATO_BODY).toContain('came from the language server');
  });

  it('says pre-existing errors are not the model’s to fix', () => {
    expect(DEFAULT_PLATO_BODY).toContain('not yours to fix');
    expect(DEFAULT_PLATO_BODY).toContain('change nothing');
  });

  it('refuses to read silence as verification', () => {
    // The whole feature exists because Plato cannot tell whether it broke
    // something. A prompt that let an absent diagnostics block mean "verified"
    // would rebuild the exact gap in the one place it costs most.
    expect(DEFAULT_PLATO_BODY).toContain(
      'it never means the change is verified',
    );
  });
});

/**
 * D49bk. The mode is the user's, and the model cannot change it — so the one
 * channel that could imply otherwise has to be closed by name.
 *
 * **Why this is a prompt rule and not a guard.** There is nothing to enforce:
 * the model has no mode tool and core is handed a read-only getter, so it can
 * never switch anything. What it CAN do is put a mode change on a question card,
 * and that card's answer comes back to the model as a tool result — so a "Yes"
 * would tell the model the user agreed while the mode was unchanged, and its
 * next move would rest on a permission it does not hold. **The false belief is
 * the defect**, and it is created by wording, so it is fixed by wording.
 */
describe('the worker prompt closes the mode-change card (D49bk)', () => {
  it('says the mode is the user’s and the model cannot change it', () => {
    expect(DEFAULT_PLATO_BODY).toContain("The mode is the user's to change and you cannot change it");
  });

  // The positive half: what to do instead. A rule that only forbade the card
  // would leave a model that hit a refusal with nothing to say, and the refusal
  // is exactly when the user most needs to hear what is blocked.
  it('says to name what would happen if it were permitted', () => {
    expect(DEFAULT_PLATO_BODY).toContain('say in one sentence what you would');
    expect(DEFAULT_PLATO_BODY).toContain('let the user decide');
  });

  it('forbids the card by name, with the reason', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Never put a mode change on a');
    expect(DEFAULT_PLATO_BODY).toContain('its answer would tell you');
    expect(DEFAULT_PLATO_BODY).toContain('the user agreed when nothing changed');
  });
});
