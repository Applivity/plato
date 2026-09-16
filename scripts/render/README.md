# Render suites (D47j)

Real-DOM checks for the Settings page, run against a headless Chromium.

```bash
node scripts/render/run.mjs                 # build, then run all suites
SKIP_BUILD=1 node scripts/render/run.mjs    # reuse the current bundle (cheap)
node scripts/render/providers.mjs           # one suite
```

## Why

`tsc` and the unit tests cannot see the rendered page. Every defect below shipped
through a green build and was found by the founder in a screenshot:

| Defect | What static checks saw |
|---|---|
| `.modes` fixed 3-column grid gave each card **67px** of text | nothing — the CSS is valid |
| Role textarea `min-height` hid **2.5 lines** at a 420px panel | nothing — `tsc` is happy |
| `.btn-danger` sized for an icon but used for the **"Delete"** text label, so it wrapped to `Del/ete` at every width | nothing |
| CSS defined `.btn-icon-danger`, code emitted `.btn-danger` → **no rule**, so the browser painted its default white button | nothing |
| an exception in `showSettings` **aborted the rest of the render**, killing the Context section | nothing — the page still loaded |

## The two rules that make these honest

1. **Every suite fails on ANY uncaught page error.** An exception inside
   `showSettings` stops the remaining render, so a partially-built page must be a
   hard failure, not a quiet one.
2. **Assert the requirement, not the absence of a symptom.** My first narrow-layout
   test only checked "nothing overflows" — and it *passed* against three 67px
   columns, because cramming does not overflow. The assertion that works is "each
   mode card keeps a usable width".

Both were proven by reverting the fix and watching the suite fail.

## Suites

| Suite | Covers |
|---|---|
| `providers` | sections all render; no page errors; Delete is a one-line labelled button at 420–900px; the Remove icon is still 24×24; a re-render (Set key / Refresh models) does **not** close an open section; first run still opens Providers; Delete needs two clicks |
| `modelsync` | `Plato's model` sticks after the host echo — tested in **both** echo shapes (legacy payload without `effectiveModel`, which is the condition the bug was reported under, and the authoritative one) |
| `core` | Role box: no clip, ~1 line slack, `maxlength` at 6 widths; wall matrix 2/3/4/5; colours do not shift on removal |
| `panels` | all three sections share one frame; marker >=16px; header >=32px; every section named; Delete separated from Refresh; add-provider inputs not clipped |
| `narrow` | no overflow, buttons one line, mode cards >=150px, 1 column <=420px / 3 at 720px |

## Playwright

`harness.mjs` resolves Playwright from `node_modules` first, then falls back to
the `npx` cache. If neither is present:

```bash
npx playwright@latest --version   # populates the npx cache
```

The suites are not part of `pnpm test` — they need a browser, and they belong on
the UI-change path, not on every unit run.
