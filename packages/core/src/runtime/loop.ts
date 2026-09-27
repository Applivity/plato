/**
 * M1 agent loop (D22a): native tool-use over one runtime. Modes gate each
 * call through decide(); approvals surface through the injected callback.
 */
import { toolDeclarations } from '../tools/schemas.js';
import { executeTool } from '../tools/execute.js';
import { ShellManager } from '../tools/background.js';
import { hostOf, isPrivateHostname } from '../tools/web.js';
import type { ImageMime } from '../providers/types.js';
import type { ToolArgs } from '../tools/execute.js';
import type { McpServer } from '../mcp/client.js';
import type {
  CanonicalContent,
  CanonicalMessage,
  ChatProvider,
  ReasoningConfig,
  ToolResultBlock,
} from '../providers/types.js';
import { decideWithArgs, isWriteTool } from './modes.js';
import type { Mode } from './modes.js';
import { secretRefusal } from './modes.js';
import { containmentRefusal } from '../security/paths.js';
import {
  AgentBus,
  RunController,
  type RefusalReason,
  type ToolPhase,
} from './bus.js';
import { DEFAULT_RETRY, withRetry } from '../providers/retry.js';
import type { RetryOptions } from '../providers/retry.js';
import { estimateCost } from './cost.js';
import {
  resolveMaxContext,
  resolveMaxOutput,
  splitModelRef,
} from '../providers/registry.js';
import {
  compactMessages,
  promptBreakdown,
  shouldAutoCompact,
} from './context.js';
import { buildWorkerRole } from './workerRole.js';
import {
  askNote,
  continueText,
  stuckStopNote,
  StuckWatch,
  type CallOutcome,
  type StuckRequest,
  type StuckVerdict,
} from './stuck.js';

// D45a: the worker system prompt is assembled by `buildWorkerRole` at
// the top of `runAgentLoop` (override >> PLATO.md default >> AGENTS.md).
// The baseline-identity text lives in `DEFAULT_PLATO_BODY` (workerRole.ts).

/** D37: clamp a 0..1 threshold into a sane range. */
function clampThreshold(t: number): number {
  if (!Number.isFinite(t)) {
    return 0.8;
  }
  return Math.max(0.5, Math.min(0.95, t));
}

export interface ApprovalRequest {
  tool: string;
  args: ToolArgs;
  /** Human-readable preview for the approval card (diff for edits). */
  preview?: string;
  /**
   * D49p: the host this approval covers, when the tool contacts one. An
   * approval covers ONE host — the shell keys its session approval on this, so
   * "approve all" cannot silently cover a different host reached later.
   */
  host?: string;
  /**
   * D49aq: the run this ask belongs to, so the host can report what it did with
   * the ask on the bus (see the `approval-card` event). The host is the only
   * party that knows whether a card was drawn, and the report needs a runId.
   */
  runId: string;
}

/**
 * D49p: the host an approval covers, when the tool contacts one.
 *
 * Every web_fetch approval carries a host — the first one as much as a redirect
 * hop. Keying only the redirect hops would leave the FIRST approval tool-wide,
 * so "approve all" on the original URL would cover every later host, which is
 * the hole this whole rule exists to close.
 */
function approvalHost(tool: string, args: ToolArgs): string | undefined {
  if (tool !== 'web_fetch') return undefined;
  const url = args['url'];
  return typeof url === 'string' ? hostOf(url) : undefined;
}

/**
 * D49p: what the user cannot see from a URL, printed on the approval card.
 *
 * A LABEL, never a gate — the founder's decision is that the user decides where
 * Plato may go, so this adds the one fact the URL does not carry: whether the
 * address reaches a machine of their own rather than the public internet.
 */
function addressWarning(host: string): string {
  if (host === '169.254.169.254') {
    return (
      `\n\nWARNING: 169.254.169.254 is the cloud metadata address, not a ` +
      `website. A request here can read this machine's cloud credentials.`
    );
  }
  if (!isPrivateHostname(host)) return '';
  return (
    `\n\nWARNING: ${host} is a loopback, private or link-local address. It ` +
    `reaches this computer or your local network, not the public internet.`
  );
}

/**
 * Builds the approval-card preview. Reads the target file and simulates
 * the change in memory; never writes. Best-effort: falls back to a plain
 * argument summary when a preview cannot be produced.
 */
