import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run, VERSION } from '../src/cli.js';

async function runWith(argv: readonly string[], input = '') {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    input: Readable.from([input]),
  });
  return { code, out: out.join(''), err: err.join('') };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function isolatedConfig(): void {
  vi.stubEnv('PLATO_CONFIG_DIR', mkdtempSync(join(tmpdir(), 'plato-cli-args-')));
}

describe('command line', () => {
  it('prints the version for --version and -v', async () => {
    for (const flag of ['--version', '-v']) {
      const result = await runWith([flag]);
      expect(result.code).toBe(0);
      expect(result.out.trim()).toBe(VERSION);
      expect(result.err).toBe('');
    }
  });

  it('keeps VERSION in step with package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('prints help for --help, -h, a bare invocation, and the help command', async () => {
    for (const argv of [['--help'], ['-h'], [], ['help']]) {
      const result = await runWith(argv);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Usage');
      expect(result.out).toContain('--version');
      expect(result.err).toBe('');
    }
  });

  it('lists every command in help', async () => {
    const result = await runWith(['--help']);
    for (const command of ['auth', 'models', 'doctor']) {
      expect(result.out).toContain(command);
    }
  });

  it('rejects an unknown command with exit code 2', async () => {
    const result = await runWith(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toContain("unknown command 'frobnicate'");
    expect(result.err).toContain("'plato --help'");
  });

  it('rejects an unknown option with exit code 2', async () => {
    const result = await runWith(['--frobnicate']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('plato:');
    expect(result.err).toContain("'plato --help'");
  });

  it('passes subcommands through to their help', async () => {
    const result = await runWith(['auth', '--help']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('plato auth login');
  });

  it('rejects an unknown team before running', async () => {
    isolatedConfig();
    const result = await runWith(['-p', 'x', '--team', 'trio']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--team must be 'solo', 'duo', or 'academy'");
  });

  it('needs a terminal for an interactive team', async () => {
    isolatedConfig();
    const result = await runWith(['--team', 'duo']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('interactive terminal');
    expect(result.err).toContain('-p');
  });
});
