/**
 * D49av: the VS Code half of "the editor already knows what you broke".
 *
 * Everything here is API calls. The part that decides WHAT to report is pure and
 * lives in `@applivity/plato-core` (`runtime/diagnostics.ts`), because the shell
 * has no unit tests — the same split D49am used for the session memory.
 *
 * **The rule this file exists to respect: the absence of diagnostics is not
 * evidence of correctness.** `getDiagnostics` answers `[]` both for a file that
 * is clean and for a file no language server has ever opened, and those are
 * different facts. So this module never infers "clean" from an empty array. It
 * tracks which files a server has actually PUBLISHED for, and a file it has never
 * heard from is reported as `not-analysed` — append nothing, and say so.
 *
 * A timeout is `not-analysed`, never `clean`. Same rule.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';
import {
  diagnosticsToReport,
  isWriteTool,
  writePathsOf,
  type EditorDiagnostic,
  type PreWrite,
} from '@applivity/plato-core';

/**
 * How long the editor's servers get to notice a write before we stop waiting.
 *
 * One flat cap, deliberately. A two-cap version (longer for the first look, to
 * cover a language server's cold start) was written and removed: in a window
 * that publishes no diagnostics at all it spent three seconds on EVERY write to
 * learn nothing, and the measured cold start here is under a second. The cost of
 * being wrong is small and self-explaining — a first write whose server had not
 * finished booting reports "not checked", the notice says so, and the next write
 * gets an answer.
 */
const ANALYSE_CAP_MS = 1_500;

export interface DiagTarget {
  /** Workspace-relative, as the tool named it. */
  rel: string;
  uri: vscode.Uri;
  /** What was known about the file BEFORE the write. */
  pre: PreWrite;
}

/** Taken before the write runs — synchronously, so it cannot race the write. */
export interface DiagSnapshot {
  targets: DiagTarget[];
}

export type DiagResult =
  | { kind: 'not-analysed' }
  | { kind: 'clean' }
  | { kind: 'found'; diagnostics: EditorDiagnostic[] };

export class EditorDiagnostics {
  /**
   * The files a language server has PUBLISHED diagnostics for this session.
   *
   * A Set of URIs, not a cache of diagnostics: `getDiagnostics` already returns
   * the current array synchronously. What it cannot answer is "has anyone ever
   * looked at this file", and that is the only thing worth remembering. This is
   * the whole reason a snapshot taken at request time would be wrong — see the
   * header.
   */
  private readonly published = new Set<string>();
  private readonly sub: vscode.Disposable;

  constructor() {
    this.sub = vscode.languages.onDidChangeDiagnostics((e) => {
      for (const uri of e.uris) this.published.add(uri.toString());
    });
  }

  dispose(): void {
    this.sub.dispose();
  }

  /**
   * What is known about the files a write is about to change.
   *
   * Synchronous on purpose: it runs on the `allowed` tool-event, immediately
   * before the executor, so there is no window for the file or the servers to
   * move underneath it. (`node:fs` is consistent with the executor, which writes
   * with `node:fs` on the same fsPath — see `tools/execute.ts`.)
   */
  snapshot(root: string, tool: string, args: Record<string, unknown>): DiagSnapshot {
    if (!isWriteTool(tool)) return { targets: [] };
    const targets: DiagTarget[] = [];
    for (const rel of writePathsOf(tool, args)) {
      const abs = join(root, rel);
      const uri = vscode.Uri.file(abs);
      let pre: PreWrite;
      if (!existsSync(abs)) {
        // It did not exist, so it had no errors. Legitimately empty — and this
        // is the common case for a file Plato is creating.
        pre = { kind: 'absent' };
      } else if (this.published.has(uri.toString())) {
        pre = { kind: 'analysed', diagnostics: this.read(uri) };
      } else {
        // It exists and no server has ever reported on it. Comparing against an
        // empty list here is the mistake this whole file is built to avoid.
        pre = { kind: 'unknown' };
      }
      targets.push({ rel, uri, pre });
    }
    return { targets };
  }

