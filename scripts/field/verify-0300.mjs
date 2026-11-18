/**
 * 0.30.0 window check — the context window a connection advertises, in a real
 * VS Code window.
 *
 * This is a focused companion to `run-field.mjs`, not a replacement for it. It
 * installs the ALREADY PACKAGED 0.30.0 vsix (it does not build), uses a
 * throwaway workspace and a throwaway Plato home, and drives only what this
 * release changed. The scripted model answers, so nothing here needs a provider
 * key and nothing leaves this machine.
 *
 * The package is checked against the hash recorded in the artefact report
 * before anything is installed: a window test of a different binary would be
 * worth nothing.
 *
 * The stub serves two models from one endpoint:
 *   - `deepseek-chat` advertises DeepSeek's own spelling, `context_window`, and
 *     no `context_length` at all;
 *   - `quiet-model` advertises no window, so Plato must use its fallback.
 *
 * Usage:
 *   node scripts/field/verify-0300.mjs
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
const PORT = '4702';
const STUB = `http://127.0.0.1:${PORT}`;

const VSIX = resolve(ROOT, 'packages', 'vscode', 'plato-0.30.0.vsix');
const EXPECTED_SHA =
  '574f100d5b35765ae3a51baea094942b50ca07fd49476521031cd39a808c9adc';

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
const STORAGE = resolve(ROOT, 'tmp', 'field', 'storage-0300');
const SHOTS = resolve(ROOT, 'tmp', 'field', 'shots-0300');
const HOME = mkdtempSync(join(tmpdir(), 'plato-0300-home-'));
const WS = mkdtempSync(join(tmpdir(), 'plato-0300-ws-'));

const PLATO_HOME = join(HOME, '.plato');
mkdirSync(PLATO_HOME, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
process.env['PLATO_HOME'] = PLATO_HOME;

writeFileSync(join(WS, 'notes.txt'), 'notes from the workspace\n', 'utf8');

const key = createHash('sha1').update(WS).digest('hex').slice(0, 8);
const RUNS_DIR = join(PLATO_HOME, 'runs', key);
mkdirSync(RUNS_DIR, { recursive: true });

const settings = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'field', 'settings.json'), 'utf8'),
);
settings['plato.connections'][0].baseUrl = `${STUB}/v1`;
settings['plato.connections'][0].models = ['deepseek-chat', 'quiet-model'];
settings['plato.model'] = 'stub:deepseek-chat';
// The shape 0.29.0 left behind: a pool fetched minutes ago with no window on
// either model (0.29's reader ignored `context_window`). The same rule the
// CLI's cache uses makes it stale, so 0.30.0 must refresh it once and use what
// it fetched on the FIRST run — not up to 24 hours later.
settings['plato.connections'][0].pool = [
  { id: 'deepseek-chat' },
  { id: 'quiet-model' },
];
settings['plato.connections'][0].pooledAt = Date.now();
const SETTINGS = resolve(ROOT, 'tmp', 'field', 'settings-0300.json');
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

const stub = spawn(
  process.execPath,
  [resolve(ROOT, 'scripts', 'field', 'stub-model.mjs')],
  {
    env: {
      ...process.env,
      PLATO_STUB_PORT: PORT,
      PLATO_STUB_MODELS: 'deepseek-chat,quiet-model',
      // DeepSeek's own spelling, and only the DeepSeek-shaped model carries it.
      PLATO_STUB_CONTEXT: '1048576',
      PLATO_STUB_CONTEXT_FIELD: 'context_window',
      PLATO_STUB_CONTEXT_MODEL: 'deepseek-chat',
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
  const tester = new ExTester(STORAGE);
  await tester.downloadCode(VSCODE_VERSION);
  await tester.downloadChromeDriver(VSCODE_VERSION);
  await tester.installVsix({ vsixFile: VSIX });
  code = await tester.runTests(
    resolve(ROOT, 'scripts', 'field', 'verify-0300.test.mjs'),
    {
      vscodeVersion: VSCODE_VERSION,
      resources: [WS],
      settings: SETTINGS,
    },
  );
} finally {
  stub.kill();
  for (const dir of [HOME, WS]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(code);
