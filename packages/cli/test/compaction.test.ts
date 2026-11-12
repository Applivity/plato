import { describe, expect, it } from 'vitest';
import {
  planRequest,
  type ChatProvider,
  type TurnRequest,
  type TurnResponse,
} from '@applivity/plato-core';
import {
  foldConversation,
  requestHistory,
  type ChatRow,
} from '../src/compaction.js';

/**
 * The fold rules through the CLI's own path. The thresholds here are tiny on
 * purpose: a real window would need hundreds of kilobytes of conversation to
 * cross a line that is arithmetic, not behaviour.
 */
function longRows(count: number, length = 2000): ChatRow[] {
  const rows: ChatRow[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      k: 'msg',
      cls: index % 2 === 0 ? 'you' : 'bot',
      text: `message ${index} ${'x'.repeat(length)}`,
    });
  }
  return rows;
}

function summaryProvider(calls: TurnRequest[], text = 'The summary.'): ChatProvider {
  return {
    id: 'openai',
    async completeTurn(request: TurnRequest): Promise<TurnResponse> {
      calls.push(request);
      return {
        content: [{ type: 'text', text }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'stop',
      };
    },
  };
}

describe('conversation fold', () => {
  it('folds only once the history reaches the threshold, and keeps a quarter of the window', async () => {
    const below = longRows(2);
    const silent: TurnRequest[] = [];
    const notYet = await foldConversation({
      rows: below,
      provider: summaryProvider(silent),
      model: 'stub:test-model',
      maxContext: 4000,
      threshold: 0.5,
      cause: 'auto',
    });
    expect(notYet.folded).toBe(false);
    expect(notYet.notice).toBeNull();
    expect(silent).toHaveLength(0);

    const rows = longRows(4);
    const calls: TurnRequest[] = [];
    const outcome = await foldConversation({
      rows,
      provider: summaryProvider(calls),
      model: 'stub:test-model',
      maxContext: 4000,
      threshold: 0.5,
      cause: 'auto',
    });

    expect(outcome.folded).toBe(true);
    expect(calls).toHaveLength(1);
    // The summary asks for the OLDER exchange only: the keep budget is a
    // quarter of the window, and the newest exchange is the floor.
    const prompt = JSON.stringify(calls[0]);
    expect(prompt).toContain('message 0');
    expect(prompt).toContain('message 1');
    expect(prompt).not.toContain('message 3');

    // Nothing is removed: the four originals are still there, plus the summary
    // written at the cut.
    expect(outcome.rows).toHaveLength(5);
    const summaryAt = outcome.rows.findIndex((row) => row.k === 'compact');
    expect(summaryAt).toBe(2);
    expect(outcome.rows.filter((row) => row.k === 'msg')).toHaveLength(4);
    expect(outcome.notice).toContain('reached 50%');
    expect(outcome.notice).toContain('Nothing was removed from the transcript.');

    // The next request is the summary plus the kept tail, not the flat history.
    const next = planRequest(outcome.rows).turns;
    expect(next[0]?.text).toContain('[Summary of the earlier conversation]');
    expect(next[0]?.text).toContain('The summary.');
    expect(next).toHaveLength(3);
    expect(next[1]?.text).toContain('message 2');
    expect(next[2]?.text).toContain('message 3');
  });

  it('a manual fold says the user asked, and does nothing when every message fits', async () => {
    const small = await foldConversation({
      rows: longRows(2),
      provider: summaryProvider([]),
      model: 'stub:test-model',
      maxContext: 4000,
      threshold: 0.8,
      cause: 'manual',
    });
    expect(small.folded).toBe(false);
    expect(small.notice).toBeNull();
    expect(small.share).toBe(25);

    const calls: TurnRequest[] = [];
    const folded = await foldConversation({
      rows: longRows(4),
      provider: summaryProvider(calls),
      model: 'stub:test-model',
      maxContext: 4000,
      threshold: 0.8,
      cause: 'manual',
    });
    expect(folded.folded).toBe(true);
    expect(folded.notice).toBe(
      'Summary added for 2 earlier messages, as you asked. ' +
        'Nothing was removed from the transcript.',
    );
  });

  it('an empty summary leaves the conversation as it was', async () => {
    const rows = longRows(4);
    const outcome = await foldConversation({
      rows,
      provider: summaryProvider([], '   '),
      model: 'stub:test-model',
      maxContext: 4000,
      threshold: 0.5,
      cause: 'auto',
    });
    expect(outcome.folded).toBe(false);
    expect(outcome.rows).toEqual(rows);
    expect(outcome.notice).toContain('no summary');
  });

  it('the request cap is the user line, measured in tokens', () => {
    const rows = longRows(8);
    const plan = requestHistory(rows, 1000, 0.5);
    expect(plan.omitted).toBeGreaterThan(0);
    const first = plan.turns[0]?.text ?? '';
    expect(first).toContain('Earlier messages omitted');
  });
});
