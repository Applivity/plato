import { describe, expect, it } from 'vitest';
import {
  applyFold,
  buildFoldPrompt,
  digestToolCall,
  historyTokens,
  isMessageRow,
  lastSummaryIndex,
  planFold,
  planRequest,
  planTrim,
  requestFromLog,
  toolLine,
  DIGEST_MAX,
  FOLD_KEEP_FRACTION,
  type LogRow,
} from '../src/runtime/chatlog.js';
import { INBOUND_MARKER, REPLY_MARKER } from '../src/live.js';

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
/** D49cq: what the receiving chat records for a message another session sent. */
const inbound = (text: string): LogRow => ({
  k: 'msg',
  cls: 'in',
  who: 'From Fix the parser',
  from: 'VS Code',
  text,
});
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

/** A message of an exact size in characters; 4 chars is one estimated token. */
const sized = (role: 'you' | 'bot', tag: string, chars: number): LogRow => ({
  k: 'msg',
  cls: role,
  text: tag + ' ' + 'x'.repeat(Math.max(0, chars - tag.length - 1)),
});
/** `n` exchanges, each message exactly `chars` long. */
const large = (n: number, chars = 400): LogRow[] =>
  Array.from({ length: n }, (_, i) => [
    sized('you', 'q' + i, chars),
    sized('bot', 'a' + i, chars),
  ]).flat();

describe('message rows (D49aa)', () => {
  it('counts you/bot rows and nothing else', () => {
    expect(isMessageRow(you('a'))).toBe(true);
    expect(isMessageRow(bot('b'))).toBe(true);
    expect(isMessageRow(tool())).toBe(false);
    expect(isMessageRow(summary('s'))).toBe(false);
    expect(isMessageRow({ k: 'card-open' })).toBe(false);
  });

  // D49cq: a message another session sent is part of the conversation. If it
  // were not a message row, the run it started would be invisible to the next
  // run and to every fold — leaving an assistant answer with no question.
  it('counts a message from another session, so a later run and a fold see it', () => {
    expect(isMessageRow(inbound('is the build green?'))).toBe(true);
  });
});

describe('replaying a message from another session (D49cq)', () => {
  const row = inbound('is the build green?');

  it('reaches the model as a USER turn, not as something Plato said', () => {
    const turns = requestFromLog([row, bot('Yes.')], 60);
    expect(turns[0]!.role).toBe('user');
    expect(turns[1]).toEqual({ role: 'assistant', text: 'Yes.' });
  });

  it('keeps its provenance on every replay, not only in the run that received it', () => {
    const [turn] = requestFromLog([row], 60);
    expect(turn!.text.startsWith(INBOUND_MARKER)).toBe(true);
    expect(turn!.text).toContain('Fix the parser');
    expect(turn!.text).toContain('VS Code');
    expect(turn!.text).toContain('This is not from the user.');
    expect(turn!.text).toContain('is the build green?');
  });

  it('replays a reply as the end of the exchange, so a later run cannot answer back', () => {
    const reply: LogRow = { ...inbound('green since 9:12'), reply: true, who: 'Reply from Builder' };
    const [turn] = requestFromLog([reply], 60);
    expect(turn!.text.startsWith(REPLY_MARKER)).toBe(true);
    expect(turn!.text).toContain('Builder');
    expect(turn!.text).toContain('do not reply again');
    expect(turn!.text).toContain('green since 9:12');
  });
});

/**
 * D44d amended (2026-11-12). The fold used to be a COUNT: run at 26 message rows
 * (13 exchanges), keep 12 rows. A real client run on a 1,000,000-token window —
 * prompt peak 203,228 tokens, 20% — was folded anyway and told the user so.
 *
 * These pin the rule that replaced it. The window is small so the fixtures can
 * be small; the arithmetic is the same at any size.
 */
