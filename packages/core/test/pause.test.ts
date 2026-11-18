import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentBus, RunController } from '../src/runtime/bus.js';
import type { AgentEvent } from '../src/runtime/bus.js';
import { runAgentLoop } from '../src/runtime/loop.js';
import type {
  ChatProvider,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

/**
 * D49bm: Pause is going public on all three variants, so the shared contract
 * the hosts build on is pinned HERE — at the layer where a break is cheap to
 * find. Each test below is one promise a host is allowed to make:
 *
 *  1. a park lands at the next safe point and never mid-tool;
 *  2. resume continues the same run, not a new one;
 *  3. guidance typed while parked reaches the model at the resume boundary,
 *     in order, once;
 *  4. cancel while parked ends the run, and resume cannot revive it;
 *  5. `onPark` fires on the real transitions only.
 */
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-pause-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A provider that returns the scripted turns and records every request. */
function recording(turns: TurnResponse[]): ChatProvider & {
  requests: TurnRequest[];
} {
  const requests: TurnRequest[] = [];
  let i = 0;
  return {
    id: 'anthropic',
    requests,
    async completeTurn(req: TurnRequest): Promise<TurnResponse> {
      requests.push(req);
      const next = turns[i];
      if (next === undefined) throw new Error('unexpected extra turn');
      i += 1;
      return next;
    },
  };
}

function toolTurn(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  text?: string,
): TurnResponse {
  return {
    content: [
      ...(text === undefined ? [] : [{ type: 'text' as const, text }]),
      ...calls.map((c) => ({ type: 'tool_use' as const, ...c })),
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'tool_use',
  };
}

function answerTurn(text: string): TurnResponse {
  return {
    content: [{ type: 'text', text }],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'stop',
  };
}

function write(id: string, path: string, content: string) {
  return { id, name: 'write_file', input: { path, content } };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function loop(
  root: string,
  provider: ChatProvider,
  bus: AgentBus,
  controller: RunController,
) {
  return runAgentLoop({
    root,
    task: 'do the thing',
    getMode: () => 'auto' as const,
    approve: () => Promise.resolve(true),
    model: 'anthropic:claude-3-5-haiku-latest',
    provider,
    bus,
    controller,
  });
}

describe('the pause contract the three hosts depend on (D49bm)', () => {
  it('a pause during a tool call lets that call finish and parks at the next boundary', async () => {
    const root = tempDir();
    const first = join(root, 'first.txt');
    const second = join(root, 'second.txt');
    const parked = deferred();
    const edges: boolean[] = [];
    const controller = new RunController({
      onPark: (p) => {
        edges.push(p);
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    // `allowed` is emitted after the gate and immediately before execution, so
    // pausing from it is pausing while the call is as good as in flight.
    let paused = false;
    bus.on((e: AgentEvent) => {
      if (!paused && e.type === 'tool-event' && e.phase === 'allowed') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'first.txt', 'the whole file'), write('c2', 'second.txt', 'x')]),
      answerTurn('done'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    // The in-flight call completed — a half-written file is the failure this
    // rule exists to prevent — and the NEXT call has not started.
    expect(readFileSync(first, 'utf8')).toBe('the whole file');
    expect(existsSync(second)).toBe(false);
    expect(edges).toEqual([true]);
    controller.resume();
    const r = await run;
    expect(r.reason).toBe('complete');
    expect(existsSync(second)).toBe(true);
    expect(edges).toEqual([true, false]);
  });

  it('resume continues the same run — same turn count, no repeated call, no re-ask', async () => {
    const root = tempDir();
    const parked = deferred();
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    const events: AgentEvent[] = [];
    bus.on((e) => events.push(e));
    let paused = false;
    bus.on((e) => {
      // Park at the TOP of turn 2: the tool round is finished.
      if (!paused && e.type === 'tool-event' && e.phase === 'done') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'one.txt', 'body')], 'working on it'),
      answerTurn('finished'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    expect(p.requests).toHaveLength(1);
    controller.resume();
    const r = await run;
    // One request per turn: nothing was asked twice, and no tool call ran twice.
    expect(p.requests).toHaveLength(2);
    const second = JSON.stringify(p.requests[1]!.messages);
    expect(second).toContain('working on it');
    // One call and one result: the id appears on both and nowhere else.
    expect(second.split('"type":"tool_use"')).toHaveLength(2);
    expect(second.split('"type":"tool_result"')).toHaveLength(2);
    expect(second.split('"c1"')).toHaveLength(3);
    // The same run: started once, turns 1 and 2, and it ended with turn 2.
    expect(events.filter((e) => e.type === 'run-started')).toHaveLength(1);
    expect(
      events.filter((e) => e.type === 'turn-started').map((e) => (e as { turn: number }).turn),
    ).toEqual([1, 2]);
    expect(r.turns).toBe(2);
    expect(r.reason).toBe('complete');
  });

  it('delivers guidance queued at a top-of-turn park in the very next request, in order, once', async () => {
    const root = tempDir();
    const parked = deferred();
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    let paused = false;
    bus.on((e) => {
      // The tool round is over; the next gate is the top of turn 2.
      if (!paused && e.type === 'tool-event' && e.phase === 'done') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'one.txt', 'body')]),
      answerTurn('finished'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    controller.sendGuidance('first note');
    controller.sendGuidance('second note');
    controller.resume();
    await run;
    expect(p.requests).toHaveLength(2);
    const second = JSON.stringify(p.requests[1]!.messages);
    // At the RESUME boundary — not after the following tool round, which this
    // run does not have.
    expect(second).toContain('[observer guidance] first note');
    expect(second).toContain('[observer guidance] second note');
    expect(second.indexOf('first note')).toBeLessThan(second.indexOf('second note'));
    expect(second.split('first note')).toHaveLength(2);
    expect(second.split('second note')).toHaveLength(2);
  });

  it('delivers guidance queued at a between-tools park in order, once', async () => {
    const root = tempDir();
    const parked = deferred();
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    let paused = false;
    bus.on((e) => {
      if (!paused && e.type === 'tool-event' && e.phase === 'allowed') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'a.txt', 'a'), write('c2', 'b.txt', 'b')]),
      answerTurn('finished'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    controller.sendGuidance('first note');
    controller.sendGuidance('second note');
    controller.resume();
    await run;
    expect(p.requests).toHaveLength(2);
    const second = JSON.stringify(p.requests[1]!.messages);
    expect(second).toContain('[observer guidance] first note');
    expect(second).toContain('[observer guidance] second note');
    expect(second.indexOf('first note')).toBeLessThan(second.indexOf('second note'));
    expect(second.split('first note')).toHaveLength(2);
    expect(second.split('second note')).toHaveLength(2);
  });

  it('cancel while parked ends as cancelled, and a later resume does not revive it', async () => {
    const root = tempDir();
    const parked = deferred();
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    let paused = false;
    bus.on((e) => {
      // Pause right after turn 1 goes out; the park lands before tool 1.
      if (!paused && e.type === 'turn-started') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'never.txt', 'x')]),
      answerTurn('should not be reached'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    controller.cancel();
    controller.resume(); // a UI that lets both through must not undo the cancel
    const r = await run;
    expect(r.reason).toBe('cancelled');
    expect(p.requests).toHaveLength(1);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
    // The controller stays cancelled, so even a late resume revives nothing.
    await expect(controller.gate()).resolves.toBe(false);
  });

  it('announces both park edges exactly once around a real pause', async () => {
    const root = tempDir();
    const parked = deferred();
    const edges: boolean[] = [];
    const controller = new RunController({
      onPark: (p) => {
        edges.push(p);
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    let paused = false;
    bus.on((e) => {
      if (!paused && e.type === 'tool-event' && e.phase === 'allowed') {
        paused = true;
        controller.pause();
      }
    });
    const p = recording([
      toolTurn([write('c1', 'a.txt', 'a'), write('c2', 'b.txt', 'b')]),
      answerTurn('finished'),
    ]);
    const run = loop(root, p, bus, controller);
    await parked.promise;
    expect(edges).toEqual([true]);
    controller.resume();
    controller.resume(); // inert: no waiter left
    await run;
    expect(edges).toEqual([true, false]);
  });

  it('announces nothing for a run nobody paused, or a pause that lands after the last gate', async () => {
    const root = tempDir();

    const quiet: boolean[] = [];
    const quietCtrl = new RunController({ onPark: (p) => quiet.push(p) });
    await loop(
      root,
      recording([toolTurn([write('c1', 'a.txt', 'a')]), answerTurn('finished')]),
      new AgentBus(),
      quietCtrl,
    );
    expect(quiet).toEqual([]);

    // Paused while the FINAL answer is arriving: the run ends at that turn, so
    // there is no gate left to park at and the button must never say "paused".
    const late: boolean[] = [];
    const lateCtrl = new RunController({ onPark: (p) => late.push(p) });
    const lateBus = new AgentBus();
    lateBus.on((e) => {
      if (e.type === 'text') lateCtrl.pause();
    });
    const r = await loop(root, recording([answerTurn('finished')]), lateBus, lateCtrl);
    expect(r.reason).toBe('complete');
    expect(late).toEqual([]);
  });
});

/**
 * D49bm (terminal): a pause can land on the FINAL answer too — the user stops a
 * long reply to redirect it. That gate sits before the answer is committed, so
 * two things must hold: a note typed there continues the SAME run, and Stop
 * there keeps the answer rather than pretending the turn never happened.
 */
describe('pausing on the final answer (pauseFinalAnswer)', () => {
  /** A provider that parks the run while producing its one and only answer. */
  function parkingProvider(
    controller: RunController,
    answers: string[],
  ): ChatProvider & { requests: TurnRequest[] } {
    const requests: TurnRequest[] = [];
    let i = 0;
    return {
      id: 'anthropic',
      requests,
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        requests.push(req);
        const text = answers[i];
        if (text === undefined) throw new Error('unexpected extra turn');
        i += 1;
        if (i === 1) controller.pause(); // pressed while this answer is produced
        return answerTurn(text);
      },
    };
  }

  function runFinal(
    root: string,
    provider: ChatProvider,
    bus: AgentBus,
    controller: RunController,
  ) {
    return runAgentLoop({
      root,
      task: 'answer me',
      getMode: () => 'auto' as const,
      approve: () => Promise.resolve(true),
      model: 'anthropic:claude-3-5-haiku-latest',
      provider,
      bus,
      controller,
      pauseFinalAnswer: true,
    });
  }

  it('guidance typed while parked on the final answer continues the same run', async () => {
    const root = tempDir();
    const parked = deferred();
    const events: AgentEvent[] = [];
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    bus.on((e) => events.push(e));
    const p = parkingProvider(controller, ['the answer', 'after the note']);
    const run = runFinal(root, p, bus, controller);
    await parked.promise;
    // Parked BEFORE the answer lands: nothing has been shown yet.
    expect(events.some((e) => e.type === 'text')).toBe(false);
    controller.sendGuidance('change direction');
    controller.resume();
    const r = await run;
    // The same run got another turn rather than ending with the note dropped.
    expect(p.requests).toHaveLength(2);
    const second = JSON.stringify(p.requests[1]!.messages);
    expect(second).toContain('the answer');
    expect(second).toContain('[observer guidance] change direction');
    expect(second.split('change direction')).toHaveLength(2); // once
    expect(r.reason).toBe('complete');
    expect(r.turns).toBe(2);
    expect(r.finalText).toContain('after the note');
  });

  it('Stop at the final-answer park keeps the answer and ends as cancelled', async () => {
    const root = tempDir();
    const parked = deferred();
    const events: AgentEvent[] = [];
    const controller = new RunController({
      onPark: (p) => {
        if (p) parked.resolve();
      },
    });
    const bus = new AgentBus();
    bus.on((e) => events.push(e));
    const p = parkingProvider(controller, ['the answer']);
    const run = runFinal(root, p, bus, controller);
    await parked.promise;
    controller.cancel();
    const r = await run;
    expect(r.reason).toBe('cancelled');
    // The tokens were spent and the model did say it: the answer is kept.
    expect(r.finalText).toContain('the answer');
    const shown = events
      .filter((e): e is Extract<AgentEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.text)
      .join('');
    expect(shown).toContain('the answer');
    expect(p.requests).toHaveLength(1);
  });

  it('with the flag on and no pause, the run is indistinguishable from the flag off', async () => {
    // The flag is on in both shipping hosts, so a change to the gate that
    // alters an ORDINARY run would reach every user unnoticed. Run one scripted
    // turn pair twice — flag off, then flag on — and require the two runs to be
    // the same run: same events in the same order, same outcome.
    const script = (): TurnResponse[] => [
      toolTurn([write('c1', 'a.txt', 'body')], 'working'),
      answerTurn('finished'),
    ];
    async function once(pauseFinalAnswer: boolean) {
      // A fresh root per run, so neither run can inherit a file or a directory
      // state the other created.
      const root = tempDir();
      const bus = new AgentBus();
      const events: AgentEvent[] = [];
      bus.on((e) => events.push(e));
      const controller = new RunController();
      const p = recording(script());
      const r = await runAgentLoop({
        root,
        task: 'answer me',
        getMode: () => 'auto' as const,
        approve: () => Promise.resolve(true),
        model: 'anthropic:claude-3-5-haiku-latest',
        provider: p,
        bus,
        controller,
        pauseFinalAnswer,
      });
      // The run id is minted per run; everything else must match.
      const seen = events.map((e) => {
        const copy = { ...e } as Record<string, unknown>;
        delete copy['runId'];
        return copy;
      });
      return { seen, r };
    }
    const off = await once(false);
    const on = await once(true);
    // A comparison of two empty lists would pass and prove nothing.
    expect(off.seen.length).toBeGreaterThan(5);
    expect(on.seen).toEqual(off.seen);
    expect(on.r.reason).toBe(off.r.reason);
    expect(on.r.turns).toBe(off.r.turns);
    expect(on.r.finalText).toBe(off.r.finalText);
  });
});
