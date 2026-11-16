import { render } from 'ink';
import { createElement } from 'react';
import { createLiveSession, type LiveSession } from '@applivity/plato-core';
import { App } from './tui/App.js';
import { Session, type SessionOptions } from './session.js';
import { createPrompter } from './prompt.js';
import { runWizard } from './setup.js';
import { withSuspendedTerminal } from './suspend.js';
import { platoHome } from './paths.js';
import { VERSION } from './version.js';

export interface InteractiveOptions extends SessionOptions {
  /** A prompt given on the command line runs as soon as the app mounts. */
  firstPrompt?: string;
}

export async function runInteractive(options: InteractiveOptions): Promise<number> {
  let instance: ReturnType<typeof render> | undefined;
  const session = new Session({ ...options, onExit: () => instance?.unmount() });
  const home = platoHome(options.env);

  // D49cq: register before the first run so another session can find this one
  // from the moment it is on screen. A failure here costs peer messaging, not
  // the session: the terminal still runs with both tools off.
  let live: LiveSession | undefined;
  try {
    live = await createLiveSession({
      host: 'cli',
      home,
      version: VERSION,
      describe: () => session.describe(),
      receive: (message) => session.receive(message),
    });
    session.setLive(live);
  } catch {
    live = undefined;
  }

  // The registry installs ONE `process.once('exit')` for every session this
  // process opens (D49cq), so a clean exit still unregisters synchronously even
  // when a window holds a dozen chat tabs. A per-session listener here would be
  // the second one for this process.

  const onExit = (): void => {
    instance?.unmount();
  };
  const element = (): ReturnType<typeof createElement> =>
    createElement(App, {
      session,
      onExit,
      ...(options.firstPrompt === undefined ? {} : { firstPrompt: options.firstPrompt }),
    });

  // `/model add` leaves the drawing, runs the setup wizard on the terminal,
  // and comes back. The redraw shows the new connection without a restart.
  session.setAddProvider(async () => {
    await withSuspendedTerminal(
      {
        clear: () => instance?.clear(),
        redraw: () => {
          instance?.rerender(element());
        },
      },
      process.stdin,
      async () => {
        const prompter = createPrompter(process.stdin, process.stderr);
        await runWizard({
          env: options.env,
          streams: {
            out: (text) => process.stdout.write(text),
            err: (text) => process.stderr.write(text),
          },
          prompter,
        });
      },
    );
    session.reloadConfig();
  });

  instance = render(
    element(),
    // Ctrl+C is the run control first and the exit second; App owns it.
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  await live?.close();
  return 0;
}
