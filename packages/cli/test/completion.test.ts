import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  MENU_ROWS,
  accepted,
  argumentChoices,
  argumentEnter,
  argumentMenu,
  argumentQuery,
  enterAction,
  menuWindow,
  slashQuery,
  slashText,
  suggest,
  type ArgumentQuery,
} from '../src/completion.js';
import { SESSION_HELP } from '../src/session.js';

function at(text: string): ArgumentQuery {
  const query = argumentQuery(text);
  if (query === null) {
    throw new Error(`expected an argument query for ${text}`);
  }
  return query;
}

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
    expect(
      accepted({
        name: 'mode',
        summary: '',
        choices: [{ value: 'plan', summary: '' }],
      }),
    ).toEqual({ text: '/mode ', run: false });
    expect(accepted({ name: 'model', summary: '', takes: 'connection:model' })).toEqual({
      text: '/model ',
      run: false,
    });
  });

  it('writes a command the way the menu shows it', () => {
    expect(slashText({ name: 'exit', summary: '' })).toBe('/exit');
    expect(
      slashText({
        name: 'team',
        summary: '',
        choices: [
          { value: 'solo', summary: '' },
          { value: 'duo', summary: '' },
          { value: 'academy', summary: '' },
        ],
      }),
    ).toBe('/team solo|duo|academy');
    expect(slashText({ name: 'model', summary: '', choices: [{ value: 'add', summary: '' }], takes: 'connection:model' })).toBe(
      '/model add|connection:model',
    );
  });

  it('keeps /help and the menu on the same list, words included', () => {
    for (const command of COMMANDS) {
      expect(SESSION_HELP).toContain(slashText(command));
      expect(SESSION_HELP).toContain(command.summary);
      for (const choice of command.choices ?? []) {
        expect(slashText(command)).toContain(choice.value);
      }
    }
  });
});

describe('enterAction', () => {
  const model = COMMANDS.find((command) => command.name === 'model');
  const help = COMMANDS.find((command) => command.name === 'help');

  it('runs a command whose exact name is typed, arguments or not', () => {
    expect(model).toBeDefined();
    if (model !== undefined) {
      expect(enterAction('/model', model)).toEqual({ action: 'run', text: '/model' });
    }
  });

  it('completes a partial name into the line', () => {
    if (model !== undefined) {
      expect(enterAction('/mod', model)).toEqual({ action: 'fill', text: '/model ' });
    }
  });

  it('runs a command that takes no arguments on its first Enter', () => {
    if (help !== undefined) {
      expect(enterAction('/help', help)).toEqual({ action: 'run', text: '/help' });
    }
  });
});

describe('the argument menu', () => {
  it('reads the first argument after a known command name', () => {
    expect(argumentQuery('/mode ')).toEqual({
      command: COMMANDS.find((command) => command.name === 'mode'),
      fragment: '',
    });
    expect(argumentQuery('/mode p')?.fragment).toBe('p');
    expect(argumentQuery('/compact what to keep')?.fragment).toBe('what to keep');
    expect(argumentQuery('/mode')).toBeNull();
    expect(argumentQuery('/zzz ')).toBeNull();
    expect(argumentQuery('hello')).toBeNull();
    expect(argumentQuery('/mode \nplan')).toBeNull();
  });

  it('filters the words by prefix, case-insensitively', () => {
    expect(argumentChoices(at('/mode ')).map((choice) => choice.value)).toEqual([
      'plan',
      'edit',
      'auto',
    ]);
    expect(argumentChoices(at('/mode P')).map((choice) => choice.value)).toEqual(['plan']);
    expect(argumentChoices(at('/mode z'))).toEqual([]);
  });

  it('shows each command its own words, with a hint when a ref is accepted', () => {
    expect(argumentMenu('/mode ')?.choices.map((choice) => choice.value)).toEqual([
      'plan',
      'edit',
      'auto',
    ]);
    expect(argumentMenu('/team ')?.choices.map((choice) => choice.value)).toEqual([
      'solo',
      'duo',
      'academy',
    ]);
    expect(argumentMenu('/gitignore ')?.choices.map((choice) => choice.value)).toEqual([
      'on',
      'off',
    ]);
    const model = argumentMenu('/model ');
    expect(model?.choices.map((choice) => choice.value)).toEqual(['add']);
    expect(model?.command.takes).toBe('connection:model');
    // A word that matches nothing closes the menu: the command itself answers.
    expect(argumentMenu('/model deepseek:chat')).toBeNull();
    expect(argumentMenu('/mode x')).toBeNull();
  });

  it('says what a free-text command does and offers no list', () => {
    const compact = argumentMenu('/compact ');
    expect(compact?.described).toBe(true);
    expect(compact?.choices).toEqual([]);
    expect(compact?.command.summary).toContain('Summarise the conversation');
    // Once the user writes the note, the line gets out of the way.
    expect(argumentMenu('/compact keep the schemas')).toBeNull();
    expect(argumentMenu('/help ')).toBeNull();
  });

  it('runs an exact choice and completes a partial one', () => {
    const mode = argumentMenu('/mode plan');
    expect(mode).not.toBeNull();
    if (mode !== null) {
      const plan = mode.choices[0];
      expect(argumentEnter('/mode plan', mode, plan)).toEqual({
        action: 'run',
        text: '/mode plan',
      });
    }
    const partial = argumentMenu('/mode pl');
    expect(partial).not.toBeNull();
    if (partial !== null) {
      expect(argumentEnter('/mode pl', partial, partial.choices[0])).toEqual({
        action: 'fill',
        text: '/mode plan',
      });
    }
    // A free-text command has no choice: the ordinary Enter runs the line.
    const compact = argumentMenu('/compact ');
    if (compact !== null) {
      expect(argumentEnter('/compact ', compact, undefined)).toBeNull();
    }
  });

  it('never offers more rows than the command table has', () => {
    for (const command of COMMANDS) {
      const menu = argumentMenu(`/${command.name} `);
      if (menu !== null) {
        expect(menu.choices.length).toBeLessThanOrEqual(MENU_ROWS);
      }
    }
  });
});
