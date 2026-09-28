import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  RUN_COMPRESS_AFTER_DAYS,
  isRunFileName,
  readRunText,
  runFilesIn,
  sweepRuns,
} from '../src/runtime/retention.js';

/**
 * D49ay. Old transcripts are compressed, never deleted — and the safety property
 * this file exists to pin is that **the original is never removed without a
 * proven readable replacement**. A sweep that loses a transcript to save a few
 * kilobytes would be far worse than the disk usage it prevents: unlike an undo
 * copy, a transcript is the only record of what Plato did.
 *
 * `now` is always passed explicitly, so the age rule is exercised without
 * waiting fifteen days and without depending on the machine's clock.
 */
const NOW = new Date('2026-09-28T12:00:00Z');

/** A name in the shape `TranscriptWriter` produces: ISO stamp, then the run id. */
const runName = (day: string, id: string) => `${day}T10-00-00-000Z-${id}.jsonl`;

/** A payload with the shape of a real transcript, so gzip has something to win on. */
function transcript(runId: string, events = 40): string {
  const lines = [
    JSON.stringify({
      kind: 'header',
      schemaVersion: 1,
      runId,
      startedAt: NOW.toISOString(),
      task: 'add a null check to the submission view model',
      root: '/tmp/demo',
    }),
  ];
  for (let i = 0; i < events; i += 1) {
    lines.push(JSON.stringify({ type: 'tool-event', runId, tool: 'read_file', phase: 'done', ok: true, durationMs: 12 }));
  }
  return `${lines.join('\n')}\n`;
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'plato-ret-'));
}

describe('sweepRuns', () => {
  it('compresses a run older than the window, and keeps every byte', () => {
    const dir = scratch();
    const name = runName('2026-09-01', 'old');
    const text = transcript('old');
    writeFileSync(join(dir, name), text);

    const report = sweepRuns(dir, NOW);

    expect(report.compressed).toEqual([name]);
    expect(report.failed).toEqual([]);
    expect(existsSync(join(dir, name))).toBe(false);
    expect(existsSync(join(dir, `${name}.gz`))).toBe(true);
    // Not merely readable — identical, which is the promise compression makes.
    expect(gunzipSync(readFileSync(join(dir, `${name}.gz`))).toString('utf8')).toBe(text);
    rmSync(dir, { recursive: true, force: true });
  });

  it('compression actually saves space on a real-shaped transcript', () => {
    const dir = scratch();
    const name = runName('2026-09-01', 'big');
    const text = transcript('big', 200);
    writeFileSync(join(dir, name), text);

    sweepRuns(dir, NOW);

    // The whole reason for the feature. A payload whose keys repeat — which is
    // what JSONL of bus events is — is what gzip is for.
    expect(statSync(join(dir, `${name}.gz`)).size).toBeLessThan(Buffer.byteLength(text));
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves a run inside the window alone', () => {
    const dir = scratch();
    const name = runName('2026-09-14', 'fresh'); // 14 days
    writeFileSync(join(dir, name), transcript('fresh'));

    const report = sweepRuns(dir, NOW);

    expect(report.compressed).toEqual([]);
    expect(readdirSync(dir)).toEqual([name]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('compresses exactly at the boundary and not a day before', () => {
    const dir = scratch();
    const at = runName('2026-09-13', 'at'); // 15 days — compresses
    const before = runName('2026-09-14', 'before'); // 14 days — does not
    writeFileSync(join(dir, at), transcript('at'));
    writeFileSync(join(dir, before), transcript('before'));

    sweepRuns(dir, NOW);

    expect(existsSync(join(dir, `${at}.gz`))).toBe(true);
    expect(existsSync(join(dir, before))).toBe(true);
    expect(existsSync(join(dir, `${before}.gz`))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent: a second pass compresses nothing and makes no .gz.gz', () => {
    const dir = scratch();
    const name = runName('2026-09-01', 'twice');
    writeFileSync(join(dir, name), transcript('twice'));

    sweepRuns(dir, NOW);
    const second = sweepRuns(dir, NOW);

    expect(second.compressed).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([`${name}.gz`]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('LEAVES THE ORIGINAL when it cannot write the copy', () => {
    // A directory where the .gz must go makes the write fail after the read.
    // This is the property the whole file is for: no path here loses a run.
    const dir = scratch();
    const name = runName('2026-09-01', 'blocked');
    const text = transcript('blocked');
    writeFileSync(join(dir, name), text);
    mkdirSync(join(dir, `${name}.gz`));

    const report = sweepRuns(dir, NOW);

    expect(report.failed).toEqual([name]);
    expect(report.compressed).toEqual([]);
    expect(readFileSync(join(dir, name), 'utf8')).toBe(text);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does nothing, and does not throw, when there is no runs directory yet', () => {
    const dir = join(scratch(), 'nope');
    expect(() => sweepRuns(dir, NOW)).not.toThrow();
    expect(sweepRuns(dir, NOW)).toEqual({ compressed: [], failed: [] });
  });

  it('never re-compresses an already-compressed run', () => {
    const dir = scratch();
    const name = runName('2026-09-01', 'gz');
    writeFileSync(join(dir, `${name}.gz`), 'not really gzip');

    const report = sweepRuns(dir, NOW);

    expect(report.compressed).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(readdirSync(dir)).toEqual([`${name}.gz`]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('the window is the founder’s 15 days', () => {
    // Named so a silent change to the constant has to be deliberate.
    expect(RUN_COMPRESS_AFTER_DAYS).toBe(15);
  });
});

describe('reading runs back', () => {
  it('returns identical text from a plain run and a compressed one', () => {
    const dir = scratch();
    const name = runName('2026-09-01', 'read');
    const text = transcript('read');
    writeFileSync(join(dir, name), text);
    expect(readRunText(dir, name)).toBe(text);

    sweepRuns(dir, NOW);

    expect(readRunText(dir, `${name}.gz`)).toBe(text);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists plain and compressed runs together, newest first', () => {
    const dir = scratch();
    for (const [day, id] of [
      ['2026-09-01', 'a'],
      ['2026-09-10', 'b'],
      ['2026-09-28', 'c'],
    ] as const) {
      writeFileSync(join(dir, runName(day, id)), transcript(id));
    }
    sweepRuns(dir, NOW); // a (27d) and b (18d) compress; c is today

    expect(runFilesIn(dir)).toEqual([
      runName('2026-09-28', 'c'),
      `${runName('2026-09-10', 'b')}.gz`,
      `${runName('2026-09-01', 'a')}.gz`,
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a name that is not a run file', () => {
    expect(() => readRunText('/tmp', 'notes.txt')).toThrow();
  });

  it('lists nothing for a directory that does not exist', () => {
    expect(runFilesIn(join(scratch(), 'absent'))).toEqual([]);
  });
});

describe('isRunFileName', () => {
  it('accepts plain and compressed run names', () => {
    expect(isRunFileName('2026-09-01T10-00-00-000Z-abc.jsonl')).toBe(true);
    expect(isRunFileName('2026-09-01T10-00-00-000Z-abc.jsonl.gz')).toBe(true);
  });

  it('REJECTS every name that could leave the runs directory', () => {
    // This name reaches an unlink. It is the one input here that must never
    // point outside the directory it was listed from.
    for (const bad of [
      '../secrets.jsonl',
      'a/b.jsonl',
      'a\\b.jsonl',
      '..jsonl',
      '../../x.jsonl.gz',
      'notes.txt',
      'run.jsonl.bak',
      '',
    ]) {
      expect(isRunFileName(bad), bad).toBe(false);
    }
  });
});
