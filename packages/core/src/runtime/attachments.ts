/**
 * Binary attachments (D49n).
 *
 * A text attachment goes through `loadProjectFile`; an image cannot, because it
 * must stay bytes — decoding it as UTF-8 would corrupt it silently, and the
 * corrupted string is what would reach the model.
 *
 * **The MIME comes from the bytes, never from the extension.** A file called
 * `screenshot.png` that is not a PNG is refused, because the provider rejects a
 * `media_type` that disagrees with the content, and a lying extension is the
 * easiest possible way to send one.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveInRoot } from '../security/paths.js';
import { isSecretPath } from '../security/secrets.js';
import type { ImageMime } from '../providers/types.js';

export type { ImageMime };

interface Signature {
  mime: ImageMime;
  /** `label` is only for the refusal message. */
  label: string;
  test: (b: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    mime: 'image/png',
    label: 'PNG',
    // 89 50 4E 47 0D 0A 1A 0A
    test: (b) =>
      b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    label: 'JPEG',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    label: 'GIF',
    test: (b) => {
      if (b.length < 6) return false;
      const head = b.subarray(0, 6).toString('latin1');
      return head === 'GIF87a' || head === 'GIF89a';
    },
  },
  {
    mime: 'image/webp',
    label: 'WebP',
    // RIFF....WEBP — the four bytes between are the chunk size.
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** The sniffed type, or null when the bytes are not an image we can send. */
export function sniffImageMime(buf: Buffer): ImageMime | null {
  for (const s of SIGNATURES) {
    if (s.test(buf)) return s.mime;
  }
  return null;
}

/** What a supported image looks like once loaded. */
export interface ImageAttachment {
  /** Workspace-relative path, for display and the transcript's metadata. */
  name: string;
  mime: ImageMime;
  /** base64, no `data:` prefix. */
  data: string;
  /** Raw byte count — base64 inflates by ~33%, so this is what a cap must use. */
  bytes: number;
}

export type ImageLoad =
  | { ok: true; image: ImageAttachment }
  | { ok: false; reason: string };

/**
 * Reads one image, or says why it cannot be sent. `maxBytes` is on RAW bytes:
 * a text-sized char cap is meaningless here, and measuring the base64 instead
 * would refuse files that are comfortably inside the limit.
 */
export async function loadImageAttachment(
  rel: string,
  root: string,
  maxBytes: number,
): Promise<ImageLoad> {
  // Defense in depth: the host checks containment before reading anything, and
  // this is the same rule where the bytes are actually touched (D49k).
  if (resolveInRoot(root, rel) === null) {
    return { ok: false, reason: 'outside the workspace' };
  }
  if (isSecretPath(rel)) {
    return { ok: false, reason: 'on the secret deny-list' };
  }
  let buf: Buffer;
  try {
    buf = await readFile(join(root, rel));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return { ok: false, reason: code === 'ENOENT' ? 'file not found' : 'unreadable' };
  }
  if (buf.length > maxBytes) {
    return {
      ok: false,
      reason: `larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
    };
  }
  const mime = sniffImageMime(buf);
  if (mime === null) {
    return {
      ok: false,
      reason: 'not a PNG, JPEG, WebP or GIF — checked the bytes, not the name',
    };
  }
  return {
    ok: true,
    image: { name: rel, mime, data: buf.toString('base64'), bytes: buf.length },
  };
}
