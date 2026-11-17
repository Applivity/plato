import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from './paths.js';

/**
 * The user's editor, on the composer's draft (Ctrl+G, round 2).
 *
 * `$VISUAL` wins over `$EDITOR`, and `vi` is the last resort, as a shell does.
 * The command may carry arguments (`code -w`), so it is split here instead of
 * handed to a shell: a missing program must produce our one sentence, not the
 * shell's own message.
 */
export function resolveEditor(env: Env = process.env): string {
  const visual = env['VISUAL']?.trim();
  if (visual !== undefined && visual.length > 0) {
    return visual;
  }
  const editor = env['EDITOR']?.trim();
  if (editor !== undefined && editor.length > 0) {
    return editor;
  }
  return 'vi';
}

/** Words, with single and double quotes kept together and removed. */
export function splitCommand(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        words.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) {
    words.push(current);
  }
  return words;
}

export interface EditorOutcome {
  /** The edited draft, when the editor exited cleanly. */
  text?: string;
  /** One sentence for the user when it did not. */
  error?: string;
}

/** An editor adds a final newline; the composer's draft does not carry it. */
function draftText(text: string): string {
  const normalised = text.replace(/\r\n?/g, '\n');
  return normalised.endsWith('\n') ? normalised.slice(0, -1) : normalised;
}

export async function runEditor(
  draft: string,
  options: { env?: Env; spawnImpl?: typeof spawn } = {},
): Promise<EditorOutcome> {
  const env = options.env ?? process.env;
  const words = splitCommand(resolveEditor(env));
  const program = words[0];
  if (program === undefined) {
    return { error: 'No editor is configured; your draft is unchanged.' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'plato-edit-'));
  const file = join(dir, 'draft.md');
  try {
    writeFileSync(file, draft, { mode: 0o600 });
    const result = await new Promise<{ failed: boolean; code: number | null }>((resolve) => {
      const launch = options.spawnImpl ?? spawn;
      const child = launch(program, [...words.slice(1), file], {
        stdio: 'inherit',
        env: env as NodeJS.ProcessEnv,
      });
      child.once('error', () => resolve({ failed: true, code: null }));
      child.once('close', (code) => resolve({ failed: false, code }));
    });
    if (result.failed) {
      return { error: `Could not start ${program}; your draft is unchanged.` };
    }
    if (result.code !== 0) {
      return {
        error: `The editor (${program}) exited with code ${result.code ?? 'unknown'}; your draft is unchanged.`,
      };
    }
    try {
      return { text: draftText(readFileSync(file, 'utf8')) };
    } catch {
      return { error: `Could not read the edited draft; your draft is unchanged.` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
