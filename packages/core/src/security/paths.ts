/**
 * Security invariant: a file tool may only touch the workspace it was opened
 * on.
 *
 * Until D49k no tool enforced this. Every path argument went straight to
 * `join(root, raw)`, so `read_file {path: '../../../../tmp/x'}` read a file
 * outside the workspace and `write_file` **created** one — verified by writing
 * to `/tmp` through the tool surface. The VS Code host already had this rule for
 * attachments (`relWithinRoot`), but tool execution in core did not.
 *
 * This covers the FILE tools. `shell` is deliberately not covered: a command can
 * `cd ..` or read an absolute path by nature, which is exactly why it is the
 * most gated tool kind (denied in plan/edit, asked in act).
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Resolves `raw` against `root` and returns the path RELATIVE to the root, or
 * null when it escapes. `''` means the root itself.
 *
 * Lexical only: a symlink inside the root that points outside it is not caught.
 * That matches the host's attachment check, and it is why the workspace must not
 * contain hostile symlinks.
 */
export function resolveInRoot(root: string, raw: string): string | null {
  if (raw.length === 0) return null;
  // A NUL byte truncates the path inside libc; refuse rather than guess which
  // half was meant.
  if (raw.includes('\0')) return null;
  const rel = relative(root, resolve(root, raw));
  if (isAbsolute(rel)) return null; // a different drive/root (Windows)
  if (rel === '..' || rel.startsWith(`..${sep}`)) return null;
  // M0 (D49cf): a workspace-relative path is the SAME string on every platform.
  // `relative()` returns `src\a.ts` on Windows, but this value is what the model
  // writes, what an approval is remembered under, and what the file tools join,
  // so one separator is required. Forward slashes are accepted by Windows APIs.
  return rel.split(sep).join('/');
}

/** Absolute path for a contained argument, or null when it escapes. */
export function absInRoot(root: string, raw: string): string | null {
  const rel = resolveInRoot(root, raw);
  return rel === null ? null : join(root, rel);
}

/**
 * The path-bearing arguments of a tool call, by tool name.
 *
 * One source of truth on purpose: the loop's pre-flight refusal and the executor
 * must not be able to disagree about which argument is a path. A tool that takes
 * no path returns [].
 */
export function pathArgsOf(tool: string, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const take = (v: unknown): void => {
    if (typeof v === 'string' && v.length > 0) out.push(v);
  };
  switch (tool) {
    case 'read_file':
    case 'read_image':
    case 'grep':
    case 'write_file':
    case 'apply_diff':
    case 'list_dir':
      take(args['path']);
      break;
    case 'apply_patch': {
      const patches = args['patches'];
      if (Array.isArray(patches)) {
        for (const p of patches) {
          if (typeof p === 'object' && p !== null) {
            take((p as Record<string, unknown>)['path']);
          }
        }
      }
      break;
    }
    default:
      break; // shell, grep, glob, git, ask_user: no path argument
  }
  return out;
}

/**
 * Refuses a call whose path argument leaves the workspace. Returns a short
 * reason, or null when every path is contained. Mirrors `secretRefusal` so the
 * loop can refuse BEFORE asking the user to approve an impossible action.
 */
export function containmentRefusal(
  root: string,
  tool: string,
  args: Record<string, unknown>,
): string | null {
  for (const raw of pathArgsOf(tool, args)) {
    if (resolveInRoot(root, raw) === null) {
      return `${tool} was refused: "${raw}" is outside the workspace.`;
    }
  }
  return null;
}
