import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = '/tmp/plato-render';
if (!existsSync(TMP)) { mkdirSync(TMP, { recursive: true }); }

/**
 * D47j: the real-DOM render harnesses, checked in so they survive a /tmp wipe.
 * `node scripts/render/run.mjs` builds the webview HTML from the compiled
 * output and runs every suite against a headless Chromium. SKIP_BUILD=1 reuses
 * the current bundle, which is the cheap path while iterating on CSS.
 */
function resolvePlaywright() {
  const req = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  for (const c of candidates) {
    try { req.resolve(c); return c; } catch { /* next */ }
  }
  const cached = '/Users/ai/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
  if (existsSync(cached)) { return cached; }
  throw new Error('playwright not found — see scripts/render/README.md');
}

const REPO_ROOT = REPO;
const TMP_DIR = TMP;

/** Build out/webview.js (unless SKIP_BUILD=1) and write the render HTML. */
function prepareHtml() {
  if (process.env['SKIP_BUILD'] !== '1') {
    execFileSync('npx', ['tsc', '-b'], { cwd: REPO, stdio: 'inherit' });
    execFileSync('pnpm', ['run', 'bundle'], {
      cwd: join(REPO, 'packages/vscode'), stdio: 'inherit',
    });
  }
  const out = join(REPO, 'packages/vscode/out/webview.js');
  const html = execFileSync('node', [
    '-e', `import('${out}').then(m=>process.stdout.write(m.chatHtml()))`,
  ], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!html.includes('</html>')) {
    throw new Error('chatHtml() output is truncated — the template literal is broken');
  }
  writeFileSync(join(TMP, 'wv.html'), html);
  return html;
}

export { REPO_ROOT, TMP_DIR, prepareHtml, resolvePlaywright };
export { readFileSync, writeFileSync, join };
