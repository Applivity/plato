import { chmod } from 'node:fs/promises';
import esbuild from 'esbuild';

/**
 * Ink loads React DevTools only when DEV is set and `react-devtools-core` is
 * installed; it resolves it with `import.meta.resolve` first. The CLI does not
 * ship a devtools client, and a bare static import of an absent package would
 * fail at startup, so the module is stubbed at build time.
 */
const stubDevtools = {
  name: 'stub-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'devtools-stub',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default { initialize() {}, connectToDevTools() {} };',
      loader: 'js',
    }));
  },
};

// One file, no source and no readable identifiers in the shipped bundle. The
// map stays on disk for local debugging and the `files` allowlist keeps it out
// of the tarball. `@napi-rs/keyring` is a native optional dependency and must
// stay external; the CLI runs without it.
await esbuild.build({
  entryPoints: ['out/src/cli.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/cli.js',
  sourcemap: true,
  minify: true,
  banner: {
    js:
      '#!/usr/bin/env node\n' +
      // Ink's dependency tree contains CommonJS modules that call require().
      // A real require in the banner lets esbuild's shim serve them from ESM.
      'import{createRequire as __platoCreateRequire}from"node:module";' +
      'const require=__platoCreateRequire(import.meta.url);',
  },
  external: ['@napi-rs/keyring'],
  plugins: [stubDevtools],
});
await chmod('dist/cli.js', 0o755);
