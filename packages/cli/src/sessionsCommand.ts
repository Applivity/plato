import type { Env } from './paths.js';
import type { Streams } from './io.js';
import { deleteSession, latestSession, listSessions, loadSession } from './sessions.js';

export const SESSIONS_HELP = `Usage
  plato sessions list
  plato sessions export [id]
  plato sessions delete <id>

  list    Saved conversations for this project, newest first.
  export  Print one as JSON. The latest is used when no id is given.
  delete  Remove one. An id prefix is enough.
`;

export function runSessions(
  args: readonly string[],
  options: { root: string; env: Env; streams: Streams },
): number {
  const [sub, id] = args;
  if (sub === undefined) {
    options.streams.err(`${SESSIONS_HELP}\n`);
    return 2;
  }
  if (sub === '-h' || sub === '--help') {
    options.streams.out(SESSIONS_HELP);
    return 0;
  }

  if (sub === 'list') {
    const sessions = listSessions(options.root, options.env);
    if (sessions.length === 0) {
      options.streams.out('No saved sessions for this project.\n');
      return 0;
    }
    for (const session of sessions) {
      options.streams.out(
        `${session.id}  ${session.title.length > 0 ? session.title : '(untitled)'}  [${session.model}]\n`,
      );
    }
    return 0;
  }

  if (sub === 'export') {
    const session =
      id === undefined ? latestSession(options.root, options.env) : loadSession(options.root, options.env, id);
    if (session === null) {
      options.streams.err(
        id === undefined ? 'plato sessions: no saved sessions.\n' : `plato sessions: no session '${id}'.\n`,
      );
      return 1;
    }
    options.streams.out(`${JSON.stringify(session, null, 2)}\n`);
    return 0;
  }

  if (sub === 'delete') {
    if (id === undefined) {
      options.streams.err('usage: plato sessions delete <id>\n');
      return 2;
    }
    if (!deleteSession(options.root, options.env, id)) {
      options.streams.err(`plato sessions: no session '${id}' (or the id is ambiguous).\n`);
      return 1;
    }
    options.streams.out(`Deleted ${id}.\n`);
    return 0;
  }

  options.streams.err(`plato sessions: unknown command '${sub}'.\nRun 'plato sessions --help' for usage.\n`);
  return 2;
}
