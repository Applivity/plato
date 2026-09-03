import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS,
  slashCommand,
  slashMenu,
  modeForRun,
  needsGitContext,
  type SlashCommand,
} from '../src/runtime/expandSlash.js';

describe('expandSlash command table', () => {
  it('has exactly the five D44a commands and no /system-prompt', () => {
    const ids = SLASH_COMMANDS.map((c) => c.id);
    expect(ids).toEqual(['plan', 'fix', 'review', 'commit', 'test']);
    expect(ids).not.toContain('system-prompt');
  });

  it('gives every command a label, usage, blurb, and a non-empty bare expansion', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.usage.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      expect(c.expand('').length).toBeGreaterThan(0);
    }
  });

  it('looks commands up by id only', () => {
    expect(slashCommand('plan')?.id).toBe('plan');
    expect(slashCommand('bogus')).toBeUndefined();
    expect(slashCommand(undefined)).toBeUndefined();
  });

  it('slashMenu returns webview-safe rows with no prompt text', () => {
    const rows = slashMenu();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['blurb', 'id', 'label', 'usage']);
    }
  });

  it('plan/fix/test expansions embed their args', () => {
    const plan = slashCommand('plan');
    const fix = slashCommand('fix');
    const test = slashCommand('test');
    expect(plan?.expand('add sorting')).toContain('add sorting');
    expect(fix?.expand('crash on empty input')).toContain('crash on empty input');
    expect(test?.expand('cost.test.ts')).toContain('cost.test.ts');
  });

  it('review expansion changes when paths are given', () => {
    const review = slashCommand('review');
    expect(review).toBeDefined();
    const bare = review!.expand('');
    const withPaths = review!.expand('src/a.ts src/b.ts');
    expect(bare).not.toBe(withPaths);
    expect(bare).toContain('working tree');
    expect(withPaths).toContain('attached file');
    expect(withPaths).not.toContain('src/a.ts'); // paths become chips, not echoed text
  });

  it('commit expansion is read-only and asks for a conventional-commit message', () => {
    const commit = slashCommand('commit');
    expect(commit).toBeDefined();
    const text = commit!.expand('');
    expect(text).toContain('conventional-commit');
    expect(text).toContain('Do not modify');
    expect(text.toLowerCase()).toContain('stop');
  });
});

describe('modeForRun', () => {
  it('/plan, /review, /commit force plan from any current mode', () => {
    expect(modeForRun('plan', 'auto')).toBe('plan');
    expect(modeForRun('plan', 'plan')).toBe('plan');
    expect(modeForRun('review', 'edit')).toBe('plan');
    expect(modeForRun('commit', 'act')).toBe('plan');
  });

  it('/test forces act only when current is auto, else leaves the mode alone', () => {
    expect(modeForRun('test', 'auto')).toBe('act');
    expect(modeForRun('test', 'act')).toBe('act');
    expect(modeForRun('test', 'edit')).toBe('edit');
    expect(modeForRun('test', 'plan')).toBe('plan');
  });

  it('commands with no mode side-effect and unknown ids keep the current mode', () => {
    expect(modeForRun('fix', 'plan')).toBe('plan');
    expect(modeForRun('fix', 'auto')).toBe('auto');
    expect(modeForRun(undefined, 'act')).toBe('act');
    expect(modeForRun('bogus', 'edit')).toBe('edit');
  });
});

describe('needsGitContext + side-effect invariants', () => {
  it('only /commit requests git context', () => {
    for (const c of SLASH_COMMANDS) {
      expect(needsGitContext(c.id)).toBe(c.id === 'commit');
    }
    expect(needsGitContext(undefined)).toBe(false);
  });

  it('fix and test carry no unconditional mode force; test has mode-if-auto; commit has both', () => {
    const effects = (id: string) =>
      (slashCommand(id) as SlashCommand).sideEffects.map((s) => s.kind);
    expect(effects('fix')).toEqual([]);
    expect(effects('test')).toEqual(['mode-if-auto']);
    expect(effects('commit')).toEqual(['mode', 'git-context']);
    expect(effects('plan')).toEqual(['mode']);
    expect(effects('review')).toEqual(['mode']);
  });

  it('expansions are pure', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.expand('some args')).toBe(c.expand('some args'));
    }
  });
});
