/**
 * D49bb: masking — what replaced refusing to read a protected file.
 *
 * The deny-list used to refuse any call whose arguments named a protected file,
 * in every mode, with no way out. The founder challenged that: *"it don't waant
 * plato refusal to become annoyance for user, Plato can warn but must not
 * outright reject."* He was right, and the reason is the one the whole decision
 * turns on — **the refusal fired on the ACCESS, and the access is not the
 * dangerous act. Moving the secret somewhere new is.**
 *
 * So a protected text file is readable, and its VALUES are replaced with
 * placeholders before the model ever sees them:
 *
 *     API_KEY=sk-live-abc123      ->      API_KEY=«masked:API_KEY»
 *
 * The model learns what configuration exists — every key, every comment, the
 * line structure — and never holds a value it could move. Five rules carry it,
 * and three of them are traps found by writing this file rather than by thinking
 * about it: rules 2 and 5 are the ones that would have leaked a secret, and
 * rule 4 is the one that would have destroyed every secret in a file.
 *
 * 1. **FAIL CLOSED.** `maskText` returns null when it cannot account for every
 *    line, and the caller then REFUSES the read. A masking step that quietly
 *    returns the original text on a file it did not understand is worse than the
 *    refusal it replaced, because it reports success. A keystore, a private key
 *    and a one-line JSON blob all land here.
 * 2. **A multi-line value is not masked by masking its first line.** The obvious
 *    implementation masks `PRIVATE_KEY="-----BEGIN…` and passes the following
 *    lines through VERBATIM. That is why rule 1 is a whole-file test and not a
 *    per-line one: any line that is neither blank, a comment, nor an assignment
 *    makes the whole file unmaskable.
 * 3. **The placeholder names its own key**, so a value can be restored per key
 *    and a placeholder is recognisable without knowing any secret.
 * 4. **Un-masking is not optional.** A read that masks, with a write that does
 *    not restore, turns an ordinary "add one key" edit into the destruction of
 *    every secret in the file. Both halves live here so they cannot drift.
 * 5. **A COMMENTED-OUT value is still a value.** `# API_KEY=sk-live-…` is what
 *    people leave behind when they comment a key out for a test, and a masker
 *    that passes comment lines through hands it over while the file still reads
 *    as protected. See `COMMENT_ASSIGN`.
 */

/** The placeholder's delimiters. `«»` are rare enough to be safe in a config. */
export const MASK_OPEN = '«masked:';
export const MASK_CLOSE = '»';

export function placeholder(name: string): string {
  return `${MASK_OPEN}${name}${MASK_CLOSE}`;
}

const PLACEHOLDER_RE = /«masked:([^»]*)»/g;

/** `KEY=value`, `KEY: value`, `export KEY=value`, `"KEY": "value"`. */
const ASSIGN = /^(\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[=:]\s*)(.*)$/;

function isComment(trimmed: string): boolean {
  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith(';') ||
    trimmed.startsWith('*')
  );
}

/**
 * An assignment INSIDE a comment: `# API_KEY=sk-live-…`.
 *
 * This is not a nicety. Commenting a key out rather than deleting it is what
 * people actually do while testing, and a masker that passes comment lines
 * through verbatim hands that key over — the file reads as protected and the
 * value walks out under a `#`. Found by asking what the comment branch does,
 * not by a test: the first version passed every test in this file.
 *
 * The name must sit immediately after the comment marker, so prose that happens
 * to contain an `=` is left alone.
 */
const COMMENT_ASSIGN = /^(\s*[#/*;]+\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.+)$/;

export interface MaskResult {
  /** The file's text with every value replaced by its placeholder. */
  masked: string;
  /** Every `[placeholder, realValue]` pair this file contributed. */
  pairs: Array<[string, string]>;
}

/**
 * Masks a text config file, or returns null when it cannot be masked safely.
 *
 * Null is the important return: the caller refuses the read. See rule 1 and
 * rule 2 in the header — a file is masked only when EVERY line is blank, a
 * comment, or an assignment whose value fits on that line.
 */
export function maskText(text: string): MaskResult | null {
  const pairs: Array<[string, string]> = [];
  const out: string[] = [];
  let accounted = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      out.push(line);
      continue;
    }
    if (isComment(trimmed)) {
      const c = COMMENT_ASSIGN.exec(line);
      if (c === null || (c[4] ?? '').includes(MASK_OPEN)) {
        out.push(line);
        continue;
      }
      const name = c[2] ?? '';
      out.push(`${c[1] ?? ''}${name}${c[3] ?? ''}${placeholder(name)}`);
      pairs.push([placeholder(name), c[4] ?? '']);
      accounted += 1;
      continue;
    }
    const m = ASSIGN.exec(line);
    if (m === null) {
      // Rule 2: a line we cannot account for means the file is not a plain
      // config, and a value could be hiding in a continuation. Refuse the file
      // rather than pass the line through.
      return null;
    }
    const head = m[1] ?? '';
    const name = m[2] ?? '';
    const value = m[3] ?? '';
    if (value.length === 0) {
      out.push(line);
      accounted += 1; // `KEY=` is an assignment with nothing to hide
      continue;
    }
    if (value.includes(MASK_OPEN)) {
      out.push(line); // already masked: masking is idempotent
      accounted += 1;
      continue;
    }
    out.push(`${head}${placeholder(name)}`);
    pairs.push([placeholder(name), value]);
    accounted += 1;
  }
  // Nothing accounted for means this is not a config file at all — fail closed.
  // An ALREADY-masked file also lands here as `accounted > 0, pairs empty`, and
  // it must NOT be refused: the model writes a masked file back, and refusing to
  // mask it a second time would reject an ordinary round trip.
  if (accounted === 0) return null;
  return { masked: out.join('\n'), pairs };
}

