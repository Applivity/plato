import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { shortCwd, welcomeLayout } from '../src/tui/Welcome.js';

describe('the welcome screen', () => {
  it('picks the widest form that fits, and never a banner bigger than the window', () => {
    expect(welcomeLayout(100, 40)).toBe('side');
    expect(welcomeLayout(80, 28)).toBe('side');
    // 80x24 is the size the owl was fitted to, with the path line dropped.
    expect(welcomeLayout(80, 24)).toBe('side');
    // Below that the wordmark gets the room rather than a banner that hides the prompt.
    expect(welcomeLayout(80, 23)).toBe('wordmark');
    expect(welcomeLayout(68, 24)).toBe('side');
    // Two columns of slack: a line exactly as wide as the window can wrap.
    expect(welcomeLayout(67, 24)).toBe('wordmark');
    expect(welcomeLayout(65, 40)).toBe('wordmark');
    expect(welcomeLayout(37, 40)).toBe('wordmark');
    expect(welcomeLayout(36, 40)).toBe('line');
    expect(welcomeLayout(30, 40)).toBe('line');
  });

  it('shows the home directory as ~ and keeps the end of a long path', () => {
    expect(shortCwd(`${homedir()}/Desktop/plato`)).toBe('~/Desktop/plato');
    expect(shortCwd('/var/tmp/x')).toBe('/var/tmp/x');
    const deep = `${homedir()}/a/${'very/'.repeat(12)}project`;
    const shown = shortCwd(deep);
    expect(shown.length).toBeLessThanOrEqual(44);
    expect(shown.startsWith('~/a/')).toBe(true);
    expect(shown.endsWith('project')).toBe(true);
    expect(shown).toContain('…');
  });
});
