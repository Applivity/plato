import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBus } from '../src/runtime/bus.js';
import type { AgentEvent } from '../src/runtime/bus.js';
import { TranscriptWriter } from '../src/runtime/transcript.js';

describe('TranscriptWriter', () => {
  it('writes a header then whitelisted JSONL event lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-t-'));
    const runsDir = join(dir, '.plato', 'runs');
    const bus = new AgentBus();
    const writer = new TranscriptWriter(runsDir, { task: 'fix bugs', root: dir });
    writer.attach(bus);

    bus.emit({
      type: 'run-started',
      runId: 'abc123',
      task: 'fix bugs',
      model: 'claude-sonnet-4-5',
      mode: 'edit',
    });
    // D49ca: a user mode switch is a structured event, so a record can say the
    // mode changed and between which two modes — the header alone cannot.
    bus.emit({
      type: 'mode-changed',
      runId: 'abc123',
      from: 'plan',
      to: 'edit',
      at: '2026-10-21T12:00:00.000Z',
      via: 'request',
    });
    // D49cb: a declined request has no mode-changed event, so it needs its own
    // line — and the model's reason must not reach the file.
    bus.emit({
      type: 'mode-requested',
      runId: 'abc123',
      from: 'plan',
      to: 'auto',
      approved: false,
    });
    bus.emit({ type: 'text', runId: 'abc123', text: 'hello' });
    bus.emit({
      type: 'tool-event',
      runId: 'abc123',
      tool: 'read_file',
      phase: 'done',
      ok: true,
      args: { path: 'SECRETARGS.env' },
    });
    bus.emit({
      type: 'tool-event',
      runId: 'abc123',
      tool: 'shell',
      phase: 'refused',
      ok: false,
      reason: 'secret',
      // D49as: a refusal now carries args so the LIVE log can name the guard.
      // The file must keep stripping them — a guard that leaks the command it
      // refused would be worse than the one that said nothing.
      args: { command: 'cat REFUSEDARGS.keystore' },
    });
    bus.emit({
      type: 'approval-requested',
      runId: 'abc123',
      tool: 'apply_diff',
      preview: 'PREVIEWLEAK',
    });
    bus.emit({ type: 'approval-decided', runId: 'abc123', tool: 'apply_diff', allowed: true });
    bus.emit({
      type: 'usage',
      runId: 'abc123',
      turn: 1,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    bus.emit({
      type: 'run-completed',
      runId: 'abc123',
      reason: 'complete',
      turns: 1,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    writer.close();

    const name = readdirSync(runsDir).find((f) => f.endsWith('.jsonl'));
    expect(name).toBeDefined();
    const lines = readFileSync(join(runsDir, name!), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines).toHaveLength(11);
    expect(lines[0]).toMatchObject({
      kind: 'header',
      schemaVersion: 1,
      runId: 'abc123',
      task: 'fix bugs',
      // D49bj: the header names the mode the run began in, so a record can say
      // what its writes were gated by. Still schemaVersion 1 — the field is
      // added, not redefined, and nothing branches on the number.
      mode: 'edit',
    });
    expect(lines[2]).toMatchObject({
      type: 'mode-changed',
      runId: 'abc123',
      from: 'plan',
      to: 'edit',
      at: '2026-10-21T12:00:00.000Z',
      via: 'request',
    });
    expect(lines[3]).toMatchObject({
      type: 'mode-requested',
      from: 'plan',
      to: 'auto',
      approved: false,
    });
    // Secret-safety (D24c): args and previews never reach disk.
    const raw = readFileSync(join(runsDir, name!), 'utf8');
    expect(raw).not.toContain('SECRETARGS');
    expect(raw).not.toContain('PREVIEWLEAK');
    // The refusal's arguments are stripped with everyone else's.
    expect(raw).not.toContain('REFUSEDARGS');
    // ...but its reason survives, because that is the part worth reading back.
    expect(raw).toContain('"reason":"secret"');
    // But ordinary payloads do.
    expect(raw).toContain('hello');

    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores events that arrive before a run-started anchor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-t2-'));
    const bus = new AgentBus();
    const writer = new TranscriptWriter(join(dir, 'runs'), {
      task: 't',
      root: dir,
    });
    writer.attach(bus);
    expect(() =>
      bus.emit({ type: 'text', runId: 'x', text: 'orphan' }),
    ).not.toThrow();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('close detaches: no writes after close', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-t3-'));
    const runsDir = join(dir, 'runs');
    const bus = new AgentBus();
    const writer = new TranscriptWriter(runsDir, { task: 't', root: dir });
    writer.attach(bus);
    writer.close();
    const before = safeList(runsDir);
    bus.emit({
      type: 'run-started',
      runId: 'late',
      task: 't',
      model: 'm',
      mode: 'edit',
    } satisfies AgentEvent);
    expect(safeList(runsDir)).toEqual(before);
    rmSync(dir, { recursive: true, force: true });
  });
});

function safeList(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
