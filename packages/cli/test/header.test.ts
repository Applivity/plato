import { describe, expect, it } from 'vitest';
import {
  HEADER_GAP,
  HEADER_LEFT_WIDTH,
  MIN_HEADER_TITLE,
  headerTitle,
  headerTitleRoom,
} from '../src/tui/header.js';

describe('the header title', () => {
  it('reserves the busy left side before it can appear', () => {
    expect(HEADER_LEFT_WIDTH).toBe(27);
    expect(headerTitleRoom(80)).toBe(80 - 27 - HEADER_GAP);
    expect(headerTitleRoom(120)).toBe(120 - 27 - HEADER_GAP);
  });

  it('truncates from the right with an ellipsis', () => {
    expect(headerTitle('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…');
    expect(headerTitle('short title', 24)).toBe('short title');
  });

  it('shows nothing rather than one letter and an ellipsis', () => {
    expect(headerTitle('anything', MIN_HEADER_TITLE - 1)).toBe('');
    expect(headerTitle('something', MIN_HEADER_TITLE)).toBe('somethi…');
  });

  it('keeps the width reserved when the title first appeared', () => {
    expect(headerTitle('abcdefghij', 20, 8)).toBe('abcdefg…');
    expect(headerTitle('abc', 20, 12)).toBe('abc');
    expect(headerTitle('abcdefghij', 20, MIN_HEADER_TITLE - 1)).toBe('');
  });
});
