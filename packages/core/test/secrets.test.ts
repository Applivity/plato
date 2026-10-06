import { describe, expect, it } from 'vitest';
import { isSecretPath, mentionsSecretPath } from '../src/security/secrets.js';

describe('isSecretPath', () => {
  it('flags the explicit deny-list names', () => {
    expect(isSecretPath('keystore.properties')).toBe(true);
    expect(isSecretPath('local.properties')).toBe(true);
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('app.keystore')).toBe(true);
    expect(isSecretPath('release.jks')).toBe(true);
  });

  it('matches on basename only (any directory)', () => {
    expect(isSecretPath('app/keystore.properties')).toBe(true);
    expect(
      isSecretPath('deep/nested/dir/local.properties')
    ).toBe(true);
    expect(isSecretPath('C:\\proj\\.env')).toBe(true);
  });

  it('covers .env variants', () => {
    expect(isSecretPath('.env.staging')).toBe(true);
    expect(isSecretPath('config/.env.production')).toBe(true);
  });

  it('does not flag safe files', () => {
    expect(isSecretPath('src/index.ts')).toBe(false);
    expect(isSecretPath('build.gradle')).toBe(false);
    expect(isSecretPath('gradle.properties')).toBe(false);
    expect(isSecretPath('settings.gradle')).toBe(false);
    expect(isSecretPath('package.json')).toBe(false);
    expect(isSecretPath('environment.ts')).toBe(false);
    expect(isSecretPath('.envrc.example.md')).toBe(false);
    expect(isSecretPath('keystore.properties.bak')).toBe(false);
  });

  it('handles empty and dot segments safely', () => {
    expect(isSecretPath('')).toBe(false);
    expect(isSecretPath('.env/child.txt')).toBe(false); // dir named .env is not the file
  });
});

/**
 * D49ai, extended by D49be. The plain case (`cat keystore.properties`) was the
 * hole D49ai closed. The QUOTED case is the one D49be closes: a splitter sees
 * `key`, `store`, `properties` where bash sees one word, so the check has to
 * read the command the way bash will.
 */
describe('mentionsSecretPath', () => {
  it('flags a protected name written plainly in a command', () => {
    expect(mentionsSecretPath('cat keystore.properties')).toBe(true);
    expect(mentionsSecretPath('cat app/keystore.properties')).toBe(true);
    expect(mentionsSecretPath('grep -r KEY local.properties')).toBe(true);
  });

  /**
   * The defect this decision exists for, in three spellings. bash concatenates
   * adjacent quoted and unquoted runs into ONE word, so each of these opens
   * `keystore.properties` / `.env` — and each of them splits into harmless words
   * for anything that only reads the text.
   */
  it('flags a name that QUOTING has taken apart (D49be)', () => {
    expect(mentionsSecretPath("cat key'store'.properties")).toBe(true);
    expect(mentionsSecretPath('cat key"store".properties')).toBe(true);
    expect(mentionsSecretPath("cat keystore'.propertie's")).toBe(true);
    expect(mentionsSecretPath("cat .en'v'")).toBe(true);
  });

  it('flags a wholly quoted name, which the text scan also caught', () => {
    expect(mentionsSecretPath("cat 'keystore.properties'")).toBe(true);
  });

  /**
   * Unioned, not swapped: the tokenizer answers `null` for a command it does not
   * model, and the check must not start catching LESS than it did before.
   */
  it('still catches the plain name in a command the tokenizer refuses', () => {
    // The backslash makes `tokenize` refuse the command entirely.
    expect(mentionsSecretPath('cat \\keystore.properties')).toBe(true);
  });

  it('does not flag commands that name nothing protected', () => {
    expect(mentionsSecretPath('npm run build')).toBe(false);
    expect(mentionsSecretPath('cat README.md')).toBe(false);
    expect(mentionsSecretPath('git status --short')).toBe(false);
    // A token that merely CONTAINS the letters is not the file.
    expect(mentionsSecretPath('cat keystore.properties.bak')).toBe(false);
    // Unquoting must not invent words either: two separate arguments stay two.
    expect(mentionsSecretPath('cat key store.properties')).toBe(false);
  });
});
