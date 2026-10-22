/**
 * Workspace file listing for grounding prompts (M0).
 *
 * Security invariant 2 (ARCHITECTURE.md): secret-bearing files never enter
 * model context. This walker enforces it at listing time; the deny-list
 * filter in ../security/secrets.ts is the single source of truth for names.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';
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

/** One `.gitignore`, and the directory its patterns are relative to. */
interface IgnoreFile {
  base: string;
  matcher: Ignore;
}

function readIgnoreFile(root: string, base: string): IgnoreFile | null {
  try {
    const text = readFileSync(join(root, base, '.gitignore'), 'utf8');
    return { base, matcher: ignore().add(text.split(/\r?\n/)) };
  } catch {
    return null;
  }
}

type Verdict = 'ignored' | 'unignored' | 'none';

/**
 * The DEEPEST `.gitignore` with an opinion wins, which is git's rule: a rule in
 * `app/.gitignore` overrides one in the root unless the root's came later in
 * the same file. `test()` reports whether a rule matched at all, so "no rule"
 * is not confused with "re-included" — which matters, because an inherited
 * exclusion has to survive a directory that says nothing about itself.
 */
function verdictOf(stack: IgnoreFile[], rel: string, isDir: boolean): Verdict {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { base, matcher } = stack[i]!;
    if (base !== '' && !rel.startsWith(`${base}/`)) {
      continue; // that file is not above this path
    }
    const sub = base === '' ? rel : rel.slice(base.length + 1);
    if (sub.length === 0) {
      continue;
    }
    const verdict = matcher.test(isDir ? `${sub}/` : sub);
    if (verdict.ignored) {
      return 'ignored';
    }
    if (verdict.unignored) {
      return 'unignored';
    }
  }
  return 'none';
}

/**
 * Git decides a file by the path, and ALSO by its directories: a file inside an
 * excluded directory stays excluded however a later rule names it, while
 * re-including the directory itself (`build/` then `!build/keep/`) brings its
 * contents back. So the ancestors are walked root-first, and an exclusion is
 * inherited until a directory explicitly reverses it.
 */
function isIgnored(stack: IgnoreFile[], rel: string, isDir: boolean): boolean {
  const parts = rel.split('/');
  let excluded = false;
  for (let depth = 1; depth < parts.length; depth += 1) {
    const dir = parts.slice(0, depth).join('/');
    const verdict = verdictOf(stack, dir, true);
    if (verdict !== 'none') {
      excluded = verdict === 'ignored';
    }
  }
  if (excluded) {
    return true;
  }
  return verdictOf(stack, rel, isDir) === 'ignored';
}

/**
 * The `.gitignore` files ABOVE the directory a walk starts in, root first. The
 * starting directory's own file is read by `walk` itself, like every other
 * directory it enters.
 */
function ancestorIgnores(root: string, relDir: string): IgnoreFile[] {
  const stack: IgnoreFile[] = [];
  const parts = relDir === '' ? [] : relDir.split('/');
  for (let depth = 0; depth < parts.length; depth += 1) {
    const own = readIgnoreFile(root, parts.slice(0, depth).join('/'));
    if (own !== null) {
      stack.push(own);
    }
  }
  return stack;
}

export interface ListOptions {
  includeSecret?: boolean;
  respectGitignore?: boolean;
}

export interface WorkspaceListing {
  files: string[];
  /**
   * The files a `.gitignore` excludes. Empty when the walk already skipped
   * them: there is nothing to report about a file that is not in the results.
   */
  ignored: Set<string>;
}

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
 *
 * `respectGitignore` is OFF by default, and that default is the product
 * decision (D49bz): an agent that silently misses a file its repository owner
 * ignored is worse than one that sees noise, so search includes ignored paths
 * and LABELS them instead. When it is on, the walk drops what the repository
 * owner marked as generated or local, using the `.gitignore` files in the tree
 * itself — a root rule, and a nested one scoped to its directory — and `ignored`
 * comes back empty because those files never reach a result.
 */
export function listWorkspace(
  root: string,
  subpath = '',
  opts: ListOptions = {},
): WorkspaceListing {
  const out: string[] = [];
  const ignored = new Set<string>();
  try {
    walk(
      root,
      subpath.length > 0 ? join(root, subpath) : root,
      subpath,
      out,
      ignored,
      opts.includeSecret === true,
      opts.respectGitignore === true,
      ancestorIgnores(root, subpath),
    );
  } catch {
    return { files: [], ignored: new Set() };
  }
  return { files: out, ignored };
}

export function listWorkspaceFiles(root: string, subpath = '', opts: ListOptions = {}): string[] {
  return listWorkspace(root, subpath, opts).files;
}

/**
 * Is this ONE path excluded by a `.gitignore` above it? Used by the tools that
 * name a file rather than walk a tree (`read_file`), and only while the walk
 * includes ignored paths.
 */
export function isGitignored(root: string, rel: string): boolean {
  const parts = rel.split('/');
  const stack: IgnoreFile[] = [];
  // Every directory above the file, the workspace root included: for
  // `a/b/c.txt` that is ``, `a`, and `a/b`.
  for (let depth = 0; depth < parts.length; depth += 1) {
    const own = readIgnoreFile(root, parts.slice(0, depth).join('/'));
    if (own !== null) {
      stack.push(own);
    }
  }
  return isIgnored(stack, rel, false);
}


function walk(
  root: string,
  absDir: string,
  relDir: string,
  out: string[],
  ignored: Set<string>,
  includeSecret: boolean,
  skipIgnored: boolean,
  gitignore: IgnoreFile[],
): void {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable subtree: skip, do not fail the whole listing
  }
  let stack = gitignore;
  const own = readIgnoreFile(root, relDir);
  if (own !== null) {
    stack = [...gitignore, own];
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
      if (EXCLUDED_DIRS.has(e.name)) {
        continue;
      }
      if (skipIgnored && isIgnored(stack, rel, true)) {
        continue;
      }
      dirs.push(e.name);
      continue;
    }
    if (!e.isFile()) {
      continue;
    }
    const excluded = isIgnored(stack, rel, false);
    if (excluded && skipIgnored) {
      continue;
    }
    if (excluded) {
      ignored.add(rel);
    }
    out.push(rel);
  }
  for (const d of dirs) {
    if (out.length >= MAX_FILES) {
      return;
    }
    walk(
      root,
      join(absDir, d),
      relDir === '' ? d : `${relDir}/${d}`,
      out,
      ignored,
      includeSecret,
      skipIgnored,
      stack,
    );
  }
}
