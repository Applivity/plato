/**
 * D49bc: the protected file Plato cannot mask, and the secret map filled at run
 * start.
 *
 * Two decisions are pinned here, and each one is the answer to a failure:
 *
 * 1. **"Cannot be masked" is two different files.** A keystore stays refused —
 *    showing it is useless AND the whole content is the secret, so a card would
 *    offer a bad deal behind a reasonable-looking button. TEXT the masker merely
 *    cannot parse is offered, because the only reason for the refusal is the
 *    masker's own limits. Telling them apart is a UTF-8 decode, so the split is
 *    deterministic: no model, no guess, no regex zoo.
 * 2. **The scrub only knows what the session has SEEN** — which is why an
 *    indirectly reached value (`cat local.propert*` in `auto`) walks out of a
 *    protected file that was never read through `read_file`. Reading the
 *    workspace's protected files once, at run start, closes the class.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool } from '../src/tools/execute.js';
import { createVault, isPlainText, placeholder } from '../src/security/mask.js';
import { allowPathError, protectNameError } from '../src/security/secrets.js';
import { declinedRevealRefusal, revealCard, revealedFileNotice } from '../src/runtime/secretCopy.js';
import { seedVault } from '../src/runtime/seedVault.js';
import { readMatching } from './portable.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'plato-reveal-'));
}

/** A one-line JSON blob: valid text, and no line `maskText` can account for. */
const BLOB = '{"API_KEY":"sk-live-blob-0001","DB_URL":"postgres://blob/db"}';

/** A real keystore: not UTF-8, and not text at all. */
const OPAQUE = Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0x00, 0x07, 0x41, 0x80, 0x81]);

describe('telling the two unmaskable files apart (D49bc)', () => {
  it('calls a UTF-8 config file text', () => {
    expect(isPlainText(Buffer.from('API_KEY=abc\n', 'utf8'))).toBe(true);
    expect(isPlainText(Buffer.from('KEY=héllo wörld\n', 'utf8'))).toBe(true);
    expect(isPlainText(Buffer.from('', 'utf8'))).toBe(true);
  });

  it('does not call a keystore text', () => {
    // The decode is the test, and it must be FATAL: a lossy decode turns every
    // bad byte into U+FFFD and would call this file text.
    expect(isPlainText(OPAQUE)).toBe(false);
    // UTF-8 permits a NUL, but no config file Plato masks holds one.
    expect(isPlainText(Buffer.from([0x41, 0x00, 0x42]))).toBe(false);
  });
});

describe('a protected text file the masker cannot parse', () => {
  it('is OFFERED, and shown in full when the user says yes', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const vault = createVault();
    const asked: string[] = [];
    const r = await executeTool(
      root,
      'read_file',
      { path: 'secrets.json' },
      {
        vault,
        revealProtected: (rel) => {
          asked.push(rel);
          return Promise.resolve(true);
        },
      },
    );
    expect(asked).toEqual(['secrets.json']);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('sk-live-blob-0001');
    expect(r.output).toContain('Plato showed this file in full');
    // The one rule the notice carries, because the model now holds the values.
    expect(r.output).toContain('Do not write a value from this file into another file.');
  });

  it('is REFUSED when the user says no, and the refusal names the choice', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const r = await executeTool(
      root,
      'read_file',
      { path: 'secrets.json' },
      { vault: createVault(), revealProtected: () => Promise.resolve(false) },
    );
    expect(r.ok).toBe(false);
    expect(r.output).toBe(declinedRevealRefusal('secrets.json'));
    expect(r.output).toContain('chose not to show it in full');
    expect(r.output).not.toContain('sk-live-blob-0001');
  });

  it('is refused the old way when nothing can ask', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const r = await executeTool(root, 'read_file', { path: 'secrets.json' }, { vault: createVault() });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('cannot mask it');
  });
});

describe('an opaque protected file is never offered', () => {
  it('refuses, and never asks', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'release.jks'), OPAQUE);
    let asked = 0;
    const r = await executeTool(
      root,
      'read_file',
      { path: 'release.jks' },
      {
        vault: createVault(),
        revealProtected: () => {
          asked += 1;
          return Promise.resolve(true);
        },
      },
    );
    // The card is the part under test. Offering one here would put "show it"
    // in front of a user for a file whose whole content is the secret.
    expect(asked).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('cannot mask it');
  });
});

describe('a file the user chose to show', () => {
  it('takes a diff written against the RAW text, and needs no un-masking', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const vault = createVault();
    const reveal = (): Promise<boolean> => Promise.resolve(true);
    await executeTool(root, 'read_file', { path: 'secrets.json' }, { vault, revealProtected: reveal });

    const r = await executeTool(
      root,
      'apply_diff',
      {
        path: 'secrets.json',
        // The model was shown the real text, so its SEARCH is the real text.
        diffs: [{ search: 'sk-live-blob-0001', replace: 'sk-live-blob-0002' }],
      },
      { vault, revealProtected: reveal },
    );
    expect(r.ok).toBe(true);
    const onDisk = readFileSync(join(root, 'secrets.json'), 'utf8');
    expect(onDisk).toContain('sk-live-blob-0002');
    expect(onDisk).not.toContain('«masked:');
  });

  it('records the real before-text for undo, never the shown text', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const caps: { rel: string; before: string | null }[] = [];
    const reveal = (): Promise<boolean> => Promise.resolve(true);
    await executeTool(
      root,
      'apply_diff',
      {
        path: 'secrets.json',
        diffs: [{ search: 'blob-0001', replace: 'blob-0002' }],
      },
      {
        vault: createVault(),
        revealProtected: reveal,
        recordWrites: (c) => caps.push(...c.map((x) => ({ rel: x.rel, before: x.before }))),
      },
    );
    expect(caps).toHaveLength(1);
    // The undo copy must hold the REAL text. Recording the shown text would be
    // the same text here, but recording a MASKED before-text on the other path
    // is the trap this pins: undo would then replace the file with placeholders.
    expect(caps[0]!.before).toBe(BLOB);
  });
});

