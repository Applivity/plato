import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandInvocation,
  isWindows,
  mergeEnv,
  resolveCommand,
  shellInvocation,
  taskkillArgs,
} from '../src/tools/shellPlatform.js';

/**
 * M0 (D49cf). Every function takes the platform, so the Windows branches are
 * proven here on a Mac; the Windows machine worker proves the real spawns.
 */
describe('shell invocation', () => {
  it('runs a command through bash -c on POSIX', () => {
    expect(shellInvocation('git status', { platform: 'darwin' })).toEqual({
      file: '/bin/bash',
      args: ['-c', 'git status'],
    });
  });

  it('runs a command through %ComSpec% on Windows, keeping the line whole', () => {
    expect(
      shellInvocation('dir /b', {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
      }),
    ).toEqual({
      file: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '"dir /b"'],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  });

  it('keeps quotes inside the command intact', () => {
    const call = shellInvocation('echo "hi" > out.txt', { platform: 'win32', env: {} });
    // One outer pair, which `/s` strips; the inner pair is the command's own.
    expect(call.args[3]).toBe('"echo "hi" > out.txt"');
  });

  it('falls back to cmd.exe when ComSpec is unset', () => {
    expect(shellInvocation('dir', { platform: 'win32', env: {} }).file).toBe('cmd.exe');
  });

  it('names the platform', () => {
    expect(isWindows('win32')).toBe(true);
    expect(isWindows('darwin')).toBe(false);
    expect(isWindows('linux')).toBe(false);
  });
});

describe('process-tree kill', () => {
  it('asks taskkill for the tree, forcefully', () => {
    expect(taskkillArgs(4321)).toEqual(['/PID', '4321', '/T', '/F']);
  });
});

describe('command resolution on Windows', () => {
  function pathWith(file: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'plato-path-'));
    writeFileSync(join(dir, file), '');
    return dir;
  }

  it('leaves the command alone on POSIX', () => {
    expect(resolveCommand('npx', { platform: 'darwin', env: {} })).toBe('npx');
  });

  it('finds npx.cmd on PATH for a bare name', () => {
    const dir = pathWith('npx.cmd');
    const resolved = resolveCommand('npx', {
      platform: 'win32',
      env: { PATH: dir, PATHEXT: '.cmd' },
    });
    expect(resolved).toBe(join(dir, 'npx.cmd'));
  });

  it('does not invent a path when nothing matches', () => {
    expect(
      resolveCommand('missing-tool', { platform: 'win32', env: { PATH: '', PATHEXT: '.cmd' } }),
    ).toBe('missing-tool');
  });

  it('keeps a name that already carries an extension', () => {
    expect(
      resolveCommand('npx.cmd', { platform: 'win32', env: { PATHEXT: '.cmd' } }),
    ).toBe('npx.cmd');
  });

  it('adds the extension to a path that was written without one', () => {
    const dir = pathWith('tool.cmd');
    expect(
      resolveCommand(join(dir, 'tool'), {
        platform: 'win32',
        env: { PATHEXT: '.cmd' },
      }),
    ).toBe(join(dir, 'tool.cmd'));
  });
});

describe('spawning a .cmd shim', () => {
  it('goes through cmd.exe with a quoted line', () => {
    expect(
      commandInvocation('C:\\tools\\npx.cmd', ['-y', 'server'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' },
      }),
    ).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\tools\\npx.cmd" "-y" "server""'],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  });

  it('quotes an argument that carries a space', () => {
    const call = commandInvocation('npx.cmd', ['--dir', 'C:\\my tools'], {
      platform: 'win32',
      env: {},
    });
    expect(call.args[3]).toBe('""npx.cmd" "--dir" "C:\\my tools""');
  });

  it('spawns an .exe directly, without the shell', () => {
    expect(
      commandInvocation('C:\\tools\\server.exe', ['--port', '1'], { platform: 'win32' }),
    ).toEqual({ file: 'C:\\tools\\server.exe', args: ['--port', '1'] });
  });

  it('never rewrites a POSIX command', () => {
    expect(commandInvocation('/usr/bin/npx', ['-y'], { platform: 'linux' })).toEqual({
      file: '/usr/bin/npx',
      args: ['-y'],
    });
  });
});

describe('environment merging', () => {
  it('replaces a differently-cased key on Windows', () => {
    const merged = mergeEnv({ Path: 'old', HOME: 'h' }, { PATH: 'new' }, 'win32');
    expect(merged['PATH']).toBe('new');
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH']);
    expect(merged['HOME']).toBe('h');
  });

  it('keeps both spellings where the platform is case-sensitive', () => {
    const merged = mergeEnv({ Path: 'old' }, { PATH: 'new' }, 'darwin');
    expect(merged['Path']).toBe('old');
    expect(merged['PATH']).toBe('new');
  });
});
