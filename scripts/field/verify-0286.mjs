/**
 * 0.28.6 window check — History and its layout, in a real VS Code window.
 *
 * This is a focused companion to `run-field.mjs`, not a replacement for it. It
 * installs the ALREADY PACKAGED 0.28.6 vsix (it does not build), uses a
 * throwaway workspace and a throwaway Plato home, and drives only the History
 * work this release changed. The scripted model answers, so nothing here needs
 * a provider key or the network.
 *
 * The package is checked against the hash recorded in the artifacts ledger
 * before anything is installed: a window test of a different binary would be
 * worth nothing.
 *
 * Usage:
 *   node scripts/field/verify-0286.mjs
 */
import { spawn } from 'node:child_process';
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
const PORT = '4699';
const STUB = `http://127.0.0.1:${PORT}`;

const VSIX = resolve(ROOT, 'packages', 'vscode', 'plato-0.28.6.vsix');
const EXPECTED_SHA =
  '3a6653bf427175845a4eda3f96f2b1e4b8abed3df4f35c7f5b1fa0b20e812998';

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
const STORAGE = resolve(ROOT, 'tmp', 'field', 'storage-0286');
const SHOTS = resolve(ROOT, 'tmp', 'field', 'shots-0286');
const HOME = mkdtempSync(join(tmpdir(), 'plato-0286-home-'));
const WS = mkdtempSync(join(tmpdir(), 'plato-0286-ws-'));
const IMG_DIR = mkdtempSync(join(tmpdir(), 'plato-0286-img-'));

const PLATO_HOME = join(HOME, '.plato');
mkdirSync(PLATO_HOME, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
process.env['PLATO_HOME'] = PLATO_HOME;

// A workspace with one ordinary file, and an image well outside it.
writeFileSync(join(WS, 'readme.txt'), 'a workspace about history\n', 'utf8');
const IMG = join(IMG_DIR, 'outside-shot.png');
writeFileSync(
  IMG,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
      '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const key = createHash('sha1').update(WS).digest('hex').slice(0, 8);
const RUNS_DIR = join(PLATO_HOME, 'runs', key);
mkdirSync(RUNS_DIR, { recursive: true });

const settings = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'field', 'settings.json'), 'utf8'),
);
settings['plato.connections'][0].baseUrl = `${STUB}/v1`;
// The founder's attachment check needs the real picker. VS Code's SIMPLE file
// dialog draws in the workbench (a quick input) instead of opening a native
// macOS panel, so the harness can type a path into it; the products' code path
// is the same `showOpenDialog`.
settings['files.simpleDialog.enable'] = true;
const SETTINGS = resolve(ROOT, 'tmp', 'field', 'settings-0286.json');
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

const stub = spawn(
  process.execPath,
  [resolve(ROOT, 'scripts', 'field', 'stub-model.mjs')],
  {
    env: { ...process.env, PLATO_STUB_PORT: PORT },
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
console.log(`   image     ${IMG}`);

process.env['PLATO_VERIFY_STUB'] = STUB;
process.env['PLATO_VERIFY_IMG'] = IMG;
process.env['PLATO_VERIFY_RUNS_DIR'] = RUNS_DIR;
process.env['PLATO_VERIFY_SHOTS'] = SHOTS;
process.env['PLATO_VERIFY_WS'] = WS;

let code = 1;
try {
  const { ExTester } = await import('vscode-extension-tester');
  const tester = new ExTester(STORAGE);
  await tester.downloadCode(VSCODE_VERSION);
  await tester.downloadChromeDriver(VSCODE_VERSION);
  await tester.installVsix({ vsixFile: VSIX });
  code = await tester.runTests(
    resolve(ROOT, 'scripts', 'field', 'verify-0286.test.mjs'),
    {
      vscodeVersion: VSCODE_VERSION,
      resources: [WS],
      settings: SETTINGS,
    },
  );
} finally {
  stub.kill();
  for (const dir of [HOME, WS, IMG_DIR]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(code);
