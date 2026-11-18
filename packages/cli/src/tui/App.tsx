import { Box, Static, Text, useInput, useWindowSize } from 'ink';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  EMPTY_EDITOR,
  backspace,
  deleteForward,
  deleteWordBack,
  deleteWordForward,
  insertText,
  moveCursor,
  moveWordLeft,
  moveWordRight,
  setText,
  toEnd,
  toStart,
  type EditorState,
} from '../editor.js';
import type { Card, Row, Session, SessionStatus, ViewState } from '../session.js';
import { formatDuration, statusLine, tokenRate } from './statusLine.js';
import {
  displayWidth,
  stripTerminalEscapes,
  truncateToWidth,
  wrapToWidth,
} from '../format/terminal.js';
import { headerTitle, headerTitleRoom } from './header.js';
import {
  recordHistory,
  relativeTime,
  searchHistory,
  type HistoryEntry,
} from '../history.js';
import {
  fileInsertion,
  fileMenu,
  fileToken,
  workspaceFiles,
  type FileMenuData,
} from '../fileCompletion.js';
import { Markdown } from './Markdown.js';
import { SetupScreen } from './Setup.js';
import { Welcome } from './Welcome.js';
import {
  accepted,
  argumentEnter,
  argumentMenu,
  enterAction,
  menuWindow,
  slashQuery,
  slashText,
  suggest,
  type SlashCommand,
  type ArgumentMenu as ArgumentMenuShape,
} from '../completion.js';
import { draftChip, liveTail, pastedText, removesWholeDraft } from './composer.js';

export interface AppProps {
  session: Session;
  onExit: () => void;
  firstPrompt?: string;
  /** This workspace's history, oldest first; reverse search reads it. */
  history?: HistoryEntry[];
  /** Persists and returns the next history. */
  remember?: (line: string) => HistoryEntry[];
  /** The draft to start with, after an external editor or a remount. */
  draft?: EditorState;
  /** Receives every edit, so the host keeps the draft across a suspend. */
  onDraft?: (state: EditorState) => void;
  /** Opens the draft in the user's editor (Ctrl+G); the host remounts. */
  editDraft?: () => Promise<void>;
  /** Rows already on screen before this mount, so a remount does not replay them. */
  staticFrom?: number;
}

/** What Ctrl+R is showing: the query, the chosen match, and the draft to go back to. */
interface SearchState {
  query: string;
  at: number;
  saved: EditorState;
}

const MODE_COLOR: Record<SessionStatus['mode'], string> = {
  plan: 'blue',
  edit: 'green',
  auto: 'yellow',
};

/** What the target mode means, on the card that asks for it (D49cb). */
const MODE_MEANING: Record<SessionStatus['mode'], string> = {
  plan: 'Plan mode reads and proposes. It cannot write, and it runs only commands that read.',
  edit: 'Edit mode asks before a write or a command.',
  auto: 'Auto mode writes and runs commands without asking.',
};

/** Ink's colours ignore NO_COLOR in this build (measured), so the TUI checks it. */
const COLOURS = process.env.NO_COLOR === undefined;

