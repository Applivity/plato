/**
 * Background shells (D49m).
 *
 * `shell` blocks for up to 120 s and then dies, so a dev server, a build or a
 * watch mode was unusable: the tool either returned nothing useful or timed out.
 * A background shell is started detached, and read by polling.
 *
 * Detached is deliberate — `npm run dev` spawns its own children, and killing
 * only the shell leaves the real process holding the port. On POSIX every
 * signal here goes to the process GROUP, which is what `detached` creates. On
 * Windows (M0, D49cf) the group is not a signal target, so the tree is stopped
 * with `taskkill /T /F` instead; the intent — the children die too — is the
 * same, and the platform branch lives in `shellPlatform.ts`.
 */
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isWindows, shellInvocation, taskkillArgs } from './shellPlatform.js';

/** Output held per shell before the oldest is dropped. */
const MAX_PENDING = 64_000;
/** Longest a single read may wait. */
const MAX_WAIT_MS = 30_000;
/** Grace between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2_000;

export interface ShellStatus {
  id: string;
  command: string;
  pid: number | null;
  running: boolean;
  exitCode: number | null;
}

export type ShellLifecycle = (
  phase: 'started' | 'exited',
  status: ShellStatus,
) => void;

interface Managed extends ShellStatus {
  child: ChildProcess;
  /** Output produced but not yet read. */
  pending: string;
  /** Characters dropped by the cap, so a read can admit the loss. */
  dropped: number;
  /** Resolvers waiting for more output or for exit. */
  waiters: (() => void)[];
}

function statusOf(m: Managed): ShellStatus {
  return {
    id: m.id,
    command: m.command,
    pid: m.pid,
    running: m.running,
    exitCode: m.exitCode,
  };
}

/** The label a read uses, e.g. `shell 1 (running)` or `shell 1 (exited 0)`. */
function label(m: Managed): string {
  return m.running
    ? `shell ${m.id} (running)`
    : `shell ${m.id} (exited ${m.exitCode ?? 'by signal'})`;
}

export class ShellManager {
  private seq = 0;
  private readonly shells = new Map<string, Managed>();

