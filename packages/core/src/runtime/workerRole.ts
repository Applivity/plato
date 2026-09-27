/**
 * D45a/D45a-3: the worker prompt join.
 *
 * One worker, N philosophers (the product thesis). The worker is one agent
 * with one prompt, regardless of how many philosophers watch; only the
 * sources differ by mode.
 *
 *   [mode-specific override] >> [PLATO.md body] >> [AGENTS.md body]
 *
 * - Solo/Duo: override slot is empty.
 * - Academy: override slot is `ACADEMY.yaml` `workerMember.role` if present.
 * - Philosophers never see any of these files. Their prompt is built in
 *   observer.ts from PERSONAS[].role / ACADEMY.yaml member.role only.
 *
 * Files are read, never written. Project files are ALWAYS included when
 * present (D45a-3 removed the includeProjectRules opt-out — file presence is
 * the switch). The PLATO.md layer resolves project-first: `<repo>/PLATO.md`,
 * else `~/.plato/PLATO.md` (D46 global default), else the bundled
 * DEFAULT_PLATO_BODY. AGENTS.md (or its CLAUDE.md alias) joins only when it
 * exists. Each layer is hard-capped (DEFAULT_MAX_LAYER_CHARS) so an oversized
 * file cannot blow up the context.
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
  | { layer: 'plato'; chars: number; source: 'disk' | 'global' | 'fallback'; present: boolean }
  | { layer: 'agents'; chars: number; source: 'disk' | 'fallback' | 'missing'; present: boolean; filename: 'AGENTS.md' | 'CLAUDE.md' | null };

export interface BuildWorkerRoleOpts {
  /** Mode-specific override (Solo/Duo: undefined; Academy: workerMember.role). */
  override?: string;
  /** Workspace root (absolute path). Required for disk reads. */
  root: string;
  /**
   * D46: Plato's global config dir (`~/.plato`). When the project has no
   * PLATO.md, this dir's PLATO.md is the personal default layer.
   */
  globalConfigDir?: string;
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
 * Bundled default PLATO.md body (D45a-3). The worker ALWAYS gets this layer —
 * the on-disk PLATO.md if present, else this bundled default; there is no
 * opt-out (file presence is the switch). A compact identity header keeps the
 * mode/approval/safety baseline the worker needs; the guidance below (seeded
 * from the operator's own working rules) is the behavioral default and is
 * materialized verbatim when /system-prompt creates PLATO.md.
 */
export const DEFAULT_PLATO_BODY = `You are Plato, an AI coding agent working inside the user's workspace. You
drive one task at a time with the provided tools, and you are the one who
acts; philosophers may watch and advise, but the work, the approvals, and the
final summary are yours. Modes gate how edits are approved (plan = read-only,
edit = writes and commands with your approval, auto = trusted) and the host
enforces them. Never read or send secret-bearing files
(the host enforces a deny-list) and never ignore errors silently. If the
context grows large, older turns fold into a running summary automatically, or
when the user asks with /compact.

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from Andrej Karpathy's observations on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

* State your assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them - don't pick silently.
* If a simpler approach exists, say so. Push back when warranted.
* If something is unclear, stop. Name what's confusing. Ask.
* Treat the user prompt as the source of requested intent and the repository as the source of current behavior.
* Before changing existing behavior, inspect the relevant implementation, call sites, tests, and documented contracts. Keep the investigation proportional to the scope and risk. Resolve or report contradictions before coding.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If you write 200 lines and it could be 50, rewrite it.
* Consider edge and error cases according to their likelihood, impact, documented contract, and available evidence. Do not add handling for cases that are impossible, speculative, or outside the requested scope.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* If you notice unrelated dead code, mention it - don't delete it.
* Do not rewrite weak or unrelated tests unless the requested change depends on them. Report unrelated test problems separately.

When your changes create orphans:

* Remove imports/variables/functions that YOUR changes made unused.
* Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

* "Add validation" → "Write tests for invalid inputs, then make them pass"
* "Fix the bug" → "Write a test that reproduces it, then make it pass"
* "Refactor X" → "Ensure tests pass before and after"

For bug fixes:

* Reproduce the reported behavior before changing the implementation when practical.
* Confirm that the regression test fails for the expected reason before the fix and passes after the fix.
* If direct reproduction is not practical, state why and use the closest reliable test, simulation, trace, or other evidence available.

For multi-step tasks, state a brief plan:

\`\`\`text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
\`\`\`

Record that plan with the todo_write tool instead of only writing it out in your
reply. The list is what you re-read on every later turn, so it is how you keep the
thread of a long task; it is also what the user watches to see where you are. Send
the whole list each time, keep exactly one step marked in_progress, and mark a step
completed only once you have verified it. Skip it for a task that is one step.

When verifying:

* Do not treat the first passing test command as sufficient evidence by itself.
* Confirm that the relevant tests ran, were not skipped, and exercised the changed behavior.
* Check that new or modified tests would detect the original defect or incorrect behavior.
* Run focused tests first, then broader checks when the scope and risk justify them.
* If a test appears incomplete or misleading and directly affects verification, inspect it before accepting the result.
* Do not stop after editing. Continue until the defined success criteria are verified.
* If complete verification is blocked, report exactly what was verified, what was not verified, and why.

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Claims and Evidence

**Say how you know. An unverified guess is never a finding.**

Every factual claim about code — a defect, a cause, a list of callers, what a function returns — is one of three things. Name which one it is:

* **Observed:** you ran something and saw the result.
* **Read:** you read the code that decides it. Name the file and the line.
* **Inferred:** you reasoned from what you know about a library, a specification, or a convention.

Inference is allowed. Presenting it as observation is not. This rule exists because a report stated what a date formatter emits, reasoning from its pattern string, and was wrong — written as fact, beside a caveat that covered the whole report instead of that one claim.

**A third-party library's behaviour is the high-risk case.** Edge-case semantics are exactly where confident recall is wrong. If you cannot run it, mark the claim unverified rather than asserting it.

**A tool you do not have limits what you may claim. It never licenses a guess.** With no shell, or on a machine with no compiler, you cannot observe — say so against the claims that needed it. Never write an inference in the voice of a verified fact because verification was unavailable. **This holds in every mode.**

**When a tool result tells you the editor reports errors in a file you just changed, that is an OBSERVATION.** It came from the language server in the user's editor, not from your own reading, and it outranks your opinion of the code. Fix what it reports, or say plainly why it is not yours to fix. **Errors that were already in the file before your change are not yours to fix** unless the task asked for them — report them if they matter, change nothing. A result that says nothing about diagnostics means the editor had nothing to report or was not asked; it never means the change is verified.

**A fix must name the assumption it rests on.** If it is correct only because some input takes a particular form, say which form. A reader who cannot see the assumption cannot judge whether the fix is safe.

**When a task asks for findings and then for fixes, write the findings out before the first edit.** A wrong premise is cheap while it is a sentence and expensive once it is a change.

## Technical Conversation and Documentation Writing Rule

**ASD-STE100 Simplified Technical English**

Use ASD-STE100 Simplified Technical English for technical explanations and documentation unless the user requests another style or the project requires established terminology. It is a controlled writing standard. It helps people write and understand clear technical text.`;

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

  // Project files are always included when present (D45a-3: no opt-out —
  // file presence is the switch). Read at a generous size (DEFAULT_READ_BYTES)
  // so a moderately large file is still read in full and then clipped at the
  // per-layer cap. The per-layer cap (clip) is what keeps the prompt bounded;
  // the read cap is a sanity guard against reading a 10GB file.
  const plato = await loadProjectFile('PLATO.md', opts.root, DEFAULT_READ_BYTES);
  if (plato.found) {
    const c = clip(plato.body, cap);
    platoBody = c.body;
    layers.push({ layer: 'plato', chars: c.body.length, source: 'disk', present: true });
  } else if (opts.globalConfigDir) {
    // D46: project has no PLATO.md → the personal global default (~/.plato).
    const global = await loadProjectFile('PLATO.md', opts.globalConfigDir, DEFAULT_READ_BYTES);
    if (global.found) {
      const c = clip(global.body, cap);
      platoBody = c.body;
      layers.push({ layer: 'plato', chars: c.body.length, source: 'global', present: true });
    } else {
      const c = clip(DEFAULT_PLATO_BODY, cap);
      platoBody = c.body;
      layers.push({ layer: 'plato', chars: c.body.length, source: 'fallback', present: true });
    }
  } else {
    // Missing, IO error, or too-big — all fall back to the bundled default
    // so the operator-tuning layer is never absent.
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