export function App({
  session,
  onExit,
  firstPrompt,
  history = [],
  remember,
  draft,
  onDraft,
  editDraft,
  staticFrom = 0,
}: AppProps): ReactElement {
  const state: ViewState = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { columns, rows } = useWindowSize();
  const [editor, setEditor] = useState<EditorState>(draft ?? EMPTY_EDITOR);
  const [entries, setEntries] = useState<HistoryEntry[]>(history);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [toolOpen, setToolOpen] = useState(false);
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const [ctrlC, setCtrlC] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [choice, setChoice] = useState(0);
  // Esc closes the menu for the text it was showing; the next keystroke reopens it.
  const [menuDismissedAt, setMenuDismissedAt] = useState<string | null>(null);

  // D49cq: an inbound message must never swallow a half-written prompt, so the
  // session asks whether the editor is empty at the moment the message lands.
  // A ref keeps that answer current without re-subscribing on every keystroke.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    session.setEditorProbe(() => editorRef.current.text.length === 0);
    // A suspended App has no editor to ask; without this the old instance would
    // answer for a tree that is no longer on screen.
    return () => session.setEditorProbe(() => true);
  }, [session]);
  // The host keeps the draft so Ctrl+G can unmount, run the editor, and mount
  // again with the same text and cursor.
  useEffect(() => {
    onDraft?.(editor);
  }, [editor, onDraft]);
  // A card owns the keyboard; a search left open underneath it would take the
  // next Esc as its own.
  useEffect(() => {
    if (state.card !== null) {
      setSearch(null);
      setToolOpen(false);
    }
  }, [state.card]);

  const query = slashQuery(editor.text);
  const matches = query === null ? [] : suggest(query);
  const argument = query === null ? argumentMenu(editor.text) : null;
  // The workspace is walked once each time a file token opens, not on every
  // keystroke: typing filters the list already in hand.
  const atFile = fileToken(editor.text, editor.cursor);
  const workspacePaths = useMemo(
    () =>
      atFile === null || editor.text.startsWith('/')
        ? []
        : workspaceFiles(session.root, session.respectGitignore),
    [session, atFile === null, editor.text.startsWith('/'), session.respectGitignore],
  );
  const fileMenuData = atFile === null ? null : fileMenu(workspacePaths, atFile);
  // The focused row for Ctrl+O is the latest tool row: the run appends its
  // rows in order, so the last one is the call the user just watched.
  const toolRow = useMemo(() => {
    for (let index = state.rows.length - 1; index >= 0; index -= 1) {
      const row = state.rows[index];
      if (row !== undefined && row.kind === 'tool') {
        return row;
      }
    }
    return undefined;
  }, [state.rows]);
  const menuDismissed = menuDismissedAt === editor.text;
  const nameOpen =
    query !== null &&
    matches.length > 0 &&
    state.card === null &&
    !state.running &&
    !menuDismissed;
  const argOpen = argument !== null && state.card === null && !state.running && !menuDismissed;
  // `@` completion follows the same rules as the menus: no card, no run, and a
  // line that is a prompt rather than a slash command.
  const fileOpen =
    fileMenuData !== null &&
    fileMenuData.choices.length > 0 &&
    state.card === null &&
    !state.running &&
    !state.setup &&
    search === null &&
    !menuDismissed &&
    !editor.text.startsWith('/');
  const menuRows = nameOpen
    ? matches.length
    : argOpen
      ? (argument?.choices.length ?? 0)
      : fileOpen
        ? (fileMenuData?.choices.length ?? 0)
        : 0;
  const active = Math.min(choice, Math.max(0, menuRows - 1));
  // A different list (a narrower name match, another argument word, another
  // file query) starts at its best entry, not at the row from the last one.
  const menuKey = nameOpen
    ? `name:${query ?? ''}`
    : argOpen
      ? `arg:${argument?.command.name ?? ''}:${argument?.fragment ?? ''}`
      : fileOpen
        ? `file:${fileMenuData?.token.query ?? ''}`
        : null;
  // The banner belongs to the empty conversation only: a first prompt is about
  // to replace it, and a resumed session already has a transcript (D49ce).
  const showWelcome =
    state.rows.length === 0 &&
    state.streaming.length === 0 &&
    state.card === null &&
    !state.running &&
    firstPrompt === undefined;
  // Reverse search: newest first, and the chosen row is clamped as the query
  // narrows so a shorter result list never points past its end.
  const hits = search === null ? [] : searchHistory(entries, search.query);
  const hitAt = search === null ? 0 : Math.min(search.at, Math.max(0, hits.length - 1));
  const hit = hits[hitAt];

  useEffect(() => {
    setChoice(0);
  }, [menuKey]);

  useEffect(() => {
    if (firstPrompt !== undefined && firstPrompt.length > 0) {
      void session.submit(firstPrompt);
    }
    // The first prompt runs once, when the app mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.running) {
      setCtrlC(0);
    }
  }, [state.running]);

  // The elapsed seconds tick only while a run is in progress; an idle
  // terminal leaves no interval behind.
  useEffect(() => {
    if (!state.running) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.running]);
  // A cold-start step is silent for its first second. Rendering at that
  // boundary makes the phrase appear after about a second, not at the next
  // whole-second tick.
  useEffect(() => {
    const since = state.status.waitingSince;
    if (!state.running || state.status.waiting === undefined || since === undefined) {
      return;
    }
    const id = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, since + 1000 - Date.now()),
    );
    return () => clearTimeout(id);
  }, [state.running, state.status.waiting, state.status.waitingSince]);

  const rememberLine = (line: string): void => {
    setEntries(remember === undefined ? recordHistory(entries, line) : remember(line));
  };

  const submitLine = async (line: string): Promise<void> => {
    setEditor(EMPTY_EDITOR);
    setHistoryAt(null);
    setSearch(null);
    setMenuDismissedAt(null);
    rememberLine(line);
    // A draft block is a message even when its first line starts with a slash:
    // only a single line can be a command.
    if (line.startsWith('/') && !line.includes('\n')) {
      if ((await session.handleCommand(line)) === 'exit') {
        onExit();
      }
      return;
    }
    await session.submit(line);
  };

  /**
   * A slash command typed while a run is going (or paused) runs at once. It is
   * a control, not direction for the model: `/queue` must queue, `/continue`
   * must resume, and steering them to the model would do neither.
   */
  const runCommand = (line: string): void => {
    setEditor(EMPTY_EDITOR);
    setHistoryAt(null);
    setSearch(null);
    setMenuDismissedAt(null);
    rememberLine(line);
    void session.handleCommand(line).then((outcome) => {
      if (outcome === 'exit') {
        onExit();
      }
    });
  };

  useInput((input, key) => {
    // The setup screen owns the keyboard while it is up.
    if (state.setup) {
      return;
    }
    const enter = key.return || input === '\r' || input === '\n';
    const newline = input.includes('\r') || input.includes('\n');
    const card = state.card;
    if (card !== null) {
      if (key.upArrow) {
        session.cardMove(-1);
        return;
      }
      if (key.downArrow) {
        session.cardMove(1);
        return;
      }
      // Alt+Enter (or Shift+Enter) is a composer key; a card has no multi-line
      // field, so it must not answer the card by accident.
      if (enter && (key.meta || key.shift)) {
        return;
      }
      if (enter) {
        session.cardConfirm();
        return;
      }
      if (key.escape) {
        // On an approval card Esc is deny AND stop; every other card keeps
        // today's meaning, and Ctrl+C answers safely on all of them.
        if (card.kind === 'approval') {
          session.cardStop();
        } else {
          session.cardCancel();
        }
        return;
      }
      // Ctrl+C answers a card with its safe choice. Before this it
      // was ignored while a card was open — the one moment the run is waiting on
      // the user, so the one moment the key must not do nothing (D49cb).
      if (key.ctrl && input === 'c') {
        session.cardCancel();
        return;
      }
      if (card.kind === 'question' && card.freeText) {
        if (key.backspace || key.delete) {
          session.cardBackspace();
          return;
        }
        // A paste arrives as one string, Enter included.
        if (newline && !key.ctrl && !key.meta) {
          session.cardType(input.replace(/[\r\n]+/g, ''));
          session.cardConfirm();
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          session.cardType(input);
        }
        return;
      }
      if (card.kind === 'model') {
        // The picker takes a number, the arrows, Enter or Esc. Anything else is
        // said plainly and the picker stays open.
        if (/^[1-9]$/.test(input) && Number(input) <= card.options.length) {
          session.cardMove(Number(input) - 1 - card.selected);
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          session.cardNotice(`'${input.trim()}' is not a choice; nothing changed — use the arrows and Enter, or Esc.`);
        }
        return;
      }
      if (input === ' ') {
        session.cardToggle();
        return;
      }
      if (/^[1-9]$/.test(input)) {
        const index = Number.parseInt(input, 10) - 1;
        const last = card.kind === 'question' ? card.options.length : card.options.length - 1;
        if (index <= last) {
          session.cardMove(index - card.selected);
        }
      }
      return;
    }

    // Ctrl+R reverse-searches this workspace's history. The composer keeps the
    // line it had until Enter takes a match or Esc puts it back.
    if (search !== null) {
      const step = (delta: number): void => {
        setSearch({
          ...search,
          at: Math.max(0, Math.min(hits.length - 1, hitAt + delta)),
        });
      };
      if (key.escape) {
        setEditor(search.saved);
        setSearch(null);
        return;
      }
      if (enter) {
        if (hit !== undefined) {
          setEditor(setText(hit.text));
          setSearch(null);
          setHistoryAt(null);
          setMenuDismissedAt(null);
        }
        return;
      }
      if ((key.ctrl && input === 'r') || key.upArrow) {
        step(1);
        return;
      }
      if (key.downArrow) {
        step(-1);
        return;
      }
      if (key.backspace) {
        setSearch({ query: search.query.slice(0, -1), at: 0, saved: search.saved });
        return;
      }
      if (!key.ctrl && !key.meta && input.length > 0) {
        const typed = input.replace(/[\r\n]+/g, '');
        if (typed.length > 0) {
          setSearch({ query: search.query + typed, at: 0, saved: search.saved });
        }
        return;
      }
      if (!(key.ctrl && input === 'c')) {
        return;
      }
      // Ctrl+C keeps its usual meaning; the search closes first.
      setSearch(null);
    }
    // Alt+Enter starts a new line in the composer. The parser reports it as
    // return with `meta`, not as escape, so it cannot trip the pause. Shift+
    // Enter is accepted where the terminal reports it; it is never advertised,
    // because most terminals cannot send it.
    if (enter && (key.meta || key.shift)) {
      setEditor(insertText(editor, '\n'));
      setMenuDismissedAt(editor.text);
      return;
    }
    if (key.ctrl && input === 'r') {
      setToolOpen(false);
      setSearch({ query: '', at: 0, saved: editor });
      return;
    }
    if (key.ctrl && input === 'g') {
      if (editDraft !== undefined) {
        void editDraft();
      }
      return;
    }
    // Ctrl+O opens the latest tool row's detail; the same key closes it.
    if (key.ctrl && input === 'o') {
      if (toolRow !== undefined) {
        setToolOpen((open) => !open);
      }
      return;
    }
    if (toolOpen && key.escape) {
      setToolOpen(false);
      return;
    }

    if (key.tab && key.shift) {
      session.cycleMode();
      return;
    }
    // The command menu owns the arrows, Enter, Tab, and Esc while it is open.
    // Every other key still edits the line, and the menu follows the text.
    if (nameOpen) {
      const pick = matches[active];
      if (key.upArrow) {
        setChoice(Math.max(0, active - 1));
        return;
      }
      if (key.downArrow) {
        setChoice(Math.min(matches.length - 1, active + 1));
        return;
      }
      if (key.escape) {
        setMenuDismissedAt(editor.text);
        return;
      }
      if (key.tab && pick !== undefined) {
        // Tab fills the line in; Enter is what runs it.
        setEditor(setText(accepted(pick).text));
        setMenuDismissedAt(null);
        return;
      }
      if (enter && pick !== undefined) {
        const choice = enterAction(editor.text, pick);
        setMenuDismissedAt(null);
        if (choice.action === 'run') {
          void submitLine(choice.text);
          return;
        }
        setEditor(setText(choice.text));
        return;
      }
    }
    // After the command name, the same keys move through the argument words.
    // Enter runs only an exact choice; a partial word is completed. A wrong
    // argument closes the menu and reaches the command, which says its error.
    if (argOpen && argument !== null) {
      const pick = argument.choices[active];
      if (key.upArrow || key.downArrow) {
        if (argument.choices.length > 0) {
          setChoice(
            key.upArrow
              ? Math.max(0, active - 1)
              : Math.min(argument.choices.length - 1, active + 1),
          );
        }
        return;
      }
      if (key.escape) {
        setMenuDismissedAt(editor.text);
        return;
      }
      if (key.tab) {
        if (pick !== undefined) {
          setEditor(setText(`/${argument.command.name} ${pick.value}`));
          setMenuDismissedAt(null);
        }
        return;
      }
      if (enter) {
        setMenuDismissedAt(null);
        const outcome = argumentEnter(editor.text, argument, pick);
        if (outcome !== null) {
          if (outcome.action === 'run') {
            void submitLine(outcome.text);
          } else {
            setEditor(setText(outcome.text));
          }
          return;
        }
        // A free-text command has no choice to take: the ordinary Enter below
        // runs the line as typed.
      }
    }
    // `@` completion: a choice is inserted into the line, never sent. A folder
    // keeps its `/`, so the list stays open on its own contents.
    if (fileOpen && fileMenuData !== null) {
      const pick = fileMenuData.choices[active];
      if (key.upArrow || key.downArrow) {
        setChoice(
          key.upArrow
            ? Math.max(0, active - 1)
            : Math.min(fileMenuData.choices.length - 1, active + 1),
        );
        return;
      }
      if (key.escape) {
        setMenuDismissedAt(editor.text);
        return;
      }
      if ((enter || key.tab) && pick !== undefined) {
        const inserted = fileInsertion(pick);
        setEditor({
          text: `${editor.text.slice(0, fileMenuData.token.start)}${inserted}${editor.text.slice(editor.cursor)}`,
          cursor: fileMenuData.token.start + inserted.length,
        });
        setMenuDismissedAt(null);
        return;
      }
    }
    if (key.escape) {
      // A card, a menu, or the tool panel has already taken Esc above; only a
      // press the run itself hears reaches here. The first asks for a pause,
      // the next press stops.
      if (state.running) {
        session.escapeDuringRun();
      }
      return;
    }
    if (key.ctrl && input === 'c') {
      if (state.running) {
        session.cancel();
        return;
      }
      if (ctrlC >= 1) {
        onExit();
        return;
      }
      setCtrlC(1);
      session.addNotice('Press Ctrl+C again to exit.');
      return;
    }
    if (enter) {
      const line = editor.text.trim();
      // Only a single line can be a command; a draft block is always a message.
      const command = line.startsWith('/') && !line.includes('\n');
      if (state.running && state.pause !== 'none') {
        // Paused: a command acts now (/continue resumes), while text is HELD
        // as guidance for the parked run. Enter never resumes, and an empty
        // Enter does nothing at all.
        if (command) {
          runCommand(line);
        } else if (line.length > 0) {
          session.guide(line);
          setEditor(EMPTY_EDITOR);
          setHistoryAt(null);
          setMenuDismissedAt(null);
          rememberLine(line);
        }
        return;
      }
      if (line.length > 0) {
        if (state.running) {
          // A command acts now; Enter on anything else steers THIS run.
          // `/queue <text>` is the way to wait for the next one.
          if (command) {
            runCommand(line);
          } else {
            session.guide(line);
            setEditor(EMPTY_EDITOR);
            setHistoryAt(null);
            setMenuDismissedAt(null);
            rememberLine(line);
          }
        } else {
          void submitLine(line);
        }
      }
      return;
    }
    // A paste can carry its own line breaks in the same chunk; Ink reports the
    // whole paste as one string, with no key flags. The block becomes draft
    // text with its breaks kept, and waits for Enter — a pasted stack trace
    // must never go out before it can be read. One trailing break is the end
    // of the paste, not an empty line, so a one-line paste is ordinary text.
    if (!key.ctrl && !key.meta) {
      const text = pastedText(input);
      if (text !== input) {
        setEditor(insertText(editor, text));
        return;
      }
    }
    if (key.upArrow) {
      if (entries.length === 0) {
        return;
      }
      const at = historyAt === null ? entries.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(at);
      setEditor(setText(entries[at]?.text ?? ''));
      return;
    }
    if (key.downArrow) {
      if (historyAt === null) {
        return;
      }
      const at = historyAt + 1;
      if (at >= entries.length) {
        setHistoryAt(null);
        setEditor(EMPTY_EDITOR);
      } else {
        setHistoryAt(at);
        setEditor(setText(entries[at]?.text ?? ''));
      }
      return;
    }
    // Ctrl (and Alt, which is what a Mac terminal sends for the same keys)
    // moves by word. Ink reports both on the key, so the terminal's own
    // sequence decides the movement, not the App.
    if (key.leftArrow) {
      setEditor(key.ctrl || key.meta ? moveWordLeft(editor) : moveCursor(editor, -1));
      return;
    }
    if (key.rightArrow) {
      setEditor(key.ctrl || key.meta ? moveWordRight(editor) : moveCursor(editor, 1));
      return;
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setEditor(toStart(editor));
      return;
    }
    if (key.end || (key.ctrl && input === 'e')) {
      setEditor(toEnd(editor));
      return;
    }
    // Ctrl+W is the shell's word-delete, and some terminals send it for
    // Ctrl+Backspace. A terminal that sends 0x08 for Ctrl+Backspace reports a
    // plain Backspace, which cannot be told apart from the key itself.
    if (key.ctrl && input === 'w') {
      setEditor(deleteWordBack(editor));
      return;
    }
    // A draft block is shown as one chip, so Backspace at its end takes the
    // whole block rather than editing text the user cannot see (round 1).
    if (key.backspace && !key.ctrl && !key.meta && removesWholeDraft(editor.text, editor.cursor)) {
      setEditor(EMPTY_EDITOR);
      return;
    }
    if (key.backspace) {
      setEditor(key.ctrl || key.meta ? deleteWordBack(editor) : backspace(editor));
      return;
    }
    if (key.delete) {
      setEditor(key.ctrl || key.meta ? deleteWordForward(editor) : deleteForward(editor));
      return;
    }
    if (key.ctrl || key.meta || input === '\r' || input === '\n') {
      return;
    }
    if (input.length > 0) {
      setEditor(insertText(editor, input));
    }
  });

  // A remount after Ctrl+G must not write the transcript into the scrollback a
  // second time: only rows that appeared since the suspend are new.
  const staticRows = staticFrom === 0 ? state.rows : state.rows.slice(staticFrom);
  return (
    <Box flexDirection="column">
      {state.setup ? null : (
        <Header title={session.title} running={state.running} columns={columns} />
      )}
      {/*
        <Static> writes a row once. A terminal resize cannot reflow what is
        already printed; only the live area below re-measures. This is the
        documented limit, not a bug to paper over.
      */}
      <Static key={session.sessionId} items={staticRows}>
        {(row: Row) => <RowView key={row.id} row={row} columns={columns} />}
      </Static>
      {state.setup ? (
        <SetupScreen
          env={session.setupEnv()}
          onDone={(result) => session.finishSetup(result)}
        />
      ) : null}
      {state.setup ? null : showWelcome ? (
        <Welcome />
      ) : null}
      {state.setup || state.streaming.length === 0 ? null : (
        <LiveAnswer text={state.streaming} columns={columns} rows={rows} />
      )}
      {state.setup || state.card === null ? null : (
        <CardView card={state.card} columns={columns} />
      )}
      {state.setup || state.observers.length === 0 ? null : (
        <ObserverStrip observers={state.observers} />
      )}
      {state.setup ? null : (
        <>
          <StatusLine
            status={state.status}
            running={state.running}
            now={now}
            columns={columns}
          />
          {toolOpen && toolRow !== undefined ? (
            <ToolDetailPanel row={toolRow} columns={columns} now={now} />
          ) : null}
          {search === null && nameOpen ? (
            <CommandMenu matches={matches} active={active} />
          ) : null}
          {search === null && argOpen && argument !== null ? (
            <ArgumentMenu menu={argument} active={active} />
          ) : null}
          {search === null && fileOpen && fileMenuData !== null ? (
            <FileMenu menu={fileMenuData} active={active} columns={columns} />
          ) : null}
          {search === null ? null : (
            <SearchLine query={search.query} hit={hit} columns={columns} />
          )}
          <Composer
            editor={editor}
            running={state.running && state.card === null}
            pause={state.pause}
            columns={columns}
          />
        </>
      )}
    </Box>
  );
}

