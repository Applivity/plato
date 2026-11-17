import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, TurnRequest, TurnResponse } from '@applivity/plato-core';
import type { PlatoConfig } from '../src/config.js';
import { Session } from '../src/session.js';
import { deleteSession, loadSession, saveSession, type StoredSession } from '../src/sessions.js';

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
  const dir = tempDir('plato-cli-resume-state-');
  return {
    PLATO_CONFIG_DIR: join(dir, 'config'),
    PLATO_DATA_DIR: join(dir, 'data'),
    PLATO_HOME: join(dir, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
}

function config(): PlatoConfig {
  return {
    connections: [
      { id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1', contextWindow: 65_536 },
    ],
    model: 'stub:test-model',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

function stored(
  id: string,
  title: string,
  mode: StoredSession['mode'],
  team: StoredSession['team'],
  question: string,
): StoredSession {
  return {
    id,
    title,
    createdAt: '2026-11-17T09:00:00.000Z',
    updatedAt: '2026-11-17T09:00:00.000Z',
    model: 'stub:test-model',
    mode,
    team,
    history: [
      { role: 'user', text: question },
      { role: 'assistant', text: `answer to ${question}` },
    ],
  };
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function countingProvider(): ChatProvider & { calls: number } {
  const provider: ChatProvider & { calls: number } = {
    id: 'openai',
    calls: 0,
    async completeTurn(_request: TurnRequest): Promise<TurnResponse> {
      provider.calls += 1;
      return {
        content: [{ type: 'text', text: 'should not run' }],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'stop',
      };
    },
  };
  return provider;
}

describe('/resume', () => {
  it('saves the current conversation, then loads the chosen one without a request', async () => {
    const root = tempDir('plato-cli-resume-root-');
    const env = environment();
    saveSession(
      root,
      env,
      stored('20261117090100-aaaa', 'First saved', 'plan', 'duo', 'first question'),
      new Date('2026-11-17T10:02:00.000Z'),
    );
    saveSession(
      root,
      env,
      stored('20261117090000-bbbb', 'Second saved', 'auto', 'academy', 'second question'),
      new Date('2026-11-17T10:01:00.000Z'),
    );
    const provider = countingProvider();
    const active = new Session({ root, config: config(), env, provider });
    await waitUntil(
      () => active.getSnapshot().status.contextWindow !== undefined,
      'the configured window',
    );
    const currentId = active.sessionId;

    const command = active.handleCommand('/resume');
    await waitUntil(() => active.getSnapshot().card?.kind === 'resume', 'the resume card');
    const card = active.getSnapshot().card;
    if (card?.kind !== 'resume') throw new Error('no resume card');
    // The store names a conversation after its first question.
    expect(card.choices.map((choice) => choice.title)).toEqual([
      'first question',
      'second question',
    ]);
    expect(card.choices[0]?.meta).toContain('1 turn');
    expect(card.choices[0]?.meta).toContain('~');
    active.cardConfirm();
    await command;

    // The current conversation was saved first.
    expect(loadSession(root, env, currentId)).not.toBeNull();
    // The chosen conversation is the view now.
    expect(active.title).toBe('first question');
    expect(active.model).toBe('stub:test-model');
    expect(active.mode).toBe('plan');
    const state = active.getSnapshot();
    expect(state.status.team).toBe('duo');
    expect(state.rows.slice(0, 2).map((row) => row.text)).toEqual([
      'first question',
      'answer to first question',
    ]);
    // The boundary is marked, so the rows above it are known to be the old view.
    expect(state.rows.at(-1)?.kind).toBe('notice');
    expect(state.rows.at(-1)?.text).toContain('Resumed');
    expect(state.status.contextWindow).toBe(65_536);
    expect(state.status.contextTokens).toBeGreaterThan(0);
    expect(provider.calls).toBe(0);
  });

  it('changes nothing when Esc closes the picker', async () => {
    const root = tempDir('plato-cli-resume-root-');
    const env = environment();
    saveSession(
      root,
      env,
      stored('20261117090100-aaaa', 'First saved', 'plan', 'duo', 'first question'),
    );
    const active = new Session({ root, config: config(), env, provider: countingProvider() });
    const command = active.handleCommand('/resume');
    await waitUntil(() => active.getSnapshot().card?.kind === 'resume', 'the resume card');
    active.cardCancel();
    await command;
    expect(active.title).toBe('');
    expect(active.getSnapshot().rows).toEqual([]);
    expect(active.mode).toBe('edit');
    expect(active.getSnapshot().status.team).toBe('solo');
  });

  it('leaves the current conversation intact when the file cannot be loaded', async () => {
    const root = tempDir('plato-cli-resume-root-');
    const env = environment();
    saveSession(
      root,
      env,
      stored('20261117090100-aaaa', 'First saved', 'plan', 'duo', 'first question'),
      new Date('2026-11-17T10:01:00.000Z'),
    );
    saveSession(
      root,
      env,
      stored('20261117090200-cccc', 'About to vanish', 'auto', 'solo', 'gone question'),
      new Date('2026-11-17T10:02:00.000Z'),
    );
    const provider = countingProvider();
    const active = new Session({ root, config: config(), env, provider });

    // Load the first conversation, then try to load the one that disappears.
    let command = active.handleCommand('/resume');
    await waitUntil(() => active.getSnapshot().card?.kind === 'resume', 'the first card');
    const card = active.getSnapshot().card;
    if (card?.kind !== 'resume') throw new Error('no resume card');
    const firstIndex = card.choices.findIndex(
      (choice) => choice.title === 'first question',
    );
    active.cardMove(firstIndex - card.selected);
    active.cardConfirm();
    await command;
    const before = active.getSnapshot().rows;

    command = active.handleCommand('/resume');
    await waitUntil(() => active.getSnapshot().card?.kind === 'resume', 'the second card');
    const secondCard = active.getSnapshot().card;
    if (secondCard?.kind !== 'resume') throw new Error('no resume card');
    const goneIndex = secondCard.choices.findIndex(
      (choice) => choice.title === 'gone question',
    );
    active.cardMove(goneIndex - secondCard.selected);
    deleteSession(root, env, '20261117090200-cccc');
    active.cardConfirm();
    await command;

    expect(active.title).toBe('first question');
    expect(active.mode).toBe('plan');
    expect(active.getSnapshot().rows.slice(0, before.length)).toEqual(before);
    expect(
      active
        .getSnapshot()
        .rows.some((row) => row.kind === 'error' && row.text.includes('Could not load that conversation')),
    ).toBe(true);
    expect(provider.calls).toBe(0);
  });
});
