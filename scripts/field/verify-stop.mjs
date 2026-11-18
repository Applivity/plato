/**
 * The words and the key — a real-window check of pause, Stop and Esc.
 *
 * This is a focused companion to `run-field.mjs`, not a replacement for it. It
 * installs the ALREADY PACKAGED 0.31.0 vsix (it does not build), uses a
 * throwaway workspace and a throwaway Plato home, and drives only what this
 * round changed:
 *   - the run-stop control reads Stop, and both tooltips are the terminal's
 *     sentences word for word;
 *   - a paused run says so in the run area, stops the busy dot, and a pause
 *     does not survive closing the window;
 *   - Esc pauses, and a second Esc within 1.5 s stops;
 *   - a paused run resumes and finishes without repeating a tool call, and a
 *     stopped run keeps the conversation.
 *
 * The package is checked against the hash recorded in the artefact report
 * before anything is installed: a window test of a different binary would be
 * worth nothing.
 *
 * Usage:
 *   node scripts/field/verify-stop.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

const ROOT = resolve(import.meta.dirname, '..', '..');
process.chdir(ROOT);

const VSCODE_VERSION = '1.136.0';
const PORT = '4703';
const STUB = `http://127.0.0.1:${PORT}`;

const VSIX = resolve(ROOT, 'packages', 'vscode', 'plato-0.31.0.vsix');
const EXPECTED_SHA =
  '71a65b01e809ef0513c5ff1f70d96bafd183167af7340e33b1ac214d08310e6b';

try {
  await import('vscode-extension-tester');
} catch {
  console.error(
    '\nThe harness dependencies are not installed.\n\n' +
      '  cd scripts/field && pnpm install --ignore-workspace\n',
  );
  process.exit(2);
}

const digest = createHash('sha256').update(readFileSync(VSIX)).digest('hex');
if (digest !== EXPECTED_SHA) {
  console.error(`refusing to test a different package:\n  ${VSIX}\n  sha256 ${digest}`);
  process.exit(2);
}

// Everything this check writes lives under tmp/ or a system temp folder.
const STORAGE = resolve(ROOT, 'tmp', 'field', 'storage-stop');
const SHOTS = resolve(ROOT, 'tmp', 'field', 'shots-stop');
const HOME = mkdtempSync(join(tmpdir(), 'plato-stop-home-'));
const WS = mkdtempSync(join(tmpdir(), 'plato-stop-ws-'));

/**
 * A previous harness window makes the quick input half-live: the palette is on
 * screen but the old renderer owns focus, so a typed key raises
 * ElementNotInteractableError and the case fails for a reason that has nothing
 * to do with Plato. The harness's own profile and extracted VS Code are named
 * by path, so the founder's everyday VS Code (a different --user-data-dir) is
 * never mistaken for a leftover.
 */
function liveHarnessProcesses() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'storage-stop|extest-code' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
        { encoding: 'utf8' },
      ).trim();
      if (out.length === 0) return [];
      const rows = JSON.parse(out);
      return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
        pid: r.ProcessId,
        command: String(r.CommandLine ?? ''),
      }));
    } catch {
      return [];
    }
  }
  try {
    return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
      .filter((m) => m !== null && /storage-stop|extest-code/.test(m[2]))
      .map((m) => ({ pid: Number(m[1]), command: m[2] }));
  } catch {
    return [];
  }
}

/**
 * ExTester closes the driver before Code's helper processes finish exiting.
 * Back-to-back runs then find the profile still held, which is the state the
 * pre-check refuses. Wait for our own shutdown instead of blaming the next run.
 */
async function waitHarnessExit(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let left = liveHarnessProcesses();
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    left = liveHarnessProcesses();
  }
  return left;
}

const leftovers = liveHarnessProcesses();
if (leftovers.length > 0) {
  console.error(
    `\nA previous test window is still alive (${leftovers.length} process(es) using this harness):\n` +
      leftovers.slice(0, 8).map((p) => `  ${p.pid}  ${p.command.slice(0, 160)}`).join('\n') +
      (leftovers.length > 8 ? `\n  … and ${leftovers.length - 8} more` : '') +
      '\n\nClose the old window and wait for these processes to exit, then run again.\n' +
      'The quick input cannot become interactable while an old renderer shares this profile.\n',
  );
  process.exit(2);
}

const PLATO_HOME = join(HOME, '.plato');
mkdirSync(PLATO_HOME, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
process.env['PLATO_HOME'] = PLATO_HOME;

writeFileSync(join(WS, 'notes.txt'), 'notes from the workspace\n', 'utf8');
writeFileSync(join(WS, 'notes2.txt'), 'notes too\n', 'utf8');

const key = createHash('sha1').update(WS).digest('hex').slice(0, 8);
const RUNS_DIR = join(PLATO_HOME, 'runs', key);
mkdirSync(RUNS_DIR, { recursive: true });

const settings = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'field', 'settings.json'), 'utf8'),
);
settings['plato.connections'][0].baseUrl = `${STUB}/v1`;
settings['plato.connections'][0].models = ['stub-model'];
settings['plato.model'] = 'stub:stub-model';
// No stored pool: the first run fetches the list, which is the ordinary path.
delete settings['plato.connections'][0].pool;
delete settings['plato.connections'][0].pooledAt;
const SETTINGS = resolve(ROOT, 'tmp', 'field', 'settings-stop.json');
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

const stub = spawn(
  process.execPath,
  [resolve(ROOT, 'scripts', 'field', 'stub-model.mjs')],
  {
    env: {
      ...process.env,
      PLATO_STUB_PORT: PORT,
      PLATO_STUB_MODELS: 'stub-model',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
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

console.log(`\n== package  ${VSIX}`);
console.log(`   sha256   ${digest}`);
console.log(`   home     ${PLATO_HOME}`);
console.log(`   workspace ${WS}`);

process.env['PLATO_VERIFY_STUB'] = STUB;
process.env['PLATO_VERIFY_RUNS_DIR'] = RUNS_DIR;
process.env['PLATO_VERIFY_SHOTS'] = SHOTS;
process.env['PLATO_VERIFY_WS'] = WS;

let code = 1;
try {
  const { ExTester } = await import('vscode-extension-tester');
  // The third argument is the harness's OWN extensions folder. Without it the
  // test window loads whatever is installed in ~/.vscode/extensions — in this
  // case Claude Code, whose tab can take the active editor group and leave a
  // later case typing into a frame with no composer.
  const tester = new ExTester(STORAGE, undefined, join(STORAGE, 'extensions'));
  await tester.downloadCode(VSCODE_VERSION);
  await tester.downloadChromeDriver(VSCODE_VERSION);
  await tester.installVsix({ vsixFile: VSIX });
  code = await tester.runTests(
    resolve(ROOT, 'scripts', 'field', 'verify-stop.test.mjs'),
    {
      vscodeVersion: VSCODE_VERSION,
      resources: [WS],
      settings: SETTINGS,
    },
  );
} finally {
  stub.kill();
  const stillAlive = await waitHarnessExit();
  if (stillAlive.length > 0) {
    console.error(
      `\nNote: ${stillAlive.length} harness process(es) were still exiting after 20 s:\n` +
        stillAlive.slice(0, 5).map((p) => `  ${p.pid}  ${p.command.slice(0, 120)}`).join('\n') +
        '\nThe next run will refuse to start until they are gone.\n',
    );
  }
  for (const dir of [HOME, WS]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(code);
