import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus } from '../src/runtime/bus.js';
import { executeTool } from '../src/tools/execute.js';
import { outsidePathCard, outsidePathDeclined } from '../src/runtime/outsideReadCopy.js';
import type {
  ChatProvider,
  CanonicalMessage,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

/**
 * D49dk (2026-11-12): a READ may leave the workspace with the user's say-so.
 *
 * The client's machine refused a UNC address of a file that is INSIDE the
 * workspace through its drive path. The address is a different string, and the
 * workspace rule is lexical — so the answer is a question asked at the moment
 * the model tries, not a wall. Writes stay contained.
 */
const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Call {
  name: string;
  input: Record<string, unknown>;
}

/** A provider that makes one turn of tool calls, then answers. */
function scripted(calls: Call[]): {
  provider: ChatProvider;
  seen: CanonicalMessage[][];
} {
  let turn = 0;
  const seen: CanonicalMessage[][] = [];
  const provider: ChatProvider = {
    id: 'openai',
    async completeTurn(req: TurnRequest): Promise<TurnResponse> {
      seen.push(req.messages);
      if (turn === 0) {
        turn += 1;
        return {
          content: calls.map((c, i) => ({
            type: 'tool_use' as const,
            id: `call-${i}`,
            name: c.name,
            input: c.input,
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'tool_use',
        };
      }
      return {
        content: [{ type: 'text', text: 'done' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    },
  };
  return { provider, seen };
}

/** Everything the model was shown after the tools ran. */
function resultsText(seen: CanonicalMessage[][]): string {
  return JSON.stringify(seen[1] ?? []);
}

interface BusEvent {
  type: string;
  tool?: string;
  phase?: string;
  reason?: string;
}

async function loopWith(
  root: string,
  calls: Call[],
  extra: Record<string, unknown>,
): Promise<{ text: string; events: BusEvent[] }> {
  const { provider, seen } = scripted(calls);
  const bus = new AgentBus();
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e as BusEvent));
  await runAgentLoop({
    root,
    task: 'look at the file',
    getMode: () => 'auto' as const,
    approve: () => Promise.resolve(true),
    model: 'openai:gpt-test',
    provider,
    bus,
    ...extra,
  });
  return { text: resultsText(seen), events };
}

describe('outside reads need a decision (D49dk)', () => {
  it('reads the file after approval and shows it to the model', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'outside.txt');
    writeFileSync(file, 'a fact from outside');
    const asked: Array<{ paths: readonly string[]; tool: string }> = [];
    const { text } = await loopWith(
      root,
      [{ name: 'read_file', input: { path: file } }],
      {
        outsideRead: async (paths: readonly string[], tool: string) => {
          asked.push({ paths, tool });
          return true;
        },
      },
    );
    expect(asked).toEqual([{ paths: [file], tool: 'read_file' }]);
    expect(text).toContain('a fact from outside');
  });

  it('turns a denial into a result the model can act on', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'outside.txt');
    writeFileSync(file, 'a fact from outside');
    const { text } = await loopWith(
      root,
      [{ name: 'read_file', input: { path: file } }],
      { outsideRead: async () => false },
    );
    expect(text).toContain('user declined');
    expect(text).toContain('Nothing was read');
    expect(text).not.toContain('a fact from outside');
  });

  it('keeps the old refusal, and its reason, when no host asks', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'outside.txt');
    writeFileSync(file, 'a fact from outside');
    const { text, events } = await loopWith(
      root,
      [{ name: 'read_file', input: { path: file } }],
      {},
    );
    expect(text).toContain('outside the workspace');
    expect(text).not.toContain('a fact from outside');
    const refused = events.find(
      (e) => e.type === 'tool-event' && e.phase === 'refused',
    );
    expect(refused?.reason).toBe('containment');
  });

  it('never asks about a WRITE, and still refuses it', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'written.txt');
    let asked = 0;
    const { text } = await loopWith(
      root,
      [{ name: 'write_file', input: { path: file, content: 'x' } }],
      {
        outsideRead: async () => {
          asked += 1;
          return true;
        },
      },
    );
    expect(asked).toBe(0);
    expect(text).toContain('outside the workspace');
    expect(existsSync(file)).toBe(false);
  });

  it('approves one resolved path and cannot be steered to another', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const allowed = join(away, 'allowed.txt');
    const other = join(away, 'other.txt');
    writeFileSync(allowed, 'the allowed content');
    writeFileSync(other, 'the other content');

    // The executor's own rule, independent of the loop: an allowance for one
    // absolute path does not admit its neighbour.
    const direct = await executeTool(
      root,
      'read_file',
      { path: other },
      { outsideRead: [allowed] },
    );
    expect(direct.ok).toBe(false);
    expect(direct.output).toContain('outside the workspace');

    const directOk = await executeTool(
      root,
      'read_file',
      { path: allowed },
      { outsideRead: [allowed] },
    );
    expect(directOk.ok).toBe(true);
    expect(directOk.output).toContain('the allowed content');
  });

  it('asks again for a second call the user did not approve', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const first = join(away, 'first.txt');
    const second = join(away, 'second.txt');
    writeFileSync(first, 'first content');
    writeFileSync(second, 'second content');
    let asked = 0;
    const { text } = await loopWith(
      root,
      [
        { name: 'read_file', input: { path: first } },
        { name: 'read_file', input: { path: second } },
      ],
      {
        // The user says yes once, then no. Nothing from the first answer may
        // make the second call run.
        outsideRead: async () => {
          asked += 1;
          return asked === 1;
        },
      },
    );
    expect(asked).toBe(2);
    expect(text).toContain('first content');
    expect(text).not.toContain('second content');
    expect(text).toContain('user declined');
  });

  it('searches an approved folder and names each hit absolutely', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    writeFileSync(join(away, 'a.txt'), 'here is a needle\n');
    writeFileSync(join(away, 'b.txt'), 'nothing here\n');
    const { text } = await loopWith(
      root,
      [{ name: 'grep', input: { pattern: 'needle', path: away } }],
      { outsideRead: async () => true },
    );
    expect(text).toContain(join(away, 'a.txt'));
    expect(text).not.toContain(join(away, 'b.txt'));
  });

  it('shows an approved image from outside', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
        '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const file = join(away, 'shot.png');
    writeFileSync(file, png);
    const { text } = await loopWith(
      root,
      [{ name: 'read_image', input: { path: file } }],
      { outsideRead: async () => true },
    );
    expect(text).toContain('Showing');
    expect(text).toContain(file);
  });

  it('lets an approved LISTING name the folder by absolute path', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    writeFileSync(join(away, 'one.txt'), '1');
    writeFileSync(join(away, 'two.txt'), '2');
    const { text } = await loopWith(
      root,
      [{ name: 'list_dir', input: { path: away } }],
      { outsideRead: async () => true },
    );
    expect(text).toContain(join(away, 'one.txt'));
    expect(text).toContain(join(away, 'two.txt'));
  });
});

