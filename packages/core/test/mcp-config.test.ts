import { describe, expect, it } from 'vitest';
import { parseMcpConfig } from '../src/mcp/config.js';

describe('parseMcpConfig', () => {
  it('parses command, inline args, block args, and env', () => {
    const cfg = parseMcpConfig(`
servers:
  fetch:
    command: node
    args: [server.js, --port, "3000"]
  fs:
    command: ./fs-server
    args:
      - --root
      - /tmp/data
    env:
      API_KEY: "s3cret"
      DEBUG: 1
`);
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

  it('missing file handled by loader; empty servers map ok', () => {
    expect(parseMcpConfig('servers:\n')).toEqual({});
  });

  it('rejects unknown top-level keys with a line number', () => {
    expect(() => parseMcpConfig('tools:\n  x: y\n')).toThrow(/line 1/);
  });

  it('rejects a server without command', () => {
    expect(() =>
      parseMcpConfig('servers:\n  broken:\n    args: [x]\n'),
    ).toThrow(/missing 'command'/);
  });
});
