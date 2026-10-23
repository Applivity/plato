/**
 * How Plato starts and stops a process on this platform (M0, D49cf).
 *
 * Before this module the shell tool, the background shell, and the MCP client
 * each assumed `/bin/bash` and POSIX process groups. On Windows that is not a
 * degraded run but a broken one: there is no `/bin/bash`, `npx` is `npx.cmd`,
 * and a negative PID is not a process group. **No `/bin/bash` may appear
 * outside the POSIX branch of this file** — M0's exit criterion.
 *
 * The platform is an ARGUMENT with `process.platform` as its default, so the
 * Windows paths can be tested on a Mac. Nothing here reads the global directly
 * except through that default.
 */
import { existsSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';

export type Platform = NodeJS.Platform;
export type Env = Record<string, string | undefined>;

export interface Invocation {
  file: string;
  args: string[];
  /** Windows only: keeps a console window from flashing for the child. */
  windowsHide?: boolean;
  /**
   * Windows only: pass `args` through untouched. cmd.exe parses its own line,
   * so Node's C-runtime quoting would escape the quotes the line depends on.
   */
  windowsVerbatimArguments?: boolean;
}

export function isWindows(platform: Platform = process.platform): boolean {
  return platform === 'win32';
}

/** `%ComSpec%` names the command interpreter; `cmd.exe` is the fallback. */
function comspec(env: Env): string {
  return env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe';
}

/** A command line run through the platform's own shell. */
export function shellInvocation(
  command: string,
  options: { platform?: Platform; env?: Env } = {},
): Invocation {
  const platform = options.platform ?? process.platform;
  if (isWindows(platform)) {
    // `/d` skips AutoRun. The command is wrapped in one pair of quotes and
    // `/s` strips that pair, so inner quotes survive: cmd.exe does not use the
    // C runtime's rules, and Node's quoting for an argument array would escape
    // them into the command. Verbatim keeps the line exactly as written.
    return {
      file: comspec(options.env ?? process.env),
      args: ['/d', '/s', '/c', `"${command}"`],
      windowsHide: true,
      windowsVerbatimArguments: true,
    };
  }
  return { file: '/bin/bash', args: ['-c', command] };
}

/** `taskkill` arguments that stop a process AND every child it started. */
export function taskkillArgs(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F'];
}

/** The extensions Windows appends when a command is typed without one. */
function pathExtensions(env: Env): string[] {
  const raw = env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
}

function findOnPath(
  name: string,
  env: Env,
  extensions: readonly string[],
): string | null {
  const dirs = (env['PATH'] ?? env['Path'] ?? '')
    .split(delimiter)
    .filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The executable to spawn for a command name. On Windows the PATH lookup must
 * apply PATHEXT — Node's `spawn` does not, so `npx` is not found although
 * `npx.cmd` is on PATH. A name that already carries an extension, or a path
 * that is found as written, is returned unchanged.
 */
export function resolveCommand(
  command: string,
  options: { platform?: Platform; env?: Env } = {},
): string {
  const platform = options.platform ?? process.platform;
  if (!isWindows(platform)) return command;
  const env = options.env ?? process.env;
  const extensions = pathExtensions(env);
  const lower = command.toLowerCase();
  const explicit =
    extname(command) !== '' || extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
  if (explicit) return command;

  const hasDirectory = command.includes('/') || command.includes('\\');
  if (hasDirectory) {
    for (const ext of extensions) {
      if (existsSync(`${command}${ext}`)) return `${command}${ext}`;
    }
    return command;
  }
  // The search order Windows uses: the bare name first, then PATHEXT.
  const bare = findOnPath(command, env, ['']);
  if (bare !== null) return bare;
  return findOnPath(command, env, extensions) ?? command;
}

const NEEDS_CMD = /\.(cmd|bat)$/i;

/**
 * One argument, quoted for cmd.exe. Follows the C runtime's rule: a backslash
 * is literal unless it precedes a quote, and one that precedes the closing
 * quote must be doubled.
 */
function quoteWindowsArg(value: string): string {
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * The process to spawn for a program and its arguments.
 *
 * On Windows a `.cmd` or `.bat` shim cannot be started directly — Node refuses
 * since the 2024 argument-injection fix — so it goes through `cmd.exe`. The
 * whole line is quoted as one string, and `/s` strips the outer pair, which is
 * what makes the quoting survive that trip.
 */
export function commandInvocation(
  file: string,
  args: readonly string[],
  options: { platform?: Platform; env?: Env } = {},
): Invocation {
  const platform = options.platform ?? process.platform;
  if (!isWindows(platform) || !NEEDS_CMD.test(file)) {
    return { file, args: [...args] };
  }
  const line = [file, ...args].map(quoteWindowsArg).join(' ');
  return {
    file: comspec(options.env ?? process.env),
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsHide: true,
    // cmd.exe reads the line itself; let it see exactly the quotes above.
    windowsVerbatimArguments: true,
  };
}

/**
 * The environment for a child. Windows keys are case-insensitive, so setting
 * `PATH` must REPLACE a `Path` already inherited — otherwise the child gets
 * two spellings of the same variable and whichever one it reads first wins.
 */
export function mergeEnv(
  base: Env,
  extra: Env,
  platform: Platform = process.platform,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };
  const seen = isWindows(platform)
    ? new Map(Object.keys(merged).map((key) => [key.toLowerCase(), key]))
    : null;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    if (seen !== null) {
      const existing = seen.get(key.toLowerCase());
      if (existing !== undefined && existing !== key) delete merged[existing];
      seen.set(key.toLowerCase(), key);
    }
    merged[key] = value;
  }
  return merged;
}
