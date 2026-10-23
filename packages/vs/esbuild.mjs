import esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shim = join(here, 'host/shim/vscode.ts');

/**
 * M1: bundle the EXISTING VS Code host with `vscode` replaced by the shim.
 * The extension source is not changed. The compiled `out/` files are used so
 * esbuild sees the same CommonJS the VS Code VSIX ships.
 */
await esbuild.build({
  entryPoints: [join(here, 'host/entry.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(here, 'dist/plato-host.cjs'),
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'vscode-shim',
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: shim }));
      },
    },
  ],
});
