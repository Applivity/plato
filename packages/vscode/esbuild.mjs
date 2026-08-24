import esbuild from 'esbuild';

// Bundles the compiled extension (including workspace core) into one file
// so `vsce --no-dependencies` produces an installable VSIX.
await esbuild.build({
  entryPoints: ['out/extension.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
});
