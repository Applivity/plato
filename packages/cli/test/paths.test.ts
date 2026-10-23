import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { configDir, dataDir, platoHome } from '../src/paths.js';

/**
 * M0 (D49cf). The platform is an argument, so the Windows roots are proven
 * here; the Windows machine worker proves the real directories.
 */
describe('Windows paths', () => {
  it('puts settings under %APPDATA%\\Plato', () => {
    const env = { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
    expect(configDir(env, 'win32')).toBe(join(env.APPDATA, 'Plato'));
  });

  it('puts data under %LOCALAPPDATA%\\Plato', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    expect(dataDir(env, 'win32')).toBe(join(env.LOCALAPPDATA, 'Plato'));
  });

  it('keeps the XDG roots on macOS and Linux', () => {
    expect(configDir({}, 'darwin')).toContain('.config');
    expect(dataDir({}, 'linux')).toContain(join('.local', 'share'));
  });

  it('still lets an explicit directory win', () => {
    expect(configDir({ PLATO_CONFIG_DIR: '/tmp/cfg' }, 'win32')).toBe('/tmp/cfg');
    expect(dataDir({ PLATO_DATA_DIR: '/tmp/data' }, 'win32')).toBe('/tmp/data');
  });

  it('shares ~/.plato with the extension on every platform', () => {
    expect(platoHome({ PLATO_HOME: '/shared' })).toBe('/shared');
    expect(platoHome({})).toContain('.plato');
  });
});