/**
 * D49bc: is this file plain UTF-8 text?
 *
 * The question the reveal card turns on. "Plato cannot mask this file" covers
 * two unrelated files, and the answer to each is different: a keystore, whose
 * whole content is the secret, stays a refusal, while a JSON blob on one line —
 * plausibly useful, and refused only because of this masker's own limits — may
 * be shown if the user says so. This tells them apart, with no model and no
 * guess.
 *
 * `fatal: true` is the whole implementation, and it is the reason this is a
 * decode rather than a search for U+FFFD: a lossy decode turns every bad byte
 * into U+FFFD, so the search would call a `.jks` text. A NUL byte is rejected
 * too — UTF-8 permits it, but no config file Plato masks holds one, and
 * binaries are full of them.
 */
export function isPlainText(buf: Uint8Array): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** True when the text carries at least one placeholder. */
export function hasPlaceholder(text: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(text);
}

/** Every distinct placeholder in the text, in order of first appearance. */
export function placeholdersIn(text: string): string[] {
  const seen = new Set<string>();
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) seen.add(m[0]);
  return [...seen];
}

/**
 * Shortest value the scrub will look for. A one- or two-character value would
 * match everywhere in unrelated output — scrubbing a password of `1` would blank
 * every `1` in the conversation — so short values are left alone and the limit is
 * recorded rather than hidden. See "Recorded limits" in D49bb.
 */
export const MIN_SCRUB_LENGTH = 8;

/**
 * The session's secret map. It holds `placeholder -> real value` for every
 * protected file this session has read.
 *
 * It is held **in memory only** and never written anywhere: the transcript
 * records tool names and phases rather than results, and this map is the one
 * structure that could turn that record into a secret-bearing file.
 */
export interface SecretVault {
  /** Remember a masked file's pairs so its values can be restored and scrubbed. */
  remember(pairs: Array<[string, string]>): void;
  /** Replace any known real value with its placeholder. */
  scrub(text: string): string;
  /** Replace placeholders with their real values. */
  unmask(text: string): string;
  /** Placeholders this text carries that the vault does NOT know. */
  unknownPlaceholders(text: string): string[];
  /** How many values the vault is holding. */
  size(): number;
}

export function createVault(): SecretVault {
  const byPlaceholder = new Map<string, string>();

  const valuesLongestFirst = (): Array<[string, string]> =>
    [...byPlaceholder.entries()]
      .filter(([, real]) => real.length >= MIN_SCRUB_LENGTH)
      // Longest first: a short value that is a substring of a long one would
      // otherwise split the long one and leave its tail in the clear.
      .sort((a, b) => b[1].length - a[1].length);

  return {
    remember(pairs) {
      for (const [ph, real] of pairs) {
        if (real.length > 0) byPlaceholder.set(ph, real);
      }
    },
    scrub(text) {
      let out = text;
      for (const [ph, real] of valuesLongestFirst()) {
        if (out.includes(real)) out = out.split(real).join(ph);
      }
      return out;
    },
    unmask(text) {
      let out = text;
      for (const [ph, real] of byPlaceholder) {
        if (out.includes(ph)) out = out.split(ph).join(real);
      }
      return out;
    },
    unknownPlaceholders(text) {
      const seen = new Set<string>();
      PLACEHOLDER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
        const ph = m[0];
        if (!byPlaceholder.has(ph)) seen.add(ph);
      }
      return [...seen];
    },
    size() {
      return byPlaceholder.size;
    },
  };
}
