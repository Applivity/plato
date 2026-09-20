/**
 * A small glob matcher for path patterns (D49l).
 *
 * Written by hand because packages/core takes no new dependency (D07), and
 * shared by the `glob` tool and `grep`'s file filter so the two cannot disagree
 * about what a pattern means.
 *
 * One semantic matters more than the rest: **a pattern with no slash matches the
 * BASENAME.** `*.ts` therefore finds TypeScript files at any depth, which is
 * what everyone means by it — the alternative, matching the whole relative path,
 * makes `*.ts` match nothing outside the root. A pattern WITH a slash is matched
 * against the full path, so `src/*.ts` stays shallow. This is ripgrep's `-g`
 * behaviour.
 *
 * `*` and `?` stop at a `/`; `**` crosses it.
 */

/** Builds an anchored RegExp for a glob pattern. Exported for testing. */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // `**/` must also match ZERO directories, or `**/*.ts` would miss a
          // file at the root — the most common case there is.
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    // Everything else is a literal. Escaping per character is what makes
    // `a.ts` match `a.ts` and NOT `axts`, and `a+b.ts` match a literal plus.
    out += c.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** True when a repo-relative POSIX path matches the pattern. See the header. */
export function matchGlob(pattern: string, path: string): boolean {
  const target = pattern.includes('/')
    ? path
    : path.slice(path.lastIndexOf('/') + 1);
  return globToRegExp(pattern).test(target);
}