  constructor(
    private readonly onLifecycle?: ShellLifecycle,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  start(root: string, command: string): ShellStatus {
    const id = String(++this.seq);
    const windows = isWindows(this.platform);
    const invocation = shellInvocation(command, { platform: this.platform });
    const child = spawn(invocation.file, invocation.args, {
      cwd: root,
      // POSIX needs the new group for the negative-PID kill. Windows has no
      // such kill, and `detached` there would only open a second console.
      detached: !windows,
      ...(windows
        ? {
            windowsHide: true,
            ...(invocation.windowsVerbatimArguments === true
              ? { windowsVerbatimArguments: true }
              : {}),
          }
        : {}),
      // stdin closed: an interactive prompt would otherwise hang the process
      // forever with no way for anyone to answer it.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const managed: Managed = {
      id,
      command,
      pid: child.pid ?? null,
      running: true,
      exitCode: null,
      child,
      pending: '',
      dropped: 0,
      waiters: [],
    };

    const append = (text: string): void => {
      managed.pending += text;
      if (managed.pending.length > MAX_PENDING) {
        managed.dropped += managed.pending.length - MAX_PENDING;
        managed.pending = managed.pending.slice(-MAX_PENDING);
      }
      managed.waiters.splice(0).forEach((w) => w());
    };

    child.stdout?.on('data', (c: Buffer) => append(c.toString()));
    child.stderr?.on('data', (c: Buffer) => append(`[stderr] ${c.toString()}`));
    child.on('error', (e) => {
      // A spawn failure (no shell, bad cwd) must reach the reader rather
      // than leaving a shell that never runs and never exits.
      append(`[error] ${e.message}\n`);
      managed.running = false;
      managed.exitCode = null;
      managed.waiters.splice(0).forEach((w) => w());
      this.onLifecycle?.('exited', statusOf(managed));
    });
    child.on('close', (code) => {
      managed.running = false;
      managed.exitCode = code;
      managed.waiters.splice(0).forEach((w) => w());
      this.onLifecycle?.('exited', statusOf(managed));
    });

    this.shells.set(id, managed);
    this.onLifecycle?.('started', statusOf(managed));
    return statusOf(managed);
  }

  get(id: string): ShellStatus | null {
    const m = this.shells.get(id);
    return m ? statusOf(m) : null;
  }

  list(): ShellStatus[] {
    return [...this.shells.values()].map(statusOf);
  }

  /**
   * Reads output produced SINCE THE LAST READ and clears it, so polling a noisy
   * process does not resend everything each time. Optionally waits for new
   * output or for exit — one waiting call is far cheaper than a poll loop.
   */
  async read(
    id: string,
    waitMs = 0,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; output: string }> {
    const m = this.shells.get(id);
    if (!m) return { ok: false, output: `no background shell ${id}` };

    const bounded = Math.min(MAX_WAIT_MS, Math.max(0, waitMs));
    if (bounded > 0 && m.pending.length === 0 && m.running) {
      await this.waitFor(m, bounded, signal);
    }

    const body = this.drain(m);
    const status = label(m);
    return { ok: true, output: body.length > 0 ? `${status}\n${body}` : status };
  }

  /** True when this manager knows about at least one still-running shell. */
  hasRunning(): boolean {
    return [...this.shells.values()].some((m) => m.running);
  }

  async kill(id: string): Promise<{ ok: boolean; output: string }> {
    const m = this.shells.get(id);
    if (!m) return { ok: false, output: `no background shell ${id}` };
    if (!m.running) {
      return { ok: true, output: `${label(m)} — already finished` };
    }
    const windows = isWindows(this.platform);
    if (windows) {
      // `taskkill /F` is already the forced stop; there is nothing to try first.
      this.killTree(m);
      await this.waitFor(m, KILL_GRACE_MS);
    } else {
      this.signal(m, 'SIGTERM');
      if (await this.waitFor(m, KILL_GRACE_MS) === false) {
        this.signal(m, 'SIGKILL');
        await this.waitFor(m, KILL_GRACE_MS);
      }
    }
    const tail = this.drain(m);
    const verdict = m.running
      ? `${label(m)} — still running after ${windows ? 'taskkill' : 'SIGKILL'}`
      : `${label(m)} — killed`;
    return { ok: true, output: tail.length > 0 ? `${verdict}\n${tail}` : verdict };
  }

  /**
   * Stops every running shell. Called when the run ends.
   *
   * Left running, these are invisible and unstoppable: there is no UI that
   * lists them, and the user would have to hunt the process list for something
   * still holding a port. A shell therefore does not outlive its run. SIGKILL
   * directly — at run end there is nobody left to handle a graceful shutdown.
   *
   * Awaits the exits rather than firing and returning: "stopped" is a claim
   * about the machine, and returning while the process is still alive would
   * make it a false one.
   */
  async killAll(): Promise<number> {
    const running = [...this.shells.values()].filter((m) => m.running);
    if (isWindows(this.platform)) {
      for (const m of running) this.killTree(m);
    } else {
      for (const m of running) this.signal(m, 'SIGKILL');
    }
    await Promise.all(running.map((m) => this.waitFor(m, KILL_GRACE_MS)));
    return running.length;
  }

  private drain(m: Managed): string {
    let out = m.pending;
    m.pending = '';
    if (m.dropped > 0) {
      out = `[${m.dropped} earlier characters dropped]\n${out}`;
      m.dropped = 0;
    }
    return out;
  }

  private waitFor(
    m: Managed,
    ms: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!m.running) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (exited: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const i = m.waiters.indexOf(wake);
        if (i >= 0) m.waiters.splice(i, 1);
        resolve(exited);
      };
      const wake = (): void => finish(!m.running);
      const onAbort = (): void => finish(false);
      const timer = setTimeout(() => finish(false), ms);
      m.waiters.push(wake);
      // D49i: a cancel must not wait out the timeout. 30 s of a dead run is
      // exactly the "hung" feeling cancellation exists to remove.
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Stops a process and every child it started. Windows has no signals. */
  private killTree(m: Managed): void {
    if (m.pid === null) return;
    execFile('taskkill', taskkillArgs(m.pid), { windowsHide: true }, () => {
      // A tree that is already gone is the outcome we wanted.
    });
  }

  private signal(m: Managed, sig: NodeJS.Signals): void {
    // Negative pid = the process group, which is the point of `detached`.
    if (m.pid !== null) {
      try {
        process.kill(-m.pid, sig);
        return;
      } catch {
        // Fall through: the group may be gone while the shell remains.
      }
    }
    try {
      m.child.kill(sig);
    } catch {
      // Already dead; the 'close' handler has run or will.
    }
  }
}
