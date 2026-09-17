/**
 * M1 tool executor. Runs one validated, already-approved tool call
 * against the workspace and returns plain-text output for the model.
 * Security: secretRefusal() runs before this; read paths still get a
 * final isSecretPath check here (defense in depth).
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSecretPath } from '../security/secrets.js';
import { listWorkspaceFiles } from './files.js';
import { applyBlocks } from './diff.js';
import type { DiffBlock } from './diff.js';

export interface ToolOutcome {
  ok: boolean;
  output: string;
}

export type ToolArgs = Record<string, unknown>;

function fail(output: string): ToolOutcome {
  return { ok: false, output };
}

export async function executeTool(
  root: string,
  name: string,
  args: ToolArgs,
): Promise<ToolOutcome> {
  switch (name) {
    case 'read_file':
      return readFileTool(root, args);
    case 'write_file':
      return writeFileTool(root, args);
    case 'apply_diff':
      return applyDiffTool(root, args);
    case 'shell':
      return shellTool(root, args);
    case 'list_dir':
      return listDirTool(root);
    case 'grep':
      return grepTool(root, args);
    case 'git':
      return gitTool(root, args);
    default:
      return fail(`unknown tool: ${name}`);
  }
}

function argPath(args: ToolArgs): string {
  const p = args['path'];
  return typeof p === 'string' ? p : '';
}

/**
 * A read window is bounded by BOTH a line budget and a char budget. Lines alone
 * are not a size limit — one minified line can be megabytes — and chars alone
 * cannot be paged by the caller. D49c.
 */
const READ_MAX_CHARS = 60_000;
const READ_MAX_LINES = 1_500;

function readInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
}

async function readFileTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const rel = argPath(args);
  if (rel.length === 0) return fail('missing path');
  if (isSecretPath(rel)) return fail('protected file');
  let text: string;
  try {
    text = await readFile(join(root, rel), 'utf8');
  } catch {
    return fail(`cannot read: ${rel}`);
  }

  // D49c: before this, a file over 60,000 chars was cut silently with no way to
  // continue — the model could not read it at all. Now the window is explicit
  // and the output says which lines it covers.
  const lines = text.split('\n');
  // wc -l semantics: a trailing newline TERMINATES the last line, it does not
  // start an empty one. Without this every count is off by one.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const offset = Math.max(1, readInt(args['offset']) ?? 1);
  const wantLines = Math.max(1, readInt(args['limit']) ?? READ_MAX_LINES);

  if (offset > total) {
    return fail(`offset ${offset} is past the end of ${rel} (${total} lines)`);
  }

  // Fast path: the whole file fits, so return it byte-for-byte. Re-joining a line
  // window would drop a trailing newline, and the model builds apply_diff SEARCH
  // strings from this text — a lost newline becomes a spurious "SEARCH not found".
  if (offset === 1 && wantLines >= total && text.length <= READ_MAX_CHARS) {
    return { ok: true, output: text };
  }

  const out: string[] = [];
  let chars = 0;
  let cutByChars = false;
  for (let i = offset - 1; i < total && out.length < wantLines; i++) {
    const line = lines[i] ?? '';
    const cost = line.length + 1;
    if (chars + cost > READ_MAX_CHARS) {
      if (out.length === 0) {
        // A single line longer than the whole cap. Return its head so the caller
        // gets something usable rather than an empty window.
        out.push(line.slice(0, READ_MAX_CHARS));
        chars = READ_MAX_CHARS;
      }
      cutByChars = true;
      break;
    }
    out.push(line);
    chars += cost;
  }

  const body = out.join('\n');
  const lastLine = offset + out.length - 1;
  if (lastLine >= total && !cutByChars) {
    return { ok: true, output: body };
  }
  const why = cutByChars ? ` and cut at ${READ_MAX_CHARS} chars` : '';
  return {
    ok: true,
    output:
      body +
      `\n\n[truncated: showing lines ${offset}-${lastLine} of ${total}${why}. ` +
      `Pass offset=${lastLine + 1} to continue.]`,
  };
}

