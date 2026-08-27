/**
 * M1 agent loop (D22a): native tool-use over one runtime. Modes gate each
 * call through decide(); approvals surface through the injected callback.
 */
import { toolDeclarations } from '../tools/schemas.js';
import { executeTool } from '../tools/execute.js';
import type { ToolArgs } from '../tools/execute.js';
import type { DiffBlock } from '../tools/diff.js';
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
import { AgentBus, RunController } from './bus.js';
import { estimateCost } from './cost.js';

const SYSTEM_PROMPT =
  'You are Plato, an AI coding agent working inside the user workspace. ' +
  'Use the provided tools to inspect and change files. Prefer apply_diff ' +
  'for edits and write_file only for new files. When you find defects, ' +
  'enumerate them briefly, then fix them immediately with tool calls in ' +
  'the same run — never stop to ask whether to proceed; write approval ' +
  'is enforced by the UI, so the user always confirms changes. After ' +
  'applying changes, re-read each changed region to verify the result, ' +
  'and report anything you could not confirm. Stop and summarize once ' +
  'the task is complete. Never touch secrets or ignore errors silently.';

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
  if (tool === 'apply_diff') {
    const rel = typeof args['path'] === 'string' ? args['path'] : '';
    const rawDiffs = Array.isArray(args['diffs']) ? args['diffs'] : [];
    const blocks: DiffBlock[] = [];
    for (const d of rawDiffs as unknown[]) {
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
      }
    }
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const before = await readFile(join(root, rel), 'utf8');
      const { applyBlocks } = await import('../tools/diff.js');
      const { previewDiff } = await import('../tools/diff.js');
      const after = applyBlocks(before, blocks).content;
      const trimmed = previewDiff(before, after);
      return trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
    } catch (e) {
      return `(preview unavailable: ${e instanceof Error ? e.message : 'error'})`;
    }
  }
  if (tool === 'write_file' && typeof args['content'] === 'string') {
    const c = args['content'];
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
  /** Reasoning config; only attach for catalog-flagged models. */
  reasoning?: ReasoningConfig;
  /**
   * Prior conversation as plain text pairs (oldest first) so resumed
   * chats keep context. Same-role neighbors are merged; leading
   * assistant messages are dropped to satisfy role alternation.
   */
  history?: { role: 'user' | 'assistant'; text: string }[];
  /**
   * Started MCP servers (D06). Their tools join the model's tool list
   * as mcp_<server>_<tool> and route through the mode policy like
   * shell-class actions.
   */
  mcpServers?: McpServer[];
}

export interface LoopResult {
  finalText: string;
  turns: number;
  /** Why the run ended: natural completion, turn cap, or observer cancel. */
  reason: 'complete' | 'cap' | 'cancelled';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
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
  let reason: LoopResult['reason'] = 'complete';
  let capNote: string | null = null;
  let stopAfterTools = false;
  const pendingGuidance: string[] = [];

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

    let res;
    try {
      res = await client.completeTurn({
        model: opts.model,
        system: SYSTEM_PROMPT,
        tools: allTools,
        messages,
        maxTokens: 16384,
        reasoning: opts.reasoning,
      });
    } catch (e) {
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
    };
    const quote = estimateCost(opts.model, used);
    inputTokens += used.inputTokens;
    outputTokens += used.outputTokens;
    costUsd += quote.usd;
    bus.emit({
      type: 'usage',
      runId,
      turn,
      inputTokens: used.inputTokens,
      outputTokens: used.outputTokens,
      costUsd: quote.usd,
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
      // A turn truncated by the token cap is NOT a completed answer: the
      // model may have produced no text at all (thinking ate the budget).
      // Surface it as a cap, never as a silent 'complete'.
      const truncated = toolUses.length === 0 && res.stopReason === 'max_tokens';
      reason = truncated || toolUses.length > 0 ? 'cap' : 'complete';
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

      const refusal = secretRefusal(
        name as Parameters<typeof secretRefusal>[0],
        args,
      );
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
  });
  return { finalText, turns: turn, reason, inputTokens, outputTokens, costUsd };
}
