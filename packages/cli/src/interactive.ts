import { render } from 'ink';
import { createElement } from 'react';
import { createLiveSession, type LiveSession } from '@applivity/plato-core';
import { App } from './tui/App.js';
import { Session, type SessionOptions } from './session.js';
import { EMPTY_EDITOR, setText, type EditorState } from './editor.js';
import { runEditor } from './externalEditor.js';
import { loadHistory, recordHistory, saveHistory, type HistoryEntry } from './history.js';
import { platoHome } from './paths.js';
import { withSuspendedTerminal, type TerminalFrame } from './suspend.js';
import { VERSION } from './version.js';

export interface InteractiveOptions extends SessionOptions {
  /** A prompt given on the command line runs as soon as the app mounts. */
  firstPrompt?: string;
}

export async function runInteractive(options: InteractiveOptions): Promise<number> {
  let instance: ReturnType<typeof render> | undefined;
  let finish: () => void = () => {};
  // The app can unmount for Ctrl+G and mount again. Exit is the app's own
  // decision, not the disappearance of one Ink instance.
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onExit = (): void => {
    finish();
    instance?.unmount();
  };
  const session = new Session({ ...options, onExit });
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

  // History is per workspace and outlives the process; the App reads it for
  // Ctrl+R and the up arrow, and every submitted line is appended here.
  const history: HistoryEntry[] = loadHistory(options.root, options.env);
  const remember = (line: string): HistoryEntry[] => {
    const next = recordHistory(history, line);
    history.splice(0, history.length, ...next);
    try {
      saveHistory(options.root, options.env, history);
    } catch {
      // A history that cannot be written is a convenience lost, not a session.
    }
    return [...history];
  };

  // The draft outlives the Ink tree for the same reason: Ctrl+G unmounts it,
  // and the editor's result must be in the composer when it comes back.
  let draft: EditorState = EMPTY_EDITOR;
  // Rows already in the scrollback before this mount, so a remount shows the
  // new ones only instead of writing the transcript again.
  let staticFrom = 0;
  let pendingFirstPrompt = options.firstPrompt;
  let editing = false;

  function mount(): void {
    // The first prompt runs once, on the first mount, not every remount.
    const first = pendingFirstPrompt;
    pendingFirstPrompt = undefined;
    instance = render(
      createElement(App, {
        session,
        onExit,
        ...(first === undefined ? {} : { firstPrompt: first }),
        history,
        remember,
        draft,
        onDraft: (next: EditorState) => {
          draft = next;
        },
        editDraft,
        staticFrom,
      }),
      // Ctrl+C is the run control first and the exit second; App owns it.
      { exitOnCtrlC: false },
    );
  }

  const frame: TerminalFrame = {
    unmount: () => {
      staticFrom = session.getSnapshot().rows.length;
      // A remount draws its own header, status line and composer; leaving the
      // old frame behind would put two of each on screen.
      instance?.clear();
      instance?.unmount();
    },
    mount,
  };

  /**
   * Ctrl+G: hand the terminal to the user's editor and bring the draft back.
   * Nothing is sent — the text goes to the composer with the cursor at its end.
   */
  async function editDraft(): Promise<void> {
    if (editing) {
      return;
    }
    editing = true;
    const before = draft;
    try {
      await withSuspendedTerminal(frame, async () => {
        try {
          const outcome = await runEditor(before.text, { env: options.env });
          if (outcome.text !== undefined) {
            draft = setText(outcome.text);
          } else if (outcome.error !== undefined) {
            draft = before;
            session.addNotice(outcome.error);
          }
        } catch {
          draft = before;
          session.addNotice('Could not open the editor; your draft is unchanged.');
        }
      });
    } finally {
      editing = false;
    }
  }

  mount();
  await done;
  await live?.close();
  return 0;
}
