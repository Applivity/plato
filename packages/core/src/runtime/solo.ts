/**
 * M0 runner: one user prompt + workspace listing -> streamed answer.
 * The M1 tool loop will replace this; it exists to keep M0 minimal.
 */
import type { ChatMessage } from '../providers/anthropic.js';
import { listWorkspaceFiles } from '../tools/files.js';
import { AnthropicProvider } from '../providers/anthropic.js';

export interface RunOptions {
  /** Absolute path to the workspace root listed as context. */
  workspaceRoot: string;
  /** User's question. */
  prompt: string;
}

/**
 * Runs a single grounded prompt against Anthropic, streaming deltas through
 * `onText`. Returns the full answer text.
 */
export async function runSinglePrompt(
  opts: RunOptions,
  apiKey: string,
  onText: (delta: string) => void,
): Promise<string> {
  const listing = listWorkspaceFiles(opts.workspaceRoot);
  const context =
    listing.length > 0
      ? listing.join('\n')
      : '(no readable files found at workspace root)';
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `You are Plato, an AI coding agent.\n` +
        `The workspace contains these files:\n${context}\n\n` +
        `Answer the user's question about this project using ONLY this listing.\n` +
        `Question: ${opts.prompt}`,
    },
  ];
  const provider = new AnthropicProvider(apiKey);
  return provider.streamChat(messages, onText);
}
