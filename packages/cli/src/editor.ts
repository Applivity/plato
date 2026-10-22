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

export function toStart(state: EditorState): EditorState {
  return state.cursor === 0 ? state : { ...state, cursor: 0 };
}

export function toEnd(state: EditorState): EditorState {
  return state.cursor === state.text.length
    ? state
    : { ...state, cursor: state.text.length };
}
