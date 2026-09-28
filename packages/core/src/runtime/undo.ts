/**
 * D49ax: undo is Plato's own copies of what it replaced.
 *
 * The founder's rule (2026-09-27): Plato keeps the files it replaced, and there is
 * no parallel history. He was right that a git-like snapshot system would be more
 * harmful than good, and the survey says why: every reported failure of a
 * competitor's undo has the SAME shape — the snapshot was bigger than the change.
 * Cline deleted untracked files outright; Roo Code leaked commits into the wrong
 * repository; Kilo Code removed the user's own work along with the agent's. A
 * design that snapshots a whole workspace to protect one file makes every bug a
 * whole-workspace bug.
 *
 * So this store holds two things per file and nothing else:
 *
 *   - the bytes that were there BEFORE the write (or before a delete),
 *   - a sha1 of what Plato left behind afterwards.
 *
 * **Never the new bytes.** That is not a storage optimisation — it is what keeps
 * the store from becoming a second source of truth about what a file currently
 * is. It is a record of what was replaced. A parallel history that can disagree
 * with the repository is the disease.
 *
 * **The hash is the safety feature, not bookkeeping.** "Has this file changed
 * since Plato wrote it?" cannot be answered without knowing what Plato wrote, and
 * storing that would recreate the second copy. A hash answers the question and
 * cannot reconstruct anything. It is checked before a restore, so a file the user
 * has edited since is REFUSED rather than overwritten — Kilo Code's reported bug,
 * closed by construction.
 *
 * **Redo costs nothing.** A restore is itself a write with a before, so it enters
 * this same store under its own request id and the undo-of-an-undo falls out of
 * the mechanism instead of being built.
 *
 * Layout, under `~/.plato/undo/<project-key>/` — beside the run records, one
 * folder the user can inspect and delete by hand:
 *
 *     index.json                every request, with its size and timestamp
 *     <request-id>/<seq>.bin    the copies, named by a number
 *
 * **No user path ever becomes a file name.** The copies are numbered and the
 * index maps the number to the workspace-relative path. That is what makes the
 * delete paths in this file easy to prove safe: the only names that reach a
 * filesystem call come from `readdirSync` or from a validated request id.
 *
 * **The two doors out of this store, and what closes each.**
 *
 * | Leak | Closed by |
 * |---|---|
 * | a project over its cap | evicting WHOLE requests, oldest first |
 * | requests past 30 days | the same sweep, by timestamp |
 * | a project the user deleted | `sweepDeadProjects`, at activation |
 * | orphans from a crash mid-write | `reconcile`, which needs a VALID index |
 *
 * The last rule is load-bearing: reconcile deletes what the index does not name,
 * so an unreadable index would name nothing and take the whole store with it. A
 * corrupt or missing index therefore keeps everything and changes nothing.
 *
 * **What this store cannot do, said here because the UI must say it too:**
 * terminal commands are outside undo. In `auto` a shell command runs without
 * asking, and Plato has no record of which files a command touches.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { resolveInRoot } from '../security/paths.js';

/** Above this, a file is build output and can be rebuilt — so no copy is kept. */
export const UNDO_MAX_FILE_BYTES = 1024 * 1024;

/** Starting point to be measured against real runs, not a finding (D49ax). */
export const UNDO_MAX_BYTES = 200 * 1024 * 1024;

export const UNDO_MAX_AGE_DAYS = 30;

/**
 * The most recent requests are never evicted, however large they are. Without
 * this, one heavy request could evict the history someone is about to use.
 */
export const UNDO_KEEP_REQUESTS = 10;

const INDEX = 'index.json';
const TMP = 'index.json.tmp';
const DAY_MS = 24 * 60 * 60 * 1000;
const BIN = /^\d+\.bin$/;

/**
 * A request id or a store directory name. Both are built by this code, but they
 * are also the inputs to `join` on the delete paths, so they are validated rather
 * than trusted. `..` is not implied by the character class: `..x` satisfies it.
 */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..');
}