/**
 * D49dk (widened 2026-11-13): a WRITE may leave the project too, under its own
 * approval, and `outsidePath` carries both kinds. The remembered scope is the
 * host's; core decides one call at a time. The secret deny-list outranks an
 * approval, and a denial stays an ordinary result the run continues past.
 */
describe('outside writes and the widened hook', () => {
  it('asks for a READ under kind "read" and runs on approval', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'outside.txt');
    writeFileSync(file, 'a fact from outside');
    const asked: Array<{ paths: readonly string[]; tool: string; kind: string }> = [];
    const { text } = await loopWith(
      root,
      [{ name: 'read_file', input: { path: file } }],
      {
        outsidePath: async (req: {
          paths: readonly string[];
          tool: string;
          kind: 'read' | 'write';
        }) => {
          asked.push(req);
          return true;
        },
      },
    );
    expect(asked).toEqual([{ paths: [file], tool: 'read_file', kind: 'read' }]);
    expect(text).toContain('a fact from outside');
  });

  it('asks for a WRITE under kind "write" and creates the file on approval', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'written.txt');
    const asked: Array<{ kind: string; tool: string; paths: readonly string[] }> = [];
    const { text } = await loopWith(
      root,
      [{ name: 'write_file', input: { path: file, content: 'written outside' } }],
      {
        outsidePath: async (req: {
          paths: readonly string[];
          tool: string;
          kind: 'read' | 'write';
        }) => {
          asked.push(req);
          return true;
        },
      },
    );
    expect(asked).toEqual([{ paths: [file], tool: 'write_file', kind: 'write' }]);
    expect(existsSync(file)).toBe(true);
    expect(text).not.toContain('outside the workspace');
  });

  it('turns a denied WRITE into an ordinary result and writes nothing', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'denied.txt');
    const { text, events } = await loopWith(
      root,
      [{ name: 'write_file', input: { path: file, content: 'no' } }],
      { outsidePath: async () => false },
    );
    expect(text).toContain('declined to write');
    expect(text).toContain('Nothing was written');
    expect(existsSync(file)).toBe(false);
    const declined = events.find(
      (e) => e.type === 'tool-event' && e.phase === 'declined',
    );
    expect(declined?.tool).toBe('write_file');
  });

  it('still refuses a WRITE when the host has no hook at all', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const file = join(away, 'never.txt');
    const { text } = await loopWith(
      root,
      [{ name: 'write_file', input: { path: file, content: 'x' } }],
      {},
    );
    expect(text).toContain('outside the workspace');
    expect(existsSync(file)).toBe(false);
  });

  it('an allowance covers only the exact path it names', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const allowed = join(away, 'allowed.txt');
    const other = join(away, 'other.txt');

    const refused = await executeTool(
      root,
      'write_file',
      { path: other, content: 'no' },
      { outsideWrite: [allowed] },
    );
    expect(refused.ok).toBe(false);
    expect(refused.output).toContain('outside the workspace');
    expect(existsSync(other)).toBe(false);

    const allowedOut = await executeTool(
      root,
      'write_file',
      { path: allowed, content: 'yes' },
      { outsideWrite: [allowed] },
    );
    expect(allowedOut.ok).toBe(true);
    expect(existsSync(allowed)).toBe(true);
  });

  it('keeps the secret deny-list above an outside approval, read and write', async () => {
    const root = tempDir('plato-out-root-');
    const away = tempDir('plato-out-away-');
    const secret = join(away, '.env');
    writeFileSync(secret, 'TOKEN=abc');

    const read = await executeTool(
      root,
      'read_file',
      { path: secret },
      { outsideRead: [secret] },
    );
    expect(read.ok).toBe(false);
    expect(read.output).toContain('protected file');
    expect(read.output).not.toContain('TOKEN=abc');

    const target = join(away, '.env.local');
    const write = await executeTool(
      root,
      'write_file',
      { path: target, content: 'TOKEN=def' },
      { outsideWrite: [target] },
    );
    expect(write.ok).toBe(false);
    expect(write.output).toContain('protected file');
    expect(existsSync(target)).toBe(false);
  });
});

