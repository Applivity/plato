/**
 * web_fetch helpers (D49p). Pure functions — the fetching itself lives in
 * execute.ts so the network call stays where the run's context reaches it.
 *
 * No dependency does any of this: HTML is reduced to text by hand, because a
 * real parser would be a new dependency (D07) and this only has to be *good
 * enough to read*, never correct enough to display.
 */

/** Content types we are willing to turn into text. */
const TEXTUAL = [
  'text/html',
  'text/plain',
  'text/markdown',
  'text/xml',
  'application/xml',
  'application/json',
  'application/xhtml+xml',
];

/**
 * True when a `content-type` is something we can read as text. A PDF or an image
 * is refused rather than dumped: the bytes would be noise in the prompt, and
 * pretending to read a binary is worse than saying we cannot.
 */
export function isTextualContentType(ct: string): boolean {
  const base = ct.split(';')[0]!.trim().toLowerCase();
  return TEXTUAL.includes(base);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Reduces HTML to readable text.
 *
 * Script and style bodies are removed WITH their contents — stripping tags alone
 * would leave a page's JavaScript sitting in the prompt as prose. Block-level
 * tags become newlines so paragraphs and list items do not run together, and
 * everything else is dropped.
 *
 * This is text extraction, not a browser: nothing executes, no script runs, no
 * resource is fetched. That is the point — a returned page is untrusted input.
 */
export function htmlToText(html: string): string {
  let s = html;
  // Contents first, or the tags go and the code stays.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block boundaries become newlines; <br> too.
  s = s.replace(/<\s*(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(
    /<\/\s*(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol|nav|main|aside|form)\s*>/gi,
    '\n',
  );
  // Any remaining tag is markup, not content.
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  // Collapse runs of horizontal space, then runs of blank lines.
  s = s.replace(/[ \t\f\v ]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** The hostname of a URL, or '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * True when a redirect stays on the same site, so it needs no fresh approval.
 *
 * A leading `www.` is the same site under its canonical name, and `http` →
 * `https` is an upgrade, so both pass without a card. Everything else asks. In
 * particular a **subdomain is a different host** and therefore asks: it may be a
 * different server, and user-content subdomains are common enough that treating
 * them as the approved site would hand a stranger the consent given to someone
 * else. A downgrade to `http` also asks, so an approved https hop cannot be
 * answered in clear text.
 */
export function sameSite(a: string, b: string): boolean {
  let ua: URL;
  let ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    return false; // unparseable: ask rather than assume
  }
  const strip = (h: string): string =>
    h.toLowerCase().replace(/^www\./, '').replace(/^\[|\]$/g, '');
  if (strip(ua.hostname) !== strip(ub.hostname)) return false;
  if (ua.port !== ub.port) return false;
  return ub.protocol === 'https:' || ua.protocol === ub.protocol;
}

/**
 * Classifies the addresses a user cannot judge from the URL alone.
 *
 * **This is a LABEL, not a gate.** The founder's decision (D49p) is that the
 * user decides where Plato may go, so nothing here refuses anything — the
 * approval card prints what the address means and the user chooses. What the
 * user cannot see is that `169.254.169.254` is not a website, or that
 * `192.168.1.1` is their own router, so that is what this adds.
 *
 * **Literal only.** A hostname that RESOLVES to a private address is not caught,
 * because that needs a DNS lookup; the same class of limitation as the lexical
 * symlink check in D49k. Documented rather than implied.
 */
export function isPrivateHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h.length === 0) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10).
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    const first = Number.parseInt(h.split(':')[0] || '0', 16);
    if (!Number.isFinite(first)) return true;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    return false;
  }

  const parts = h.split('.');
  if (parts.length !== 4) return false; // a name, not a literal address
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  return false;
}

/**
 * The allow/deny lists, applied to every hop.
 *
 * Deny wins over allow: a user who wrote both meant to exclude that host, and
 * silently including it because it also matched the allow list would be the
 * worse reading. Both match the host itself or a dot-suffix of it, so `*.x.com`
 * is expressible as `x.com` without a wildcard syntax to get wrong.
 */
export function checkHost(
  host: string,
  allow: readonly string[],
  deny: readonly string[],
): string | null {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const matches = (list: readonly string[]): boolean =>
    list.some((raw) => {
      const e = raw.trim().toLowerCase().replace(/^\*?\.?/, '');
      return e.length > 0 && (h === e || h.endsWith(`.${e}`));
    });
  if (matches(deny)) return `${host} is on the blocked-domain list`;
  if (allow.length > 0 && !matches(allow)) {
    return `${host} is not on the allowed-domain list`;
  }
  return null;
}
