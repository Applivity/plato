import { listWorkspace } from '@applivity/plato-core';

/**
 * `@` completion in the composer (R2-3).
 *
 * The token is one word that starts with `@`; an `@` inside a word (an email,
 * `user@host`) is text. The listing comes from the same ignore-aware walker the
 * tools use, so a protected file is never offered and `respectGitignore` means
 * the same thing here as in search.
 */
export const FILE_MENU_LIMIT = 50;

export interface FileToken {
  /** The `@`'s index in the line. */
  start: number;
  /** What was typed after the `@`, without it. */
  query: string;
}

export interface FileChoice {
  /** Repo-relative POSIX path, without a trailing slash. */
  path: string;
  kind: 'file' | 'dir';
}

export interface FileMenuData {
  token: FileToken;
  /** The first FILE_MENU_LIMIT matches. */
  choices: FileChoice[];
  /** How many matches there were, before the cap. */
  total: number;
}

/**
 * The `@` token under the cursor. Only a token start counts, only one line,
 * and only with the cursor at the token's end: an Enter or Tab then replaces
 * exactly what was typed.
 */
export function fileToken(text: string, cursor: number): FileToken | null {
  if (text.includes('\n')) {
    return null;
  }
  const at = Math.max(0, Math.min(cursor, text.length));
  const match = /(^|\s)@([^\s]*)$/.exec(text.slice(0, at));
  if (match === null) {
    return null;
  }
  if (at < text.length && !/\s/.test(text[at] ?? '')) {
    return null;
  }
  const query = match[2] ?? '';
  return { start: at - query.length - 1, query };
}

/** The workspace paths, from the walker the tools share. */
export function workspaceFiles(root: string, respectGitignore: boolean): string[] {
  return listWorkspace(root, '', { respectGitignore }).files;
}

/**
 * The choices for a query: the immediate entries under its directory, matching
 * the last segment. Folders come first, then files, each in name order.
 */
export function matchFiles(files: readonly string[], query: string): FileChoice[] {
  const slash = query.lastIndexOf('/');
  const dir = slash < 0 ? '' : query.slice(0, slash + 1);
  const fragment = (slash < 0 ? query : query.slice(slash + 1)).toLowerCase();
  const dirs = new Set<string>();
  const found: FileChoice[] = [];
  for (const file of files) {
    if (!file.startsWith(dir)) {
      continue;
    }
    const rest = file.slice(dir.length);
    if (rest.length === 0) {
      continue;
    }
    const cut = rest.indexOf('/');
    if (cut < 0) {
      if (rest.toLowerCase().startsWith(fragment)) {
        found.push({ path: `${dir}${rest}`, kind: 'file' });
      }
    } else {
      const name = rest.slice(0, cut);
      if (name.toLowerCase().startsWith(fragment)) {
        dirs.add(`${dir}${name}`);
      }
    }
  }
  const choices: FileChoice[] = [
    ...[...dirs].map((path) => ({ path, kind: 'dir' as const })),
    ...found,
  ];
  choices.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'dir' ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return choices;
}

/** The menu for the token, capped; `total` is what was there before the cap. */
export function fileMenu(
  files: readonly string[],
  token: FileToken,
): FileMenuData {
  const all = matchFiles(files, token.query);
  return {
    token,
    choices: all.slice(0, FILE_MENU_LIMIT),
    total: all.length,
  };
}

/** What a choice puts in the line, and where the cursor goes. */
export function fileInsertion(choice: FileChoice): string {
  return choice.kind === 'dir' ? `@${choice.path}/` : `@${choice.path} `;
}
