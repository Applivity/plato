import { describe, expect, it } from 'vitest';
import { insertText } from '../src/editor.js';
import { draftChip, pastedText, removesWholeDraft } from '../src/tui/composer.js';

describe('a pasted chunk', () => {
  it('keeps the line breaks inside it', () => {
    expect(pastedText('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });

  it('takes CRLF and a bare CR as the same break', () => {
    expect(pastedText('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  it('does not count the trailing break as a line', () => {
    expect(pastedText('C:\\work\\file.png\n')).toBe('C:\\work\\file.png');
  });

  it('drops only one trailing break of a block', () => {
    expect(pastedText('first\nsecond\n')).toBe('first\nsecond');
  });

  it('keeps a blank line that is inside the block', () => {
    expect(pastedText('a\n\nb\n')).toBe('a\n\nb');
  });

  it('leaves a single-line paste as ordinary text', () => {
    expect(pastedText('one line')).toBe('one line');
  });
});

describe('the draft chip', () => {
  it('shows the line after the first and the position', () => {
    expect(draftChip('one\ntwo\nthree', 13)).toEqual({ line: 'three', at: 3, total: 3 });
  });

  it('shows the line the cursor is on', () => {
    expect(draftChip('A1\nA2\nA3', 4)).toEqual({ line: 'A2', at: 2, total: 3 });
  });

  it('shows the line a cursor sitting on a break belongs to', () => {
    expect(draftChip('A1\nA2\nA3', 2)).toEqual({ line: 'A1', at: 1, total: 3 });
  });

  it('shows text typed inside the block, not the text before it', () => {
    const typed = insertText({ text: 'A1\nA2\nA3', cursor: 7 }, 'Z');
    expect(draftChip(typed.text, typed.cursor)).toEqual({
      line: 'AZ3',
      at: 3,
      total: 3,
    });
  });

  it('shows text typed at the end of the last line', () => {
    const typed = insertText({ text: 'A1\nA2\nA3', cursor: 8 }, 'Z');
    expect(draftChip(typed.text, typed.cursor)).toEqual({
      line: 'A3Z',
      at: 3,
      total: 3,
    });
  });
});

describe('a draft block', () => {
  it('is removed as one unit by Backspace at its end', () => {
    expect(removesWholeDraft('one\ntwo', 7)).toBe(true);
  });

  it('is not removed by Backspace inside it', () => {
    expect(removesWholeDraft('one\ntwo', 3)).toBe(false);
  });

  it('is not touched by Backspace when it is not a block', () => {
    expect(removesWholeDraft('one line', 8)).toBe(false);
  });
});
