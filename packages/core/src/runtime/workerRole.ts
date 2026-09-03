/**
 * D45a: three-layer worker prompt join.
 *
 * The worker is one agent with one prompt, regardless of mode. The
 * customisation surface has the same shape in all three modes; only
 * the sources differ.
 *
 *   [mode-specific override] >> [PLATO.md body or shipped default] >> [AGENTS.md body]
 *
 * - Solo/Duo: override slot is empty.
 * - Academy: override slot is `academy.yaml` `workerMember.role` if present.
 * - Philosophers never see any of these files. Their prompt is built in
 *   observer.ts from PERSONAS[].role / academy.yaml member.role only.
 *
 * Files are read from the workspace root, never written. Each layer is
 * hard-capped (DEFAULT_MAX_LAYER_CHARS) to defend against an oversized
 * AGENTS.md blowing up the context. The on-disk PLATO.md is preferred;
 * if missing, the bundled DEFAULT_PLATO_BODY ships as the fallback so
 * the join always has the operator-tuning layer. AGENTS.md (or its
 * CLAUDE.md alias) is optional.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSecretPath } from '../security/secrets.js';

/** Hard cap per layer. 16k chars is ~4-5k tokens — generous for a prompt tier. */
export const DEFAULT_MAX_LAYER_CHARS = 16_000;

/** Truncation marker appended when a layer is too long. */
const TRUNCATED_MARKER = '\n\n[…truncated…]';

/** Trace of where each layer's body came from, for `/system-prompt` later. */
export type LayerSource =
  | { layer: 'override'; chars: number; present: boolean }
  | { layer: 'plato'; chars: number; source: 'disk' | 'fallback'; present: boolean }
  | { layer: 'agents'; chars: number; source: 'disk' | 'fallback' | 'missing'; present: boolean; filename: 'AGENTS.md' | 'CLAUDE.md' | null };

export interface BuildWorkerRoleOpts {
  /** Mode-specific override (Solo/Duo: undefined; Academy: workerMember.role). */
  override?: string;
  /** Workspace root (absolute path). Required for disk reads. */
  root: string;
  /**
   * Master opt-out. When false, the PLATO.md and AGENTS.md layers are
   * dropped entirely (D45a opt-out: `plato.worker.includeProjectRules`).
   * The override layer is never gated.
   */
  includeProjectRules?: boolean;
  /** Override the per-layer cap; tests pass smaller values. */
  maxLayerChars?: number;
}

export interface BuildWorkerRoleResult {
  /** The joined system string. */
  system: string;
  /** Where each layer came from (for the `/system-prompt` trace). */
  layers: LayerSource[];
}


/**
 * Bundled default PLATO.md body. Derived from DECISIONS.md operational
 * rules (D08 modes, D19 safety, D31 budgets, D32 orchestration, D37
 * compaction). Kept short — projects ship their own PLATO.md to extend.
 */
export const DEFAULT_PLATO_BODY =
  'You are Plato, an AI coding agent working inside the user workspace. ' +
  'Operate within the user-selected mode (plan = read-only, edit = write with ' +
  'per-session approval, act = per-action approval, auto = trusted). Use the ' +
  'provided tools to inspect and change files. Prefer apply_diff for edits and ' +
  'write_file only for new files. When you find defects, enumerate them briefly ' +
  'and fix them in the same run — never stop to ask whether to proceed; write ' +
  'approval is enforced by the UI. After applying changes, re-read each changed ' +
  'region and report anything you could not confirm. ' +
  'Never touch secret-bearing files (the host enforces a deny-list) and never ' +
  'ignore errors silently. Stop and summarize once the task is complete. ' +
  'If the context grows large, the loop folds older turns into a running summary ' +
  'automatically, or when the user asks with /compact.';

/** What `loadProjectFile` reports about one read attempt. */
export type LoadResult =
  | { found: true; body: string; source: 'disk' | 'fallback' }
  | { found: false; body: ''; source: 'missing' }
  | { found: false; body: ''; source: 'io'; error: string }
  | { found: false; body: ''; source: 'secret'; error: string }
  | { found: false; body: ''; source: 'too-big'; error: string };


/**
 * Reads a project-context file (PLATO.md / AGENTS.md / CLAUDE.md) from
 * the workspace root. The deny-list is enforced at the *basename* level
 * (isSecretPath), so a hypothetical `keystore.md` would be refused even
 * though the helper would normally not be asked to read it. Errors
 * classify into missing/io/secret/too-big; the caller decides which
 * are fatal.
 *
 * The default `maxBytes` (1 MiB) is a generous read-time safety net.
 * The per-layer prompt-time cap is enforced separately by the join
 * (see `clip`). They are decoupled so a moderately large AGENTS.md is
 * still read in full and then truncated at a sensible boundary, rather
 * than being refused outright.
 */
