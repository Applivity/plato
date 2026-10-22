import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { runAuth, type AuthContext } from './auth.js';
import { ConfigError, loadConfig } from './config.js';
import { runConfig } from './configCommand.js';
import { runDoctor } from './doctor.js';
import { runTask, type OutputFormat } from './host.js';
import { runInteractive } from './interactive.js';
import { runModels } from './models.js';
import { runPlain } from './plain.js';
import { runSessions } from './sessionsCommand.js';
import { createSession, latestSession, loadSession } from './sessions.js';
import { createPrompter, type Prompter } from './prompt.js';
import type { SessionOptions } from './session.js';
import type { CliInput, Streams } from './io.js';

/**
 * Keep in step with package.json; test/cli.test.ts asserts that the two match.
 * A literal means the shipped file carries the version without reading JSON at
 * startup.
 */
import { VERSION } from './version.js';
export { VERSION };

const HELP = `Plato — an AI coding agent for the terminal

Usage
  plato                  Start an interactive session
  plato "task"           Start a session and run the task first
  plato -p "task"        Run one task and exit
  plato -c               Continue the latest session
  plato -r <id>          Resume a saved session
  plato --plain          Interactive session without Ink
  plato <command>

Run
  -p, --print            The answer goes to stdout; tool activity and
                         questions go to stderr
      --mode <mode>      plan, edit, or auto (default: the config's mode)
      --model <ref>      connection:model (default: the config's model)
      --output-format    text, json, or stream-json
      --team <team>      solo, duo, or academy (default: the config's team)

Commands
  auth               Manage connections and API keys
  models             List the models each connection offers
  sessions           List, export, or delete saved conversations
  config             Show or change a setting (see 'plato config --help')
  doctor             Check the config, keys, keychain, and model limits
  help               Show this help

Options
  -h, --help         Show this help
  -v, --version      Print the version
`;

const PRINT_HELP = `Usage
  plato -p "task" [--mode plan|edit|auto] [--model connection:model]
                  [--team solo|duo|academy] [-c | -r <session-id>]
                  [--output-format text|json|stream-json]

  Runs one task and exits. The answer goes to standard output; tool activity,
  approvals, and notes go to standard error.

  Without a terminal an approval is refused and the model is told why. Use
  --mode auto when nobody can answer.
`;

export interface Io extends Streams {
  input?: CliInput;
  /** Injected by tests; created from a terminal otherwise. */
  prompter?: Prompter;
  /** Whether stdout is a terminal. Injected by tests. */
  isTTY?: boolean;
}

function parsePrint(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      continue: { type: 'boolean', short: 'c' },
      resume: { type: 'string', short: 'r' },
      mode: { type: 'string' },
      model: { type: 'string' },
      team: { type: 'string' },
      'output-format': { type: 'string' },
    },
  });
}

async function runPrint(
  args: readonly string[],
  io: Io,
  input: CliInput,
  prompter: Prompter | undefined,
): Promise<number> {
  let parsed: ReturnType<typeof parsePrint>;
  try {
    parsed = parsePrint(args);
  } catch (error) {
    io.err(`plato: ${(error as Error).message}\nRun 'plato -p --help' for usage.\n`);
    return 2;
  }
  if (parsed.values.help === true) {
    io.out(PRINT_HELP);
    return 0;
  }

  const task = parsed.positionals.join(' ').trim();
  if (task.length === 0) {
    io.err("plato: -p needs a task.\nRun 'plato -p --help' for usage.\n");
    return 2;
  }

  const format = parsed.values['output-format'] ?? 'text';
  if (format !== 'text' && format !== 'json' && format !== 'stream-json') {
    io.err("plato: --output-format must be 'text', 'json', or 'stream-json'.\n");
    return 2;
  }

  if (parsed.values.continue === true && parsed.values.resume !== undefined) {
    io.err('plato: use -c or -r, not both.\n');
    return 2;
  }

  const config = loadConfig(process.env);
  const root = process.cwd();
  const env = process.env;
  const stored =
    parsed.values.continue === true
      ? latestSession(root, env)
      : parsed.values.resume !== undefined
        ? loadSession(root, env, parsed.values.resume)
        : null;
  if (parsed.values.continue === true && stored === null) {
    io.err('plato: no session to continue.\n');
    return 1;
  }
  if (parsed.values.resume !== undefined && stored === null) {
    io.err(`plato: no session '${parsed.values.resume}'.\n`);
    return 1;
  }

  const mode = parsed.values.mode ?? stored?.mode ?? config.mode;
  if (mode !== 'plan' && mode !== 'edit' && mode !== 'auto') {
    io.err("plato: --mode must be 'plan', 'edit', or 'auto'.\n");
    return 2;
  }
  const team = parsed.values.team ?? stored?.team ?? config.team;
  if (team !== 'solo' && team !== 'duo' && team !== 'academy') {
    io.err("plato: --team must be 'solo', 'duo', or 'academy'.\n");
    return 2;
  }
  const model = parsed.values.model ?? stored?.model;
  const session = stored ?? createSession(model ?? config.model, mode, team);

  return await runTask({
    root,
    task,
    mode,
    outputFormat: format as OutputFormat,
    config: { ...config, team },
    env,
    io: { out: io.out, err: io.err, input, prompter },
    ...(model === undefined ? {} : { model }),
    ...(session.history.length === 0 ? {} : { history: session.history }),
    session,
  });
}

