/**
 * Security invariant 2 (ARCHITECTURE.md): secret-bearing files never enter
 * model context or tool output sent to providers.
 *
 * Belt-and-suspenders with .gitignore-based exclusion: this deny-list is
 * cheap, deterministic, and testable without touching the filesystem.
 */
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
  return MATCHERS.some((m) => m(norm));
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
 * contains the letters is not. **Best effort, and recorded as such** — a command
 * built to evade a text check (`cat key'store'.properties`) still can. In `act`
 * and `edit` the approval card is the real gate; in `auto` the user has chosen
 * not to have one, which is why the plain case is worth closing here.
 */
export function mentionsSecretPath(text: string): boolean {
  // Tokens keep the characters a filename is made of, so `.env.local` and
  // `release.jks` survive whole while `/`, quotes, `=`, `;` and spaces split.
  for (const token of text.split(/[^A-Za-z0-9_.\-+]+/)) {
    if (token.length > 0 && isSecretPath(token)) {
      return true;
    }
  }
  return false;
}
