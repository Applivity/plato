/**
 * Live sessions (D49cq): one local endpoint per running Plato process, so an
 * agent can see the other sessions on this machine and send one of them a
 * message — the terminal, each VS Code window, and each Visual Studio window.
 *
 * The design decisions this file implements:
 *
 * - **The registry is an address book, never proof of life.** One JSON file per
 *   process under `<plato home>/live/` says where to connect and what the
 *   session is called. Liveness is a connect plus handshake; a crashed process
 *   leaves both its entry and its socket behind, and neither is trusted.
 * - **One endpoint per session.** Unix domain socket on POSIX, named pipe on
 *   Windows (`net` does not promise UDS there). Newline-delimited JSON, a 16 KiB
 *   frame cap, a 4,000-character message cap, and a 32-byte token in the
 *   handshake.
 * - **The token is the credential.** It lives in the 0600 entry, so possession
 *   means "a process that can read this user's files". That is the same trust
 *   boundary `auth.json` already has: another process run by the same user can
 *   impersonate a session, and no file mode can prevent it. Another user cannot
 *   read the entry, so cannot get a token.
 * - **Hosts supply two callbacks and nothing else** (`describe`, `receive`);
 *   registry, socket, framing and tokens stay here, shared by all three hosts.
 *
 * A message is TEXT for a model, never keystrokes and never a tool call. The
 * receiving host decides where it appears; its mode and approvals still gate
 * whatever it then does.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type HostKind = 'cli' | 'vscode' | 'vs';
type Platform = NodeJS.Platform;

export const PROTOCOL_VERSION = 1;
/** Longest message text, in characters. More is refused, never truncated. */
export const MAX_MESSAGE_CHARS = 4_000;
/** Longest line either side will read before it is a framing error. */
export const MAX_FRAME_CHARS = 16 * 1024;
/** A peer that cannot complete a handshake in this window is not live. */
export const PROBE_TIMEOUT_MS = 250;
/** The full handshake and message has this long once connected. */
export const HANDSHAKE_TIMEOUT_MS = 2_000;
/** The owning process touches its entry's mtime at this rate. */
export const HEARTBEAT_MS = 10_000;
/** An entry whose endpoint failed AND whose mtime is older may be reaped. */
export const STALE_AFTER_MS = 30_000;

/**
 * What the host knows about itself; called at registration and on every
 * `refresh()`. Close does not call it — the entry is being deleted, not updated.
 */
export interface SessionDescription {
  /** User-visible, ≤ 60 chars in practice. The chat title is the natural value. */
  name: string;
  /** Matchable text for `list_sessions`: current task, mode, busy. */
  summary: string;
  busy: boolean;
  cwd: string;
}

export interface InboundFrom {
  id: string;
  name: string;
  host: HostKind;
}

export interface InboundMessage {
  from: InboundFrom;
  text: string;
  /** ISO 8601, set by the receiving transport, not the sender's clock. */
  receivedAt: string;
}

export type ReceiveResult = 'started' | 'queued' | 'refused';

export interface SessionPeer {
  id: string;
  name: string;
  summary: string;
  host: HostKind;
  busy: boolean;
  cwd: string;
  started: string;
}

export type SendOutcome =
  | { ok: true; to: SessionPeer; status: 'accepted' | 'queued' }
  | {
      ok: false;
      reason:
        | 'unknown'
        | 'ambiguous'
        | 'self'
        | 'closed'
        | 'too-long'
        | 'empty'
        | 'not-accepting'
        | 'error';
      detail?: string;
    };

/** The two callbacks every host implements (D49cq §8). */
export type DescribeSession = () => SessionDescription;
export type ReceiveMessage = (message: InboundMessage) => Promise<ReceiveResult>;

export interface LiveSession {
  readonly id: string;
  readonly name: string;
  /** Live peers, self excluded. Probing is what makes "live" true. */
  list(): Promise<SessionPeer[]>;
  /** Resolves when the target acknowledged, queued, or refused. */
  send(to: string, text: string): Promise<SendOutcome>;
  /** Re-read `describe()` and rewrite this session's entry. */
  refresh(): void;
  /** Unregister, unlisten, and remove the socket. Idempotent. */
  close(): Promise<void>;
}