async function buildApprovalPreview(
  root: string,
  tool: string,
  args: ToolArgs,
  /** D49p: the URL this one is a redirect FROM, when it is a redirect hop. */
  via?: string,
): Promise<string> {
  if (tool === 'web_fetch') {
    // D49p: the URL IS what leaves the machine, so it is what the user must see.
    // A generic argument dump would bury it; this puts it on its own line.
    const url = typeof args['url'] === 'string' ? args['url'] : '(no url)';
    const redirectNote =
      via === undefined
        ? ''
        : `\n\n${via}\nredirected here. Approving sends a second request — to a ` +
          `different host than the one you already approved.`;
    return (
      `This sends a request to:\n\n  ${url}${addressWarning(hostOf(url))}` +
      `${redirectNote}\n\nA request cannot be un-sent. ` +
      `The page comes back as untrusted text — Plato will not follow instructions found in it.`
    );
  }
  if (tool === 'apply_diff' || tool === 'apply_patch') {
    // D49l: a multi-file patch previews EVERY file it touches. The whole safety
    // argument for approving a write is that the user sees what changes, and
    // approving several files blind would be worse than approving one.
    const entries: { rel: string; diffs: unknown }[] =
      tool === 'apply_patch'
        ? (Array.isArray(args['patches']) ? args['patches'] : []).map((p) => {
            const rec = (
              typeof p === 'object' && p !== null ? p : {}
            ) as Record<string, unknown>;
            return {
              rel: typeof rec['path'] === 'string' ? rec['path'] : '',
              diffs: rec['diffs'],
            };
          })
        : [
            {
              rel: typeof args['path'] === 'string' ? args['path'] : '',
              diffs: args['diffs'],
            },
          ];
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { applyBlocks, parseDiffBlocks, previewDiff } = await import(
        '../tools/diff.js'
      );
      const { resolveInRoot } = await import('../security/paths.js');
      const parts: string[] = [];
      for (const e of entries) {
        const safe = resolveInRoot(root, e.rel);
        if (safe === null) {
          // Refused later anyway; say why instead of showing a misleading diff.
          parts.push(`--- ${e.rel} (outside the workspace — refused)`);
          continue;
        }
        const before = await readFile(join(root, safe), 'utf8');
        const after = applyBlocks(before, parseDiffBlocks(e.diffs)).content;
        parts.push(`--- ${safe}\n${previewDiff(before, after)}`);
      }
      const joined = parts.join('\n\n');
      return joined.length > 6000
        ? `${joined.slice(0, 6000)}\n…[preview truncated]`
        : joined;
    } catch (e) {
      return `(preview unavailable: ${e instanceof Error ? e.message : 'error'})`;
    }
  }
  if (tool === 'write_file' && typeof args['content'] === 'string') {
    const c = args['content'];
    // D49b: when this replaces a file that already holds content, preview the
    // DIFF. The whole safety argument for `overwrite: true` is that the user
    // sees what is lost — showing only the incoming text hides exactly that.
    const rel = typeof args['path'] === 'string' ? args['path'] : '';
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const before = await readFile(join(root, rel), 'utf8');
      if (before.length > 0) {
        const { previewDiff } = await import('../tools/diff.js');
        const trimmed = previewDiff(before, c);
        return trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
      }
    } catch {
      // No such file (the create path) or unreadable: show the content itself.
    }
    return c.length > 1500 ? c.slice(0, 1500) : c;
  }
  return JSON.stringify(args).slice(0, 800);
}

