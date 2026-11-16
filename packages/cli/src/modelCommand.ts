import { parseModelRef } from '@applivity/plato-core';
import { loadConfig, saveConfig } from './config.js';
import type { Streams } from './io.js';
import { connectionModels, modelRefs } from './modelList.js';
import type { Env } from './paths.js';
import { readLine, type Prompter } from './prompt.js';
import type { CliInput } from './io.js';
import { runWizard } from './setup.js';

export const MODEL_HELP = `Usage
  plato model                         List the models and pick one
  plato model <connection:model>      Use that model from now on

  The list marks the model in use. Press Enter to keep it.
`;

export async function runModel(
  args: readonly string[],
  options: {
    env: Env;
    streams: Streams;
    prompter?: Prompter;
    input?: CliInput;
    fetchImpl?: typeof fetch;
  },
): Promise<number> {
  const { env, streams, prompter } = options;
  const [first] = args;
  if (first === '-h' || first === '--help') {
    streams.out(MODEL_HELP);
    return 0;
  }

  const config = loadConfig(env);
  const ids = config.connections.map((connection) => connection.id);

  if (first !== undefined) {
    if (parseModelRef(first, ids) === null) {
      streams.err(
        `'${first}' is not connection:model for a configured connection. ` +
          "Run 'plato model' to see the choices.\n",
      );
      return 2;
    }
    saveConfig({ ...config, model: first }, env);
    streams.out(`Using ${first}.\n`);
    return 0;
  }

  if (config.connections.length === 0) {
    if (prompter === undefined) {
      streams.err("No connections yet. Run 'plato auth login' to set one up.\n");
      return 2;
    }
    return await runWizard({ env, streams, prompter });
  }

  const lists = await connectionModels(config, {
    env,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const refs = modelRefs(lists);
  // The model in use may not be listed (an old id, an offline endpoint). Keep
  // it visible so the mark has something to sit on.
  if (config.model.length > 0 && !refs.includes(config.model)) {
    refs.unshift(config.model);
  }

  streams.out('Models\n');
  refs.forEach((ref, index) => {
    streams.out(`  ${index + 1}. ${ref}${ref === config.model ? '  (current)' : ''}\n`);
  });
  for (const list of lists) {
    if (list.note !== undefined) {
      streams.out(`  ${list.id}: ${list.note}\n`);
    }
  }

  let answer = '';
  if (prompter !== undefined) {
    answer = (await prompter.ask('Model (number, or Enter keeps the current): ')).trim();
  } else if (options.input !== undefined && options.input.isTTY !== true) {
    // A piped answer is still an answer; an empty pipe means "keep".
    answer = (await readLine(options.input)).trim();
  } else {
    return 0;
  }
  if (answer.length === 0) {
    streams.out(`Using ${config.model}.\n`);
    return 0;
  }
  const index = Number(answer);
  const chosen =
    Number.isInteger(index) && index >= 1 && index <= refs.length
      ? refs[index - 1]
      : refs.find((ref) => ref === answer);
  if (chosen === undefined) {
    streams.err(
      `'${answer}' was not one of the choices, so nothing changed; ` +
        `use a number from 1 to ${refs.length} or Enter to keep the current model.\n`,
    );
    return 2;
  }
  saveConfig({ ...config, model: chosen }, env);
  streams.out(`Using ${chosen}.\n`);
  return 0;
}
