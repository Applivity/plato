/**
 * Safe minimal Markdown -> HTML for chat rendering (D25a).
 *
 * Escape-first: every raw character is HTML-escaped before any tag is
 * added, so model output can never inject markup. Raw HTML never passes
 * through. Supported subset: fenced code blocks, `inline code`, **bold**,
 * *italic*, #-headings (up to ####), -/* and 1. lists, > blockquotes,
 * GFM pipe tables (with :-- alignment), thematic breaks (---, ***, ___),
 * paragraphs with soft breaks, and http(s)-only links. No dependencies.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FENCE = /```([A-Za-z0-9_+\-.]*)\r?\n([\s\S]*?)```/g;

/**
 * D49cd (2026-11-12): a local path in a reply is a CONTROL, not prose.
 *
 * The agent wrote screenshots as `.scratch/shots/homeowner-PANEL-FINAL.png` and
 * the user could not open one: only http(s) links were rendered, and the chat
 * had no way to ask the host to open a file. The renderer now marks a local
 * path with a `data-path` attribute; the webview posts it to the host on click.
 *
 * A `<span>` and never an `<a href>`: a webview that follows a link to a local
 * file navigates away from the chat, which is exactly the fault the CSP exists
 * to prevent. The path is carried as data and the host decides what to open.
 *
 * What counts, and why the line is drawn here:
 *   - absolute Windows (`C:\...`), UNC (`\\server\share\...`) and POSIX (`/a/b`)
 *     are unambiguous;
 *   - a relative path in prose needs BOTH a slash and a file extension, because
 *     `and/or` and `e.g.` would otherwise become links;
 *   - inside inline code one bare file name (`shot.png`) is enough — a code span
 *     is a deliberate mention — but a one-letter "extension" like `e.g.` is not
 *     a file name;
 *   - a POSIX path needs two segments or an extension, so a slash COMMAND such
 *     as `/compact` stays text;
 *   - a fenced block is never touched (it is lifted out before this runs);
 *   - a URL is never a local path, and nothing is transformed outside a path.
 */
const PATH_START = '(?:[A-Za-z]:[\\\\/]|\\\\\\\\|\\/|\\.{1,2}[\\\\/]|[A-Za-z0-9_.\\-]+[\\\\/])';
const PATH_CANDIDATE = new RegExp(
  `(^|[\\s(<\\[])(${PATH_START}[^\\s<>"']*)`,
  'g',
);

/** A path candidate, or null when it is a URL, a command or not a path. */
function asLocalPath(raw: string, bareName: boolean): string | null {
  const s = raw;
  if (s.length === 0 || /\s/.test(s)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//.test(s)) return null;
  if (/^(?:https?|mailto|tel|data|file|vscode):/i.test(s)) return null;
  if (s.startsWith('//')) return null; // protocol-relative, never a file here
  if (/^[A-Za-z]:[\\/]/.test(s)) return s.length > 3 ? s : null;
  if (s.startsWith('\\\\')) return s.length > 3 ? s : null;
  if (s.startsWith('/')) {
    const segs = s.split('/').filter((x) => x.length > 0);
    const hasExt = /\.[A-Za-z0-9]{1,10}$/.test(s);
    return segs.length >= 2 || hasExt ? s : null;
  }
  const hasSlash = /[/\\]/.test(s);
  if (hasSlash) {
    return /\.[A-Za-z0-9]{1,10}$/.test(s) ? s : null;
  }
  return bareName && /\.[A-Za-z0-9]{2,10}$/.test(s) ? s : null;
}

/** The content of an inline code span, when that content is a path. */
function asCodePath(raw: string): string | null {
  if (raw.length === 0 || raw !== raw.trim()) return null;
  if (!/\s/.test(raw)) return asLocalPath(raw, true);
  // A space is allowed only in an absolute path, where the start is unambiguous
  // — a Windows "My Folder" or a POSIX path with a space in it.
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}\/)/.test(raw)) {
    return /^(?:https?|mailto|tel|data|file):/i.test(raw) ? null : raw;
  }
  return null;
}

/** `escaped` is already HTML-escaped; it is safe for both the attribute and the text. */
function pathSpan(escaped: string): string {
  return (
    `<span class="md-path" data-path="${escaped}" role="link" tabindex="0">` +
    escaped +
    '</span>'
  );
}

/** Marks local paths in already-escaped prose. A URL's slash never starts a match. */
function linkifyPaths(work: string): string {
  return work.replace(PATH_CANDIDATE, (_m, lead: string, raw: string) => {
    // Trailing sentence punctuation belongs to the sentence, not the path.
    const cut = raw.replace(/[.,;:!?)\]}]+$/, '');
    const path = asLocalPath(cut, false);
    if (path === null) return lead + raw;
    return lead + pathSpan(path) + raw.slice(path.length);
  });
}

/** Splits a GFM table row into trimmed cells (leading/trailing pipe dropped). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) {
    s = s.slice(1);
  }
  if (s.endsWith('|')) {
    s = s.slice(0, -1);
  }
  return s.split('|').map((c) => c.trim());
}

/**
 * Parses a delimiter row (|---|:---:|---:|). Returns per-column alignment,
 * or null when the line is not a valid delimiter row.
 */
