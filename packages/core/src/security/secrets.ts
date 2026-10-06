/**
 * Security invariant 2 (ARCHITECTURE.md): secret-bearing files never enter
 * model context or tool output sent to providers.
 *
 * Belt-and-suspenders with .gitignore-based exclusion: this deny-list is
 * cheap, deterministic, and testable without touching the filesystem.
 */
import { tokenize } from './readOnlyShell.js';

export const SECRET_DENYLIST: readonly string[] = [
  'keystore.properties',
  'local.properties',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.*', // future .env variants
  '*.keystore',
  '*.jks',
  'secrets.*',
];

const MATCHERS: ((p: string) => boolean)[] = SECRET_DENYLIST.map((pat) => {
  if (pat === '.env.*') {
    return (p: string) =>
      p.split('/').some((seg) => seg.startsWith('.env.'));
  }
  if (pat.includes('*')) {
    // Patterns are prefix*suffix only.
    const star = pat.indexOf('*');
    const prefix = pat.slice(0, star);
    const suffix = pat.slice(star + 1);
    return (p: string) => {
      const base = p.split('/').pop() ?? '';
      return (
        base.length >= prefix.length + suffix.length &&
        base.startsWith(prefix) &&
        base.endsWith(suffix)
      );
    };
  }
  return (p: string) => {
    const base = p.split('/').pop() ?? '';
    return base === pat;
  };
});

/** True when a path or filename is on the secret deny-list. */
export function isSecretPath(p: string): boolean {
  const norm = p.replaceAll('\\', '/');
  // D49bb: the owner's own list. An EXCEPTION is checked first and by exact
  // repo-relative path, so a user who says "local.properties is not a secret in
  // this project" gets the whole file, and cannot accidentally re-include a
  // different file that merely shares a name in another directory.
  if (allowedPaths.has(norm)) return false;
  if (MATCHERS.some((m) => m(norm))) return true;
  return extraMatchers.some((m) => m(norm));
}

/**
 * D49bb: the protected list is the OWNER's, not only the source's.
 *
 * The default list is a guess about other people's projects, and it was the one
 * refusal with no way out — a user whose `credentials.json` was harmless had to
 * edit source to say so. Two settings answer it: names to ADD, and exact paths to
 * take OFF.
 *
 * This is module state rather than a threaded argument because `isSecretPath` is
 * a predicate called from eight places, including the workspace walker that
 * builds the first prompt. Threading a policy object through all of them would
 * make every caller aware of a decision none of them makes. The state is set
 * once at activation and on a settings change, and it is only ever additive to
 * the defaults — the built-in list cannot be emptied from settings.
 */
const allowedPaths = new Set<string>();
let extraMatchers: ((p: string) => boolean)[] = [];

function matcherFor(pat: string): (p: string) => boolean {
  if (pat.startsWith('.env.')) {
    return (p: string) => p.split('/').some((seg) => seg === pat);
  }
  if (pat.includes('*')) {
    const star = pat.indexOf('*');
    const prefix = pat.slice(0, star);
    const suffix = pat.slice(star + 1);
    return (p: string) => {
      const base = p.split('/').pop() ?? '';
      return (
        base.length >= prefix.length + suffix.length &&
        base.startsWith(prefix) &&
        base.endsWith(suffix)
      );
    };
  }
  return (p: string) => (p.split('/').pop() ?? '') === pat;
}

