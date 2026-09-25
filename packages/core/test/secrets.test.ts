import { describe, expect, it } from 'vitest';
import { isSecretPath } from '../src/security/secrets.js';

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
