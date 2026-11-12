/**
 * D49cn (2026-11-12): after a summary, the model is shown the CURRENT state of
 * the work it can no longer see.
 *
 * A summary is a lossy record written when the fold ran. By the next message
 * the files it mentions may have changed, and the model would be reasoning
 * from a stale note. Claude Code solves this by putting the recent files and
 * the repository state back into the prompt; the founder's decision is that
 * this is CORRECTNESS, not a preference — a switch could only make Plato worse
 * — so it is a rule here, with named constants and no setting.
 *
 * The block is built FRESH at run start, and only when a summary is in effect.
 * Before a fold there is nothing to restate and no block is sent, so the same
 * content is never carried twice.
 *
 * What is included, and what is only named:
 *   - up to `RECENT_WORK_FILES` files this chat read or edited, newest first,
 *     by their CURRENT content;
 *   - a total of `RECENT_WORK_TOKENS` tokens of content, by the same estimator
 *     the context ring uses;
 *   - a protected file is named and never quoted;
 *   - a file outside the workspace, one deleted since, and one too large to
 *     fit are each NAMED with the reason — never invented;
 *   - the current branch and a capped `git status --short`, when the workspace
 *     is a git repository.
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { isToolRow, lastSummaryIndex, type LogRow } from './chatlog.js';
import { estimateTokens } from './context.js';
import { resolveInRoot } from '../security/paths.js';
import { isSecretPath } from '../security/secrets.js';

/** Files named in the block: 5, the number Claude Code uses. */
export const RECENT_WORK_FILES = 5;
/** Total file content allowed in the block, in estimated tokens. */
export const RECENT_WORK_TOKENS = 5_000;
/** `git status --short` lines kept before it is cut. */
export const RECENT_WORK_STATUS_LINES = 30;

/**
 * The tools whose digest IS a file path. `grep`'s digest also carries its
 * pattern, and `apply_patch`'s carries several paths with no separator that
 * could not be one of them, so neither is read here.
 */
const FILE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'write_file',
  'apply_diff',
]);

export interface RecentWorkOptions {
  root: string;
  maxFiles?: number;
  maxTokens?: number;
  /** Injected by tests; defaults to the workspace's own `git`. */
  git?: (root: string) => Promise<{ branch: string; status: string } | null>;
}

async function runGit(root: string, args: string[]): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: root, timeout: 5_000, maxBuffer: 100_000 },
      (err, stdout) => resolve(err ? null : stdout.toString()),
    );
  });
}

async function gitState(
  root: string,
): Promise<{ branch: string; status: string } | null> {
  const branch = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']))
    ?.trim();
  if (branch === undefined || branch.length === 0) return null;
  const status = (await runGit(root, ['status', '--short'])) ?? '';
  return {
    branch,
    status: status
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.length > 0)
      .slice(0, RECENT_WORK_STATUS_LINES)
      .join('\n'),
  };
}

/** The paths this chat touched, newest first, without repeats. */
export function recentWorkPaths(
  rows: readonly LogRow[],
  maxFiles: number = RECENT_WORK_FILES,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = rows.length - 1; i >= 0 && out.length < maxFiles; i -= 1) {
    const row = rows[i]!;
    if (!isToolRow(row) || row.tool === undefined) continue;
    if (!FILE_TOOLS.has(row.tool)) continue;
    const path = (row.digest ?? '').trim();
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * The block, or null when no summary is in effect (or there is nothing to
 * restate). The caller appends it to the run's history as a user turn.
 */
export async function recentWorkBlock(
  rows: readonly LogRow[],
  opts: RecentWorkOptions,
): Promise<string | null> {
  if (lastSummaryIndex(rows) < 0) return null;
  const maxFiles = opts.maxFiles ?? RECENT_WORK_FILES;
  const maxTokens = opts.maxTokens ?? RECENT_WORK_TOKENS;
  const paths = recentWorkPaths(rows, maxFiles);

  const parts: string[] = [
    '[recent work — the files this conversation touched, as they are NOW]',
    'A summary is in effect, so this block restates the current state instead of the old turns.',
  ];
  let budget = maxTokens;
  for (const path of paths) {
    const rel = resolveInRoot(opts.root, path);
    if (rel === null) {
      parts.push(`--- ${path} --- (not included: outside the workspace)`);
      continue;
    }
    if (isSecretPath(rel)) {
      parts.push(`--- ${path} --- (not included: on the protected list)`);
      continue;
    }
    const abs = join(opts.root, rel);
    let size: number;
    try {
      const st = await stat(abs);
      if (!st.isFile()) {
        parts.push(`--- ${path} --- (not included: not a file)`);
        continue;
      }
      size = st.size;
    } catch {
      parts.push(`--- ${path} --- (not included: no longer exists)`);
      continue;
    }
    // Reading a file that cannot fit is wasted work and a wasted read.
    if (size > budget * 4) {
      parts.push(`--- ${path} --- (not included: over the size budget)`);
      continue;
    }
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      parts.push(`--- ${path} --- (not included: could not be read)`);
      continue;
    }
    const cost = estimateTokens(content);
    if (cost > budget) {
      parts.push(`--- ${path} --- (not included: over the size budget)`);
      continue;
    }
    budget -= cost;
    parts.push(`--- ${path} ---\n${content}`);
  }

  const git = await (opts.git ? opts.git(opts.root) : gitState(opts.root));
  if (git !== null) {
    parts.push(`Current branch: ${git.branch}`);
    parts.push(
      'git status --short:\n' + (git.status.length > 0 ? git.status : '(clean)'),
    );
  }

  // A block with no file and no repository says nothing the summary does not.
  if (paths.length === 0 && git === null) return null;
  return parts.join('\n');
}
