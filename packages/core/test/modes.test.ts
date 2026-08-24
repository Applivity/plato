import { describe, expect, it } from 'vitest';
import { decide, secretRefusal } from '../src/runtime/modes.js';
import type { ToolName } from '../src/runtime/modes.js';

describe('decide', () => {
  const read: ToolName[] = ['read_file', 'list_dir', 'grep', 'git'];
  const write: ToolName[] = ['write_file', 'apply_diff'];

  it('plan: reads only', () => {
    for (const t of read) expect(decide(t, 'plan')).toBe('allow');
    for (const t of write) expect(decide(t, 'plan')).toBe('deny');
    expect(decide('shell', 'plan')).toBe('deny');
  });

  it('edit: reads auto, writes ask, shell denied', () => {
    for (const t of read) expect(decide(t, 'edit')).toBe('allow');
    for (const t of write) expect(decide(t, 'edit')).toBe('ask');
    expect(decide('shell', 'edit')).toBe('deny');
  });

  it('act: reads auto, writes and shell ask', () => {
    for (const t of read) expect(decide(t, 'act')).toBe('allow');
    for (const t of write) expect(decide(t, 'act')).toBe('ask');
    expect(decide('shell', 'act')).toBe('ask');
  });

  it('auto: everything allowed', () => {
    for (const t of [...read, ...write]) expect(decide(t, 'auto')).toBe('allow');
    expect(decide('shell', 'auto')).toBe('allow');
  });
});

describe('secretRefusal', () => {
  it('refuses path args naming deny-listed files', () => {
    expect(secretRefusal('read_file', { path: 'keystore.properties' })).not.toBeNull();
    expect(secretRefusal('read_file', { path: 'app/local.properties' })).not.toBeNull();
    expect(secretRefusal('apply_diff', { path: '.env' })).not.toBeNull();
  });

  it('scans nested arrays too', () => {
    const cmd = { command: 'cat app/keystore.properties' };
    expect(secretRefusal('shell', cmd)).not.toBeNull();
  });

  it('allows clean paths', () => {
    expect(
      secretRefusal('read_file', { path: 'app/src/main/MainActivity.java' }),
    ).toBeNull();
    expect(secretRefusal('grep', { pattern: 'gradle' })).toBeNull();
  });
});
