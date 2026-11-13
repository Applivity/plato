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

  it('includes both AGENTS.md and CLAUDE.md, the root AGENTS first', async () => {
    write('AGENTS.md', 'AGENTS FIRST');
    write('CLAUDE.md', 'CLAUDE SECOND');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('AGENTS FIRST');
    expect(r.system).toContain('CLAUDE SECOND');
    expect(r.system.indexOf('AGENTS FIRST')).toBeLessThan(r.system.indexOf('CLAUDE SECOND'));
  });

  /**
   * D49cd: a real run's workspace root was the parent of the project, so the
   * root-only lookup found nothing while the project kept its instructions in
   * `kbe\.claude\CLAUDE.md` and `kbe\.github\AGENTS.md`. Projects keep these
   * where their own tooling expects them; the reader must look there.
   */
  it('reads .github/AGENTS.md when the root has neither file', async () => {
    write('.github/AGENTS.md', 'GITHUB AGENTS BODY');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('GITHUB AGENTS BODY');
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.source).toBe('disk');
    if (agents && agents.source === 'disk') {
      expect(agents.filename).toBe('AGENTS.md');
      expect(agents.path).toBe('.github/AGENTS.md');
    }
  });

  it('reads .claude/CLAUDE.md when nothing earlier exists', async () => {
    write('.claude/CLAUDE.md', 'CLAUDE TOOL BODY');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('CLAUDE TOOL BODY');
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.source).toBe('disk');
    if (agents && agents.source === 'disk') {
      expect(agents.path).toBe('.claude/CLAUDE.md');
    }
  });

  it('includes all four locations in the documented merge order', async () => {
    write('.claude/CLAUDE.md', 'FOURTH-TOOL');
    write('CLAUDE.md', 'THIRD-ROOT');
    write('.github/AGENTS.md', 'SECOND-GITHUB');
    write('AGENTS.md', 'FIRST-AGENTS');
    const r = await buildWorkerRole({ root: dir });
    const at = (s: string) => r.system.indexOf(s);
    expect(at('FIRST-AGENTS')).toBeGreaterThan(-1);
    expect(at('FIRST-AGENTS')).toBeLessThan(at('SECOND-GITHUB'));
    expect(at('SECOND-GITHUB')).toBeLessThan(at('THIRD-ROOT'));
    expect(at('THIRD-ROOT')).toBeLessThan(at('FOURTH-TOOL'));
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.path).toBe('AGENTS.md');
    if (agents && agents.source === 'disk') {
      expect(agents.files.map((f) => f.path)).toEqual([
        'AGENTS.md',
        '.github/AGENTS.md',
        'CLAUDE.md',
        '.claude/CLAUDE.md',
      ]);
    }
  });

  it('keeps the root CLAUDE.md section before the .claude one', async () => {
    write('CLAUDE.md', 'ROOT CLAUDE');
    write('.claude/CLAUDE.md', 'NESTED CLAUDE');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('ROOT CLAUDE');
    expect(r.system).toContain('NESTED CLAUDE');
    expect(r.system.indexOf('ROOT CLAUDE')).toBeLessThan(r.system.indexOf('NESTED CLAUDE'));
  });

  it('still reports missing, with no filename or path, when no location exists', async () => {
    const r = await buildWorkerRole({ root: dir });
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.present).toBe(false);
    expect(agents?.source).toBe('missing');
    if (agents && agents.source === 'missing') {
      expect(agents.filename).toBeNull();
      expect(agents.path).toBeNull();
    }
  });

  it('treats a nested entry that is a DIRECTORY as absent, without throwing', async () => {
    mkdirSync(join(dir, '.claude', 'CLAUDE.md'), { recursive: true });
    const r = await buildWorkerRole({ root: dir });
    const agents = r.layers.find((l) => l.layer === 'agents');
    expect(agents?.source).toBe('missing');
    expect(r.system).toContain(DEFAULT_PLATO_BODY);
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
 * D49cd (merge). The founder's own project keeps rules in BOTH
 * `.github/AGENTS.md` and `.claude/CLAUDE.md`. The first-found rule read one
 * and silently dropped the other, so a rule existed in his repository and
 * never reached the model. Every file that exists now joins the prompt, in a
 * fixed base-to-specific order, each under a line naming where it came from.
 */
describe('the agents layer is a merge, not a choice (D49cd)', () => {
  const agentsOf = (r: Awaited<ReturnType<typeof buildWorkerRole>>) =>
    r.layers.find((l) => l.layer === 'agents');

  it('reads the .claude file alone and labels it', async () => {
    write('.claude/CLAUDE.md', 'ONLY-TOOL-RULE');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('ONLY-TOOL-RULE');
    expect(r.system).toContain('From .claude/CLAUDE.md:');
  });

  it('reads all four files, in the fixed order, each labelled', async () => {
    write('AGENTS.md', 'MARK-ROOT-AGENTS');
    write('.github/AGENTS.md', 'MARK-GITHUB-AGENTS');
    write('CLAUDE.md', 'MARK-ROOT-CLAUDE');
    write('.claude/CLAUDE.md', 'MARK-CLAUDE-TOOL');
    const r = await buildWorkerRole({ root: dir });
    const order = [
      'From AGENTS.md (project root):',
      'From .github/AGENTS.md:',
      'From CLAUDE.md (project root):',
      'From .claude/CLAUDE.md:',
    ];
    const positions = order.map((label) => r.system.indexOf(label));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i - 1]!).toBeLessThan(positions[i]!);
    }
    for (const marker of ['MARK-ROOT-AGENTS', 'MARK-GITHUB-AGENTS', 'MARK-ROOT-CLAUDE', 'MARK-CLAUDE-TOOL']) {
      expect(r.system).toContain(marker);
    }
  });

  it('includes byte-identical files once and records the duplicate', async () => {
    const same = 'IDENTICAL-RULE\nSecond line.\n';
    write('CLAUDE.md', same);
    write('.claude/CLAUDE.md', same);
    const r = await buildWorkerRole({ root: dir });
    expect(r.system.split('IDENTICAL-RULE').length - 1).toBe(1);
    const agents = agentsOf(r);
    expect(agents?.source).toBe('disk');
    if (agents && agents.source === 'disk') {
      expect(agents.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
      expect(agents.duplicates).toEqual(['.claude/CLAUDE.md']);
    }
  });

  it('truncates the MERGED body with the marker, the first file intact', async () => {
    const first = `FIRST-${'a'.repeat(280)}`;
    const second = `SECOND-${'b'.repeat(280)}`;
    write('AGENTS.md', first);
    write('.claude/CLAUDE.md', second);
    const r = await buildWorkerRole({ root: dir, maxLayerChars: 400 });
    expect(r.system).toContain('[…truncated…]');
    expect(r.system).toContain(first);
    const agents = agentsOf(r);
    if (agents && agents.source === 'disk') {
      expect(agents.chars).toBeLessThanOrEqual(400 + 30);
      expect(agents.files).toHaveLength(2);
    }
  });

  it('skips a directory, uses the next file, and does not throw', async () => {
    mkdirSync(join(dir, 'AGENTS.md'), { recursive: true });
    write('.github/AGENTS.md', 'NEXT-CANDIDATE');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).toContain('NEXT-CANDIDATE');
    expect(r.system).toContain('From .github/AGENTS.md:');
  });

  it('reports nothing present, with an empty trace', async () => {
    const r = await buildWorkerRole({ root: dir });
    const agents = agentsOf(r);
    expect(agents?.present).toBe(false);
    expect(agents?.source).toBe('missing');
    if (agents && agents.source === 'missing') {
      expect(agents.files).toEqual([]);
      expect(agents.duplicates).toEqual([]);
    }
  });

  it('never reads a user-level ~/.claude/CLAUDE.md', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'plato-fake-home-'));
    try {
      mkdirSync(join(fakeHome, '.claude'), { recursive: true });
      writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'USER-LEVEL-RULE');
      const r = await buildWorkerRole({ root: dir, globalConfigDir: fakeHome });
      expect(r.system).not.toContain('USER-LEVEL-RULE');
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('keeps PLATO.md ahead of the agents body', async () => {
    write('PLATO.md', 'PLATO-RULE');
    write('.claude/CLAUDE.md', 'AGENTS-RULE');
    const r = await buildWorkerRole({ root: dir });
    expect(r.system.indexOf('PLATO-RULE')).toBeLessThan(r.system.indexOf('AGENTS-RULE'));
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
 * A named thing that cannot be found is not proved absent. Three real runs on a
 * Windows machine were asked for the folders in a share they were told as
 * `ukhan-win-share`: the model tried the workgroup, then name resolution, then
 * concluded the share did not exist. With the server named, one enumeration
 * found it at once. The rule belongs beside the other evidence claims: a guess
 * that failed is not a search.
 */
describe('the worker prompt forbids reading absence from a failed guess', () => {
  it('states the rule', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Absence is not proved.');
  });

  it('says to enumerate what the machine already knows', () => {
    expect(DEFAULT_PLATO_BODY).toContain('enumerate what the machine already knows');
  });

  it('keeps the key sentence', () => {
    expect(DEFAULT_PLATO_BODY).toContain('a guess that failed is not a search');
  });

  it('asks for the checks to be reported', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Say what you checked');
  });
});

