import { describe, expect, it } from 'vitest';
import { decide, secretRefusal } from '../src/runtime/modes.js';
import { toolDeclarations } from '../src/tools/schemas.js';
import type { Mode } from '../src/runtime/modes.js';
import type { ToolName } from '../src/runtime/modes.js';

describe('decide', () => {
  const read: ToolName[] = ['read_file', 'list_dir', 'grep', 'glob', 'git'];
  const write: ToolName[] = ['write_file', 'apply_diff', 'apply_patch'];

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

  /**
   * D49l. `decide` returns 'deny' for a tool it has no kind for, so a tool
   * declared to the model but missing from the kind table is silently unusable
   * in EVERY mode — the model would call it and always be refused.
   *
   * Two nets cover this, and they catch different mistakes. `tsc` requires
   * TOOL_KIND to be exhaustive over the `ToolName` union, so it catches a name
   * added to the union without a kind. This test catches the other direction:
   * a tool added to `toolDeclarations()` — whose name is only a `string` — and
   * never added to `ToolName` at all.
   */
  it('classifies every tool the model is told about', () => {
    for (const t of toolDeclarations()) {
      // `deny` in auto means no kind was declared for it, so it would be
      // unusable in EVERY mode. That is the failure this guards — not "every
      // tool is allowed in auto", which stopped being true at D49p: the `net`
      // kind deliberately asks even there.
      expect(
        decide(t.name, 'auto'),
        `${t.name} is denied in auto — it has no kind, so it would be denied in every mode`,
      ).not.toBe('deny');
    }
  });

  /**
   * D49p. `web_fetch` is the one kind that asks in every mode — including
   * `auto`, where everything else is allowed, and including `plan`, where every
   * other tool is allowed or denied outright. Egress is irreversible: a request
   * cannot be un-sent, and a crafted URL can exfiltrate.
   */
  it('asks before web_fetch in all four modes, auto included', () => {
    for (const m of ['plan', 'edit', 'act', 'auto'] as Mode[]) {
      expect(decide('web_fetch', m)).toBe('ask');
    }
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

  it('ask_user is allow in every mode (meta tool, D34)', () => {
    for (const mode of ['plan', 'edit', 'act', 'auto'] as Mode[]) {
      expect(decide('ask_user', mode)).toBe('allow');
    }
  });

  it('MCP tools are shell-class: gated/denied per mode (D06)', () => {
    expect(decide('mcp_fake_echo', 'plan')).toBe('deny');
    expect(decide('mcp_fake_echo', 'edit')).toBe('deny');
    expect(decide('mcp_fake_echo', 'act')).toBe('ask');
    expect(decide('mcp_fake_echo', 'auto')).toBe('allow');
  });

  it('unknown non-mcp tools are denied outright', () => {
    expect(decide('totally_unknown', 'auto')).toBe('deny');
  });
});