export interface CreateLiveSessionOptions {
  host: HostKind;
  /** The shared `<plato home>` (usually `~/.plato`). Its `live/` child is ours. */
  home: string;
  describe: DescribeSession;
  receive: ReceiveMessage;
  platform?: Platform;
  /** The host's own version, for debugging the registry. */
  version?: string;
  /** Tests only: override the registry directory. */
  dir?: string;
}

interface Entry {
  v: number;
  id: string;
  name: string;
  summary: string;
  host: HostKind;
  pid: number;
  cwd: string;
  started: string;
  busy: boolean;
  endpoint: string;
  token: string;
  version: string;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    e['v'] === PROTOCOL_VERSION &&
    typeof e['id'] === 'string' &&
    typeof e['name'] === 'string' &&
    typeof e['summary'] === 'string' &&
    (e['host'] === 'cli' || e['host'] === 'vscode' || e['host'] === 'vs') &&
    typeof e['cwd'] === 'string' &&
    typeof e['started'] === 'string' &&
    typeof e['busy'] === 'boolean' &&
    typeof e['endpoint'] === 'string' &&
    typeof e['token'] === 'string'
  );
}

function peerOf(entry: Entry): SessionPeer {
  return {
    id: entry.id,
    name: entry.name,
    summary: entry.summary,
    host: entry.host,
    busy: entry.busy,
    cwd: entry.cwd,
    started: entry.started,
  };
}

