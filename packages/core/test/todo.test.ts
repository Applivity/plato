import { describe, expect, it } from 'vitest';
import {
  parseTodos,
  renderTodos,
  todoCounts,
  todoSummary,
  TODO_MAX_CONTENT,
  TODO_MAX_ITEMS,
  type TodoItem,
} from '../src/tools/todo.js';

/**
 * D49ah. The plan the agent holds across a long run, and the reason the turn cap
 * could go (D49ab) without the run losing its thread.
 *
 * The rule under all of these: **the panel and the model are shown the same
 * thing, and a malformed list is refused rather than guessed at.** A silently
 * coerced status would put a plan in front of the user that the model never
 * wrote — the same class of fault as an ambiguous diff applied to the wrong
 * line.
 */

const item = (content: string, status: TodoItem['status']): TodoItem => ({
  content,
  status,
});

describe('parseTodos (D49ah)', () => {
  it('reads a well-formed list, in order', () => {
    const r = parseTodos([
      { content: 'Read the utility', status: 'completed' },
      { content: 'Fix the formatter', status: 'in_progress' },
      { content: 'Add a test', status: 'pending' },
    ]);
    expect('todos' in r && r.todos.map((t) => t.status)).toEqual([
      'completed',
      'in_progress',
      'pending',
    ]);
  });

  it('trims an item rather than keeping the model’s whitespace', () => {
    const r = parseTodos([{ content: '  Fix it\n', status: 'pending' }]);
    expect('todos' in r && r.todos[0]!.content).toBe('Fix it');
  });

  it('refuses a list that is not a list', () => {
    expect('error' in parseTodos('fix the bug')).toBe(true);
    expect('error' in parseTodos(undefined)).toBe(true);
  });

  it('refuses an empty list instead of reading it as "clear the panel"', () => {
    const r = parseTodos([]);
    expect('error' in r && r.error).toMatch(/empty/);
  });

  it('refuses an unknown status rather than guessing one', () => {
    const r = parseTodos([{ content: 'Fix it', status: 'done' }]);
    expect('error' in r && r.error).toMatch(/pending, in_progress or completed/);
  });

  it('refuses an item with no text', () => {
    expect('error' in parseTodos([{ content: '   ', status: 'pending' }])).toBe(true);
    expect('error' in parseTodos([{ status: 'pending' }])).toBe(true);
    expect('error' in parseTodos(['Fix it'])).toBe(true);
  });

  it('refuses an item too long to be a panel line, and never truncates it', () => {
    const r = parseTodos([
      { content: 'x'.repeat(TODO_MAX_CONTENT + 1), status: 'pending' },
    ]);
    // Truncating would show the user a step the model did not write — the rule
    // behind D49c, applied to a panel line.
    expect('error' in r).toBe(true);
  });

  it('refuses a plan longer than the panel can usefully show', () => {
    const many = Array.from({ length: TODO_MAX_ITEMS + 1 }, (_, i) => ({
      content: 'step ' + i,
      status: 'pending',
    }));
    expect('error' in parseTodos(many)).toBe(true);
  });
});

describe('todoCounts (D49ah)', () => {
  it('counts done and in-progress separately', () => {
    expect(
      todoCounts([
        item('a', 'completed'),
        item('b', 'completed'),
        item('c', 'in_progress'),
        item('d', 'pending'),
      ]),
    ).toEqual({ total: 4, done: 2, active: 1 });
  });
});

describe('renderTodos (D49ah)', () => {
  const todos = [
    item('Read the utility', 'completed'),
    item('Fix the formatter', 'in_progress'),
    item('Add a test', 'pending'),
  ];

  it('shows every item with its state and its position', () => {
    const out = renderTodos(todos);
    expect(out).toContain('1. [x] Read the utility');
    expect(out).toContain('2. [>] Fix the formatter');
    expect(out).toContain('3. [ ] Add a test');
  });

  it('heads the list with the progress, so a glance is enough', () => {
    expect(renderTodos(todos)).toContain('3 items, 1 done');
  });

  it('is what the model is handed back, so the panel and the model agree', () => {
    // The tool's output IS this string — there is no second representation that
    // could drift from the panel.
    const out = renderTodos(todos);
    for (const t of todos) expect(out).toContain(t.content);
  });
});

describe('todoSummary (D49ah)', () => {
  it('names what is in hand, not just the count', () => {
    expect(
      todoSummary([item('a', 'completed'), item('Fix the formatter', 'in_progress')]),
    ).toBe('2 items, 1 done, in progress: Fix the formatter');
  });

  it('says nothing about progress when nothing is in hand', () => {
    expect(todoSummary([item('a', 'completed')])).toBe('1 item, 1 done');
  });

  it('stays inside the digest bound the log gives it', () => {
    const many = Array.from({ length: TODO_MAX_ITEMS }, (_, i) =>
      item('step ' + i, 'pending'),
    );
    // The log's DIGEST_MAX is 220; the summary must not depend on a truncation
    // to fit, because a half-written summary reads as a whole one.
    expect(todoSummary(many).length).toBeLessThan(220);
  });
});
