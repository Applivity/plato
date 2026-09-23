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
  | 'apply_patch'
  | 'shell'
  | 'bash_output'
  | 'kill_shell'
  | 'list_dir'
  | 'grep'
  | 'glob'
  | 'web_fetch'
  | 'git';

type Kind = 'read' | 'write' | 'shell' | 'net';

const TOOL_KIND: Record<ToolName, Kind> = {
  read_file: 'read',
  list_dir: 'read',
  grep: 'read',
  glob: 'read',
  git: 'read',
  write_file: 'write',
  apply_diff: 'write',
  // D49l: a multi-file write is still a write, so it gets the same gating as
  // apply_diff — one approval covering several files, never less scrutiny.
  apply_patch: 'write',
  shell: 'shell',
  // D49m: reading a background shell's output is a read — in plan mode there is
  // no way to have started one. Stopping a process is not: it changes state
  // outside the workspace, so it gets shell-class gating.
  bash_output: 'read',
  kill_shell: 'shell',
  web_fetch: 'net',
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
  // D49p: egress ASKS IN EVERY MODE, including `auto` — the only kind that does.
  // Egress is irreversible: a request cannot be un-sent, and a crafted URL can
  // exfiltrate, so `auto`'s blanket allow is wrong for it. This needs no new UI —
  // the approval card already offers Allow once and Approve-all-for-this-session,
  // which is exactly the per-call and per-session consent the founder asked for.
  // It is also why `web_fetch` is `ask` in `plan`, where every other tool is
  // either allowed or denied outright.
  if (kind === 'net') {
    return 'ask';
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
  return 'allow'; // auto: everything allowed, and nothing counts the turns
}

/**
 * D49ab: there is no turn cap, and `MAX_TURNS = 40` is gone.
 *
 * It arrived under D22's delegated mandate as the backstop for `auto` — the one
 * mode with no click in the loop — and was then applied to EVERY mode, where it
 * guarded nothing: `edit` and `act` gate every write behind an approval, and
 * `plan` cannot mutate at all. A real run in `edit` mode was cut off at turn 40
 * with a third of its task untouched, after the user had already approved eleven
 * writes and while the model was doing good work. **The user was the backstop and
 * the cap still fired.**
 *
 * Turns were also the wrong unit. That run spent 10,442 output tokens across its
 * 40 turns; a run that thinks can spend more than that in three. A count of steps
 * bounds neither money nor time — it bounds the one thing a larger task
 * legitimately needs more of.
 *
 * **The run now ends when the model stops calling tools.** That is the whole
 * termination rule, and it is what an agent should do: work until done, with the
 * user able to cancel at any point and — since D49aa — with the transcript
 * preserved whatever happens.
 *
 * **Recorded risk, not a solved one:** in `auto` nothing else stops a run that
 * loops without concluding. See the PROGRESS backlog for how that should be
 * bounded — the short version is that the failure mode is REPETITION, so a bound
 * should detect it rather than count volume or pick a number out of the air.
 */

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
