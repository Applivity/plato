import { maxOutputFor, parseModelRef, splitModelRef } from '@applivity/plato-core';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import {
  authPath,
  configDir,
  configPath,
  dataDir,
  platoHome,
  runsDir,
  type Env,
} from './paths.js';
import {
  formatMode,
  isWideMode,
  keyringDisabled,
  loadKeychain,
  readAuthFile,
  resolveKey,
  type Keychain,
  type ResolvedKey,
} from './keys.js';
import { readModelCache } from './models.js';
import type { Streams } from './io.js';

/**
 * `plato doctor` answers the questions a user has BEFORE a run works and AFTER
 * one surprised them: is the config readable, can a key be resolved for each
 * connection, is the keychain available, what limits does the default model
 * advertise, can Plato write its three homes, and what did the last run in this
 * directory do? It reads the model cache and the newest transcript and never
 * touches the network, so it is fast and safe to run first — and it is the
 * place to look instead of a separate debug log.
 */
export interface DoctorContext {
  env: Env;
  streams: Streams;
  /** The directory the report is about; run transcripts are keyed by it. */
  root?: string;
  keychain?: Keychain | null;
  nodeVersion?: string;
}

type Mark = 'ok' | 'warn' | 'fail';

const MARKS: Record<Mark, string> = { ok: '✓', warn: '!', fail: '✗' };

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Creates the directory if it is missing and writes one file in it. `access`
 * would answer for the directory and miss the common case — a file that a
 * previous run left owned by another user — so this asks the question a run
 * asks, and removes what it wrote either way.
 */