/**
 * The header is identity: the app, the transport, the busy word, and — right
 * aligned — the conversation's title. The mode is the status line's job now.
 * The title's width is fixed when it first appears, so the figures below can
 * grow without the title changing under the reader.
 */
function Header({
  title,
  running,
  columns,
}: {
  title: string;
  running: boolean;
  columns: number;
}): ReactElement {
  const room = headerTitleRoom(columns);
  const reservedRef = useRef<{ columns: number; title: string; width: number } | null>(
    null,
  );
  if (title.length === 0) {
    reservedRef.current = null;
  } else {
    const reserved = reservedRef.current;
    if (reserved === null || reserved.columns !== columns || reserved.title !== title) {
      reservedRef.current = {
        columns,
        title,
        width: displayWidth(headerTitle(title, room)),
      };
    }
  }
  const reserved = reservedRef.current;
  const shown =
    title.length > 0 &&
    reserved !== null &&
    reserved.columns === columns &&
    reserved.title === title
      ? headerTitle(title, room, reserved.width)
      : headerTitle(title, room);
  return (
    <Box marginBottom={1} width={columns} justifyContent="space-between">
      <Text>
        <Text color="cyan" bold>
          Plato
        </Text>
        <Text dimColor> · terminal</Text>
        {running ? <Text dimColor> · working…</Text> : null}
      </Text>
      {shown.length > 0 ? <Text dimColor>{shown}</Text> : null}
    </Box>
  );
}

