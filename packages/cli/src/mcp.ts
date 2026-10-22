import { McpServer, loadMcpConfig } from '@applivity/plato-core';
import { platoHome, type Env } from './paths.js';

/**
 * MCP servers (D06/D49bt) from the shared `~/.plato/mcp.json`. `plan` starts
 * none, a disabled server is silent, and a server that fails is a notice — a
 * run with no MCP must still run.
 */
export interface McpRuntime {
  servers: McpServer[];
  stop(): void;
}

export async function startMcpServers(
  env: Env,
  mode: 'plan' | 'edit' | 'auto',
  notice: (text: string) => void,
): Promise<McpRuntime> {
  const servers: McpServer[] = [];
  const runtime: McpRuntime = {
    servers,
    stop: () => {
      for (const server of servers) {
        server.stop();
      }
    },
  };

  if (mode === 'plan') {
    return runtime;
  }

  let config;
  try {
    config = loadMcpConfig(platoHome(env));
  } catch (error) {
    notice(`mcp.json ignored — ${(error as Error).message}`);
    return runtime;
  }

  for (const [name, serverConfig] of Object.entries(config)) {
    if (serverConfig.disabled === true) {
      continue;
    }
    const server = new McpServer(name, serverConfig);
    try {
      await server.start(20_000);
      servers.push(server);
      if (server.tools.length > 0) {
        notice(
          `MCP ${name}: ${server.tools.length} ${
            server.tools.length === 1 ? 'tool' : 'tools'
          } available`,
        );
      }
    } catch (error) {
      notice(`MCP ${name} failed to start — ${(error as Error).message}`);
    }
  }

  return runtime;
}
