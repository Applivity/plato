import { readFile } from 'node:fs/promises';
import {
  isSecretPath,
  loadImageAttachment,
  loadImageFile,
  looksLikeImage,
  readErrorReason,
  type ImageMime,
} from '@applivity/plato-core';

/**
 * D49cd, carried into the terminal (parity round).
 *
 * An `@` mention of an ABSOLUTE or UNC path names a file the user chose, and a
 * person attaching a screenshot from their Desktop is not a tool call: the
 * workspace rule does not apply, and telling them to move the file into the
 * project is not an answer. Every other guard does apply, and it is the same one
 * the desktop chat uses:
 *
 *   - the bytes decide whether an image is an image (3 MB raw cap);
 *   - a text file is capped at 200 KB, measured in characters;
 *   - the secret deny-list is checked on the path before anything is read;
 *   - a refusal names its cause.
 *
 * A relative mention keeps the old, narrower meaning: an image inside the
 * project is attached, and anything else stays the text the user typed.
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_ATTACH_BYTES = 200 * 1024;

export interface TaskAttachments {
  /** The task the model reads: the typed text plus any outside text files. */
  task: string;
  images: { mime: ImageMime; data: string }[];
  rejected: { path: string; kind: 'image' | 'file'; reason: string }[];
}

/** The same rule the desktop picker uses; a Windows path is testable anywhere. */
export function isAbsoluteMention(raw: string): boolean {
  return raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\');
}

/** The base name on either separator, because the path may be a Windows one. */
function baseName(raw: string): string {
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return cut >= 0 ? raw.slice(cut + 1) : raw;
}

async function readOutsideText(
  abs: string,
): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (error) {
    return { ok: false, reason: readErrorReason(error) };
  }
  if (text.length > MAX_TEXT_ATTACH_BYTES) {
    return {
      ok: false,
      reason: `${text.length} characters is over the 200 KB text cap`,
    };
  }
  return { ok: true, body: text };
}

/**
 * Everything the typed `@` mentions attach, and the task text the model reads.
 * The order is the order the user typed them; a repeat is attached once.
 */
export async function taskAttachments(
  task: string,
  root: string,
): Promise<TaskAttachments> {
  const images: TaskAttachments['images'] = [];
  const rejected: TaskAttachments['rejected'] = [];
  const seen = new Set<string>();
  let out = task;

  for (const match of task.matchAll(/@([^\s@]+)/g)) {
    const raw = match[1] ?? '';
    if (raw.length === 0 || seen.has(raw)) continue;
    seen.add(raw);
    const absolute = isAbsoluteMention(raw);

    if (looksLikeImage(raw)) {
      const loaded = absolute
        ? await loadImageFile(raw, MAX_IMAGE_BYTES)
        : await loadImageAttachment(raw, root, MAX_IMAGE_BYTES);
      if (loaded.ok) {
        images.push({ mime: loaded.image.mime, data: loaded.image.data });
      } else {
        rejected.push({ path: raw, kind: 'image', reason: loaded.reason });
      }
      continue;
    }

    // A relative path that is not an image keeps its old meaning: it is the
    // user's text, not an instruction to read the file.
    if (!absolute) continue;
    if (isSecretPath(raw)) {
      rejected.push({ path: raw, kind: 'file', reason: 'on the secret deny-list' });
      continue;
    }
    const read = await readOutsideText(raw);
    if (!read.ok) {
      rejected.push({ path: raw, kind: 'file', reason: read.reason });
      continue;
    }
    out += `\n\n[attachment: ${baseName(raw)}]\n\`\`\`\n${read.body}\n\`\`\``;
  }

  return { task: out, images, rejected };
}
