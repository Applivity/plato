/**
 * A fake MCP stdio server, for the field case (D49bt).
 *
 * It exists so the whole path can be driven through a real VS Code window with
 * no network, no API key and no variance: Plato spawns it, handshakes, lists its
 * tools, and the scripted model calls one. What the case then asserts — that the
 * call was gated, that the result reached the model, and that a DISABLED server
 * contributed nothing — is all Plato's behaviour, which is the point.
 *
 * Same shape as the inline server in packages/core/test/mcp-client.test.ts, and
 * deliberately a duplicate of it: the harness is a separate package and cannot
 * import that string.
 */
const lines = [];
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i = buf.indexOf('\n');
  while (i >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) {
      try {
        lines.push(JSON.parse(line));
      } catch {
        // Non-JSON noise on stdin is ignored, as a real server would.
      }
    }
    i = buf.indexOf('\n');
  }
  for (const msg of lines.splice(0)) {
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '1.0.0' },
        },
      });
    } else if (msg.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [{
            name: 'echo',
            description: 'echoes the text it is given',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          }],
        },
      });
    } else if (msg.method === 'tools/call') {
      const text = String((msg.params && msg.params.arguments || {}).text ?? '');
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: 'echo:' + text }] },
      });
    }
    // Notifications carry no id and expect no answer.
  }
});

function send(m) {
  process.stdout.write(JSON.stringify(m) + '\n');
}