export function RowView({ row, columns }: { row: Row; columns: number }): ReactElement {
  switch (row.kind) {
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color="cyan">› {row.text}</Text>
        </Box>
      );
    case 'assistant':
      // The left rule is the extension's own vocabulary: the panel draws the
      // reply behind a neutral rule and the user's turn behind the accent.
      return (
        <Box marginTop={1}>
          <Box
            flexDirection="column"
            borderStyle="single"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            borderLeft
            borderColor={COLOURS ? 'gray' : undefined}
            paddingLeft={1}
          >
            <Markdown text={row.text} columns={Math.max(20, columns - 2)} />
          </Box>
        </Box>
      );
    case 'tool':
      return <Text dimColor>{row.text}</Text>;
    case 'notice':
      return <Text dimColor>{row.text}</Text>;
    case 'inbound':
      // D49cq: a message from another session is neither the user's turn nor a
      // notice; blue and the ↳ glyph say where it came from.
      return <Text color={COLOURS ? 'blue' : undefined}>{row.text}</Text>;
    case 'error':
      return <Text color="red">{row.text}</Text>;
  }
}

/**
 * The answer as it arrives. The same renderer draws it here and after it lands,
 * so the lines on screen while it streams are the lines on screen when it is
 * committed: the answer never reflows at the moment it ends.
 */
