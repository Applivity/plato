import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatProvider, Mode, TurnRequest, TurnResponse } from '@applivity/plato-core';
import type { PlatoConfig } from '../src/config.js';
import {
  createStreamSink,
  executeTask,
  runsDir,
  runTask,
  shortTarget,
  toolLine,
  type OutputFormat,
  type RunSink,
} from '../src/host.js';
import type { Prompter } from '../src/prompt.js';

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

interface ScriptStep {
  tool?: { name: string; input: Record<string, unknown> };
  text?: string;
}

function scripted(steps: ScriptStep[], onTurn?: (request: TurnRequest) => void): ChatProvider {
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

function environment(): Record<string, string> {
  const dir = tempDir('plato-cli-host-state-');
  return {
    PLATO_CONFIG_DIR: join(dir, 'config'),
    PLATO_DATA_DIR: join(dir, 'data'),
    PLATO_HOME: join(dir, 'home'),
    PLATO_DISABLE_KEYRING: '1',
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      input: Readable.from(['']),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/** Discovery is best-effort; the stub endpoint does not exist. */
const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

async function run(
  options: {
    root: string;
    env: Record<string, string>;
    mode: 'plan' | 'edit' | 'auto';
    format?: OutputFormat;
    provider: ChatProvider;
    model?: string;
  },
) {
  const io = capture();
  const code = await runTask({
    root: options.root,
    task: 'do the work',
    mode: options.mode,
    outputFormat: options.format ?? 'text',
    config: config(),
    env: options.env,
    io: io.io,
    provider: options.provider,
    fetchImpl: offline,
    ...(options.model === undefined ? {} : { model: options.model }),
  });
  return { code, out: io.out(), err: io.err() };
}

/** A sink for the direct `executeTask` tests; each answer is the safe one. */
function testSink(overrides: Partial<RunSink> = {}): RunSink {
  return {
    textDelta: () => {},
    textCommitted: () => {},
    tool: () => {},
    approve: async () => true,
    askUser: async (request) => request.questions.map(() => ''),
    stuck: async () => ({ action: 'stop' }),
    reveal: async () => false,
    notice: () => {},
    ...overrides,
  };
}

async function modeRun(options: {
  root: string;
  env: Record<string, string>;
  start: Mode;
  getMode: () => Mode;
  provider: ChatProvider;
  sink: RunSink;
}) {
  return executeTask(
    {
      root: options.root,
      task: 'do the work',
      mode: options.start,
      getMode: options.getMode,
      config: config(),
      env: options.env,
      provider: options.provider,
      fetchImpl: offline,
    },
    options.sink,
  );
}

function transcript(root: string, env: Record<string, string>): Record<string, unknown>[] {
  const dir = runsDir(root, env);
  const files = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  expect(files).toHaveLength(1);
  const raw = readFileSync(join(dir, files[0] ?? ''), 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('one-shot host', () => {
  it('runs a read, a write, and a shell command in auto mode', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'auto',
      provider: scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'hello-from-file' } } },
        { tool: { name: 'read_file', input: { path: 'note.txt' } } },
        { tool: { name: 'shell', input: { command: 'echo shell-ok' } } },
        { text: 'Done.' },
      ]),
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'note.txt'))).toBe(true);
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('hello-from-file');
    expect(result.out).toContain('Done.');
    expect(result.err).toContain('✓ writing a file');
    expect(result.err).toContain('✓ reading a file');
    expect(result.err).toContain('✓ running a command');
    expect(result.err).toContain('4 turns');
  });

  it('writes a transcript in the extension schema, without file content', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    await run({
      root,
      env,
      mode: 'auto',
      provider: scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'hello-from-file' } } },
        { text: 'Done.' },
      ]),
    });

    const files = readdirSync(runsDir(root, env)).filter((name) => name.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(runsDir(root, env), files[0] ?? ''), 'utf8');
    const lines = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines[0]).toMatchObject({
      kind: 'header',
      schemaVersion: 1,
      task: 'do the work',
      root,
      mode: 'auto',
    });
    expect(lines.some((line) => line['type'] === 'run-started')).toBe(true);
    expect(
      lines.some((line) => line['type'] === 'tool-event' && line['tool'] === 'write_file'),
    ).toBe(true);
    expect(raw).not.toContain('hello-from-file');
  });

  it('refuses a write in plan mode', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'plan',
      provider: scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'nope' } } },
        { text: 'I could not write.' },
      ]),
    });

    expect(existsSync(join(root, 'note.txt'))).toBe(false);
    expect(result.code).toBe(0);
    expect(result.err).toContain('✗ writing a file: note.txt (denied)');
    expect(result.out).toContain('I could not write.');
  });

  it('fails closed on an approval when there is no terminal', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'edit',
      provider: scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'nope' } } },
        { text: 'The write was refused.' },
      ]),
    });

    expect(existsSync(join(root, 'note.txt'))).toBe(false);
    expect(result.code).toBe(0);
    expect(result.err).toContain('No terminal to ask for approval');
    expect(result.err).toContain('--mode auto');
    expect(result.out).toContain('The write was refused.');
  });

  it('prints one JSON object for --output-format json', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'auto',
      format: 'json',
      provider: scripted([{ text: 'Done.' }]),
    });

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out) as Record<string, unknown>;
    expect(parsed['type']).toBe('result');
    expect(parsed['finalText']).toBe('Done.');
    expect(parsed['model']).toBe('stub:test-model');
    expect(parsed['reason']).toBe('complete');
  });

  it('prints one JSON object per line for --output-format stream-json', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'auto',
      format: 'stream-json',
      provider: scripted([{ text: 'Done.' }]),
    });

    const events = result.out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]?.['type']).toBe('start');
    expect(events.some((event) => event['type'] === 'text')).toBe(true);
    expect(events.at(-1)?.['type']).toBe('result');
    expect(events.at(-1)?.['finalText']).toBe('Done.');
  });

  it('stops before the run when a remote connection has no key', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const io = capture();
    const code = await runTask({
      root,
      task: 'do the work',
      mode: 'auto',
      outputFormat: 'text',
      config: {
        connections: [{ id: 'anthropic', kind: 'anthropic' }],
        model: 'anthropic:claude-sonnet-4-5',
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
        respectGitignore: false,
      },
      env,
      io: io.io,
      provider: scripted([{ text: 'never runs' }]),
      fetchImpl: offline,
    });

    expect(code).toBe(1);
    expect(io.err()).toContain("no key for anthropic. Run 'plato auth login anthropic'");
    expect(io.out()).toBe('');
  });

  it('refuses a write when the prompt closes instead of crashing', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const io = capture();
    const closed: Prompter = {
      ask: async () => {
        throw new Error('readline was closed');
      },
      secret: async () => {
        throw new Error('readline was closed');
      },
    };

    const code = await runTask({
      root,
      task: 'write the file',
      mode: 'edit',
      outputFormat: 'text',
      config: config(),
      env,
      io: { ...io.io, prompter: closed },
      provider: scripted([
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'x' } } },
        { text: 'The write was refused.' },
      ]),
      fetchImpl: offline,
    });

    expect(code).toBe(0);
    expect(existsSync(join(root, 'note.txt'))).toBe(false);
    expect(io.err()).toContain('treats that as No');
  });

  it('passes the .gitignore setting to the tools', async () => {
    const root = tempDir('plato-cli-host-root-');
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'vendor/\n');
    writeFileSync(join(root, 'vendor', 'lib.ts'), 'const needle = 1;\n');
    const env = environment();

    const search = async (respectGitignore: boolean) => {
      const io = capture();
      const code = await runTask({
        root,
        task: 'search',
        mode: 'auto',
        outputFormat: 'text',
        config: { ...config(), respectGitignore },
        env,
        io: io.io,
        provider: scripted([
          { tool: { name: 'grep', input: { pattern: 'needle' } } },
          { text: 'Done.' },
        ]),
        fetchImpl: offline,
      });
      return { code, err: io.err() };
    };

    const included = await search(false);
    expect(included.code).toBe(0);
    expect(included.err).toContain('paths that .gitignore excludes');

    const excluded = await search(true);
    expect(excluded.code).toBe(0);
    expect(excluded.err).not.toContain('paths that .gitignore excludes');
  });

  it('rejects a model that names no configured connection', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    const result = await run({
      root,
      env,
      mode: 'auto',
      model: 'missing:gpt-4o',
      provider: scripted([{ text: 'never runs' }]),
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain("the model 'missing:gpt-4o' is not available");
  });
});

