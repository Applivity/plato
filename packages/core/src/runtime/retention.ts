/**
 * D49ay: old run transcripts are COMPRESSED, never deleted.
 *
 * The founder's rule (2026-09-28): compress conversations older than 15 days, and
 * let the user delete any single run, or all of them, by hand.
 *
 * **Why compression and not a retention window**, which is what the sibling undo
 * store will get: the two stores hold different KINDS of data. An undo copy is
 * DERIVED — it duplicates a file that still exists — so dropping one costs
 * convenience and nothing else. A transcript is PRIMARY: nothing else holds it,
 * so dropping one destroys the only record of what Plato did. That difference is
 * the whole reason the two do not share a policy.
 *
 * **And the growth rate is not the problem it was assumed to be.** Measured
 * before deciding anything (2026-09-27): 285 runs occupy 1.4 MB, a mean of 5 KB
 * with a largest of 116 KB, after weeks of work including every harness run. At
 * that mean, 50 runs a day for a year is 89 MB raw and **6.4 MB gzipped** — the
 * compression ratio measured on a real transcript is 9.2x. So trading a record
 * away to save single-digit megabytes would be a bad trade, and the earlier note
 * that called this "the same class of leak, already shipping" was wrong.
 *
 * **Two rules this code exists to enforce.**
 *
 * 1. **Verify before removing the only copy.** The gzip is written, read back,
 *    decompressed and compared byte-for-byte; the original is unlinked only
 *    after that comparison passes, and a mismatch removes the bad copy and
 *    leaves the original alone. There is no path in this file that deletes a
 *    transcript without a proven readable replacement.
 * 2. **Never throw.** This runs when the panel opens and when a run ends. A
 *    sweep that could fail a run, or stop the panel opening, would be a worse
 *    bug than the disk usage it prevents. A file that cannot be compressed is
 *    left exactly as it was and reported.
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/** Days a transcript stays uncompressed. The founder's number, 2026-09-28. */
export const RUN_COMPRESS_AFTER_DAYS = 15;

const PLAIN = /^[A-Za-z0-9._-]+\.jsonl$/;
const COMPRESSED = /^[A-Za-z0-9._-]+\.jsonl\.gz$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A run file name, plain or compressed.
 *
 * The `..` check is not redundant with the character class: `..jsonl` satisfies
 * it. This name is fed to the delete path, so it is the one input here that must
 * never be able to point outside the runs directory. A `/` or `\` cannot appear,
 * and no `..` sequence can.
 */
export function isRunFileName(name: string): boolean {
  return (PLAIN.test(name) || COMPRESSED.test(name)) && !name.includes('..');
}

export function isCompressedRun(name: string): boolean {
  return COMPRESSED.test(name);
}

/**
 * Every run in the directory, newest first, plain and compressed together. The
 * name sorts by its leading ISO timestamp, so one list order serves both.
 */
export function runFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter(isRunFileName).sort().reverse();
  } catch {
    return [];
  }
}

/**
 * One run's text, transparently decompressed. Throws on a name that is not a run
 * file: the caller validates first, so a throw here is a bug in the caller
 * rather than anything a user can cause.
 */
export function readRunText(dir: string, name: string): string {
  if (!isRunFileName(name)) {
    throw new Error(`not a run file: ${name}`);
  }
  const buf = readFileSync(join(dir, name));
  return (isCompressedRun(name) ? gunzipSync(buf) : buf).toString('utf8');
}

export interface SweepReport {
  /** Names compressed by this pass, in the order they were handled. */
  compressed: string[];
  /** Names left untouched because compressing them failed. */
  failed: string[];
}

/**
 * Compress every transcript older than `days`.
 *
 * Idempotent by construction: only PLAIN names are considered, so a `.gz` is
 * never re-compressed, and a run inside the window is never touched. `now` is a
 * parameter so the age rule is testable without waiting fifteen days.
 */
export function sweepRuns(
  dir: string,
  now: Date = new Date(),
  days: number = RUN_COMPRESS_AFTER_DAYS,
): SweepReport {
  const report: SweepReport = { compressed: [], failed: [] };
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return report; // No runs directory yet. Normal, and not an error.
  }
  for (const name of names) {
    // PLAIN and not `isRunFileName`: a `.gz` is already compressed, and
    // re-compressing one would produce `.jsonl.gz.gz`.
    if (!PLAIN.test(name) || name.includes('..')) continue;
    if (!olderThan(dir, name, now, days)) continue;
    try {
      compressOne(dir, name);
      report.compressed.push(name);
    } catch {
      report.failed.push(name);
    }
  }
  return report;
}

/** Compress one transcript, proving the copy before destroying the original. */
function compressOne(dir: string, name: string): void {
  const src = join(dir, name);
  const dest = `${src}.gz`;
  const raw = readFileSync(src);
  writeFileSync(dest, gzipSync(raw));
  // A gzip that cannot be read back, or that reads back as different bytes, is
  // not a copy — so it is discarded and the original is left where it is.
  const back = gunzipSync(readFileSync(dest));
  if (!back.equals(raw)) {
    unlinkSync(dest);
    throw new Error(`gzip round-trip mismatch for ${name}`);
  }
  unlinkSync(src);
}

/**
 * Age from the file name, which the writer builds from `new Date().toISOString()`
 * — so the leading date is UTC — falling back to mtime for a name the writer did
 * not produce. Day granularity is all a 15-day rule needs, and it makes the
 * answer independent of the hour a run happened to start.
 */
function olderThan(dir: string, name: string, now: Date, days: number): boolean {
  const stamp = startedAtUtc(name) ?? mtimeOf(join(dir, name));
  if (stamp === null) return false;
  return now.getTime() - stamp.getTime() >= days * DAY_MS;
}

function startedAtUtc(name: string): Date | null {
  const day = name.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

function mtimeOf(abs: string): Date | null {
  try {
    return statSync(abs).mtime;
  } catch {
    return null;
  }
}
