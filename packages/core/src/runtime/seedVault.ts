/**
 * D49bc: fill the session's secret map from the workspace, at run start.
 *
 * The hole this closes is D49bb's largest one, and it is easiest to state as the
 * command that finds it:
 *
 *     cat *.properties
 *
 * The scrub hides a value the session has SEEN. In `auto` — where `shell` runs
 * unasked, and the name check is the only guard — a command can reach a
 * protected file indirectly, so the value arrives in a tool result that nothing
 * knows to hide. The name check cannot see it either: `*.properties` is not
 * `local.properties`, so the token scan passes. The value was never read through
 * `read_file`, so the map has never held it.
 *
 * Reading the workspace's protected text files through the SAME masker at run
 * start closes the class rather than the example: from then on, any tool result
 * carrying one of those values comes back as its placeholder, whatever route it
 * took.
 *
 * **What it does NOT close, stated rather than implied: `cat ~/.aws/credentials`.**
 * That file is outside the workspace, so Plato cannot pre-read it, and
 * containment deliberately does not cover `shell`. `auto` plus arbitrary
 * commands stays best-effort for anything outside the project.
 *
 * It reads the user's secrets into memory at every run start, and that is the
 * cost that was weighed: never to disk, never to a model, and the map dies with
 * the session. A file the masker cannot account for is skipped rather than
 * guessed at, so nothing here can leak a line the masker would have refused.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSecretPath } from '../security/secrets.js';
import { isPlainText, maskText, type SecretVault } from '../security/mask.js';
import { listWorkspaceFiles } from '../tools/files.js';

export interface SeedResult {
  /** Protected files read, that held at least one value worth hiding. */
  files: number;
  /** Values the map did not already hold. */
  values: number;
}

/**
 * Best-effort by design: an unreadable file, an opaque file and a file the
 * masker cannot account for are all skipped. A missing guard is a bug; a run
 * that dies at its start because one file could not be read is a worse one.
 */
export async function seedVault(root: string, vault: SecretVault): Promise<SeedResult> {
  const before = vault.size();
  let files = 0;
  for (const rel of listWorkspaceFiles(root, '', { includeSecret: true })) {
    if (!isSecretPath(rel)) continue;
    let buf: Buffer;
    try {
      buf = await readFile(join(root, rel));
    } catch {
      continue;
    }
    if (!isPlainText(buf)) continue;
    const masked = maskText(buf.toString('utf8'));
    if (masked === null || masked.pairs.length === 0) continue;
    vault.remember(masked.pairs);
    files += 1;
  }
  return { files, values: vault.size() - before };
}