describe('the mode request (D49cb)', () => {
  it('offers request_mode only to a sink that can answer it', async () => {
    const offered = async (sink: (root: string) => RunSink): Promise<string[]> => {
      const root = tempDir('plato-cli-host-root-');
      let tools: string[] = [];
      const provider = scripted([{ text: 'Done.' }], (request) => {
        tools = request.tools.map((tool) => tool.name);
      });
      await modeRun({
        root,
        env: environment(),
        start: 'plan',
        getMode: () => 'plan',
        provider,
        sink: sink(root),
      });
      return tools;
    };

    expect(await offered(() => testSink({ requestMode: async () => ({ ok: false, note: 'no' }) })))
      .toContain('request_mode');
    expect(await offered(() => testSink())).not.toContain('request_mode');
    // `plato -p` draws no card, so it must not advertise a request it cannot
    // answer — through the very sink the one-shot host builds.
    expect(await offered(() => createStreamSink(capture().io, 'text'))).not.toContain(
      'request_mode',
    );
  });

  it('asks the sink and records the answer, and the note reaches the model', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    let mode: Mode = 'plan';
    const asked: { mode: Mode; reason: string; current: Mode }[] = [];
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'request_mode',
            input: { mode: 'edit', reason: 'Plan mode cannot write the patch this fix needs.' },
          },
        },
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'after-switch' } } },
        { text: 'Done.' },
      ],
      (request) => {
        seen = JSON.stringify(request.messages);
      },
    );

    const result = await modeRun({
      root,
      env,
      start: 'plan',
      getMode: () => mode,
      provider,
      sink: testSink({
        requestMode: async (request) => {
          asked.push(request);
          mode = request.mode;
          return {
            ok: true,
            note: 'The user approved. Plato is now in edit mode. Continue the task.',
          };
        },
      }),
    });

    expect(result.reason).toBe('complete');
    expect(asked).toEqual([
      {
        mode: 'edit',
        reason: 'Plan mode cannot write the patch this fix needs.',
        current: 'plan',
      },
    ]);
    expect(seen).toContain('The user approved. Plato is now in edit mode.');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('after-switch');

    const lines = transcript(root, env);
    expect(
      lines.some(
        (line) =>
          line['type'] === 'mode-requested' &&
          line['from'] === 'plan' &&
          line['to'] === 'edit' &&
          line['approved'] === true,
      ),
    ).toBe(true);
    expect(
      lines.some(
        (line) =>
          line['type'] === 'mode-changed' &&
          line['from'] === 'plan' &&
          line['to'] === 'edit' &&
          line['via'] === 'request',
      ),
    ).toBe(true);
    // The reason is for the card; the record keeps the decision only.
    expect(JSON.stringify(lines)).not.toContain('Plan mode cannot write the patch');
  });

  it('reads the mode live: the same run retries the write and reaches the approval', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    let mode: Mode = 'plan';
    const approved: string[] = [];
    const provider = scripted([
      { tool: { name: 'write_file', input: { path: 'note.txt', content: 'retried' } } },
      {
        tool: {
          name: 'request_mode',
          input: { mode: 'edit', reason: 'The write needs edit mode.' },
        },
      },
      { tool: { name: 'write_file', input: { path: 'note.txt', content: 'retried' } } },
      { text: 'Done.' },
    ]);

    await modeRun({
      root,
      env,
      start: 'plan',
      getMode: () => mode,
      provider,
      sink: testSink({
        approve: async (request) => {
          approved.push(request.tool);
          return true;
        },
        requestMode: async (request) => {
          mode = request.mode;
          return { ok: true, note: 'The user approved. Plato is now in edit mode.' };
        },
      }),
    });

    // Plan refuses without asking; edit asks. One approval is the proof.
    expect(approved).toEqual(['write_file']);
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('retried');
  });

  it('leaves the mode alone on a decline and tells the model so', async () => {
    const root = tempDir('plato-cli-host-root-');
    const env = environment();
    let mode: Mode = 'plan';
    let seen = '';
    const provider = scripted(
      [
        {
          tool: {
            name: 'request_mode',
            input: { mode: 'edit', reason: 'The write needs edit mode.' },
          },
        },
        { tool: { name: 'write_file', input: { path: 'note.txt', content: 'nope' } } },
        { text: 'Declined.' },
      ],
      (request) => {
        seen = JSON.stringify(request.messages);
      },
    );

    await modeRun({
      root,
      env,
      start: 'plan',
      getMode: () => mode,
      provider,
      sink: testSink({
        requestMode: async () => ({
          ok: false,
          note: 'The user declined. Plato is still in plan mode. Do not ask again for edit in this run; say in one sentence what you would do if it were permitted, and continue with what this mode allows.',
        }),
      }),
    });

    expect(mode).toBe('plan');
    expect(existsSync(join(root, 'note.txt'))).toBe(false);
    expect(seen).toContain('The user declined. Plato is still in plan mode.');

    const lines = transcript(root, env);
    expect(
      lines.some(
        (line) => line['type'] === 'mode-requested' && line['approved'] === false,
      ),
    ).toBe(true);
    expect(lines.some((line) => line['type'] === 'mode-changed')).toBe(false);
  });
});

