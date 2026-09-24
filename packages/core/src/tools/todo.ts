/**
 * D49ah: the agent's own plan, as a tool.
 *
 * The founder's runs got long once the turn cap was deleted (D49ab) — 78 turns on
 * a real task — and a long run with no externalised plan drifts: the model
 * re-derives what it is doing from a conversation that is mostly tool results,
 * and a summarised turn can drop the thread entirely. Every competitor ships
 * this tool for the same reason, and the reason got stronger here, not weaker,
 * when the cap went.
 *
 * Two design rules, both about keeping it honest:
 *
 * 1. **The whole list is replaced on every call.** A delta protocol (add item 3,
 *    complete item 1) lets the model's picture and the real list drift apart
 *    silently; a full list makes the model restate its plan each time, so the
 *    list IS what it currently believes. Same choice as Claude Code's.
 * 2. **The tool result is the rendered list**, so the model sees exactly what the
 *    user's panel shows. There is no second representation to disagree with.
 *
 * Nothing here touches the workspace, so it is a META tool: allowed in every mode
 * (see `decide`), never approved, and exempt from the secret scan (`secretRefusal`)
 * — its arguments are the model's own words about its own plan, not an instruction
 * to open a file. A plan item that merely NAMES a protected file must not be
 * refused; the file is never read.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

/**
 * A cap, because the tool's output is a panel a human reads and a list with no
 * bound is a list nobody can read. Deliberately generous: a real task's plan is
 * five to ten items, and refusing at twenty tells the model to curate rather
 * than truncating its plan behind its back.
 */
export const TODO_MAX_ITEMS = 20;

/** One item's text. A panel line, not a paragraph. */
export const TODO_MAX_CONTENT = 200;

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed'];

export function isTodoStatus(v: unknown): v is TodoStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/**
 * Reads the tool's `todos` argument. Returns the refusal message the model sees
 * when the shape is wrong, never a guess: a silently coerced status would put a
 * plan in the panel that the model did not write. Same discipline as an ambiguous
 * diff — refuse and say why, do not pick.
 */
export function parseTodos(
  raw: unknown,
): { todos: TodoItem[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: 'todos must be an array of {content, status}.' };
  }
  if (raw.length === 0) {
    return {
      error:
        'todos is empty. Write the plan you intend to follow; do not call this ' +
        'tool to clear the list.',
    };
  }
  if (raw.length > TODO_MAX_ITEMS) {
    return {
      error:
        `too many items (${raw.length}). Keep the plan to at most ` +
        `${TODO_MAX_ITEMS} items — a plan longer than that is a task list, not a plan.`,
    };
  }
  const todos: TodoItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i];
    if (typeof t !== 'object' || t === null) {
      return { error: `item ${i + 1} is not an object.` };
    }
    const rec = t as Record<string, unknown>;
    const content = typeof rec['content'] === 'string' ? rec['content'].trim() : '';
    if (content.length === 0) {
      return { error: `item ${i + 1} has no content.` };
    }
    if (content.length > TODO_MAX_CONTENT) {
      // Not truncated silently: a cut item is a plan the user reads that the
      // model never wrote (the rule behind D49c, applied to a panel line).
      return {
        error:
          `item ${i + 1} is ${content.length} characters; keep each item under ` +
          `${TODO_MAX_CONTENT}. State the step, not its detail.`,
      };
    }
    const status = rec['status'];
    if (!isTodoStatus(status)) {
      return {
        error:
          `item ${i + 1} has status ${JSON.stringify(status)}; it must be one of ` +
          'pending, in_progress or completed.',
      };
    }
    todos.push({ content, status });
  }
  return { todos };
}

/** How many items are in each state. */
export function todoCounts(todos: readonly TodoItem[]): {
  total: number;
  done: number;
  active: number;
} {
  let done = 0;
  let active = 0;
  for (const t of todos) {
    if (t.status === 'completed') done += 1;
    else if (t.status === 'in_progress') active += 1;
  }
  return { total: todos.length, done, active };
}

/**
 * The one-line account of a plan, used for the log's digest (D49ag) so a fold or
 * the next run knows a plan exists and where the run had got to — without
 * carrying the whole list through the summary.
 */
export function todoSummary(todos: readonly TodoItem[]): string {
  const { total, done, active } = todoCounts(todos);
  const parts = [`${total} ${total === 1 ? 'item' : 'items'}`, `${done} done`];
  if (active > 0) {
    const now = todos.find((t) => t.status === 'in_progress');
    parts.push(`in progress: ${now?.content ?? ''}`);
  }
  return parts.join(', ');
}

/**
 * The tool's output: the list as a person reads it, and as the model will see it
 * again on its next turn. The markers are text rather than glyphs on purpose —
 * this string goes to a model, not to the panel.
 */
export function renderTodos(todos: readonly TodoItem[]): string {
  const { total, done } = todoCounts(todos);
  const head =
    total === 1
      ? `Plan — 1 item, ${done} done.`
      : `Plan — ${total} items, ${done} done.`;
  const lines = todos.map((t, i) => {
    const box =
      t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]';
    const tail = t.status === 'in_progress' ? '  <- in progress' : '';
    return `${i + 1}. ${box} ${t.content}${tail}`;
  });
  return [head, ...lines].join('\n');
}
