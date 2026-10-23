/**
 * A command string that runs on both bash and cmd.exe (M0, D49cf).
 *
 * The tests exercise the shell tools, and `sleep`, `cat`, `printf`, `seq` and
 * `echo x >&2` exist only on POSIX. Node exists on both, so a one-liner is the
 * portable substitute. Scripts use SINGLE quotes only: cmd.exe expands `%` and
 * owns the double quotes the argument is wrapped in, while both shells pass a
 * single-quoted string inside it through unchanged.
 */
export function nodeCommand(script: string): string {
  return `"${process.execPath}" -e "${script}"`;
}

/** Prints one line and exits 0. */
export function print(text: string): string {
  return nodeCommand(`console.log('${text}')`);
}

/** Prints one line to stderr and exits 0. */
export function warn(text: string): string {
  return nodeCommand(`console.error('${text}')`);
}

/** Runs until something kills it. */
export const LONG_RUNNING = nodeCommand('setInterval(()=>{},1000)');

/**
 * Reads every file whose name starts with `prefix` and writes it to stdout,
 * WITHOUT naming any of them exactly. That is the indirect route the masker
 * must still scrub; `cat local.propert*` was the POSIX spelling.
 */
export function readMatching(prefix: string): string {
  return nodeCommand(
    `const fs=require('fs');` +
      `for(const f of fs.readdirSync('.')){` +
      `if(f.startsWith('${prefix}'))process.stdout.write(fs.readFileSync(f,'utf8'))}`,
  );
}
