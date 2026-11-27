import { describe, expect, it } from 'vitest';

// Ink decides whether it emits colour when it loads, so the flag goes on first
// and both modules are imported after it. NO_COLOR is the flag the app itself
// reads (COLOURS in App.tsx); this test pins the coloured path it guards.
process.env.FORCE_COLOR = '3';
const { renderToString } = await import('ink');
const { createElement } = await import('react');
const { RowView } = await import('../src/tui/App.js');
type ApprovalOutcome = import('../src/session.js').ApprovalOutcome;

function draw(outcome: ApprovalOutcome, word: string, text: string): string {
  return renderToString(
    createElement(RowView, {
      row: { id: 1, kind: 'notice', text, outcome, word },
      columns: 100,
    }),
    { columns: 100 },
  );
}

describe('an answered approval row', () => {
  // The panel's scheme, applied literally: only the outcome word is coloured.
  it('colours the word green when allowed, and not the mark or the sentence', () => {
    const out = draw('allowed', 'allowed', '✓ Let Plato write note.txt — allowed');
    expect(out).toMatch(/^\u001b\[2m✓ Let Plato write note\.txt — \u001b\[22m\u001b\[32mallowed\u001b\[39m$/);
  });

  it('colours the word yellow when denied', () => {
    const out = draw('denied', 'denied', '✕ Let Plato write note.txt — denied');
    expect(out).toMatch(/^\u001b\[2m✕ Let Plato write note\.txt — \u001b\[22m\u001b\[33mdenied\u001b\[39m$/);
  });

  it('colours the word red when cancelled', () => {
    const out = draw('cancelled', 'cancelled', '– Let Plato write note.txt — cancelled');
    expect(out).toMatch(/^\u001b\[2m– Let Plato write note\.txt — \u001b\[22m\u001b\[31mcancelled\u001b\[39m$/);
  });

  it('treats the session grant as an allowed outcome', () => {
    const out = draw(
      'session',
      'allowed for the rest of this session',
      '✓ Let Plato write note.txt — allowed for the rest of this session',
    );
    expect(out).toContain('\u001b[32mallowed for the rest of this session\u001b[39m');
  });

  it('leaves a plain notice plain', () => {
    const out = renderToString(
      createElement(RowView, {
        row: { id: 1, kind: 'notice', text: 'Run ended: stopped.' },
        columns: 100,
      }),
      { columns: 100 },
    );
    expect(out).toBe('\u001b[2mRun ended: stopped.\u001b[22m');
  });
});