function LiveAnswer({
  text,
  columns,
  rows,
}: {
  text: string;
  columns: number;
  rows: number;
}): ReactElement {
  // A frame taller than the window cannot be redrawn in place, and Ink loses
  // the row that commits the answer, so the live area draws only a tail. The
  // tail is cut at a whole block, so the lines shown are the lines committed.
  const budget = Math.max(1, rows - 13);
  const shown = liveTail(text, budget, columns);
  return (
    <Box marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        borderLeft
        borderColor={COLOURS ? 'gray' : undefined}
        paddingLeft={1}
      >
        <Markdown text={shown} columns={Math.max(20, columns - 2)} />
      </Box>
    </Box>
  );
}

/**
 * The status line, fitted to the window. It is one row: the mode and the
 * context share never leave, and the rest leave in the order the fitter
 * fixes. The line's parts and its fit are pure (`statusLine.ts`); this
 * component only paints them.
 */
function StatusLine({
  status,
  running,
  now,
  columns,
}: {
  status: SessionStatus;
  running: boolean;
  now: number;
  columns: number;
}): ReactElement {
  const runMs =
    status.startedAt === undefined ? undefined : Math.max(0, now - status.startedAt);
  // Live during a run; when idle, the finished run's own figures stay.
  const rate = running
    ? tokenRate(status.runOutputTokens ?? 0, runMs ?? 0)
    : tokenRate(status.lastRunOutputTokens ?? 0, status.lastRunMs ?? 0);
  const durationMs = running ? runMs : status.lastRunMs;
  // One phrase at a time, and only once the step has outlived a second.
  const waiting =
    running &&
    status.waiting !== undefined &&
    status.waitingSince !== undefined &&
    now - status.waitingSince >= 1000
      ? status.waiting
      : undefined;
  const parts = statusLine(
    {
      mode: status.mode,
      model: status.model,
      team: status.team,
      usedTokens: status.contextTokens,
      ...(status.contextWindow === undefined
        ? {}
        : {
            window: status.contextWindow,
            windowApprox: status.contextWindowApprox === true,
          }),
      // The conversation's running totals, including the run in progress.
      inputTokens: status.inputTokens + (running ? (status.runInputTokens ?? 0) : 0),
      outputTokens: status.outputTokens + (running ? (status.runOutputTokens ?? 0) : 0),
      ...(rate === undefined ? {} : { rate }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(status.contextDue === true ? { contextDue: true } : {}),
      ...(waiting === undefined ? {} : { waiting }),
    },
    columns,
  );

  return (
    <Box marginTop={1}>
      {parts.map((part, index) => (
        <Text
          key={part.key}
          color={part.key === 'mode' ? MODE_COLOR[status.mode] : undefined}
          dimColor={
            part.key === 'model' ||
            part.key === 'team' ||
            part.key === 'tokens' ||
            part.key === 'rate' ||
            part.key === 'duration'
          }
        >
          {index > 0 ? ' · ' : ''}
          {part.text}
        </Text>
      ))}
    </Box>
  );
}

/**
 * The `/` menu (D49cd): the commands whose name starts with what is typed, in a
 * window of `MENU_ROWS` rows. A long list scrolls with the selection rather
 * than pushing the transcript off the screen, and the count says where the
 * window sits so a missing command is a scroll away, not a bug.
 */
function CommandMenu({
  matches,
  active,
}: {
  matches: SlashCommand[];
  active: number;
}): ReactElement {
  const { start, end } = menuWindow(matches.length, active);
  const shown = matches.slice(start, end);
  return (
    <Box flexDirection="column" marginTop={1}>
      {shown.map((command, index) => (
        <Text key={command.name} color={start + index === active ? 'cyan' : undefined}>
          {start + index === active ? '❯ ' : '  '}
          {slashText(command)}
          <Text dimColor>  {command.summary}</Text>
        </Text>
      ))}
      <Text dimColor>
        {matches.length > shown.length ? `${start + 1}–${end} of ${matches.length} · ` : ''}
        ↑↓ move · Enter selects · Tab completes · Esc closes
      </Text>
    </Box>
  );
}

/**
 * The words the command's first argument accepts, with one line each, in the
 * same place and with the same keys as the command menu. A free-text command
 * shows its own line and no list. The rows are capped, so the composer always
 * stays on screen.
 */
function ArgumentMenu({
  menu,
  active,
}: {
  menu: ArgumentMenuShape;
  active: number;
}): ReactElement {
  const { start, end } = menuWindow(menu.choices.length, active);
  const shown = menu.choices.slice(start, end);
  const width = Math.max(0, ...menu.choices.map((choice) => choice.value.length));
  return (
    <Box flexDirection="column" marginTop={1}>
      {menu.described ? <Text dimColor>{menu.command.summary}</Text> : null}
      {shown.map((choice, index) => (
        <Text key={choice.value} color={start + index === active ? 'cyan' : undefined}>
          {start + index === active ? '❯ ' : '  '}
          {choice.value.padEnd(width)}
          <Text dimColor>  {choice.summary}</Text>
        </Text>
      ))}
      {menu.command.takes !== undefined ? (
        <Text dimColor>a {menu.command.takes} ref is also accepted</Text>
      ) : null}
      <Text dimColor>
        {menu.choices.length > shown.length
          ? `${start + 1}–${end} of ${menu.choices.length} · `
          : ''}
        {menu.choices.length > 0
          ? '↑↓ move · Enter runs an exact choice · Tab completes · Esc closes'
          : 'Enter runs · Esc closes'}
      </Text>
    </Box>
  );
}

function clockTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toolDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : formatDuration(ms);
}

