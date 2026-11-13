import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChatProvider,
  LiveSession,
  TurnRequest,
  TurnResponse,
} from '@applivity/plato-core';
import { outsidePathCard } from '@applivity/plato-core';
import { loadConfig, type PlatoConfig } from '../src/config.js';
import { Session } from '../src/session.js';
import { latestSession, type StoredSession } from '../src/sessions.js';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function environment(): Record<string, string> {
  const dir = tempDir('plato-cli-session-state-');
  return {
    PLATO_CONFIG_DIR: join(dir, 'config'),
    PLATO_DATA_DIR: join(dir, 'data'),
    PLATO_HOME: join(dir, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
}

function config(mode: PlatoConfig['mode'] = 'edit'): PlatoConfig {
  return {
    connections: [{ id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1' }],
    model: 'stub:test-model',
    team: 'solo',
    mode,
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

type Step = { tool?: { name: string; input: Record<string, unknown> }; text?: string };

function scripted(steps: Step[], onTurn?: (request: TurnRequest) => void): ChatProvider {
  let step = 0;
  return {
    id: 'openai',
    async completeTurn(request: TurnRequest): Promise<TurnResponse> {
      onTurn?.(request);
      const next = steps[step] ?? { text: 'Done.' };
      step += 1;
      if (next.tool !== undefined) {
        return {
          content: [
            {
              type: 'tool_use',
              id: `call-${step}`,
              name: next.tool.name,
              input: next.tool.input,
            },
          ],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'tool_use',
        };
      }
      return {
        content: [{ type: 'text', text: next.text ?? '' }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'stop',
      };
    },
  };
}

const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

function session(
  root: string,
  env: Record<string, string>,
  provider: ChatProvider,
  mode: PlatoConfig['mode'] = 'edit',
): Session {
  return new Session({
    root,
    config: config(mode),
    env,
    provider,
    fetchImpl: offline,
  });
}

async function waitForCard(session: Session, kind: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const card = session.getSnapshot().card;
    if (card !== null && card.kind === kind) {
      return card;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${kind} card appeared`);
}

describe('approval card', () => {
  it('defaults to No and refuses the write', async () => {
    const root = tempDir('plato-cli-session-root-');
    const active = session(
      root,
      environment(),
      scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'x' } } },
        { text: 'Refused.' },
      ]),
    );
    const done = active.submit('write a file');
    const card = await waitForCard(active, 'approval');
    expect(card.kind).toBe('approval');
    if (card.kind === 'approval') {
      expect(card.options[0]).toBe('No');
      expect(card.selected).toBe(0);
    }
    active.cardConfirm();
    await done;

    expect(existsSync(join(root, 'note.txt'))).toBe(false);
  });

  it('allows the write when Yes is chosen', async () => {
    const root = tempDir('plato-cli-session-root-');
    const active = session(
      root,
      environment(),
      scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'hello' } } },
        { text: 'Written.' },
      ]),
    );
    const done = active.submit('write a file');
    await waitForCard(active, 'approval');
    active.cardMove(1);
    active.cardConfirm();
    await done;

    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('hello');
  });

  it('remembers "allow for this session" across calls', async () => {
    const root = tempDir('plato-cli-session-root-');
    const active = session(
      root,
      environment(),
      scripted([
        { tool: { name: 'write_file', input: { path: 'one.txt', content: '1' } } },
        { tool: { name: 'write_file', input: { path: 'one.txt', content: '1' } } },
        { text: 'Written twice.' },
      ]),
    );
    const done = active.submit('write twice');
    const card = await waitForCard(active, 'approval');
    if (card.kind === 'approval') {
      expect(card.options[2]).toContain('for this session');
    }
    active.cardMove(2);
    active.cardConfirm();
    await done;

    expect(readFileSync(join(root, 'one.txt'), 'utf8')).toBe('1');
    // The second call found no card: the session remembered the answer.
    expect(active.getSnapshot().card).toBeNull();
  });
});

describe('question card', () => {
  it('returns the chosen option to the model', async () => {
    const root = tempDir('plato-cli-session-root-');
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'ask_user',
            input: {
              questions: [
                { header: 'Colour', question: 'Pick a colour', options: ['Red', 'Blue'] },
              ],
            },
          },
        },
        { text: 'Thanks.' },
      ],
      (request) => {
        if (request.messages.length > 2) {
          seen = JSON.stringify(request.messages);
        }
      },
    );
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('ask me');

    const card = await waitForCard(active, 'question');
    if (card.kind === 'question') {
      expect(card.options).toEqual(['Red', 'Blue']);
      expect(card.header).toBe('Colour');
    }
    active.cardMove(1);
    active.cardConfirm();
    await done;

    expect(seen).toContain('Blue');
  });

  it('joins a multi-select answer with semicolons', async () => {
    const root = tempDir('plato-cli-session-root-');
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'ask_user',
            input: {
              questions: [
                {
                  question: 'Pick colours',
                  options: ['Red', 'Blue', 'Green'],
                  multiple: true,
                },
              ],
            },
          },
        },
        { text: 'Thanks.' },
      ],
      (request) => {
        if (request.messages.length > 2) {
          seen = JSON.stringify(request.messages);
        }
      },
    );
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('ask me');
    await waitForCard(active, 'question');
    active.cardToggle();
    active.cardMove(1);
    active.cardToggle();
    active.cardConfirm();
    await done;

    expect(seen).toContain('Red; Blue');
  });

  it('accepts a typed answer on the last row', async () => {
    const root = tempDir('plato-cli-session-root-');
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'ask_user',
            input: {
              questions: [{ question: 'Name it', options: ['One', 'Two'] }],
            },
          },
        },
        { text: 'Thanks.' },
      ],
      (request) => {
        if (request.messages.length > 2) {
          seen = JSON.stringify(request.messages);
        }
      },
    );
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('ask me');
    await waitForCard(active, 'question');
    active.cardMove(2);
    active.cardConfirm();
    active.cardType('Custom');
    active.cardConfirm();
    await done;

    expect(seen).toContain('Custom');
  });
});

describe('reveal card', () => {
  it('offers a protected text file the masker cannot parse', async () => {
    const root = tempDir('plato-cli-session-root-');
    writeFileSync(join(root, 'local.properties'), 'a note with no assignments\n');
    let seen = '';
    const provider = scripted(
      [
        { tool: { name: 'read_file', input: { path: 'local.properties' } } },
        { text: 'Read.' },
      ],
      (request) => {
        if (request.messages.length > 2) {
          seen = JSON.stringify(request.messages);
        }
      },
    );
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('read the protected file');
    const card = await waitForCard(active, 'reveal');
    if (card.kind === 'reveal') {
      expect(card.protectedPath).toBe('local.properties');
    }
    active.cardMove(1);
    active.cardConfirm();
    await done;

    expect(seen).toContain('a note with no assignments');
  });

  it('refuses when the card says No', async () => {
    const root = tempDir('plato-cli-session-root-');
    writeFileSync(join(root, 'local.properties'), 'a note with no assignments\n');
    let seen = '';
    const provider = scripted(
      [
        { tool: { name: 'read_file', input: { path: 'local.properties' } } },
        { text: 'Refused.' },
      ],
      (request) => {
        if (request.messages.length > 2) {
          seen = JSON.stringify(request.messages);
        }
      },
    );
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('read the protected file');
    await waitForCard(active, 'reveal');
    active.cardConfirm();
    await done;

    expect(seen).not.toContain('a note with no assignments');
  });
});

describe('cancel', () => {
  it('stops a run whose provider respects the abort signal', async () => {
    const root = tempDir('plato-cli-session-root-');
    const provider: ChatProvider = {
      id: 'openai',
      async completeTurn(request: TurnRequest): Promise<TurnResponse> {
        return await new Promise<TurnResponse>((_, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    };
    const active = session(root, environment(), provider, 'auto');
    const done = active.submit('hang');
    for (let attempt = 0; attempt < 200 && !active.getSnapshot().running; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    active.cancel();
    await done;

    expect(active.getSnapshot().running).toBe(false);
  });
});

describe('stuck card', () => {
  it('stops the run when the card says Stop', async () => {
    const root = tempDir('plato-cli-session-root-');
    const call = { name: 'read_file', input: { path: 'missing.txt' } };
    const active = session(
      root,
      environment(),
      scripted([{ tool: call }, { tool: call }, { tool: call }, { tool: call }, { tool: call }], undefined),
      'auto',
    );
    const done = active.submit('read a missing file');
    await waitForCard(active, 'stuck');
    active.cardConfirm();
    await done;

    expect(active.getSnapshot().running).toBe(false);
    expect(active.getSnapshot().rows.some((row) => row.text.includes('stuck'))).toBe(true);
  });
});

describe('mode card (D49cb)', () => {
  it('shows the request, and Switch changes the mode the rest of the run reads', async () => {
    const root = tempDir('plato-cli-session-root-');
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'request_mode',
            input: { mode: 'edit', reason: 'Plan mode cannot write the fix.' },
          },
        },
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'approved' } } },
        { text: 'Done.' },
      ],
      (request) => {
        seen = JSON.stringify(request.messages);
      },
    );
    const active = session(root, environment(), provider, 'plan');
    const done = active.submit('fix it');
    const card = await waitForCard(active, 'mode');
    if (card.kind === 'mode') {
      expect(card.current).toBe('plan');
      expect(card.mode).toBe('edit');
      expect(card.reason).toBe('Plan mode cannot write the fix.');
      expect(card.options).toEqual(['Stay in plan', 'Switch to edit']);
      // Stay is the default, so an unanswered card widens nothing.
      expect(card.selected).toBe(0);
    }
    active.cardMove(1);
    active.cardConfirm();
    // In edit mode the write asks, which is the permission table agreeing with
    // the header: the card the same run raises next is the approval one.
    await waitForCard(active, 'approval');
    active.cardMove(1);
    active.cardConfirm();
    await done;

    expect(active.getSnapshot().status.mode).toBe('edit');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('approved');
    expect(seen).toContain('The user approved. Plato is now in edit mode.');
    expect(
      active.getSnapshot().rows.some(
        (row) => row.text === "Mode: edit — the user approved Plato's request.",
      ),
    ).toBe(true);
  });

  it('Stay and Esc both leave the mode in force', async () => {
    const root = tempDir('plato-cli-session-root-');
    const provider = scripted([
      {
        tool: { name: 'request_mode', input: { mode: 'edit', reason: 'Need to write.' } },
      },
      { text: 'Declined.' },
      {
        tool: { name: 'request_mode', input: { mode: 'auto', reason: 'Need a command.' } },
      },
      { text: 'Declined again.' },
    ]);
    const active = session(root, environment(), provider, 'plan');

    const first = active.submit('write it');
    const card = await waitForCard(active, 'mode');
    expect(card.kind).toBe('mode');
    active.cardConfirm();
    await first;
    expect(active.getSnapshot().status.mode).toBe('plan');

    const second = active.submit('run it');
    await waitForCard(active, 'mode');
    active.cardCancel();
    await second;
    expect(active.getSnapshot().status.mode).toBe('plan');

    const notices = active.getSnapshot().rows.map((row) => row.text);
    expect(notices).toContain('Plato asked to switch to edit — the user declined.');
    expect(notices).toContain('Plato asked to switch to auto — the user declined.');
  });

  it('refuses the fourth request in one run, without a card', async () => {
    const root = tempDir('plato-cli-session-root-');
    let seen = '';
    const ask = (mode: string): Step => ({
      tool: { name: 'request_mode', input: { mode, reason: `Need ${mode}.` } },
    });
    const provider = scripted(
      [ask('edit'), ask('auto'), ask('edit'), ask('auto'), { text: 'Done.' }],
      (request) => {
        seen = JSON.stringify(request.messages);
      },
    );
    const active = session(root, environment(), provider, 'plan');
    const cards: string[] = [];
    active.subscribe(() => {
      const card = active.getSnapshot().card;
      if (card !== null) {
        cards.push(card.kind);
      }
    });

    const done = active.submit('ask four times');
    for (let index = 0; index < 3; index += 1) {
      await waitForCard(active, 'mode');
      active.cardConfirm(); // Stay
    }
    await done;

    expect(cards.filter((kind) => kind === 'mode')).toHaveLength(3);
    expect(active.getSnapshot().status.mode).toBe('plan');
    expect(seen).toContain('The user has answered three mode requests this run.');
  });

  it('settles a parked card when the run is cancelled', async () => {
    const root = tempDir('plato-cli-session-root-');
    const provider = scripted([
      { tool: { name: 'request_mode', input: { mode: 'edit', reason: 'Need to write.' } } },
      { text: 'Done.' },
    ]);
    const active = session(root, environment(), provider, 'plan');
    const done = active.submit('write it');
    await waitForCard(active, 'mode');
    active.cancel();
    await done;

    expect(active.getSnapshot().running).toBe(false);
    expect(active.getSnapshot().status.mode).toBe('plan');
  });
});

describe('Duo', () => {
  it('runs a philosopher that guides the worker', async () => {
    const root = tempDir('plato-cli-session-root-');
    writeFileSync(join(root, 'a.txt'), 'hello');
    const requests: string[] = [];
    let turn = 0;
    const worker: ChatProvider = {
      id: 'openai',
      async completeTurn(request: TurnRequest): Promise<TurnResponse> {
        requests.push(JSON.stringify(request.messages));
        turn += 1;
        // Let the observer's decision land while this turn is in flight.
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (turn <= 3) {
          return {
            content: [
              { type: 'tool_use', id: `call-${turn}`, name: 'read_file', input: { path: 'a.txt' } },
            ],
            usage: { inputTokens: 10, outputTokens: 5 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: [{ type: 'text', text: 'Done.' }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const observer: ChatProvider = {
      id: 'openai',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [
            { type: 'text', text: '{"action":"guidance","message":"check the nulls"}' },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const active = new Session({
      root,
      config: { ...config('auto'), team: 'duo' },
      env: environment(),
      provider: worker,
      observerProvider: () => observer,
      fetchImpl: offline,
    });

    await active.submit('read the file');

    const state = active.getSnapshot();
    expect(state.observers.map((entry) => entry.name)).toEqual(['Aristotle']);
    expect(state.rows.some((row) => row.text.includes('[Aristotle] watching'))).toBe(true);
    expect(requests.some((request) => request.includes('[observer guidance] check the nulls'))).toBe(
      true,
    );
    expect(
      state.rows.some(
        (row) => row.text.includes('observer') && row.text.includes('intervention'),
      ),
    ).toBe(true);
  });

  it('runs Solo without an observer strip', async () => {
    const root = tempDir('plato-cli-session-root-');
    const active = session(
      root,
      environment(),
      scripted([
        { tool: { name: 'write_file', input: { path: 'a.txt', content: 'x' } } },
        { text: 'Done.' },
      ]),
      'auto',
    );
    await active.submit('write');
    expect(active.getSnapshot().observers).toEqual([]);
  });
});

describe('sessions', () => {
  it('saves the conversation and resumes it', async () => {
    const root = tempDir('plato-cli-session-root-');
    const env = environment();
    const active = session(root, env, scripted([{ text: 'Hello.' }]), 'auto');
    await active.submit('first task');

    const stored = latestSession(root, env);
    expect(stored?.history).toEqual([
      { role: 'user', text: 'first task' },
      { role: 'assistant', text: 'Hello.' },
    ]);

    const resumed = new Session({
      root,
      config: config('auto'),
      env,
      provider: scripted([]),
      fetchImpl: offline,
      ...(stored === null ? {} : { stored }),
    });
    expect(resumed.getSnapshot().rows.map((row) => row.text)).toEqual([
      'first task',
      'Hello.',
    ]);
    expect(resumed.history).toEqual(stored?.history);
  });

  it('puts back a write from the last run', async () => {
    const root = tempDir('plato-cli-session-root-');
    writeFileSync(join(root, 'note.txt'), 'before');
    const active = session(
      root,
      environment(),
      scripted([
        {
          tool: {
            name: 'write_file',
            input: { path: 'note.txt', content: 'after', overwrite: true },
          },
        },
        { text: 'Done.' },
      ]),
      'auto',
    );
    await active.submit('change the note');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('after');

    await active.handleCommand('/undo');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('before');
  });

  it('refuses to undo a file edited since the write', async () => {
    const root = tempDir('plato-cli-session-root-');
    writeFileSync(join(root, 'note.txt'), 'before');
    const active = session(
      root,
      environment(),
      scripted([
        {
          tool: {
            name: 'write_file',
            input: { path: 'note.txt', content: 'after', overwrite: true },
          },
        },
        { text: 'Done.' },
      ]),
      'auto',
    );
    await active.submit('change the note');
    writeFileSync(join(root, 'note.txt'), 'the user edited it');

    await active.handleCommand('/undo');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('the user edited it');
    expect(active.getSnapshot().rows.some((row) => row.text.includes('refused'))).toBe(true);
  });

  it('says there is nothing to undo when the store is empty', async () => {
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('edit'),
      env: environment(),
      provider: scripted([]),
      fetchImpl: offline,
    });
    await active.handleCommand('/undo');
    expect(active.getSnapshot().rows.some((row) => row.text === 'Nothing to undo.')).toBe(true);
  });

  it('/sessions lists what /new did not delete', async () => {
    const root = tempDir('plato-cli-session-root-');
    const env = environment();
    const active = session(root, env, scripted([{ text: 'Hi.' }]), 'auto');
    await active.submit('first');
    await active.handleCommand('/new');
    await active.handleCommand('/sessions');
    expect(active.getSnapshot().rows.some((row) => row.text.includes('first'))).toBe(true);
  });
});

describe('commands and mode', () => {
  it('cycles plan, edit, auto', () => {
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('plan'),
      env: environment(),
      provider: scripted([]),
      fetchImpl: offline,
    });
    expect(active.mode).toBe('plan');
    active.cycleMode();
    expect(active.mode).toBe('edit');
    active.cycleMode();
    expect(active.mode).toBe('auto');
    active.cycleMode();
    expect(active.mode).toBe('plan');
  });

  it('persists /mode and /model to the config', async () => {
    const root = tempDir('plato-cli-session-root-');
    const env = environment();
    const active = new Session({
      root,
      config: config('edit'),
      env,
      provider: scripted([]),
      fetchImpl: offline,
    });

    expect(await active.handleCommand('/mode auto')).toBe('handled');
    expect(await active.handleCommand('/model stub:other')).toBe('handled');

    const stored = loadConfig(env);
    expect(stored.mode).toBe('auto');
    expect(stored.model).toBe('stub:other');
  });

  it('turns the .gitignore filter on and off, and saves the choice', async () => {
    const env = environment();
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('edit'),
      env,
      provider: scripted([]),
      fetchImpl: offline,
    });

    expect(await active.handleCommand('/gitignore on')).toBe('handled');
    expect(loadConfig(env).respectGitignore).toBe(true);
    expect(
      active.getSnapshot().rows.some((row) => row.text.includes('skips .gitignore paths')),
    ).toBe(true);

    expect(await active.handleCommand('/gitignore off')).toBe('handled');
    expect(loadConfig(env).respectGitignore).toBe(false);

    await active.handleCommand('/gitignore sideways');
    expect(
      active.getSnapshot().rows.some((row) => row.text === 'Usage: /gitignore on|off'),
    ).toBe(true);
  });

  it('rejects a model whose connection is not configured', async () => {
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('edit'),
      env: environment(),
      provider: scripted([]),
      fetchImpl: offline,
    });
    await active.handleCommand('/model missing:gpt-4o');
    expect(active.getSnapshot().rows.some((row) => row.kind === 'error')).toBe(true);
    expect(active.model).toBe('stub:test-model');
  });

  it('starts a new conversation', async () => {
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('edit'),
      env: environment(),
      provider: scripted([]),
      fetchImpl: offline,
    });
    active.addNotice('hello');
    await active.handleCommand('/new');
    expect(active.getSnapshot().rows.map((row) => row.text)).toEqual(['New conversation.']);
    expect(active.history).toEqual([]);
  });

  it('exits on /exit', async () => {
    const active = new Session({
      root: tempDir('plato-cli-session-root-'),
      config: config('edit'),
      env: environment(),
      provider: scripted([]),
      fetchImpl: offline,
    });
    expect(await active.handleCommand('/exit')).toBe('exit');
  });
});

/**
 * D49cq. Delivery into the CLI: a peer's message becomes a RUN whose task is
 * marked as agent-origin, and it never displaces a run, a card, or a
 * half-written prompt.
 */
describe('live sessions in the CLI (D49cq)', () => {
  const inbound = {
    from: { id: 'peer1234', name: 'Builder', host: 'cli' as const },
    text: 'report your cwd',
    reply: false,
    receivedAt: '2026-11-03T10:00:00.000Z',
  };

  async function waitFor(predicate: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  function lastUserText(request: TurnRequest): string {
    const last = request.messages[request.messages.length - 1]!;
    return last.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ');
  }

  /** Enough of a LiveSession for the run wiring: no peers, an accepted send. */
  function fakeLive(): LiveSession {
    return {
      id: 'me1234',
      name: 'Plato CLI',
      list: async () => [],
      send: async () => ({
        ok: true,
        to: {
          id: 'peer1234',
          name: 'Builder',
          summary: '',
          host: 'cli',
          busy: false,
          cwd: '',
          started: '',
        },
        status: 'accepted',
      }),
      refresh: () => {},
      close: async () => {},
    };
  }

  it('runs an inbound message with a header that says it is not the user', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    // Snapshot the text: the loop keeps one messages array and appends the
    // answer to it, so a stored request would show the reply as its last turn.
    const seen: string[] = [];
    const s = session(
      root,
      env,
      scripted([{ text: 'my cwd is /tmp/project' }], (request) =>
        seen.push(lastUserText(request)),
      ),
    );

    expect(await s.receive(inbound)).toBe('started');
    await waitFor(() => !s.getSnapshot().running, 'the inbound run to end');

    expect(s.getSnapshot().rows.some((row) => row.kind === 'inbound')).toBe(true);
    expect(seen).toHaveLength(1);
    const task = seen[0]!;
    expect(task).toContain('Message from another Plato session');
    expect(task).toContain('This is not from the user');
    expect(task).toContain('report your cwd');
    // The wrapper is not the session's name.
    expect(s.describe().name).toBe('Plato CLI');
  });

  it('queues while the user is mid-edit, then delivers after their run', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    const seen: string[] = [];
    const s = session(
      root,
      env,
      scripted([{ text: 'first done' }, { text: 'second done' }], (request) =>
        seen.push(lastUserText(request)),
      ),
    );

    let empty = false;
    s.setEditorProbe(() => empty);
    expect(await s.receive(inbound)).toBe('queued');
    expect(
      s.getSnapshot().rows.some((row) => row.kind === 'notice' && row.text.includes('queued')),
    ).toBe(true);
    expect(seen).toHaveLength(0);

    empty = true;
    await s.submit('my own task');
    await waitFor(() => seen.length >= 2, 'the queued message to run');
    await waitFor(() => !s.getSnapshot().running, 'the queued run to end');

    expect(seen[1]).toContain('Message from another Plato session');
    expect(seen[1]).toContain('report your cwd');
  });

  it('gives a message-origin run one reply back to its sender', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    const tools: string[][] = [];
    const s = session(
      root,
      env,
      scripted([{ text: 'answered' }], (request) =>
        tools.push(request.tools.map((tool) => tool.name)),
      ),
    );
    s.setLive(fakeLive());

    expect(await s.receive(inbound)).toBe('started');
    await waitFor(() => !s.getSnapshot().running, 'the inbound run to end');

    // The sender is passed to the loop, so the run may answer it and only it.
    expect(tools[0]).toContain('send_to_session');
  });

  it('runs a reply as the end of the exchange, with no send tool at all', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    const seen: string[] = [];
    const tools: string[][] = [];
    const s = session(
      root,
      env,
      scripted([{ text: 'noted' }], (request) => {
        seen.push(lastUserText(request));
        tools.push(request.tools.map((tool) => tool.name));
      }),
    );
    s.setLive(fakeLive());

    expect(await s.receive({ ...inbound, reply: true })).toBe('started');
    await waitFor(() => !s.getSnapshot().running, 'the reply run to end');

    expect(seen[0]).toContain('Reply from another Plato session');
    expect(seen[0]).toContain('do not reply again');
    expect(tools[0]).not.toContain('send_to_session');
    expect(tools[0]).toContain('list_sessions');
  });

  it('queues while a run is in progress instead of overlapping it', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider: ChatProvider = {
      id: 'openai',
      async completeTurn(): Promise<TurnResponse> {
        calls += 1;
        if (calls === 1) {
          await gate;
        }
        return {
          content: [{ type: 'text', text: `turn ${calls}` }],
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };
    const s = session(root, env, provider);

    const run = s.submit('a long task');
    await waitFor(() => s.getSnapshot().running, 'the first run to start');
    expect(await s.receive(inbound)).toBe('queued');
    release?.();
    await run;
    await waitFor(() => calls >= 2, 'the queued run');
    await waitFor(() => !s.getSnapshot().running, 'the queued run to end');
  });

  it('describes the title, task, mode and busy state for the registry', async () => {
    const root = tempDir('plato-cli-live-root-');
    const env = environment();
    const s = session(root, env, scripted([{ text: 'done' }]));

    expect(s.describe()).toMatchObject({ name: 'Plato CLI', busy: false });
    expect(s.describe().summary).toContain('No task yet');
    await s.submit('fix the auth test');
    expect(s.describe().name).toBe('fix the auth test');
    expect(s.describe().summary).toContain('fix the auth test');
    expect(s.describe().summary).toContain('edit');
    expect(s.describe().busy).toBe(false);
  });
});

/**
 * D44d amended, D49dn, D49dk, D49dl: the parity round. The terminal session
 * keeps the same conversation rows the desktop chat does, so a fold, the
 * re-injection block, an outside read and the idle clock behave the same way.
 */
describe('conversation parity in the terminal', () => {
  async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  it('folds on /compact and sends the summary with the next request', async () => {
    const root = tempDir('plato-cli-parity-root-');
    const env = environment();
    const requests: TurnRequest[] = [];
    const firstUser = `first ${'u'.repeat(2000)}`;
    const secondUser = `second ${'v'.repeat(2000)}`;
    const secondAnswer = `second answer ${'b'.repeat(2000)}`;
    const active = new Session({
      root,
      // A high threshold keeps the AUTOMATIC fold out of the way; `/compact`
      // may fold below it, because the user asked.
      config: { ...config('auto'), compactionThreshold: 0.95 },
      env,
      provider: scripted(
        [
          { text: `first answer ${'a'.repeat(2000)}` },
          { text: secondAnswer },
          { text: 'The summary of the earlier work.' },
          { text: 'continued' },
        ],
        (request) => requests.push(request),
      ),
      fetchImpl: offline,
      maxContext: 4000,
    });

    await active.submit(firstUser);
    await active.submit(secondUser);
    expect(active.log.some((row) => row.k === 'compact')).toBe(false);

    await active.handleCommand('/compact');

    const summary = active.log.find((row) => row.k === 'compact');
    expect(summary?.text).toBe('The summary of the earlier work.');
    // Nothing was removed from the transcript.
    expect(active.log.filter((row) => row.k === 'msg')).toHaveLength(4);
    expect(
      active.getSnapshot().rows.some(
        (row) =>
          row.text ===
          'Summary added for 2 earlier messages, as you asked. ' +
            'Nothing was removed from the transcript.',
      ),
    ).toBe(true);

    await active.submit('continue');
    const sent = JSON.stringify(requests.at(-1));
    expect(sent).toContain('[Summary of the earlier conversation]');
    expect(sent).toContain('The summary of the earlier work.');
    // The folded exchange is not in the request; the kept one is.
    expect(sent).not.toContain(firstUser);
    expect(sent).toContain(secondUser);
    expect(sent).toContain(secondAnswer);
  });

  it('re-injects recent work only after a summary exists', async () => {
    const root = tempDir('plato-cli-reinject-root-');
    const env = environment();
    writeFileSync(join(root, 'note.txt'), 'current-note');
    const rows = [
      { k: 'msg' as const, cls: 'you' as const, text: 'read the note' },
      {
        k: 'tool' as const,
        tool: 'read_file',
        phase: 'done',
        ok: true,
        digest: 'note.txt',
      },
      { k: 'msg' as const, cls: 'bot' as const, text: 'read it' },
    ];
    const withoutRequests: TurnRequest[] = [];
    const without = new Session({
      root,
      config: config('auto'),
      env,
      provider: scripted([{ text: 'done' }], (request) =>
        withoutRequests.push(request),
      ),
      fetchImpl: offline,
      maxContext: 200_000,
      stored: {
        id: 'stored-1',
        title: '',
        createdAt: '',
        updatedAt: '',
        model: 'stub:test-model',
        mode: 'auto',
        team: 'solo',
        history: [],
        log: rows,
      },
    });
    await without.submit('next');
    expect(JSON.stringify(withoutRequests.at(-1))).not.toContain('[recent work');

    const captured: TurnRequest[] = [];
    const withSummary = new Session({
      root,
      config: config('auto'),
      env,
      provider: scripted([{ text: 'done' }], (request) => captured.push(request)),
      fetchImpl: offline,
      maxContext: 200_000,
      stored: {
        id: 'stored-2',
        title: '',
        createdAt: '',
        updatedAt: '',
        model: 'stub:test-model',
        mode: 'auto',
        team: 'solo',
        history: [],
        log: [{ k: 'compact', text: 'Earlier work.' }, ...rows],
      },
    });
    await withSummary.submit('next');
    const sent = JSON.stringify(captured.at(-1));
    expect(sent).toContain('[recent work');
    expect(sent).toContain('current-note');
  });

  it('asks before an outside read and treats deny as a result the run survives', async () => {
    const root = tempDir('plato-cli-outside-root-');
    const outside = tempDir('plato-cli-outside-file-');
    const abs = join(outside, 'note.txt');
    writeFileSync(abs, 'outside-secret-text');
    const requests: TurnRequest[] = [];
    const active = new Session({
      root,
      config: config('auto'),
      env: environment(),
      provider: scripted(
        [
          { tool: { name: 'read_file', input: { path: abs } } },
          { text: 'I could not read it.' },
        ],
        (request) => requests.push(request),
      ),
      fetchImpl: offline,
    });

    const done = active.submit('read the outside file');
    const card = await waitForCard(active, 'outside');
    // The wording is core's, label and hint, in core's order — the host only
    // adds its own number.
    const expected = outsidePathCard('read', 'read_file', [
      { path: abs, abs },
    ]).answers.map(
      (answer, index) => `${index + 1}. ${answer.label} — ${answer.hint}`,
    );
    expect(card.options).toEqual(expected);
    expect(card.options).toHaveLength(3);
    expect(card.options[0]).toBe('1. Allow once — Just this one request.');
    expect(card.options[2]).toBe('3. Deny — Nothing is read.');
    expect(card.selected).toBe(2);
    // Esc answers with the default, which is deny.
    active.cardCancel();
    await done;

    const sent = JSON.stringify(requests);
    expect(sent).toContain('the user declined to read');
    expect(sent).not.toContain('outside-secret-text');
    expect(
      active.getSnapshot().rows.some((row) => row.text.includes('I could not read it.')),
    ).toBe(true);
  });

  it('allows one outside read and asks again for the next one', async () => {
    const root = tempDir('plato-cli-outside-root-');
    const outside = tempDir('plato-cli-outside-file-');
    const one = join(outside, 'one.txt');
    const two = join(outside, 'two.txt');
    writeFileSync(one, 'first-outside-body');
    writeFileSync(two, 'second-outside-body');
    const requests: TurnRequest[] = [];
    const active = new Session({
      root,
      config: config('auto'),
      env: environment(),
      provider: scripted(
        [
          { tool: { name: 'read_file', input: { path: one } } },
          { tool: { name: 'read_file', input: { path: two } } },
          { text: 'One read.' },
        ],
        (request) => requests.push(request),
      ),
      fetchImpl: offline,
    });

    const done = active.submit('read one, then the other');
    await waitForCard(active, 'outside');
    // The first answer: allow this call only.
    active.cardMove(-2);
    active.cardConfirm();
    // The second call is a new question, because "once" is not remembered.
    await waitForCard(active, 'outside');
    active.cardConfirm();
    await done;

    const sent = JSON.stringify(requests.at(-1));
    expect(sent).toContain('first-outside-body');
    expect(sent).not.toContain('second-outside-body');
  });

  it('allows every outside path for the session, read and write, without asking again', async () => {
    const root = tempDir('plato-cli-outside-root-');
    const outside = tempDir('plato-cli-outside-file-');
    const one = join(outside, 'one.txt');
    const two = join(outside, 'two.txt');
    writeFileSync(one, 'first-outside-body');
    const requests: TurnRequest[] = [];
    const active = new Session({
      root,
      config: config('auto'),
      env: environment(),
      provider: scripted(
        [
          { tool: { name: 'read_file', input: { path: one } } },
          {
            tool: {
              name: 'write_file',
              input: { path: two, content: 'written-outside-body' },
            },
          },
          { text: 'Read and written.' },
        ],
        (request) => requests.push(request),
      ),
      fetchImpl: offline,
    });

    const done = active.submit('read one, then write the other');
    await waitForCard(active, 'outside');
    // The session answer is the second; it covers the later WRITE too.
    active.cardMove(-1);
    active.cardConfirm();
    await done;

    expect(readFileSync(two, 'utf8')).toBe('written-outside-body');
    const sent = JSON.stringify(requests.at(-1));
    expect(sent).toContain('first-outside-body');
    expect(
      active.getSnapshot().rows.some((row) =>
        row.text.includes(
          'Plato did not ask — you allowed outside paths for this session.',
        ),
      ),
    ).toBe(true);
  });

  it('names every path in a call that leaves the project', async () => {
    const root = tempDir('plato-cli-outside-root-');
    const outside = tempDir('plato-cli-outside-file-');
    const one = join(outside, 'one.txt');
    const two = join(outside, 'two.txt');
    writeFileSync(one, 'a');
    writeFileSync(two, 'b');
    const active = new Session({
      root,
      config: config('auto'),
      env: environment(),
      provider: scripted([
        {
          tool: {
            name: 'apply_patch',
            input: {
              patches: [
                { path: one, diffs: [{ search: 'a', replace: 'x' }] },
                { path: two, diffs: [{ search: 'b', replace: 'y' }] },
              ],
            },
          },
        },
        { text: 'Declined.' },
      ]),
      fetchImpl: offline,
    });

    const done = active.submit('patch both outside files');
    const card = await waitForCard(active, 'outside');
    if (card.kind !== 'outside') throw new Error('expected an outside card');
    expect(card.lines).toContain(
      'Plato wants to write 2 files outside the project:',
    );
    expect(card.lines).toContain(one);
    expect(card.lines).toContain(two);
    active.cardCancel();
    await done;

    expect(readFileSync(one, 'utf8')).toBe('a');
    expect(readFileSync(two, 'utf8')).toBe('b');
  });

  it('denies an outside write, writes nothing, and continues the run', async () => {
    const root = tempDir('plato-cli-outside-root-');
    const outside = tempDir('plato-cli-outside-file-');
    const target = join(outside, 'never.txt');
    const requests: TurnRequest[] = [];
    const active = new Session({
      root,
      config: config('auto'),
      env: environment(),
      provider: scripted(
        [
          {
            tool: {
              name: 'write_file',
              input: { path: target, content: 'must-not-land' },
            },
          },
          { text: 'I did not write it.' },
        ],
        (request) => requests.push(request),
      ),
      fetchImpl: offline,
    });

    const done = active.submit('write the outside file');
    const card = await waitForCard(active, 'outside');
    expect(card.options[2]).toBe('3. Deny — Nothing is changed.');
    expect(card.selected).toBe(2);
    active.cardConfirm();
    await done;

    expect(existsSync(target)).toBe(false);
    const sent = JSON.stringify(requests.at(-1));
    expect(sent).toContain('the user declined to write');
    expect(sent).toContain('Nothing was written.');
    expect(
      active.getSnapshot().rows.some((row) => row.text.includes('I did not write it.')),
    ).toBe(true);
  });

  it('runs the idle clock only when the setting is on, and cancels it on new input', async () => {
    const root = tempDir('plato-cli-idle-root-');
    const env = environment();
    const rows = [0, 1, 2, 3].map((index) => ({
      k: 'msg' as const,
      cls: index % 2 === 0 ? ('you' as const) : ('bot' as const),
      text: `message ${index} ${'x'.repeat(2000)}`,
    }));
    const stored: StoredSession = {
      id: 'idle-1',
      title: '',
      createdAt: '',
      updatedAt: '',
      model: 'stub:test-model',
      mode: 'auto',
      team: 'solo',
      history: [],
      log: rows,
    };

    let offScheduled = false;
    new Session({
      root,
      config: { ...config('auto'), compactionThreshold: 0.95 },
      env,
      provider: scripted([{ text: 'unused' }]),
      fetchImpl: offline,
      maxContext: 4000,
      stored,
      idle: {
        minTokens: 0,
        setTimer: () => {
          offScheduled = true;
          return 'off';
        },
      },
    });
    expect(offScheduled).toBe(false);

    const clock: { fn: (() => void) | null } = { fn: null };
    let cleared = 0;
    const active = new Session({
      root,
      config: { ...config('auto'), compactionThreshold: 0.95, compactionIdle: true },
      env,
      provider: scripted([{ text: 'run answer' }, { text: 'The idle summary.' }]),
      fetchImpl: offline,
      maxContext: 4000,
      stored,
      idle: {
        minTokens: 0,
        setTimer: (fn) => {
          clock.fn = fn;
          return 'on';
        },
        clearTimer: () => {
          cleared += 1;
          clock.fn = null;
        },
      },
    });
    expect(clock.fn).not.toBeNull();
    // A new message cancels the pending clock; the run end starts a new one.
    const before = clock.fn;
    await active.submit('hello');
    expect(cleared).toBeGreaterThan(0);
    expect(clock.fn).not.toBe(before);

    // The new clock fires: the idle fold runs and writes its summary.
    const fire = clock.fn;
    fire?.();
    await waitUntil(
      () => active.log.some((row) => row.k === 'compact'),
      'the idle fold',
    );
    expect(active.log.find((row) => row.k === 'compact')?.text).toBe(
      'The idle summary.',
    );
  });
});
