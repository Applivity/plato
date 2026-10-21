/**
 * mcp.json reader (D06, D49bt): the config file is the shape the whole MCP
 * ecosystem uses —
 *   { "mcpServers": { "<name>": { "command": "...", "args": [...],
 *                                 "env": {...}, "disabled": false } } }
 * — so a block copied from a server's README drops straight in.
 *
 * D49bt: this was YAML, parsed by a hand-rolled subset parser. It is JSON now,
 * so the platform does the parsing. JSON.parse cannot be subtly wrong about
 * indentation or quoting, and the old inline `args` form re-split every argument
 * that contained a comma. What is left here is shape validation, which is the
 * part a general parser cannot do for us. Comments are the price: JSON has none,
 * and there is NO editor schema either — one was written and removed, because VS
 * Code will not load a schema for a file outside every workspace (D49bt measured
 * it three ways). The Settings panel is where the format is explained.
 *
 * KEYS PLATO DOES NOT KNOW ARE KEPT, NOT REJECTED. Claude Code writes
 * `"type": "stdio"` inside every entry and other clients add fields of their own;
 * a strict parser would refuse a config copied from the very tools this shape
 * imitates. Strictness lives in the schema, where the editor can warn about a
 * typo without making the file unloadable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServerConfig } from './client.js';

export function parseMcpConfig(text: string): Record<string, McpServerConfig> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    // JSON.parse's own message carries the offset, so it is passed through
    // rather than re-derived into a line number we would have to count.
    throw new Error(
      `mcp.json is not valid JSON — ${
        e instanceof Error ? e.message : 'parse error'
      }`,
    );
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('mcp.json: the top level must be an object');
  }
  const raw = (doc as Record<string, unknown>)['mcpServers'];
  if (raw === undefined) {
    throw new Error(
      'mcp.json: expected an "mcpServers" object at the top level',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('mcp.json: "mcpServers" must be an object of server names');
  }

  const out: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = readServer(name, value);
  }
  return out;
}

/** Validates one entry of `mcpServers`, naming the server in every error. */
function readServer(name: string, value: unknown): McpServerConfig {
  const at = `mcp.json: server '${name}'`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`);
  }
  const rec = value as Record<string, unknown>;

  const command = rec['command'];
  if (typeof command !== 'string' || command.length === 0) {
    // A remote entry is the likeliest reason to be here: most configs published
    // today carry a `url` rather than a command, and "missing command" alone
    // would not tell anyone why Plato cannot use it.
    if (typeof rec['url'] === 'string') {
      throw new Error(
        `${at} is a remote (url) server — Plato starts stdio servers only`,
      );
    }
    throw new Error(`${at} is missing a 'command'`);
  }
  const cfg: McpServerConfig = { command };

  const args = rec['args'];
  if (args !== undefined) {
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      throw new Error(`${at}: 'args' must be a list of strings`);
    }
    cfg.args = args as string[];
  }

  const env = rec['env'];
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) {
      throw new Error(`${at}: 'env' must be an object of NAME: value`);
    }
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(`${at}: env '${k}' must be a string`);
      }
      vars[k] = v;
    }
    cfg.env = vars;
  }

  const disabled = rec['disabled'];
  if (disabled !== undefined) {
    if (typeof disabled !== 'boolean') {
      throw new Error(`${at}: 'disabled' must be true or false`);
    }
    cfg.disabled = disabled;
  }

  return cfg;
}

/**
 * Reads and parses `<configDir>/mcp.json`. D46: the config dir is Plato's home
 * folder (`~/.plato`) — project-scoped MCP is a later discussion, like the
 * per-project council. Missing → empty config; malformed → thrown.
 */
export function loadMcpConfig(
  configDir: string,
): Record<string, McpServerConfig> {
  try {
    return parseMcpConfig(readFileSync(join(configDir, 'mcp.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
    return {};
  }
}

/** The body Settings writes when mcp.json does not exist yet. */
export const EMPTY_MCP_CONFIG = '{\n  "mcpServers": {}\n}\n';

/**
 * Flips `disabled` on one server and re-serializes (D49bt).
 *
 * This edits the parsed DOCUMENT rather than rebuilding it from the validated
 * config, and that distinction is the whole point: a config copied from another
 * client carries fields Plato ignores — `"type": "stdio"` is in every Claude
 * Code entry — and rebuilding from our own subset would silently delete them the
 * first time someone clicked a toggle. Server order and per-server key order
 * survive the same way.
 */
export function withServerDisabled(
  text: string,
  name: string,
  disabled: boolean,
): string {
  const cfg = parseMcpConfig(text);
  if (!(name in cfg)) {
    throw new Error(`mcp.json: no server named '${name}'`);
  }
  const doc = JSON.parse(text) as Record<string, unknown>;
  const servers = doc['mcpServers'] as Record<string, unknown>;
  const entry = servers[name];
  if (typeof entry === 'object' && entry !== null) {
    // Written either way, so an explicit `false` is preserved rather than
    // deleted — "explicitly on" must stay distinguishable from "never set".
    (entry as Record<string, unknown>)['disabled'] = disabled;
  }
  return JSON.stringify(doc, null, 2) + '\n';
}
