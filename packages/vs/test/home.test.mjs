/**
 * D49cd: where the extension keeps Plato's home.
 *
 * A field run seeded `~/.plato/mcp.json` and a crash left a fake MCP server in
 * the founder's own settings. The fix is one resolver: `PLATO_HOME` names the
 * `.plato` directory (the variable the CLI already honours), and unset or empty
 * means `homedir()/.plato` exactly as before. This is the unit half; the field
 * half proves a real run writes only to the temp home.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { resolvePlatoHome } = require('../../vscode/out/home.js');

// Default: unchanged, on any platform, because the caller passes both parts.
assert.equal(
  resolvePlatoHome({}, '/home/founder'),
  '/home/founder/.plato',
  'with no PLATO_HOME the home is homedir()/.plato',
);
assert.equal(
  resolvePlatoHome({ PLATO_HOME: '' }, '/home/founder'),
  '/home/founder/.plato',
  'an empty PLATO_HOME means unset, not an empty path',
);

// Override: the variable names the .plato directory itself, as the CLI reads it.
assert.equal(
  resolvePlatoHome({ PLATO_HOME: '/tmp/plato-field/.plato' }, '/home/founder'),
  '/tmp/plato-field/.plato',
  'PLATO_HOME replaces the whole home directory',
);

// The real process environment is the default argument.
const saved = process.env['PLATO_HOME'];
try {
  process.env['PLATO_HOME'] = '/tmp/from-env/.plato';
  assert.equal(resolvePlatoHome(), '/tmp/from-env/.plato', 'the process env is read by default');
  delete process.env['PLATO_HOME'];
  assert.equal(
    resolvePlatoHome(),
    join(homedir(), '.plato'),
    'unsetting the variable restores the default',
  );
} finally {
  if (saved === undefined) delete process.env['PLATO_HOME'];
  else process.env['PLATO_HOME'] = saved;
}

console.log('PASS home resolution: PLATO_HOME overrides, unset keeps ~/.plato');