/**
 * Facts about the machine are HOST facts, appended after the body like the mode
 * and team paragraphs — so a project's PLATO.md can replace the body without
 * deleting what the model needs to know about the shell it runs in.
 */
describe('the worker prompt states the environment', () => {
  it('names the operating system, the shell and the root when supplied', async () => {
    const r = await buildWorkerRole({
      root: dir,
      env: { platform: 'win32', shell: 'cmd.exe via %COMSPEC%', root: 'C:\\work' },
    });
    expect(r.system).toContain('Environment: this run is on Windows (win32).');
    expect(r.system).toContain('The shell tool runs cmd.exe via %COMSPEC%.');
    expect(r.system).toContain('The workspace root is C:\\work;');
    expect(r.system).toContain('the file tools work only inside that root, and the shell does not.');
  });

  it('names the right shell on a POSIX platform', async () => {
    const r = await buildWorkerRole({
      root: dir,
      env: { platform: 'linux', shell: '/bin/bash -c', root: '/work' },
    });
    expect(r.system).toContain('this run is on Linux (linux)');
    expect(r.system).toContain('The shell tool runs /bin/bash -c.');
  });

  it('appends the facts after the body, so a project PLATO.md cannot delete them', async () => {
    write('PLATO.md', 'PROJECT TUNING: be terse.');
    const r = await buildWorkerRole({
      root: dir,
      env: { platform: 'darwin', shell: '/bin/bash -c', root: dir },
    });
    expect(r.system).toContain('Environment: this run is on macOS (darwin).');
    expect(r.system.indexOf('PROJECT TUNING')).toBeLessThan(
      r.system.indexOf('Environment:'),
    );
  });

  it('adds nothing when the host supplies no environment', async () => {
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).not.toContain('Environment:');
  });
});

