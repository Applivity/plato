import { describe, expect, it } from 'vitest';
import { ObserverAgent } from '../src/runtime/observer.js';
import type { ChatProvider, TurnRequest, TurnResponse } from '../src/providers/types.js';

function fakeProvider(reply: string | Error): ChatProvider {
  return {
    id: 'anthropic',
    async completeTurn(_req: TurnRequest): Promise<TurnResponse> {
      if (reply instanceof Error) {
        throw reply;
      }
      return {
        content: [{ type: 'text', text: reply }],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

const OPTS = {
  model: 'anthropic:claude-3-5-haiku-latest',
  guidance: true,
  pause: true,
  cancel: true,
  maxInterventions: 5,
};

describe('ObserverAgent', () => {
  it('parses a clean JSON guidance action and counts it', async () => {
    const o = new ObserverAgent(
      fakeProvider('{"action":"guidance","message":"check the manifest"}'),
      OPTS,
    );
    const a = await o.observe('fix bugs', []);
    expect(a).toEqual({ action: 'guidance', message: 'check the manifest' });
    expect(o.interventions).toBe(1);
  });

  it('accepts JSON wrapped in prose or fences', async () => {
    const o = new ObserverAgent(
      fakeProvider('Here is my decision:\n```json\n{"action":"pause"}\n```\nthanks'),
      OPTS,
    );
    expect(await o.observe('t', [])).toEqual({ action: 'pause' });
  });

  it('enforces permission tiers: disabled cancel degrades to noop', async () => {
    const o = new ObserverAgent(
      fakeProvider('{"action":"cancel"}'),
      { ...OPTS, cancel: false },
    );
    expect(await o.observe('t', [])).toEqual({ action: 'noop' });
    expect(o.interventions).toBe(0);
  });

  it('does not count noop; garbage degrades to noop', async () => {
    const o = new ObserverAgent(fakeProvider('all good, no JSON here'), OPTS);
    expect(await o.observe('t', [])).toEqual({ action: 'noop' });
    expect(o.interventions).toBe(0);
  });

  it('stops intervening after the cap', async () => {
    const o = new ObserverAgent(
      fakeProvider('{"action":"pause"}'),
      { ...OPTS, maxInterventions: 2 },
    );
    await o.observe('t', []);
    await o.observe('t', []);
    expect(o.interventions).toBe(2);
    expect(await o.observe('t', [])).toEqual({ action: 'noop' });
    expect(o.interventions).toBe(2);
  });

  it('provider failure never disturbs the run', async () => {
    const o = new ObserverAgent(
      fakeProvider(new Error('observer endpoint down')),
      OPTS,
    );
    expect(await o.observe('t', [])).toEqual({ action: 'noop' });
  });

  it('counts checks and tracks provider failures for health reporting', async () => {
    let fail = true;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        if (fail) {
          throw new Error('observer endpoint down');
        }
        return { content: [{ type: 'text', text: '{"action":"noop"}' }], usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const o = new ObserverAgent(p, OPTS);
    await o.observe('t', []);
    await o.observe('t', []);
    expect(o.checks).toBe(2);
    expect(o.apiErrors).toBe(2);
    expect(o.lastError).toBe('observer endpoint down');

    fail = false;
    await o.observe('t', []);
    expect(o.apiErrors).toBe(0);
    expect(o.lastError).toBeNull();
    expect(o.checks).toBe(3);
  });

  it('counts unparseable replies as parse errors, not silent noops', async () => {
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'The coder seems fine to me, no issues.' }],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const o = new ObserverAgent(p, OPTS);
    expect(await o.observe('t', [])).toEqual({ action: 'noop' });
    expect(o.checks).toBe(1);
    expect(o.parseErrors).toBe(1);
    expect(o.lastRaw).toContain('coder seems fine');
  });

  it('digest includes task and recent tool lines', async () => {
    let seen = '';
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req) {
        seen = (req.messages[0]?.content[0] as { text: string }).text;
        return { content: [{ type: 'text', text: '{"action":"noop"}' }], usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const o = new ObserverAgent(p, OPTS);
    o.noteText('I will read the files now.');
    await o.observe('fix the bug', [
      { kind: 'tool', text: 'read_file done' },
      { kind: 'tool', text: 'grep done' },
    ]);
    expect(seen).toContain('TASK: fix the bug');
    expect(seen).toContain('[tool] grep done');
    expect(seen).toContain('CODER RECENT REPLY');
  });
});
