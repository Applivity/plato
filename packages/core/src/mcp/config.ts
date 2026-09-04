/**
 * mcp.yaml reader (D06): tiny zero-dependency parser for the subset we
 * document —
 *   servers:
 *     name:
 *       command: node
 *       args: [server.js, --flag]
 *       env:
 *         KEY: value
 * Anything fancier is rejected with a clear error rather than guessed.
 */
import { readFileSync } from 'node:fs';
import type { McpServerConfig } from './client.js';

export function parseMcpConfig(text: string): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const lines = text.split('\n');
  let name: string | null = null;
  let section: 'args' | 'env' | null = null;

  const fail = (ln: number, why: string): never => {
    throw new Error(`mcp.yaml line ${ln + 1}: ${why}`);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim().length === 0 || raw.trim().startsWith('#')) {
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0) {
      if (trimmed !== 'servers:') {
        fail(i, `expected 'servers:', got '${trimmed}'`);
      }
      name = null;
      section = null;
      continue;
    }

    if (name === null || (indent === 2 && trimmed.endsWith(':'))) {
      const m = /^([A-Za-z0-9_-]+):\s*$/.exec(trimmed);
      if (m === null) {
        throw new Error(
          `mcp.yaml line ${i + 1}: expected a server name like 'name:', got '${trimmed}'`,
        );
      }
      name = m[1]!;
      out[name] = { command: '' };
      section = null;
      continue;
    }

    const cfg = out[name]!;

    // env: KEY: value  (3rd level)
    if (section === 'env' && indent >= 6) {
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
      if (m === null) {
        throw new Error(
          `mcp.yaml line ${i + 1}: expected 'KEY: value' under env, got '${trimmed}'`,
        );
      }
      const k = m[1]!;
      cfg.env = cfg.env ?? {};
      cfg.env[k] = unquote(m[2] ?? '');
      continue;
    }

    // args list items (3rd level): - item
    if (section === 'args' && indent >= 6 && trimmed.startsWith('- ')) {
      cfg.args = cfg.args ?? [];
      cfg.args.push(unquote(trimmed.slice(2)));
      continue;
    }

    // 2nd level keys
    section = null;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (kv === null) {
      throw new Error(
        `mcp.yaml line ${i + 1}: expected 'key: value', got '${trimmed}'`,
      );
    }
    const key = kv[1]!;
    const val = kv[2] ?? '';
    if (key === 'command') {
      cfg.command = unquote(val);
    } else if (key === 'args') {
      if (val.length > 0) {
        // Inline list: [a, b]
        const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
        cfg.args =
          inner.length > 0
            ? inner.split(',').map((x) => unquote(x.trim()))
            : [];
      } else {
        section = 'args';
      }
    } else if (key === 'env') {
      if (val.length > 0) {
        fail(i, 'env must be a block; use lines under env:');
      }
      section = 'env';
    } else {
      fail(i, `unknown key '${key}'`);
    }
  }

  for (const [n, c] of Object.entries(out)) {
    if (!c.command) {
      throw new Error(`mcp.yaml: server '${n}' is missing 'command'`);
    }
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Reads and parses `<configDir>/mcp.yaml`. D46: the config dir is Plato's home
 * folder (`~/.plato`) — project-scoped MCP is a later discussion, like the
 * per-project council. Missing → empty config.
 */
export function loadMcpConfig(
  configDir: string,
): Record<string, McpServerConfig> {
  try {
    return parseMcpConfig(readFileSync(join(configDir, 'mcp.yaml'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
    return {};
  }
}

import { join } from 'node:path';