describe('the live tool trace', () => {
  it('says which file, pattern, or command a call is about', () => {
    expect(
      toolLine({
        tool: 'read_file',
        phase: 'allowed',
        args: { path: 'app/src/main/java/DriversLicenseViewModel.java' },
      }),
    ).toBe('→ reading a file: app/src/main/java/DriversLicenseViewModel.java');
    expect(toolLine({ tool: 'grep', phase: 'allowed', args: { pattern: 'Log\\.e\\(' } })).toBe(
      '→ searching: Log\\.e\\(',
    );
    expect(
      toolLine({ tool: 'grep', phase: 'allowed', args: { pattern: 'needle', glob: '**/*.java' } }),
    ).toBe('→ searching: needle in **/*.java');
    expect(toolLine({ tool: 'shell', phase: 'allowed', args: { command: 'pnpm build' } })).toBe(
      '→ running a command: pnpm build',
    );
  });

  it('confirms a call without repeating its target, and names the one that failed', () => {
    const args = { path: 'a.txt' };
    expect(toolLine({ tool: 'read_file', phase: 'done', ok: true, args })).toBe(
      '✓ reading a file',
    );
    expect(toolLine({ tool: 'read_file', phase: 'done', ok: false, args })).toBe(
      '✗ reading a file: a.txt',
    );
    expect(toolLine({ tool: 'grep', phase: 'refused', reason: 'protected file' })).toBe(
      '✗ searching (protected file)',
    );
  });

  it('names a tool it has no wording for by what it is doing, never by its identifier', () => {
    expect(toolLine({ tool: 'mcp__jira__create_issue', phase: 'allowed', args: { summary: 'x' } })).toBe(
      '→ using a tool',
    );
  });

  it('summarises a multi-file patch by its paths, not its contents', () => {
    expect(
      toolLine({
        tool: 'apply_patch',
        phase: 'allowed',
        args: {
          patches: [
            { path: 'a.java', diffs: [{ search: 'secret-marker', replace: 'x' }] },
            { path: 'b.java', diffs: [] },
          ],
        },
      }),
    ).toBe('→ editing files: a.java, b.java');
  });

  it('keeps a long target short, and keeps the end of a path', () => {
    const path = `app/src/main/java/com/localgsa/hcad/activities/${'deep/'.repeat(8)}LicenseScannerActivity.java`;
    const shown = shortTarget(path);
    expect(shown.length).toBeLessThanOrEqual(60);
    expect(shown.endsWith('LicenseScannerActivity.java')).toBe(true);
    expect(shortTarget('line one\nline two')).toBe('line one line two');
  });
});

describe('the worker is told about its team', () => {
  it('names the watcher that started, so the model cannot claim the team is blind', async () => {
    const root = tempDir('plato-cli-team-root-');
    let workerSystem = '';
    const worker = scripted([{ text: 'Done.' }], (request) => {
      workerSystem = request.system;
    });
    const observer: ChatProvider = {
      id: 'openai',
      async completeTurn(): Promise<TurnResponse> {
        return {
          content: [{ type: 'text', text: '{"action":"noop"}' }],
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'stop',
        };
      },
    };
    await executeTask(
      {
        root,
        task: 'do the work',
        mode: 'edit',
        config: { ...config(), team: 'duo' },
        env: environment(),
        provider: worker,
        observerProvider: () => observer,
        fetchImpl: offline,
      },
      testSink(),
    );
    expect(workerSystem).toContain('1 philosopher (Aristotle) is watching this run');
    expect(workerSystem).toContain('same Plato process');
  });
});
