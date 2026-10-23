import { parseArgs } from 'node:util';
import { PROVIDER_PRESETS } from '@applivity/plato-core';
import { loadConfig, saveConfig, type ConnectionConfig } from './config.js';
import { authPath, type Env } from './paths.js';
import {
  deleteKey,
  formatMode,
  isWideMode,
  keyringDisabled,
  listStoredKeys,
  loadKeychain,
  readAuthFile,
  resolveKey,
  saveKey,
  type Keychain,
  type ResolvedKey,
} from './keys.js';
import type { CliInput, Streams } from './io.js';
import { readLine, type Prompter } from './prompt.js';

export const AUTH_HELP = `Usage
  plato auth login [connection] [--no-keyring] [--kind anthropic|openai] [--base-url URL]
  plato auth status
  plato auth list
  plato auth logout <connection>

  login    Save a key. A standard provider asks for the key only.
  status   Show which source resolves each connection's key.
  list     Show the connections that have a saved key.
  logout   Remove a connection's saved key. The connection stays.

  The key is read from the terminal, or from standard input when there is no
  terminal: echo "$KEY" | plato auth login anthropic
`;

export interface AuthContext {
  env: Env;
  streams: Streams;
  input: CliInput;
  /** Present when the input is a terminal. */
  prompter?: Prompter;
  /** Injected by tests; loaded otherwise. `null` means unavailable. */
  keychain?: Keychain | null;
}

export async function runAuth(args: readonly string[], context: AuthContext): Promise<number> {
  const sub = args[0];
  if (sub === undefined) {
    context.streams.err(`${AUTH_HELP}\n`);
    return 2;
  }
  if (sub === '-h' || sub === '--help') {
    context.streams.out(AUTH_HELP);
    return 0;
  }
  switch (sub) {
    case 'login':
      return await login(args.slice(1), context);
    case 'status':
      return await status(context);
    case 'list':
      return await listKeys(context);
    case 'logout':
      return await logout(args.slice(1), context);
    default:
      context.streams.err(`plato auth: unknown command '${sub}'.\nRun 'plato auth --help' for usage.\n`);
      return 2;
  }
}

interface LoginFlags {
  help?: boolean;
  noKeyring?: boolean;
  kind?: string;
  baseUrl?: string;
}

function parseLogin(args: readonly string[]): { flags: LoginFlags; target?: string } {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      'no-keyring': { type: 'boolean' },
      kind: { type: 'string' },
      'base-url': { type: 'string' },
    },
  });
  if (parsed.positionals.length > 1) {
    throw new Error(`login takes one connection name; got ${parsed.positionals.length}`);
  }
  return {
    flags: {
      help: parsed.values.help,
      noKeyring: parsed.values['no-keyring'],
      kind: parsed.values.kind,
      baseUrl: parsed.values['base-url'],
    },
    target: parsed.positionals[0],
  };
}

async function login(args: readonly string[], context: AuthContext): Promise<number> {
  let parsed: ReturnType<typeof parseLogin>;
  try {
    parsed = parseLogin(args);
  } catch (error) {
    context.streams.err(`plato auth login: ${(error as Error).message}\nRun 'plato auth --help' for usage.\n`);
    return 2;
  }
  const { flags } = parsed;
  if (flags.help === true) {
    context.streams.out(AUTH_HELP);
    return 0;
  }

  const prompter = context.prompter;
  let target = parsed.target;
  if (target === undefined) {
    if (prompter === undefined) {
      context.streams.err(
        "plato auth login: name a connection, for example 'plato auth login anthropic'.\n",
      );
      return 2;
    }
    target = await prompter.ask(
      'Provider (anthropic, openai, openrouter, litellm, or a name you choose): ',
      { default: 'anthropic' },
    );
  }

  let requestedKind: 'anthropic' | 'openai' | undefined;
  if (flags.kind !== undefined) {
    if (flags.kind !== 'anthropic' && flags.kind !== 'openai') {
      context.streams.err("plato auth login: --kind must be 'anthropic' or 'openai'.\n");
      return 2;
    }
    requestedKind = flags.kind;
  }

  const config = loadConfig(context.env);
  const existing = config.connections.find((c) => c.id === target);
  const preset = PROVIDER_PRESETS.find((p) => p.id === target);

  let kind: 'anthropic' | 'openai';
  let baseUrl: string | undefined = flags.baseUrl;
  if (existing !== undefined) {
    kind = existing.kind;
    baseUrl ??= existing.baseUrl;
  } else if (preset !== undefined) {
    kind = preset.kind;
    baseUrl ??= preset.baseUrl;
  } else {
    if (requestedKind !== undefined) {
      kind = requestedKind;
    } else if (prompter !== undefined) {
      kind =
        (await prompter.ask('Wire protocol (anthropic or openai): ', {
          default: 'openai',
        })) === 'anthropic'
          ? 'anthropic'
          : 'openai';
    } else {
      context.streams.err(
        `plato auth login: '${target}' is not a known provider. ` +
          'Pass --kind anthropic|openai and --base-url for a custom endpoint.\n',
      );
      return 2;
    }
    if (prompter !== undefined) {
      const answer = await prompter.ask('Base URL: ');
      if (answer.length > 0) {
        baseUrl ??= answer;
      }
    }
    if (kind === 'openai' && baseUrl === undefined) {
      context.streams.err(
        'plato auth login: an OpenAI-compatible endpoint needs --base-url.\n',
      );
      return 2;
    }
  }

  if (requestedKind !== undefined) {
    kind = requestedKind;
  }

  const key =
    prompter !== undefined ? await prompter.secret('API key: ') : await readLine(context.input);
  const trimmed = key.trim();

  const connection: ConnectionConfig =
    baseUrl === undefined ? { id: target, kind } : { id: target, kind, baseUrl };
  const index = config.connections.findIndex((c) => c.id === target);
  if (index >= 0) {
    config.connections[index] = connection;
  } else {
    config.connections.push(connection);
  }
  saveConfig(config, context.env);

  if (trimmed.length === 0) {
    context.streams.out(
      `✓ ${target} is configured. No key saved; run 'plato auth login ${target}' to add one.\n`,
    );
    return 0;
  }

  const saved = await saveKey(target, trimmed, {
    env: context.env,
    keychain: context.keychain,
    forceFile: flags.noKeyring === true || keyringDisabled(context.env),
  });
  if (saved.store === 'keychain') {
    context.streams.out(`✓ ${target} saved to the OS keychain.\n`);
  } else if (process.platform === 'win32') {
    // M0 (D49cf): Windows has no POSIX file modes, so `chmod 0600` below is a
    // no-op and the file is plaintext that other accounts may be able to read
    // under its ACL. Saying "mode 0600" there would name protection that does
    // not exist; the keychain is the only answer on that platform.
    context.streams.out(
      `✓ ${target} saved to ${saved.path ?? authPath(context.env)}. ` +
        'Windows does not enforce file modes; this file is plaintext.\n',
    );
  } else {
    context.streams.out(`✓ ${target} saved to ${saved.path ?? authPath(context.env)} (mode 0600).\n`);
  }
  return 0;
}