/**
 * The card a host draws. THREE answers — the founder dropped the per-folder
 * choice — and, on a write only, a calm statement that the change is beyond
 * undo. "Allow once" covers this call's paths wherever they are, so a call that
 * names several outside paths (apply_patch) is one answer, not many.
 */
describe('the outside-path card', () => {
  it('offers exactly three answers, in order, each with its own hint', () => {
    const card = outsidePathCard('read', 'read_file', [
      { path: '/e/a.txt', abs: '/e/a.txt' },
    ]);
    expect(card.answers).toEqual([
      { choice: 'once', label: 'Allow once', hint: 'Just this one request.' },
      {
        choice: 'session',
        label: 'Allow for this session',
        hint: 'Anything outside the project until this chat ends.',
      },
      { choice: 'deny', label: 'Deny', hint: 'Nothing is read.' },
    ]);
    // No per-folder answer, and no field a host could draw one from.
    expect('folder' in card).toBe(false);
    expect('folderLabel' in card).toBe(false);
  });

  it('says "Nothing is changed." when the ask is a write', () => {
    const write = outsidePathCard('write', 'write_file', [
      { path: '/e/a.txt', abs: '/e/a.txt' },
    ]);
    expect(write.answers.map((a) => a.label)).toEqual([
      'Allow once',
      'Allow for this session',
      'Deny',
    ]);
    expect(write.answers[2]!.hint).toBe('Nothing is changed.');
  });

  it('renders ONE path exactly as before, with no dense supporting line', () => {
    const card = outsidePathCard('read', 'read_file', [
      { path: 'x.txt', abs: '/elsewhere/x.txt' },
    ]);
    expect(card.title).toBe('Read a file outside the project?');
    expect(card.lines).toEqual([
      'Plato wants to read /elsewhere/x.txt.',
      'The model asked for "x.txt".',
      'That path is outside the project folder.',
    ]);
    expect(card.lines.join(' ')).not.toContain('Plato saves neither');
    expect(card.why).toContain('reading a file');
  });

  it('names every path when a call carries several', () => {
    const card = outsidePathCard('read', 'apply_patch', [
      { path: '/e/a.txt', abs: '/e/a.txt' },
      { path: '/e/b.txt', abs: '/e/b.txt' },
      { path: '/e/c.txt', abs: '/e/c.txt' },
    ]);
    expect(card.lines).toEqual([
      'Plato wants to read 3 files outside the project:',
      '/e/a.txt',
      '/e/b.txt',
      '/e/c.txt',
      'These paths are outside the project folder.',
    ]);
    expect(card.entries).toHaveLength(3);
  });

  it('lists eight of nine paths and says how many it left out', () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      path: `/e/f${i}.txt`,
      abs: `/e/f${i}.txt`,
    }));
    const card = outsidePathCard('read', 'apply_patch', entries);
    expect(card.lines[0]).toBe('Plato wants to read 9 files outside the project:');
    expect(card.lines.slice(1, 9)).toEqual(entries.slice(0, 8).map((e) => e.abs));
    expect(card.lines[9]).toBe('and 1 more');
    expect(card.lines).not.toContain('/e/f8.txt');
  });

  it('titles a write differently and states the undo limit calmly', () => {
    const read = outsidePathCard('read', 'read_file', [
      { path: 'a.txt', abs: '/e/a.txt' },
    ]);
    const write = outsidePathCard('write', 'write_file', [
      { path: 'a.txt', abs: '/e/a.txt' },
    ]);
    expect(read.title).toBe('Read a file outside the project?');
    expect(write.title).toBe('Write a file outside the project?');
    expect(read.lines.join(' ')).not.toContain('undo');
    expect(write.lines.join(' ')).toContain(
      "Plato's undo covers files inside the project, so this change is outside it.",
    );
    expect(write.lines.join(' ')).not.toContain('cannot undo');
  });

  it('keeps the calm undo line and the write deny hint with several paths', () => {
    const write = outsidePathCard('write', 'apply_patch', [
      { path: '/e/a.txt', abs: '/e/a.txt' },
      { path: '/e/b.txt', abs: '/e/b.txt' },
    ]);
    expect(write.lines[0]).toBe('Plato wants to write 2 files outside the project:');
    expect(write.lines.join(' ')).toContain(
      "Plato's undo covers files inside the project, so this change is outside it.",
    );
    expect(write.answers[2]!.hint).toBe('Nothing is changed.');
  });
});

describe('a declined ask does not forbid asking again', () => {
  it('says the user declined, and allows a later ask when the task needs it', () => {
    const text = outsidePathDeclined('write', 'write_file', '/e/a.txt');
    expect(text).toContain('declined to write');
    expect(text).toContain('Nothing was written');
    expect(text).toContain(
      'ask for it again only if the task genuinely cannot be done otherwise',
    );
    expect(text).not.toContain('do not ask');
  });
});
