import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * D49n. Two failure modes are being guarded here, and they are asymmetric.
 *
 * On the Anthropic side, adding the `image` member to CanonicalContent makes the
 * adapter's untyped `return { type: 'text', text: b.text }` fallthrough a
 * COMPILE error until a real branch exists — the compiler does the work.
 *
 * On the OpenAI side it does NOT: that adapter guards each block with an
 * explicit `b.type === 'text'`, so an image would fall through and be **silently
 * dropped**. The model would simply never mention the screenshot, and nothing
 * would report an error. Every test below that touches the OpenAI path exists
 * because the compiler is not watching it.
 */
const H = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: H.create, stream: H.stream };
  },
}));

import { AnthropicNativeProvider } from '../src/providers/anthropic-native.js';
import { createProvider } from '../src/providers/registry.js';
import { promptBreakdown, buildCompactPrompt } from '../src/runtime/context.js';
import { runAgentLoop } from '../src/runtime/loop.js';
import { AgentBus } from '../src/runtime/bus.js';
import { TranscriptWriter } from '../src/runtime/transcript.js';
import { readFileSync, readdirSync } from 'node:fs';
import type {
  CanonicalMessage,
  ChatProvider,
  ImageMime,
  TurnRequest,
  TurnResponse,
} from '../src/providers/types.js';

/** A recognisable stand-in for base64 image data. */
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG: ImageMime = 'image/png';

const anthropicTurn = (messages: CanonicalMessage[]): TurnRequest => ({
  model: 'anthropic:claude-sonnet-4-5',
  system: 'SYS',
  messages,
  tools: [],
  maxTokens: 100,
});

const REPLY = {
  content: [{ type: 'text', text: 'I see a one-pixel image.' }],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: 'end_turn',
};

const userWithImage = (): CanonicalMessage[] => [
  {
    role: 'user',
    content: [
      { type: 'image', mime: PNG, data: B64 },
      { type: 'text', text: 'what is this?' },
    ],
  },
];

describe('Anthropic image mapping (D49n)', () => {
  beforeEach(() => {
    H.create.mockReset();
    H.create.mockResolvedValue(REPLY);
  });

  it('maps an image block to a base64 image source', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(anthropicTurn(userWithImage()));
    const body = H.create.mock.calls[0]![0] as {
      messages: { role: string; content: Record<string, unknown>[] }[];
    };
    expect(body.messages[0]!.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: B64 },
    });
    // The text block is still a text block, in order.
    expect(body.messages[0]!.content[1]).toEqual({
      type: 'text',
      text: 'what is this?',
    });
  });

  it('still maps a text-only turn exactly as before', async () => {
    const p = new AnthropicNativeProvider('sk-test');
    await p.completeTurn(
      anthropicTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
    );
    const body = H.create.mock.calls[0]![0] as {
      messages: { content: unknown }[];
    };
    expect(body.messages[0]!.content).toEqual([{ type: 'text', text: 'hi' }]);
  });
});

