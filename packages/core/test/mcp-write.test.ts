import { describe, expect, it } from 'vitest';
import {
  EMPTY_MCP_CONFIG,
  parseMcpConfig,
  withServerDisabled,
} from '../src/mcp/config.js';

describe('withServerDisabled', () => {
  const COPIED = `{
  "mcpServers": {
    "files": { "command": "npx", "args": ["-y", "srv"], "disabled": false },
    "gh": { "command": "gh-mcp", "type": "stdio" }
  }
}`;

  it('the empty body Settings creates is one the parser accepts', () => {
    // "Open mcp.json" writes this when the file does not exist, so it is the
    // assertion that the create path never lands on a file the parser refuses.
    expect(parseMcpConfig(EMPTY_MCP_CONFIG)).toEqual({});
  });

  it('flips one server and leaves the others alone', () => {
    const out = withServerDisabled(COPIED, 'gh', true);
    const cfg = parseMcpConfig(out);
    expect(cfg['gh']?.disabled).toBe(true);
    expect(cfg['files']?.disabled).toBe(false);
  });

  it('keeps a field Plato does not read, rather than deleting it', () => {
    // The regression this exists for: rebuilding the file from our own subset
    // would drop `"type": "stdio"` the first time a toggle was clicked, quietly
    // changing a config the user pasted from another client.
    const out = withServerDisabled(COPIED, 'gh', true);
    expect(out).toContain('"type": "stdio"');
  });

  it('leaves every other server untouched when toggled twice', () => {
    // Not a byte comparison: re-serializing expands the file's inline objects,
    // and the toggled server gains an explicit `disabled: false` (the point of
    // writing the field either way). What must hold is that nothing was LOST —
    // the other server, its order, and the unknown key all survive.
    const out = withServerDisabled(withServerDisabled(COPIED, 'gh', true), 'gh', false);
    const before = parseMcpConfig(COPIED);
    const after = parseMcpConfig(out);
    expect(after['files']).toEqual(before['files']);
    expect(after['gh']?.command).toBe(before['gh']?.command);
    expect(after['gh']?.disabled).toBe(false);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(out).toContain('"type": "stdio"');
  });

  it('refuses a name that is not in the file', () => {
    expect(() => withServerDisabled(COPIED, 'nope', true)).toThrow(
      /no server named 'nope'/,
    );
  });

  it('refuses to write a file the parser would not read back', () => {
    expect(() => withServerDisabled('not json', 'gh', true)).toThrow(
      /not valid JSON/,
    );
  });
});
