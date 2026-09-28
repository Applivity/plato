/**
 * D49ax: what undo SAYS.
 *
 * The wording is part of the decision, not decoration. A first draft was
 * rejected by the founder as cryptic — chiefly *"Changes made by commands Plato
 * ran are not affected"*, which named no command, said what did NOT happen
 * instead of what might be wrong, and gave no next step.
 *
 * So every sentence here does three things: it names the files, it says what
 * Plato did or could not do, and it ends with what the user can do about it.
 * The two limits are stated plainly rather than hidden — Claude Code and Copilot
 * share the terminal-command hole and never mention it, and a file the user has
 * edited since is refused rather than silently overwritten.
 *
 * This lives in core so it can be unit-tested, which is the same reason
 * `stuckCard` does: copy that only the shell can reach is copy nothing checks.
 */
import { UNDO_MAX_FILE_BYTES, type UndoPlan, type UndoResult } from './undo.js';

/**
 * `4.2 MB`, `912 KB`, `17 B` — one decimal where it means something, and no
 * decimal at all where it does not. "the 1.0 MB limit" reads like a machine
 * wrote it; the limit is 1 MB.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
  return `${mb} MB`;
}

const files = (n: number): string => (n === 1 ? '1 file' : `${n} files`);

/**
 * The same count, definite. Files Plato edited are a known set, so they take
 * "the" — *"put back the 3 files it edited"*, which is the wording D49ax settled
 * on. A created file takes no article for the same reason D49ax's copy gives
 * none: *"removed 1 file it created"* reads as a fact, not as a set the user is
 * meant to recognise.
 */
const theFiles = (n: number): string => (n === 1 ? 'the file' : `the ${n} files`);

/** The card's own content. Sent over the wire verbatim, so a reload matches. */
export interface UndoCard {
  title: string;
  /** What will be put back, one line each, in the order it will happen. */
  restore: string[];
  /** What cannot be, and why — already in plain words. */
  refuse: string[];
}

/**
 * The card, or null when there is nothing to put back.
 *
 * A file Plato created is undone by REMOVING it, and the line says so — the user
 * is about to lose a file from their tree, and "put back" would be a lie about
 * what the click does.
 */
export function undoCard(plan: UndoPlan): UndoCard | null {
  const restores = plan.restore.filter((t) => t.action === 'restore');
  const deletes = plan.restore.filter((t) => t.action === 'delete');
  if (plan.restore.length === 0) return null;

  const title =
    plan.restore.length === 1
      ? 'Put back the file from your last request?'
      : `Put back the ${files(plan.restore.length)} from your last request?`;

  const lines: string[] = restores.map((t) => t.rel);
  for (const t of deletes) {
    lines.push(`${t.rel} — Plato created this one, so it is removed`);
  }
  return {
    title,
    restore: lines,
    refuse: plan.refuse.map((r) => refuseLine(r.rel, r.why, r.size)),
  };
}

function refuseLine(rel: string, why: 'edited' | 'too-big' | 'damaged', size: number): string {
  switch (why) {
    case 'edited':
      return (
        `${rel} — you changed it after Plato did. Putting the old copy back ` +
        `would wipe out your work, so Plato left it alone.`
      );
    case 'too-big':
      return (
        `${rel} is ${formatBytes(size)}, above the ${formatBytes(UNDO_MAX_FILE_BYTES)} ` +
        `limit Plato keeps undo copies up to. Use git or your editor's own ` +
        `history for this one.`
      );
    default:
      return (
        `${rel} — Plato's copy of it cannot be read back, so it cannot be put ` +
        `back safely. Use git or your editor's own history for this one.`
      );
  }
}

/** Nothing recorded for this project, or the history was cleared. */
export function undoNothingText(): string {
  return (
    'Nothing to undo. Plato has not changed a file here yet, or its undo ' +
    'history for this project has been cleared.'
  );
}

/**
 * The report after an undo ran.
 *
 * The counts are of what ACTUALLY happened, never of what was intended: a write
 * can fail on a full disk, and a failed rollback described as a clean one is the
 * exact shape of report this codebase keeps removing.
 */
export function undoResultText(
  plan: UndoPlan,
  result: UndoResult,
  commands: readonly string[],
): string {
  const restored = result.applied.filter((a) => a.how === 'restored').length;
  const deleted = result.applied.filter((a) => a.how === 'deleted').length;
  const done = result.applied.length;
  // Everything that did not happen: refused up front, or failed at the write.
  const blocked = plan.refuse.length + result.failed.length;
  const parts: string[] = [];

  if (done === 0) {
    parts.push(
      blocked === 0 && plan.alreadyThere.length > 0
        ? 'Those files are already back to how they were.'
        : 'Nothing was put back.',
    );
  } else if (blocked === 0) {
    parts.push(`Undone. ${describePut(restored, deleted)}`);
  } else {
    // NOT "put back 1 of the 1 it was going to change", which this said first.
    // Two things were wrong with that and a screenshot is what caught it: it
    // called a REMOVED file "put back", and its denominator counted only the
    // files it was going to act on — so a request that also refused one read as
    // a complete success under a headline saying "partly". The two counts answer
    // different questions and both belong: what Plato did, and what it did not.
    parts.push(
      `Partly undone. Plato ${describeActions(restored, deleted)}, and could not ` +
        `undo ${files(blocked)} — ${blocked === 1 ? 'the reason follows' : 'the reasons follow'}.`,
    );
  }

  for (const r of plan.refuse) {
    parts.push(refuseLine(r.rel, r.why, r.size));
  }
  for (const f of result.failed) {
    parts.push(`${f.rel} was not put back — ${f.why}.`);
  }

  const commandsLine = describeCommands(commands);
  if (commandsLine !== null) parts.push(commandsLine);
  return parts.join('\n\n');
}

/**
 * What Plato DID, with the verb each file actually got.
 *
 * A created file is removed, not put back, and saying the wrong verb about a
 * file that is now gone from the tree is the sort of overclaim this codebase
 * keeps removing. Both counts can be non-zero in one request, so the two halves
 * are joined rather than chosen between.
 */
function describeActions(restored: number, deleted: number): string {
  const parts: string[] = [];
  if (restored > 0) parts.push(`put back ${theFiles(restored)} it edited`);
  if (deleted > 0) parts.push(`removed ${files(deleted)} it created`);
  return parts.join(' and ');
}

/** The whole line when nothing was left undone. */
function describePut(restored: number, deleted: number): string {
  return `Plato ${describeActions(restored, deleted)}.`;
}

/**
 * The terminal-command caveat, or null when no command ran.
 *
 * Named commands, not "commands": the whole reason the first draft was rejected
 * was that it told the user something might be wrong without telling them where
 * to look.
 */
function describeCommands(commands: readonly string[]): string | null {
  if (commands.length === 0) return null;
  const shown = commands.slice(0, 3);
  const more = commands.length - shown.length;
  const list =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  const tail = more > 0 ? ` (and ${more} more)` : '';
  return (
    `This request also ran ${list}${tail}. Plato has no record of which files a ` +
    `command touches, so it cannot undo those. If something still looks wrong, ` +
    `that is where to look.`
  );
}
