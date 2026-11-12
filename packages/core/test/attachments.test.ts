import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  humanBytes,
  loadImageAttachment,
  loadImageFile,
  looksLikeImage,
  probeImageFile,
  sniffImageMime,
  sweepPastedFiles,
} from '../src/runtime/attachments.js';

/**
 * D49n. The type is decided by the BYTES, never the extension: the provider
 * rejects a `media_type` that disagrees with the content, and a mislabelled
 * file is the easiest way to send one.
 */
function root(): string {
  return mkdtempSync(join(tmpdir(), 'plato-img-'));
}

// Minimal but genuine headers — enough for a signature test.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.alloc(8),
]);
const NOT_AN_IMAGE = Buffer.from('this is plainly not an image');

describe('sniffImageMime (D49n)', () => {
  it('recognises the four formats both wires accept', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(GIF)).toBe('image/gif');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
  });

  it('rejects anything else, including text and empty input', () => {
    expect(sniffImageMime(NOT_AN_IMAGE)).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    // Truncated headers must not pass on a lucky prefix.
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageMime(Buffer.from('GIF8', 'latin1'))).toBeNull();
    expect(sniffImageMime(Buffer.from('RIFF0000', 'latin1'))).toBeNull();
  });

  // RIFF is also used by AVI and WAV; only the WEBP tag makes it an image.
  it('does not accept RIFF alone', () => {
    const riffWave = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.alloc(8),
    ]);
    expect(sniffImageMime(riffWave)).toBeNull();
  });
});