/** One endpoint per session: a UDS where the path fits, otherwise a private one. */
function endpointFor(platform: Platform, liveDir: string, id: string): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\plato-${id}`;
  }
  const candidate = join(liveDir, `${id}.sock`);
  // `sun_path` is 104 bytes on macOS and 108 on Linux. A long home directory
  // would silently truncate the path, so fall back to a short private one.
  if (Buffer.byteLength(candidate) < 100) {
    return candidate;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const fallback = join(tmpdir(), `plato-${uid}`);
  mkdirSync(fallback, { recursive: true, mode: 0o700 });
  return join(fallback, `${id}.sock`);
}

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Creates the entry, refusing to overwrite another session that drew the id. */
function createEntry(dir: string, entry: Entry): void {
  writeFileSync(join(dir, `${entry.id}.json`), `${JSON.stringify(entry)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

/** Replaces this session's own entry atomically. */
function writeEntry(dir: string, entry: Entry): void {
  const path = join(dir, `${entry.id}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function readEntry(path: string): Entry | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Deletes an entry ONLY if it is still the one that was judged dead: the file is
 * re-read and its identity compared before unlinking, so a session that
 * registered between the probe and the reap keeps its entry.
 */
function reapIfSame(dir: string, entry: Entry, platform: Platform): void {
  const path = join(dir, `${entry.id}.json`);
  const current = readEntry(path);
  if (current === null || current.id !== entry.id || current.started !== entry.started) {
    return;
  }
  try {
    unlinkSync(path);
    if (platform !== 'win32') {
      try {
        unlinkSync(current.endpoint);
      } catch {
        // The socket was already gone; the entry was the only artifact.
      }
    }
  } catch {
    // Another session reaped it first; that is the same outcome.
  }
}

/**
 * Removes one session's entry and socket, synchronously — all `process.once`
 * handlers on `exit` can do.
 */
function removeSessionFiles(dir: string, id: string, platform: Platform): void {
  const path = join(dir, `${id}.json`);
  const entry = readEntry(path);
  if (entry === null) return;
  try {
    unlinkSync(path);
  } catch {
    // Already reaped by someone else.
  }
  if (platform === 'win32') return;
  try {
    unlinkSync(entry.endpoint);
  } catch {
    // The socket was already gone.
  }
}

/**
 * The sessions this process has open, so ONE exit handler can clean up after
 * all of them.
 *
 * A `process.once('exit')` per session was the obvious shape and the wrong one:
 * every ChatHost in a VS Code window is a session, and twelve tabs is ordinary,
 * so the eleventh would trip Node's MaxListenersExceededWarning. The hook is
 * installed by the first session and never again; it reads the set at exit, so
 * a session that closed earlier is simply not in it.
 */
const openSessions = new Set<{ dir: string; id: string; platform: Platform }>();
let exitHookInstalled = false;

function installExitHook(registration: {
  dir: string;
  id: string;
  platform: Platform;
}): void {
  openSessions.add(registration);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const session of openSessions) {
      removeSessionFiles(session.dir, session.id, session.platform);
    }
  });
}

interface Hello {
  type: 'hello';
  v: number;
  token: string;
  from: InboundFrom;
}

interface WireMessage {
  type: 'message';
  id: string;
  text: string;
  sentAt: string;
}

function isFrom(value: unknown): value is InboundFrom {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f['id'] === 'string' &&
    f['id'].length > 0 &&
    typeof f['name'] === 'string' &&
    (f['host'] === 'cli' || f['host'] === 'vscode' || f['host'] === 'vs')
  );
}

function isHello(value: Record<string, unknown>): value is Record<string, unknown> & Hello {
  return (
    value['type'] === 'hello' &&
    value['v'] === PROTOCOL_VERSION &&
    typeof value['token'] === 'string' &&
    isFrom(value['from'])
  );
}

function isWireMessage(
  value: Record<string, unknown>,
): value is Record<string, unknown> & WireMessage {
  return (
    value['type'] === 'message' &&
    typeof value['id'] === 'string' &&
    typeof value['text'] === 'string' &&
    value['text'].length <= MAX_MESSAGE_CHARS
  );
}

/** Splits newline-delimited JSON, refusing an oversized line. */
function lineReader(socket: Socket, onLine: (line: string) => void, onBad: () => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_FRAME_CHARS && !buffer.includes('\n')) {
      onBad();
      return;
    }
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > MAX_FRAME_CHARS) {
        onBad();
        return;
      }
      if (line.trim().length > 0) onLine(line);
    }
  });
}

/** Connects to a peer, proves the token, and asks whether it is there. */
function probePeer(entry: Entry, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(entry.endpoint);
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('connect', () => {
      const hello: Hello = {
        type: 'hello',
        v: PROTOCOL_VERSION,
        token: entry.token,
        from: { id: 'probe', name: 'probe', host: 'cli' },
      };
      socket.write(`${JSON.stringify(hello)}\n`);
    });
    lineReader(
      socket,
      (line) => {
        try {
          const reply = JSON.parse(line) as Record<string, unknown>;
          if (reply['type'] === 'welcome') finish(true);
        } catch {
          finish(false);
        }
      },
      () => finish(false),
    );
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

interface Ack {
  status: 'accepted' | 'queued' | 'refused' | 'error' | 'timeout';
  reason?: string;
}

/** Delivers one message and waits for the acknowledgement. */
function deliver(
  entry: Entry,
  text: string,
  from: InboundFrom,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
): Promise<Ack> {
  return new Promise((resolve) => {
    const socket = connect(entry.endpoint);
    let stage: 'welcome' | 'ack' = 'welcome';
    let acked = false;
    let done = false;
    const finish = (ack: Ack): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ack);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    socket.on('connect', () => {
      const hello: Hello = {
        type: 'hello',
        v: PROTOCOL_VERSION,
        token: entry.token,
        from,
      };
      socket.write(`${JSON.stringify(hello)}\n`);
    });
    lineReader(
      socket,
      (line) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(line) as Record<string, unknown>;
        } catch {
          finish({ status: 'error', reason: 'bad frame' });
          return;
        }
        if (stage === 'welcome' && frame['type'] === 'welcome') {
          stage = 'ack';
          acked = true;
          const message: WireMessage = {
            type: 'message',
            id: randomBytes(8).toString('hex'),
            text,
            sentAt: new Date().toISOString(),
          };
          socket.write(`${JSON.stringify(message)}\n`);
          return;
        }
        if (stage === 'ack' && frame['type'] === 'ack') {
          const status = frame['status'];
          if (status === 'accepted' || status === 'queued' || status === 'refused') {
            const reason = typeof frame['reason'] === 'string' ? frame['reason'] : undefined;
            finish({ status, ...(reason === undefined ? {} : { reason }) });
          } else {
            finish({ status: 'error', reason: 'bad ack' });
          }
        }
      },
      () => finish({ status: 'error', reason: 'frame too long' }),
    );
    socket.on('error', () => finish({ status: 'error', reason: 'connection failed' }));
    socket.on('close', () => {
      if (!acked) finish({ status: 'error', reason: 'closed before welcome' });
    });
  });
}

/**
 * Starts one live session: register the entry, listen on the endpoint, and
 * return the handle the host and core use.
 *
 * Registration happens AFTER `listen` resolves, so an entry is never visible
 * before its endpoint answers.
 */
export async function createLiveSession(
  options: CreateLiveSessionOptions,
): Promise<LiveSession> {
  const platform = options.platform ?? process.platform;
  const dir = options.dir ?? join(options.home, 'live');
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const token = randomBytes(32).toString('base64url');
  let description = options.describe();
  const id = randomBytes(4).toString('hex');
  const endpoint = endpointFor(platform, dir, id);
  const started = new Date().toISOString();

  const entry = (): Entry => ({
    v: PROTOCOL_VERSION,
    id,
    name: description.name,
    summary: description.summary,
    host: options.host,
    pid: process.pid,
    cwd: description.cwd,
    started,
    busy: description.busy,
    endpoint,
    token,
    version: options.version ?? '0.0.0',
  });

  const server: Server = createServer((socket) => {
    let stage: 'hello' | 'message' = 'hello';
    // Provenance comes from the handshake, never from the message frame: the
    // sender cannot choose a different name for the text than for the hello.
    let from: InboundFrom | null = null;
    const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    socket.on('close', () => clearTimeout(timer));
    socket.on('error', () => socket.destroy());

    lineReader(
      socket,
      (line) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(line) as Record<string, unknown>;
        } catch {
          socket.destroy();
          return;
        }
        if (stage === 'hello') {
          if (!isHello(frame) || !tokenMatches(token, frame['token'])) {
            socket.destroy();
            return;
          }
          stage = 'message';
          from = frame.from;
          socket.write(`${JSON.stringify({ type: 'welcome', v: PROTOCOL_VERSION, id, name: description.name })}\n`);
          return;
        }
        if (from === null || !isWireMessage(frame)) {
          socket.destroy();
          return;
        }
        const message: InboundMessage = {
          from,
          text: frame.text,
          receivedAt: new Date().toISOString(),
        };
        options
          .receive(message)
          .then((result) => {
            const status = result === 'started' ? 'accepted' : result;
            socket.write(`${JSON.stringify({ type: 'ack', id: frame.id, status })}\n`);
            socket.end();
          })
          .catch((error: unknown) => {
            const reason = error instanceof Error ? error.message : 'receive failed';
            socket.write(
              `${JSON.stringify({ type: 'ack', id: frame.id, status: 'refused', reason })}\n`,
            );
            socket.end();
          });
      },
      () => socket.destroy(),
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(endpoint, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const path = join(dir, `${id}.json`);
  try {
    createEntry(dir, entry());
  } catch (error) {
    // The id was taken between generation and creation. Close what we opened
    // and let the caller decide; a retry with a fresh id is the safe answer.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (platform !== 'win32') {
      try {
        unlinkSync(endpoint);
      } catch {
        // Nothing to remove.
      }
    }
    throw error;
  }

  const heartbeat = setInterval(() => {
    const now = new Date();
    try {
      utimesSync(path, now, now);
    } catch {
      // The entry was removed underneath us; the socket still identifies us.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // Registered only after the entry exists, so the hook never tries to clean up
  // a session that failed to start. One hook for the whole process.
  const registration = { dir, id, platform };
  installExitHook(registration);

  let closed = false;

  const list = async (): Promise<SessionPeer[]> => {
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
    const others: Entry[] = [];
    for (const name of names) {
      const candidate = readEntry(join(dir, name));
      if (candidate === null || candidate.id === id) continue;
      others.push(candidate);
    }
    const verdicts = await Promise.all(
      others.map(async (candidate) => ({ entry: candidate, alive: await probePeer(candidate) })),
    );
    const alive: Entry[] = [];
    for (const verdict of verdicts) {
      if (verdict.alive) {
        alive.push(verdict.entry);
        continue;
      }
      // Hide it either way; reap it only when the heartbeat also says dead.
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(join(dir, `${verdict.entry.id}.json`)).mtimeMs;
      } catch {
        continue;
      }
      if (Date.now() - mtimeMs > STALE_AFTER_MS) {
        reapIfSame(dir, verdict.entry, platform);
      }
    }
    return alive.sort((a, b) => a.started.localeCompare(b.started)).map(peerOf);
  };

  const resolvePeer = (peers: SessionPeer[], to: string): SessionPeer | SendOutcome => {
    const wanted = to.trim();
    const lower = wanted.toLowerCase();
    const byId = peers.find((peer) => peer.id === lower);
    if (byId !== undefined) return byId;
    const byName = peers.filter((peer) => peer.name.toLowerCase() === lower);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        detail: byName.map((peer) => `${peer.id} (${peer.name})`).join(', '),
      };
    }
    const byPrefix = peers.filter(
      (peer) =>
        peer.id.toLowerCase().startsWith(lower) || peer.name.toLowerCase().startsWith(lower),
    );
    if (byPrefix.length === 1) return byPrefix[0]!;
    if (byPrefix.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        detail: byPrefix.map((peer) => `${peer.id} (${peer.name})`).join(', '),
      };
    }
    return { ok: false, reason: 'unknown' };
  };

  const send = async (to: string, text: string): Promise<SendOutcome> => {
    if (text.trim().length === 0) return { ok: false, reason: 'empty' };
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'too-long' };

    const ownName = description.name.toLowerCase();
    if (to.trim().toLowerCase() === id || to.trim().toLowerCase() === ownName) {
      return { ok: false, reason: 'self' };
    }

    const peers = await list();
    const resolved = resolvePeer(peers, to);
    if ('ok' in resolved) return resolved;

    // Re-read the entry so the token and endpoint are the ones on disk now.
    const entryNow = readEntry(join(dir, `${resolved.id}.json`));
    if (entryNow === null) return { ok: false, reason: 'closed' };

    const ack = await deliver(entryNow, text, {
      id,
      name: description.name,
      host: options.host,
    });
    if (ack.status === 'accepted' || ack.status === 'queued') {
      return { ok: true, to: resolved, status: ack.status };
    }
    if (ack.status === 'refused') {
      return { ok: false, reason: 'not-accepting', ...(ack.reason === undefined ? {} : { detail: ack.reason }) };
    }
    // No handshake, no welcome: the target did not answer. That is not proof it
    // is dead — a host can be blocked for longer than the 2 s window — so the
    // entry is reaped only when its heartbeat says dead too, exactly as `list()`
    // decides. Reaping on the timeout alone would let one chat unregister
    // another live one.
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(join(dir, `${entryNow.id}.json`)).mtimeMs;
    } catch {
      // The entry is already gone; there is nothing to reap.
    }
    if (Date.now() - mtimeMs > STALE_AFTER_MS) {
      reapIfSame(dir, entryNow, platform);
    }
    return { ok: false, reason: 'closed' };
  };

  const refresh = (): void => {
    try {
      description = options.describe();
      writeEntry(dir, entry());
    } catch {
      // A host that cannot describe itself keeps its last published state.
    }
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    openSessions.delete(registration);
    clearInterval(heartbeat);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      unlinkSync(path);
    } catch {
      // Already reaped.
    }
    if (platform !== 'win32') {
      try {
        unlinkSync(endpoint);
      } catch {
        // Already gone.
      }
    }
  };

  return {
    id,
    get name() {
      return description.name;
    },
    list,
    send,
    refresh,
    close,
  };
}
