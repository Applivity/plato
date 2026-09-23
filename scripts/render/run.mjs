#!/usr/bin/env node
/**
 * D47j: the real-DOM render suites for the Settings page.
 *
 *   node scripts/render/run.mjs                 build, then run every suite
 *   SKIP_BUILD=1 node scripts/render/run.mjs    reuse the current bundle
 *
 * Why these exist: `tsc` and the unit tests cannot see the rendered page. Every
 * defect below shipped through a green build and was found by the founder in a
 * screenshot instead:
 *   - a fixed grid that gave each mode card 67px of text;
 *   - a Role textarea whose fixed min-height hid 2.5 lines at a narrow width;
 *   - `.btn-danger` sized for an icon but used for a "Delete" text label, so it
 *     wrapped to "Del/ete" at every width;
 *   - `.btn-icon-danger` in the CSS vs `.btn-danger` emitted by code, so the
 *     button had no rule and the browser painted its default white button;
 *   - an exception inside showSettings ("new child contains the parent") that
 *     silently ABORTED the rest of the render, killing the Context section.
 *
 * Two rules keep this honest:
 *   1. Every suite fails on ANY uncaught page error (see plib.mjs).
 *   2. Assertions check for the presence of a requirement, not the absence of a
 *      symptom. "No overflow" passes three 67px columns; "each mode card keeps a
 *      usable width" does not.
 *
 * Each suite runs in its own process, so one crash cannot mask the others.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareHtml } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ['providers', 'modelsync', 'core', 'panels', 'narrow', 'history', 'stream', 'attach', 'approval', 'modellist', 'runstatus', 'question'];

// Build once here rather than once per suite. PLATO_RENDER_PREPARED tells each
// child that wv.html is already current, so plib skips its own prepareHtml().
prepareHtml();
const CHILD_ENV = { ...process.env, PLATO_RENDER_PREPARED: '1' };

let failed = 0;
for (const s of SUITES) {
  process.stdout.write('\n=== ' + s + ' ===\n');
  const r = spawnSync('node', [join(HERE, s + '.mjs')], {
    stdio: 'inherit', cwd: join(HERE, '..', '..'), env: CHILD_ENV,
  });
  if (r.status !== 0) { failed++; }
}
console.log('\n' + (failed === 0
  ? 'ALL RENDER SUITES PASS'
  : failed + ' RENDER SUITE(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
