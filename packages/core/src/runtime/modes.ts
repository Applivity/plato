/**
 * M1 modes: one permission-policy table over the single runtime loop
 * (ARCHITECTURE.md: modes are permission filters, not separate loops;
 * D22c records the per-mode rules).
 */
import { isSecretPath } from '../security/secrets.js';

export type Mode = 'plan' | 'edit' | 'act' | 'auto';

/** Tool names as exposed to the model. */
export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'apply_diff'
  | 'shell'
  | 'list_dir'
  | 'grep'
  | 'git';

type Kind = 'read' | 'write' | 'shell';

const TOOL_KIND: Record<ToolName, Kind> = {
  read_file: 'read',
  list_dir: 'read',
  grep: 'read',
  git: 'read',
  write_file: 'write',
  apply_diff: 'write',
  shell: 'shell',
};

export type Decision = 'allow' | 'ask' | 'deny';

/**
 * Decides whether `tool` may run in `mode`. Pure function; the shell owns
 * any approve-once-per-session caching and the actual user prompts.
 *
 * MCP tools (`mcp_*`, D06) are unknown-capability external actions:
 * treated as shell-class — allowed in auto, gated per-action in act,
 * denied in plan/edit.
 */
export function decide(tool: string, mode: Mode): Decision {
  // ask_user is meta (the agent asking the user) — always allowed in all modes.
  if (tool === 'ask_user') return 'allow';
  const kind = TOOL_KIND[tool as ToolName] ?? (tool.startsWith('mcp_') ? 'shell' : undefined);
  if (kind === undefined) {
    return 'deny';
  }
  if (mode === 'plan') {
    return kind === 'read' ? 'allow' : 'deny';
  }
  if (mode === 'edit') {
    if (kind === 'read') return 'allow';
    if (kind === 'write') return 'ask'; // shell caches session approval
    return 'deny';
  }
  if (mode === 'act') {
    return kind === 'read' ? 'allow' : 'ask';
  }
  return 'allow'; // auto: everything allowed; turn cap is the safety net
}

/** Hard turn cap for every M1 run (D22c); auto relies on it most. */
export const MAX_TURNS = 40;

/**
 * Security invariant 2 for M1: refuse tool arguments that reference
 * secret-bearing files. Applied to every tool call before execution.
 * Returns a short reason when refused.
 */
export function secretRefusal(tool: string, args: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v === 'string') {
      candidates.push(v);
    } else if (Array.isArray(v)) {
      for (const s of v) {
        if (typeof s === 'string') candidates.push(s);
      }
    }
  }
  for (const c of candidates) {
    if (isSecretPath(c)) {
      return `${tool} was refused: it references a protected file.`;
    }
  }
  return null;
}
