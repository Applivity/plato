/**
 * M1 agent loop (D22a): native tool-use over one runtime. Modes gate each
 * call through decide(); approvals surface through the injected callback.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { toolDeclarations } from '../tools/schemas.js';
import { executeTool } from '../tools/execute.js';
import type { ToolArgs } from '../tools/execute.js';
import type { DiffBlock } from '../tools/diff.js';
import { M0_MODEL } from '../providers/anthropic.js';
import { decide } from './modes.js';
import type { Mode } from './modes.js';
import { MAX_TURNS, secretRefusal } from './modes.js';

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
  apiKey: string;
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
}

export interface LoopResult {
  finalText: string;
  turns: number;
  stoppedByCap: boolean;
}

export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const messages: MessageParam[] = [
    { role: 'user', content: opts.task },
  ];
  let finalText = '';

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: M0_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: toolDeclarations(),
      messages,
    });

    messages.push({ role: 'assistant', content: res.content });

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlockParam, { type: 'tool_use' }> =>
        b.type === 'tool_use',
    );

    for (const block of res.content) {
      if (block.type === 'text') {
        finalText += block.text;
        opts.onText?.(block.text);
      }
    }

    if (toolUses.length === 0 || turn === MAX_TURNS) {
      const stoppedByCap = toolUses.length > 0;
      if (stoppedByCap) {
        finalText += '\n[plato] turn cap reached; stopping.';
        opts.onText?.('\n[plato] turn cap reached; stopping.');
      }
      return { finalText, turns: turn, stoppedByCap };
    }

    const results: ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const name = call.name;
      const args = (call.input ?? {}) as ToolArgs;

      const refusal = secretRefusal(
        name as Parameters<typeof secretRefusal>[0],
        args,
      );
      if (refusal !== null) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: refusal,
          is_error: true,
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
          tool_use_id: call.id,
          content: `blocked: ${name} is not permitted in ${opts.getMode()} mode`,
          is_error: true,
        });
        opts.onToolEvent?.({ tool: name, args, phase: 'denied' });
        continue;
      }

      if (decision === 'ask') {
        opts.onToolEvent?.({ tool: name, args, phase: 'requested' });
        const preview = await buildApprovalPreview(opts.root, name, args);
        allowed = await opts.approve({ tool: name, args, preview });
        if (!allowed) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'user declined this action',
            is_error: true,
          });
          opts.onToolEvent?.({ tool: name, args, phase: 'declined' });
          continue;
        }
      }

      if (decision === 'allow') {
        opts.onToolEvent?.({ tool: name, args, phase: 'requested' });
      }
      opts.onToolEvent?.({ tool: name, args, phase: 'allowed' });

      const outcome = await executeTool(opts.root, name, args);
      opts.onToolEvent?.({
        tool: name,
        args,
        phase: 'done',
        ok: outcome.ok,
      });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: outcome.output,
        is_error: !outcome.ok,
      });
    }

    messages.push({ role: 'user', content: results });
  }

  return { finalText, turns: MAX_TURNS, stoppedByCap: true };
}
