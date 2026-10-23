import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellManager } from '../src/tools/background.js';
import { isWindows } from '../src/tools/shellPlatform.js';
import { LONG_RUNNING, nodeCommand, print, warn } from './portable.js';

/**
 * D49m. `shell` blocks for 120s and then dies, so anything long-running was
 * unusable. These exercise the manager directly; the tool surface and the
 * run-end teardown are covered in execute.test.ts and loop.test.ts.
 */
function root(): string {
  return mkdtempSync(join(tmpdir(), 'plato-bg-'));
}

/** Drains until the shell stops running, or the budget runs out. */
async function drain(m: ShellManager, id: string): Promise<string> {
  let out = '';
  for (let i = 0; i < 60; i++) {
    const r = await m.read(id, 300);
    out += r.output;
    if (m.get(id)?.running === false) break;
  }
  return out;
}

describe('ShellManager (D49m)', () => {
  it('starts a shell that outlives the call', async () => {
    const m = new ShellManager();
    const s = m.start(root(), LONG_RUNNING);
    expect(s.running).toBe(true);
    expect(s.pid).toBeGreaterThan(0);
    // The start call returned while the command is still going — the whole
    // point, since `shell` would have blocked here.
    const status = m.get(s.id);
    expect(status?.running).toBe(true);
    expect(await m.kill(s.id)).toMatchObject({ ok: true });
  });

  it('reports that it exited, with the code and the output', async () => {
    const m = new ShellManager();
    const s = m.start(root(), print('finished'));
    const out = await drain(m, s.id);
    expect(out).toContain('finished');
    expect(out).toContain('exited 0');
    expect(m.get(s.id)?.exitCode).toBe(0);
    expect(m.get(s.id)?.running).toBe(false);
  });

  it('reports a non-zero exit code', async () => {
    const m = new ShellManager();
    const s = m.start(root(), nodeCommand('process.exit(3)'));
    await drain(m, s.id);
    expect(m.get(s.id)?.exitCode).toBe(3);
  });

  it('captures stderr, labelled', async () => {
    const m = new ShellManager();
    const s = m.start(root(), warn('problem'));
    const out = await drain(m, s.id);
    expect(out).toContain('[stderr] problem');
  });

  // Polling must not resend the whole history every time, or a chatty process
  // would blow up the context a little more with each call.
  it('returns only what is new since the last read', async () => {
    const m = new ShellManager();
    const s = m.start(
      root(),
      nodeCommand("console.log('one');setTimeout(()=>console.log('two'),400)"),
    );
    const first = await m.read(s.id, 200);
    expect(first.output).toContain('one');
    const second = await drain(m, s.id);
    expect(second).toContain('two');
    expect(second).not.toContain('one');
  });

  it('waits for output instead of returning empty', async () => {
    const m = new ShellManager();
    const s = m.start(root(), nodeCommand("setTimeout(()=>console.log('late'),300)"));
    const r = await m.read(s.id, 5_000);
    expect(r.output).toContain('late');
  });

  it('returns as soon as the shell exits, without waiting out the timeout', async () => {
    const m = new ShellManager();
    const s = m.start(root(), nodeCommand('process.exit(0)'));
    const t0 = Date.now();
    await m.read(s.id, 20_000);
    // If this waited the full 20s the test would take 20s; the exit must win.
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  /**
   * D49i applied to a wait: a cancel must not sit out a 30s timeout. That
   * hangs the run for exactly as long as the user was trying to avoid.
   */
  it('stops waiting when the run is cancelled', async () => {
    const m = new ShellManager();
    const s = m.start(root(), LONG_RUNNING);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const t0 = Date.now();
    const r = await m.read(s.id, 20_000, ctrl.signal);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.ok).toBe(true); // aborted wait is not an error: it still reports
    expect(r.output).toContain('running');
    await m.kill(s.id);
  });

  it('kills a running shell', async () => {
    const m = new ShellManager();
    const s = m.start(root(), LONG_RUNNING);
    const r = await m.kill(s.id);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('killed');
    expect(m.get(s.id)?.running).toBe(false);
  });

  // `npm run dev` spawns children; killing only the shell leaves the real
  // process holding the port. The group signal is what makes kill mean kill.
  // POSIX only, by construction: `&`, `$!` and a process group are bash's.
  // Windows kills the tree with `taskkill /T /F`; that path is proven by the
  // unit tests in shellPlatform.test.ts and on the Windows machine (M0).
  it.skipIf(isWindows())('kills the whole process group, not just the shell', async () => {
    const m = new ShellManager();
    const dir = root();
    // A grandchild that would outlive the shell if only the shell were killed.
    const s = m.start(dir, 'sleep 20 & echo $! > child.pid; sleep 20');
    await new Promise((r) => setTimeout(r, 300));
    const { readFileSync } = await import('node:fs');
    const grandchild = Number(readFileSync(join(dir, 'child.pid'), 'utf8').trim());
    await m.kill(s.id);
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try {
      process.kill(grandchild, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(grandchild, 'SIGKILL'); // never leak a stray process
    expect(alive).toBe(false);
  });

  it('refuses an unknown id, and says an exited shell already finished', async () => {
    const m = new ShellManager();
    expect(await m.read('99', 0)).toMatchObject({ ok: false });
    expect((await m.read('99', 0)).output).toContain('no background shell 99');
    expect(await m.kill('99')).toMatchObject({ ok: false });
    const s = m.start(root(), nodeCommand('process.exit(0)'));
    await drain(m, s.id);
    expect((await m.kill(s.id)).output).toContain('already finished');
  });

  it('lists shells and stops every running one', async () => {
    const m = new ShellManager();
    const a = m.start(root(), LONG_RUNNING);
    const b = m.start(root(), LONG_RUNNING);
    const c = m.start(root(), nodeCommand('process.exit(0)'));
    await drain(m, c.id);
    expect(m.list()).toHaveLength(3);
    expect(m.hasRunning()).toBe(true);
    expect(await m.killAll()).toBe(2); // c already finished
    expect(m.hasRunning()).toBe(false);
    expect(m.get(a.id)?.running).toBe(false);
    expect(m.get(b.id)?.running).toBe(false);
    expect(await m.killAll()).toBe(0);
  });

  it('reports started and exited through the lifecycle hook', async () => {
    const seen: string[] = [];
    const m = new ShellManager((phase, status) => {
      seen.push(`${phase}:${status.id}`);
    });
    const s = m.start(root(), nodeCommand('process.exit(0)'));
    await drain(m, s.id);
    expect(seen).toEqual([`started:${s.id}`, `exited:${s.id}`]);
  });

  // A watch mode or dev server can produce output far faster than the model
  // reads it; the buffer must not grow without bound. The cap is on UNREAD
  // output, so this deliberately does not drain while the flood is running.
  it('caps a flood of output and admits what it dropped', async () => {
    const m = new ShellManager();
    const s = m.start(root(), nodeCommand("process.stdout.write('x'.repeat(70000))"));
    for (let i = 0; i < 100 && m.get(s.id)?.running; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(m.get(s.id)?.running).toBe(false);
    const out = (await m.read(s.id, 0)).output;
    expect(out).toContain('earlier characters dropped');
    expect(out.length).toBeLessThan(70_000);
  });

  it('surfaces a spawn failure instead of hanging', async () => {
    const m = new ShellManager();
    // A cwd that does not exist makes spawn fail asynchronously.
    const s = m.start(join(tmpdir(), 'plato-does-not-exist-xyz'), 'echo hi');
    const out = await drain(m, s.id);
    expect(out).toMatch(/\[error\]/);
    expect(m.get(s.id)?.running).toBe(false);
  });
});