/**
 * Ctrl+O: the focused tool row's detail. Only what the session kept — the full
 * target, when it began, how long it took, and how it ended. The result of the
 * call was never stored, so it cannot be shown.
 */
function ToolDetailPanel({
  row,
  columns,
  now,
}: {
  row: Row;
  columns: number;
  now: number;
}): ReactElement {
  const detail = row.detail;
  if (detail === undefined) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Tool detail · Ctrl+O closes</Text>
        <Text>{truncateToWidth(row.text, columns)}</Text>
        <Text dimColor>No timing or outcome was recorded for this row.</Text>
      </Box>
    );
  }
  const target =
    detail.target === undefined
      ? []
      : wrapToWidth(
          stripTerminalEscapes(detail.target),
          Math.max(20, columns - 2),
          '  ',
        );
  const start = detail.startedAt ?? detail.requestedAt;
  const end = detail.endedAt ?? (detail.outcome === 'running' ? now : undefined);
  const took = start === undefined || end === undefined ? undefined : Math.max(0, end - start);
  const outcome =
    detail.reason === undefined ? detail.outcome : `${detail.outcome} (${detail.reason})`;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>Tool detail · Ctrl+O closes</Text>
      <Text>{truncateToWidth(row.text, columns)}</Text>
      {target.map((line, index) => (
        <Text key={index} dimColor>
          {line}
        </Text>
      ))}
      <Text dimColor>
        {start === undefined ? 'start time not recorded' : `started ${clockTime(start)}`}
        {took === undefined ? '' : ` · took ${toolDuration(took)}`}
        {` · outcome: ${outcome}`}
      </Text>
      {detail.fromLog ? (
        <Text dimColor>The saved transcript kept no timing and no output for this row.</Text>
      ) : null}
    </Box>
  );
}

