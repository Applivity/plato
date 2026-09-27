/**
 * D49av: what the EDITOR knows about a file Plato just changed.
 *
 * Plato writes a file and learns one thing — that the write succeeded. It cannot
 * tell whether it just broke the code. On a machine with no compiler that is not
 * a feedback loop at all, and every comparable agent closes it: the editor
 * already has a language server that knows, and Plato was never asking.
 *
 * This module is the half that must not be wrong, and it is pure so it can be
 * tested. The VS Code calls live in the shell (`packages/vscode/src/diagnostics.ts`),
 * which has no unit tests — the same split D49am used for the session memory.
 *
 * **The rule that shapes every decision here: the ABSENCE of diagnostics is not
 * evidence of correctness.** `getDiagnostics` answers `[]` both for a clean file
 * and for a file no language server has ever looked at. Treating those as the
 * same thing is the one design that would make this feature harmful: on the first
 * write to a file the editor has not opened, every pre-existing error would look
 * newly introduced, and the agent would be sent to fix things nobody asked about.
 * So the caller must be able to say "I do not know" — see `PreWrite`.
 */

/** One error the editor's language server reports. Errors only, by decision. */
export interface EditorDiagnostic {
  /** Workspace-relative path, as the tool named it. */
  path: string;
  /** 1-based line, as a reader counts it. */
  line: number;
  /** 1-based column. */
  column: number;
  message: string;
  /** Which server said so ('ts', 'java', …), when it said. */
  source?: string;
}

/**
 * What was known about the file BEFORE the write. Three cases, and the middle
 * one is the whole point — an empty array and "nobody looked" are different
 * facts and only one of them licenses a comparison.
 */
export type PreWrite =
  /** The file did not exist, so it had no errors. Legitimately empty. */
  | { kind: 'absent' }
  /** A language server had analysed it; this was its error list. */
  | { kind: 'analysed'; diagnostics: EditorDiagnostic[] }
  /** It existed, but nothing had analysed it. Comparison is not possible. */
  | { kind: 'unknown' };

/** A panel line, not a paragraph. */
export const DIAG_MAX_MESSAGE = 200;
/** A block a model reads between two tool calls, not a report. */
export const DIAG_MAX_ITEMS = 20;
/** The whole appended block, whatever the items cost. */
export const DIAG_MAX_CHARS = 4_000;

/**
 * What makes two diagnostics "the same error".
 *
 * Deliberately NOT the position. An edit shifts every line below it, so a key
 * that included the line number would report every pre-existing error in the
 * file as new after every single write — the failure this feature must not have.
 *
 * Severity is not in the key because only errors are collected.
 */
export function diagnosticKey(d: EditorDiagnostic): string {
  return `${d.source ?? ''}\u0000${d.message}`;
}

/**
 * The errors the edit INTRODUCED: a count-per-key difference, not a set
 * difference.
 *
 * A set difference silently drops the second copy of an error that already
 * existed once — a file with one `cannot find symbol` gains a second, the sets
 * are unchanged, and the new one is lost. That is the same class of fault as a
 * check that cannot fail, so it is counted instead.
 */
export function newDiagnostics(
  before: readonly EditorDiagnostic[],
  after: readonly EditorDiagnostic[],
): EditorDiagnostic[] {
  const remaining = new Map<string, number>();
  for (const d of before) {
    const k = diagnosticKey(d);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const out: EditorDiagnostic[] = [];
  for (const d of after) {
    const k = diagnosticKey(d);
    const left = remaining.get(k) ?? 0;
    if (left > 0) {
      remaining.set(k, left - 1);
    } else {
      out.push(d);
    }
  }
  return out;
}

/** The errors to report after a write, given what was known before it. */
export function diagnosticsToReport(
  before: PreWrite,
  after: readonly EditorDiagnostic[],
): EditorDiagnostic[] {
  if (before.kind === 'unknown') return []; // never guess — see the header
  return newDiagnostics(
    before.kind === 'absent' ? [] : before.diagnostics,
    after,
  );
}

/** `root/a/b.ts` against `root` reads as `a/b.ts` — the path a person sees. */
function relativeTo(root: string, p: string): string {
  const norm = (s: string) => s.replaceAll('\\', '/').replace(/\/+$/, '');
  const r = norm(root);
  const q = norm(p);
  return q === r ? '.' : q.startsWith(`${r}/`) ? q.slice(r.length + 1) : q;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The block appended to a tool result, or `''` when there is nothing to say.
 *
 * `''` matters: the caller appends nothing at all, rather than an empty header
 * that reads like a finding.
 *
 * The wording says **new or changed since your edit**, never "you broke this".
 * An edit that rewrites a message on a pre-existing error legitimately reads as
 * new, so the stronger claim would be false — and this repo has spent entries
 * removing exactly that kind of overclaim. The second sentence gives the model
 * the escape hatch it needs so this cannot become a licence for scope creep.
 */
export function formatDiagnostics(
  list: readonly EditorDiagnostic[],
  opts: { root: string; maxItems?: number; maxMessage?: number; maxChars?: number },
): string {
  if (list.length === 0) return '';
  const maxItems = opts.maxItems ?? DIAG_MAX_ITEMS;
  const maxMessage = opts.maxMessage ?? DIAG_MAX_MESSAGE;
  const maxChars = opts.maxChars ?? DIAG_MAX_CHARS;

  // Deterministic order, because the editor's is not guaranteed and a formatter
  // whose output depends on the server's mood cannot be tested.
  const sorted = [...list].sort((a, b) => {
    const byPath = relativeTo(opts.root, a.path).localeCompare(relativeTo(opts.root, b.path));
    if (byPath !== 0) return byPath;
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return diagnosticKey(a).localeCompare(diagnosticKey(b));
  });

  const n = sorted.length;
  const head =
    `The editor reports ${n} error${n === 1 ? '' : 's'} in the file` +
    `${n === 1 ? '' : 's'} you just changed (new or changed since your edit):`;
  const tail = 'Fix them, or say why they are not yours to fix.';

  const lines: string[] = [];
  let used = head.length + tail.length;
  let dropped = 0;
  for (const d of sorted) {
    const where = `${relativeTo(opts.root, d.path)}:${d.line}:${d.column}`;
    const src = d.source === undefined ? '' : `${d.source}: `;
    const line = `  ${where} — ${src}${truncate(d.message, maxMessage)}`;
    // `maxItems` bounds the count; `maxChars` bounds the whole block, because
    // twenty long messages is still too much for a step between two tool calls.
    if (lines.length >= maxItems || used + line.length + 1 > maxChars) {
      dropped = n - lines.length;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const more = dropped > 0 ? `\n  …[+${dropped} more]` : '';
  return `${head}\n${lines.join('\n')}${more}\n${tail}`;
}
