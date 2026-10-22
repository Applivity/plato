import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, TurnRequest, TurnResponse } from '@applivity/plato-core';
import type { PlatoConfig } from '../src/config.js';
import { executeTask, imageMentions, type RunSink } from '../src/host.js';

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

// A real 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function config(): PlatoConfig {
  return {
    connections: [{ id: 'stub', kind: 'openai', baseUrl: 'http://localhost:1/v1' }],
    model: 'stub:test-model',
    team: 'solo',
    mode: 'edit',
    reasoning: 'off',
    compactionThreshold: 0.8,
    respectGitignore: false,
  };
}

function env(home: string): Record<string, string> {
  return {
    PLATO_CONFIG_DIR: join(home, 'config'),
    PLATO_DATA_DIR: join(home, 'data'),
    PLATO_HOME: join(home, 'plato'),
    PLATO_DISABLE_KEYRING: '1',
    PLATO_KEY_STUB: 'sk-test',
  };
}

const sink: RunSink = {
  textDelta: () => {},
  textCommitted: () => {},
  tool: () => {},
  approve: async () => true,
  askUser: async () => [],
  stuck: async () => ({ action: 'stop' }),
  reveal: async () => false,
  notice: () => {},
};

describe('image mentions', () => {
  it('attaches an image and rejects a text file renamed to .png', async () => {
    const root = tempDir('plato-images-root-');
    writeFileSync(join(root, 'shot.png'), PNG);
    writeFileSync(join(root, 'fake.png'), 'this is not an image');
    writeFileSync(join(root, 'notes.md'), '# not an image');

    const result = await imageMentions(
      'look at @shot.png and @fake.png and @notes.md',
      root,
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mime).toBe('image/png');
    expect(result.rejected).toEqual([
      { path: 'fake.png', reason: 'not a PNG, JPEG, WebP or GIF — checked the bytes, not the name' },
    ]);
  });

  it('sends the image in the opening user turn', async () => {
    const root = tempDir('plato-images-root-');
    const home = tempDir('plato-images-home-');
    writeFileSync(join(root, 'shot.png'), PNG);
    let opening: string = '';
    const provider: ChatProvider = {
      id: 'openai',
      async completeTurn(request: TurnRequest): Promise<TurnResponse> {
        opening = JSON.stringify(request.messages[0]);
        return {
          content: [{ type: 'text', text: 'I see it.' }],
          usage: { inputTokens: 5, outputTokens: 5 },
          stopReason: 'stop',
        };
      },
    };

    await executeTask(
      {
        root,
        task: 'describe @shot.png',
        mode: 'auto',
        config: config(),
        env: env(home),
        provider,
        fetchImpl: (async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      },
      sink,
    );

    expect(opening).toContain('"type":"image"');
    expect(opening).toContain('image/png');
  });

  it('ignores a mention that is not image-shaped', async () => {
    const root = tempDir('plato-images-root-');
    writeFileSync(join(root, 'notes.md'), '# hi');
    const result = await imageMentions('read @notes.md', root);
    expect(result.images).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
