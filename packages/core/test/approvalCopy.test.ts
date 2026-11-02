import { describe, expect, it } from 'vitest';
import {
  approvalAllowAll,
  approvalAnswered,
  approvalAnsweredSession,
  approvalCancelled,
  approvalHeading,
} from '../src/runtime/approvalCopy.js';

/**
 * D49ba. The approval card's heading is the most-read string in the product, and
 * it used to be the tool's internal name: "Approve write_file?", "Approve
 * apply_diff?", "Approve shell?". A user does not know what `apply_diff` is and
 * should not have to; the card below already shows the diff.
 *
 * Two properties are pinned here, and the second is the one that keeps the fault
 * from creeping back.
 */
describe('approvalHeading', () => {
  it('names the FILE a write is about', () => {
    expect(approvalHeading('write_file', { path: 'src/a.ts', content: 'x' })).toBe(
      'Let Plato write src/a.ts?',
    );
    expect(approvalHeading('apply_diff', { path: 'src/a.ts', diffs: [] })).toBe(
      'Let Plato edit src/a.ts?',
    );
  });

  it('counts the files of a multi-file patch rather than listing them', () => {
    const three = {
      patches: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
    };
    expect(approvalHeading('apply_patch', three)).toBe('Let Plato edit 3 files?');
    // One file is named, because a count of one tells the user nothing.
    expect(approvalHeading('apply_patch', { patches: [{ path: 'a.ts' }] })).toBe(
      'Let Plato edit a.ts?',
    );
  });

  it('says the situation for a command and a fetch', () => {
    expect(approvalHeading('shell', { command: 'rm -rf build' })).toBe(
      'Let Plato run this command?',
    );
    expect(approvalHeading('web_fetch', { url: 'https://example.com' })).toBe(
      'Let Plato fetch this page?',
    );
  });

  it('cuts a long path at the FRONT, because the file name identifies it', () => {
    const long = `${'deep/'.repeat(20)}Thing.java`;
    const heading = approvalHeading('write_file', { path: long });
    expect(heading).toContain('Thing.java');
    expect(heading.length).toBeLessThan(80);
    expect(heading.startsWith('Let Plato write …')).toBe(true);
  });

  it('never prints a tool identifier, whatever it is handed', () => {
    // THE ASSERTION THAT MATTERS. A tool this function has never heard of falls
    // back to a generic phrase rather than to the identifier — including the MCP
    // tools, whose names are built at runtime from a user's own config.
    for (const tool of [
      'write_file',
      'apply_diff',
      'apply_patch',
      'shell',
      'kill_shell',
      'web_fetch',
      'mcp__filesystem__read_file',
      'some_tool_added_next_year',
    ]) {
      const heading = approvalHeading(tool, { path: 'a.ts' });
      expect(heading).not.toContain(tool);
      expect(heading).not.toContain('_');
    }
  });

  it('always ends in a question mark', () => {
    // The answered state is built from this string, and a heading without its
    // question mark would leave a spent card reading like a live one.
    for (const tool of ['write_file', 'shell', 'web_fetch', 'mcp__x__y', 'unknown']) {
      expect(approvalHeading(tool, { path: 'a.ts' }).endsWith('?')).toBe(true);
    }
  });
});

describe('approvalAllowAll', () => {
  it('names the HOST when there is one, and the host only', () => {
    expect(approvalAllowAll('web_fetch', 'example.com')).toBe(
      'Allow every request to example.com this session',
    );
  });

  it('names the ACTION when there is no host, never the tool', () => {
    expect(approvalAllowAll('shell')).toBe('Allow every command this session');
    expect(approvalAllowAll('apply_diff')).toBe('Allow every edit this session');
    expect(approvalAllowAll('write_file')).toBe('Allow every edit this session');
    expect(approvalAllowAll('shell')).not.toContain('shell');
    expect(approvalAllowAll('apply_diff')).not.toContain('apply_diff');
  });

  it('falls back to something plain for a tool it does not know', () => {
    expect(approvalAllowAll('some_tool')).toBe('Allow every request this session');
    expect(approvalAllowAll('mcp__thing__do')).toContain('this tool');
  });
});

describe('the answered heading', () => {
  it('says which way it went', () => {
    expect(approvalAnswered('Let Plato edit a.ts?', true)).toBe('Let Plato edit a.ts — allowed');
    expect(approvalAnswered('Let Plato edit a.ts?', false)).toBe('Let Plato edit a.ts — denied');
  });

  it('still says it when the heading has no question mark', () => {
    // The bug this replaces: the view did a string replace on the question mark,
    // which silently did nothing when there was not one — leaving a card the
    // user had already answered looking like one still waiting.
    expect(approvalAnswered('Let Plato edit a.ts', true)).toBe('Let Plato edit a.ts — allowed');
  });

  it('marks a session approval as covering the rest of the session', () => {
    expect(approvalAnsweredSession('Let Plato run this command?')).toBe(
      'Let Plato run this command — allowed for the rest of this session',
    );
  });
});

describe('the cancelled heading', () => {
  it('says the run was cancelled, not that the user denied it', () => {
    // Every cancel path resolves the card on the user's behalf, so "denied"
    // would put a decision in the transcript that the user never made.
    expect(approvalCancelled('Let Plato write a.ts?')).toBe(
      'Let Plato write a.ts — cancelled',
    );
    expect(approvalCancelled('Let Plato write a.ts')).toBe(
      'Let Plato write a.ts — cancelled',
    );
    expect(approvalCancelled('Let Plato write a.ts?')).not.toContain('denied');
  });
});
