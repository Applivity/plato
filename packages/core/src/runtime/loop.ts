/**
 * M1 agent loop (D22a): native tool-use over one runtime. Modes gate each
 * call through decide(); approvals surface through the injected callback.
 */
import { toolDeclarations } from '../tools/schemas.js';
import { executeTool } from '../tools/execute.js';
import type { ToolArgs } from '../tools/execute.js';
import type { McpServer } from '../mcp/client.js';
import type {
  CanonicalContent,
  CanonicalMessage,
  ChatProvider,
  ReasoningConfig,
  ToolResultBlock,
} from '../providers/types.js';
import { decide } from './modes.js';
import type { Mode } from './modes.js';
import { MAX_TURNS, secretRefusal } from './modes.js';
import { containmentRefusal } from '../security/paths.js';
import { AgentBus, RunController } from './bus.js';
import { DEFAULT_RETRY, withRetry } from '../providers/retry.js';
import type { RetryOptions } from '../providers/retry.js';
import { estimateCost } from './cost.js';
import { maxContextFor, maxOutputFor, splitModelRef } from '../providers/registry.js';
import {
  compactMessages,
  promptBreakdown,
  shouldAutoCompact,
} from './context.js';
import { buildWorkerRole } from './workerRole.js';

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
): Promise<string> {
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
  onToolEvent?: (event: {
    tool: string;
    args: ToolArgs;
    phase: 'requested' | 'allowed' | 'denied' | 'declined' | 'done';
    ok?: boolean;
  }) => void;
  /**
   * Optional M2 event bus (D24a); one is created internally when omitted
   * and legacy callbacks above are bridged onto it.
   */
  bus?: AgentBus;
  /** Observer inbox (D24b): guidance/pause/cancel at safe points. */
  controller?: RunController;
  /** Bound provider adapter (D25b). Replaces the old apiKey field. */
  provider: ChatProvider;
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
  /** Why the run ended: natural completion, turn cap, or observer cancel. */
  reason: 'complete' | 'cap' | 'cancelled';
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
  const ctrl = opts.controller ?? new RunController();
  const runId = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

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
    content: [{ type: 'text', text: opts.task }],
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
  const maxTokens = Math.min(16384, maxOutputFor(bareModel));

  bus.emit({ type: 'run-started', runId, task: opts.task, model: opts.model });

  let turn = 1;
  for (; turn <= MAX_TURNS; turn++) {
    // Safe point (D24b): honour cancel/pause and drain observer guidance.
    if (!(await ctrl.gate())) {
      reason = 'cancelled';
      break;
    }
    pendingGuidance.push(...ctrl.drainGuidance());
    bus.emit({ type: 'turn-started', runId, turn });

    // D37: emit the live context estimate before this turn goes out so
    // the UI's ring is always one step ahead of the model call.
    const maxCtx = maxContextFor(bareModel);
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

    if (toolUses.length === 0 || turn === MAX_TURNS) {
      const truncated = toolUses.length === 0 && res.stopReason === 'max_tokens';
      // Auto-continue (D25f follow-up): an answer cut by the output cap is a
      // truncated reply, NOT a completion. Ask the model to resume exactly
      // where it stopped, then judge the continuation as a fresh turn.
      // Bounded: one continuation per run, never more.
      if (truncated && !autoContinued && turn < MAX_TURNS) {
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
      // Surface it as a cap, never as a silent 'complete'.
      reason = truncated || toolUses.length > 0 ? 'cap' : 'complete';
      truncatedStop = truncated;
      capNote =
        reason === 'cap'
          ? truncated
            ? '[plato] output hit the token cap; the answer may be incomplete.'
            : '[plato] turn cap reached; stopping.'
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
      pendingGuidance.push(...ctrl.drainGuidance());
      const name = call.name;
      const args = (call.input ?? {}) as ToolArgs;

      // D49k: refuse a path outside the workspace BEFORE asking the user to
      // approve an action that could never run. The executor enforces the same
      // rule again — this one is for the user's benefit, that one is the
      // guarantee.
      const refusal =
        containmentRefusal(opts.root, name, args) ??
        secretRefusal(name as Parameters<typeof secretRefusal>[0], args);
      if (refusal !== null) {
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: refusal,
          isError: true,
        });
        continue;
      }

      const decision = decide(
        name as Parameters<typeof decide>[0],
        opts.getMode(),
      );
      let allowed = decision === 'allow';

      if (decision === 'deny') {
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: `blocked: ${name} is not permitted in ${opts.getMode()} mode`,
          isError: true,
        });
        bus.emit({ type: 'tool-event', runId, tool: name, phase: 'denied', args });
        continue;
      }

      if (decision === 'ask') {
        bus.emit({ type: 'tool-event', runId, tool: name, phase: 'requested', args });
        const preview = await buildApprovalPreview(opts.root, name, args);
        bus.emit({ type: 'approval-requested', runId, tool: name, preview });
        allowed = await opts.approve({ tool: name, args, preview });
        bus.emit({ type: 'approval-decided', runId, tool: name, allowed });
        if (!allowed) {
          results.push({
            type: 'tool_result',
            toolUseId: call.id,
            content: 'user declined this action',
            isError: true,
          });
          bus.emit({ type: 'tool-event', runId, tool: name, phase: 'declined', args });
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
                  : `Q${i + 1}: ${questions[i]!.question}\nAnswer: ${String(a)}`,
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
        return executeTool(opts.root, name, args);
      })();
      bus.emit({
        type: 'tool-event',
        runId,
        tool: name,
        phase: 'done',
        ok: outcome.ok,
        args,
      });
      results.push({
        type: 'tool_result',
        toolUseId: call.id,
        content: outcome.output,
        isError: !outcome.ok,
      });
    }

    if (stopAfterTools) {
      break;
    }

    // Flush queued observer guidance into the next user turn (D24b);
    // tool_result and text blocks may share one user message.
    const userContent: (CanonicalContent | ToolResultBlock)[] = [...results];
    for (const g of pendingGuidance.splice(0)) {
      userContent.push({ type: 'text', text: `[observer guidance] ${g}` });
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
    inputTokens,
    outputTokens,
    costUsd,
    cacheReadTokens,
    truncated: truncatedStop,
  };
}
