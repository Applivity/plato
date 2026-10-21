import { readFile, writeFile, mkdir } from 'node:fs/promises';
import esbuild from 'esbuild';

const SCRIPT_OPEN = '<script nonce="${nonce}">';
const SCRIPT_CLOSE = '</script>';
const STYLE_OPEN = '<style>';
const STYLE_CLOSE = '</style>';

const MIN_WEBVIEW = 'dist/webview.min.js';

/**
 * The style block is text inside a JS template literal. At runtime the JS
 * engine resolves an escape such as the left-arrow code point before the
 * browser sees CSS. The block is read as raw source text here, so make that
 * same step: CSS reads the sequence as an identity escape and would
 * otherwise paint the literal text "u2190".
 * A backtick or ${ would change what the source means, so both fail loudly.
 */
function decodeTemplateBody(body) {
  if (body.includes('`') || body.includes('${')) {
    throw new Error('esbuild: style block has ` or ${; decode it by hand');
  }
  return Function('"use strict";return `' + body + '`;')();
}

/** Minify one block of an HTML template literal and return it as a constant. */
async function minifyBlock(src, open, close, loader, name, decode = false) {
  const start = src.indexOf(open);
  if (start < 0) throw new Error(`esbuild: webview has no '${open}'`);
  const bodyStart = start + open.length;
  const end = src.indexOf(close, bodyStart);
  if (end < 0) throw new Error(`esbuild: webview has no '${close}' after '${open}'`);
  const raw = src.slice(bodyStart, end);
  const body = decode ? decodeTemplateBody(raw) : raw;

  const out = await esbuild.transform(body, { loader, minify: true, charset: 'utf8' });

  // The body goes back as an interpolation, never as literal template text, so
  // a backtick or ${ in the minified output cannot break the enclosing template.
  const decl = `const ${name} = ${JSON.stringify(out.code)};\n`;
  const next =
    src.slice(0, start) + open + '${' + name + '}' + close + src.slice(end + close.length);
  return { src: next, decl };
}

/** Insert declarations after the "use strict" directive, which must stay first. */
function insertDecls(src, decls) {
  const m = /^("use strict";?[ \t]*\r?\n)/.exec(src);
  return m ? m[1] + decls + src.slice(m[1].length) : decls + src;
}

/**
 * The whole UI ships as one HTML template literal inside webview.js, which
 * esbuild cannot reach into. This plugin minifies the inline style and script,
 * and writes the transformed module to dist/webview.min.js — the path
 * scripts/render loads, so the render suites exercise the bytes that ship.
 * If the webview is ever restructured so these blocks are missing, the build
 * fails loudly instead of silently shipping readable source.
 */
const minifyWebview = {
  name: 'minify-webview',
  setup(build) {
    build.onLoad({ filter: /(^|[\\/])webview\.js$/ }, async (args) => {
      const start = await readFile(args.path, 'utf8');
      const css = await minifyBlock(start, STYLE_OPEN, STYLE_CLOSE, 'css', '__PLATO_CSS__', true);
      const js = await minifyBlock(css.src, SCRIPT_OPEN, SCRIPT_CLOSE, 'js', '__PLATO_JS__');
      const contents = insertDecls(js.src, css.decl + js.decl);
      await mkdir('dist', { recursive: true });
      await writeFile(MIN_WEBVIEW, contents);
      return { contents, loader: 'js' };
    });
  },
};

// minify: no source, no maps and no readable identifiers in the shipped bundle.
// The map stays on disk for local debugging and is excluded by .vscodeignore.
await esbuild.build({
  entryPoints: ['out/extension.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  minify: true,
  plugins: [minifyWebview],
});
