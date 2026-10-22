import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitignored, listWorkspace, listWorkspaceFiles } from '../src/tools/files.js';

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

  describe('the repository’s own .gitignore', () => {
    function ignoredTree(root: string): void {
      writeFileSync(
        join(root, '.gitignore'),
        ['vendor/', '*.log', '!keep.log', '/local-only.txt', ''].join('\n'),
      );
      mkdirSync(join(root, 'vendor', 'pkg'), { recursive: true });
      writeFileSync(join(root, 'vendor', 'pkg', 'x.go'), 'package pkg\n');
      writeFileSync(join(root, 'debug.log'), 'noise\n');
      writeFileSync(join(root, 'keep.log'), 'wanted\n');
      writeFileSync(join(root, 'local-only.txt'), 'mine\n');
      writeFileSync(join(root, 'src.log'), 'noise\n');
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'deep.log'), 'noise\n');
      writeFileSync(join(root, 'src', 'real.java'), 'class R {}\n');
    }

    it('drops ignored files and directories, and keeps a negation, when asked to', () => {
      const root = makeTempTree();
      ignoredTree(root);
      const files = listWorkspaceFiles(root, '', { respectGitignore: true });
      expect(files).toContain('keep.log');
      expect(files).toContain('src/real.java');
      expect(files).not.toContain('debug.log');
      expect(files).not.toContain('src/deep.log');
      expect(files).not.toContain('local-only.txt');
      expect(files.some((f) => f.startsWith('vendor/'))).toBe(false);
    });

    it('applies a nested .gitignore only inside its directory', () => {
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), '');
      writeFileSync(join(root, 'app', '.gitignore'), '/generated\n');
      mkdirSync(join(root, 'app', 'generated'), { recursive: true });
      writeFileSync(join(root, 'app', 'generated', 'R.java'), 'class R {}\n');
      mkdirSync(join(root, 'other', 'generated'), { recursive: true });
      writeFileSync(join(root, 'other', 'generated', 'R.java'), 'class R {}\n');
      const files = listWorkspaceFiles(root, '', { respectGitignore: true });
      expect(files).not.toContain('app/generated/R.java');
      expect(files).toContain('other/generated/R.java');
    });

    it('honours a root .gitignore when the walk starts in a subdirectory', () => {
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), '*.tmp\n');
      writeFileSync(join(root, 'app', 'scratch.tmp'), 'x\n');
      writeFileSync(join(root, 'app', 'kept.txt'), 'x\n');
      const inside = listWorkspaceFiles(root, 'app', { respectGitignore: true });
      expect(inside).not.toContain('app/scratch.tmp');
      expect(inside).toContain('app/kept.txt');
    });

    it('is OFF by default, and reports what it saw', () => {
      // D49bz: an agent that silently misses a file its owner ignored is worse
      // than one that sees noise. The default listing includes it and NAMES it.
      const root = makeTempTree();
      ignoredTree(root);
      const listing = listWorkspace(root);
      expect(listing.files).toContain('debug.log');
      expect(listing.files.some((f) => f.startsWith('vendor/'))).toBe(true);
      expect(listing.ignored.has('debug.log')).toBe(true);
      expect(listing.ignored.has('vendor/pkg/x.go')).toBe(true);
      expect(listing.ignored.has('src/real.java')).toBe(false);
      expect(listing.ignored.has('keep.log')).toBe(false);
    });

    it('reports nothing as ignored when the switch is on, because nothing is there', () => {
      const root = makeTempTree();
      ignoredTree(root);
      const listing = listWorkspace(root, '', { respectGitignore: true });
      expect(listing.ignored.size).toBe(0);
      expect(listing.files).not.toContain('debug.log');
    });

    it('answers about one path, for the tools that name a file', () => {
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), 'local.properties\nbuild/\n');
      writeFileSync(join(root, 'local.properties'), 'sdk.dir=/x\n');
      expect(isGitignored(root, 'local.properties')).toBe(true);
      expect(isGitignored(root, 'settings.gradle')).toBe(false);
      expect(isGitignored(root, 'app/build/out.apk')).toBe(true);
    });

    it('keeps a file excluded when its directory is excluded, whatever a later rule says', () => {
      // git: "It is not possible to re-include a file if a parent directory of
      // that file is excluded." Verified against git 2.50.
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), 'vendor/\n!vendor/lib.go\n');
      mkdirSync(join(root, 'vendor'), { recursive: true });
      writeFileSync(join(root, 'vendor', 'lib.go'), 'x\n');
      writeFileSync(join(root, 'vendor', '.gitignore'), '!lib.go\n');
      expect(isGitignored(root, 'vendor/lib.go')).toBe(true);
      expect(listWorkspace(root).ignored.has('vendor/lib.go')).toBe(true);
    });

    it('brings a directory and its contents back when the directory itself is re-included', () => {
      // `build/*` excludes the entries, `!build/keep/` re-includes the folder —
      // which git does honour, and which must not be confused with the rule above.
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), 'generated/*\n!generated/keep/\n');
      mkdirSync(join(root, 'generated', 'keep'), { recursive: true });
      mkdirSync(join(root, 'generated', 'gone'), { recursive: true });
      writeFileSync(join(root, 'generated', 'keep', 'x.java'), 'x\n');
      writeFileSync(join(root, 'generated', 'gone', 'y.java'), 'y\n');
      expect(isGitignored(root, 'generated/keep/x.java')).toBe(false);
      expect(isGitignored(root, 'generated/gone/y.java')).toBe(true);
    });

    it('still lets the secret map see a protected file git ignores', () => {
      const root = makeTempTree();
      writeFileSync(join(root, '.gitignore'), 'local.properties\n');
      writeFileSync(join(root, 'local.properties'), 'sdk.dir=/x\n');
      expect(
        listWorkspaceFiles(root, '', { includeSecret: true, respectGitignore: false }),
      ).toContain('local.properties');
    });
  });
});
