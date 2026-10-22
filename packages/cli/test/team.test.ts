import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentBus,
  RunController,
  type ChatProvider,
  type TurnResponse,
} from '@applivity/plato-core';
import type { PlatoConfig } from '../src/config.js';
import { HostError } from '../src/errors.js';
import {
  createObservers,
  observerSpecs,
  observerSummary,
  watchObservers,
  type ObserverSpec,
} from '../src/team.js';

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

function config(): PlatoConfig {
  return {
    connections: [
      { id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1' },
      { id: 'remote', kind: 'anthropic' },
    ],
    model: 'stub:test-model',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

function observerProvider(action: object): ChatProvider {
  return {
    id: 'openai',
    async completeTurn(): Promise<TurnResponse> {
      return {
        content: [{ type: 'text', text: JSON.stringify(action) }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    },
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('team specs', () => {
  it('returns nothing for solo', () => {
    expect(observerSpecs('solo', 'stub:test-model', tempDir('plato-team-'))).toEqual([]);
  });

  it('runs the built-in Duo philosopher when no file exists', () => {
    const specs = observerSpecs('duo', 'stub:test-model', tempDir('plato-team-'));
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe('Aristotle');
    expect(specs[0]?.ref).toBe('stub:test-model');
    expect(specs[0]?.guidance).toBe(true);
    expect(specs[0]?.maxInterventions).toBe(5);
  });

  it('reads DUO.yaml from the shared home', () => {
    const home = tempDir('plato-team-');
    writeFileSync(
      join(home, 'DUO.yaml'),
      [
        'philosopher:',
        '  persona: pythagoras',
        '  name: Pythagoras',
        '  model: stub:philosopher',
        '  pause: true',
        '  maxInterventions: 3',
      ].join('\n'),
    );
    const specs = observerSpecs('duo', 'stub:test-model', home);
    expect(specs[0]).toMatchObject({
      name: 'Pythagoras',
      ref: 'stub:philosopher',
      pause: true,
      maxInterventions: 3,
    });
  });

  it('rejects a broken DUO.yaml loudly', () => {
    const home = tempDir('plato-team-');
    writeFileSync(join(home, 'DUO.yaml'), 'philosopher:\n  name: Nobody\n');
    expect(() => observerSpecs('duo', 'stub:test-model', home)).toThrow(HostError);
    expect(() => observerSpecs('duo', 'stub:test-model', home)).toThrow(/DUO\.yaml/);
  });

  it('runs the starter council when no ACADEMY.yaml exists', () => {
    const specs = observerSpecs('academy', 'stub:test-model', tempDir('plato-team-'));
    expect(specs).toHaveLength(2);
    expect(specs.map((spec) => spec.name)).toEqual(['Aristotle', 'Pythagoras']);
    expect(specs.every((spec) => spec.ref === 'stub:test-model')).toBe(true);
  });

  it('reads ACADEMY.yaml members', () => {
    const home = tempDir('plato-team-');
    writeFileSync(
      join(home, 'ACADEMY.yaml'),
      [
        'academy:',
        '  name: lyceum',
        'members:',
        '  - name: Socrates',
        '    kind: philosopher',
        '    model: stub:socrates',
        '    persona: socrates',
        '    maxInterventions: 2',
        '  - name: Plato',
        '    kind: philosopher',
        '    model: stub:plato',
        '    persona: plato',
      ].join('\n'),
    );
    const specs = observerSpecs('academy', 'stub:test-model', home);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ name: 'Socrates', ref: 'stub:socrates', maxInterventions: 2 });
  });

  it('rejects a broken ACADEMY.yaml loudly', () => {
    const home = tempDir('plato-team-');
    writeFileSync(join(home, 'ACADEMY.yaml'), 'members:\n  - name: Nobody\n    kind: robot\n');
    expect(() => observerSpecs('academy', 'stub:test-model', home)).toThrow(HostError);
    expect(() => observerSpecs('academy', 'stub:test-model', home)).toThrow(/ACADEMY\.yaml/);
  });
});

describe('observer construction', () => {
  const spec = (overrides: Partial<ObserverSpec> = {}): ObserverSpec => ({
    name: 'Aristotle',
    ref: 'stub:test-model',
    role: '',
    guidance: true,
    pause: false,
    cancel: false,
    maxInterventions: 5,
    hex: '#ffffff',
    ...overrides,
  });

  it('builds an observer when its connection has a key', async () => {
    const { handles, skipped } = await createObservers([spec()], {
      config: config(),
      env: { PLATO_KEY_STUB: 'sk-test' },
      provider: () => observerProvider({ action: 'noop' }),
    });
    expect(skipped).toEqual([]);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.name).toBe('Aristotle');
  });

  it('skips a remote observer with no key and says how to fix it', async () => {
    const { handles, skipped } = await createObservers(
      [spec({ name: 'Remote', ref: 'remote:claude-sonnet-4-5' })],
      {
        config: config(),
        env: { PLATO_DISABLE_KEYRING: '1' },
      },
    );
    expect(handles).toEqual([]);
    expect(skipped[0]?.reason).toContain("plato auth login remote");
  });

  it('skips an unknown connection and a malformed ref', async () => {
    const { skipped } = await createObservers(
      [
        spec({ ref: 'missing:m' }),
        spec({ name: 'Bad', ref: 'not-a-ref' }),
      ],
      { config: config(), env: {}, provider: () => observerProvider({ action: 'noop' }) },
    );
    expect(skipped.map((entry) => entry.name)).toEqual(['Aristotle', 'Bad']);
    expect(skipped[0]?.reason).toContain("'missing' is not configured");
    expect(skipped[1]?.reason).toContain('not connection:model');
  });
});

describe('observer actions', () => {
  async function setup(action: object, maxInterventions = 5) {
    const { handles } = await createObservers(
      [
        {
          name: 'Aristotle',
          ref: 'stub:test-model',
          role: '',
          guidance: true,
          pause: true,
          cancel: true,
          maxInterventions,
          hex: '#ffffff',
        },
      ],
      {
        config: config(),
        env: { PLATO_KEY_STUB: 'sk-test' },
        provider: () => observerProvider(action),
      },
    );
    const bus = new AgentBus();
    const controller = new RunController();
    const events: string[] = [];
    const notices: string[] = [];
    watchObservers(
      handles,
      { bus, controller, task: 'do the work' },
      {
        event: (event) =>
          events.push(
            event.type === 'state'
              ? `state:${event.state}${event.last === undefined ? '' : `:${event.last}`}`
              : event.type,
          ),
        notice: (text) => notices.push(text),
      },
    );
    return { handles, bus, controller, events, notices };
  }

  it('queues guidance for the next turn', async () => {
    const { bus, controller, events, notices } = await setup({
      action: 'guidance',
      message: 'check the nulls',
    });
    bus.emit({ type: 'turn-started', runId: 'r', turn: 2 });
    await delay(10);

    expect(controller.drainGuidance()).toEqual(['check the nulls']);
    expect(notices.some((note) => note.includes('guidance: check the nulls'))).toBe(true);
    expect(events.some((event) => event.includes('guidance: check the nulls'))).toBe(true);
  });

  it('parks the run on pause and resumes it', async () => {
    const { bus, controller } = await setup({ action: 'pause' });
    bus.emit({ type: 'turn-started', runId: 'r', turn: 2 });
    await delay(10);

    const gate = controller.gate();
    const outcome = await Promise.race([
      gate.then(() => 'resumed'),
      delay(50).then(() => 'parked'),
    ]);
    expect(outcome).toBe('parked');
    controller.resume();
    await gate;
  });

  it('cancels the run', async () => {
    const { bus, controller } = await setup({ action: 'cancel' });
    bus.emit({ type: 'turn-started', runId: 'r', turn: 2 });
    await delay(10);

    expect(await controller.gate()).toBe(false);
  });

  it('stops after five interventions across the run', async () => {
    const { bus, controller, handles } = await setup({
      action: 'guidance',
      message: 'again',
    }, 99);
    for (let turn = 2; turn <= 8; turn += 1) {
      bus.emit({ type: 'turn-started', runId: 'r', turn });
      await delay(10);
    }

    expect(handles[0]?.agent.checks).toBe(5);
    expect(controller.drainGuidance()).toHaveLength(5);
  });

  it('summarises checks and interventions for the closing line', async () => {
    const { bus, handles } = await setup({ action: 'guidance', message: 'x' });
    bus.emit({ type: 'turn-started', runId: 'r', turn: 2 });
    await delay(10);

    expect(observerSummary(handles)).toContain('observer 1 check · 1 intervention');
  });

  it('has no summary without observers', () => {
    expect(observerSummary([])).toBeUndefined();
  });
});