export interface LoopOptions {
  root: string;
  task: string;
  /** Read live before every tool decision, so mid-run mode switches apply. */
  getMode: () => Mode;
  /** Returns true to allow a gated tool call. */
  approve: (req: ApprovalRequest) => Promise<boolean>;
  /** Progress callbacks for the shell UI. */
  onText?: (text: string) => void;
  /**
   * D49j: the CURRENT turn's text as it arrives, so the reply is visible while
   * it is written rather than after the whole turn. The argument is the text
   * SO FAR, not the newest fragment — a caller replaces what it shows instead
   * of appending, which is also what makes a retried turn correct: the second
   * attempt starts from '' and overwrites the attempt it abandoned.
   *
   * Absent, the loop makes blocking calls exactly as it did before.
   */
  onTextDelta?: (textSoFar: string) => void;
  /**
   * D49n: images to send with the opening user turn. They must NOT be folded
   * into `task` — the task is emitted on `run-started` and written verbatim to
   * the transcript, so base64 in it would land in every run's JSONL.
   */
  images?: { mime: ImageMime; data: string }[];
  onToolEvent?: (event: {
    tool: string;
    args: ToolArgs;
    // D49aq: the bus's own union, so adding a phase cannot leave this list
    // behind.
    phase: ToolPhase;
    ok?: boolean;
    // D49as: set only on phase 'refused' — which guard stopped the call. The
    // live log names the guard, so the host needs the code, not just the phase.
    reason?: RefusalReason;
  }) => void;
  /**
   * Optional M2 event bus (D24a); one is created internally when omitted
   * and legacy callbacks above are bridged onto it.
   */
  bus?: AgentBus;
  /**
   * D49av: one chance to add to the result of a SUCCESSFUL write, from the host.
   *
   * The host uses it to append what the editor's language servers say about the
   * files just changed, so the model learns in the same turn that it broke
   * something. Core knows nothing about diagnostics — it only knows that the host
   * may have something to add, and it appends a non-empty answer verbatim.
   *
   * Called only for a write tool that succeeded. A throw is swallowed, because a
   * host-side problem must never fail a run. `signal` is the run's abort signal so
   * a host that waits can give up when the user presses Stop.
   */
  afterToolResult?: (event: {
    tool: string;
    args: ToolArgs;
    ok: boolean;
    signal: AbortSignal;
  }) => Promise<string | undefined>;
  /**
   * D49aw: put to the user when the run looks stuck — the same call returning
   * the same thing, or turns in which nothing succeeded. `continue` resumes and
   * anything in `guidance` is handed to the model; `stop` ends the run with the
   * reason `stuck`.
   *
   * **Absent, the loop STOPS.** A guard that cannot ask must not pretend it did,
   * and this mirrors the default Cline ships. The shell always wires this to a
   * card; a test or a headless caller gets the honest stop.
   */
  onStuckAsk?: (
    req: StuckRequest,
  ) => Promise<{ action: 'continue' | 'stop'; guidance?: string }>;
  /**
   * D49aw: the model was told it is going in circles. The shell shows this line
   * so the pause is never a surprise — the first the user hears of a stuck run
   * should not be a card appearing out of nowhere.
   */
  onStuckNudge?: (note: string) => void;
  /** Observer inbox (D24b): guidance/pause/cancel at safe points. */
  controller?: RunController;
  /** Bound provider adapter (D25b). Replaces the old apiKey field. */
  provider: ChatProvider;
  /**
   * D49t: the context window and output cap the CONNECTION advertised, when it
   * advertised them (see discover.ts). The loop cannot work these out: the
   * shipped catalog holds a handful of well-known names, and a LiteLLM group or
   * a self-hosted model is never on it. Before this the run silently assumed
   * 8192 and summarised the conversation after a few files.
   */
  advertised?: { context?: number; maxOutput?: number };
  /** Composite model ref, e.g. 'anthropic:claude-sonnet-4-5'. */
  model: string;
  /** Extra system text appended for this run (D31: team coder role). */
  role?: string;
  /**
   * D46: Plato's global config dir (`~/.plato`). Feeds the worker-prompt join
   * as the PLATO.md fallback when the project has none.
   */
  globalConfigDir?: string;
  /** Reasoning config; only attach for catalog-flagged models. */
  reasoning?: ReasoningConfig;
  /**
   * D49g: mark the stable prefix (system prompt + tool schemas) cacheable where
   * the provider supports it. On by default for the shell — the prefix is
   * identical on every turn, so after the first turn it is read at a discount.
   */
  cache?: boolean;
  /**
   * D49f: retry policy for the worker's provider call. Compaction and the
   * observer are NOT wrapped — both already degrade gracefully, and a second
   * retry budget would only hide how long a turn really takes. The injection
   * points exist so a test does not wait in real time.
   */
  retry?: RetryOptions;
  /**
   * Prior conversation as plain text pairs (oldest first) so resumed
   * chats keep context. Same-role neighbors are merged; leading
   * assistant messages are dropped to satisfy role alternation.
   */
  history?: { role: 'user' | 'assistant'; text: string }[];
  /**
   * Called when the model calls ask_user (D34). The model may ask up to 3
   * questions at once; returns an array of answers, one per question, in
   * the same order. Answers flow back to the model as a tool result.
   */
  askUser?: (req: {
    questions: {
      question: string;
      context?: string;
      options: string[];
      recommended?: string;
      /**
       * D49al: true when more than one option may be right. The host renders
       * checkboxes rather than radios and the answer is the chosen labels joined
       * by '; ' — still ONE string per question, so the transport is unchanged.
       */
      multiple?: boolean;
    }[];
  }) => Promise<string[]>;
  /**
   * Started MCP servers (D06). Their tools join the model's tool list
   * as mcp_<server>_<tool> and route through the mode policy like
   * shell-class actions.
   */
  mcpServers?: McpServer[];
  /**
   * D37 context compaction. Default is `mode: 'auto'` with a threshold
   * of 0.8 — a sane, agent-friendly default. Manual mode disables
   * auto-triggering; the user invokes compaction via the controller's
   * `requestCompact()`. In both modes the same compactor code path runs.
   */
  compact?: {
    mode: 'auto' | 'manual';
    /** Fraction of maxContext (0..1) that triggers auto-compaction. */
    threshold?: number;
  };
}

export interface LoopResult {
  finalText: string;
  turns: number;
  /**
   * Why the run ended: natural completion, a truncated answer, a cancel, or the
   * user stopping a run that looked stuck (D49aw).
   */
  reason: 'complete' | 'cap' | 'cancelled' | 'stuck';
  /**
   * D49aw: the sentence to show when a run ended `stuck`. Written here rather
   * than in the shell so the wording is testable, and so the done note and the
   * record say the same thing.
   */
  stuckNote?: string;
  /** True when the run stopped because the output hit the token cap. */
  truncated?: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** D49g: tokens served from the prompt cache across the run. */
  cacheReadTokens: number;
}

