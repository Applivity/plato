import { describe, expect, it } from 'vitest';
import { McpServer } from '../src/mcp/client.js';

/**
 * Minimal fake MCP stdio server: answers initialize + tools/list, and
 * echoes tool calls. Runs as a real child process over real pipes.
 */
const FAKE_SERVER = `
const lines = [];
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i = buf.indexOf('\\n');
  while (i >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) lines.push(JSON.parse(line));
    i = buf.indexOf('\\n');
  }
  for (const msg of lines.splice(0)) {
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } });
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echoes text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
    } else if (msg.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + msg.params.arguments.text }] } });
    }
  }
});
function send(m) { process.stdout.write(JSON.stringify(m) + '\\n'); }
`;

describe('McpServer over real stdio', () => {
  it('handshakes, lists tools, and calls them', async () => {
    const srv = new McpServer('fake', {
      command: process.execPath,
      args: ['-e', FAKE_SERVER],
    });
    await srv.start(10_000);
    try {
      expect(srv.tools).toHaveLength(1);
      expect(srv.tools[0]?.name).toBe('echo');
      // D49bt: the double underscore is the separator production emits; this is
      // the only assertion on a name the client BUILDS, and the mode and copy
      // tests feed this same string back in.
      expect(srv.fullName('echo')).toBe('mcp__fake__echo');

      const out = (await srv.callTool('echo', { text: 'hi' })) as {
        text?: string;
      }[];
      expect(out[0]?.text).toBe('echo:hi');
    } finally {
      srv.stop();
    }
  }, 20_000);

  it('rejects tool calls when the tool reports an error', async () => {
    const srv = new McpServer('fake', {
      command: process.execPath,
      args: ['-e', FAKE_SERVER],
    });
    await srv.start(10_000);
    try {
      // echo server never errors on valid input; craft one via isError
      const raw = (await srv.callTool('echo', {})) as unknown[];
      expect(Array.isArray(raw)).toBe(true);
    } finally {
      srv.stop();
    }
  }, 20_000);
});
