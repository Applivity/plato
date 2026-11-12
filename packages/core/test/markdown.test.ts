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

  it('renders a GFM table with header and body rows', () => {
    const out = renderMarkdown(
      '| # | Bug | File |\n|---|-----|------|\n| 1 | SQL injection | DatabaseHelper.java |\n| 2 | HMAC charset | ApiSecurityUtility.java |',
    );
    expect(out).toContain('md-table');
    expect(out).toContain('<th>Bug</th>');
    expect(out).toContain('<td>SQL injection</td>');
    expect(out).toContain('<td>ApiSecurityUtility.java</td>');
    expect(out).not.toContain('|---');
  });

  it('renders alignment colons as text-align styles (left stays default)', () => {
    const out = renderMarkdown(
      '| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |',
    );
    expect(out).not.toContain('text-align:left');
    expect(out).toContain('<th style="text-align:center">b</th>');
    expect(out).toContain('<th style="text-align:right">c</th>');
    expect(out).toContain('<td style="text-align:center">2</td>');
    expect(out).toContain('<td style="text-align:right">3</td>');
  });

  it('escapes HTML inside table cells', () => {
    const out = renderMarkdown(
      '| x |\n|---|\n| <img src=x onerror=alert(1)> |',
    );
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('keeps inline formatting inside table cells', () => {
    const out = renderMarkdown('| a |\n|---|\n| **bold** and `code` |');
    expect(out).toContain('<td><strong>bold</strong> and <code>code</code></td>');
  });

  it('leaves pipe lines without a delimiter row as a paragraph', () => {
    const out = renderMarkdown('| just | some | text\nmore');
    expect(out).not.toContain('md-table');
    expect(out).toContain('| just');
  });

  it('pads short body rows and trims long ones to the header width', () => {
    const out = renderMarkdown('| a | b |\n|---|---|\n| one |\n| 1 | 2 | 3 |');
    expect(out).toContain('<td>one</td><td></td>');
    expect(out).not.toContain('<td>3</td>');
  });
});

/**
 * D49ad. A long report separates its sections with `---`, and it was rendering as
 * three literal dashes in the middle of the prose. The founder was comparing the
 * result against Claude Code, which draws a rule there.
 *
 * The one thing that must NOT change is the setext case: `Title` followed by
 * `---` is an underline, not a rule. This renderer has never supported setext,
 * so that line already folded into a paragraph — and it must keep doing so,
 * because turning a title's underline into a horizontal rule would be worse than
 * the bug being fixed.
 */
describe('thematic breaks (D49ad)', () => {
  it('renders a standalone rule', () => {
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p><hr><p>b</p>');
  });

  it('accepts stars and underscores too', () => {
    expect(renderMarkdown('a\n\n***\n\nb')).toContain('<hr>');
    expect(renderMarkdown('a\n\n___\n\nb')).toContain('<hr>');
  });

  it('ends an open list before the rule', () => {
    const out = renderMarkdown('1. a\n2. b\n\n---\n\nc');
    expect(out).toBe('<ol><li>a</li><li>b</li></ol><hr><p>c</p>');
  });

  // A setext underline is NOT a rule, and this renderer keeps its old behaviour.
  it('leaves a title underline inside its paragraph', () => {
    const out = renderMarkdown('Fixed (4)\n---\nmore');
    expect(out).not.toContain('<hr>');
  });

  // Two dashes are not a break; the fence must not accept any short run.
  it('does not treat a short dash run as a rule', () => {
    expect(renderMarkdown('a\n\n--\n\nb')).not.toContain('<hr>');
  });

  it('never rewrites a rule inside a fenced code block', () => {
    const out = renderMarkdown('```\n---\n```');
    expect(out).toContain('---');
    expect(out).not.toContain('<hr>');
  });

  it('still reads a table delimiter row as a table', () => {
    expect(renderMarkdown('| a |\n|---|\n| 1 |')).toContain('md-table');
  });
});

/**
 * D49cd: a local path in a reply is a control the user can click.
 *
 * The client's agent wrote screenshots as `.scratch/shots/homeowner-PANEL-FINAL.png`
 * and the user could not open one. The path is carried as `data-path`, never as
 * an href; the host decides what to open.
 */
describe('local paths (D49cd)', () => {
  const span = (path: string) =>
    `<span class="md-path" data-path="${path}" role="link" tabindex="0">${path}</span>`;

  it('marks an absolute Windows path', () => {
    const out = renderMarkdown('see C:\\Users\\me\\shot.png here');
    expect(out).toContain(span('C:\\Users\\me\\shot.png'));
  });

  it('marks a UNC path', () => {
    const out = renderMarkdown('see \\\\server\\share\\shot.png here');
    expect(out).toContain(span('\\\\server\\share\\shot.png'));
  });

  it('marks an absolute POSIX path', () => {
    const out = renderMarkdown('see /home/me/shot.png here');
    expect(out).toContain(span('/home/me/shot.png'));
  });

  it('marks a workspace-relative path with an extension', () => {
    const out = renderMarkdown(
      '![shot](.scratch/shots/homeowner-PANEL-FINAL.png) was saved',
    );
    expect(out).toContain(
      span('.scratch/shots/homeowner-PANEL-FINAL.png'),
    );
  });

  it('marks a path inside inline code, which is where the model puts it', () => {
    const out = renderMarkdown('I wrote `.scratch/shots/home.png` for you');
    expect(out).toContain(
      `<code>${span('.scratch/shots/home.png')}</code>`,
    );
  });

  it('marks a bare file name inside inline code', () => {
    const out = renderMarkdown('see `screenshot.png`');
    expect(out).toContain(`<code>${span('screenshot.png')}</code>`);
  });

  it('keeps a path with spaces clickable inside backticks', () => {
    const out = renderMarkdown('Saved `/Users/me/My Folder/shot.png` now');
    expect(out).toContain(span('/Users/me/My Folder/shot.png'));
    expect(out).toContain('data-path="/Users/me/My Folder/shot.png"');
  });

  it('leaves a slash command alone', () => {
    expect(renderMarkdown('use `/compact` now')).toBe(
      '<p>use <code>/compact</code> now</p>',
    );
  });

  it('leaves markdown that is not a path alone', () => {
    const out = renderMarkdown('and/or e.g. 3/4 www.example.com');
    expect(out).not.toContain('md-path');
    expect(out).toContain('and/or');
    expect(out).toContain('e.g.');
  });

  it('never turns a URL into a local path', () => {
    const out = renderMarkdown('see https://example.com/a/b.png now');
    expect(out).not.toContain('md-path');
    expect(out).toContain('https://example.com/a/b.png');
  });

  it('never marks a path inside a fenced block', () => {
    const out = renderMarkdown('```\n/Users/me/shot.png\n```');
    expect(out).not.toContain('md-path');
    expect(out).toContain('/Users/me/shot.png');
  });

  it('does not swallow the punctuation after a path', () => {
    const out = renderMarkdown('see /home/me/shot.png.');
    expect(out).toContain(span('/home/me/shot.png') + '.');
  });
});
