import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILE_MENU_LIMIT,
  fileInsertion,
  fileMenu,
  fileToken,
  matchFiles,
  workspaceFiles,
} from '../src/fileCompletion.js';

const paths = (choices: { path: string }[]) => choices.map((choice) => choice.path);

describe('the @ token', () => {
  it('starts at the beginning of a word', () => {
    expect(fileToken('@src', 4)).toEqual({ start: 0, query: 'src' });
    expect(fileToken('look @src', 9)).toEqual({ start: 5, query: 'src' });
    expect(fileToken('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('does not open inside a word, as an email', () => {
    expect(fileToken('user@host', 9)).toBeNull();
    expect(fileToken('mail me at a@b', 15)).toBeNull();
  });

  it('needs the cursor at the end of the token', () => {
    expect(fileToken('@srcx', 4)).toBeNull();
    expect(fileToken('@src x', 4)).toEqual({ start: 0, query: 'src' });
  });

  it('does not complete a pasted block', () => {
    expect(fileToken('@one\n@two', 9)).toBeNull();
  });
});

describe('the choices', () => {
  const files = [
    'docs/readme.md',
    'notes.txt',
    'src/team.ts',
    'src/tui/App.tsx',
    'src/tui/menu.ts',
  ];

  it('lists folders first, then files, at the top level', () => {
    expect(paths(matchFiles(files, ''))).toEqual([
      'docs',
      'src',
      'notes.txt',
    ]);
    expect(matchFiles(files, '')[0]?.kind).toBe('dir');
  });

  it('filters the last segment without case', () => {
    expect(paths(matchFiles(files, 'S'))).toEqual(['src']);
    expect(paths(matchFiles(files, 'NOT'))).toEqual(['notes.txt']);
  });

  it('narrows inside a folder and lists its immediate entries', () => {
    expect(paths(matchFiles(files, 'src/t'))).toEqual(['src/tui', 'src/team.ts']);
    expect(paths(matchFiles(files, 'src/tui/'))).toEqual([
      'src/tui/App.tsx',
      'src/tui/menu.ts',
    ]);
  });

  it('shows no choice that does not match', () => {
    expect(matchFiles(files, 'src/nope')).toEqual([]);
  });

  it('caps the list and keeps the true count', () => {
    const many = Array.from({ length: 60 }, (_, index) => `many/file-${index}.txt`);
    const menu = fileMenu(many, { start: 0, query: 'many/' });
    expect(menu.choices).toHaveLength(FILE_MENU_LIMIT);
    expect(menu.total).toBe(60);
  });
});

describe('what a choice inserts', () => {
  it('keeps the slash on a folder and ends a file with a space', () => {
    expect(fileInsertion({ path: 'src/tui', kind: 'dir' })).toBe('@src/tui/');
    expect(fileInsertion({ path: 'src/team.ts', kind: 'file' })).toBe('@src/team.ts ');
  });
});

describe('the workspace listing', () => {
  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'plato-files-test-'));
    for (const file of [
      'src/team.ts',
      'src/tui/App.tsx',
      'notes.txt',
      'ignored/hidden.txt',
      'node_modules/pkg/index.js',
      '.git/config',
    ]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), 'x');
    }
    writeFileSync(join(root, '.gitignore'), 'ignored/\n');
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    return root;
  }

  it('skips ignored paths, .git and node_modules when the setting is on', () => {
    const files = workspaceFiles(workspace(), true);
    expect(files).toContain('src/team.ts');
    expect(files).toContain('notes.txt');
    expect(files).not.toContain('ignored/hidden.txt');
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
    expect(files.some((file) => file.startsWith('.git/'))).toBe(false);
  });

  it('includes ignored paths when the setting is off, but never a protected name', () => {
    const files = workspaceFiles(workspace(), false);
    expect(files).toContain('ignored/hidden.txt');
    expect(files).not.toContain('.env');
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });
});