function writeFailure(dir: string): string | null {
  const probe = join(dir, `.plato-doctor-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // The probe could not be written in the first place.
    }
  }
}

function ago(iso: string | undefined, now: number): string {
  if (iso === undefined) {
    return 'at an unknown time';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'at an unknown time';
  }
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface LastRun {
  path: string;
  startedAt: string | undefined;
  count: number;
  /** What ended it, and how many turns it took. */
  outcome: string | null;
  failed: boolean;
}

/**
 * The newest transcript and how it ended. A run writes its events as it goes,
 * so the last `run-completed` or `run-failed` is the outcome; a file with
 * neither is a run that was killed, which is worth saying rather than hiding.
 */
function lastRun(dir: string): LastRun | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return null;
  }
  if (names.length === 0) {
    return null;
  }
  names.sort();
  const name = names[names.length - 1]!;
  const path = join(dir, name);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { path, startedAt: undefined, count: names.length, outcome: null, failed: false };
  }
  let startedAt: string | undefined;
  let outcome: string | null = null;
  let failed = false;
  for (const line of text.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // a half-written final line is not a reason to fail the report
    }
    if (event['kind'] === 'header' && typeof event['startedAt'] === 'string') {
      startedAt = event['startedAt'];
    }
    if (event['type'] === 'run-completed') {
      const turns = typeof event['turns'] === 'number' ? event['turns'] : 0;
      outcome = `${String(event['reason'] ?? 'complete')}, ${turns} ${
        turns === 1 ? 'turn' : 'turns'
      }`;
      failed = false;
    }
    if (event['type'] === 'run-failed') {
      outcome = `failed: ${String(event['error'] ?? 'unknown error')}`;
      failed = true;
    }
  }
  return { path, startedAt, count: names.length, outcome, failed };
}

export async function runDoctor(context: DoctorContext): Promise<number> {
  const { streams } = context;
  let failures = 0;
  const line = (mark: Mark, text: string): void => {
    if (mark === 'fail') {
      failures += 1;
    }
    streams.out(`${MARKS[mark]} ${text}\n`);
  };

  streams.out('Plato doctor\n\n');

  const nodeVersion = context.nodeVersion ?? process.versions.node;
  const major = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10);
  if (major >= 22) {
    line('ok', `Node ${nodeVersion} (needs 22 or newer)`);
  } else {
    line('fail', `Node ${nodeVersion} is older than 22; upgrade Node`);
  }

  let config;
  try {
    config = loadConfig(context.env);
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : String(error);
    line('fail', `Config ${configPath(context.env)}: ${message}`);
    return 1;
  }
  const connectionCount = config.connections.length;
  line(
    'ok',
    `Config ${configPath(context.env)} (${connectionCount} ${
      connectionCount === 1 ? 'connection' : 'connections'
    })`,
  );

  const ids = config.connections.map((connection) => connection.id);
  const defaultRef = parseModelRef(config.model, ids);
  let defaultConnectionId: string | undefined;
  if (defaultRef === null) {
    const parts = splitModelRef(config.model);
    const reason =
      parts === null
        ? `'${config.model}' is not connection:model`
        : `the connection '${parts.connectionId}' is not configured`;
    line('fail', `Model ${config.model}: ${reason}`);
  } else {
    defaultConnectionId = defaultRef.connectionId;
    const cache = readModelCache(context.env);
    const advertised = cache[defaultRef.connectionId]?.pool.find(
      (entry) => entry.id === defaultRef.model,
    );
    const output = maxOutputFor(defaultRef.model);
    const contextNote =
      advertised?.maxContext === undefined
        ? 'context unknown; run plato models'
        : `context ${withCommas(advertised.maxContext)}`;
    line(
      'ok',
      `Model ${config.model} (output ${withCommas(output)}, ${contextNote})`,
    );
  }

  const keychain =
    context.keychain === undefined ? await loadKeychain(context.env) : context.keychain;
  if (keychain === null) {
    line(
      'warn',
      keyringDisabled(context.env)
        ? 'Keychain disabled by PLATO_DISABLE_KEYRING; the 0600 file fallback is used'
        : 'Keychain unavailable; the 0600 file fallback is used',
    );
  } else {
    try {
      await keychain.probe();
      line('ok', 'Keychain available');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      line('warn', `Keychain: ${message}; the 0600 file fallback is used`);
    }
  }

  const auth = readAuthFile(context.env);
  for (const connection of config.connections) {
    let resolved: ResolvedKey | null;
    try {
      resolved = await resolveKey(connection, {
        env: context.env,
        keychain,
        auth,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      line('fail', `Key ${connection.id}: ${message}`);
      continue;
    }
    const isDefault = connection.id === defaultConnectionId;
    if (resolved === null) {
      line(
        isDefault ? 'fail' : 'warn',
        `Key ${connection.id}: no key; run 'plato auth login ${connection.id}'`,
      );
    } else {
      const where =
        resolved.source === 'env-connection' || resolved.source === 'env-provider'
          ? `env:${resolved.detail}`
          : resolved.source;
      line('ok', `Key ${connection.id}: ${where}`);
    }
  }

  if (auth.error !== undefined) {
    line('warn', auth.error);
  }
  if (auth.mode !== undefined && isWideMode(auth.mode)) {
    line(
      'warn',
      `Credential file ${authPath(context.env)} has mode ${formatMode(auth.mode)}; expected 0600`,
    );
  }

  streams.out('\nState\n');
  if (config.respectGitignore) {
    line('ok', 'Search skips .gitignore paths');
  } else {
    line(
      'warn',
      'Search includes .gitignore paths; set "respectGitignore": true in the config to skip them',
    );
  }
  for (const dir of [configDir(context.env), dataDir(context.env), platoHome(context.env)]) {
    const failure = writeFailure(dir);
    if (failure === null) {
      line('ok', `Writes to ${dir}`);
    } else {
      line('fail', `Cannot write ${dir}: ${failure}`);
    }
  }

  const root = context.root ?? process.cwd();
  const runs = runsDir(root, context.env);
  const newest = lastRun(runs);
  if (newest === null) {
    line('warn', `No runs yet in ${root}`);
  } else {
    const count = `${newest.count} ${newest.count === 1 ? 'run' : 'runs'}`;
    const when = ago(newest.startedAt, Date.now());
    const outcome = newest.outcome ?? 'no outcome was recorded (the run was interrupted)';
    line(
      newest.failed ? 'warn' : 'ok',
      `Last run ${when}: ${outcome} — ${newest.path} (${count})`,
    );
  }

  return failures > 0 ? 1 : 0;
}
