import { createInterface } from 'node:readline/promises';
import { RunController, applyUndo, parseModelRef, planUndo, type Mode } from '@applivity/plato-core';
import { saveConfig } from './config.js';
import { createStreamSink, executeTask, summary, undoDir } from './host.js';
import { SESSION_HELP, type SessionOptions } from './session.js';
import { listSessions } from './sessions.js';
import { withCloseRejection, type Prompter } from './prompt.js';

/**
 * The plain renderer (D49by): the same engine, the same session rules, and the
 * same sink the one-shot host uses, over readline instead of Ink. It is the
 * fallback when the TUI cannot start and the surface the scripted runs drive.
 */
export interface PlainOptions extends SessionOptions {
  firstPrompt?: string;
}

export async function runPlain(options: PlainOptions): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = withCloseRejection(rl);
  const prompter: Prompter = { ask: question, secret: question };
  const sink = createStreamSink(
    {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
      input: process.stdin,
      prompter,
    },
    'text',
  );

  let config = options.config;
  let mode: Mode = options.mode ?? config.mode;
  let model = options.model ?? config.model;
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  let controller: RunController | null = null;
  const activeController = (): RunController | null => controller;

  const run = async (task: string): Promise<void> => {
    const current = new RunController();
    controller = current;
    const onSigint = (): void => current.cancel();
    process.on('SIGINT', onSigint);
    try {
      const result = await executeTask(
        {
          root: options.root,
          task,
          mode,
          // The plain sink draws no mode card, so the tool is not offered; this
          // only keeps the read live for the mode its own `/mode` changes.
          getMode: () => mode,
          config,
          env: options.env,
          model,
          fetchImpl: options.fetchImpl,
          now: options.now,
          provider: options.provider,
          ...(history.length === 0 ? {} : { history }),
        },
        sink,
        current,
      );
      history.push(
        { role: 'user', text: task },
        { role: 'assistant', text: result.finalText },
      );
      process.stderr.write(`${summary(result)}\n`);
    } catch (error) {
      process.stderr.write(`plato: ${(error as Error).message}\n`);
    } finally {
      process.off('SIGINT', onSigint);
      controller = null;
    }
  };

  if (options.firstPrompt !== undefined && options.firstPrompt.length > 0) {
    await run(options.firstPrompt);
  }

  for (;;) {
    let line: string;
    try {
      line = (await question('› ')).trim();
    } catch {
      break;
    }
    if (line.length === 0) {
      continue;
    }
    if (line === '/exit' || line === '/quit') {
      break;
    }
    if (line.startsWith('/')) {
      const [name = '', ...rest] = line.split(/\s+/);
      const argument = rest.join(' ');
      switch (name) {
        case '/help':
          process.stdout.write(`${SESSION_HELP}\n`);
          break;
        case '/undo': {
          const dir = undoDir(options.root, options.env);
          const plan = planUndo(dir, options.root, 'request');
          if (plan === null) {
            process.stdout.write('Nothing to undo.\n');
            break;
          }
          const result = applyUndo(dir, options.root, plan);
          process.stdout.write(
            `Undo: ${result.applied.length} file${
              result.applied.length === 1 ? '' : 's'
            } put back, ${plan.refuse.length} refused.\n`,
          );
          break;
        }
        case '/team':
          if (argument === 'solo' || argument === 'duo' || argument === 'academy') {
            config = { ...config, team: argument };
            saveConfig(config, options.env);
            process.stdout.write(`Team: ${argument}.\n`);
          } else {
            process.stdout.write('Usage: /team solo|duo|academy\n');
          }
          break;
        case '/sessions': {
          const saved = listSessions(options.root, options.env);
          if (saved.length === 0) {
            process.stdout.write('No saved sessions.\n');
          } else {
            for (const session of saved.slice(0, 10)) {
              process.stdout.write(`${session.id}  ${session.title || '(untitled)'}\n`);
            }
          }
          break;
        }
        case '/mode':
          if (argument === 'plan' || argument === 'edit' || argument === 'auto') {
            mode = argument;
            config = { ...config, mode };
            saveConfig(config, options.env);
            process.stdout.write(`Mode: ${mode}.\n`);
          } else {
            process.stdout.write('Usage: /mode plan|edit|auto\n');
          }
          break;
        case '/model':
          if (parseModelRef(argument, config.connections.map((c) => c.id)) !== null) {
            model = argument;
            config = { ...config, model };
            saveConfig(config, options.env);
            process.stdout.write(`Model: ${model}.\n`);
          } else {
            process.stdout.write(`'${argument}' is not connection:model for a configured connection.\n`);
          }
          break;
        case '/gitignore': {
          const value = argument.toLowerCase();
          if (value !== 'on' && value !== 'off' && value !== 'true' && value !== 'false') {
            process.stdout.write('Usage: /gitignore on|off\n');
            break;
          }
          const respectGitignore = value === 'on' || value === 'true';
          config = { ...config, respectGitignore };
          saveConfig(config, options.env);
          process.stdout.write(
            respectGitignore
              ? 'Search now skips .gitignore paths.\n'
              : 'Search now includes .gitignore paths and marks them.\n',
          );
          break;
        }
        case '/compact': {
          const active = activeController();
          if (active === null) {
            process.stdout.write('Nothing is running.\n');
          } else {
            active.requestCompact();
            process.stdout.write('Compaction requested.\n');
          }
          break;
        }
        case '/new':
          history.length = 0;
          process.stdout.write('New conversation.\n');
          break;
        default:
          process.stdout.write(`Unknown command ${name}. Try /help.\n`);
      }
      continue;
    }
    await run(line);
  }

  rl.close();
  return 0;
}