export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const bus = opts.bus ?? new AgentBus();
  const runId = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  // D49m: background shells belong to the RUN. The manager is torn down in the
  // `finally`, so every exit path — completion, cap, cancel, or a thrown
  // provider error — stops them. A shell that outlives its run is invisible:
  // there is no UI that lists them, so the user would have to hunt the process
  // list for whatever is still holding a port.
  const shells = new ShellManager((phase, status) => {
    bus.emit({
      type: 'shell-event',
      runId,
      id: status.id,
      phase,
      command: status.command,
      ...(phase === 'exited' ? { code: status.exitCode } : {}),
    });
  });
  try {
    return await runLoop(opts, bus, runId, shells);
  } finally {
    const stopped = await shells.killAll();
    if (stopped > 0) {
      bus.emit({
        type: 'notice',
        runId,
        text: `[plato] stopped ${stopped} background shell(s) — they do not outlive the run.`,
      });
    }
  }
}

async function runLoop(
  opts: LoopOptions,
  bus: AgentBus,
  runId: string,
  shells: ShellManager,
): Promise<LoopResult> {
  const ctrl = opts.controller ?? new RunController();

  // Legacy shell callbacks ride the bus (D24a): one emission path.
  if (opts.onText) {
    bus.on((e) => {
      if (e.type === 'text') {
        opts.onText!(e.text);
      }
    });
  }
  if (opts.onToolEvent) {
    bus.on((e) => {
      if (e.type === 'tool-event' && e.args !== undefined) {
        opts.onToolEvent!({
          tool: e.tool,
          args: e.args as ToolArgs,
          phase: e.phase,
          ok: e.ok,
          reason: e.reason,
        });
      }
    });
  }

  const client = opts.provider;
  const messages: CanonicalMessage[] = [];
  let prevRole: 'user' | 'assistant' | null = null;
  for (const h of opts.history ?? []) {
    if (prevRole === null && h.role === 'assistant') {
      continue; // must open with a user turn
    }
    const last = messages[messages.length - 1];
    if (h.role === prevRole && last && last.content[0]?.type === 'text') {
      last.content[0].text += '\n\n' + h.text;
      continue;
    }
    messages.push({
      role: h.role,
      content: [{ type: 'text', text: h.text }],
    });
    prevRole = h.role;
  }
  messages.push({
    role: 'user',
    // D49n: images ride the OPENING user turn, and never the task string. The
    // task goes into the `run-started` event, which the transcript writes
    // verbatim — megabytes of base64 in the task would land in every JSONL.
    // Images first, so the model sees what the instruction is about.
    content: [
      ...(opts.images ?? []).map((i) => ({
        type: 'image' as const,
        mime: i.mime,
        data: i.data,
      })),
      { type: 'text' as const, text: opts.task },
    ],
  });
  let finalText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  /** D49g: so the saving from prompt caching is visible, not just smaller cost. */
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let reason: LoopResult['reason'] = 'complete';
  let capNote: string | null = null;
  let truncatedStop = false;
  let autoContinued = false;
  let stopAfterTools = false;
  const pendingGuidance: string[] = [];
  // D49aw: the repetition bound. `stuck.ts` explains why it keys on the call AND
  // the result it produced, and why the user's own declines are invisible to it.
  const stuck = new StuckWatch();
  /** Verdicts from this turn's calls, judged together at the turn boundary. */
  const judged: StuckVerdict[] = [];
  /** Lines queued for the model's next turn — a nudge, or a "keep going". */
  const stuckNotes: string[] = [];
  let stuckNote: string | undefined;
  const judge = (
    tool: string,
    args: ToolArgs,
    result: string,
    outcome: CallOutcome,
  ): void => {
    const v = stuck.observe({ tool, args, result, outcome });
    if (v.kind !== 'ok') judged.push(v);
  };
  // D45a: build the three-layer worker system prompt (override +
  // PLATO.md + AGENTS.md) before the loop starts. Project files are always
  // included when present (D45a-3 removed the opt-out). Loop is async so
  // the disk reads are awaited here. Philosophers (observer.ts) do NOT
  // call this — they get a separate SYSTEM string.
  const workerRole = await buildWorkerRole({
    override: opts.role,
    root: opts.root,
    globalConfigDir: opts.globalConfigDir,
  });
  // D37: the system string is mutable across a run because compaction
  // prepends a conversation summary to it. Each turn's `completeTurn`
  // call reads the latest value.
  let currentSystem = workerRole.system;
  // D37: the provider's authoritative inputTokens from the previous
  // turn. Used as a secondary line in the context tooltip.
  let lastInputTokens: number | undefined;
  // D37: compaction config. Default = auto at 80% of max context.
  const compactCfg = {
    mode: opts.compact?.mode ?? 'auto',
    threshold: clampThreshold(opts.compact?.threshold ?? 0.8),
  };

  // Tool surface: built-ins + MCP (mcp_<server>_<tool>) (D06).
  const mcpByTool = new Map<string, { srv: McpServer; tool: string }>();
  const allTools = toolDeclarations();
  for (const srv of opts.mcpServers ?? []) {
    for (const t of srv.tools) {
      const full = srv.fullName(t.name);
      mcpByTool.set(full, { srv, tool: t.name });
      allTools.push({
        name: full,
        description: `[${srv.serverName}] ${t.description}`,
        parameters: t.parameters,
      });
    }
  }

  // Generous default, clamped to the model's hard provider cap: asking
  // above it is a 400 error (e.g. Haiku 3.5 tops out at 8192).
  const bareModel = splitModelRef(opts.model)?.model ?? opts.model;
  // D49t/D49w: the model's OWN output limit, not one Plato invented.
  //
  // This was `Math.min(16384, ...)` — a 16,384 ceiling applied even when the
  // model's real cap was known and larger. It has been there since 0.7.6, where
  // it was a RAISE (from 4,096) that fixed runs ending with no answer. It is now
  // the thing causing them: the founder's last run ramped 2,559 -> 4,783 ->
  // 8,201 -> **16,384 exactly**, spent the whole budget thinking, and produced no
  // visible text at all.
  //
  // Nothing replaces it as a hanger: `resolveMaxOutput` still falls back to a
  // conservative 8,192 when NOTHING knows the model. What changes is that a known
  // limit is now used rather than overridden. A single turn can therefore cost
  // more — that is the model's own ceiling, which is what the user picked.
  const maxTokens = resolveMaxOutput(bareModel, opts.advertised?.maxOutput);

  bus.emit({ type: 'run-started', runId, task: opts.task, model: opts.model });

  // D49ab: no turn bound. The loop ends when the model stops calling tools —
  // see the note in modes.ts for why the count was removed and what it cost.
  let turn = 1;
  for (;; turn++) {
    // Safe point (D24b): honour cancel/pause and drain observer guidance.
    if (!(await ctrl.gate())) {
      reason = 'cancelled';
      break;
    }
    pendingGuidance.push(...ctrl.drainGuidance());
    bus.emit({ type: 'turn-started', runId, turn });

    // D37: emit the live context estimate before this turn goes out so
    // the UI's ring is always one step ahead of the model call.
    // D49t: the connection's own report, when it made one. Before this the
    // discovered number reached the header ring and nothing else, so compaction
    // fell back to UNKNOWN_CONTEXT_FLOOR (8192) and tripped after a few files.
    const maxCtx = resolveMaxContext(bareModel, opts.advertised?.context);
    const breakDown = promptBreakdown(currentSystem, messages, allTools);
    bus.emit({
      type: 'context',
      runId,
      turn,
      maxContext: maxCtx,
      total: breakDown.total,
      system: breakDown.system,
      user: breakDown.user,
      assistant: breakDown.assistant,
      tool: breakDown.tool,
      ...(lastInputTokens !== undefined
        ? { lastInputTokens }
        : {}),
    });

    // D37: decide whether to compact before the next request goes out.
    // The effective trigger is the OR of: (a) controller.requestCompact
    // (Manual pill + Compact button), and (b) auto-threshold tripped.
    const manualCompact = ctrl.drainCompactRequest();
    // D37a: trip math lives in shouldAutoCompact. The helper's docstring
    // spells out the invariant — `maxContext` is catalog-only; a value
    // surfaced by a /models payload is informational for the header
    // caption but must NEVER drive compaction timing (OpenRouter /
    // LiteLLM routes have been known to report stale or route-specific
    // windows). Unknown models fall back to UNKNOWN_CONTEXT_FLOOR.
    const autoTripped =
      compactCfg.mode === 'auto' &&
      shouldAutoCompact(breakDown.total, maxCtx, compactCfg.threshold);
    if ((manualCompact || autoTripped) && messages.length > 1) {
      try {
        const beforeTokens = breakDown.total;
        const result = await compactMessages(client, {
          model: opts.model,
          system: currentSystem,
          messages,
          tools: allTools,
        });
        currentSystem = result.system;
        messages.length = 0;
        messages.push(...result.messages);
        // The summariser call used tokens; fold them into the run
        // totals honestly so the done-card cost is accurate.
        inputTokens += result.summaryTokens;
        const summaryCost = estimateCost(opts.model, {
          inputTokens: result.summaryTokens,
          outputTokens: 0,
        });
        costUsd += summaryCost.usd;
        const afterBreakdown = promptBreakdown(
          currentSystem,
          messages,
          allTools,
        );
        bus.emit({
          type: 'context-compacted',
          runId,
          turn,
          mode: manualCompact ? 'manual' : 'auto',
          beforeTokens,
          afterTokens: afterBreakdown.total,
          summaryTokens: result.summaryTokens,
          keptMessages: messages.length,
        });
        // Re-emit `context` so the ring immediately reflects the new
        // estimate, before the model call below.
        bus.emit({
          type: 'context',
          runId,
          turn,
          maxContext: maxCtx,
          total: afterBreakdown.total,
          system: afterBreakdown.system,
          user: afterBreakdown.user,
          assistant: afterBreakdown.assistant,
          tool: afterBreakdown.tool,
          ...(lastInputTokens !== undefined
            ? { lastInputTokens }
            : {}),
        });
      } catch (e) {
        // A failed compaction must not crash the run. Surface a notice
        // and continue; the next threshold check (or the next manual
        // click) can try again.
        bus.emit({
          type: 'notice',
          runId,
          text:
            '[plato] context compaction failed — continuing without it: ' +
            (e instanceof Error ? e.message : 'error'),
        });
      }
    }

    let res;
    try {
      // D49f: a transient 429 / 5xx / transport failure backs off and retries
      // instead of ending the run and losing every turn so far. Each retry is
      // announced, so a stalled turn is explained rather than looking hung.
      res = await withRetry(
        () => {
          // D49j: a fresh accumulator per attempt. The adapter reports
          // fragments; the caller wants the text so far. Resetting here is what
          // stops a retry from concatenating onto the text of the attempt it
          // just abandoned — the second attempt REPLACES the first.
          let streamed = '';
          return client.completeTurn({
            model: opts.model,
            system: currentSystem,
            tools: allTools,
            messages,
            maxTokens,
            reasoning: opts.reasoning,
            cache: opts.cache,
            signal: ctrl.signal,
            // Only ask for a stream when someone is watching; otherwise the
            // blocking path is used, which is what every test fake expects.
            ...(opts.onTextDelta
              ? {
                  onDelta: (t: string) => {
                    streamed += t;
                    opts.onTextDelta!(streamed);
                  },
                }
              : {}),
          });
        },
        {
          policy: opts.retry?.policy,
          sleep: opts.retry?.sleep,
          now: opts.retry?.now,
          random: opts.retry?.random,
          signal: ctrl.signal,
          onRetry: ({ attempt, delayMs, reason }) => {
            bus.emit({
              type: 'notice',
              runId,
              // ceil, because a 500ms wait reported as "0s" reads like a bug.
              text:
                `[plato] ${reason} — retrying in ${Math.ceil(delayMs / 1000)}s ` +
                `(attempt ${attempt + 1} of ${opts.retry?.policy?.attempts ?? DEFAULT_RETRY.attempts})`,
            });
          },
        },
      );
    } catch (e) {
      // D49i: a cancel aborts the call in flight, and an abort looks like a
      // transport failure. A stop the user asked for is a clean stop, not a
      // failure — reporting "provider request failed" for a deliberate cancel
      // would be a lie about what happened.
      if (ctrl.signal.aborted) {
        reason = 'cancelled';
        break;
      }
      bus.emit({
        type: 'run-failed',
        runId,
        error: e instanceof Error ? e.message : 'provider error',
      });
      throw e;
    }

    const used = {
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: res.usage.cacheWriteTokens ?? 0,
    };
    const quote = estimateCost(opts.model, used);
    inputTokens += used.inputTokens;
    outputTokens += used.outputTokens;
    cacheReadTokens += used.cacheReadTokens;
    cacheWriteTokens += used.cacheWriteTokens;
    costUsd += quote.usd;
    // D37: remember the authoritative input token count for the next
    // pre-turn `context` event.
    lastInputTokens = used.inputTokens;
    bus.emit({
      type: 'usage',
      runId,
      turn,
      inputTokens: used.inputTokens,
      outputTokens: used.outputTokens,
      costUsd: quote.usd,
      cacheReadTokens: used.cacheReadTokens,
      cacheWriteTokens: used.cacheWriteTokens,
    });

    messages.push({ role: 'assistant', content: res.content });

    const toolUses = res.content.filter(
      (b): b is Extract<CanonicalContent, { type: 'tool_use' }> =>
        b.type === 'tool_use',
    );

    for (const block of res.content) {
      if (block.type === 'text') {
        finalText += block.text;
        bus.emit({ type: 'text', runId, text: block.text });
      }
    }

    if (toolUses.length === 0) {
      const truncated = res.stopReason === 'max_tokens';
      // Auto-continue (D25f follow-up): an answer cut by the output cap is a
      // truncated reply, NOT a completion. Ask the model to resume exactly
      // where it stopped, then judge the continuation as a fresh turn.
      // Bounded: one continuation per run, never more.
      //
      // D49s: there must also be something to continue FROM. A reasoning model
      // can spend the whole output budget on tokens this adapter never reads
      // (`reasoning_content`), leaving the turn with no content at all — and
      // "continue exactly where you left off" is then a request that cannot
      // succeed. Worse, it sent an assistant turn carrying neither text nor a
      // tool call, which the wire contract forbids; the second real run died on
      // precisely that (DeepSeek via LiteLLM: "Invalid assistant message:
      // content or tool_calls must be set"). An empty capped turn now ends the
      // run with the cap note, which is what actually happened.
      if (truncated && res.content.length > 0 && !autoContinued) {
        autoContinued = true;
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: '[plato] The previous reply hit the output token cap. Continue exactly where you left off — do not repeat work already written.',
            },
          ],
        });
        continue;
      }
      // Surface a truncated ANSWER as a cap, never as a silent 'complete'.
      // D49ab: this is now the only 'cap' — the turn count no longer exists, so
      // '[plato] turn cap reached; stopping.' is gone with it.
      reason = truncated ? 'cap' : 'complete';
      truncatedStop = truncated;
      capNote = truncated
        ? '[plato] output hit the token cap; the answer may be incomplete.'
        : null;
      break;
    }

    const results: ToolResultBlock[] = [];
    for (const call of toolUses) {
      // Safe point between tool calls (D24b).
      if (!(await ctrl.gate())) {
        reason = 'cancelled';
        stopAfterTools = true;
        break;
      }
      // D49aw: guidance is new information, so the model gets a fresh chance —
      // no card is raised on the strength of turns that happened before someone
      // spoke. Without this a user who helps at turn 4 is asked about turns 1-3.
      const drained = ctrl.drainGuidance();
      if (drained.length > 0) stuck.reset();
      pendingGuidance.push(...drained);
      const name = call.name;
      const args = (call.input ?? {}) as ToolArgs;

      // D49k: refuse a path outside the workspace BEFORE asking the user to
      // approve an action that could never run. The executor enforces the same
      // rule again — this one is for the user's benefit, that one is the
      // guarantee.
      const contained = containmentRefusal(opts.root, name, args);
      const refusal =
        contained ?? secretRefusal(name as Parameters<typeof secretRefusal>[0], args);
      if (refusal !== null) {
        // D49aq: the guard is loud. It used to push a tool_result to the model
        // and emit NOTHING, so the transcript showed the same thing whether the
        // guard refused a call or the model never made one — and a guard whose
        // refusals cannot be read back cannot be audited or debugged.
        // D49as: it carries `args` like every other tool-event. Omitting them was
        // what kept a refusal out of the LIVE log: the host bridge only forwards
        // an event that has args, so the reason never reached the conversation
        // even though the transcript view showed it. The reason CODE is the new
        // field; the arguments were always stripped before the file (D24c).
        bus.emit({
          type: 'tool-event',
          runId,
          tool: name,
          phase: 'refused',
          args,
          reason: contained !== null ? 'containment' : 'secret',
        });
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: refusal,
          isError: true,
        });
        // A guard refusal is deterministic text, so repeating it IS a loop. It
        // is not a tool FAILURE though, so it never counts toward no-progress.
        judge(name, args, refusal, 'blocked');
        continue;
      }

      // D49an: `decideWithArgs` is `decide` plus the read-only-shell allowance,
      // which is the only verdict that needs the arguments. A command that names
      // a protected file was already refused above, so it cannot reach this.
      const decision = decideWithArgs(name, opts.getMode(), args);
      let allowed = decision === 'allow';

      if (decision === 'deny') {
        const blockedMsg = `blocked: ${name} is not permitted in ${opts.getMode()} mode`;
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: blockedMsg,
          isError: true,
        });
        bus.emit({ type: 'tool-event', runId, tool: name, phase: 'denied', args });
        judge(name, args, blockedMsg, 'blocked');
        continue;
      }

      if (decision === 'ask') {
        bus.emit({ type: 'tool-event', runId, tool: name, phase: 'requested', args });
        const preview = await buildApprovalPreview(opts.root, name, args);
        bus.emit({ type: 'approval-requested', runId, tool: name, preview });
        const host = approvalHost(name, args);
        allowed = await opts.approve({
          tool: name,
          args,
          preview,
          runId,
          ...(host !== undefined ? { host } : {}),
        });
        bus.emit({ type: 'approval-decided', runId, tool: name, allowed });
        if (!allowed) {
          results.push({
            type: 'tool_result',
            toolUseId: call.id,
            content: 'user declined this action',
            isError: true,
          });
          bus.emit({ type: 'tool-event', runId, tool: name, phase: 'declined', args });
          // D49aw: the user's own refusal is invisible here. Counting it would
          // raise "you look stuck" at the user because the USER said no — and in
          // `edit`/`act` mode that is five clicks away from a nuisance.
          judge(name, args, 'user declined this action', 'declined');
          continue;
        }
      }

      if (decision === 'allow') {
        bus.emit({ type: 'tool-event', runId, tool: name, phase: 'requested', args });
      }
      bus.emit({ type: 'tool-event', runId, tool: name, phase: 'allowed', args });

      const outcome = await (async () => {
        // ask_user routes through the shell's user-question UI (D34).
        // The model can ask multiple questions at once.
        if (name === 'ask_user' && opts.askUser) {
          try {
            const raw = Array.isArray(args['questions']) ? args['questions'] : [];
            const questions = raw.map((q) => {
              const rec = q as unknown as Record<string, unknown>;
              return {
                question: String(rec['question'] ?? ''),
                context: typeof rec['context'] === 'string' ? rec['context'] : undefined,
                options: Array.isArray(rec['options'])
                  ? (rec['options'] as unknown[]).map(String)
                  : [],
                recommended: typeof rec['recommended'] === 'string' ? rec['recommended'] : undefined,
                // D49al: only an explicit `true` makes a question multi-select,
                // so a model that omits the field keeps single-answer behaviour.
                multiple: rec['multiple'] === true,
              };
            });
            if (questions.length === 0) {
              return { ok: false, output: 'ask_user: no questions provided' };
            }
            const answers = await opts.askUser({ questions });
            const text = answers
              .map((a, i) =>
                questions.length === 1
                  ? String(a)
                  : // D49al: the singular/plural label is the only signal the model
                    // gets that a question allowed several picks. Without it a
                    // multi answer reads exactly like a single one that happens to
                    // contain semicolons.
                    `Q${i + 1}: ${questions[i]!.question}\n${
                      questions[i]!.multiple ? 'Answers' : 'Answer'
                    }: ${String(a)}`,
              )
              .join('\n\n');
            return { ok: true, output: text || '(no answer given)' };
          } catch (e) {
            return {
              ok: false,
              output: `ask_user failed: ${
                e instanceof Error ? e.message : 'error'
              }`,
            };
          }
        }
        const mcp = mcpByTool.get(name);
        if (mcp) {
          try {
            const content = (await mcp.srv.callTool(
              mcp.tool,
              args,
            )) as { text?: string }[];
            const text = content
              .map((c) => String(c.text ?? ''))
              .join('\n')
              .slice(0, 8000);
            return { ok: true, output: text || '(no output)' };
          } catch (e) {
            return {
              ok: false,
              output: `mcp tool failed: ${
                e instanceof Error ? e.message : 'error'
              }`,
            };
          }
        }
        return executeTool(opts.root, name, args, {
          shells,
          signal: ctrl.signal,
        });
      })();
      bus.emit({
        type: 'tool-event',
        runId,
        tool: name,
        phase: 'done',
        ok: outcome.ok,
        args,
      });
      // D49av: the host gets one chance to add to what the model is told about a
      // successful write — how else would Plato learn that the editor reports it
      // just broke the file? Only writes, only on success, and a failure here is
      // swallowed: a diagnostics problem must never fail a run.
      let content = outcome.output;
      if (outcome.ok && isWriteTool(name) && opts.afterToolResult) {
        try {
          const suffix = await opts.afterToolResult({
            tool: name,
            args,
            ok: outcome.ok,
            signal: ctrl.signal,
          });
          if (typeof suffix === 'string' && suffix.length > 0) {
            content = `${content}\n\n${suffix}`;
          }
        } catch {
          /* best effort — see the comment above */
        }
      }
      results.push({
        type: 'tool_result',
        toolUseId: call.id,
        content,
        isError: !outcome.ok,
      });
      judge(name, args, content, outcome.ok ? 'ok' : 'failed');
    }

    if (stopAfterTools) {
      break;
    }

    // D49aw: judge the turn now that it is behind us — "nothing succeeded" is a
    // fact about a finished turn, never about a moment inside one. A first trip
    // only tells the MODEL to change approach; the user is asked only if that
    // does not work. Nothing here ends a run silently.
    let stoppedForStuck = false;
    for (const v of [...judged.splice(0), stuck.endTurn()]) {
      if (v.kind === 'nudge') {
        stuckNotes.push(v.text);
        bus.emit({ type: 'notice', runId, text: v.note });
        opts.onStuckNudge?.(v.note);
        continue;
      }
      if (v.kind !== 'ask') continue;
      bus.emit({ type: 'notice', runId, text: askNote(v.request) });
      // Nobody to ask means stop — the honest reading of "we are stuck", and
      // the default Cline ships. Never a silent end: `stuckNote` says why.
      const answer = opts.onStuckAsk
        ? await opts.onStuckAsk(v.request)
        : { action: 'stop' as const };
      stuck.resolve(answer.action);
      if (answer.action === 'stop') {
        reason = 'stuck';
        stuckNote = stuckStopNote(v.request);
        bus.emit({ type: 'notice', runId, text: stuckNote });
        stoppedForStuck = true;
        break;
      }
      stuckNotes.push(continueText(v.request, answer.guidance ?? ''));
    }
    if (stoppedForStuck) break;

    // Flush queued observer guidance into the next user turn (D24b);
    // tool_result and text blocks may share one user message.
    const userContent: (CanonicalContent | ToolResultBlock)[] = [...results];
    for (const g of pendingGuidance.splice(0)) {
      userContent.push({ type: 'text', text: `[observer guidance] ${g}` });
    }
    for (const n of stuckNotes.splice(0)) {
      userContent.push({ type: 'text', text: n });
    }
    messages.push({ role: 'user', content: userContent });
  }

  if (capNote) {
    finalText += '\n' + capNote;
    bus.emit({ type: 'text', runId, text: '\n' + capNote });
  }
  bus.emit({
    type: 'run-completed',
    runId,
    reason,
    turns: turn,
    inputTokens,
    outputTokens,
    costUsd,
    truncated: truncatedStop,
  });
  return {
    finalText,
    turns: turn,
    reason,
    ...(stuckNote === undefined ? {} : { stuckNote }),
    inputTokens,
    outputTokens,
    costUsd,
    cacheReadTokens,
    truncated: truncatedStop,
  };
}
