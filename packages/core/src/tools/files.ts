/**
 * Workspace file listing for grounding prompts (M0).
 *
 * Security invariant 2 (ARCHITECTURE.md): secret-bearing files never enter
 * model context. This walker enforces it at listing time; the deny-list
 * filter in ../security/secrets.ts is the single source of truth for names.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretPath } from '../security/secrets.js';

/** Directories that never carry useful project context. */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.gradle',
  '.idea',
  '.vscode',
]);

/** Hard cap so a huge tree cannot blow up a prompt. */
const MAX_FILES = 2000;

/**
 * Lists workspace files under `root` as repo-relative POSIX-style paths,
 * depth-first within each directory. Silently returns [] when the root is
 * unreadable (missing or permission-denied); callers render a fallback.
 *
 * `subpath` (D49l) starts the walk inside that directory while still returning
 * paths relative to `root`, so `list_dir { path: 'src' }` yields `src/a.ts` —
 * the same form every other tool takes as input. The caller is responsible for
 * resolving and containing `subpath` before passing it.
 *
 * `includeSecret` (D49bc) is the ONE caller that wants the protected names back:
 * seeding the session's secret map needs to find the files this walker exists to
 * hide from a model. Every other caller keeps the default, because the listing
 * feeds prompts and tool output.
 */
export function listWorkspaceFiles(
  root: string,
  subpath = '',
  opts: { includeSecret?: boolean } = {},
): string[] {
  const out: string[] = [];
  try {
    walk(
      subpath.length > 0 ? join(root, subpath) : root,
      subpath,
      out,
      opts.includeSecret === true,
    );
  } catch {
    return [];
  }
  return out;
}


function walk(
  absDir: string,
  relDir: string,
  out: string[],
  includeSecret: boolean,
): void {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable subtree: skip, do not fail the whole listing
  }
  const dirs: string[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= MAX_FILES) {
      return;
    }
    const rel = relDir === '' ? e.name : `${relDir}/${e.name}`;
    if (!includeSecret && isSecretPath(rel)) {
      continue;
    }
    if (e.isDirectory()) {
      if (!EXCLUDED_DIRS.has(e.name)) {
        dirs.push(e.name);
      }
      continue;
    }
    if (e.isFile()) {
      out.push(rel);
    }
  }
  for (const d of dirs) {
    if (out.length >= MAX_FILES) {
      return;
    }
    walk(join(absDir, d), relDir === '' ? d : `${relDir}/${d}`, out, includeSecret);
  }
}
