import { describe, expect, it } from 'vitest';
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
} from '../src/editor.js';

/** A state with the cursor at a chosen place, so the assertions read in order. */
function at(text: string, cursor: number): EditorState {
  return { text, cursor };
}

describe('composer editing', () => {
  it('inserts at the cursor', () => {
    const state = moveCursor(setText('ac'), -1);
    expect(insertText(state, 'b')).toEqual({ text: 'abc', cursor: 2 });
  });

  it('backspaces the character before the cursor', () => {
    const state = moveCursor(setText('abc'), -1);
    expect(backspace(state)).toEqual({ text: 'ac', cursor: 1 });
    expect(backspace(EMPTY_EDITOR)).toBe(EMPTY_EDITOR);
  });

  it('deletes the character after the cursor', () => {
    const state = moveCursor(setText('abc'), -1);
    expect(deleteForward(state)).toEqual({ text: 'ab', cursor: 2 });
    expect(deleteForward(setText('abc'))).toEqual({ text: 'abc', cursor: 3 });
  });

  it('keeps the cursor inside the line', () => {
    const state = setText('abc');
    expect(moveCursor(state, 5).cursor).toBe(3);
    expect(moveCursor(state, -5).cursor).toBe(0);
    expect(toStart(state).cursor).toBe(0);
    expect(toEnd(toStart(state)).cursor).toBe(3);
  });

  it('accepts a multi-character paste', () => {
    expect(insertText(EMPTY_EDITOR, 'hello world')).toEqual({
      text: 'hello world',
      cursor: 11,
    });
  });
});

describe('word movement', () => {
  const line = setText('git checkout the-branch');

  it('Ctrl+Left stops at the start of a word', () => {
    expect(moveWordLeft(line).cursor).toBe(13);
    expect(moveWordLeft(moveWordLeft(line)).cursor).toBe(4);
    expect(moveWordLeft(moveWordLeft(moveWordLeft(line))).cursor).toBe(0);
  });

  it('Ctrl+Right stops at the end of a word', () => {
    const start = at(line.text, 0);
    expect(moveWordRight(start).cursor).toBe(3);
    expect(moveWordRight(moveWordRight(start)).cursor).toBe(12);
    expect(moveWordRight(moveWordRight(moveWordRight(start))).cursor).toBe(line.text.length);
  });

  it('crosses a run of spaces without stopping in it', () => {
    expect(moveWordLeft(at('one   two', 9)).cursor).toBe(6);
    expect(moveWordRight(at('one   two', 3)).cursor).toBe(9);
    expect(moveWordRight(at('one   two', 0)).cursor).toBe(3);
  });

  it('keeps punctuation with its word', () => {
    expect(moveWordLeft(at('see src/index.ts', 16)).cursor).toBe(4);
    expect(moveWordLeft(at('--flag value', 12)).cursor).toBe(7);
  });

  it('does nothing at the edges', () => {
    const start = at('word', 0);
    const end = at('word', 4);
    expect(moveWordLeft(start)).toBe(start);
    expect(moveWordRight(end)).toBe(end);
  });
});

describe('word deletion', () => {
  it('Ctrl+Backspace removes the word before the cursor and the spaces before it', () => {
    expect(deleteWordBack(at('git checkout branch', 19))).toEqual({
      text: 'git checkout ',
      cursor: 13,
    });
    expect(deleteWordBack(at('git checkout ', 13))).toEqual({ text: 'git ', cursor: 4 });
  });

  it('Ctrl+Delete removes the word after the cursor and the spaces after it', () => {
    expect(deleteWordForward(at('git checkout branch', 4))).toEqual({
      text: 'git branch',
      cursor: 4,
    });
  });

  it('does nothing at the edges', () => {
    const start = at('word', 0);
    const end = at('word', 4);
    expect(deleteWordBack(start)).toBe(start);
    expect(deleteWordForward(end)).toBe(end);
  });

  it('leaves the text before the cursor intact', () => {
    expect(deleteWordBack(at('keep drop', 9)).text).toBe('keep ');
  });
});
