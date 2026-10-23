/**
 * D49ba: what an approval card SAYS.
 *
 * The heading used to be the tool's internal name: *"Approve write_file?"*,
 * *"Approve apply_diff?"*, *"Approve shell?"*. That tells the user which of
 * Plato's parts is asking, and nothing about what they are deciding. The card
 * underneath already shows the diff or the command; the heading is where the
 * SITUATION goes.
 *
 * Three rules from D49ba apply here, and the third is why this is a function in
 * core rather than a line in the view:
 *
 * 1. **A control states exactly what it does** — here, what the user is being
 *    asked to allow.
 * 2. **Say the situation, not the mechanism** — "Let Plato edit src/a.ts?", not
 *    "Approve apply_diff?".
 * 3. **The same term for the same thing.** "Edit", "write", "run" and "fetch"
 *    are chosen per tool and used in BOTH the heading and the session button, so
 *    one card cannot call the same action two things.
 *
 * It lives in core so it can be unit-tested: this string is the most-read text in
 * the product, and copy only the shell can reach is copy nothing checks.
 */
import { writePathsOf } from './modes.js';

/** Long paths are cut at the FRONT: the file name is the part that identifies it. */
function trimPath(p: string): string {
  const clean = p.replace(/\s+/g, ' ').trim();
  return clean.length <= 52 ? clean : `…${clean.slice(-51)}`;
}

/**
 * The card's heading: the situation, as a question.
 *
 * Every branch ends in `?`, because the answered state is built by replacing that
 * question mark — see `showCard` in the view. A branch that lost it would leave a
 * card that never says it was answered.
 */
export function approvalHeading(tool: string, args: Record<string, unknown>): string {
  const paths = writePathsOf(tool, args);
  const first = paths[0];
  switch (tool) {
    case 'write_file':
      // "Write", not "edit": this tool replaces a whole file, and on the create
      // path there is no old file to edit.
      return first === undefined ? 'Let Plato write this file?' : `Let Plato write ${trimPath(first)}?`;
    case 'apply_diff':
      return first === undefined ? 'Let Plato edit this file?' : `Let Plato edit ${trimPath(first)}?`;
    case 'apply_patch':
      if (paths.length === 1 && first !== undefined) return `Let Plato edit ${trimPath(first)}?`;
      return paths.length > 1
        ? `Let Plato edit ${paths.length} files?`
        : 'Let Plato edit these files?';
    case 'shell':
      // The command itself is on the card below. Naming it twice would push the
      // heading past the width where it can still be read at a glance.
      return 'Let Plato run this command?';
    case 'kill_shell':
      return 'Let Plato stop that command?';
    case 'web_fetch':
      // The URL is the thing that leaves the machine, and D49p requires it on the
      // card — it is in the body. The heading says what will happen to it.
      return 'Let Plato fetch this page?';
    default:
      return tool.startsWith('mcp_')
        ? 'Let Plato use this tool?'
        : 'Let Plato do this?';
  }
}

/**
 * The session button: the same action as the heading, widened to the session.
 *
 * A host-scoped approval must name the host, because it covers that host and no
 * other — the D49p rule. A tool with no host gets the action's own noun, so the
 * button never reads "allow all requests to write_file this session".
 */
export function approvalAllowAll(tool: string, host?: string): string {
  if (typeof host === 'string' && host.length > 0) {
    return `Allow every request to ${host} this session`;
  }
  switch (tool) {
    case 'write_file':
    case 'apply_diff':
    case 'apply_patch':
      return 'Allow every edit this session';
    case 'shell':
    case 'kill_shell':
      return 'Allow every command this session';
    case 'web_fetch':
      return 'Allow every fetch this session';
    default:
      return tool.startsWith('mcp_')
        ? 'Allow every use of this tool this session'
        : 'Allow every request this session';
  }
}

/**
 * The heading AFTER the user answered.
 *
 * The answered card stays on screen as the record of what was asked, so it has
 * to say which way it went. Built here rather than by string surgery in the view,
 * which is how the old card did it — a `replace('?', …)` that silently did
 * nothing if the heading ever stopped ending in one.
 */
export function approvalAnswered(heading: string, allowed: boolean): string {
  const bare = heading.endsWith('?') ? heading.slice(0, -1) : heading;
  return `${bare} — ${allowed ? 'allowed' : 'denied'}`;
}

/**
 * The heading after "allow every ... this session".
 *
 * A third outcome, not a third wording: the card now stands for a permission the
 * user will not be asked for again, and saying only "allowed" would hide that.
 * Core builds it for the same reason the other two are built here — the view
 * used to do this by replacing a question mark, which silently did nothing when
 * there was not one.
 */
export function approvalAnsweredSession(heading: string): string {
  const bare = heading.endsWith('?') ? heading.slice(0, -1) : heading;
  return `${bare} — allowed for the rest of this session`;
}

/**
 * The heading after the run was CANCELLED with the card on screen.
 *
 * The card is kept as the record of what was asked, and it must say the call
 * did not run. "Denied" would claim the user answered; every cancel path
 * resolves the card on the user's behalf, so the honest word is the one the
 * run record itself uses.
 */
export function approvalCancelled(heading: string): string {
  const bare = heading.endsWith('?') ? heading.slice(0, -1) : heading;
  return `${bare} — cancelled`;
}