  /**
   * What the editor says now, bounded, after the write.
   *
   * Never throws: a diagnostics failure must not fail a run.
   */
  async collect(snap: DiagSnapshot, signal: AbortSignal): Promise<DiagResult> {
    const targets = snap.targets;
    if (targets.length === 0) return { kind: 'not-analysed' };

    // D49av: make a file the servers have never seen visible to them.
    //
    // MEASURED, not assumed. The first run of field case 11 wrote a broken
    // TypeScript file and the notice came back "not checked — no language server
    // reported on it": a server only knows about files in a project it has
    // loaded or files the editor has OPENED, and a file Plato writes behind VS
    // Code's back is neither. So the feature did nothing for the commonest case —
    // a file Plato has just created. `openTextDocument` loads it and fires the
    // did-open that wakes the language extension; deliberately NOT
    // `showTextDocument`, which would throw a tab in the user's face for every
    // write Plato makes.
    for (const t of targets) {
      if (this.published.has(t.uri.toString())) continue;
      try {
        await vscode.workspace.openTextDocument(t.uri);
      } catch {
        // Unreadable or no language for it. The wait below reports "not
        // checked", which is the honest answer — never "clean".
      }
    }

    // Wait once for the whole call, not once per file: a multi-file patch pays
    // this delay a single time.
    await this.waitForPublish(
      targets.map((t) => t.uri),
      ANALYSE_CAP_MS,
      signal,
    );

    const found: EditorDiagnostic[] = [];
    let observed = false;
    for (const t of targets) {
      const errors = this.read(t.uri);
      // A non-empty list is itself proof a server analysed the file, even if no
      // event reached us.
      if (errors.length > 0) this.published.add(t.uri.toString());
      if (!this.published.has(t.uri.toString())) continue;
      observed = true;
      found.push(...diagnosticsToReport(t.pre, errors));
    }

    if (!observed) return { kind: 'not-analysed' };
    return found.length === 0 ? { kind: 'clean' } : { kind: 'found', diagnostics: found };
  }

  /** Errors only, as the plan decided. Warnings and hints are not collected. */
  private read(uri: vscode.Uri): EditorDiagnostic[] {
    const out: EditorDiagnostic[] = [];
    for (const d of vscode.languages.getDiagnostics(uri)) {
      if (d.severity !== vscode.DiagnosticSeverity.Error) continue;
      out.push({
        path: uri.fsPath,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        message: d.message,
        ...(d.source === undefined ? {} : { source: d.source }),
      });
    }
    return out;
  }

  /**
   * Resolves when a server publishes for one of these files, or when the cap
   * expires — whichever comes first. Never rejects.
   *
   * The signal cancels the TIMER only. `getDiagnostics` is synchronous and the
   * server's analysis runs in its own process, so a cancel cannot stop the work;
   * saying otherwise here would be a comment that lies.
   */
  private waitForPublish(
    uris: vscode.Uri[],
    capMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const wanted = new Set(uris.map((u) => u.toString()));
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub.dispose();
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const sub = vscode.languages.onDidChangeDiagnostics((e) => {
        if (e.uris.some((u) => wanted.has(u.toString()))) finish();
      });
      const timer = setTimeout(finish, capMs);
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish);
    });
  }
}

/** One line for the run record. Never silent — that is the point of it. */
export function describeDiagLook(result: DiagResult, snap: DiagSnapshot): string {
  const names = snap.targets.map((t) => t.rel.split('/').pop() ?? t.rel).join(', ');
  const where = names.length > 0 ? names : '(no files)';
  if (result.kind === 'not-analysed') {
    return `diagnostics: not checked in ${where} — no language server reported on it`;
  }
  if (result.kind === 'clean') return `diagnostics: none new in ${where}`;
  const n = result.diagnostics.length;
  return `diagnostics: ${n} new error${n === 1 ? '' : 's'} in ${where}`;
}