export const DEFAULT_READ_BYTES = 1_048_576;

export async function loadProjectFile(
  filename: string,
  root: string,
  maxBytes: number = DEFAULT_READ_BYTES,
): Promise<LoadResult> {
  if (isSecretPath(filename)) {
    return { found: false, body: '', source: 'secret', error: `${filename} is on the secret deny-list` };
  }
  const abs = join(root, filename);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { found: false, body: '', source: 'missing' };
    }
    return {
      found: false,
      body: '',
      source: 'io',
      error: e instanceof Error ? e.message : 'read failed',
    };
  }
  if (text.length > maxBytes) {
    return {
      found: false,
      body: '',
      source: 'too-big',
      error: `${filename} is ${text.length} chars; cap is ${maxBytes}`,
    };
  }
  return { found: true, body: text, source: 'disk' };
}

/** Truncate a string to `max` chars at a sensible boundary, with a marker. */
function clip(s: string, max: number): { body: string; truncated: boolean } {
  if (s.length <= max) {
    return { body: s, truncated: false };
  }
  // Cut at the last newline before the cap so we don't slice mid-line.
  let cut = s.slice(0, max);
  const lastNl = cut.lastIndexOf('\n');
  if (lastNl > max - 200) {
    cut = cut.slice(0, lastNl);
  }
  return { body: cut + TRUNCATED_MARKER, truncated: true };
}


/**
 * The three-layer join. Returns the assembled system string and a
 * trace of where each layer's content came from. Always succeeds
 * (synchronous-looking; only the disk reads are async).
 */
export async function buildWorkerRole(
  opts: BuildWorkerRoleOpts,
): Promise<BuildWorkerRoleResult> {
  const cap = opts.maxLayerChars ?? DEFAULT_MAX_LAYER_CHARS;
  const layers: LayerSource[] = [];

  const override = (opts.override ?? '').trim();
  layers.push({ layer: 'override', chars: override.length, present: override.length > 0 });

  let platoBody = '';
  let agentsBody = '';

  if (opts.includeProjectRules === false) {
    layers.push({ layer: 'plato', chars: 0, source: 'fallback', present: false });
    layers.push({ layer: 'agents', chars: 0, source: 'missing', present: false, filename: null });
  } else {
    // Read at a generous size (DEFAULT_READ_BYTES) so a moderately large
    // file is still read in full and then clipped at the per-layer cap.
    // The per-layer cap (clip) is what keeps the prompt bounded; the
    // read cap is a sanity guard against reading a 10GB file.
    const plato = await loadProjectFile('PLATO.md', opts.root, DEFAULT_READ_BYTES);
    if (plato.found) {
      const c = clip(plato.body, cap);
      platoBody = c.body;
      layers.push({ layer: 'plato', chars: c.body.length, source: 'disk', present: true });
    } else {
      // Missing, IO error, or too-big — all fall back to the bundled
      // default so the operator-tuning layer is never absent. The
      // Settings → Workers UI surfaces the read error verbatim.
      const c = clip(DEFAULT_PLATO_BODY, cap);
      platoBody = c.body;
      layers.push({ layer: 'plato', chars: c.body.length, source: 'fallback', present: true });
    }

    // AGENTS.md first; CLAUDE.md as the documented alias.
    const agents = await loadProjectFile('AGENTS.md', opts.root, DEFAULT_READ_BYTES);
    let agentsMeta: LayerSource;
    if (agents.found) {
      const c = clip(agents.body, cap);
      agentsBody = c.body;
      agentsMeta = { layer: 'agents', chars: c.body.length, source: 'disk', present: true, filename: 'AGENTS.md' };
    } else {
      const claude = await loadProjectFile('CLAUDE.md', opts.root, DEFAULT_READ_BYTES);
      if (claude.found) {
        const c = clip(claude.body, cap);
        agentsBody = c.body;
        agentsMeta = { layer: 'agents', chars: c.body.length, source: 'disk', present: true, filename: 'CLAUDE.md' };
      } else {
        agentsMeta = { layer: 'agents', chars: 0, source: 'missing', present: false, filename: null };
      }
    }
    layers.push(agentsMeta);
  }

  // Assemble. Join with a blank line so a layer's leading whitespace
  // doesn't run into the next layer's text. Skip empty layers so we
  // don't emit a stray leading newline when the override is absent.
  const parts: string[] = [];
  for (const l of layers) {
    if (l.layer === 'override' && l.present) parts.push(override);
    if (l.layer === 'plato' && l.present) parts.push(platoBody);
    if (l.layer === 'agents' && l.present) parts.push(agentsBody);
  }
  const system = parts.join('\n\n');
  return { system, layers };
}

