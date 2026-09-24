/**
 * M1 modes: one permission-policy table over the single runtime loop
 * (ARCHITECTURE.md: modes are permission filters, not separate loops).
 * **D49ak supersedes D22c's four-mode table with three** — see the Mode type.
 */
import { isSecretPath, mentionsSecretPath } from '../security/secrets.js';

/**
 * D49ak: three modes, not four. `act` is GONE and `edit` absorbed it.
 *
 * The founder's finding, and he was right: **`edit` and `act` were hard to tell
 * apart because they differed in two places and neither was what the names
 * imply.** `edit` asked for writes but **remembered the answer per file for the
 * session** and **denied the shell**; `act` asked for writes **every single
 * time** and let the shell through. So `edit` was quiet about edits and could not
 * run anything, and `act` could run anything and nagged. Everything else was
 * identical — both allowed every read, both asked for `web_fetch`.
 *
 * Two things settled it. **A mode that cannot run a command cannot verify its own
 * work**, and the worker prompt REQUIRES verification ("mark a step completed only
 * once you have verified it") — so `edit` could not satisfy the instructions it
 * ran under. And the merged mode is strictly better than either it replaces:
 * **`edit`'s per-file memory plus the shell.**
 *
 * The three, in the founder's terms: **plan** looks and does not touch;
 * **edit** changes the project and asks first; **auto** asks nothing.
 */
export type Mode = 'plan' | 'edit' | 'auto';

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
 * treated as shell-class — allowed in auto, gated in edit, denied in plan.
 */
export function decide(tool: string, mode: Mode): Decision {
  // D49ah: the META tools — the agent talking to the user, and the agent keeping
  // its own plan. Neither touches the workspace or the network, so neither has
  // anything to gate: an approval card for "write down your plan" would be
  // friction with nothing behind it, and `plan` mode is where a plan is most
  // useful, so denying it there would be exactly backwards.
  if (tool === 'ask_user' || tool === 'todo_write') return 'allow';
  const kind = TOOL_KIND[tool as ToolName] ?? (tool.startsWith('mcp_') ? 'shell' : undefined);
  if (kind === undefined) {
    return 'deny';
  }
  // D49ak, amending D49p: **`auto` now fetches without asking.** D49p made egress
  // `ask` in every mode, on the ground that a request cannot be un-sent. The
  // founder overrode that on 2026-09-24 — *"let's allow auto all perms including
  // fetching urls mode thinks are necessary"* — and the argument he is buying out
  // of is real, so it is recorded rather than argued again: **in `auto` no card
  // stands between a fetched page and the model.** A page carrying instructions
  // can therefore steer the model to a URL with the user's data in the query
  // string, and nothing asks. Three rules still hold, and they hold in the
  // EXECUTOR rather than by permission, so `auto` does not reach around them: a
  // redirect onto a loopback or private address is still refused, a non-text
  // response is still refused, and fetched content still arrives labelled
  // untrusted. In `plan` and `edit` egress still asks.
  if (kind === 'net') {
    return mode === 'auto' ? 'allow' : 'ask';
  }
  if (mode === 'plan') {
    return kind === 'read' ? 'allow' : 'deny';
  }
  if (mode === 'edit') {
    // D49ak: read is free; a write and a command both ask. The write answer is
    // remembered per file for the session (see `approve` in the shell), which is
    // the half of the old `edit` that survived the merge.
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
 * D49ak: is this tool one that CHANGES files? **Derived from TOOL_KIND rather
 * than listed again**, and that is the whole point of the function.
 *
 * The shell used to answer this with its own hardcoded pair —
 * `tool === 'write_file' || tool === 'apply_diff'` — and `apply_patch` landed
 * later without being added to it. So a multi-file patch was the one write tool
 * that got no session memory: in `edit` mode it raised an approval card on every
 * call even for files the user had already approved, which is precisely the
 * nagging the per-file memory exists to stop. **A second list that must agree
 * with the first is a list that will not.** Nothing here needs updating when a
 * write tool is added: classifying it in TOOL_KIND is enough.
 */
export function isWriteTool(tool: string): boolean {
  return TOOL_KIND[tool as ToolName] === 'write';
}

/**
 * The files a write tool would change, as workspace-relative paths.
 *
 * `/` takes one path; `apply_patch` takes several, and every one of them must be
 * covered by an approval — see the caller, which asks unless ALL of them are
 * already approved and remembers all of them once the user says yes.
 *
 * An entry with no usable path is dropped rather than kept as an empty string,
 * so a malformed patch cannot put `''` in the approved set.
 */
export function writePathsOf(tool: string, args: Record<string, unknown>): string[] {
  if (tool === 'apply_patch') {
    const patches = Array.isArray(args['patches']) ? args['patches'] : [];
    return patches
      .map((p) => {
        const rec = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
        return typeof rec['path'] === 'string' ? rec['path'] : '';
      })
      .filter((p) => p.length > 0);
  }
  const one = args['path'];
  return typeof one === 'string' && one.length > 0 ? [one] : [];
}

/**
 * Security invariant 2 for M1: refuse tool arguments that reference
 * secret-bearing files. Applied to every tool call before execution.
 * Returns a short reason when refused.
 */
export function secretRefusal(tool: string, args: Record<string, unknown>): string | null {
  // D49ah: `todo_write` is exempt, and the reason is what the check is FOR. It
  // reads arguments that can cause a secret to be READ — a path, a shell command.
  // A plan item is none of those: it is the model's own sentence about work it
  // intends, and it is never sent anywhere the model's context does not already
  // go. Without this, a plan item that merely *names* `keystore.properties` — a
  // legitimate step in this very project — would be refused, and the model would
  // lose a turn renaming a word. Nothing is weakened: the file is still refused
  // by `read_file`, `grep` and `shell`.
  if (tool === 'todo_write') return null;
  // D49ai: a shell command is the one argument that can read ANY file, and the
  // name of the file is a word inside a sentence rather than the whole string —
  // so the whole-string check below cannot see it. `cat keystore.properties` ran
  // and returned the file; `cat app/keystore.properties` was refused. See
  // mentionsSecretPath for the repro and for what this does not cover.
  if (tool === 'shell') {
    const command = args['command'];
    if (typeof command === 'string' && mentionsSecretPath(command)) {
      return 'shell was refused: the command references a protected file.';
    }
  }
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
