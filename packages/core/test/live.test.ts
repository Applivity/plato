import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLiveSession,
  MAX_MESSAGE_CHARS,
  type InboundMessage,
  type LiveSession,
  type ReceiveResult,
} from '../src/live.js';

/**
 * D49cq. The registry, the socket, and the two callbacks, tested on the host
 * platform (a Mac here). The Windows named-pipe path cannot run here; the
 * Windows worker proves it.
 */
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function tempHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'plato-live-'));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

async function startLive(options: {
  home: string;
  name?: string;
  summary?: string;
  busy?: boolean;
  result?: ReceiveResult;
}): Promise<{ live: LiveSession; received: InboundMessage[] }> {
  const received: InboundMessage[] = [];
  const live = await createLiveSession({
    host: 'cli',
    home: options.home,
    describe: () => ({
      name: options.name ?? 'Plato CLI',
      summary: options.summary ?? 'idle',
      busy: options.busy ?? false,
      cwd: '/tmp/project',
    }),
    receive: async (message) => {
      received.push(message);
      return options.result ?? 'started';
    },
  });
  cleanups.push(() => live.close());
  return { live, received };
}

function entries(home: string): string[] {
  return readdirSync(join(home, 'live')).filter((name) => name.endsWith('.json'));
}

function entryOf(home: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, 'live', `${id}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('the live registry (D49cq)', () => {
  it('registers one 0600 entry, and removes it on close', async () => {
    const home = await tempHome();
    const { live } = await startLive({ home });
    const dir = join(home, 'live');
    expect(entries(home)).toEqual([`${live.id}.json`]);
    expect(entryOf(home, live.id)).toMatchObject({
      v: 1,
      id: live.id,
      name: 'Plato CLI',
      host: 'cli',
    });
    const socket = entryOf(home, live.id)['endpoint'];
    expect(typeof socket).toBe('string');
    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, `${live.id}.json`)).mode & 0o777).toBe(0o600);
    }
    await live.close();
    expect(existsSync(join(dir, `${live.id}.json`))).toBe(false);
  });

  it('lists another live session and never itself', async () => {
    const home = await tempHome();
    const a = await startLive({ home, name: 'A' });
    const b = await startLive({ home, name: 'B' });
    const fromA = await a.live.list();
    const fromB = await b.live.list();
    expect(fromA.map((peer) => peer.name)).toEqual(['B']);
    expect(fromB.map((peer) => peer.name)).toEqual(['A']);
  });

  it('delivers the text with the sender identity, and reports the ack', async () => {
    const home = await tempHome();
    const a = await startLive({ home, name: 'A' });
    const b = await startLive({ home, name: 'B' });
    const outcome = await a.live.send(b.live.id, 'report your cwd');
    expect(outcome).toMatchObject({ ok: true, status: 'accepted' });
    expect(b.received).toHaveLength(1);
    expect(b.received[0]!.from).toMatchObject({ id: a.live.id, name: 'A', host: 'cli' });
    expect(b.received[0]!.text).toBe('report your cwd');
  });

  it('reports queued when the target queues the message', async () => {
    const home = await tempHome();
    const a = await startLive({ home });
    const b = await startLive({ home, result: 'queued' });
    const outcome = await a.live.send(b.live.id, 'hello');
    expect(outcome).toMatchObject({ ok: true, status: 'queued' });
  });

  it('refuses self, empty, oversized, and unknown targets', async () => {
    const home = await tempHome();
    const a = await startLive({ home, name: 'A' });
    expect(await a.live.send(a.live.id, 'hello')).toEqual({ ok: false, reason: 'self' });
    expect(await a.live.send('A', 'hello')).toEqual({ ok: false, reason: 'self' });
    expect(await a.live.send('nobody', 'hello')).toEqual({ ok: false, reason: 'unknown' });
    expect(await a.live.send('nobody', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(await a.live.send('nobody', 'x'.repeat(MAX_MESSAGE_CHARS + 1))).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('refuses a shared name and accepts the id instead', async () => {
    const home = await tempHome();
    const a = await startLive({ home, name: 'A' });
    const b = await startLive({ home, name: 'Same' });
    const c = await startLive({ home, name: 'Same' });
    const ambiguous = await a.live.send('Same', 'hello');
    expect(ambiguous).toMatchObject({ ok: false, reason: 'ambiguous' });
    if (!ambiguous.ok) {
      expect(ambiguous.detail).toContain(b.live.id);
      expect(ambiguous.detail).toContain(c.live.id);
    }
    expect(await a.live.send(c.live.id, 'hello')).toMatchObject({ ok: true, status: 'accepted' });
    expect(c.received).toHaveLength(1);
  });

  it('never shows a dead endpoint as live, and reaps it when the heartbeat is old', async () => {
    const home = await tempHome();
    const a = await startLive({ home });
    const dir = join(home, 'live');
    const dead = {
      v: 1,
      id: 'deadbeef',
      name: 'Ghost',
      summary: 'gone',
      host: 'cli',
      pid: 999999,
      cwd: '/tmp',
      started: '2026-01-01T00:00:00.000Z',
      busy: false,
      endpoint: join(dir, 'deadbeef.sock'),
      token: 'not-a-token',
      version: '0.0.0',
    };
    const path = join(dir, 'deadbeef.json');
    writeFileSync(path, JSON.stringify(dead), { mode: 0o600 });

    // Fresh heartbeat: hidden, but kept — a just-starting session must not be
    // removed by someone else's probe.
    expect(await a.live.list()).toEqual([]);
    expect(existsSync(path)).toBe(true);

    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    expect(await a.live.list()).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('closes the connection on a wrong token, before any delivery', async () => {
    const home = await tempHome();
    const b = await startLive({ home });
    const entry = entryOf(home, b.live.id);
    const socket = connect(String(entry['endpoint']));
    const closed = new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });
    socket.write(
      `${JSON.stringify({
        type: 'hello',
        v: 1,
        token: 'wrong-token',
        from: { id: 'x', name: 'x', host: 'cli' },
      })}\n`,
    );
    await closed;
    expect(b.received).toHaveLength(0);
  });

  it('refuses an oversized frame', async () => {
    const home = await tempHome();
    const b = await startLive({ home });
    const entry = entryOf(home, b.live.id);
    const socket = connect(String(entry['endpoint']));
    const closed = new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });
    socket.write(`${'x'.repeat(20_000)}\n`);
    await closed;
    expect(b.received).toHaveLength(0);
  });
});