/**
 * The files and folders `@` offers. The selection scrolls in the same window as
 * the command menus, so the composer keeps its place, and a capped list says
 * how many matches it is not showing.
 */
function FileMenu({
  menu,
  active,
  columns,
}: {
  menu: FileMenuData;
  active: number;
  columns: number;
}): ReactElement {
  const { start, end } = menuWindow(menu.choices.length, active);
  const shown = menu.choices.slice(start, end);
  const capped =
    menu.total > menu.choices.length
      ? `first ${menu.choices.length} of ${menu.total} match · `
      : '';
  const footer =
    `${capped}${start + 1}–${end} of ${menu.choices.length} · ` +
    '↑↓ move · Enter inserts · Tab completes · Esc closes';
  return (
    <Box flexDirection="column" marginTop={1}>
      {shown.map((choice, index) => (
        <Text
          key={`${choice.kind}:${choice.path}`}
          color={start + index === active ? 'cyan' : undefined}
        >
          {start + index === active ? '❯ ' : '  '}
          {choice.kind === 'dir' ? `${choice.path}/` : choice.path}
        </Text>
      ))}
      <Text dimColor>{truncateToWidth(footer, columns)}</Text>
    </Box>
  );
}

/**
 * What Ctrl+R found: the query, the matching line, and how recently that line
 * was used. It is one row above the composer, which stays visible so the draft
 * is never hidden by the search.
 */
function SearchLine({
  query,
  hit,
  columns,
}: {
  query: string;
  hit: HistoryEntry | undefined;
  columns: number;
}): ReactElement {
  const prefix = `(reverse-i-search)\`${query}': `;
  if (hit === undefined) {
    return <Text dimColor>{truncateToWidth(`${prefix}no match`, columns)}</Text>;
  }
  const suffix = `  ${relativeTime(hit.at)}`;
  const room = Math.max(8, columns - displayWidth(prefix) - displayWidth(suffix));
  const line = `${prefix}${truncateToWidth(hit.text.replace(/\s+/g, ' '), room)}${suffix}`;
  // One row even at a narrow width: the search never pushes the composer away.
  return <Text dimColor>{truncateToWidth(line, columns)}</Text>;
}

/**
 * The hint names the keys that work in the state the user is in. During a run
 * Enter queues and both stop keys work; an open card has its own footer, so the
 * idle hint stays put there.
 */
// Idle, Esc has nothing to stop, so the hint does not name it. Naming a
// stopping key here was the old meaning surviving after the running hint moved
// to "esc pauses" — and a hint that cannot be true is the defect this round is
// about. The keys below are the ones that do something right now.
const IDLE_HINT =
  'Shift+Tab mode (plan · edit · auto) · @ files · /help · Alt+Enter newline';
const RUNNING_HINT = 'enter steers · esc pauses · ctrl+c stops · alt+enter newline';
/** The pause is asked for but the run has not reached a safe point yet. */
const PAUSING_HINT = 'pausing — enter steers · /continue resumes · esc stops';
/** The run is really waiting. Enter steers; `/continue` resumes; Esc stops. */
const PAUSED_HINT = 'paused — enter steers · /continue resumes · esc stops';

function Composer({
  editor,
  running,
  pause,
  columns,
}: {
  editor: EditorState;
  running: boolean;
  pause: ViewState['pause'];
  columns: number;
}): ReactElement {
  const cursor = editor.text.slice(editor.cursor, editor.cursor + 1);
  // A pasted block stays one line high. It shows the line the cursor is on and
  // its place, so a keystroke or an arrow is never hidden (round 1).
  const draft = editor.text.includes('\n') ? draftChip(editor.text, editor.cursor) : null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="cyan">› </Text>
        {draft === null ? (
          <>
            <Text>{editor.text.slice(0, editor.cursor)}</Text>
            <Text inverse>{cursor.length > 0 ? cursor : ' '}</Text>
            <Text>{editor.text.slice(editor.cursor + 1)}</Text>
          </>
        ) : (
          <>
            <Text>{draft.line}</Text>
            <Text dimColor>{` [line ${draft.at} of ${draft.total}]`}</Text>
          </>
        )}
      </Box>
      <Text dimColor>
        {truncateToWidth(
          !running
            ? IDLE_HINT
            : pause === 'parked'
              ? PAUSED_HINT
              : pause === 'requested'
                ? PAUSING_HINT
                : RUNNING_HINT,
          columns,
        )}
      </Text>
    </Box>
  );
}

