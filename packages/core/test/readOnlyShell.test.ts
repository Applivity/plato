import { describe, expect, it } from 'vitest';
import { isReadOnlyShellCommand } from '../src/security/readOnlyShell.js';
import { decideWithArgs, secretRefusal } from '../src/runtime/modes.js';

/**
 * D49an. `edit` mode runs a read-only shell command without an approval card.
 *
 * **The refusals are the important half of this file**, because the two mistakes
 * are not symmetric: a command wrongly refused costs one click, and a command
 * wrongly allowed runs unapproved. Every refusal below names the way round the
 * rule, not a command that merely looks alarming.
 */

describe('read-only commands are recognised (D49an)', () => {
  it('accepts the plain readers an agent actually uses', () => {
    for (const cmd of [
      'ls',
      'ls -la',
      'ls src/main',
      'pwd',
      'cat src/a.ts',
      'head -20 src/a.ts',
      'tail -5 src/a.ts',
      'wc -l src/a.ts',
      'file src/a.ts',
      'stat src/a.ts',
      'tree src',
      'diff a.ts b.ts',
      'grep -rn pattern src',
      'rg pattern',
      'find src -name main.ts',
      'which node',
      'echo hello world',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(true);
    }
  });

  it('accepts the read-only git subcommands', () => {
    for (const cmd of [
      'git status',
      'git diff',
      'git diff --stat',
      'git log --oneline -20',
      'git show HEAD',
      'git blame src/a.ts',
      'git rev-parse HEAD',
      'git ls-files',
      'git --version',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(true);
    }
  });
});

describe('a command that could do more than read is refused (D49an)', () => {
  it('refuses one command becoming several', () => {
    for (const cmd of [
      'cat a.ts; rm -rf src',
      'ls && rm -rf src',
      'ls || rm -rf src',
      'cat a.ts | tee b.ts',
      'ls & rm x',
      'ls\nrm -rf src',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses redirection, which writes', () => {
    for (const cmd of [
      'echo hello > out.txt',
      'cat a.ts >> out.txt',
      'cat < src/a.ts',
      'ls 2> err.txt',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses substitution and expansion, which read something unnamed', () => {
    for (const cmd of ['cat $(ls)', 'cat `ls`', 'cat ${HOME}/notes', 'echo $PWD']) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  /**
   * The load-bearing refusal. The secret deny-list (D49ai) matches the file NAMES
   * written in the command, so a glob reads a secret without naming one:
   * `cat *.properties` names no deny-listed file and would open
   * `keystore.properties` if it is present. With globbing refused, a command can
   * only open files it spells out — and spelling one out is what the deny-list
   * catches.
   *
   * `[` is the same hole through a character class, which is why it is refused
   * with the other two.
   */
  it('refuses globbing, which can open a file the command never names', () => {
    for (const cmd of [
      'cat *.properties',
      'cat *',
      'cat ?.ts',
      'cat [k]eystore.properties',
      'ls [a-z]*.ts',
      'grep foo *.ts',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses anything reaching outside the workspace', () => {
    for (const cmd of [
      'cat /etc/passwd',
      'cat ~/.ssh/id_rsa',
      'cat ../other/file.ts',
      'cat src/../../outside.ts',
      'ls /',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses the flags that turn a reader into a writer', () => {
    for (const cmd of [
      'git diff --output=oops.txt',
      'git log -o oops.txt',
      'find . -delete',
      'find . -exec rm {} +',
      'find . -fprint out.txt',
      'tree -o out.txt',
      'file -C',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses git subcommands that change the repository', () => {
    for (const cmd of [
      'git add .',
      'git commit -m msg',
      'git checkout main',
      'git reset --hard',
      'git push',
      'git clean -fd',
      'git config user.email someone@example.com',
      'git branch new-branch',
      'git stash',
      'git apply patch.diff',
      'git',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  /**
   * The programs that are absent on purpose, each for a concrete reason rather
   * than for looking dangerous: `sort -o` and `sed -i` write, `awk` can write
   * from inside its own program, `tee` exists to write, and `curl`/`wget` reach
   * the network — which has its own gated path (`web_fetch`, D49p).
   */
  it('refuses every program that is not on the list, including the near misses', () => {
    for (const cmd of [
      'rm -rf src',
      'mv a.ts b.ts',
      'cp a.ts b.ts',
      'touch new.ts',
      'mkdir newdir',
      'chmod +x run.sh',
      'sed -i s/a/b/ src/a.ts',
      'sort -o out.txt src/a.ts',
      'tee out.txt',
      'awk {print} src/a.ts',
      'npm install',
      'npx tsc',
      'python3 script.py',
      'node script.js',
      'curl http://example.com',
      'wget http://example.com',
      './scripts/run.sh',
      '/usr/bin/ls',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('refuses nothing at all, and nothing but whitespace', () => {
    expect(isReadOnlyShellCommand('')).toBe(false);
    expect(isReadOnlyShellCommand('   ')).toBe(false);
  });
});

/**
 * D49aq. **The command does not run argv-style** — the executor hands the whole
 * string to `/bin/bash -c` — so quoting decides what bash does with a glob, and
 * a check that reads the raw text describes a different command from the one
 * that runs.
 *
 * The reason this earns its own block: `find src -name "*.java"` is a genuinely
 * read-only search that this file used to REFUSE, because every `*` was refused
 * unconditionally. bash expands a glob only when it is unquoted, so the refusal
 * belongs to the unquoted case and to nothing else. The unquoted half is still
 * the load-bearing one and is asserted in the block above.
 */
describe('quoting is read the way bash reads it (D49aq)', () => {
  it('accepts a quoted glob, which bash passes through literally', () => {
    for (const cmd of [
      'find src -name "*.java"',
      "find src -name '*.java'",
      'find . -name "*.ts" -o -name "*.tsx"',
      "find src -name '[A-Z]*.java'",
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(true);
    }
  });

  /**
   * The case that LOOKS like the load-bearing refusal being defeated. It is not:
   * cat receives the literal name `*.properties`, no shell expands it, and the
   * command opens nothing — least of all the secret the unquoted spelling would
   * have read. Only the unquoted glob is the hole, and it is still refused.
   */
  it('allows a quoted glob to a reader that cannot expand it, and still refuses the unquoted one', () => {
    expect(isReadOnlyShellCommand('cat "*.properties"')).toBe(true);
    expect(isReadOnlyShellCommand('cat *.properties')).toBe(false);
    // The half-quoted spelling is unquoted where it matters, so it is refused.
    expect(isReadOnlyShellCommand('cat *".properties"')).toBe(false);
  });

  /**
   * The containment repair. `escapesWorkspace` used to read the raw text, so the
   * token `".."` split into the segments `"..` and `.."` — neither of them `..` —
   * and `ls ".."` was auto-approved and listed the parent directory. The check
   * runs on the unquoted tokens now, which is what the program receives.
   */
  it('refuses a quoted path out of the workspace', () => {
    for (const cmd of [
      'ls ".."',
      "ls '..'",
      'cat "../../etc/passwd"',
      "cat 'src/../../outside.ts'",
      'ls "/etc"',
      'cat "~/notes"',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  it('accepts a quoted ordinary path, which is the reason quoting exists', () => {
    for (const cmd of [
      'ls "src/main"',
      "cat 'src/a b.ts'",
      'grep -rn "two words" src',
      'find . -name "a b.ts"',
      "ls ''",
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(true);
    }
  });

  /**
   * Quoting suppresses globbing in double quotes, but NOT expansion: bash still
   * expands `$` and a backtick there. Single quotes suppress everything, so the
   * same characters are inert — and the command is then a reader of a file whose
   * name happens to contain them.
   */
  it('refuses expansion inside double quotes, and allows the same text in single quotes', () => {
    expect(isReadOnlyShellCommand('cat "$HOME/notes"')).toBe(false);
    expect(isReadOnlyShellCommand('cat "`ls`"')).toBe(false);
    expect(isReadOnlyShellCommand('cat "${HOME}/notes"')).toBe(false);
    // Single quotes: bash expands nothing, so this opens a literal filename.
    expect(isReadOnlyShellCommand("cat '$HOME/notes'")).toBe(true);
    expect(isReadOnlyShellCommand("cat '`ls`'")).toBe(true);
  });

  /**
   * A write flag is a write flag however it is quoted — and running the flag
   * check on the unquoted token is what makes that true.
   */
  it('refuses a quoted write flag', () => {
    for (const cmd of [
      "find . -name x '-delete'",
      'tree "-o" out.txt',
      'git log "--output=oops.txt"',
    ]) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });

  /**
   * Fail closed on anything this parser does not model. An unterminated quote is
   * the one worth naming: a reader that ignored it would treat the rest of the
   * command as quoted text while bash treats it as live syntax.
   */
  it('refuses an unterminated quote and a backslash', () => {
    for (const cmd of ['ls "src', "ls 'src", 'cat a\\ b.ts', 'ls "a" \\']) {
      expect(isReadOnlyShellCommand(cmd), cmd).toBe(false);
    }
  });
});

/**
 * The composition, which is where a widening can go wrong even when each half is
 * right. `plan` keeps NO shell: only `ask` can become `allow`, and `plan` denies
 * the shell outright, so the read-only allowance cannot reach it.
 */
describe('the allowance is narrow and mode-scoped (D49an)', () => {
  it('allows a read-only command in edit, and still asks for anything else', () => {
    expect(decideWithArgs('shell', 'edit', { command: 'git status' })).toBe('allow');
    expect(decideWithArgs('shell', 'edit', { command: 'ls -la' })).toBe('allow');
    expect(decideWithArgs('shell', 'edit', { command: 'rm -rf src' })).toBe('ask');
    expect(decideWithArgs('shell', 'edit', { command: 'git commit -m x' })).toBe('ask');
    expect(decideWithArgs('shell', 'edit', {})).toBe('ask');
  });

  /**
   * D49ao, the founder's instruction: *"plan can run read only commands."*
   *
   * **Both halves matter and they are different halves.** A read-only command is
   * allowed, and every command that is not one is still DENIED in plan — not
   * asked, denied, because plan draws no card for a COMMAND. So the widening has
   * to be exact: anything the allowlist does not recognise leaves the verdict at
   * `deny`.
   *
   * **Scoped to commands on purpose.** This used to read "plan shows no cards",
   * which is false about the MODE and was corrected on 2026-10-07: `web_fetch`
   * asks in plan, and the question, stuck and reveal cards are not mode-gated at
   * all. See D49ao. The fact being pinned here is about the shell, and it is
   * still true.
   */
  it('gives plan the read-only commands, and nothing else (D49ao)', () => {
    expect(decideWithArgs('shell', 'plan', { command: 'git status' })).toBe('allow');
    expect(decideWithArgs('shell', 'plan', { command: 'ls -la' })).toBe('allow');
    expect(decideWithArgs('shell', 'plan', { command: 'grep -rn foo src' })).toBe('allow');
    // Denied, not asked: plan draws no card for a command.
    expect(decideWithArgs('shell', 'plan', { command: 'rm -rf src' })).toBe('deny');
    expect(decideWithArgs('shell', 'plan', { command: 'npm test' })).toBe('deny');
    expect(decideWithArgs('shell', 'plan', { command: 'cat /etc/passwd' })).toBe('deny');
    expect(decideWithArgs('shell', 'plan', { command: 'git commit -m x' })).toBe('deny');
    expect(decideWithArgs('shell', 'plan', {})).toBe('deny');
  });

  /**
   * D49ao. **A background command is not a read**, and this is the gap the
   * widening exposed rather than introduced: `run_in_background` starts a process
   * that outlives the turn, and the only tool that stops one is `kill_shell`,
   * which `plan` denies. So an auto-approved background shell in `plan` would be
   * a process the user could not stop from the mode they were in. One rule for
   * both modes: a background command asks.
   */
  it('never auto-approves a background command (D49ao)', () => {
    expect(
      decideWithArgs('shell', 'edit', { command: 'ls', run_in_background: true }),
    ).toBe('ask');
    expect(
      decideWithArgs('shell', 'plan', { command: 'ls', run_in_background: true }),
    ).toBe('deny');
    // The same command in the foreground is still a read.
    expect(decideWithArgs('shell', 'edit', { command: 'ls' })).toBe('allow');
  });

  /**
   * The tool test is what keeps the widening exact: a `deny` for anything other
   * than the shell must never become an `allow`.
   */
  it('never upgrades a deny belonging to another tool (D49ao)', () => {
    // An MCP tool is shell-class and denied in plan; it carries a `command` arg
    // shaped exactly like the one the allowance looks for.
    expect(
      decideWithArgs('mcp__fake__echo', 'plan', { command: 'git status' }),
    ).toBe('deny');
    expect(decideWithArgs('kill_shell', 'plan', { id: 'x' })).toBe('deny');
  });

  it('leaves the verdict for every other tool alone', () => {
    expect(decideWithArgs('write_file', 'edit', { path: 'a.ts' })).toBe('ask');
    expect(decideWithArgs('read_file', 'edit', { path: 'a.ts' })).toBe('allow');
    expect(decideWithArgs('web_fetch', 'edit', { url: 'https://x.test' })).toBe('ask');
    expect(decideWithArgs('apply_patch', 'edit', { patches: [] })).toBe('ask');
  });

  /**
   * **The pairing that keeps the secret rule intact, and the reason it is spelled
   * out here.** `cat keystore.properties` IS a read-only command, so the
   * allowance says `allow` — and that is fine, because it never gets that far:
   * the loop runs the secret refusal BEFORE the mode decision, so the command is
   * refused outright and no card is shown either.
   *
   * Written as one test on purpose. Either half alone reads as a hole, and the
   * thing that makes it not a hole is the ORDER, which is asserted end-to-end in
   * `loop.test.ts` ("refuses a shell command that names a protected file").
   */
  it('says allow for a command naming a protected file, because the secret check fires first', () => {
    const args = { command: 'cat keystore.properties' };
    expect(decideWithArgs('shell', 'edit', args)).toBe('allow');
    expect(secretRefusal('shell', args)).not.toBeNull();
  });
});
