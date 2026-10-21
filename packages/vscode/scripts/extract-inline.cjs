// D37 packaging gate (matches the PROGRESS.md convention): extract the
// inline webview script and verify it parses with `node --check`. This
// catches script-level breakage that bundlers miss because the script
// is a string literal in the bundle, not a parsed module.
//
// Read it from the built module rather than scraping dist/extension.js: the
// bundle is minified (D49bu), so its template literal is compiled to string
// concatenation and the rendered script no longer appears as contiguous text.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const built = path.join(__dirname, '..', 'dist', 'webview.min.js');
if (!fs.existsSync(built)) {
  console.error('missing', built, '— run `pnpm run bundle` first');
  process.exit(1);
}

import(pathToFileURL(built).href).then((m) => {
  const html = m.chatHtml();
  // The chat page carries one script; any other is emitted by the host, not
  // the page, and is not what this gate is about.
  const found = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  if (!found) {
    console.error('no inline chat script found in', built);
    process.exit(1);
  }
  const out = path.join(__dirname, '..', '..', '..', 'tmp', 'plato-inline.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, found[1]);
  console.log('wrote', found[1].length, 'bytes to', out);
});
