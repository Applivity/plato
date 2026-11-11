/**
 * D49cd: what an attachment pick becomes.
 *
 * A file the USER picked may live anywhere on disk — a screenshot on the
 * Desktop is the normal case, and telling the user to move it into the project
 * is not an answer. The workspace rule belongs to tool calls the model makes,
 * and it is enforced where those run (`resolveInRoot` in the executor); this
 * module only names the user's file.
 *
 * Two forms, and the difference is deliberate:
 *
 *   - an ABSOLUTE path is stored as it is, because it is unambiguous;
 *   - a RELATIVE path stays workspace-relative, and one that escapes with `..`
 *     is refused: that form is ambiguous, and the absolute path is the honest
 *     way to say "this file is outside the project".
 */
export interface AttachmentTarget {
  /** What the host stores and re-reads at send time. */
  stored: string;
  /** What the chip shows: the base name for an outside file. */
  name: string;
}

export function isAbsoluteAttachmentPath(raw: string): boolean {
  return raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\');
}

export function attachmentTarget(
  raw: string,
): AttachmentTarget | { error: 'outside the workspace' } {
  if (isAbsoluteAttachmentPath(raw)) {
    // Split on BOTH separators rather than `basename`: a Windows path can be
    // tested on a Mac, where node's basename only knows `/`.
    const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
    return { stored: raw, name: cut >= 0 ? raw.slice(cut + 1) : raw };
  }
  if (raw.split(/[\\/]/).includes('..')) {
    return { error: 'outside the workspace' };
  }
  return { stored: raw, name: raw };
}
