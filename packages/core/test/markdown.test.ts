import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/format/markdown.js';

describe('renderMarkdown', () => {
  it('never lets raw HTML through', () => {
    const out = renderMarkdown('<script>alert(1)</script> and <b>x</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders fenced code blocks with a language label, escaped', () => {
    const out = renderMarkdown('```gradle\ninclude ":app"\n```');
    expect(out).toContain('md-code');
    expect(out).toContain('md-lang">gradle</span>');
    expect(out).toContain('&quot;:app&quot;');
    expect(out).not.toContain('<p>');
  });

  it('leaves an unterminated fence as plain text', () => {
    const out = renderMarkdown('```js\nlet x = 1;');
    expect(out).not.toContain('md-code');
  });

  it('renders bold, italic and inline code', () => {
    const out = renderMarkdown('a **bold** and *em* and `code` bit');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('<code>code</code>');
  });

  it('groups consecutive bullets into one list', () => {
    const out = renderMarkdown('- a\n- b\n\ntail');
    expect(out).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('groups ordered items separately from bullets', () => {
    const out = renderMarkdown('1. one\n2. two\n- dash');
    expect(out).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(out).toContain('<ul><li>dash</li></ul>');
  });

  it('maps heading depth to md-h classes', () => {
    const out = renderMarkdown('# H1\n### H3');
    expect(out).toContain('md-h1">H1</div>');
    expect(out).toContain('md-h3">H3</div>');
  });

  it('renders blockquotes from escaped > markers', () => {
    const out = renderMarkdown('> quoted line');
    expect(out).toContain('<blockquote><p>quoted line</p></blockquote>');
  });

  it('links only http(s) URLs; other schemes stay literal text', () => {
    const ok = renderMarkdown('[site](https://example.com/x)');
    expect(ok).toContain('href="https://example.com/x"');

    const bad = renderMarkdown('[x](javascript:alert(1))');
    expect(bad).not.toContain('href="javascript');
  });

  it('joins soft-wrapped lines with <br>, splits on blank lines', () => {
    const out = renderMarkdown('one\ntwo\n\nthree');
    expect((out.match(/<p>/g) ?? []).length).toBe(2);
    expect(out).toContain('one<br>two');
  });

  it('restores code sentinels that sit between paragraphs', () => {
    const out = renderMarkdown('before\n\n```\nx\n```\n\nafter');
    expect(out.indexOf('md-code')).toBeLessThan(out.indexOf('after'));
    expect(out).toContain('<p>before</p>');
    expect(out).toContain('<p>after</p>');
  });
});
