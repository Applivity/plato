/**
 * Field-test launcher — the one command that runs the ten tests.
 *
 * What it does, in order, and why:
 *
 *   1. **Strips the editor's environment.** If this is started from inside
 *      VS Code, the child environment carries `ELECTRON_RUN_AS_NODE=1`, which
 *      makes any Electron binary boot as plain Node — the VS Code under test
 *      then dies instantly and ChromeDriver reports it as "Chrome instance
 *      exited". That single variable cost an hour; it is deleted here.
 *   2. **Protects the demo repo.** Tests 4, 5 and 9 write files by design. The
 *      launcher refuses to run if those files already carry uncommitted edits
 *      (they would be the founder's work, not the harness's), then puts the repo
 *      on a dated branch. It never commits and never pushes — the diff is left
 *      standing for a human to read.
 *      **Read the trap in scripts/field/README.md before running on a
 *      `plato-field-test-*` branch:** on that branch the two target files are
 *      RESET without being asked, so any hand edit to them is destroyed. The
 *      founder's trial work lives on that branch today.
 *   3. **Builds and packages fresh.** A stale VSIX would test old behaviour, so
 *      the bundle is rebuilt and the extension packaged before every run.
 *   4. **Starts the scripted model** and stops it afterwards.
 *
 * Usage:
 *   node scripts/field/run-field.mjs
 *   FIELD_CASES=1,2 node scripts/field/run-field.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Files the harness itself writes into the demo repo. Removed after every run,
 * whether it passed or not — an untracked leftover does not appear in a diff, so
 * nothing else would ever notice it.
 */
const SCRATCH_FILES = [
  'probe-diagnostics.ts',
  '.env.plato-probe',
  // D49bc: case 22's unmaskable JSON blob, and case 23's environment file.
  'secrets.plato-probe',
  '.env',
  // D49ca: cases 34 and 35 write this to prove a write was admitted or refused.
  'mode-switch-probe.txt',
  // D49cb: the real-model mode cases write this one.
  'mode-request-probe.txt',
];

import { DATE_HELPER, DEMO_REPO, VIEW_MODEL } from './cases.mjs';
import { runsDirFor } from './verdict.mjs';

// 1 — the editor's environment must not leak into the editor under test.
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const STORAGE = resolve(ROOT, 'tmp', 'field', 'storage');

// Everything below runs from the repo root, regardless of where the founder
// started us. Two reasons, both learned the hard way: the test library resolves
// paths against the working directory (started from $HOME it looked for
// `~/package.json` and died inside installVsix), and a startup EPERM on an
// unreadable cwd kills Node before a single line of this file runs. Our own
// paths are all derived from import.meta.dirname, so this is the only place the
// cwd matters — and it is now pinned.
process.chdir(ROOT);
const VSCODE_VERSION = '1.136.0';
const PORT = process.env['PLATO_STUB_PORT'] ?? '4599';

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const say = (m) => console.log(`\n== ${m}`);

// 0 — the harness's own dependencies, checked FIRST.
//
// They are deliberately not in the root package.json: a root `pnpm install`
// (what a contributor runs to build Plato) must not download a
// browser-automation stack the product never uses. The cost is one extra
// install, and this is what says so — at the top, before a minute of bundling
// and packaging, and before the demo repo is touched at all. Without it the
// failure is a bare ERR_MODULE_NOT_FOUND from an import forty lines down.
try {
  await import('vscode-extension-tester');
} catch {
  console.error(
    '\nThe harness dependencies are not installed.\n\n' +
      '  cd scripts/field && pnpm install --ignore-workspace\n\n' +
      'They are kept out of the root package.json on purpose — see\n' +
      'scripts/field/README.md ("Dependencies").\n',
  );
  process.exit(2);
}

// 2 — the demo repo: on the harness's own branch, clear its scratch first; on a
// real branch, require the targets to be untouched before creating one.
const TARGETS = [DATE_HELPER, VIEW_MODEL];
const branch = sh('git', ['-C', DEMO_REPO, 'branch', '--show-current']).stdout.trim();

if (branch.startsWith('plato-field-test')) {
  say(`on test branch ${branch} — resetting the harness's own scratch edits`);
  const reset = sh('git', ['-C', DEMO_REPO, 'checkout', '--', ...TARGETS]);
  if (reset.status !== 0) {
    console.error(reset.stderr || reset.stdout);
    process.exit(2);
  }
} else {
  const dirty = sh('git', ['-C', DEMO_REPO, 'status', '--porcelain', '--', ...TARGETS]).stdout.trim();
  if (dirty.length > 0) {
    console.error(`refusing to run: these files have uncommitted edits that are not the harness's:\n${dirty}`);
    process.exit(2);
  }
  if (branch !== 'master' && branch !== 'main') {
    console.error(`refusing to run: the demo repo is on "${branch}", which is neither a test branch nor master`);
    process.exit(2);
  }
  const name = `plato-field-test-${new Date().toISOString().slice(0, 10)}`;
  say(`creating branch ${name} in the demo repo`);
  const made = sh('git', ['-C', DEMO_REPO, 'checkout', '-b', name]);
  if (made.status !== 0) {
    console.error(made.stderr || made.stdout);
    process.exit(2);
  }
}