function ObserverStrip({
  observers,
}: {
  observers: ViewState['observers'];
}): ReactElement {
  return (
    <Box marginTop={1} flexWrap="wrap">
      {observers.map((observer) => (
        <Box key={observer.name} marginRight={2}>
          <Text color={observer.color}>
            {observer.name}
            <Text dimColor> {observer.state}</Text>
            {observer.last !== undefined ? (
              <Text dimColor> — {observer.last.slice(0, 40)}</Text>
            ) : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function capLines(text: string, limit: number): string {
  const lines = text.split('\n');
  if (lines.length <= limit) {
    return text;
  }
  return `${lines.slice(0, limit).join('\n')}\n… ${lines.length - limit} more lines`;
}

function CardView({
  card,
  columns,
}: {
  card: Card;
  columns: number;
}): ReactElement {
  const resume =
    card.kind === 'resume'
      ? menuWindow(card.choices.length, card.selected)
      : null;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={
        card.kind === 'approval'
          ? 'yellow'
          : card.kind === 'mode' || card.kind === 'outside'
            ? 'magenta'
            : 'cyan'
      }
      paddingX={1}
      marginTop={1}
    >
      {card.kind === 'approval' ? (
        <>
          <Text bold>Allow {card.tool}?</Text>
          {card.preview !== undefined ? (
            <Text dimColor>{capLines(card.preview, 12)}</Text>
          ) : null}
          <OptionList options={card.options} selected={card.selected} />
          <Text dimColor>
            ↑↓ move · Enter answers · No declines and continues · Esc denies and stops the run
          </Text>
        </>
      ) : null}

      {card.kind === 'question' ? (
        <>
          <Text bold>
            {card.header ?? `Question ${card.index + 1}`}
            {card.total > 1 ? ` (${card.index + 1}/${card.total})` : ''}
          </Text>
          <Text>{card.question}</Text>
          {card.context !== undefined ? <Text dimColor>{card.context}</Text> : null}
          <OptionList
            options={card.options}
            selected={card.selected}
            recommended={card.recommended}
            multiple={card.multiple}
            toggled={card.toggled}
            allowOwnAnswer
            ownAnswer={card.selected === card.options.length}
          />
          {card.freeText ? (
            <Text>
              <Text color="cyan">Answer: </Text>
              {card.text}
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text dimColor>↑↓ move · {card.multiple ? 'space toggles · ' : ''}Enter picks</Text>
          )}
        </>
      ) : null}

      {card.kind === 'stuck' ? (
        <>
          <Text bold>Plato looks stuck</Text>
          <Text>{card.message}</Text>
          <OptionList options={card.options} selected={card.selected} />
        </>
      ) : null}

      {card.kind === 'reveal' ? (
        <>
          <Text bold>Protected file</Text>
          <Text>
            Show {card.protectedPath} with its secret values replaced by placeholders?
          </Text>
          <OptionList options={card.options} selected={card.selected} />
        </>
      ) : null}

      {card.kind === 'mode' ? (
        <>
          <Text bold>Switch Plato to {card.mode} mode?</Text>
          {/* The reason is the model's own writing, so it is drawn as text. */}
          <Text>{card.reason}</Text>
          <Text dimColor>{MODE_MEANING[card.mode]}</Text>
          <Text dimColor>Plato is in {card.current} mode now.</Text>
          <OptionList options={card.options} selected={card.selected} />
          <Text dimColor>↑↓ move · Enter picks · Esc stays in {card.current}</Text>
        </>
      ) : null}

      {card.kind === 'model' ? (
        <>
          <Text bold>{card.title}</Text>
          {card.notes.map((note, index) => (
            <Text key={`${index}-${note}`} dimColor>
              {note}
            </Text>
          ))}
          <OptionList options={card.options} selected={card.selected} />
          <Text dimColor>↑↓ move · Enter picks · Esc closes</Text>
        </>
      ) : null}

      {card.kind === 'resume' && resume !== null ? (
        <>
          <Text bold>{card.title}</Text>
          {card.choices
            .slice(resume.start, resume.end)
            .map((choice, index) => {
              const active = resume.start + index === card.selected;
              return (
                <Text key={choice.id} color={active ? 'cyan' : undefined}>
                  {active ? '❯ ' : '  '}
                  {truncateToWidth(
                    `${choice.title} · ${choice.meta}`,
                    Math.max(20, columns - 6),
                  )}
                </Text>
              );
            })}
          <Text dimColor>
            {card.choices.length > 0
              ? `${resume.start + 1}–${resume.end} of ${card.choices.length} · `
              : ''}
            ↑↓ move · Enter switches · Esc closes
          </Text>
        </>
      ) : null}

      {card.kind === 'outside' ? (
        <>
          <Text bold>{card.title}</Text>
          {card.lines.map((line, index) => (
            <Text key={`${index}-${line}`}>{line}</Text>
          ))}
          <Text dimColor>{card.why}</Text>
          <OptionList options={card.options} selected={card.selected} />
          <Text dimColor>↑↓ move · Enter picks · Esc denies</Text>
        </>
      ) : null}
    </Box>
  );
}

function OptionList({
  options,
  selected,
  recommended,
  multiple = false,
  toggled,
  allowOwnAnswer = false,
  ownAnswer = false,
}: {
  options: string[];
  selected: number;
  recommended?: string;
  multiple?: boolean;
  toggled?: boolean[];
  allowOwnAnswer?: boolean;
  ownAnswer?: boolean;
}): ReactElement {
  return (
    <Box flexDirection="column">
      {options.map((option, index) => (
        <Text key={option} color={index === selected ? 'cyan' : undefined}>
          {index === selected ? '❯ ' : '  '}
          {multiple ? (toggled?.[index] === true ? '[x] ' : '[ ] ') : ''}
          {option}
          {option === recommended ? ' (recommended)' : ''}
        </Text>
      ))}
      {allowOwnAnswer ? (
        <Text color={ownAnswer ? 'cyan' : undefined}>
          {ownAnswer ? '❯ ' : '  '}
          Type your own answer…
        </Text>
      ) : null}
    </Box>
  );
}
