import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, slashCommand, slashMenu } from '../src/runtime/commands.js';

describe('D44c/D44d/D45a-2 command registry', () => {
  it('has the real commands and no dropped/expander ids', () => {
    const ids = SLASH_COMMANDS.map((c) => c.id);
    // D49ax added /undo — the only way an undo is ever started.
    expect(ids).toEqual(['compact', 'history', 'system-prompt', 'undo']);
    for (const gone of [
      'plan', 'fix', 'review', 'commit', 'test', 'autocompact',
    ]) {
      expect(ids).not.toContain(gone);
    }
  });

  it('gives every command a label, usage, and one-line description', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.usage).toBe('/' + c.id);
      expect(c.blurb.length).toBeGreaterThan(0);
      // Commands are actions, not text expanders: no expandable payload.
      expect('expand' in c).toBe(false);
      expect('sideEffects' in c).toBe(false);
    }
  });

  it('looks commands up by id only', () => {
    expect(slashCommand('compact')?.id).toBe('compact');
    expect(slashCommand('history')?.label).toBe('History');
    expect(slashCommand('system-prompt')?.usage).toBe('/system-prompt');
    expect(slashCommand('undo')?.label).toBe('Undo');
    expect(slashCommand('plan')).toBeUndefined();
    expect(slashCommand(undefined)).toBeUndefined();
  });

  it('slashMenu returns webview-safe rows with no extra keys', () => {
    const rows = slashMenu();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['blurb', 'id', 'label', 'usage']);
    }
  });

  it('registry entries are stable and order defines the menu', () => {
    const first = slashMenu();
    expect(first.map((r) => r.id)).toEqual(SLASH_COMMANDS.map((c) => c.id));
    expect(slashMenu()).toEqual(first); // no hidden mutation on re-read
  });
});
