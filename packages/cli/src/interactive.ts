import { render } from 'ink';
import { createElement } from 'react';
import {
  createLiveSession,
  unregisterOnExit,
  type LiveSession,
} from '@applivity/plato-core';
import { App } from './tui/App.js';
import { Session, type SessionOptions } from './session.js';
import { platoHome } from './paths.js';
import { VERSION } from './version.js';

export interface InteractiveOptions extends SessionOptions {
  /** A prompt given on the command line runs as soon as the app mounts. */
  firstPrompt?: string;
}

export async function runInteractive(options: InteractiveOptions): Promise<number> {
  const session = new Session(options);
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

  const id = live?.id;
  const onProcessExit = (): void => {
    // Async work cannot run in an exit handler; removing the entry and socket
    // synchronously is what makes a clean exit look clean to other sessions.
    if (id !== undefined) unregisterOnExit(home, id);
  };
  if (id !== undefined) process.once('exit', onProcessExit);

  let instance: ReturnType<typeof render> | undefined;
  const onExit = (): void => {
    instance?.unmount();
  };
  instance = render(
    createElement(App, {
      session,
      onExit,
      ...(options.firstPrompt === undefined ? {} : { firstPrompt: options.firstPrompt }),
    }),
    // Ctrl+C is the run control first and the exit second; App owns it.
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  if (id !== undefined) process.off('exit', onProcessExit);
  await live?.close();
  return 0;
}
