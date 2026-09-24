import { describe, expect, it } from 'vitest';
import {
  applyFold,
  buildFoldPrompt,
  digestToolCall,
  isMessageRow,
  lastSummaryIndex,
  planFold,
  requestFromLog,
  tailPairs,
  toolLine,
  DIGEST_MAX,
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
 *
 * D49ag added the second half: the fold's reader was correct and the rows it read
 * were EMPTY. A tool row said that a tool ran and nothing else, so a fold
 * summarised a run's narration and none of its work. Measured on the founder's
 * 78-turn run: tool results were **80.8%** of the final request, and the fold
 * could see 0% of them.
 */

const you = (text: string): LogRow => ({ k: 'msg', cls: 'you', text });
const bot = (text: string): LogRow => ({ k: 'msg', cls: 'bot', text });
const tool = (): LogRow => ({ k: 'tool' });
/** D49ag: the row the shell now writes — a tool, what it was for, whether it worked. */
const ran = (name: string, digest: string, ok = true): LogRow =>
  ({ k: 'tool', tool: name, phase: 'done', digest, ok });
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
    expect(plan.covered.filter(isMessageRow)).toHaveLength(4);
    expect(plan.covered.filter(isMessageRow).map((r) => r.text)).toEqual([
      'ask 1',
      'answer 1',
      'ask 2',
      'answer 2',
    ]);
  });

  /**
   * D49ag, and the assertion this whole change is for. A fold is handed the
   * conversation's message rows for its summary; the exchange helper puts two
   * tool rows in each exchange, so covering two exchanges must hand over four
   * tool rows as well — in the position they happened, because the order is what
   * makes a summary a record of the work instead of a list of it.
   */
  it('covers the tool rows in the same span, in log order (D49ag)', () => {
    const rows: LogRow[] = [
      you('ask 1'),
      ran('read_file', 'src/A.java'),
      ran('shell', './gradlew test', false),
      bot('answer 1'),
      you('ask 2'),
      tool(), // a row written before D49ag carries no name and is still covered
      bot('answer 2'),
      ...conversation(6),
    ];
    const plan = planFold(rows, 12)!;
    const kinds = plan.covered.map((r) =>
      r.k === 'tool' ? 'tool' : (r.text ?? ''),
    );
    expect(kinds).toEqual([
      'ask 1',
      'tool',
      'tool',
      'answer 1',
      'ask 2',
      'tool',
      'answer 2',
    ]);
  });

  it('the summary a fold is given can name what the run did (D49ag)', () => {
    const rows: LogRow[] = [
      you('fix the formatter'),
      ran('read_file', 'src/FormatterUtility.java'),
      ran('apply_diff', 'src/FormatterUtility.java'),
      bot('I fixed the truncation bug.'),
      ...conversation(6),
    ];
    const plan = planFold(rows, 12)!;
    // This is the exact sentence the founder's real summary could not produce.
    const rendered = plan.covered.map(toolLine).join('\n');
    expect(rendered).toContain('read_file src/FormatterUtility.java');
    expect(rendered).toContain('apply_diff src/FormatterUtility.java');
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
    expect(plan.covered.filter(isMessageRow)).toHaveLength(4);
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

/**
 * D49ag. The digest is the ARGUMENT, never the result — and that line is the
 * whole design. `args` for `write_file` is a file body and for `apply_diff` is a
 * diff; copying either into the log would put the work back into the log that
 * compaction exists to shed.
 */
describe('digestToolCall (D49ag)', () => {
  it('names the file a file tool touched', () => {
    expect(digestToolCall('read_file', { path: 'src/A.java' })).toBe('src/A.java');
    expect(digestToolCall('write_file', { path: 'src/B.java' })).toBe('src/B.java');
    expect(digestToolCall('list_dir', { path: 'src' })).toBe('src');
  });

  it('never copies a file body or a diff into the log', () => {
    const body = 'x'.repeat(50_000);
    const d = digestToolCall('write_file', { path: 'src/B.java', content: body });
    expect(d).toBe('src/B.java');
    expect(d).not.toContain('x');
    const diff = digestToolCall('apply_diff', {
      path: 'src/B.java',
      diffs: [{ search: body, replace: body }],
    });
    expect(diff).toBe('src/B.java');
  });

  it('names every file an atomic patch touches', () => {
    expect(
      digestToolCall('apply_patch', {
        patches: [{ path: 'a.ts', diffs: [] }, { path: 'b.ts', diffs: [] }],
      }),
    ).toBe('a.ts b.ts');
  });

  it('gives a grep its pattern and its filter', () => {
    expect(
      digestToolCall('grep', { pattern: 'URLDecoder', glob: '**/*.java' }),
    ).toBe('for URLDecoder in **/*.java');
  });

  it('gives a shell call its command', () => {
    expect(digestToolCall('shell', { command: './gradlew test' })).toBe(
      './gradlew test',
    );
  });

  it('marks a background shell, which the next rows refer back to', () => {
    expect(
      digestToolCall('shell', { command: 'npm run dev', run_in_background: true }),
    ).toBe('npm run dev (background)');
  });

  it('counts the questions an ask_user put to the user', () => {
    expect(digestToolCall('ask_user', { questions: [{}] })).toBe('1 question');
    expect(digestToolCall('ask_user', { questions: [{}, {}, {}] })).toBe(
      '3 questions',
    );
  });

  it('stays on one line and within its bound', () => {
    const d = digestToolCall('shell', { command: 'a\n'.repeat(500) });
    expect(d).not.toContain('\n');
    expect(d.length).toBeLessThanOrEqual(DIGEST_MAX);
  });

  it('is empty when nothing salient is known', () => {
    expect(digestToolCall('kill_shell', {})).toBe('');
    expect(digestToolCall('read_file', { path: '' })).toBe('');
  });

  /**
   * D49ah. A plan is the one thing in a run that SHOULD outlive it, so it gets a
   * digest like everything else — but the shape, not the text: ten item lines
   * would spend the log's room on a list the panel already shows, and DIGEST_MAX
   * would cut it mid-list, which reads as a whole plan that is not.
   */
  it('records a plan by its shape, where the run had got to (D49ah)', () => {
    const d = digestToolCall('todo_write', {
      todos: [
        { content: 'Read the utility', status: 'completed' },
        { content: 'Fix the formatter', status: 'in_progress' },
        { content: 'Add a test', status: 'pending' },
      ],
    });
    expect(d).toBe('3 items, 1 done, in progress: Fix the formatter');
    expect(d.length).toBeLessThanOrEqual(DIGEST_MAX);
  });

  it('says nothing rather than guessing at a malformed plan (D49ah)', () => {
    expect(digestToolCall('todo_write', { todos: 'do the thing' })).toBe('');
  });
});

/**
 * D49ag, end to end at the level that matters: the TEXT the summariser is given.
 * The founder's real summary said *"No files read (contents not available in
 * transcript)"* — a sentence about an empty prompt, not about the model. This is
 * the test that would have caught it.
 */
describe('buildFoldPrompt (D49ag)', () => {
  const rows: LogRow[] = [
    you('fix the three utility classes'),
    ran('read_file', 'src/DateHelper.java'),
    ran('read_file', 'src/FormatterUtility.java'),
    ran('apply_diff', 'src/FormatterUtility.java'),
    ran('shell', './gradlew test', false),
    bot('Two fixed, one left alone.'),
  ];

  it('tells the summariser which files were read and changed', () => {
    const p = buildFoldPrompt(null, rows);
    expect(p).toContain('read_file src/DateHelper.java');
    expect(p).toContain('read_file src/FormatterUtility.java');
    expect(p).toContain('apply_diff src/FormatterUtility.java');
  });

  it('says a command failed, which a summary must not swallow', () => {
    expect(buildFoldPrompt(null, rows)).toContain('./gradlew test (failed)');
  });

  it('keeps the work in the order it happened', () => {
    const p = buildFoldPrompt(null, rows);
    const at = (s: string): number => p.indexOf(s);
    // The log's order, which is the run's order: the ask, then the tools it
    // caused, then the answer. A summary built from a sorted or grouped list
    // would pass every other test here and be a worse record than the log.
    const order = [
      '--- USER ---',
      'read_file src/DateHelper.java',
      'read_file src/FormatterUtility.java',
      'apply_diff src/FormatterUtility.java',
      './gradlew test',
      '--- ASSISTANT ---',
    ];
    const seen = order.map(at);
    expect(seen.every((i) => i >= 0)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('carries the prior summary, so a fold of a fold loses nothing', () => {
    const p = buildFoldPrompt('EARLIER: read the build file.', rows);
    expect(p).toContain('EARLIER: read the build file.');
    // ...and it must come before the rows it summarises on top of.
    expect(p.indexOf('EARLIER:')).toBeLessThan(p.indexOf('USER'));
  });

  it('is just the instruction when there is nothing to summarise', () => {
    const p = buildFoldPrompt(null, []);
    expect(p).toContain('Be terse and fact-only.');
    expect(p).not.toContain('USER');
    expect(p).not.toContain('TOOL');
  });
});

describe('toolLine (D49ag)', () => {
  it('separates a refusal, a decline and a failure', () => {
    expect(toolLine({ k: 'tool', tool: 'shell', phase: 'denied', digest: 'ls' }))
      .toBe('shell ls (not permitted in this mode)');
    expect(toolLine({ k: 'tool', tool: 'shell', phase: 'declined', digest: 'ls' }))
      .toBe('shell ls (the user declined)');
    expect(toolLine({ k: 'tool', tool: 'shell', phase: 'done', digest: 'ls', ok: false }))
      .toBe('shell ls (failed)');
    expect(toolLine({ k: 'tool', tool: 'shell', phase: 'done', digest: 'ls', ok: true }))
      .toBe('shell ls');
  });

  it('falls back to the bare name for a row written before D49ag', () => {
    expect(toolLine({ k: 'tool', tool: 'read_file', phase: 'done' })).toBe(
      'read_file',
    );
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

  /**
   * D49ag: the tail is no longer tool-blind. Without this the model was handed
   * "I'll look at the formatter" and then the user's next message, with no record
   * of what it read or changed — the same blindness the fold had, one turn later.
   *
   * The note is its own bracketed turn rather than a sentence tacked onto the
   * assistant's, so nothing arrives at the model as words it did not write.
   */
  it('carries the tail’s tool activity, where it happened (D49ag)', () => {
    const rows: LogRow[] = [
      you('fix the formatter'),
      ran('read_file', 'src/F.java'),
      ran('shell', './gradlew test', false),
      bot('Fixed.'),
    ];
    expect(requestFromLog(rows, 60)).toEqual([
      { role: 'user', text: 'fix the formatter' },
      {
        role: 'user',
        text:
          '[tool activity — what Plato ran]\n' +
          '- read_file src/F.java\n' +
          '- shell ./gradlew test (failed)',
      },
      { role: 'assistant', text: 'Fixed.' },
    ]);
  });

  /**
   * A row with no digest is INVISIBLE here, which is what keeps a log written
   * before D49ag producing the same request it always did — the two tests above
   * this one use exactly such rows and still pass unchanged.
   */
  it('skips a tool row that has no digest (D49ag)', () => {
    const rows: LogRow[] = [you('a'), tool(), bot('b')];
    expect(requestFromLog(rows, 60).map((r) => r.text)).toEqual(['a', 'b']);
  });

  it('does not let tool rows push the exchange cap (D49ag)', () => {
    // 40 exchanges, each with its tool rows, capped at 60 exchanges.
    const rows = conversation(40);
    const req = requestFromLog(rows, 60);
    expect(req).toHaveLength(60); // unchanged: the cap counts messages
    expect(req[0]!.text).toBe('ask 11');
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