export function sha1Hex(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

/**
 * One write, as the executor saw it.
 *
 * `before` is the text that was on disk, or null when Plato created the file —
 * and that difference is the whole reason a created file is undone by deleting
 * it, not by writing something back.
 *
 * `after` is here only to be hashed. It is never stored.
 */
export type WriteCapture =
  | { rel: string; kind: 'write'; before: string | null; after: string }
  | { rel: string; kind: 'delete'; before: string };

export interface UndoFile {
  /** Workspace-relative, POSIX separators — the form the rest of Plato uses. */
  rel: string;
  kind: 'write' | 'delete';
  /**
   * For a write, whether the file was already there. For a delete, always true.
   * Undo writes the copy back when this is true and removes the file when it is
   * false.
   */
  existed: boolean;
  /** False when the file was over the per-file cap: no bytes were kept. */
  copied: boolean;
  /** The copy's slot under the request directory, or null when not copied. */
  seq: number | null;
  /**
   * The size of the content that was replaced — kept even when no copy was
   * made, because that is the number the user is shown for a file that is too
   * big to undo. Only `copied` files count toward the cap.
   */
  bytes: number;
  /** sha1 of the copy, checked before the copy is written back. */
  beforeHash: string;
  /** sha1 of what Plato left behind, or '' for a delete. */
  afterHash: string;
}

export interface UndoRequest {
  id: string;
  startedAtUtc: string;
  /** Total copy bytes, kept so enforcing the cap is arithmetic on one file. */
  bytes: number;
  files: UndoFile[];
}

export interface UndoIndex {
  version: 1;
  /** The workspace this store belongs to — read by the dead-project sweep. */
  root: string;
  requests: UndoRequest[];
}

/** A fresh id for a request this file creates: an undo, or its redo. */
export function undoRequestId(): string {
  return `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record the copies for one write, under `requestId`.
 *
 * Called from the executor, where the before bytes are already in hand for the
 * guard and the approval preview — so this costs one disk write and no extra
 * read, which is why the whole feature is small.
 *
 * **Never throws.** It runs inside the write path, and a store that could fail a
 * write would be a worse bug than the disk usage it prevents. A failure here
 * leaves the request out of the index, so undo reports nothing to undo — which
 * is honest, and is the only cost.
 */
export function recordWrites(
  dir: string,
  workspaceRoot: string,
  requestId: string,
  caps: readonly WriteCapture[],
  now: Date = new Date(),
): void {
  if (caps.length === 0 || !isSafeId(requestId)) return;
  try {
    const index = readIndex(dir) ?? { version: 1, root: workspaceRoot, requests: [] };
    // The root can legitimately change: the same folder opened by a different
    // path is a different project key, but a workspace the user renamed is not,
    // and the freshest answer is the one the window is open on.
    index.root = workspaceRoot;
    let req = index.requests.find((r) => r.id === requestId);
    if (req === undefined) {
      req = { id: requestId, startedAtUtc: now.toISOString(), bytes: 0, files: [] };
      index.requests.push(req);
    }
    const reqDir = join(dir, requestId);
    mkdirSync(reqDir, { recursive: true });

    for (const cap of caps) {
      const rel = resolveInRoot(workspaceRoot, cap.rel);
      if (rel === null) continue; // outside the workspace: not ours to keep
      const before = cap.before === null ? null : Buffer.from(cap.before, 'utf8');
      const record: UndoFile = {
        rel: rel.split(sep).join('/'),
        kind: cap.kind,
        existed: before !== null,
        copied: false,
        seq: null,
        bytes: before === null ? 0 : before.length,
        beforeHash: '',
        afterHash: cap.kind === 'delete' ? '' : sha1Hex(Buffer.from(cap.after, 'utf8')),
      };
      // A copy is skipped only for size, and the skip is recorded rather than
      // silently dropped: the user is told which file could not be restored.
      if (before !== null && before.length <= UNDO_MAX_FILE_BYTES) {
        const seq = req.files.length;
        writeFileSync(join(reqDir, `${seq}.bin`), before);
        record.copied = true;
        record.seq = seq;
        record.beforeHash = sha1Hex(before);
      }
      req.files.push(record);
      // Only copies occupy disk, so only copies count toward the cap.
      req.bytes += record.copied ? record.bytes : 0;
    }

    const evicted = evictToFit(index, now);
    writeIndex(dir, index);
    for (const id of evicted) removeRequest(dir, id);
  } catch {
    /* see the contract above: a store failure never fails a write */
  }
}

export type UndoScope =
  /** The single most recent write. */
  | 'last'
  /** Every file the most recent request touched, back to how it started. */
  | 'request';

export interface UndoTarget {
  rel: string;
  /** 'restore' writes the copy back; 'delete' removes a file Plato created. */
  action: 'restore' | 'delete';
  seq: number | null;
  beforeHash: string;
  size: number;
  /**
   * The file must still be in this state or undo refuses. A hash for a write; for
   * a delete, the file must be absent.
   */
  guard: { kind: 'absent' } | { kind: 'hash'; hash: string };
}

export interface UndoRefusal {
  rel: string;
  /**
   * 'edited' — the user changed the file since Plato did, so putting the old copy
   * back would throw their work away. 'too-big' — no copy was kept. 'damaged' —
   * the copy cannot be read back as what was stored.
   */
  why: 'edited' | 'too-big' | 'damaged';
  size: number;
}

export interface UndoPlan {
  id: string;
  startedAtUtc: string;
  restore: UndoTarget[];
  refuse: UndoRefusal[];
  /** Already back to how they were. Nothing to do, and nothing wrong. */
  alreadyThere: string[];
}

/**
 * What an undo would do, without touching anything.
 *
 * Every check happens here so the caller can show the user the whole picture —
 * what will be put back, what is refused, and why — before a single file changes.
 */
export function planUndo(
  dir: string,
  workspaceRoot: string,
  scope: UndoScope,
): UndoPlan | null {
  const index = readIndex(dir);
  if (index === null || index.requests.length === 0) return null;
  const req = index.requests[index.requests.length - 1];
  if (req === undefined) return null;

  const plan: UndoPlan = {
    id: req.id,
    startedAtUtc: req.startedAtUtc,
    restore: [],
    refuse: [],
    alreadyThere: [],
  };

  for (const target of selectTargets(req, scope)) {
    const rel = resolveInRoot(workspaceRoot, target.rel);
    if (rel === null) {
      plan.refuse.push({ rel: target.rel, why: 'edited', size: target.size });
      continue;
    }
    const abs = join(workspaceRoot, rel);
    const cur = readBytes(abs);

    // The guard comes first: the file must still be in the state this undo
    // expects, or the user has been editing and the undo is refused. That covers
    // a file DELETED since, too — putting the old copy back would resurrect
    // something the user removed on purpose.
    const satisfied =
      target.guard.kind === 'absent'
        ? cur === null
        : cur !== null && sha1Hex(cur) === target.guard.hash;
    const size = cur === null ? target.size : cur.length;
    if (!satisfied) {
      plan.refuse.push({ rel: target.rel, why: 'edited', size });
      continue;
    }
    // Undoing a create removes the file. Already gone is not a failure.
    if (target.action === 'delete') {
      if (cur === null) plan.alreadyThere.push(target.rel);
      else plan.restore.push({ ...target, size });
      continue;
    }
    if (target.seq === null) {
      // The number to show is the size of the file that was too big to copy, not
      // the size it happens to be now.
      plan.refuse.push({ rel: target.rel, why: 'too-big', size: target.size });
      continue;
    }
    const bin = readBytes(join(dir, req.id, `${target.seq}.bin`));
    if (bin === null || sha1Hex(bin) !== target.beforeHash) {
      plan.refuse.push({ rel: target.rel, why: 'damaged', size });
      continue;
    }
    plan.restore.push({ ...target, size: bin.length });
  }
  return plan;
}

export interface UndoApplied {
  rel: string;
  how: 'restored' | 'deleted';
}

export interface UndoResult {
  id: string;
  applied: UndoApplied[];
  failed: { rel: string; why: string }[];
  /** The request the redo was recorded under, when there was anything to redo. */
  redoId: string | null;
}

/**
 * Perform a plan, one file at a time.
 *
 * Deliberately NOT all-or-nothing: a write can fail on a full disk or a file the
 * user has open, and a rollback of a rollback could fail too. So the message
 * reports what was actually put back and what was not, which is the shape every
 * message in this feature already has.
 *
 * Deletes come last. They are the only destructive step, and doing them after the
 * restores means a failure part-way leaves the recoverable work done.
 *
 * Each restore is recorded in this same store, so redo is not a feature that had
 * to be built — it is what the mechanism already does.
 */
export function applyUndo(
  dir: string,
  workspaceRoot: string,
  plan: UndoPlan,
): UndoResult {
  const result: UndoResult = { id: plan.id, applied: [], failed: [], redoId: null };
  const ordered = [
    ...plan.restore.filter((t) => t.action === 'restore'),
    ...plan.restore.filter((t) => t.action === 'delete'),
  ];
  const redo: WriteCapture[] = [];

  for (const t of ordered) {
    const rel = resolveInRoot(workspaceRoot, t.rel);
    if (rel === null) {
      result.failed.push({ rel: t.rel, why: 'Plato cannot reach this file.' });
      continue;
    }
    const abs = join(workspaceRoot, rel);
    // A restore is allowed to find the file absent: bringing back a file that
    // undo removed is exactly that case.
    const cur = readBytes(abs);
    try {
      if (t.action === 'delete') {
        rmSync(abs, { force: true });
        // Recorded only when there were bytes to bring back, so a redo never
        // claims to restore a file it never saw.
        if (cur !== null) {
          redo.push({ rel: t.rel, kind: 'delete', before: cur.toString('utf8') });
        }
        result.applied.push({ rel: t.rel, how: 'deleted' });
        continue;
      }
      const bin =
        t.seq === null ? null : readBytes(join(dir, plan.id, `${t.seq}.bin`));
      if (bin === null || sha1Hex(bin) !== t.beforeHash) {
        result.failed.push({ rel: t.rel, why: 'Plato cannot read the saved copy.' });
        continue;
      }
      writeFileSync(abs, bin);
      redo.push({
        rel: t.rel,
        kind: 'write',
        // Absent before this restore means the redo CREATES the file, which is
        // what undoing a restore has to do.
        before: cur === null ? null : cur.toString('utf8'),
        after: bin.toString('utf8'),
      });
      result.applied.push({ rel: t.rel, how: 'restored' });
    } catch {
      result.failed.push({ rel: t.rel, why: 'Plato could not write to it.' });
    }
  }

  if (redo.length > 0) {
    const redoId = undoRequestId();
    recordWrites(dir, workspaceRoot, redoId, redo);
    result.redoId = redoId;
  }
  return result;
}

export interface UndoSweepReport {
  /** Request ids evicted for age or size. */
  evicted: string[];
  /** Store entries removed because the index did not name them. */
  orphans: string[];
  /** False when the index could not be read, so nothing was deleted. */
  valid: boolean;
}

/**
 * The housekeeping pass for one project's store: age, size, then orphans.
 *
 * Runs at extension activation and at the end of a run — both off the write path.
 * A bad index means this does nothing at all, which is the rule that keeps a
 * corrupt file from taking the store with it.
 */
export function sweepProject(dir: string, now: Date = new Date()): UndoSweepReport {
  const index = readIndex(dir);
  if (index === null) return { evicted: [], orphans: [], valid: false };
  const evicted = evictToFit(index, now);
  writeIndex(dir, index);
  for (const id of evicted) removeRequest(dir, id);
  return { evicted, orphans: reconcile(dir, index), valid: true };
}

/**
 * Reclaim the stores of projects that no longer exist on disk.
 *
 * Nothing else would ever collect these: the user deleted the folder, and no
 * window will open it again to trigger a sweep. Each store names its own
 * workspace path, so the test is `existsSync` on that path.
 *
 * A path on a drive that is not currently mounted reads as absent. That costs a
 * project its undo history, which is derived data and rebuilds itself — the
 * alternative is leaking forever.
 */
export function sweepDeadProjects(undoRoot: string): string[] {
  const removed: string[] = [];
  let keys: string[];
  try {
    keys = readdirSync(undoRoot);
  } catch {
    return removed;
  }
  for (const key of keys) {
    const dir = join(undoRoot, key);
    if (resolveInRoot(undoRoot, dir) === null) continue;
    if (!isDirectory(dir)) continue;
    const index = readIndex(dir);
    // No usable index, no proof of whose store this is: keep it.
    if (index === null || index.root.length === 0) continue;
    if (existsSync(index.root)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(key);
    } catch {
      /* leave it; the next activation tries again */
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ internals */

/**
 * One target per file. For a whole request the FIRST capture of a file is the
 * state before the request, and the LAST capture guards it — the file must still
 * hold what the request finally left, or the user has been editing.
 */
function selectTargets(req: UndoRequest, scope: UndoScope): UndoTarget[] {
  if (scope === 'last') {
    const last = req.files[req.files.length - 1];
    return last === undefined ? [] : [toTarget(last, guardOf(last))];
  }
  const first = new Map<string, UndoFile>();
  const guard = new Map<string, UndoTarget['guard']>();
  for (const f of req.files) {
    if (!first.has(f.rel)) first.set(f.rel, f);
    guard.set(f.rel, guardOf(f));
  }
  const out: UndoTarget[] = [];
  for (const f of first.values()) {
    out.push(toTarget(f, guard.get(f.rel) ?? guardOf(f)));
  }
  return out;
}

function guardOf(f: UndoFile): UndoTarget['guard'] {
  return f.kind === 'delete' ? { kind: 'absent' } : { kind: 'hash', hash: f.afterHash };
}

function toTarget(f: UndoFile, guard: UndoTarget['guard']): UndoTarget {
  return {
    rel: f.rel,
    action: f.existed ? 'restore' : 'delete',
    seq: f.seq,
    beforeHash: f.beforeHash,
    size: f.bytes,
    guard,
  };
}

/**
 * Drop requests that are over the age limit or the size cap, oldest first, and
 * never the most recent `UNDO_KEEP_REQUESTS`. Whole requests only — a
 * half-restorable request is worse than none.
 *
 * The order of `index.requests` is an invariant of this file: it only appends.
 * It is sorted anyway, because a hand-edited index that reversed the order would
 * otherwise evict the NEWEST requests and keep the oldest.
 */
function evictToFit(index: UndoIndex, now: Date): string[] {
  index.requests.sort((a, b) => (a.startedAtUtc < b.startedAtUtc ? -1 : 1));
  const kept = new Set(
    index.requests.slice(-UNDO_KEEP_REQUESTS).map((r) => r.id),
  );
  const drop: UndoRequest[] = [];
  const live: UndoRequest[] = [];
  for (const r of index.requests) {
    if (kept.has(r.id)) {
      live.push(r);
      continue;
    }
    const age = now.getTime() - Date.parse(r.startedAtUtc);
    if (Number.isFinite(age) && age >= UNDO_MAX_AGE_DAYS * DAY_MS) {
      drop.push(r);
      continue;
    }
    live.push(r);
  }
  let total = live.reduce((n, r) => n + r.bytes, 0);
  const survivors: UndoRequest[] = [];
  for (const r of live) {
    if (total > UNDO_MAX_BYTES && !kept.has(r.id)) {
      total -= r.bytes;
      drop.push(r);
      continue;
    }
    survivors.push(r);
  }
  index.requests = survivors;
  return drop.map((r) => r.id);
}

/**
 * Remove what the index does not name. Only ever called with a valid index — an
 * unreadable one names nothing, and acting on it would delete the whole store.
 *
 * Unnamed DIRECTORIES and unnamed `.bin` copies go. Other unnamed files are left
 * alone: the store is the user's folder, and a file they put there is not an
 * orphan.
 */
function reconcile(dir: string, index: UndoIndex): string[] {
  const named = new Map<string, Set<number>>();
  for (const r of index.requests) {
    const seqs = new Set<number>();
    for (const f of r.files) if (f.seq !== null) seqs.add(f.seq);
    named.set(r.id, seqs);
  }
  const orphans: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return orphans;
  }
  for (const name of entries) {
    if (name === INDEX) continue;
    if (name === TMP) {
      removeFile(join(dir, name));
      continue;
    }
    const abs = join(dir, name);
    const seqs = named.get(name);
    if (seqs === undefined) {
      if (isDirectory(abs)) {
        removeRequest(dir, name);
        orphans.push(name);
      }
      continue;
    }
    let inner: string[];
    try {
      inner = readdirSync(abs);
    } catch {
      continue;
    }
    for (const f of inner) {
      if (!BIN.test(f)) continue;
      if (!seqs.has(Number(f.slice(0, -4)))) removeFile(join(abs, f));
    }
  }
  return orphans;
}

function removeRequest(dir: string, id: string): void {
  if (!isSafeId(id)) return;
  const abs = join(dir, id);
  // The proof that a delete cannot leave the store: the path is built from the
  // store root and then checked against it.
  if (resolveInRoot(dir, abs) === null) return;
  try {
    rmSync(abs, { recursive: true, force: true });
  } catch {
    /* the next sweep tries again */
  }
}

function removeFile(abs: string): void {
  try {
    unlinkSync(abs);
  } catch {
    /* already gone */
  }
}

/**
 * A store is one small file, so it is written whole and renamed into place. A
 * half-written index is the one corruption this store cannot recover from, and
 * `rename` replaces atomically on every platform Plato runs on.
 */
function writeIndex(dir: string, index: UndoIndex): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, TMP);
  writeFileSync(tmp, JSON.stringify(index, null, 2));
  renameSync(tmp, join(dir, INDEX));
}

/**
 * Strict on purpose. Any entry this function does not fully understand makes the
 * whole index invalid, because the index drives deletion — and "deletes nothing"
 * is the only safe reading of a file that does not make sense.
 */
function readIndex(dir: string): UndoIndex | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, INDEX), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    if (rec['version'] !== 1) return null;
    const root = rec['root'];
    if (typeof root !== 'string') return null;
    const rawRequests = rec['requests'];
    if (!Array.isArray(rawRequests)) return null;
    const requests: UndoRequest[] = [];
    for (const raw of rawRequests) {
      const req = parseRequest(raw);
      if (req === null) return null;
      requests.push(req);
    }
    return { version: 1, root, requests };
  } catch {
    return null;
  }
}

function parseRequest(raw: unknown): UndoRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const id = rec['id'];
  const startedAtUtc = rec['startedAtUtc'];
  const bytes = rec['bytes'];
  const rawFiles = rec['files'];
  if (typeof id !== 'string' || !isSafeId(id)) return null;
  if (typeof startedAtUtc !== 'string' || Number.isNaN(Date.parse(startedAtUtc))) return null;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (!Array.isArray(rawFiles)) return null;
  const files: UndoFile[] = [];
  for (const rf of rawFiles) {
    const f = parseFile(rf);
    if (f === null) return null;
    files.push(f);
  }
  return { id, startedAtUtc, bytes, files };
}

function parseFile(raw: unknown): UndoFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const rel = rec['rel'];
  const kind = rec['kind'];
  const existed = rec['existed'];
  const copied = rec['copied'];
  const seq = rec['seq'];
  const bytes = rec['bytes'];
  const beforeHash = rec['beforeHash'];
  const afterHash = rec['afterHash'];
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (kind !== 'write' && kind !== 'delete') return null;
  if (typeof existed !== 'boolean' || typeof copied !== 'boolean') return null;
  if (seq !== null && (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0)) return null;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (typeof beforeHash !== 'string' || typeof afterHash !== 'string') return null;
  return { rel, kind, existed, copied, seq, bytes, beforeHash, afterHash };
}

function readBytes(abs: string): Buffer | null {
  try {
    return readFileSync(abs);
  } catch {
    return null;
  }
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function isUndoStoreId(id: string): boolean {
  return isSafeId(id);
}