/**
 * The prompt must say which instruction wins, because the three layers can
 * disagree — and a model that picks silently will pick the wrong one.
 */
describe('the worker prompt states instruction precedence', () => {
  const one = DEFAULT_PLATO_BODY.replace(/\s+/g, ' ');

  it('names the three sources in order', () => {
    const user = one.indexOf("the user's message decides the task");
    const project = one.indexOf('decide its conventions over Plato');
    const safety = one.indexOf('Plato\'s safety rules (containment, secrets, approvals) decide over both');
    expect(user).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(user);
    expect(safety).toBeGreaterThan(project);
  });

  it('asks the model to say which it followed when it matters', () => {
    expect(one).toContain('When it matters, say which you followed.');
  });
});

/**
 * The failure: "I cannot view images" while `read_image` existed. A capability
 * is not a question — try the tool, and report what it returned.
 */
describe('the worker prompt forbids denying a capability it has', () => {
  it('says to try the tool and report what it returned', () => {
    const one = DEFAULT_PLATO_BODY.replace(/\s+/g, ' ');
    expect(one).toContain('Never say you cannot do something a tool exists for');
    expect(one).toContain('try the tool and report what it returned');
    expect(one).toContain('if the tool is not available, say that instead');
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
 * D49bk, extended by D49cb. The mode is the user's, and the model cannot change
 * it — so a mode change must never ride a question card, whose answer would tell
 * the model the user agreed while nothing changed.
 *
 * **D49cb makes the honest channel real.** A host that can draw a mode card
 * offers `request_mode`; the model asks, the user decides, and the host switches.
 * A host without that card keeps the prose-only fallback, so the prompt never
 * names a tool the host cannot honour.
 */
describe('the worker prompt says how to ask for a mode (D49bk, D49cb)', () => {
  it('says the mode is the user’s and the model cannot change it', () => {
    expect(DEFAULT_PLATO_BODY).toContain("The mode is the user's to change and you cannot change it");
  });

  it('forbids the card by name, with the reason', () => {
    expect(DEFAULT_PLATO_BODY).toContain('Never put a mode change on a');
    expect(DEFAULT_PLATO_BODY).toContain('its answer would tell you');
    expect(DEFAULT_PLATO_BODY).toContain('the user agreed when nothing changed');
  });

  it('a host without a mode card keeps the prose-only fallback', async () => {
    const r = await buildWorkerRole({ root: dir });
    // The paragraph is wrapped for reading; the claim is about its words.
    const one = r.system.replace(/\s+/g, ' ');
    expect(one).toContain(
      'say in one sentence what you would do if it were permitted and let the user decide',
    );
    expect(one).not.toContain('request_mode');
  });

  it('a host with a real mode card names the tool and the user’s decision', async () => {
    const r = await buildWorkerRole({ root: dir, modeRequest: true });
    const one = r.system.replace(/\s+/g, ' ');
    expect(one).toContain('request_mode');
    expect(one).toContain('The user sees a card and decides');
    expect(one).toContain('you cannot change the mode yourself');
    expect(one).toContain('Use request_mode, not ask_user, for a mode change');
  });
});

/**
 * The worker is told about the team it runs in. Before this, a Duo run's reply
 * claimed Aristotle was "a separate harness, two processes, no shared context"
 * and used that to call the design invalid. The observers were in-process and
 * had the coder's digest the whole time; the prompt simply never said so.
 */
describe('the worker prompt describes the team', () => {
  it('names the watcher and says what it can see', async () => {
    const r = await buildWorkerRole({
      root: dir,
      team: { mode: 'duo', watchers: ['Aristotle'] },
    });
    const one = r.system.replace(/\s+/g, ' ');
    expect(one).toContain('1 philosopher (Aristotle) is watching this run');
    expect(one).toContain('same Plato process');
    expect(one).toContain('digest of your tool calls');
    expect(one).toContain('[observer guidance]');
    expect(one).toContain('Watchers never approve, edit, or run anything');
  });

  it('names every watcher, and stays grammatical with more than one', async () => {
    const r = await buildWorkerRole({
      root: dir,
      team: { mode: 'academy', watchers: ['Aristotle', 'Curie'] },
    });
    expect(r.system.replace(/\s+/g, ' ')).toContain(
      '2 philosophers (Aristotle, Curie) are watching this run',
    );
  });

  it('says a solo run has no watcher', async () => {
    const r = await buildWorkerRole({ root: dir, team: { mode: 'solo', watchers: [] } });
    const one = r.system.replace(/\s+/g, ' ');
    expect(one).toContain('No philosopher is watching this run');
    expect(one).not.toContain('same Plato process');
  });

  it('says a team whose watchers could not start is running alone', async () => {
    const r = await buildWorkerRole({ root: dir, team: { mode: 'duo', watchers: [] } });
    expect(r.system.replace(/\s+/g, ' ')).toContain(
      'No philosopher could start for this run',
    );
  });

  it('keeps the paragraph when a project PLATO.md replaces the body', async () => {
    write('PLATO.md', 'You are Plato. Work carefully.');
    const r = await buildWorkerRole({
      root: dir,
      team: { mode: 'duo', watchers: ['Aristotle'] },
    });
    // The body was replaced, so the fallback sentence is gone...
    expect(r.system).not.toContain('philosophers may watch and advise');
    // ...but the host fact survives, because it is appended, not baked in.
    expect(r.system).toContain('Aristotle');
    expect(r.system).toContain('same Plato process');
  });

  it('adds nothing for a host that does not describe a team', async () => {
    const r = await buildWorkerRole({ root: dir });
    expect(r.system).not.toContain('same Plato process');
    expect(r.system).not.toContain('No philosopher is watching this run');
  });
});
