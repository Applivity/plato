/**
 * Safe minimal Markdown -> HTML for chat rendering (D25a).
 *
 * Escape-first: every raw character is HTML-escaped before any tag is
 * added, so model output can never inject markup. Raw HTML never passes
 * through. Supported subset: fenced code blocks, `inline code`, **bold**,
 * *italic*, #-headings (up to ####), -/* and 1. lists, > blockquotes,
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

  // 2) Escape everything that is left. From here on we own all markup.
  work = escapeHtml(work);

  // 3) Inline transforms on escaped text.
  work = work
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );

  // 4) Block pass: headings, lists, quotes, paragraphs, code sentinels.
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

  for (const rawLine of work.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
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

    para.push(line);
  }
  flushPara();
  flushList();

  // 5) Swap code sentinels back in, last.
  return out
    .join('')
    .replace(/\u0000B(\d+)\u0000/g, (_m, i: string) => fences[Number(i)] ?? '');
}