describe('OpenAI-compatible image mapping (D49n)', () => {
  const mockFetch = (payload: unknown) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

  const ask = async (messages: CanonicalMessage[]) => {
    const f = mockFetch({ choices: [{ message: { content: 'ok' } }], usage: {} });
    const p = createProvider('openai', {
      apiKey: 'k',
      baseUrl: 'https://router.example/v1/',
      fetchImpl: f,
    });
    await p.completeTurn({
      model: 'openai:gpt-4o',
      system: 'SYS',
      messages,
      tools: [],
      maxTokens: 100,
    });
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    return (JSON.parse(String(init.body)) as { messages: Record<string, unknown>[] })
      .messages;
  };

  it('sends text and image together as one parts array', async () => {
    const messages = await ask(userWithImage());
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${B64}` } },
        { type: 'text', text: 'what is this?' },
      ],
    });
  });

  /**
   * The compatibility rule, not a style preference: older self-hosted servers
   * reject the parts array. A text-only turn must keep the bare-string form
   * byte for byte, so nothing changes for them just because images became
   * possible.
   */
  it('keeps a text-only turn as a bare string', async () => {
    const messages = await ask([
      { role: 'user', content: [{ type: 'text', text: 'plain' }] },
    ]);
    expect(messages[1]).toEqual({ role: 'user', content: 'plain' });
  });

  it('does not drop an image when a turn also has a tool result', async () => {
    // Images ride the opening turn, so this combination should not occur — but
    // silently losing one is the exact failure this adapter had, so it is
    // pinned rather than assumed.
    const messages = await ask([
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'c1', content: 'hits', isError: false },
          { type: 'image', mime: PNG, data: B64 },
        ],
      },
    ]);
    const kinds = messages.flatMap((m) =>
      Array.isArray(m['content'])
        ? (m['content'] as Record<string, unknown>[]).map((c) => c['type'])
        : [m['role'] === 'tool' ? 'tool_result' : 'text'],
    );
    expect(kinds).toContain('image_url');
    expect(kinds).toContain('tool_result');
  });
});

describe('context accounting for images (D49n)', () => {
  const tools = [{ name: 't', description: 'd', parameters: {} }];

  /**
   * The estimate is what decides when to compact, so base64 must never reach it:
   * chars/4 over a 1 MB screenshot is ~350,000 tokens, which would make the ring
   * — and the compaction trigger — a fiction.
   */
  it('counts a flat estimate, not the base64 length', () => {
    const without = promptBreakdown('sys', [
      { role: 'user', content: [{ type: 'text', text: 'x' }] },
    ], tools);
    const withImage = promptBreakdown('sys', userWithImage(), tools);
    // A ~100-char base64 string must not move the estimate by ~25 tokens; the
    // flat image cost dominates instead.
    expect(withImage.user).toBeGreaterThan(1_000);
    expect(withImage.user).toBeLessThan(5_000);
    expect(without.user).toBeLessThan(10);
  });

  // Before this branch existed the image fell into the tool_result path and
  // landed in the TOOL bucket, which is a different ring segment entirely.
  it('buckets an image as user, not as a tool result', () => {
    const b = promptBreakdown('sys', userWithImage(), tools);
    expect(b.tool).toBe(120); // just the per-tool overhead
    expect(b.user).toBeGreaterThan(1_000);
  });

  it('keeps base64 out of the compaction prompt', () => {
    const prompt = buildCompactPrompt(userWithImage());
    expect(prompt).not.toContain(B64);
    expect(prompt).toContain('[image image/png');
    // And the instruction text still makes it.
    expect(prompt).toContain('what is this?');
  });
});

describe('images reach the model but never the transcript (D49n)', () => {
  it('puts them in the opening user turn, not in the task', async () => {
    let first: TurnRequest | undefined;
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(req: TurnRequest): Promise<TurnResponse> {
        first ??= req;
        return {
          content: [{ type: 'text', text: 'seen' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    const bus = new AgentBus();
    const started: string[] = [];
    bus.on((e) => {
      if (e.type === 'run-started') started.push(e.task);
    });
    await runAgentLoop({
      root: process.cwd(),
      task: 'what is this?',
      getMode: () => 'edit' as const,
      approve: () => Promise.resolve(true),
      model: 'anthropic:claude-3-5-haiku-latest',
      provider: p,
      bus,
      images: [{ mime: PNG, data: B64 }],
    });

    const opening = first!.messages[0]!;
    expect(opening.role).toBe('user');
    expect(opening.content[0]).toEqual({ type: 'image', mime: PNG, data: B64 });
    expect(opening.content[1]).toEqual({ type: 'text', text: 'what is this?' });

    // The task string that the transcript records carries no base64.
    expect(started).toEqual(['what is this?']);
    expect(started[0]).not.toContain(B64);
  });

  /**
   * The leak check. `transcript.ts` writes every bus event verbatim, so if an
   * image ever reached the bus the JSONL would carry megabytes per run. This
   * asserts the bytes on disk say otherwise.
   */
  it('writes no base64 into the run transcript', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'plato-img-runs-'));
    const bus = new AgentBus();
    const writer = new TranscriptWriter(runsDir, { task: 't', root: '/x' });
    writer.attach(bus);
    const p: ChatProvider = {
      id: 'anthropic',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: 'seen' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await runAgentLoop({
      root: process.cwd(),
      task: 'what is this?',
      getMode: () => 'edit' as const,
      approve: () => Promise.resolve(true),
      model: 'anthropic:claude-3-5-haiku-latest',
      provider: p,
      bus,
      images: [{ mime: PNG, data: B64 }],
    });
    writer.close();

    const files = readdirSync(runsDir);
    expect(files).toHaveLength(1);
    const jsonl = readFileSync(join(runsDir, files[0]!), 'utf8');
    expect(jsonl).not.toContain(B64);
    expect(jsonl).toContain('what is this?');
  });
});
