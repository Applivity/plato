import { describe, expect, it } from 'vitest';
import { toolWords, toolWordsForView } from '../src/runtime/toolWords.js';

/**
 * D49ba. Three places in the product named tools by their internal identifier —
 * the guard line ("guard stopped write_file"), the progress line ("using shell")
 * and the collapsed activity row ("read_file × 12 · shell × 2").
 *
 * The property that makes the table worth having is that **no form of any entry
 * contains the identifier**, so the fault cannot come back one tool at a time.
 * `git` is the one deliberate exception: it is a name the user already knows.
 */
const TOOLS = [
  'read_file',
  'write_file',
  'apply_diff',
  'apply_patch',
  'list_dir',
  'grep',
  'glob',
  'shell',
  'bash_output',
  'kill_shell',
  'web_fetch',
  'todo_write',
  'ask_user',
];

describe('toolWords', () => {
  it('gives every tool all four forms, and none of them is empty', () => {
    for (const tool of TOOLS) {
      const w = toolWords(tool);
      expect(w.noun.length, tool).toBeGreaterThan(0);
      expect(w.doing.length, tool).toBeGreaterThan(0);
      expect(w.counted.length, tool).toBeGreaterThan(0);
      expect(w.countedOne.length, tool).toBeGreaterThan(0);
    }
  });

  // The summary line printed "1 files edited" because a tally of one read the
  // plural. A tally where both forms are the same word cannot be told apart at
  // all, so every entry must actually differ.
  it('has a singular that differs from the plural', () => {
    for (const tool of TOOLS) {
      const w = toolWords(tool);
      expect(w.countedOne, tool).not.toBe(w.counted);
    }
  });

  it('never puts the internal identifier in front of the user', () => {
    for (const tool of TOOLS) {
      if (tool === 'git') continue; // a name the user already knows
      const w = toolWords(tool);
      for (const form of [w.noun, w.doing, w.counted, w.countedOne]) {
        expect(form, `${tool} -> ${form}`).not.toContain(tool);
      }
    }
  });

  it('names the common tools the way a person would say them', () => {
    expect(toolWords('read_file').doing).toBe('reading a file');
    expect(toolWords('shell').noun).toBe('the command');
    expect(toolWords('shell').counted).toBe('commands run');
    expect(toolWords('shell').countedOne).toBe('command run');
    expect(toolWords('apply_diff').counted).toBe('files edited');
    expect(toolWords('apply_diff').countedOne).toBe('file edited');
    expect(toolWords('web_fetch').doing).toBe('fetching a page');
  });

  it('falls back to something generic rather than to an identifier', () => {
    // A tool added next year, and an MCP tool whose name comes from the user's
    // own config: both must read as plain words.
    for (const unknown of ['some_tool_added_next_year', 'mcp__filesystem__read']) {
      const w = toolWords(unknown);
      expect(w.noun).toBe('the tool call');
      expect(w.doing).not.toContain(unknown);
      expect(w.counted).not.toContain(unknown);
      expect(w.countedOne).not.toContain(unknown);
    }
  });
});

describe('toolWordsForView', () => {
  it('carries the table AND the fallback the view needs', () => {
    const words = toolWordsForView();
    expect(words['_generic']?.noun).toBe('the tool call');
    expect(words['shell']?.noun).toBe('the command');
  });
});
