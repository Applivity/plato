import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus } from '../src/runtime/bus.js';
import { executeTool } from '../src/tools/execute.js';
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
