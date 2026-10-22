import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, TurnRequest, TurnResponse } from '@applivity/plato-core';
import type { PlatoConfig } from '../src/config.js';
import { executeTask, type RunSink } from '../src/host.js';
import { startMcpServers } from '../src/mcp.js';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const FAKE_SERVER = `
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i = buf.indexOf('\\n');
  while (i >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
    i = buf.indexOf('\\n');
  }
});
function send(m) { process.stdout.write(JSON.stringify(m) + '\\n'); }
function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echoes text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
  } else if (msg.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + msg.params.arguments.text }] } });
  }
}
`;

function config(): PlatoConfig {
  return {
    connections: [{ id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1' }],
    model: 'stub:test-model',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

function writeMcp(home: string, disabled = false): Record<string, string> {
  writeFileSync(
    join(home, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        fake: {
          command: process.execPath,
          args: ['-e', FAKE_SERVER],
          ...(disabled ? { disabled: true } : {}),
        },
      },
    }),
  );
  return {
    PLATO_CONFIG_DIR: join(home, 'config'),
    PLATO_DATA_DIR: join(home, 'data'),
    PLATO_HOME: home,
    PLATO_DISABLE_KEYRING: '1',
    PLATO_KEY_STUB: 'sk-test',
  };
}

const sink: RunSink = {
  textDelta: () => {},
  textCommitted: () => {},
  tool: () => {},
  approve: async () => true,
  askUser: async () => [],
  stuck: async () => ({ action: 'stop' }),
  reveal: async () => false,
  notice: () => {},
};

describe('MCP servers', () => {
  it('starts an enabled server and reports its tools', async () => {
    const home = tempDir('plato-mcp-home-');
    const env = writeMcp(home);
    const notices: string[] = [];
    const runtime = await startMcpServers(env, 'auto', (text) => notices.push(text));
    try {
      expect(runtime.servers).toHaveLength(1);
      expect(runtime.servers[0]?.tools[0]?.name).toBe('echo');
      expect(notices).toContain('MCP fake: 1 tool available');
    } finally {
      runtime.stop();
    }
  }, 30_000);

  it('starts nothing in plan mode', async () => {
    const home = tempDir('plato-mcp-home-');
    const env = writeMcp(home);
    const notices: string[] = [];
    const runtime = await startMcpServers(env, 'plan', (text) => notices.push(text));
    try {
      expect(runtime.servers).toEqual([]);
      expect(notices).toEqual([]);
    } finally {
      runtime.stop();
    }
  });

  it('is silent about a disabled server', async () => {
    const home = tempDir('plato-mcp-home-');
    const env = writeMcp(home, true);
    const notices: string[] = [];
    const runtime = await startMcpServers(env, 'auto', (text) => notices.push(text));
    try {
      expect(runtime.servers).toEqual([]);
      expect(notices).toEqual([]);
    } finally {
      runtime.stop();
    }
  });

  it('lets the model call an MCP tool', async () => {
    const root = tempDir('plato-mcp-root-');
    const home = tempDir('plato-mcp-home-');
    const env = writeMcp(home);
    let seen = '';
    let turn = 0;
    const provider: ChatProvider = {
      id: 'openai',
      async completeTurn(request: TurnRequest): Promise<TurnResponse> {
        turn += 1;
        if (turn === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call-1',
                name: 'mcp__fake__echo',
                input: { text: 'hi' },
              },
            ],
            usage: { inputTokens: 5, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        seen = JSON.stringify(request.messages);
        return {
          content: [{ type: 'text', text: 'Done.' }],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };

    await executeTask(
      {
        root,
        task: 'echo hi',
        mode: 'auto',
        config: config(),
        env,
        provider,
        fetchImpl: (async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      },
      sink,
    );

    expect(seen).toContain('echo:hi');
  }, 30_000);
});
