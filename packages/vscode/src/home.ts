/**
 * D49cd: Plato's own home folder, and the one override a test may use.
 *
 * `PLATO_HOME` names the `.plato` directory itself, the same variable the CLI
 * already honours (`packages/cli/src/paths.ts`). It exists so a harness can
 * point a whole run at a temp home and never write into the real one — a
 * field run seeded `~/.plato/mcp.json` and a crash left a fake MCP server in
 * the founder's own Plato settings. The default is unchanged when the variable
 * is unset or empty.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolvePlatoHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env['PLATO_HOME'];
  return override !== undefined && override.length > 0 ? override : join(home, '.plato');
}