function sessionOptions(overrides: Partial<ReturnType<typeof loadConfig>> = {}): SessionOptions {
  return {
    root: process.cwd(),
    config: { ...loadConfig(process.env), ...overrides },
    env: process.env,
  };
}

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;
  const input = io.input ?? process.stdin;
  const stdinIsTty = input.isTTY === true;
  const stdoutIsTty = io.isTTY ?? process.stdout.isTTY === true;
  const interactiveAvailable = stdinIsTty && stdoutIsTty;

  if (first === undefined) {
    if (interactiveAvailable) {
      return await runInteractive(sessionOptions());
    }
    io.out(HELP);
    return 0;
  }
  if (first === '-h' || first === '--help') {
    io.out(HELP);
    return 0;
  }
  if (first === '-v' || first === '--version') {
    io.out(`${VERSION}\n`);
    return 0;
  }

  // Questions and approvals go to stderr, so stdout carries only the answer.
  const prompter = io.prompter ?? (stdinIsTty ? createPrompter(process.stdin, process.stderr) : undefined);

  try {
    if (first === '-c' || first === '--continue' || first === '-r' || first === '--resume') {
      const wantsId = first === '-r' || first === '--resume';
      const id = wantsId ? rest[0] : undefined;
      const tail = wantsId ? rest.slice(1) : rest;
      if (wantsId && (id === undefined || id.startsWith('-'))) {
        io.err('usage: plato -r <session-id>\n');
        return 2;
      }
      const root = process.cwd();
      const stored =
        id === undefined ? latestSession(root, process.env) : loadSession(root, process.env, id);
      if (stored === null) {
        io.err(id === undefined ? 'plato: no session to continue.\n' : `plato: no session '${id}'.\n`);
        return 1;
      }
      if (!interactiveAvailable) {
        io.err(
          'plato: resuming needs an interactive terminal. Use ' +
            'plato -p -c "<task>" to continue with one task.\n',
        );
        return 2;
      }
      const prompt = tail.join(' ').trim();
      return await runInteractive({
        ...sessionOptions(),
        stored,
        ...(prompt.length === 0 ? {} : { firstPrompt: prompt }),
      });
    }
    if (first === '--team') {
      const team = rest[0];
      if (team !== 'solo' && team !== 'duo' && team !== 'academy') {
        io.err("plato: --team must be 'solo', 'duo', or 'academy'.\n");
        return 2;
      }
      const tail = rest.slice(1);
      if (tail[0] === '--plain') {
        const prompt = tail.slice(1).join(' ').trim();
        return await runPlain({
          ...sessionOptions({ team }),
          ...(prompt.length === 0 ? {} : { firstPrompt: prompt }),
        });
      }
      if (!interactiveAvailable) {
        io.err(
          "plato: --team needs an interactive terminal. Use plato -p \"<task>\" --team " +
            `${team} instead.\n`,
        );
        return 2;
      }
      const prompt = tail.join(' ').trim();
      return await runInteractive({
        ...sessionOptions({ team }),
        ...(prompt.length === 0 ? {} : { firstPrompt: prompt }),
      });
    }
    if (first === '--plain') {
      const prompt = rest.join(' ').trim();
      return await runPlain({
        ...sessionOptions(),
        ...(prompt.length === 0 ? {} : { firstPrompt: prompt }),
      });
    }
    if (first === '-p' || first === '--print') {
      return await runPrint(rest, io, input, prompter);
    }
    if (first.startsWith('-')) {
      io.err(`plato: unknown option '${first}'\nRun 'plato --help' for usage.\n`);
      return 2;
    }

    switch (first) {
      case 'help':
        io.out(HELP);
        return 0;
      case 'auth': {
        const context: AuthContext = {
          env: process.env,
          streams: io,
          input,
          prompter,
        };
        return await runAuth(rest, context);
      }
      case 'models':
        return await runModels(rest, { env: process.env, streams: io });
      case 'sessions':
        return runSessions(rest, {
          root: process.cwd(),
          env: process.env,
          streams: io,
        });
      case 'config':
        return runConfig(rest, { env: process.env, streams: io });
      case 'doctor':
        return await runDoctor({ env: process.env, streams: io, root: process.cwd() });
      default: {
        if (interactiveAvailable) {
          return await runInteractive({
            ...sessionOptions(),
            firstPrompt: argv.join(' '),
          });
        }
        io.err(
          `plato: unknown command '${first}'\n` +
            'To run one task, use: plato -p "<task>"\n' +
            "Run 'plato --help' for usage.\n",
        );
        return 2;
      }
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      io.err(`plato: ${error.message}\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.err(`plato: ${message}\n`);
    return 1;
  }
}

/**
 * An installed bin is a symlink in `node_modules/.bin`; `import.meta.url` is
 * the real file while `process.argv[1]` is the link. Compare the real path so
 * `plato --version` works from an install, not just from `node dist/cli.js`.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isEntryPoint()) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    input: process.stdin,
  });
}