function describe(key: ResolvedKey | null): string {
  if (key === null) {
    return 'no key';
  }
  switch (key.source) {
    case 'env-connection':
    case 'env-provider':
      return `env:${key.detail}`;
    case 'keychain':
      return 'keychain';
    case 'file':
      return 'file';
  }
}

async function status(context: AuthContext): Promise<number> {
  const config = loadConfig(context.env);
  const auth = readAuthFile(context.env);
  const keychain =
    context.keychain === undefined ? await loadKeychain(context.env) : context.keychain;

  if (config.connections.length === 0) {
    context.streams.out("No connections. Run 'plato auth login'.\n");
  } else {
    const rows = await Promise.all(
      config.connections.map(async (connection) => ({
        id: connection.id,
        source: describe(await resolveKey(connection, { env: context.env, keychain, auth })),
      })),
    );
    const width = Math.max(...rows.map((row) => row.id.length));
    for (const row of rows) {
      context.streams.out(`${row.id.padEnd(width)}  ${row.source}\n`);
    }
  }

  if (auth.error !== undefined) {
    context.streams.err(`warning: ${auth.error}\n`);
  }
  if (process.platform === 'win32') {
    // M0 (D49cf): `statSync().mode` on Windows is synthetic (0666 for a
    // writable file), not a permission. A "wider mode" warning would describe
    // a protection Windows never had, so say the useful thing instead.
    if (auth.mode !== undefined) {
      context.streams.err(
        `note: ${authPath(context.env)} is a plaintext key file; ` +
          'Windows does not enforce file modes.\n',
      );
    }
  } else if (auth.mode !== undefined && isWideMode(auth.mode)) {
    context.streams.err(
      `warning: ${authPath(context.env)} has mode ${formatMode(auth.mode)}; expected 0600.\n`,
    );
  }
  if (keyringDisabled(context.env)) {
    context.streams.err('note: PLATO_DISABLE_KEYRING is set; the keychain is not read.\n');
  }
  return 0;
}

async function listKeys(context: AuthContext): Promise<number> {
  const stored = await listStoredKeys(context.env, context.keychain);
  if (stored.size === 0) {
    context.streams.out("No saved keys. Run 'plato auth login <connection>'.\n");
    return 0;
  }
  const width = Math.max(...[...stored.keys()].map((id) => id.length));
  for (const id of [...stored.keys()].sort()) {
    context.streams.out(`${id.padEnd(width)}  ${[...(stored.get(id) ?? [])].join(', ')}\n`);
  }
  return 0;
}

function parseLogout(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  });
}

async function logout(args: readonly string[], context: AuthContext): Promise<number> {
  let parsed: ReturnType<typeof parseLogout>;
  try {
    parsed = parseLogout(args);
  } catch (error) {
    context.streams.err(`plato auth logout: ${(error as Error).message}\n`);
    return 2;
  }
  if (parsed.values.help === true) {
    context.streams.out(AUTH_HELP);
    return 0;
  }
  const id = parsed.positionals[0];
  if (id === undefined || parsed.positionals.length > 1) {
    context.streams.err('usage: plato auth logout <connection>\n');
    return 2;
  }

  const result = await deleteKey(id, { env: context.env, keychain: context.keychain });
  if (!result.keychain && !result.file) {
    context.streams.out(`No saved key for ${id}.\n`);
  } else {
    context.streams.out(`Removed the saved key for ${id}.\n`);
  }
  return 0;
}

