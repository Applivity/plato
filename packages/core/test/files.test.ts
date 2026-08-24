import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorkspaceFiles } from '../src/tools/files.js';

function makeTempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'plato-walker-'));
  const app = join(root, 'app');
  const nested = join(root, 'app', 'src', 'main');
  const build = join(root, 'app', 'build');
  const git = join(root, '.git');
  mkdirSync(nested, { recursive: true });
  mkdirSync(build, { recursive: true });
  mkdirSync(git, { recursive: true });

  writeFileSync(join(root, 'settings.gradle'), '// root\n');
  writeFileSync(join(app, 'build.gradle'), '// app\n');
  writeFileSync(join(nested, 'MainActivity.java'), 'class X {}\n');
  writeFileSync(join(build, 'output.apk'), 'BINARY');
  writeFileSync(join(git, 'config'), '[core]\n');
  writeFileSync(join(root, '.env.local'), 'SECRET=1');
  writeFileSync(join(root, 'keystore.properties'), 'storePassword=x');

  return root;
}

describe('listWorkspaceFiles', () => {
  it('walks depth-first and returns relative paths', () => {
    const root = makeTempTree();
    const files = listWorkspaceFiles(root);
    expect(files).toEqual([
      'settings.gradle',
      'app/build.gradle',
      'app/src/main/MainActivity.java',
    ]);
  });

  it('excludes .git, node_modules, dist, out, build dirs', () => {
    const root = makeTempTree();
    const files = listWorkspaceFiles(root);
    expect(files.join('\n')).not.toContain('build/');
    expect(files.join('\n')).not.toContain('.git/config');
    // 'build.gradle' is a FILE and must survive the 'build' dir exclusion
    expect(files).toContain('app/build.gradle');
  });

  it('never lists secret deny-list files', () => {
    const root = makeTempTree();
    const files = listWorkspaceFiles(root);
    expect(files.some((f) => f.includes('keystore.properties'))).toBe(
      false
    );
    expect(files.some((f) => f.includes('.env.local'))).toBe(false);
  });

  it('returns empty list for a missing root', () => {
    expect(listWorkspaceFiles('/definitely/not/here')).toEqual([]);
  });
});
