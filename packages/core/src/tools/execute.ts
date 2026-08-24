/**
 * M1 tool executor. Runs one validated, already-approved tool call
 * against the workspace and returns plain-text output for the model.
 * Security: secretRefusal() runs before this; read paths still get a
 * final isSecretPath check here (defense in depth).
 */
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
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

async function readFileTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const rel = argPath(args);
  if (rel.length === 0) return fail('missing path');
  if (isSecretPath(rel)) return fail('protected file');
  try {
    const text = await readFile(join(root, rel), 'utf8');
    return { ok: true, output: text.slice(0, 60_000) };
  } catch {
    return fail(`cannot read: ${rel}`);
  }
}

async function writeFileTool(root: string, args: ToolArgs): Promise<ToolOutcome> {
  const rel = argPath(args);
  const content = args['content'];
  if (rel.length === 0 || typeof content !== 'string') {
    return fail('missing path or content');
  }
  if (isSecretPath(rel)) return fail('protected file');
  const abs = join(root, rel);
  try {
    await stat(abs);
    return fail('file exists; use apply_diff to edit it');
  } catch {
    // not existing is the expected create path
  }
  try {
    await writeFile(abs, content, 'utf8');
    return { ok: true, output: `created ${rel}` };
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