// 3 — fresh bundle and package.
//
// COMPILE FIRST. The bundle resolves `@applivity/plato-core` through that
// package's `main`, which is BUILT output (`dist/src/index.js`) — so a change to
// core's source is invisible to esbuild until `tsc -b` has run. Without this
// step the VSIX is fresh from the shell's point of view and stale in the part
// that matters, which is worse than an obviously old build.
//
// This is not hypothetical. The D49aw falsification — neutering the stuck-run
// guard in `packages/core/src/runtime/loop.ts` — was expected to FAIL case 12
// and passed instead, because the edit had never been compiled. Only a
// falsification that declines to fail gives that away; a normal green run would
// have looked exactly like success.
say('compiling core');
mkdirSync(resolve(ROOT, 'tmp', 'field'), { recursive: true });
const compiled = sh('pnpm', ['exec', 'tsc', '-b'], { cwd: ROOT, stdio: 'inherit' });
if (compiled.status !== 0) {
  console.error('tsc failed — the bundle would carry a stale core');
  process.exit(2);
}
say('bundling and packaging the extension');
const bundle = sh('pnpm', ['--filter', 'plato', 'run', 'bundle'], { cwd: ROOT, stdio: 'inherit' });
if (bundle.status !== 0) {
  console.error('bundle failed');
  process.exit(2);
}
const pack = sh('pnpm', ['--filter', 'plato', 'run', 'package'], { cwd: ROOT, stdio: 'inherit' });
// The package script uses vsce's default name (`plato-<version>.vsix`), so
// take whichever .vsix it just wrote rather than assuming a version number.
const VSIX_DIR = resolve(ROOT, 'packages', 'vscode');
const packaged = readdirSync(VSIX_DIR)
  .filter((n) => n.endsWith('.vsix'))
  .map((n) => ({ path: resolve(VSIX_DIR, n), mtime: statSync(resolve(VSIX_DIR, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0];
if (pack.status !== 0 || packaged === undefined) {
  console.error('packaging failed');
  process.exit(2);
}
say(`packaged ${packaged.path}`);

// 4 — the scripted model, in scripted mode only. The real-model pass has no
// stub: the point of that pass is that a real model answers.
const REAL = process.env['PLATO_FIELD_REAL'] === '1';
let stub = null;
if (REAL) {
  say('real-model mode — no scripted model; a real provider answers');
  process.env['PLATO_FIELD_KEY_FILE'] = process.env['PLATO_FIELD_KEY_FILE'] ?? `${process.env['HOME']}/Desktop/demo-creds.rtf`;
  say(`key will be read from ${process.env['PLATO_FIELD_KEY_FILE']} at run time (never copied)`);
} else {
  say('starting the scripted model');
  stub = spawn('node', [resolve(ROOT, 'scripts', 'field', 'stub-model.mjs')], {
    env: { ...process.env, PLATO_STUB_PORT: PORT },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = await new Promise((ok) => {
    const timer = setTimeout(() => ok(false), 10000);
    stub.stdout.on('data', (b) => {
      if (String(b).includes('listening')) {
        clearTimeout(timer);
        ok(true);
      }
    });
  });
  if (!ready) {
    console.error('the scripted model never started');
    stub.kill();
    process.exit(2);
  }
}

say(`runs dir: ${runsDirFor(DEMO_REPO)}`);

let code = 1;
try {
  const { ExTester } = await import('vscode-extension-tester');
  const tester = new ExTester(STORAGE);
  await tester.downloadCode(VSCODE_VERSION);
  await tester.downloadChromeDriver(VSCODE_VERSION);
  await tester.installVsix({ vsixFile: packaged.path });
  const spec = REAL ? 'field.real.test.mjs' : 'field.test.mjs';
  const settings = REAL ? 'settings.real.json' : 'settings.json';
  code = await tester.runTests(resolve(ROOT, 'scripts', 'field', spec), {
    vscodeVersion: VSCODE_VERSION,
    resources: [DEMO_REPO],
    settings: resolve(ROOT, 'scripts', 'field', settings),
  });
} finally {
  stub?.kill();
  // D49av: case 11 writes a probe file into the workspace. It must not linger:
  // `git diff --stat` below shows TRACKED changes only, so an untracked leftover
  // is invisible, and the next run would then be writing over its own debris.
  for (const name of SCRATCH_FILES) {
    const p = resolve(DEMO_REPO, name);
    if (existsSync(p)) {
      rmSync(p, { force: true });
      say(`removed the harness's own scratch file ${name}`);
    }
  }
  const diff = sh('git', ['-C', DEMO_REPO, 'diff', '--stat']).stdout.trim();
  say('what the harness changed in the demo repo (nothing is committed or pushed)');
  console.log(diff.length > 0 ? diff : '  (no changes)');
}

process.exit(code);
