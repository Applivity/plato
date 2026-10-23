/**
 * D49bb at the TOOL boundary: a protected file is readable, its values are not,
 * and a write puts them back.
 *
 * The two tests that carry the decision are "add one key" and "round trip". The
 * first is the reason un-masking is not a follow-up: mask a read without
 * restoring the write and an ordinary edit replaces every secret in the file with
 * the literal placeholder. The second is the same trap through apply_diff, where
 * the model's SEARCH strings are written against the MASKED view.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool } from '../src/tools/execute.js';
import { createVault, placeholder, type SecretVault } from '../src/security/mask.js';
import { nodeCommand } from './portable.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'plato-mask-'));
}

const ENV = ['# local only', 'API_KEY=sk-live-abc123456789', 'DB_URL=postgres://u:p@h/db'].join('\n');

function seed(root: string, name: string, text: string): void {
  writeFileSync(join(root, name), text, 'utf8');
}

describe('reading a protected file', () => {
  it('is ALLOWED with a vault, and comes back masked', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const r = await executeTool(root, 'read_file', { path: '.env' }, { vault });
    expect(r.ok).toBe(true);
    expect(r.output).toContain(`API_KEY=${placeholder('API_KEY')}`);
    expect(r.output).not.toContain('sk-live-abc123456789');
    expect(r.output).toContain('Plato masked this file');
    expect(vault.size()).toBe(2);
  });

  it('is REFUSED with no vault — the old behaviour, unchanged', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const r = await executeTool(root, 'read_file', { path: '.env' }, {});
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
  });

  it('REFUSES a protected file it cannot mask, and says why', async () => {
    const root = tempRoot();
    seed(root, 'release.jks', 'not a config file at all');
    const vault = createVault();
    const r = await executeTool(root, 'read_file', { path: 'release.jks' }, { vault });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('cannot mask it');
    expect(r.output).not.toContain('not a config file at all');
  });

  it('keeps a NON-protected file exactly as it was', async () => {
    const root = tempRoot();
    seed(root, 'notes.txt', 'plain text');
    const vault = createVault();
    const r = await executeTool(root, 'read_file', { path: 'notes.txt' }, { vault });
    expect(r.output).toBe('plain text');
  });
});

describe('writing back what was masked', () => {
  it('round-trips: writing the masked text back leaves the file unchanged', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const read = await executeTool(root, 'read_file', { path: '.env' }, { vault });
    const maskedBody = read.output.split('\n[Plato masked this file]')[0]!;

    const w = await executeTool(
      root,
      'write_file',
      { path: '.env', content: maskedBody, overwrite: true },
      { vault },
    );
    expect(w.ok).toBe(true);
    // THE test. Without un-masking this file now holds «masked:API_KEY».
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(ENV);
  });

  it('adds a key without touching the values already there', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const read = await executeTool(root, 'read_file', { path: '.env' }, { vault });
    const maskedBody = read.output.split('\n[Plato masked this file]')[0]!;

    await executeTool(
      root,
      'write_file',
      { path: '.env', content: maskedBody + '\nNEW_KEY=fresh\n', overwrite: true },
      { vault },
    );
    const onDisk = readFileSync(join(root, '.env'), 'utf8');
    expect(onDisk).toContain('API_KEY=sk-live-abc123456789');
    expect(onDisk).toContain('DB_URL=postgres://u:p@h/db');
    expect(onDisk).toContain('NEW_KEY=fresh');
  });

  it('restores a value written into a NON-protected file', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    await executeTool(root, 'read_file', { path: '.env' }, { vault });

    const w = await executeTool(
      root,
      'write_file',
      { path: 'config.ts', content: `export const K = "${placeholder('API_KEY')}";` },
      { vault },
    );
    expect(w.ok).toBe(true);
    expect(readFileSync(join(root, 'config.ts'), 'utf8')).toContain('sk-live-abc123456789');
  });

  it('REFUSES a placeholder the vault has never seen', async () => {
    const root = tempRoot();
    const vault = createVault();
    const w = await executeTool(
      root,
      'write_file',
      { path: 'config.ts', content: `export const K = "${placeholder('API_KEY')}";` },
      { vault },
    );
    expect(w.ok).toBe(false);
    expect(w.output).toContain('no real value');
  });
});

describe('apply_diff against a masked file', () => {
  it('matches the masked view and leaves the untouched secrets real', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    await executeTool(root, 'read_file', { path: '.env' }, { vault });

    // The SEARCH string is what the model SAW — the masked line.
    const r = await executeTool(
      root,
      'apply_diff',
      {
        path: '.env',
        diffs: [{ search: `DB_URL=${placeholder('DB_URL')}`, replace: 'DB_URL=postgres://new/db' }],
      },
      { vault },
    );
    expect(r.ok).toBe(true);
    const onDisk = readFileSync(join(root, '.env'), 'utf8');
    expect(onDisk).toContain('DB_URL=postgres://new/db');
    expect(onDisk).toContain('API_KEY=sk-live-abc123456789');
    expect(onDisk).not.toContain('masked');
  });

  it('still refuses a protected file with NO vault', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const r = await executeTool(root, 'apply_diff', {
      path: '.env',
      diffs: [{ search: 'a', replace: 'b' }],
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
  });
});

describe('scrubbing what a command printed', () => {
  it('replaces a known value in a shell result with its placeholder', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    await executeTool(root, 'read_file', { path: '.env' }, { vault });

    // The value reached the output by a route the masker never saw.
    const r = await executeTool(
      root,
      'shell',
      { command: nodeCommand("process.stdout.write('sk-live-abc123456789')") },
      { vault },
    );
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain('sk-live-abc123456789');
    expect(r.output).toContain(placeholder('API_KEY'));
  });

  it('scrubs a value back out of a file the model copied it into', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    await executeTool(root, 'read_file', { path: '.env' }, { vault });

    // The hole the scrub closes, and the reason masking alone is not enough:
    // the model MATERIALISES the value into an unprotected file, and then reads
    // that file back. Nothing about `config.ts` is on any list — which is
    // exactly why the guard cannot be a name check.
    await executeTool(
      root,
      'write_file',
      { path: 'config.ts', content: `export const K = "${placeholder('API_KEY')}";` },
      { vault },
    );
    expect(readFileSync(join(root, 'config.ts'), 'utf8')).toContain('sk-live-abc123456789');

    const read = await executeTool(root, 'read_file', { path: 'config.ts' }, { vault });
    expect(read.output).not.toContain('sk-live-abc123456789');
    expect(read.output).toContain(placeholder('API_KEY'));
  });

  it('refuses to copy the protected file with a shell command', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const r = await executeTool(root, 'shell', { command: 'cp .env copy.txt' }, { vault });
    expect(r.ok).toBe(false);
  });

  it('still refuses a shell command that NAMES a protected file', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const r = await executeTool(root, 'shell', { command: 'cat .env' }, { vault });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('protected file');
  });
});

describe('the vault is the only thing that knows the values', () => {
  it('never puts a real value into a tool result', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault = createVault();
    const r = await executeTool(root, 'read_file', { path: '.env' }, { vault });
    expect(r.output.includes('sk-live-abc123456789')).toBe(false);
    expect(r.output.includes('postgres://u:p@h/db')).toBe(false);
  });

  it('a second read of the same file is still masked', async () => {
    const root = tempRoot();
    seed(root, '.env', ENV);
    const vault: SecretVault = createVault();
    await executeTool(root, 'read_file', { path: '.env' }, { vault });
    const again = await executeTool(root, 'read_file', { path: '.env' }, { vault });
    expect(again.output).not.toContain('sk-live-abc123456789');
  });
});