describe('loadImageAttachment (D49n)', () => {
  it('loads an image as base64 with the sniffed mime', async () => {
    const r = root();
    writeFileSync(join(r, 'shot.png'), PNG);
    const out = await loadImageAttachment('shot.png', r, 1_000_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.image.mime).toBe('image/png');
    expect(out.image.name).toBe('shot.png');
    expect(out.image.bytes).toBe(PNG.length);
    // base64 round-trips to the same bytes.
    expect(Buffer.from(out.image.data, 'base64')).toEqual(PNG);
    // No data: prefix — that is a wire detail each adapter adds itself.
    expect(out.image.data.startsWith('data:')).toBe(false);
  });

  /**
   * The spoof. A file named .png whose bytes are not a PNG must be refused: the
   * extension is a claim, and the provider will reject the media_type we would
   * derive from it.
   */
  it('refuses a .png whose bytes are not a PNG', async () => {
    const r = root();
    writeFileSync(join(r, 'lies.png'), NOT_AN_IMAGE);
    const out = await loadImageAttachment('lies.png', r, 1_000_000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain('not a PNG');
  });

  // The reverse spoof: real PNG bytes behind an extension we would have
  // rejected on sight. The bytes win, so this one is accepted.
  it('accepts real image bytes whatever the name says', async () => {
    const r = root();
    writeFileSync(join(r, 'screenshot.dat'), JPEG);
    const out = await loadImageAttachment('screenshot.dat', r, 1_000_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.image.mime).toBe('image/jpeg');
  });

  // The cap is on RAW bytes. Measuring base64 instead would refuse files that
  // are comfortably inside the limit, because base64 inflates by ~33%.
  it('caps raw bytes, not the base64 length', async () => {
    const r = root();
    const big = Buffer.concat([PNG, Buffer.alloc(3000)]);
    writeFileSync(join(r, 'big.png'), big);
    // 3104 raw bytes is over 2000, but its base64 form is ~4140 — asserting
    // the raw boundary pins which measurement is used.
    const over = await loadImageAttachment('big.png', r, 2000);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    // D49dj: the refusal names the actual size and the actual cap.
    expect(over.reason).toContain('is over the 2 KB limit');
    const under = await loadImageAttachment('big.png', r, 4000);
    expect(under.ok).toBe(true);
  });

  it('refuses a missing file and a protected one', async () => {
    const r = root();
    expect((await loadImageAttachment('nope.png', r, 1000)).ok).toBe(false);
    writeFileSync(join(r, '.env.local'), PNG);
    const secret = await loadImageAttachment('.env.local', r, 1000);
    expect(secret.ok).toBe(false);
    if (secret.ok) return;
    expect(secret.reason).toContain('deny-list');
  });

  it('refuses a path outside the workspace (D49k rule)', async () => {

    const r = root();
    const outside = join(r, '..', 'plato-img-outside.png');
    writeFileSync(outside, PNG);
    try {
      const out = await loadImageAttachment('../plato-img-outside.png', r, 1_000_000);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toContain('outside the workspace');
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe('looksLikeImage (D49o)', () => {
  it('accepts the four supported extensions, plus jpg aliases', () => {
    for (const n of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif']) {
      expect(looksLikeImage(n)).toBe(true);
    }
    for (const n of ['shot.jpeg', 'dir.d/photo.png']) {
      expect(looksLikeImage(n)).toBe(true);
    }
  });

  it('rejects everything else, including a name with no extension', () => {
    for (const n of ['a.ts', 'a.svg', 'a.pdf', 'README', 'a.png.txt', 'a.']) {
      expect(looksLikeImage(n)).toBe(false);
    }
  });

  /**
   * The two checks are separate on purpose: the NAME decides whether to try as
   * an image, the BYTES decide whether it is one. Collapsing them would let a
   * corrupt PNG fall back to the text path and attach as mojibake.
   */
  it('is about the name only — the bytes are a separate check', async () => {
    expect(looksLikeImage('lies.png')).toBe(true);
    const r = root();
    writeFileSync(join(r, 'lies.png'), NOT_AN_IMAGE);
    const out = await loadImageAttachment('lies.png', r, 1_000_000);
    expect(out.ok).toBe(false);
  });
});

/**
 * D49cd: the USER's image, named by an absolute path.
 *
 * The workspace rule belongs to tool calls the model makes. A person attaching
 * a screenshot from the Desktop is not one, and telling them to move the file
 * into the project is not an answer. Containment is dropped here and everything
 * else is kept: the deny-list on the absolute path, the raw-byte cap, and the
 * bytes deciding the type.
 */
describe('loadImageFile for a user-picked image outside the workspace (D49cd)', () => {
  it('reads an absolute path anywhere on disk and names it by its base name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-desktop-'));
    const abs = join(dir, 'shot.png');
    writeFileSync(abs, PNG);
    try {
      const out = await loadImageFile(abs, 1_000_000);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.image.name).toBe('shot.png');
      expect(out.image.mime).toBe('image/png');
      expect(out.image.data).toBe(PNG.toString('base64'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still refuses a deny-listed name outside the workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-desktop-'));
    const abs = join(dir, '.env');
    writeFileSync(abs, PNG);
    try {
      const out = await loadImageFile(abs, 1_000_000);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toContain('deny-list');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still applies the size cap to an outside file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-desktop-'));
    const abs = join(dir, 'big.png');
    writeFileSync(abs, PNG);
    try {
      const out = await loadImageFile(abs, 10);
      expect(out.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* D49dj (2026-11-12): a valid image with a space in its path was      */
/* refused; every refusal now names the cause, and a read failure     */
/* carries the platform code.                                          */
/* ------------------------------------------------------------------ */
const CLIENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const extraDirs: string[] = [];
function extraTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plato-attach-'));
  extraDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of extraDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('image refusals name the cause (D49dj)', () => {
  it('accepts a PNG whose path contains spaces', async () => {
    const dir = extraTemp();
    const file = join(dir, 'My Folder', 'Screenshot 1.png');
    mkdirSync(join(dir, 'My Folder'));
    writeFileSync(file, CLIENT_PNG);
    const r = await loadImageFile(file, 3 * 1024 * 1024);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.image.mime).toBe('image/png');
      expect(r.image.name).toBe('Screenshot 1.png');
    }
  });

  it('says the bytes are not an image, whatever the name says', async () => {
    const dir = extraTemp();
    const file = join(dir, 'fake.png');
    writeFileSync(file, 'this is text, not a PNG');
    const r = await loadImageFile(file, 3 * 1024 * 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not a PNG, JPEG, WebP or GIF');
  });

  it('names the size when the file is too large', async () => {
    const dir = extraTemp();
    const file = join(dir, 'huge.png');
    writeFileSync(file, Buffer.concat([CLIENT_PNG, Buffer.alloc(2 * 1024 * 1024)]));
    const r = await loadImageFile(file, 1024 * 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain(humanBytes(2 * 1024 * 1024 + CLIENT_PNG.length));
      expect(r.reason).toContain('1 MB limit');
    }
  });

  it('carries the code when the file cannot be read', async () => {
    const r = await loadImageFile(join(extraTemp(), 'gone.png'), 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('file not found (ENOENT)');
  });
});

describe('probeImageFile (D49dj)', () => {
  it('reports the type and size without reading the whole file', async () => {
    const dir = extraTemp();
    const file = join(dir, 'shot.png');
    writeFileSync(file, CLIENT_PNG);
    const r = await probeImageFile(file, 3 * 1024 * 1024);
    expect(r).toEqual({ ok: true, mime: 'image/png', bytes: CLIENT_PNG.length });
  });

  it('refuses what the picker would refuse, with the same reasons', async () => {
    const dir = extraTemp();
    const text = join(dir, 'notes.png');
    writeFileSync(text, 'not an image at all');
    const notImage = await probeImageFile(text, 3 * 1024 * 1024);
    expect(notImage.ok).toBe(false);
    if (!notImage.ok) expect(notImage.reason).toContain('not a PNG');

    const big = join(dir, 'big.png');
    writeFileSync(big, Buffer.concat([CLIENT_PNG, Buffer.alloc(2048)]));
    const tooBig = await probeImageFile(big, 1024);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.reason).toContain('limit');

    const missing = await probeImageFile(join(dir, 'gone.png'), 1024);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('file not found (ENOENT)');
  });
});

describe('sweepPastedFiles (D49dj)', () => {
  it('removes what is older than a week and keeps what is not', async () => {
    const dir = extraTemp();
    const old = join(dir, 'old.png');
    const fresh = join(dir, 'fresh.png');
    writeFileSync(old, CLIENT_PNG);
    writeFileSync(fresh, CLIENT_PNG);
    const week = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    utimesSync(old, new Date(now - week - 1000), new Date(now - week - 1000));
    const gone = await sweepPastedFiles(dir, week, now);
    expect(gone).toEqual(['old.png']);
    expect(existsSync(fresh)).toBe(true);
  });

  it('is silent when nothing has ever been pasted', async () => {
    expect(await sweepPastedFiles(join(extraTemp(), 'missing'), 1000)).toEqual([]);
  });
});
