/**
 * The composer's line editing, kept out of React so every key path is a pure
 * function a test can assert. The App maps keys to these calls.
 */
export interface EditorState {
  text: string;
  cursor: number;
}

export const EMPTY_EDITOR: EditorState = { text: '', cursor: 0 };

export function setText(text: string): EditorState {
  return { text, cursor: text.length };
}

export function insertText(state: EditorState, text: string): EditorState {
  const before = state.text.slice(0, state.cursor);
  const after = state.text.slice(state.cursor);
  return { text: before + text + after, cursor: state.cursor + text.length };
}

export function backspace(state: EditorState): EditorState {
  if (state.cursor === 0) {
    return state;
  }
  return {
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  };
}

export function deleteForward(state: EditorState): EditorState {
  if (state.cursor >= state.text.length) {
    return state;
  }
  return {
    text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1),
    cursor: state.cursor,
  };
}

export function moveCursor(state: EditorState, delta: number): EditorState {
  const cursor = Math.max(0, Math.min(state.text.length, state.cursor + delta));
  return cursor === state.cursor ? state : { ...state, cursor };
}

/**
 * Ctrl+Left and Ctrl+Right. A word is a run of non-space characters, so
 * punctuation stays with the word it touches, as a terminal user expects when
 * jumping across a path or a flag.
 */
export function moveWordLeft(state: EditorState): EditorState {
  let cursor = state.cursor;
  while (cursor > 0 && /\s/.test(state.text[cursor - 1] ?? '')) {
    cursor -= 1;
  }
  while (cursor > 0 && !/\s/.test(state.text[cursor - 1] ?? '')) {
    cursor -= 1;
  }
  return cursor === state.cursor ? state : { ...state, cursor };
}

export function moveWordRight(state: EditorState): EditorState {
  let cursor = state.cursor;
  while (cursor < state.text.length && /\s/.test(state.text[cursor] ?? '')) {
    cursor += 1;
  }
  while (cursor < state.text.length && !/\s/.test(state.text[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor === state.cursor ? state : { ...state, cursor };
}

/** Ctrl+Backspace: the word behind the cursor, and the spaces before it. */
export function deleteWordBack(state: EditorState): EditorState {
  const from = moveWordLeft(state).cursor;
  if (from === state.cursor) {
    return state;
  }
  return {
    text: state.text.slice(0, from) + state.text.slice(state.cursor),
    cursor: from,
  };
}

/**
 * Ctrl+Delete: the word ahead of the cursor, and the spaces after it. This is
 * not `moveWordRight`'s destination: the cursor stops at a word's end, but the
 * deletion must also take the gap so the next word does not slide over.
 */
export function deleteWordForward(state: EditorState): EditorState {
  let to = state.cursor;
  while (to < state.text.length && !/\s/.test(state.text[to] ?? '')) {
    to += 1;
  }
  while (to < state.text.length && /\s/.test(state.text[to] ?? '')) {
    to += 1;
  }
  if (to === state.cursor) {
    return state;
  }
  return {
    text: state.text.slice(0, state.cursor) + state.text.slice(to),
    cursor: state.cursor,
  };
}

export function toStart(state: EditorState): EditorState {
  return state.cursor === 0 ? state : { ...state, cursor: 0 };
}

export function toEnd(state: EditorState): EditorState {
  return state.cursor === state.text.length
    ? state
    : { ...state, cursor: state.text.length };
}
