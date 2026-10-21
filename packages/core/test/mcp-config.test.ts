import { describe, expect, it } from 'vitest';
import { parseMcpConfig } from '../src/mcp/config.js';

describe('parseMcpConfig', () => {
  it('parses the ecosystem shape: a named map of command/args/env', () => {
    const cfg = parseMcpConfig(`{
      "mcpServers": {
        "fetch": { "command": "node", "args": ["server.js", "--port", "3000"] },
        "fs": {
          "command": "./fs-server",
          "args": ["--root", "/tmp/data"],
          "env": { "API_KEY": "s3cret", "DEBUG": "1" }
        }
      }
    }`);
    expect(cfg['fetch']).toEqual({
      command: 'node',
      args: ['server.js', '--port', '3000'],
    });
    expect(cfg['fs']).toEqual({
      command: './fs-server',
      args: ['--root', '/tmp/data'],
      env: { API_KEY: 's3cret', DEBUG: '1' },
    });
  });

  it('an empty server map is a valid config, not an error', () => {
    expect(parseMcpConfig('{"mcpServers": {}}')).toEqual({});
  });

  it('rejects invalid JSON, passing on where the parse stopped', () => {
    // The offset comes from JSON.parse itself; the point is that a syntax error
    // is reported as one rather than being mistaken for a shape error.
    expect(() => parseMcpConfig('{"mcpServers": {')).toThrow(
      /not valid JSON/,
    );
  });

  it('rejects a file with no "mcpServers" — a typo must not read as empty', () => {
    expect(() => parseMcpConfig('{"mcpservers": {}}')).toThrow(
      /expected an "mcpServers" object/,
    );
  });

  it('rejects a server without command, naming the server', () => {
    expect(() =>
      parseMcpConfig('{"mcpServers": {"broken": {"args": ["x"]}}}'),
    ).toThrow(/server 'broken' is missing a 'command'/);
  });

  it('keeps fields it does not know, so a copied config still loads', () => {
    // Claude Code writes `type` in every entry; other clients add their own.
    // Rejecting them would refuse a config copied from the tools this shape
    // imitates. The schema is where a typo gets flagged, not the loader.
    const cfg = parseMcpConfig(
      '{"mcpServers": {"a": {"command": "x", "type": "stdio", "custom": 1}}}',
    );
    expect(cfg['a']).toEqual({ command: 'x' });
  });

  it('says why a remote server cannot be used, rather than just "no command"', () => {
    expect(() =>
      parseMcpConfig('{"mcpServers": {"a": {"url": "https://x.example/mcp"}}}'),
    ).toThrow(/remote \(url\) server — Plato starts stdio servers only/);
  });

  it('rejects args that are not a list of strings', () => {
    expect(() =>
      parseMcpConfig('{"mcpServers": {"a": {"command": "x", "args": "y"}}}'),
    ).toThrow(/'args' must be a list of strings/);
  });

  it('rejects an env value that is not a string', () => {
    expect(() =>
      parseMcpConfig('{"mcpServers": {"a": {"command": "x", "env": {"K": 1}}}}'),
    ).toThrow(/env 'K' must be a string/);
  });

  it('accepts disabled as a boolean and rejects anything else', () => {
    const cfg = parseMcpConfig(
      '{"mcpServers": {"a": {"command": "x", "disabled": true}}}',
    );
    expect(cfg['a']?.disabled).toBe(true);

    expect(() =>
      parseMcpConfig('{"mcpServers": {"a": {"command": "x", "disabled": "yes"}}}'),
    ).toThrow(/'disabled' must be true or false/);
  });

  it('leaves disabled absent when unset, so the host check has one meaning', () => {
    const cfg = parseMcpConfig('{"mcpServers": {"a": {"command": "x"}}}');
    expect('disabled' in (cfg['a'] ?? {})).toBe(false);
  });
});
