// D37 packaging gate (matches the PROGRESS.md convention): extract the
// inline webview script and verify it parses with `node --check`. This
// catches script-level breakage that bundlers miss because the script
// is a string literal in the bundle, not a parsed module.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist', 'extension.js');
const src = fs.readFileSync(dist, 'utf8');
// Find the FIRST inline webview script (chatHtml). The bundle may
// contain other scripts (e.g. CSP-emitted); the chat one is what ships
// to the user.
const m = src.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('no inline chat script found in', dist);
  process.exit(1);
}
const out = path.join(__dirname, '..', '..', '..', 'tmp', 'plato-inline.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, m[1]);
console.log('wrote', m[1].length, 'bytes to', out);