export function configureSecrets(opts: { extra?: string[]; allow?: string[] }): void {
  extraMatchers = (opts.extra ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(matcherFor);
  allowedPaths.clear();
  for (const p of opts.allow ?? []) {
    // `.` and a leading `./` are what a person types and what an editor's
    // autocomplete gives; the comparison is against `resolveInRoot`'s output, so
    // both are normalised away rather than silently failing to match.
    const norm = p
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\.\//, '')
      .replace(/\/+$/, '');
    if (norm.length > 0 && norm !== '.') allowedPaths.add(norm);
  }
}

/**
 * D49bc: why a protected NAME cannot be accepted, or null when it can.
 *
 * The panel adds these names, and an entry that matches nothing must never be
 * accepted in silence: `isSecretPath` compares the file's LAST PATH SEGMENT, so
 * a name holding a `/` would protect nothing at all and nothing on screen would
 * say so. A `*` is understood at the start or the end only — `*.pem`, `.env.*` —
 * which is exactly the matcher above.
 */
export function protectNameError(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0) return 'Enter a file name.';
  if (s.includes('/') || s.includes('\\')) {
    return 'A protected name is a file name, not a path. Remove the "/".';
  }
  const stars = s.split('*').length - 1;
  if (stars > 1) return 'Use one "*" at most.';
  if (stars === 1 && !s.startsWith('*') && !s.endsWith('*')) {
    return 'A "*" is allowed only at the start or the end, as in "*.pem".';
  }
  return null;
}

/**
 * D49bc: why an ALLOWED PATH cannot be accepted, or null when it can.
 *
 * The asymmetry with a name is the security property, so it is enforced here
 * rather than left to the matcher: a wildcard exception would silently
 * unprotect everything matching it, and nothing on screen would say so.
 */
export function allowPathError(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0) return 'Enter a path.';
  if (s.includes('*')) {
    return 'An allowed file is one exact path, so a "*" is not allowed.';
  }
  if (s.startsWith('/') || s.startsWith('\\')) {
    return 'Enter the path from the workspace root, with no leading "/".';
  }
  return null;
}

/**
 * D49ai: a protected file's NAME written inside a sentence.
 *
 * `isSecretPath` matches a whole string, taking the basename. That is right for a
 * path argument and wrong for a command, where every word is part of the string:
 * `app/keystore.properties` has the basename `keystore.properties` and was
 * refused, while `cat keystore.properties` has the basename `cat
 * keystore.properties` and was **not**. Since the proving-ground repo keeps
 * `keystore.properties` at its ROOT, the natural spelling was the one that got
 * through — and `shell` is `allow` in `auto`, so nothing asked.
 *
 * **Verified by running it** (`executeTool(root, 'shell', {command: 'cat
 * keystore.properties'})`): `ok: true`, with the file's contents in the output,
 * which is the model's context and the transcript.
 *
 * Deliberately a TOKEN scan rather than a substring one: `echo do not commit
 * keystore.properties` is refused (safe direction), while a token that merely
 * contains the letters is not.
 *
 * **D49be: the command is now read the way BASH reads it, not only the way the
 * text splits.** Splitting on the characters a filename cannot contain took a
 * quoted command apart and never put it back together: `cat key'store'.properties`
 * was the three harmless tokens `key`, `store`, `properties`, while bash
 * concatenates adjacent quoted and unquoted runs into one word — it opens
 * `keystore.properties`. The tokenizer from D49aq already models that, so the
 * command goes through it first (`readOnlyShell.ts`), and the text scan below
 * still runs afterwards.
 *
 * **The two are UNIONED, never swapped**, because the tokenizer answers `null`
 * for anything it does not model — a backslash, a newline, an unbalanced quote —
 * and this check must not start catching LESS than it did before. **Best effort,
 * and still recorded as such**: a splice the tokenizer refuses to model is left
 * to the text scan, which cannot see it. In `edit` the approval card is the real
 * gate; in `auto` the user has chosen not to have one, which is why the plain
 * case is worth closing here — and why the guard that actually holds for a
 * masked file is the value scrub, not this name check.
 */
export function mentionsSecretPath(text: string): boolean {
  // The command as bash will run it. Quoting is undone, so `'a'` and `a` are the
  // same token and two quoted runs of one word are one word again.
  for (const token of tokenize(text) ?? []) {
    if (token.length > 0 && isSecretPath(token)) {
      return true;
    }
  }
  // The raw text, as before. Tokens keep the characters a filename is made of,
  // so `.env.local` and `release.jks` survive whole while `/`, quotes, `=`, `;`
  // and spaces split. This is what still catches a command the tokenizer refused.
  for (const token of text.split(/[^A-Za-z0-9_.\-+]+/)) {
    if (token.length > 0 && isSecretPath(token)) {
      return true;
    }
  }
  return false;
}