describe('the card the user answers', () => {
  it('names the file, the consequence, and the way out', () => {
    const c = revealCard('secrets.json');
    const all = [c.title, ...c.lines, c.cost, c.confirm, c.cancel].join('\n');
    expect(all).toContain('secrets.json');
    // The consequence has to be on the card: finding it out after the click is
    // what makes a security prompt dishonest. It is its own field, so the view
    // cannot lose the emphasis by reordering the prose.
    expect(c.cost).toContain('every value in this file goes into this conversation');
    expect(c.cost).toContain('Plato cannot hide the values afterwards');
    expect(c.lines.join('\n')).not.toContain('goes into this conversation');
    // And the permanent alternative, so nobody clicks yes for want of a setting
    // they were never told about.
    expect(all).toContain('plato.secrets.allow');
    expect(c.confirm).toBe('Show it this session');
    expect(c.cancel).toBe('Cancel');
  });

  it('the notice in the file names the rule that keeps the values in place', () => {
    expect(revealedFileNotice('a/b.json')).toContain('a/b.json is protected');
    expect(revealedFileNotice('a/b.json')).toContain('Do not write a value');
  });
});

describe('the settings the panel writes (D49bc)', () => {
  it('accepts the name patterns the matcher understands', () => {
    for (const ok of ['*.pem', '.env.*', 'secrets.json', 'id_rsa', 'secrets.*']) {
      expect(protectNameError(ok)).toBeNull();
    }
  });

  it('refuses an entry that could never match, rather than saving it silently', () => {
    // A name with a `/` protects NOTHING: the matcher compares the last segment.
    expect(protectNameError('app/config/*.jks')).toContain('not a path');
    // A `*` in the middle is not a pattern this matcher knows.
    expect(protectNameError('a*b.pem')).toContain('start or the end');
    expect(protectNameError('*a*b*')).toContain('one "*" at most');
    expect(protectNameError('   ')).toContain('Enter a file name');
  });

  it('refuses a wildcard exception, which is the asymmetry that protects', () => {
    expect(allowPathError('local.properties')).toBeNull();
    expect(allowPathError('app/.env.example')).toBeNull();
    expect(allowPathError('*.env')).toContain('not allowed');
    expect(allowPathError('/etc/passwd')).toContain('workspace root');
    expect(allowPathError('')).toContain('Enter a path');
  });
});

describe('the secret map filled at run start (D49bc)', () => {
  it('hides a value a command reached INDIRECTLY, without any read', async () => {
    const root = tempRoot();
    // `local.properties` is protected by EXACT name, so a command that reads it
    // by PREFIX is not that name: the token scan sees `local.propert` and lets
    // it through. This is the whole hole, in one line. (`readMatching` is the
    // portable spelling: `cat local.propert*` needs bash.)
    writeFileSync(join(root, 'local.properties'), 'sdk.dir=/opt/sdk\napiKey=sk-live-indirect-0001\n');
    const vault = createVault();

    const r = await executeTool(root, 'shell', { command: readMatching('local.propert') }, { vault });
    expect(r.ok).toBe(true);
    // Nothing read it, so before seeding this printed the value.
    expect(r.output).toContain('sk-live-indirect-0001');

    await seedVault(root, vault);
    const after = await executeTool(root, 'shell', { command: readMatching('local.propert') }, { vault });
    expect(after.output).not.toContain('sk-live-indirect-0001');
    expect(after.output).toContain(placeholder('apiKey'));
  });

  it('counts what it read, and reads nothing that is not protected', async () => {
    const root = tempRoot();
    writeFileSync(join(root, '.env'), 'A=sk-live-one-0001\n');
    writeFileSync(join(root, 'notes.txt'), 'B=not-a-secret-value\n');
    const vault = createVault();
    const r = await seedVault(root, vault);
    expect(r.files).toBe(1);
    expect(r.values).toBe(1);
    expect(vault.size()).toBe(1);
  });

  it('skips a protected file it cannot account for, and never guesses', async () => {
    const root = tempRoot();
    writeFileSync(join(root, 'release.jks'), OPAQUE);
    writeFileSync(join(root, 'secrets.json'), BLOB);
    const vault = createVault();
    const r = await seedVault(root, vault);
    // Neither file contributes: the keystore is not text, and the blob has no
    // line the masker can account for. Guessing at either would put a value the
    // masker refused into the map.
    expect(r.files).toBe(0);
    expect(vault.size()).toBe(0);
  });

  it('is idempotent — a second seeding of the same files adds nothing', async () => {
    const root = tempRoot();
    writeFileSync(join(root, '.env'), 'A=sk-live-one-0001\n');
    const vault = createVault();
    await seedVault(root, vault);
    const again = await seedVault(root, vault);
    expect(again.values).toBe(0);
  });
});
