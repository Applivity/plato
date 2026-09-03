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

