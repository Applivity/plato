import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  MENU_ROWS,
  accepted,
  menuWindow,
  slashQuery,
  slashText,
  suggest,
} from '../src/completion.js';
import { SESSION_HELP } from '../src/session.js';

describe('the command menu', () => {
  it('opens on a slash and stays open only while the name is being typed', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/he')).toBe('he');
    expect(slashQuery('/HE')).toBe('HE');
    // A space ends the name; the rest is an argument.
    expect(slashQuery('/mode p')).toBeNull();
    expect(slashQuery('/mode ')).toBeNull();
    // A command is the whole line, so prose is never a command.
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery(' /help')).toBeNull();
    expect(slashQuery('/help\nmore')).toBeNull();
  });

  it('filters by prefix, case-insensitively', () => {
    expect(suggest('').map((command) => command.name)).toEqual(
      COMMANDS.map((command) => command.name),
    );
    expect(suggest('he').map((command) => command.name)).toEqual(['help']);
    expect(suggest('m').map((command) => command.name)).toEqual(['mode', 'model']);
    expect(suggest('MO')).toEqual(suggest('mo'));
    expect(suggest('zzz')).toEqual([]);
  });

  it('never draws more rows than the cap, and scrolls with the selection', () => {
    const many = 14;
    expect(menuWindow(many, 0)).toEqual({ start: 0, end: MENU_ROWS });
    expect(menuWindow(many, MENU_ROWS - 1)).toEqual({ start: 0, end: MENU_ROWS });
    expect(menuWindow(many, MENU_ROWS)).toEqual({ start: 1, end: MENU_ROWS + 1 });
    expect(menuWindow(many, many - 1)).toEqual({ start: many - MENU_ROWS, end: many });
    // A list shorter than the cap keeps its own size and never scrolls.
    expect(menuWindow(3, 0)).toEqual({ start: 0, end: 3 });
    expect(menuWindow(3, 2)).toEqual({ start: 0, end: 3 });
    expect(menuWindow(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it('runs a command that takes nothing, and fills in one that takes arguments', () => {
    expect(accepted({ name: 'help', summary: '' })).toEqual({ text: '/help', run: true });
    expect(accepted({ name: 'mode', args: 'plan|edit|auto', summary: '' })).toEqual({
      text: '/mode ',
      run: false,
    });
  });

  it('writes a command the way the menu shows it', () => {
    expect(slashText({ name: 'exit', summary: '' })).toBe('/exit');
    expect(slashText({ name: 'team', args: 'solo|duo|academy', summary: '' })).toBe(
      '/team solo|duo|academy',
    );
  });

  it('keeps /help and the menu on the same list', () => {
    for (const command of COMMANDS) {
      expect(SESSION_HELP).toContain(slashText(command));
      expect(SESSION_HELP).toContain(command.summary);
    }
  });
});
