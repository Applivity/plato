import { describe, expect, it } from 'vitest';
import {
  applyFold,
  isMessageRow,
  lastSummaryIndex,
  planFold,
  requestFromLog,
  tailPairs,
  type LogRow,
} from '../src/runtime/chatlog.js';

/**
 * D49aa. The founder's report: a run ended, a fold ran, and the conversation he
 * could scroll was gone — replaced by a summary. The fold had cleared the log
 * and rebuilt it from the summary plus a kept tail.
 *
 * The rule these pin: **a fold may change what the model is sent, and must never
 * remove a row from the transcript.** The two readers below are the whole
 * contract — the fold writes one row at the cut, and the request is derived.
 */

const you = (text: string): LogRow => ({ k: 'msg', cls: 'you', text });
const bot = (text: string): LogRow => ({ k: 'msg', cls: 'bot', text });
// Only `k` matters to these rules — the shell's row carries more, and the rules
// deliberately do not depend on it.
const tool = (): LogRow => ({ k: 'tool' });
const summary = (text: string): LogRow => ({ k: 'compact', text });

/** A tool-heavy exchange, the shape that made the fold visible to the founder. */
const exchange = (n: number): LogRow[] => [
  you('ask ' + n),
  tool(),
  tool(),
  bot('answer ' + n),
];

const conversation = (n: number): LogRow[] =>
  Array.from({ length: n }, (_, i) => exchange(i + 1)).flat();

describe('message rows (D49aa)', () => {
  it('counts you/bot rows and nothing else', () => {
    expect(isMessageRow(you('a'))).toBe(true);
    expect(isMessageRow(bot('b'))).toBe(true);
    expect(isMessageRow(tool())).toBe(false);
    expect(isMessageRow(summary('s'))).toBe(false);
    expect(isMessageRow({ k: 'card-open' })).toBe(false);
  });
});

describe('planFold (D49aa)', () => {
  it('does nothing while the tail fits', () => {
    expect(planFold(conversation(2), 12)).toBeNull();
  });

  /**
   * The load-bearing assertion of this whole change. The old writer rebuilt the
   * log as [summary, ...tail]; this one writes a single row and leaves the rest
   * where it was, so the transcript only ever grows.
   */
  it('writes a row without removing any row from the log', () => {
    const rows = conversation(8); // 16 message rows
    const plan = planFold(rows, 12);
    expect(plan).not.toBeNull();
    const after = applyFold(rows, plan!, summary('S') as never);
    expect(after).toHaveLength(rows.length + 1);
    // Every original row is still present, in order — nothing was replaced.
    let j = 0;
    for (const row of after) {
      if (row.k === 'compact') continue;
      expect(row).toBe(rows[j]);
      j += 1;
    }
    expect(j).toBe(rows.length);
  });

  /**
   * The exact shape that caused the founder's report, kept as a regression pin:
   * `log.length = 0` then the summary and the kept tail. If anyone reintroduces
   * this as "the fold", these are the two lines that say what it costs.
   */
  it('the discarded rewrite dropped everything it summarised', () => {
    const rows = conversation(8);
    const plan = planFold(rows, 12)!;
    const destructive = [summary('S') as LogRow, ...rows.slice(plan.insertAt)];
    expect(destructive.length).toBeLessThan(rows.length);
    expect(destructive.some((r) => r.text === 'ask 1')).toBe(false);
  });

  it('keeps exactly the requested number of tail pairs', () => {
    const rows = conversation(8);
    const plan = planFold(rows, 12)!;
    const after = [
      ...rows.slice(0, plan.insertAt),
      summary('S'),
      ...rows.slice(plan.insertAt),
    ];
    expect(tailPairs(after)).toBe(12);
  });

  it('covers every message older than the kept tail', () => {
    const rows = conversation(8); // 16 messages, keep 12 -> covers 4
    const plan = planFold(rows, 12)!;
    expect(plan.covered).toHaveLength(4);
    expect(plan.covered.map((r) => r.text)).toEqual([
      'ask 1',
      'answer 1',
      'ask 2',
      'answer 2',
    ]);
  });

  /**
   * Rows before the marker stay in the log now, so the fold must not reach back
   * past it — the previous summary already accounts for them, and re-summarising
   * them would send the same ground twice under two different summaries.
   */
  it('never reaches back past the last summary', () => {
    const rows = [...conversation(8), summary('S1'), ...conversation(8)];
    const marker = lastSummaryIndex(rows);
    const plan = planFold(rows, 12)!;
    for (const row of plan.covered) {
      expect(rows.indexOf(row)).toBeGreaterThan(marker);
    }
    expect(plan.covered).toHaveLength(4);
  });

  it('folds again only after the tail grows past the keep count', () => {
    const rows = conversation(8);
    const plan = planFold(rows, 12)!;
    const folded = [
      ...rows.slice(0, plan.insertAt),
      summary('S'),
      ...rows.slice(plan.insertAt),
    ];
    expect(planFold(folded, 12)).toBeNull();
    // Six more exchanges push it over again.
    const more = [...folded, ...conversation(6)];
    expect(planFold(more, 12)).not.toBeNull();
  });
});

describe('requestFromLog (D49aa)', () => {
  it('sends the summary first, then the tail', () => {
    const rows = conversation(8);
    const plan = planFold(rows, 12)!;
    const after = [
      ...rows.slice(0, plan.insertAt),
      summary('THE SUMMARY'),
      ...rows.slice(plan.insertAt),
    ];
    const req = requestFromLog(after, 60);
    expect(req[0]).toEqual({
      role: 'user',
      text: '[Summary of the earlier conversation]\nTHE SUMMARY',
    });
    expect(req[1]!.text).toBe('ask 3');
    expect(req).toHaveLength(13); // summary + 12 kept messages
  });

  // The transcript growing must not quietly grow the request too.
  it('is unaffected by rows the fold left in front of the summary', () => {
    const rows = conversation(8);
    const plan = planFold(rows, 12)!;
    const minimal = [
      ...rows.slice(0, plan.insertAt),
      summary('S'),
      ...rows.slice(plan.insertAt),
    ];
    // The same fold, but with a pile of older transcript in front of it.
    const historical = [you('ancient'), bot('reply'), ...minimal];
    expect(requestFromLog(historical, 60)).toEqual(
      requestFromLog(minimal, 60),
    );
  });

  it('uses the LAST summary as the memory boundary', () => {
    const req = requestFromLog([summary('old'), you('a'), summary('new'), bot('b')], 60);
    expect(req[0]!.text).toContain('new');
    expect(req.map((r) => r.text)).not.toContain('a');
  });

  it('caps the tail when a fold was skipped', () => {
    const req = requestFromLog(conversation(40), 60);
    expect(req).toHaveLength(60);
    // 40 exchanges are 80 message rows; keeping the last 60 starts at the 21st,
    // which is the ask of exchange 11.
    expect(req[0]!.text).toBe('ask 11');
  });

  it('sends nothing for an empty log', () => {
    expect(requestFromLog([], 60)).toEqual([]);
  });
});

describe('lastSummaryIndex (D49aa)', () => {
  it('reports -1 when no fold has happened', () => {
    expect(lastSummaryIndex(conversation(2))).toBe(-1);
  });

  it('reports the newest of several summaries', () => {
    expect(lastSummaryIndex([summary('a'), you('x'), summary('b'), bot('y')])).toBe(2);
  });
});
