import { Box, Static, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
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
import { formatCount } from '../host.js';
import { Markdown } from './Markdown.js';
import { Welcome } from './Welcome.js';
import {
  accepted,
  menuWindow,
  slashQuery,
  slashText,
  suggest,
  type SlashCommand,
} from '../completion.js';
import { draftChip, liveTail, pastedText, removesWholeDraft } from './composer.js';

export interface AppProps {
  session: Session;
  onExit: () => void;
  firstPrompt?: string;
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

export function App({ session, onExit, firstPrompt }: AppProps): ReactElement {
  const state: ViewState = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { columns, rows } = useWindowSize();
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [submitted, setSubmitted] = useState<string[]>([]);
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
  }, [session]);

  const query = slashQuery(editor.text);
  const matches = query === null ? [] : suggest(query);
  const menuOpen =
    query !== null &&
    matches.length > 0 &&
    state.card === null &&
    !state.running &&
    menuDismissedAt !== editor.text;
  const active = Math.min(choice, Math.max(0, matches.length - 1));
  // The banner belongs to the empty conversation only: a first prompt is about
  // to replace it, and a resumed session already has a transcript (D49ce).
  const showWelcome =
    state.rows.length === 0 &&
    state.streaming.length === 0 &&
    state.card === null &&
    !state.running &&
    firstPrompt === undefined;

  useEffect(() => {
    // A narrower list starts at its best match, not at the row from the last one.
    setChoice(0);
  }, [query]);

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

  const submitLine = async (line: string): Promise<void> => {
    setEditor(EMPTY_EDITOR);
    setHistoryAt(null);
    setMenuDismissedAt(null);
    setSubmitted((previous) => [...previous, line]);
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

  useInput((input, key) => {
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

    if (key.tab && key.shift) {
      session.cycleMode();
      return;
    }
    // The command menu owns the arrows, Enter, Tab, and Esc while it is open.
    // Every other key still edits the line, and the menu follows the text.
    if (menuOpen) {
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
        const pickText = accepted(pick);
        setMenuDismissedAt(null);
        if (pickText.run) {
          void submitLine(pickText.text);
          return;
        }
        setEditor(setText(pickText.text));
        return;
      }
    }
    if (key.escape) {
      if (state.running) {
        session.cancel();
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
      if (line.length > 0) {
        if (state.running) {
          // The line is held and runs when this run ends; the composer keeps
          // whatever the user writes next.
          session.queueLine(line);
          setEditor(EMPTY_EDITOR);
          setHistoryAt(null);
          setMenuDismissedAt(null);
          setSubmitted((previous) => [...previous, line]);
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
      if (submitted.length === 0) {
        return;
      }
      const at = historyAt === null ? submitted.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(at);
      setEditor(setText(submitted[at] ?? ''));
      return;
    }
    if (key.downArrow) {
      if (historyAt === null) {
        return;
      }
      const at = historyAt + 1;
      if (at >= submitted.length) {
        setHistoryAt(null);
        setEditor(EMPTY_EDITOR);
      } else {
        setHistoryAt(at);
        setEditor(setText(submitted[at] ?? ''));
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

  return (
    <Box flexDirection="column">
      <Header mode={state.status.mode} running={state.running} />
      {showWelcome ? <Welcome /> : null}
      <Static items={state.rows}>
        {(row: Row) => <RowView key={row.id} row={row} columns={columns} />}
      </Static>
      {state.streaming.length > 0 ? (
        <LiveAnswer text={state.streaming} columns={columns} rows={rows} />
      ) : null}
      {state.card !== null ? <CardView card={state.card} /> : null}
      {state.observers.length > 0 ? <ObserverStrip observers={state.observers} /> : null}
      <StatusLine
        status={state.status}
        running={state.running}
        elapsed={
          state.status.startedAt === undefined
            ? 0
            : Math.max(0, Math.floor((now - state.status.startedAt) / 1000))
        }
      />
      {menuOpen ? <CommandMenu matches={matches} active={active} /> : null}
      <Composer editor={editor} />
    </Box>
  );
}

function Header({ mode, running }: { mode: SessionStatus['mode']; running: boolean }): ReactElement {
  return (
    <Box marginBottom={1}>
      <Text color="cyan" bold>
        Plato
      </Text>
      <Text dimColor> · terminal · </Text>
      <Text color={MODE_COLOR[mode]}>{mode}</Text>
      {running ? <Text dimColor> · working…</Text> : null}
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

function StatusLine({
  status,
  running,
  elapsed,
}: {
  status: SessionStatus;
  running: boolean;
  elapsed: number;
}): ReactElement {
  return (
    <Box marginTop={1}>
      <Text color={MODE_COLOR[status.mode]}>{status.mode}</Text>
      <Text dimColor> · {status.model}</Text>
      {status.team !== 'solo' ? <Text dimColor> · {status.team}</Text> : null}
      {status.inputTokens > 0 ? (
        <Text dimColor>
          {' · '}
          {formatCount(status.inputTokens)} in · {formatCount(status.outputTokens)} out
        </Text>
      ) : null}
      {status.costUsd > 0 ? <Text dimColor>{` · $${status.costUsd.toFixed(4)}`}</Text> : null}
      {running ? (
        <>
          <Text color="cyan"> · running</Text>
          {status.activity === undefined ? null : (
            <Text dimColor> · {status.activity}</Text>
          )}
          <Text dimColor> · {elapsed}s</Text>
        </>
      ) : null}
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

function Composer({ editor }: { editor: EditorState }): ReactElement {
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
      <Text dimColor>Shift+Tab mode · /help · Esc interrupt · Ctrl+C twice exits</Text>
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

function CardView({ card }: { card: Card }): ReactElement {
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
