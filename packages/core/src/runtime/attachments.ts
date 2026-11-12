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
import { open, readdir, readFile, stat, unlink } from 'node:fs/promises';
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

/** Extensions we will even attempt to load as an image. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
];

/**
 * The NAME says "try as an image"; the bytes decide whether it is one.
 *
 * The two checks are deliberately separate. Without this one, a text file would
 * be sniffed, fail, and fall back to the text path — and a *corrupt* PNG would
 * then be attached as mojibake text instead of being refused. With it, anything
 * offered as an image must actually be one.
 */
export function looksLikeImage(rel: string): boolean {
  const dot = rel.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.includes(rel.slice(dot + 1).toLowerCase());
}

/**
 * The raw-byte cap for one image, shared by the attach picker and `read_image`
 * so the tool cannot admit what the picker refuses (or the reverse).
 */
export const DEFAULT_MAX_IMAGE_BYTES = 3 * 1024 * 1024;

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
  // this is the same rule where the bytes are actually touched (D49k). This is
  // the MODEL-facing path; a file the user picked by hand is `loadImageFile`.
  if (resolveInRoot(root, rel) === null) {
    return { ok: false, reason: 'outside the workspace' };
  }
  const r = await loadImageFile(join(root, rel), maxBytes);
  return r.ok ? { ok: true, image: { ...r.image, name: rel } } : r;
}

/**
 * D49cd: an image the USER picked, named by its absolute path.
 *
 * The workspace rule belongs to tool calls the model makes; a person attaching
 * a screenshot from their Desktop is not a tool call, and telling them to move
 * the file into the project is not a useful answer. Containment is therefore
 * not applied here — but every other guard is: the secret deny-list is checked
 * on the absolute path, the raw-byte cap holds, and the bytes (not the name)
 * decide the type.
 */
export async function loadImageFile(abs: string, maxBytes: number): Promise<ImageLoad> {
  if (isSecretPath(abs)) {
    return { ok: false, reason: 'on the secret deny-list' };
  }
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch (e) {
    return { ok: false, reason: readErrorReason(e) };
  }
  if (buf.length > maxBytes) {
    return { ok: false, reason: tooBig(buf.length, maxBytes) };
  }
  const mime = sniffImageMime(buf);
  if (mime === null) {
    return { ok: false, reason: notAnImage() };
  }
  const cut = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
  const name = cut >= 0 ? abs.slice(cut + 1) : abs;
  return {
    ok: true,
    image: { name, mime, data: buf.toString('base64'), bytes: buf.length },
  };
}

/**
 * D49dj (2026-11-12): what a refusal SAYS.
 *
 * A client was given a perfectly good 9.8 KB PNG and remembers being refused
 * for "invalid data". None of the real causes was named, so the one useful
 * thing a refusal can do — tell the user what to fix — was missing. Every
 * reason below names its cause, and a read failure carries the platform code
 * (EACCES, ENOENT, EISDIR...) because that is what a user can act on.
 */
export function readErrorReason(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return 'file not found (ENOENT)';
  if (code === 'EACCES' || code === 'EPERM') {
    return `permission denied (${code})`;
  }
  if (code === 'EISDIR') return 'that is a folder, not a file (EISDIR)';
  return code === undefined ? 'could not be read' : `could not be read (${code})`;
}

/** A size a person can compare at a glance, in the unit that fits it. */
export function humanBytes(n: number): string {
  if (n >= 1024 * 1024) {
    return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  }
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + (n === 1 ? ' byte' : ' bytes');
}

function tooBig(bytes: number, maxBytes: number): string {
  return `${humanBytes(bytes)} is over the ${humanBytes(maxBytes)} limit`;
}

function notAnImage(): string {
  return 'not a PNG, JPEG, WebP or GIF — the bytes are not an image, whatever the name says';
}

/** What a thumbnail needs to know: is it an image, how big, and which type. */
export type ImageProbe =
  | { ok: true; mime: ImageMime; bytes: number }
  | { ok: false; reason: string };

/**
 * D49dj: check an image WITHOUT reading it whole.
 *
 * A thumbnail is shown by the webview from a resource URI, so the bytes never
 * need to cross the message channel. Reading a 3 MB screenshot just to sniff
 * its first bytes would do that work on every render; this reads the header
 * only. The size comes from `stat`, so the cap is still the same 3 MB the
 * picker uses.
 */
export async function probeImageFile(
  abs: string,
  maxBytes: number,
): Promise<ImageProbe> {
  if (isSecretPath(abs)) {
    return { ok: false, reason: 'on the secret deny-list' };
  }
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return { ok: false, reason: 'that is a folder, not a file' };
    size = st.size;
  } catch (e) {
    return { ok: false, reason: readErrorReason(e) };
  }
  if (size > maxBytes) return { ok: false, reason: tooBig(size, maxBytes) };
  let head: Buffer;
  try {
    const fh = await open(abs, 'r');
    try {
      head = Buffer.alloc(Math.min(16, Math.max(size, 1)));
      await fh.read(head, 0, head.length, 0);
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, reason: readErrorReason(e) };
  }
  const mime = sniffImageMime(head);
  if (mime === null) return { ok: false, reason: notAnImage() };
  return { ok: true, mime, bytes: size };
}

/**
 * D49dj: remove pasted images that have outlived their week.
 *
 * A pasted image is copied into Plato's own storage because the platform gives
 * the chat bytes and no path. The copy is an attachment for as long as its
 * conversation needs it; after seven days it is only disk. Returns the names
 * removed, for the caller to log or ignore.
 */
export async function sweepPastedFiles(
  dir: string,
  maxAgeMs: number,
  now: number = Date.now(),
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // no folder yet: nothing has been pasted
  }
  const gone: string[] = [];
  for (const name of names) {
    const abs = join(dir, name);
    try {
      const st = await stat(abs);
      if (!st.isFile() || now - st.mtimeMs <= maxAgeMs) continue;
      await unlink(abs);
      gone.push(name);
    } catch {
      // Gone already, or not ours to remove: either way, leave it.
    }
  }
  return gone;
}