describe('planFold (D49aa, D44d amended)', () => {
  const WINDOW = 1000;
  const THRESHOLD = 0.8;
  const plan = (rows: LogRow[], manual = false) =>
    planFold(rows, { maxContext: WINDOW, threshold: THRESHOLD, manual });

  it('does nothing while the history fits the window and threshold', () => {
    expect(plan(conversation(2))).toBeNull();
  });

  /**
   * The founder's point, as one pair: size decides, not how many messages there
   * are. 200 messages of two words never fold; 12 messages of a paragraph each
   * do.
   */
  it('folds a few large messages before many short ones', () => {
    const manyShort = conversation(100); // 200 message rows, ~420 tokens
    expect(historyTokens(manyShort)).toBeLessThan(WINDOW * THRESHOLD);
    expect(plan(manyShort)).toBeNull();

    const fewLarge = large(6); // 12 message rows, 1,200 tokens
    expect(historyTokens(fewLarge)).toBeGreaterThanOrEqual(WINDOW * THRESHOLD);
    expect(plan(fewLarge)).not.toBeNull();
  });

  it('does not fold below the threshold, however many messages it has', () => {
    const rows = conversation(150); // 300 message rows
    expect(rows.filter(isMessageRow)).toHaveLength(300);
    expect(historyTokens(rows)).toBeLessThan(WINDOW * THRESHOLD);
    expect(plan(rows)).toBeNull();
  });

  it('measures against the selected model window: a small one folds earlier', () => {
    const rows = large(6); // 1,200 tokens
    expect(
      planFold(rows, { maxContext: WINDOW, threshold: THRESHOLD }),
    ).not.toBeNull();
    // The same conversation, same threshold, a window it comfortably fits.
    expect(
      planFold(rows, { maxContext: 100_000, threshold: THRESHOLD }),
    ).toBeNull();
  });

  /**
   * The load-bearing assertion of D49aa. The old writer rebuilt the log as
   * [summary, ...tail]; this one writes a single row and leaves the rest where
   * it was, so the transcript only ever grows.
   */
  it('writes a row without removing any row from the log', () => {
    const rows = large(8); // 16 messages, 1,600 tokens
    const p = plan(rows);
    expect(p).not.toBeNull();
    const after = applyFold(rows, p!, summary('S') as never);
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
   * The exact shape that caused the founder's first report, kept as a regression
   * pin: `log.length = 0` then the summary and the kept tail. If anyone
   * reintroduces this as "the fold", these are the two lines that say what it
   * costs.
   */
  it('the discarded rewrite dropped everything it summarised', () => {
    const rows = large(8);
    const p = plan(rows)!;
    const destructive = [summary('S') as LogRow, ...rows.slice(p.insertAt)];
    expect(destructive.length).toBeLessThan(rows.length);
    expect(destructive.some((r) => r.text === rows[0]!.text)).toBe(false);
  });

  /**
   * Requirement, word for word: the newest messages the budget affords are kept
   * as they were written. 400 characters is 100 tokens; the 250-token budget
   * keeps the newest two and not the third.
   */
  it('keeps the newest messages that fit the budget, word for word', () => {
    const rows = large(10); // 20 messages, 2,000 tokens
    const p = plan(rows)!;
    const kept = rows
      .slice(p.insertAt)
      .filter(isMessageRow)
      .map((r) => r.text ?? '');
    expect(kept).toEqual([rows[18]!.text, rows[19]!.text]);
    expect(p.covered.filter(isMessageRow)).toHaveLength(18);
    const keptTokens = kept.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    expect(keptTokens).toBeLessThanOrEqual(
      Math.floor(WINDOW * FOLD_KEEP_FRACTION),
    );
  });

  it('counts the summary already in the log against the keep budget', () => {
    const plain = large(10, 200); // 20 messages x 50 tokens = 1,000 tokens
    const p = plan(plain)!;
    // 250-token budget on 50-token messages keeps five.
    expect(plain.slice(p.insertAt).filter(isMessageRow)).toHaveLength(5);
    // A 100-token summary is SENT with the tail, so it spends 100 of the 250:
    // three messages fit instead of five.
    const withSummary = [summary('s'.repeat(400)), ...plain];
    const p2 = plan(withSummary)!;
    expect(withSummary.slice(p2.insertAt).filter(isMessageRow)).toHaveLength(3);
  });

  it('covers every message older than the kept tail', () => {
    const rows = large(10);
    const p = plan(rows)!;
    expect(p.covered.filter(isMessageRow).map((r) => r.text)).toEqual(
      rows.slice(0, 18).filter(isMessageRow).map((r) => r.text),
    );
  });

  /**
   * D49ag: the exchange helper puts two tool rows in each exchange, and a fold
   * must account for the work, in the order it happened.
   */
  it('covers the tool rows in the same span, in log order (D49ag)', () => {
    const rows: LogRow[] = [
      sized('you', 'ask 1', 400),
      ran('read_file', 'src/A.java'),
      ran('shell', './gradlew test', false),
      sized('bot', 'answer 1', 400),
      ...large(10),
    ];
    const p = plan(rows)!;
    const kinds = p.covered.map((r) =>
      r.k === 'tool' ? 'tool' : (r.text ?? ''),
    );
    expect(kinds[1]).toBe('tool');
    expect(kinds[2]).toBe('tool');
    expect(kinds[0]!.startsWith('ask 1')).toBe(true);
    expect(kinds[3]!.startsWith('answer 1')).toBe(true);
    // ...and the rest of the covered span is messages, in log order.
    expect(p.covered.filter(isMessageRow)).toHaveLength(20);
  });

  it('the summary a fold is given can name what the run did (D49ag)', () => {
    const rows: LogRow[] = [
      sized('you', 'fix the formatter', 400),
      ran('read_file', 'src/FormatterUtility.java'),
      ran('apply_diff', 'src/FormatterUtility.java'),
      sized('bot', 'I fixed the truncation bug.', 400),
      ...large(10),
    ];
    const p = plan(rows)!;
    // This is the exact sentence the founder's real summary could not produce.
    const rendered = p.covered.map(toolLine).join('\n');
    expect(rendered).toContain('read_file src/FormatterUtility.java');
    expect(rendered).toContain('apply_diff src/FormatterUtility.java');
  });

  /**
   * Rows before the marker stay in the log now, so the fold must not reach back
   * past it — the previous summary already accounts for them, and re-summarising
   * them would send the same ground twice under two different summaries.
   */
  it('never reaches back past the last summary', () => {
    const rows = [...large(1), summary('S1'), ...large(8)];
    const marker = lastSummaryIndex(rows);
    const p = plan(rows)!;
    for (const row of p.covered) {
      expect(rows.indexOf(row)).toBeGreaterThan(marker);
    }
    // The summary counts towards the budget, so the kept tail is the newest two
    // of the 16 messages after it; the other 14 are covered.
    expect(p.covered.filter(isMessageRow)).toHaveLength(14);
  });

  it('folds again only when the history reaches the threshold again', () => {
    const rows = large(10);
    const p = plan(rows)!;
    const folded = applyFold(rows, p, summary('S') as never);
    // Summary + the two kept messages: far under the 800-token line.
    expect(plan(folded)).toBeNull();
    // Six more 100-token messages push it over again.
    const more = [...folded, ...large(3)];
    expect(plan(more)).not.toBeNull();
  });

  it('a manual fold keeps the same budget but skips the size trigger', () => {
    const rows = large(2); // 400 tokens: under the line, but older messages exist
    expect(plan(rows)).toBeNull();
    expect(plan(rows, true)).not.toBeNull();
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

  it('records the target and size of a session message, never its text (D49cq)', () => {
    const text = 'the answer is in the second file';
    const d = digestToolCall('send_to_session', { to: 'Plato 2', text });
    expect(d).toBe('to Plato 2 (32 chars)');
    expect(d).not.toContain('answer');
    expect(digestToolCall('send_to_session', { to: 'tab-1' })).toBe('to tab-1');
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

describe('requestFromLog (D49aa, D44d amended)', () => {
  it('sends the summary first, then the tail', () => {
    const rows = large(4);
    const p = planFold(rows, {
      maxContext: 1000,
      threshold: 0.8,
      manual: true,
    })!;
    const after = [
      ...rows.slice(0, p.insertAt),
      summary('THE SUMMARY'),
      ...rows.slice(p.insertAt),
    ];
    const req = requestFromLog(after);
    expect(req[0]).toEqual({
      role: 'user',
      text: '[Summary of the earlier conversation]\nTHE SUMMARY',
    });
    expect(req.slice(1).map((r) => r.text)).toEqual([
      rows[6]!.text,
      rows[7]!.text,
    ]);
  });

  // The transcript growing must not quietly grow the request too.
  it('is unaffected by rows the fold left in front of the summary', () => {
    const rows = large(4);
    const p = planFold(rows, {
      maxContext: 1000,
      threshold: 0.8,
      manual: true,
    })!;
    const minimal = [
      ...rows.slice(0, p.insertAt),
      summary('S'),
      ...rows.slice(p.insertAt),
    ];
    // The same fold, but with a pile of older transcript in front of it.
    const historical = [you('ancient'), bot('reply'), ...minimal];
    expect(requestFromLog(historical)).toEqual(requestFromLog(minimal));
  });

  it('uses the LAST summary as the memory boundary', () => {
    const req = requestFromLog([summary('old'), you('a'), summary('new'), bot('b')]);
    expect(req[0]!.text).toContain('new');
    expect(req.map((r) => r.text)).not.toContain('a');
  });

  /**
   * D44d amended: the cap used to be 60 message ROWS, dropped in silence. It is
   * a token budget now, and when it bites the request says so rather than letting
   * the model believe the conversation began at the cut.
   */
  it('caps the tail by tokens and says what it left out', () => {
    const rows = Array.from({ length: 10 }, (_, i) => sized('you', 'm' + i, 400));
    const p = planRequest(rows, 250); // ten 100-token messages
    expect(p.omitted).toBe(8);
    expect(p.turns).toHaveLength(3); // the note, then the newest two messages
    expect(p.turns[0]!.text).toContain('8 older messages are not in this request');
    expect(p.turns[1]!.text.startsWith('m8')).toBe(true);
    expect(p.turns[2]!.text.startsWith('m9')).toBe(true);
  });

  it('keeps the newest exchange even below the cap', () => {
    const rows = Array.from({ length: 10 }, (_, i) => sized('you', 'm' + i, 400));
    const p = planRequest(rows, 10);
    expect(p.turns.slice(1).map((t) => t.text)).toEqual([
      rows[8]!.text,
      rows[9]!.text,
    ]);
  });

  it('says nothing when the whole tail fits', () => {
    const rows = conversation(4);
    const p = planRequest(rows, 10_000);
    expect(p.omitted).toBe(0);
    expect(p.turns).toHaveLength(8);
  });

  it('sends nothing for an empty log', () => {
    expect(requestFromLog([])).toEqual([]);
    expect(planRequest([], 10).omitted).toBe(0);
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
    expect(requestFromLog(rows)).toEqual([
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
    expect(requestFromLog(rows).map((r) => r.text)).toEqual(['a', 'b']);
  });

  it('carries a message’s tool rows with it when the cap cuts (D49ag)', () => {
    const rows: LogRow[] = [
      sized('you', 'ask 1', 400),
      ran('read_file', 'src/A.java'),
      sized('bot', 'answer 1', 400),
      sized('you', 'ask 2', 400),
      ran('shell', 'npm test'),
      sized('bot', 'answer 2', 400),
    ];
    const p = planRequest(rows, 250);
    // The newest two messages and the tool row between them fit. The first
    // exchange is left out WITH its tool row, so no work note arrives without
    // the message it belongs to.
    expect(p.omitted).toBe(2);
    expect(p.turns.some((t) => t.text.includes('read_file'))).toBe(false);
    expect(p.turns.some((t) => t.text.includes('shell npm test'))).toBe(true);
  });
});

/**
 * D49aa amended (2026-11-12). The display cap counted every row the same way,
 * so a client chat with 265 tool records lost its OPENING QUESTION and answer
 * first: the transcript began with an answer to a question that was gone. The
 * rule now: work goes before conversation, and the note says which.
 */
describe('planTrim (D49aa amended)', () => {
  const tools = (n: number, tag = 'src/file'): LogRow[] =>
    Array.from({ length: n }, (_, i) => ran('read_file', tag + i));

  it('drops the work before the conversation, oldest first', () => {
    const rows: LogRow[] = [
      you('opening question'),
      bot('opening answer'),
      ...tools(300),
      ...Array.from({ length: 98 }, (_, i) => you('later ' + i)),
    ];
    expect(rows).toHaveLength(400);
    const { rows: kept, removed } = planTrim(rows, 399);
    expect(removed).toEqual({
      tools: 1,
      messages: 0,
      other: 0,
      lostSummary: false,
    });
    // Every message row survives, including the opening pair.
    expect(kept.filter(isMessageRow)).toHaveLength(100);
    expect(kept[0]).toBe(rows[0]);
    // ...and the tool row that went is the OLDEST one.
    expect(kept.some((r) => r.digest === 'src/file0')).toBe(false);
  });

  it('keeps every message row while any tool row remains', () => {
    const rows: LogRow[] = [you('q'), bot('a'), ...tools(10), you('last')];
    const { rows: kept, removed } = planTrim(rows, 5);
    expect(removed).toEqual({
      tools: 8,
      messages: 0,
      other: 0,
      lostSummary: false,
    });
    expect(kept.filter(isMessageRow).map((r) => r.text)).toEqual([
      'q',
      'a',
      'last',
    ]);
  });

  it('trims messages only when nothing else is left, and counts them', () => {
    const rows = Array.from({ length: 400 }, (_, i) => you('m' + i));
    const { rows: kept, removed } = planTrim(rows, 399);
    expect(removed).toEqual({
      tools: 0,
      messages: 1,
      other: 0,
      lostSummary: false,
    });
    expect(kept).toHaveLength(399);
    expect((kept[0] as LogRow).text).toBe('m1');
  });

  it('reports the summary as lost when the cap takes it', () => {
    const rows: LogRow[] = [
      summary('S'),
      you('m0'),
      you('m1'),
      you('m2'),
    ];
    const { rows: kept, removed } = planTrim(rows, 3);
    expect(removed.lostSummary).toBe(true);
    expect(removed.messages).toBe(0);
    expect(kept).toHaveLength(3);
  });

  it('never drops the note that records the cap', () => {
    const rows: LogRow[] = [
      { k: 'trim', dropped: 9, lostSummary: false } as LogRow,
      you('m0'),
      you('m1'),
      you('m2'),
    ];
    const { rows: kept, removed } = planTrim(rows, 3);
    expect(kept[0]!.k).toBe('trim');
    expect(removed.messages).toBe(1);
  });

  it('does nothing when the log is within the cap', () => {
    const rows = conversation(2);
    const { rows: kept, removed } = planTrim(rows, 100);
    expect(kept).toEqual(rows);
    expect(removed.tools + removed.messages + removed.other).toBe(0);
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