function delimiterAligns(line: string): ('left' | 'center' | 'right')[] | null {
  const cells = splitTableRow(line);
  if (cells.length === 0) {
    return null;
  }
  const aligns: ('left' | 'center' | 'right')[] = [];
  for (const c of cells) {
    if (!/^:?-{1,}:?$/.test(c)) {
      return null;
    }
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    aligns.push(l && r ? 'center' : r ? 'right' : 'left');
  }
  return aligns;
}

export function renderMarkdown(src: string): string {
  // 1) Pull fenced code blocks out first; they must not be transformed.
  const fences: string[] = [];
  let work = String(src).replace(
    FENCE,
    (_m: string, lang: string, body: string) => {
      const l = lang.trim();
      const label = l ? `<span class="md-lang">${escapeHtml(l)}</span>` : '';
      fences.push(
        `<div class="md-code">${label}<pre><code>${escapeHtml(body)}</code></pre></div>`,
      );
      return `\u0000B${fences.length - 1}\u0000`; // sentinel survives escaping
    },
  );

  // 2) Lift inline code out too, before escaping. A path is most often written
  //    in backticks, and the code span must not be transformed as prose — but
  //    its CONTENT can still be a path, which is decided when it is put back.
  const codes: string[] = [];
  work = work.replace(/`([^`\n]+)`/g, (_m: string, body: string) => {
    codes.push(body);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // 3) Escape everything that is left. From here on we own all markup.
  work = escapeHtml(work);

  // 4) Inline transforms on escaped text. Paths first: the tags the later
  //    transforms add never contain a path that this could match, and a URL's
  //    `//` is not a boundary this starts on.
  work = linkifyPaths(work)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );

  // 5) Block pass: headings, lists, quotes, paragraphs, code sentinels.
  const out: string[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list !== null) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  const lines = work.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\s+$/, '');
    if (line.length === 0) {
      flushPara();
      flushList();
      continue;
    }

    const code = /^\u0000B(\d+)\u0000$/.exec(line);
    if (code !== null) {
      flushPara();
      flushList();
      out.push(line);
      continue;
    }

    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h !== null) {
      flushPara();
      flushList();
      const level = h[1]?.length ?? 1;
      out.push(`<div class="md-h md-h${level}">${h[2] ?? ''}</div>`);
      continue;
    }

    // GFM table: a pipe row followed by a delimiter row. Cells are already
    // escaped and inline-formatted, so they pass through as-is.
    if (/^\s*\|/.test(line)) {
      const aligns = delimiterAligns(lines[i + 1] ?? '');
      const head = splitTableRow(line);
      if (aligns !== null && head.length === aligns.length && head.length > 0) {
        flushPara();
        flushList();
        const th = head
          .map((c, j) => {
            const a = aligns[j]!;
            return `<th${a === 'left' ? '' : ` style="text-align:${a}"`}>${c}</th>`;
          })
          .join('');
        const body: string[] = [];
        let j = i + 2;
        while (j < lines.length && /^\s*\|/.test(lines[j] ?? '')) {
          const cells = splitTableRow(lines[j] ?? '');
          while (cells.length < head.length) {
            cells.push('');
          }
          body.push(
            '<tr>' +
              cells
                .slice(0, head.length)
                .map((c, k) => {
                  const a = aligns[k]!;
                  return `<td${a === 'left' ? '' : ` style="text-align:${a}"`}>${c}</td>`;
                })
                .join('') +
              '</tr>',
          );
          j++;
        }
        out.push(
          `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${body.join('')}</tbody></table></div>`,
        );
        i = j - 1;
        continue;
      }
    }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul !== null) {
      flushPara();
      if (list !== 'ul') {
        flushList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }

    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol !== null) {
      flushPara();
      if (list !== 'ol') {
        flushList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }

    const q = /^&gt;\s?(.*)$/.exec(line); // '>' was escaped
    if (q !== null) {
      flushPara();
      flushList();
      out.push(`<blockquote><p>${q[1]}</p></blockquote>`);
      continue;
    }

    // D49ad: a thematic break. Reports use `---` between sections constantly,
    // and it was rendering as three literal dashes in the middle of the prose.
    // Only a STANDALONE rule qualifies: when a paragraph is already open the
    // line is a setext underline (`Title` + `---`), which this renderer has
    // never supported, and folding it into that paragraph keeps it unchanged
    // rather than turning a title's underline into a horizontal rule.
    if (para.length === 0 && /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushList();
      out.push('<hr>');
      continue;
    }

    para.push(line);
  }
  flushPara();
  flushList();

  // 6) Swap the sentinels back in, last. An inline code span whose content is
  //    a path keeps its clickable form inside the code element.
  return out
    .join('')
    .replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => {
      const body = codes[Number(i)] ?? '';
      const escaped = escapeHtml(body);
      return asCodePath(body) === null
        ? `<code>${escaped}</code>`
        : `<code>${pathSpan(escaped)}</code>`;
    })
    .replace(/\u0000B(\d+)\u0000/g, (_m, i: string) => fences[Number(i)] ?? '');
}
