import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITOR,
  backspace,
  deleteForward,
  insertText,
  moveCursor,
  setText,
  toEnd,
  toStart,
} from '../src/editor.js';

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
