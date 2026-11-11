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

/**
 * How long to wait after opening a file QUIETLY, before deciding the servers
 * will not answer without being shown it.
 *
 * Measured, and the reason the visible route below exists at all: with the file
 * merely open, VS Code reported nothing — not for TypeScript, not for JSON, not
 * after ten seconds. Shown in an editor, the very same file produced both its
 * deliberate errors within a second. **The quiet route is tried FIRST and this
 * window is the only price of it**, because a window whose servers answer on
 * open (as mainstream VS Code does) must never have its editor disturbed for
 * nothing. Trying the intrusive path first would make the flash the normal case.
 */
const QUIET_CAP_MS = 700;

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

/** D49cd: one file whose language never answered, as the caller needs to report it. */
export interface DiagMiss {
  /** Workspace-relative, as the tool named it. */
  rel: string;
  /** The editor's language id for the file. */
  language: string;
  /** Whether THIS file had to be shown in this call. */
  shown: boolean;
}

export type DiagResult =
  /**
   * `misses` names the files that could not be checked and the language each
   * belongs to. The host counts them per language, because a per-file line for
   * a language with no reporter is noise: it says the same thing N times and
   * teaches nothing after the first.
   */
  | { kind: 'not-analysed'; shown?: boolean; misses?: DiagMiss[] }
  | { kind: 'clean'; shown?: boolean }
  | { kind: 'found'; diagnostics: EditorDiagnostic[]; shown?: boolean };

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

  /**
   * D49cd: languages that came back "not analysed". A language, once it has
   * failed to answer, is not asked again this session: showing the file and
   * waiting 2.2 s learns nothing the first attempt did not. The set is per
   * editor session, so a language server that starts later in the same window
   * is not noticed until the next session — the honest trade, because the
   * alternative is the 75-notice run this exists to prevent.
   */
  private readonly blind = new Set<string>();

  private readonly sub: vscode.Disposable;

  /**
   * How to put the CONVERSATION back in front after a file has been shown.
   *
   * Supplied by the host, and it exists because closing the tab we opened was not
   * reliable enough: measured in the field suite, a file left in front after a
   * write broke every later case in that window, because the harness drives the
   * chat webview and a backgrounded webview is unreachable. Re-revealing the
   * panel is the direct statement of the requirement — after taking the screen,
   * give it back — and it does not depend on how VS Code happens to pick the next
   * tab in a group.
   */
  private readonly revealChat: (() => void) | undefined;

  constructor(revealChat?: () => void) {
    this.revealChat = revealChat;
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
    // Code's back is neither.
    //
    // D49cd: the language is learned here too, because it is what decides
    // whether asking is worth anything. A file whose language has already
    // failed to answer is not shown and not waited for.
    const language = new Map<string, string>();
    const unknown: DiagTarget[] = [];
    for (const t of targets) {
      if (this.published.has(t.uri.toString())) continue;
      let id = 'unknown';
      try {
        const doc = await vscode.workspace.openTextDocument(t.uri);
        id = doc.languageId;
      } catch {
        // Unreadable or no language for it. The result below says "not
        // checked", which is the honest answer — never "clean".
      }
      language.set(t.uri.toString(), id);
      unknown.push(t);
    }
    const pending = unknown.filter(
      (t) => !this.blind.has(language.get(t.uri.toString()) ?? 'unknown'),
    );

    // First, quietly. Wait once for the whole call, not once per file: a
    // multi-file patch pays this delay a single time.
    if (pending.length > 0) {
      await this.waitForPublish(pending.map((t) => t.uri), QUIET_CAP_MS, signal);
    }
    if (this.anyObserved(targets)) return this.readTargets(targets);

    // The quiet route got nothing. Show the files — the one thing measured to
    // wake a server that will not answer otherwise — then hand the editor back.
    let shown = false;
    if (pending.length > 0) {
      shown = (await this.showAndRestore(pending, signal)) !== null;
    }
    const out = this.readTargets(targets, shown);
    return out.kind === 'not-analysed'
      ? this.notAnalysed(
          targets,
          language,
          new Set(pending.map((t) => t.uri.toString())),
          shown,
        )
      : out;
  }

  /**
   * The "never checked" result, and the point at which its languages are
   * remembered so the expensive path is not repeated.
   */
  private notAnalysed(
    targets: DiagTarget[],
    language: Map<string, string>,
    candidates: ReadonlySet<string>,
    shown: boolean,
  ): DiagResult {
    for (const id of language.values()) this.blind.add(id);
    return {
      kind: 'not-analysed',
      ...(shown ? { shown: true } : {}),
      misses: targets.map((t) => ({
        rel: t.rel,
        language: language.get(t.uri.toString()) ?? 'unknown',
        // Only a candidate could have been shown; a file skipped because its
        // language is known-blind was not.
        shown: shown && candidates.has(t.uri.toString()),
      })),
    };
  }

  /** Whether a server has ever reported for any of these, by event or by content. */
  private anyObserved(targets: DiagTarget[]): boolean {
    return targets.some(
      (t) => this.published.has(t.uri.toString()) || this.read(t.uri).length > 0,
    );
  }

  /**
   * Shows the files just long enough for the servers to answer, then puts the
   * user's editor back exactly where it was.
   *
   * This is the intrusive step, and it is deliberately second. It IS visible —
   * measured: `preserveFocus` keeps the cursor and the typing where they were but
   * does NOT keep the user's file on screen, so a written file takes the visible
   * editor for about a second. What makes that acceptable is that it is
   * *reversible and brief*: the previous document is restored, and the
   * diagnostics survive the restore (both measured).
   *
   * Returns null when there was nothing left to show, meaning "not analysed".
   */
  private async showAndRestore(
    targets: DiagTarget[],
    signal: AbortSignal,
  ): Promise<true | null> {
    const pending = targets.filter((t) => !this.published.has(t.uri.toString()));
    if (pending.length === 0) return null;
    // Remember the TAB, not `window.activeTextEditor`. Measured the hard way: with
    // the Plato chat in front, `activeTextEditor` can still answer with the last
    // text editor, so restoring "the editor" put a FILE back in front of the user
    // and pushed the conversation out of sight — and from then on every later run
    // in the same window was unreachable, because the harness drives the chat. The
    // tab is what the user is actually looking at.
    const beforeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    let opened = false;
    for (const t of pending) {
      try {
        const doc = await vscode.workspace.openTextDocument(t.uri);
        // `preview` so it reuses one tab rather than accumulating them.
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
        opened = true;
      } catch {
        // No editor can show it; the read below will report honestly.
      }
    }
    if (!opened) return null;
    await this.waitForPublish(targets.map((t) => t.uri), ANALYSE_CAP_MS, signal);
    await this.restoreView(beforeTab, pending.map((t) => t.uri));
    return true;
  }

  /**
   * Puts the view back where the user left it.
   *
   * Two cases, and the second is the one that matters: a text file, which is
   * shown again; and **anything else** — the Plato chat, Settings, a diff — which
   * is restored by CLOSING the tab we opened, because that is what makes the
   * group fall back to it.
   *
   * Only ever our own tab, and only while it is still the active one: a tab the
   * user opened is never closed, and if they moved on in the meantime we leave
   * their view alone.
   */
  private async restoreView(
    beforeTab: vscode.Tab | undefined,
    ours: vscode.Uri[],
  ): Promise<void> {
    const beforeInput = beforeTab?.input;
    // The user was reading a FILE: give that file back.
    if (beforeInput instanceof vscode.TabInputText) {
      try {
        const doc = await vscode.workspace.openTextDocument(beforeInput.uri);
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
        return;
      } catch {
        /* it went away — fall through */
      }
    }
    // Anything else — the Plato chat, Settings, a diff — is put back by naming it
    // rather than by closing ours and hoping VS Code picks it next.
    if (this.revealChat !== undefined) {
      this.revealChat();
      return;
    }
    // No host callback (unit-ish use): close only our own tab, never the user's.
    const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const activeIsOurs =
      activeInput instanceof vscode.TabInputText &&
      ours.some((u) => u.toString() === activeInput.uri.toString());
    if (!activeIsOurs) return;
    try {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } catch {
      /* nothing to close */
    }
  }

  /** Reads every target and reduces them through the three-state rule. */
  private readTargets(targets: DiagTarget[], shown = false): DiagResult {
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
    if (!observed) return { kind: 'not-analysed', shown };
    return found.length === 0
      ? { kind: 'clean', shown }
      : { kind: 'found', diagnostics: found, shown };
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

/**
 * D49cd: the run's "never checked" record, one line per language.
 *
 * A per-file line repeated 75 times is the noise this replaces. One line per
 * language still distinguishes "checked, clean" from "never checked" — the
 * rule the whole module exists for — and it counts, so the reader learns the
 * size of the blind spot instead of being told about it one file at a time.
 * The wording names what happened; the parenthetical explains the editor only
 * when the editor had to be disturbed.
 */
export function describeDiagMisses(
  misses: ReadonlyMap<string, { files: ReadonlySet<string>; shown: boolean }>,
): string[] {
  const lines: string[] = [];
  for (const [language, entry] of misses) {
    const names = [...entry.files];
    if (names.length === 1) {
      const name = names[0]!.split('/').pop() ?? names[0]!;
      const how = entry.shown
        ? ' (this editor only reports on a file it is showing, so it was shown)'
        : '';
      lines.push(`diagnostics: not checked in ${name} — no language server reported on it${how}`);
      continue;
    }
    const how = entry.shown
      ? ' (this editor only reports on a file it is showing, so one was shown)'
      : '';
    lines.push(
      `diagnostics: not checked in ${names.length} ${language} files — no language ` +
        `server reported on any of them${how}`,
    );
  }
  return lines;
}

/**
 * One line for the run record. Never silent — that is the point of it.
 *
 * The `shown` suffix is not decoration: it says the editor had to be disturbed to
 * get an answer at all. That single word tells a reader whether their own VS Code
 * reports on a file it merely has open (nothing appended) or, like the window
 * this was measured in, only on one it is SHOWING (appended) — which is the
 * difference between a feature that is invisible and one that takes the screen
 * for a second per write.
 */
export function describeDiagLook(result: DiagResult, snap: DiagSnapshot): string {
  const names = snap.targets.map((t) => t.rel.split('/').pop() ?? t.rel).join(', ');
  const where = names.length > 0 ? names : '(no files)';
  const how =
    result.shown === true
      ? ' (this editor only reports on a file it is showing, so it was shown)'
      : '';
  if (result.kind === 'not-analysed') {
    return `diagnostics: not checked in ${where} — no language server reported on it${how}`;
  }
  if (result.kind === 'clean') return `diagnostics: none new in ${where}${how}`;
  const n = result.diagnostics.length;
  return `diagnostics: ${n} new error${n === 1 ? '' : 's'} in ${where}${how}`;
}
