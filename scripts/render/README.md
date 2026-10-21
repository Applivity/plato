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

## The three rules that make these honest

1. **Every suite fails on ANY uncaught page error.** An exception inside
   `showSettings` stops the remaining render, so a partially-built page must be a
   hard failure, not a quiet one.
2. **Assert the requirement, not the absence of a symptom.** My first narrow-layout
   test only checked "nothing overflows" — and it *passed* against three 67px
   columns, because cramming does not overflow. The assertion that works is "each
   mode card keeps a usable width".
3. **Every suite must end by calling `finish(tag)` (D49a).** Until D49a a suite
   ended with a bare `console.log(... PASS/FAIL ...)` and nothing set
   `process.exitCode`, so a suite printing `FAIL: 12` still exited **0** — and
   `run.mjs`, which decides on exit status alone, printed *ALL RENDER SUITES PASS*.
   The `OK`/`FAIL` lines on stdout were the only signal, and they scroll away.

   `finish()` prints the verdict, closes the browser, and sets the exit code from
   the shared `counters`. **Never print the verdict or close the browser by hand,
   and never define a local `check`/counter** — that is exactly how `modelsync` and
   `panels` drifted onto a second, invisible failure counter.

All three were proven by breaking the thing and watching the run fail. Do the same
for every new assertion: revert the fix, confirm the suite fails, restore it.

## Driving the UI, not just rendering it

Assertions that only read the DOM after a render cannot see a broken handler. A
control can render perfectly and do nothing. `providers.mjs` is the template for
the stronger check — it fills the Add-connection form, clicks, and then asserts
the host message that resulted: **type into the control, fire its real event,
then read back the message the webview posted** (`window.__posted`, stubbed in
`page()`). Do that for anything with behaviour behind it.

**And look at the screenshot.** `p.screenshot({ path: '/tmp/….png' })` costs
nothing. This is not polish — it is a distinct check that assertions cannot
replace. The D49h budget row passed every assertion in its suite while its live
label sat hard against its field and the row above it right-aligned, so two rows
of one section disagreed about where the value goes. No assertion said where the
label should *be*. A screenshot caught it in one glance, at 720px and at 300px.
Render, assert, then LOOK.

## Adding a suite

Import everything from `plib.mjs` — the browser, `check`, `page()`, and `finish`.
Do not import `harness.mjs` directly and roll your own browser: the whole point of
`plib` is that there is one counter and one build. Add the suite name to
`SUITES` in `run.mjs`.

`run.mjs` now builds **once** for the whole run and tells the children so with
`PLATO_RENDER_PREPARED=1`. A suite run on its own prepares the HTML itself.

## Suites

| Suite | Covers |
|---|---|
| `providers` | sections all render; no page errors; Delete is a one-line labelled button at 420–900px; the Remove icon is still 24×24; a re-render (Set key / Refresh models) does **not** close an open section; first run still opens Providers; Delete needs two clicks |
| `modelsync` | `Plato's model` sticks after the host echo — tested in **both** echo shapes (legacy payload without `effectiveModel`, which is the condition the bug was reported under, and the authoritative one) |
| `core` | Role box: no clip, ~1 line slack, `maxlength` at 6 widths; wall matrix 2/3/4/5; colours do not shift on removal |
| `panels` | all three sections share one frame; marker >=16px; header >=32px; every section named; Delete separated from Refresh; add-provider inputs not clipped |
| `narrow` | no overflow, buttons one line, mode cards >=150px, 1 column <=420px / 3 at 720px |
| `history` | the empty Runs state names the real (`~/.plato/runs/`) transcript location, not the pre-D46 repo-relative path |
| `cmdbutton` | the `/` button (D49bl): the glyph is a **forward** slash and not a backslash — asserted as a **property** (the higher end is on the right), so a redraw with different numbers still passes — it is centred in a rounded square, it is at least the size of the paperclip beside it, and clicking it opens the command menu with rows in it and closes it again. **The table above lists 7 of the 24 suites that exist**; the other 17 are named in `SUITES` in `run.mjs` and documented at the top of their own files. |
| `queue` | the held follow-ups (D49bo): the list is visible, in order and numbered; each one can be taken back before it is sent; **removal posts the index and does NOT edit the row here**, because the host is authoritative and a local edit would take out the wrong message; an empty queue shows no row; `Start` appears only while the queue is HELD; a restored panel draws the queue it is sent; and a long message does not push the panel sideways. Also the **typed** path — `runstatus` covers the pause label states (D49bm): `Pause` → `Pausing…` → `Resume`, the status line saying `Paused`, and the click on `Pausing…` taking the request back. |

## Playwright

`harness.mjs` resolves Playwright from `node_modules` first, then falls back to
the `npx` cache. If neither is present:

```bash
npx playwright@latest --version   # populates the npx cache
```

The suites are not part of `pnpm test` — they need a browser, and they belong on
the UI-change path, not on every unit run.
