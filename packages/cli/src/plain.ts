import { createInterface } from 'node:readline/promises';
import {
  IdleFold,
  RunController,
  applyUndo,
  createProvider,
  digestToolCall,
  historyTokens,
  parseModelRef,
  planFold,
  planUndo,
  recentWorkBlock,
  type ChatProvider,
  type Mode,
} from '@applivity/plato-core';
import { saveConfig } from './config.js';
import { createStreamSink, executeTask, summary, undoDir, type RunSink } from './host.js';
import { SESSION_HELP, type SessionOptions } from './session.js';
import { listSessions } from './sessions.js';
import { withCloseRejection, type Prompter } from './prompt.js';
import {
  chatRowsFromHistory,
  foldConversation,
  requestHistory,
  resolveContextWindow,
  type ChatRow,
  type FoldCause,
} from './compaction.js';
import { connectionNeedsKey, resolveKey } from './keys.js';

/**
 * The plain renderer (D49by): the same engine, the same session rules, and the
 * same sink the one-shot host uses, over readline instead of Ink. It is the
 * fallback when the TUI cannot start and the surface the scripted runs drive.
 *
 * The parity round (D44d, D49cn, D49ck, D49cm) gave it the same conversation
 * rows the Ink session keeps: a summary survives a `/compact`, re-injection
 * follows a fold, and a read outside the project is a three-answer prompt.
 */
export interface PlainOptions extends SessionOptions {
  firstPrompt?: string;
}

export async function runPlain(options: PlainOptions): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = withCloseRejection(rl);
  const prompter: Prompter = { ask: question, secret: question };
  let log: ChatRow[] = chatRowsFromHistory(options.stored?.history ?? []);
  const baseSink = createStreamSink(
    {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
      input: process.stdin,
      prompter,
    },
    'text',
  );
  // The log records tool digests so a fold and the re-injection block can see
  // what the run did, exactly as the Ink session's sink does.
  const sink: RunSink = {
    ...baseSink,
    tool: (event) => {
      if (
        event.phase === 'done' ||
        event.phase === 'refused' ||
        event.phase === 'declined'
      ) {
        log.push({
          k: 'tool',
          tool: event.tool,
          phase: event.phase,
          ...(event.ok === undefined ? {} : { ok: event.ok }),
          digest: digestToolCall(event.tool, event.args ?? {}),
        });
      }
      baseSink.tool(event);
    },
  };

  let config = options.config;
  let mode: Mode = options.mode ?? config.mode;
  let model = options.model ?? config.model;
  let controller: RunController | null = null;
  let folding = false;
  let window: number | null = null;

  const contextWindow = async (): Promise<number> => {
    if (options.maxContext !== undefined) return options.maxContext;
    if (window === null) {
      window = await resolveContextWindow({
        config,
        model,
        env: options.env,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    }
    return window;
  };

  const foldProvider = async (): Promise<ChatProvider | null> => {
    if (options.provider !== undefined) return options.provider;
    const parts = parseModelRef(model, config.connections.map((entry) => entry.id));
    if (parts === null) return null;
    const connection = config.connections.find((entry) => entry.id === parts.connectionId);
    if (connection === undefined) return null;
    const resolved = await resolveKey(connection, { env: options.env });
    if (resolved === null && connectionNeedsKey(connection)) {
      process.stderr.write(`No key for ${connection.id}; the conversation cannot be compacted.\n`);
      return null;
    }
    return createProvider(connection.kind, {
      apiKey: resolved?.key ?? '',
      ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  };

  const foldNow = async (cause: FoldCause, focus = ''): Promise<void> => {
    if (folding || controller !== null) return;
    const maxContext = await contextWindow();
    if (
      cause === 'auto' &&
      planFold(log, {
        maxContext,
        threshold: config.compactionThreshold,
        manual: false,
      }) === null
    ) {
      return;
    }
    const provider = await foldProvider();
    if (provider === null) return;
    folding = true;
    try {
      const outcome = await foldConversation({
        rows: log,
        provider,
        model,
        maxContext,
        threshold: config.compactionThreshold,
        cause,
        ...(focus.length === 0 ? {} : { focus }),
      });
      log = outcome.rows;
      if (outcome.folded) {
        if (outcome.notice !== null) process.stderr.write(`${outcome.notice}\n`);
        return;
      }
      if (outcome.notice !== null) {
        process.stderr.write(`${outcome.notice}\n`);
      } else if (cause === 'manual') {
        process.stderr.write(
          `Conversation is at ${outcome.share}% of this model's context — nothing to compact yet.\n`,
        );
      }
    } catch {
      if (cause === 'manual') {
        process.stderr.write('Compaction failed — try again in a moment.\n');
      }
    } finally {
      folding = false;
    }
  };

  const idleFold = new IdleFold({
    enabled: () => config.compactionIdle === true,
    tokens: () => historyTokens(log),
    busy: () => controller !== null || folding,
    fold: async () => {
      await foldNow('idle');
    },
  });
  const scheduleIdle = (): void => {
    if (!config.compactionIdle) {
      idleFold.cancel();
      return;
    }
    idleFold.schedule();
  };

  const run = async (task: string): Promise<void> => {
    idleFold.cancel();
    const before = log;
    log.push({ k: 'msg', cls: 'you', text: task });
    const current = new RunController();
    controller = current;
    const onSigint = (): void => current.cancel();
    process.on('SIGINT', onSigint);
    try {
      const maxContext = await contextWindow();
      const plan = requestHistory(before, maxContext, config.compactionThreshold);
      if (plan.omitted > 0) {
        process.stderr.write(
          `${plan.omitted} older messages were left out of this request to fit the ` +
            "model's context. The full conversation is still in the transcript.\n",
        );
      }
      const block = await recentWorkBlock(before, { root: options.root });
      if (block !== null) {
        plan.turns.push({ role: 'user', text: block });
      }
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
          ...(plan.turns.length === 0 ? {} : { history: plan.turns }),
        },
        sink,
        current,
      );
      log.push({ k: 'msg', cls: 'bot', text: result.finalText });
      process.stderr.write(`${summary(result)}\n`);
    } catch (error) {
      process.stderr.write(`plato: ${(error as Error).message}\n`);
    } finally {
      process.off('SIGINT', onSigint);
      controller = null;
    }
    try {
      await foldNow('auto');
    } catch {
      // A fold is never a reason for a completed run to look failed.
    }
    scheduleIdle();
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
    // A new line is new input: a pending idle fold must not fire behind it.
    idleFold.cancel();
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
            window = null;
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
          const active = controller as RunController | null;
          if (active === null) {
            try {
              await foldNow('manual', argument);
            } catch {
              process.stderr.write('Compaction failed — try again in a moment.\n');
            }
          } else {
            active.requestCompact();
            process.stdout.write('Compaction requested.\n');
          }
          break;
        }
        case '/new':
          log = [];
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
