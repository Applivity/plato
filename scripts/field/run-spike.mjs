/**
 * Spike launcher. Mirrors the shape the real runner will have:
 *   download a pinned VS Code + matching chromedriver, install the packaged
 *   extension into that instance, then drive it with mocha over WebDriver.
 *
 * VS Code is pinned to the version the founder runs day to day, so the harness
 * tests the same build he uses rather than whatever "latest" is that week.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { ExTester } from 'vscode-extension-tester';

/**
 * Strip the environment that belongs to the editor we were LAUNCHED from.
 *
 * If this harness is started from inside VS Code (its own extension host, a
 * task, or an integrated terminal) the child environment carries
 * `ELECTRON_RUN_AS_NODE=1`. That variable makes ANY Electron binary start as
 * plain Node — so the VS Code under test boots as a Node process, rejects
 * ChromeDriver's switches as "bad option", and dies with the single most
 * misleading error in this whole stack: `session not created: Chrome instance
 * exited`. The same leak points the launched instance at the running editor's
 * IPC socket. Both are the harness's own bug, not a fault in VS Code.
 */
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const STORAGE = resolve(ROOT, 'tmp', 'field', 'storage');
const VSIX = resolve(ROOT, 'packages', 'vscode', 'plato-vscode-0.25.0.vsix');
const WORKSPACE = '/Users/ai/Desktop/HcadPublicAndroid-demo';
const VSCODE_VERSION = '1.136.0';

if (!existsSync(VSIX)) {
  console.error(`no packaged extension at ${VSIX} — run: cd packages/vscode && pnpm run package`);
  process.exit(2);
}

const tester = new ExTester(STORAGE);
await tester.downloadCode(VSCODE_VERSION);
await tester.downloadChromeDriver(VSCODE_VERSION);
await tester.installVsix({ vsixFile: VSIX });

const code = await tester.runTests(resolve(ROOT, 'scripts', 'field', 'spike.test.mjs'), {
  vscodeVersion: VSCODE_VERSION,
  resources: [WORKSPACE],
  settings: resolve(ROOT, 'scripts', 'field', 'settings.json'),
});

process.exit(code);
