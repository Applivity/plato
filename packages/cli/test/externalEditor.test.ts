import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEditor, runEditor, splitCommand } from '../src/externalEditor.js';

describe('choosing the editor', () => {
  it('prefers VISUAL, then EDITOR, then vi', () => {
    expect(resolveEditor({ VISUAL: 'vis', EDITOR: 'ed' })).toBe('vis');
    expect(resolveEditor({ EDITOR: 'ed' })).toBe('ed');
    expect(resolveEditor({})).toBe('vi');
    expect(resolveEditor({ VISUAL: '  ', EDITOR: 'ed' })).toBe('ed');
  });

  it('splits a command without handing it to a shell', () => {
    expect(splitCommand('code -w')).toEqual(['code', '-w']);
    expect(splitCommand('"/Applications/My Editor/bin/edit" --wait')).toEqual([
      '/Applications/My Editor/bin/edit',
      '--wait',
    ]);
    expect(splitCommand("sh -c 'echo hi'")).toEqual(['sh', '-c', 'echo hi']);
    expect(splitCommand('  ')).toEqual([]);
  });
});

function script(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-editor-test-'));
  const path = join(dir, 'editor.sh');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

describe('running the editor', () => {
  it('returns the edited text without its final newline', async () => {
    const editor = script('printf "one\\ntwo\\n" > "$1"');
    const outcome = await runEditor('draft', { env: { EDITOR: editor } });
    expect(outcome).toEqual({ text: 'one\ntwo' });
  });

  it('keeps an empty edit empty', async () => {
    const editor = script(': > "$1"');
    const outcome = await runEditor('draft', { env: { EDITOR: editor } });
    expect(outcome).toEqual({ text: '' });
  });

  it('says one sentence when the editor is missing', async () => {
    const outcome = await runEditor('draft', {
      env: { EDITOR: '/nonexistent/plato-editor-xyz' },
    });
    expect(outcome.text).toBeUndefined();
    expect(outcome.error).toBe(
      'Could not start /nonexistent/plato-editor-xyz; your draft is unchanged.',
    );
  });

  it('says one sentence when the editor fails', async () => {
    const editor = script('exit 3');
    const outcome = await runEditor('draft', { env: { EDITOR: editor } });
    expect(outcome.text).toBeUndefined();
    expect(outcome.error).toContain('exited with code 3');
    expect(outcome.error).toContain('your draft is unchanged');
  });

  it('accepts an editor command with arguments', async () => {
    // The file is the last argument, after the editor's own flag.
    const editor = script('for last; do :; done; printf "kept\\n" > "$last"');
    const outcome = await runEditor('draft', { env: { EDITOR: `${editor} --flag` } });
    // The script ignores the flag; the important part is that it ran at all.
    expect(outcome).toEqual({ text: 'kept' });
  });
});
