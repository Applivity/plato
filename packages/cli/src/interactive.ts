import { render } from 'ink';
import { createElement } from 'react';
import { App } from './tui/App.js';
import { Session, type SessionOptions } from './session.js';

export interface InteractiveOptions extends SessionOptions {
  /** A prompt given on the command line runs as soon as the app mounts. */
  firstPrompt?: string;
}

export async function runInteractive(options: InteractiveOptions): Promise<number> {
  const session = new Session(options);
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
  return 0;
}