async function writeFileTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const rel = argPath(args);
  const content = args['content'];
  if (rel.length === 0 || typeof content !== 'string') {
    return fail('missing path or content');
  }
  if (isSecretPath(rel)) return fail('protected file');
  const abs = join(root, rel);
  const overwrite = args['overwrite'] === true;

  // D49b: an existing EMPTY file is always writable. No other tool could reach
  // one — apply_diff rejects an empty SEARCH (diff.ts) — so an empty file used
  // to be a dead end that forced the model onto `shell`, which plan and edit
  // deny. A NON-empty file still needs an explicit `overwrite: true`, so a full
  // rewrite stays a deliberate act and the approval preview can show the loss.
  let existing: string | null = null;
  try {
    existing = await readFile(abs, 'utf8');
  } catch {
    // not existing is the expected create path
  }
  if (existing !== null && existing.length > 0 && !overwrite) {
    return fail(
      'file has content; use apply_diff for a targeted edit, or pass overwrite: true to replace the whole file',
    );
  }
  try {
    await writeFile(abs, content, 'utf8');
    return { ok: true, output: existing === null ? `created ${rel}` : `overwrote ${rel}` };
  } catch {
    return fail(`cannot write: ${rel}`);
  }
}

async function applyDiffTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const rel = argPath(args);
  if (rel.length === 0) return fail('missing path');
  if (isSecretPath(rel)) return fail('protected file');
  const rawDiffs = args['diffs'];
  if (!Array.isArray(rawDiffs)) return fail('diffs must be an array');
  const blocks: DiffBlock[] = [];
  for (const d of rawDiffs) {
    const rec = d as unknown as Record<string, unknown>;
    if (
      typeof d === 'object' &&
      d !== null &&
      typeof rec['search'] === 'string' &&
      typeof rec['replace'] === 'string'
    ) {
      blocks.push({
        search: rec['search'] as string,
        replace: rec['replace'] as string,
      });
    } else {
      return fail('each diff needs string search and replace');
    }
  }
  let before: string;
  try {
    before = await readFile(join(root, rel), 'utf8');
  } catch {
    return fail(`cannot read: ${rel}`);
  }
  try {
    const { content, applied, noop } = applyBlocks(before, blocks);
    if (applied > 0) {
      await writeFile(join(root, rel), content, 'utf8');
    }
    return {
      ok: true,
      output: `applied ${applied} block(s), no-op ${noop}`,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'apply_diff failed');
  }
}

async function shellTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const cmd = args['command'];
  if (typeof cmd !== 'string' || cmd.trim().length === 0) {
    return fail('missing command');
  }
  if (isSecretPath(cmd)) {
    return fail('command references a protected file');
  }
  return new Promise((resolve) => {
    execFile(
      '/bin/bash',
      ['-c', cmd],
      { cwd: root, timeout: 120_000, maxBuffer: 1_000_000 },
      (err, stdout, stderr) => {
        if (err && stdout.length === 0 && stderr.length === 0) {
          resolve(fail('command failed'));
          return;
        }
        let out = stdout.toString().slice(0, 8000);
        if (stderr.toString().length > 0) {
          out += `\n[stderr]\n${stderr.toString().slice(0, 2000)}`;
        }
        resolve({ ok: err === null, output: out });
      },
    );
  });
}

async function listDirTool(root: string): Promise<ToolOutcome> {
  return { ok: true, output: listWorkspaceFiles(root).join('\n') };
}

async function grepTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const pattern = args['pattern'];
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return fail('missing pattern');
  }
  const hits: string[] = [];
  for (const rel of listWorkspaceFiles(root)) {
    if (hits.length >= 100) break;
    let text: string;
    try {
      text = await readFile(join(root, rel), 'utf8');
    } catch {
      continue; // binary or unreadable
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.includes(pattern)) {
        hits.push(`${rel}:${i + 1}:${lines[i]?.trim().slice(0, 200)}`);
        if (hits.length >= 100) break;
      }
    }
  }
  return { ok: true, output: hits.length > 0 ? hits.join('\n') : 'no matches' };
}

async function gitTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const verb = args['verb'];
  if (verb !== 'status' && verb !== 'diff') {
    return fail('git verb must be status or diff');
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      [verb],
      { cwd: root, timeout: 30_000, maxBuffer: 1_000_000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve(fail(stderr.toString().slice(0, 2000) || 'git failed'));
          return;
        }
        resolve({ ok: true, output: stdout.toString().slice(0, 20_000) });
      },
    );
  });
}
