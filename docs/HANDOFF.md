# HANDOFF — Read me first if you are a new developer or AI agent

You are continuing **Plato**, an AI coding agent by Applivity. The founder
may not be available when you work; everything you need is in this repo.

## Read order

1. [BLUEPRINT.md](BLUEPRINT.md) — what to build and what NOT to build
2. [DECISIONS.md](DECISIONS.md) — why, and what was already debated
3. [ARCHITECTURE.md](ARCHITECTURE.md) — binding design contracts
4. [PROGRESS.md](PROGRESS.md) — the running change log (newest first)

## Current repository state (verified 2026-09-09)

- Location: `/Users/ai/Desktop/plato` (canonical remote is
  `https://github.com/applivity-com/plato`, private, default branch
  `main`). Note: `applivity-com` is a personal user account, not an org.
- **Code exists and ships.** Monorepo (pnpm workspaces):
  `packages/core` (the engine, v0.1.0) and `packages/vscode` (the VS Code
  extension shell, v0.25.0).
- HEAD (`main`) = **D47b** (committed 477bd43, 0.25.0). The working tree adds
  **D47c + D47d + D47e + D47f + D47g + D47h — Academy editor work, NOT yet committed**
  (same 0.25.0). D47f is the founder's UI-review pass: a complete starter
  council (`Open ACADEMY.yaml` no longer writes a hollow file), one shared
  Duo/Academy card, `Plato's model` replacing `Plato — the doer`, and a
  **stored** `color:` per philosopher so removal never re-colours the rest.
  **Plato is a personal pair-programmer: it never pollutes the shared repo.**
  Everything Plato owns lives in a flat `~/.plato/` — `DUO.yaml` (the Duo
  philosopher), `ACADEMY.yaml` (council), `mcp.yaml`, `PLATO.md` (global
  default), and `runs/<project-key>/` (transcripts). The repo is only ever
  read: `<repo>/PLATO.md` (project override, via `/system-prompt`) and
  `<repo>/AGENTS.md`/`CLAUDE.md`. Worker-prompt join = project PLATO.md >
  global PLATO.md > bundled default > AGENTS.md. Model (D45a-3/4): one worker
  + N philosophers (cap 5); "Plato" in UI; project files always on; command
  surface = Compact · History · System prompt. **D47 (0.25.0):** the in-panel
  Orchestration blocks are live editors — Duo (persona, name, role override,
  model, pause/cancel/maxInterventions) and Academy (council name + full
  per-member CRUD). `~/.plato/DUO.yaml` is the only Duo store
  (`plato.duo.persona` + `plato.observer.*` settings deleted); a missing file
  runs the built-in Aristotle default and the first edit creates it; Academy
  dropped "Create example" for the same edits-create-it editor (a one-worker
  pre-seed when no council exists). Both directions sync: edits write the
  yaml, and a host file watcher over `~/.plato/{DUO,ACADEMY}.yaml` re-reads on
  external edit/paste and refreshes the UI. Core gained a strict parser +
  loader + run-spec resolver and canonical emitters (`teams/duo.ts`,
  `teams/emit.ts`). **D47b (committed 477bd43):** store files are capitalized
  (`DUO.yaml`/`ACADEMY.yaml` — macOS is case-insensitive, so an existing
  lowercase file still works); DUO.yaml is **self-contained** — the form saves
  the effective name + role, so a created file always carries `name:`/`role:`
  (persona switch refills them while they equal the previous persona's
  defaults; hand-edits survive; clearing restores the persona); **Open DUO.yaml
  with no file creates it** and opens it; UI: compact switch toggles, per-
  control '?' tooltips, Open-file buttons matching Open PLATO.md, Academy
  member cards fixed (generic `.mrow` flex collision → cards are block, model
  on its own row), 'Max/run' → 'Max interventions'.
  **D47f (committed with this bundle) — founder UI-review pass:** `Open
  ACADEMY.yaml` used to write a **hollow** council (no `role`, no powers — the UI
  faked the role from the persona, so the file was incomplete while the panel
  looked right); the seed now writes role + powers + colour, and `save()` stores
  the effective role (the D47b rule, applied to Academy). **Add philosopher**
  defaults to the first *unused* persona, so a new card is never blank. One
  **shared card builder** now serves both Duo and Academy — header = colour dot +
  display name + Remove (far right); body = **Persona → Role → Model → Powers**.
  `Plato — the doer` → **`Plato's model`**. The PLATO.md explainer moved behind a
  `?`. `Lyceum` is pre-filled. Each philosopher carries a **stored `color:`** (5
  pastels) so removing one **never re-colours the rest** — shown in the Settings
  card, the chat notices and the run-start team card.
  **D47g (committed with this bundle) — Role field + the two walls:** the Role box
  **auto-fits its text plus exactly one line** and re-fits on panel-width change
  (a fixed `min-height` was clipping ~2.5 lines at a 420px panel); a
  **1,000-char cap** is enforced by both parsers, both schemas and `maxlength`
  (a role is sent on every observer call), with a counter at the top-right of the
  label row; a stray Enter no longer produces an unparseable file (`oneLine()`
  folds whitespace in the emitter and the webview); the Remove control is now a
  **`✕`** (the old `.btn-icon-danger` class never matched what `sbtn` emitted, so
  the browser painted a default white button) and both walls behave alike —
  drawn always, `aria-disabled` at the 2-philosopher floor.
  **D47h (committed with this bundle) — the doer model select + the narrow panel:**
  changing `Plato's model` in Duo/Academy snapped back to the composer's value,
  because the doer select posted to the host but **never wrote the shared value**
  (the composer does `setModelSelected` *then* posts). The host accepted the new
  model, echoed its state, and the preserve logic re-applied the stale value. The
  doer select now updates first, exactly like the composer. `postModelState()`
  also carries an authoritative `effectiveModel` the webview adopts, so the panel
  can never show a model the run would not use. The Settings panel no longer
  overflows at a narrow column: `.modes` auto-fits (1 column narrow, 3 wide),
  `.sblock label` no longer forces `min-width:140px`, and the project-file /
  Duo-Academy header rows wrap so `Open …` buttons keep their label on one line.
  **D47i (committed with this bundle) — one Settings surface:** the founder saw
  Orchestration as "a different panel" from the other two, and that was literally
  true — measured, it was a bare DIV with **no border and no radius** while
  Providers and Context were framed DETAILS sections. All three now share one
  shell (same border, radius, background, header bar); Orchestration keeps its
  always-open behaviour through a `.sec-static` header that does not pretend to
  toggle. The disclosure markers went from a 13px glyph to a 16px glyph in a 16px
  hit area, the header bar grew to ~35px, the nested `.sblock` was dropped so all
  sections share one nesting depth, and Delete is now pushed behind a divider so
  it no longer reads as part of the Set key / Refresh group. The `Add a provider`
  inputs no longer clip (the `130px 1fr` grid was hard-coded **in JS** as well as
  CSS). **Layout trap recorded:** `repeat(auto-fit, minmax(190px, 1fr))` still
  overflows a container narrower than 190px; the floor must be
  `min(190px, 100%)`.
  **D47l (working tree) — the API key is entered in the panel:** `Set key` used a
  native `showInputBox`, so the same action had two surfaces (`Add a provider`
  was already inline) and the focus loss made the section appear to collapse. It
  now toggles an inline password field with Save/Cancel (Enter saves, Escape
  cancels). A new `settings-set-key` message stores into SecretStorage and
  refreshes the model list; the value is never echoed back and the input is
  cleared on send. The command palette keeps the native box by design.
  **D47k (committed 6f15e52) — Add connection closed Providers:** the D47j
  restore keyed on the section's summary TEXT, which for Providers embeds a live
  count, so it stopped matching for the one action that changes it. Sections now
  carry a stable `data-sec` id.
  **D47c (working tree):**
  founder priority — the Academy editor was "utterly disappointing". Academy
  got the polish Duo got in D47b and then some: `open-academy` **creates on
  open**; cards lead with an identity chip and a matching left border; `Remove`
  is pushed to the far right; tool-summary chip gained a total and a label.
  **D47d (working tree) — Academy = Duo + council:** the founder did not accept
  a visible worker section in Academy, and asked what a philosopher with every
  power off could even do. Re-read of the D45a-3 thesis showed the UI
  contradicted it. **guidance is always on** (Duo parity; Powers = May pause +
  May cancel, so a mute philosopher is impossible); Academy cards gained a
  **persona picker** (`persona` is a real optional `TeamMember` field);
  **council = 2..5 philosophers** with **Aristotle + Pythagoras** seeded by
  `defaultAcademyMembers()`; council name sits beside the `Academy` title
  (D47f: **pre-filled `Lyceum`** for a starter council, no longer a placeholder).
  **D47e (working tree) — the fail-proof upgrade:** D47d's B1 (hide the worker,
  warn on a hand-edited deviation) still left the doer silently overridable, so
  the worker is **removed from the format**. `ACADEMY.yaml` carries philosophers
  only; `TeamMember.kind` is the literal `'philosopher'`; the parser rejects
  `kind: worker` loudly and `finishTeam` enforces **2–5 philosophers**. Plato is
  the doer in every mode (run path = `effectiveModel()`; the `workerMember`
  lookup is deleted, along with its `role` override — accepted). A **`Plato's
  model` select** (renamed from `Plato — the doer` in D47f) sits in the Duo and Academy blocks and is the *same
  session-wide value* as the composer picker (two views, no pin, no grey-out).
  Never revert D47e without re-adding a visibility mechanism.
  **Recorded for a later debate:** the
  `personas.ts` role prompts may be too weak for real agentic flow.
  **Deferred (DECISIONS D47c):** true interleaved tool-call cards
  need host-side reply segmentation, not styling. 219 vitest cases across 21
  files in `packages/core`.
  **Deferred (recorded in DECISIONS D46):** per-project council/academy
  override ("discussion later"); move convo history to `~/.plato/history/`
  (TODO).
- Git identity on this machine: `ukhan <umair1808@gmail.com>`. The local
  repo uses `git -c user.name='plato-dev' -c user.email='plato@local'`
  when committing (see history).

## Environment prerequisites (verified facts)

- macOS. Git 2.50.1 present.
- Node.js v24.19.0 (LTS) via nvm 0.40.7; pnpm 11.23.0 global.
- If a terminal reports `node: command not found`, open a fresh terminal
  or run `. ~/.nvm/nvm.sh` first.
- Validate the whole repo with:
  `pnpm exec tsc -b --force` then `pnpm -r test` (expect 219 passing
  vitest cases across 20 files in packages/core).

## How the packages connect

- `packages/core` — pure logic, no VS Code imports. Providers
  (`anthropic-native`, `openai-compat`, discovery, registry), runtime
  (`loop`, `context`, `bus`, `modes`, `observer`, `solo`, `transcript`,
  `cost`), plus `format`, `tools`, `mcp`, `teams`, `security`. The test
  suite lives at `packages/core/test/*.test.ts`.
- `packages/vscode` — thin shell. `src/extension.ts` is the VS Code host
  (commands, webview wiring, settings, workspace/secret storage, the
  chat `run()` loop orchestration, conversation-title generation,
  session archiving). `src/webview.ts` is a **single giant template
  literal** containing the entire webview HTML + CSS + inline JS.
- `packages/vscode/scripts/extract-inline.cjs` — repo gate: extracts the
  inline `<script>` from the webview bundle and runs `node --check`
  against it.

## Critical gotchas

1. **webview.ts is one giant template string.** A stray backtick inside a
   JS comment or string literal closes the template and breaks the
   build. `tsc -b` usually catches it; always run it after editing.
   **Backslashes are eaten too:** `\s` written on one line here compiles
   to `/s+/` — which matches the letter *s* and silently does nothing.
   Write `\\s`. `tsc` does NOT catch this one, because `/s+/` is valid
   syntax. Caught the hard way in D47g; a unit test now asserts the
   escaped form in `colors.test.ts`. Existing regexes in the file use
   character classes (no backslash), which is why nothing exposed it.
2. **CSS octal escapes break in the style block.** The webview CSS is
   inside the same template literal. Write `\u2190` (not `\2190`).
3. **The `hidden` HTML attribute is overridden by author CSS.**
   `.ctxctl-row { display:flex }` beats the browser's `[hidden]` rule —
   always add `.foo[hidden] { display:none }` explicitly.
4. **The webview strips native `title` tooltips.** Custom hover bubbles
   are rendered as a `position:fixed` div tracked with `mousemove`
   (see the Compact-now tooltip, D42h/i).
5. **An uncaught error in `showSettings` silently aborts the rest of the
   render.** The page still loads, so nothing looks broken — but the sections
   after the throw never appear and the state restore never runs. A D47i
   `appendChild` of a node into its own parent shipped this way and killed the
   Context section for a whole pass. Every render suite now fails on ANY
   uncaught page error, and asserts all three sections exist.
6. **Never key persistent UI state on displayed text.** The Providers summary
   embeds a live count ("Providers — 1 configured"), so the D47j restore that
   matched on summary text silently missed for the one action that changes the
   count (Add connection) while appearing fixed for the others. Use a stable
   `data-*` id — see `data-sec`.
7. **Assert the requirement, not the absence of a symptom.** "Nothing overflows"
   PASSED against three 67px mode cards, because cramming does not overflow. The
   assertion that works is "each mode card keeps a usable width >= 150px". When a
   fix lands, revert it and confirm the test fails — otherwise the test is not
   evidence.
8. **The webview has a strict CSP** (nonce-gated script, no inline
   handlers, no `eval`). All interactions use `addEventListener`; all
   host calls go through `vsapi.postMessage({ type, ... })`.
6. **No new message types without a host handler.** Webview → host uses
   messages; host → webview uses `this.panel.webview.postMessage`. Keep
   the contracts in `extension.ts` and `webview.ts` in sync.

## Verification loop (every change)

1. `pnpm exec tsc -b --force` — clean
2. `pnpm -r test` — 219/219 vitest in packages/core
3. `cd packages/vscode && pnpm run bundle && node scripts/extract-inline.cjs
   && node --check ../../tmp/plato-inline.js` — bundle + inline JS syntax
4. `cd packages/vscode && pnpm run package` — produces
   `plato-vscode-0.16.0.vsix`
5. `cd packages/vscode && pnpm run install:vsix` — installs into the
   running VS Code
6. Reload the VS Code window (Cmd+Shift+P → "Developer: Reload Window")
7. Update PROGRESS.md (newest-first row) and DECISIONS.md when the
   change warrants a decision; commit.

## Shipped this session (D37 → D43, 0.16.0)

- **D37** — context management: model max-context (catalog
  `maxContextFor()` + opportunistic discovery `fetchModelPool()` from
  Anthropic/OpenRouter), running-context **ring** in the composer with a
  hover breakdown, agentic/manual **compaction** (`compactMessages()`
  in core, auto-trigger threshold, manual via the ring's controls).
- **D38/D38b** — Settings rewrite: 3 sections (Orchestration, Providers,
  Context), connection cards, button taxonomy, `install:vsix` script.
- **D39 → D39g** — composer redesign: custom model + mode pickers with
  popovers, header restructure, history+settings nav pairing, header
  pills, headnav restyle.
- **D39e/f** — ring inside the textarea (top-right), mode colors
  (plan=green, edit=blue, act=orange, auto=purple), full-width textbox,
  border truncation fix.
- **D40 → D40c** — model-generated conversation titles, new-chat button
  to the right, compact label removed, title-call tools fix.
- **D41** — history archives on panel close, title generates early.
- **D42 → D42i** — title survives reasoning models, History shows the
  current chat, history-dispatch fix, tooltip hover/click behavior,
  compaction-control alignment, custom tooltip.
- **D43** — empty first-run + provider onboarding: seeded
  anthropic/openai connections removed; friendly empty composer state
  with a Connect CTA when no provider exists; onboarding card in
  Settings → Providers; Base URL field hidden for the Anthropic/OpenAI
  presets.

## Queued next work (in priority order — pick up here)

0. **Close D47c–h** (committed with this doc bundle).
   Founder visual sign-off on the reload is what gates the *next* milestone —
   check Academy at a **narrow** panel width (that is where the D47g Role-box
   clip and the D47h overflow lived) and confirm: Academy shows only philosophers;
   changing `Plato's model` **sticks** and stays in sync with the composer; Powers
   = pause/cancel; the council is pre-filled `Lyceum`; a starter council seeds
   Aristotle + Pythagoras; the `✕` is drawn on every card and disabled at 2; the
   Role counter reads `n / 1000`; and the mode cards stack to ONE column when the
   panel is narrow.
1. **Chat-log message rendering.** Markdown, code blocks, the
   "done in 26s · 11 tool calls · 66.7k tok" footer, and the labelled
   tool-summary chip already ship (core `renderMarkdown` + `.md-*` CSS +
   the done line + D47c's chip). What remains is *interleaving* — see the
   deferred note below.
2. **History run-detail view.** Friendlier rendering of a run's
   transcript (turns, tool calls, costs), instead of the raw file.
3. **Small wins:** title regenerate affordance (hover rename → add
   regenerate), title-call token metering into run costs.

> Deferred — recorded so it is not mistaken for a CSS job:
> - **True interleaved tool-call cards in the live log.** The host streams one
>   cumulative markdown blob per turn into a fixed `#streaming` element, so
>   tool summaries land below the whole reply rather than in place. Fixing this
>   needs **host-side reply segmentation** (a new segmented `md` contract), not
>   styling. The History run-detail view is the cheaper place to get correct
>   ordering first. See PROGRESS 2026-08-26 (0.7.5) known-limitation note.

> Deferred for later (see DECISIONS D46):
> - **Per-project council/academy override** — "discussion later" (founder
>   deferred 2026-09-04; v1 is a single global council).
> - **Move convo history to `~/.plato/history/`** — TODO (history is in VS
>   Code workspaceState today, not the repo).

> Project-files + model + storage work shipped 2026-09-03/04: D45a-2 (0.21.0,
> `/system-prompt` PLATO.md materialization, empty-composer card), D45a-3
> (0.22.0, one worker + N philosophers lock, `includeProjectRules` removed,
> worker file-state in Orchestration, default body = identity + Karpathy),
> D45a-4 (0.23.0, "Plato" in UI, academy.yaml scoped to Academy mode),
> **D46 (0.24.0, home storage `~/.plato/`, global PLATO.md, ≤5 philosophers,
> Academy-switch fix)**, and **D47 (0.25.0, Duo + Academy Settings editors
> over yaml — ~/.plato/duo.yaml single store, edits-create-it, file-watcher
> sync)**. Command surface is **Compact · History · System
> prompt**. See DECISIONS D45a-2 / D45a-3 / D45a-4 / D46 / D47.

## Ground rules for any agent working here

- Surgical changes only; touch only what the current milestone requires.
- Every milestone ends in something runnable — demo it, then commit.
- Do not add features from the non-goals list in BLUEPRINT section 3.
- If a design contract in ARCHITECTURE.md conflicts with reality, stop
  and record the proposed change in DECISIONS.md before deviating.
- Match existing conventions; no new frameworks/libraries without a
  recorded reason.
- **Customisation principle (D45c): UI first, yaml as backup.** Every
  user-facing knob must be discoverable and editable in the in-panel UI
  before (or in the same milestone as) the underlying yaml is read. Yaml
  is the power-user fallback, not the primary surface.
- **Pre-release (D45d): no legacy/migration support.** Plato is not
  shipped; moving a customisation between surfaces needs no migration
  path or deprecation cycle — record the move in DECISIONS and go.

## Non-negotiable safety rules

- API keys: SecretStorage only. Never logs, transcripts, settings, or
  commits.
- Never send `keystore.properties`, `local.properties`, `.env*`,
  `*.keystore`, or any `.gitignore`d file content to a model.
- Repo stays private; no public release, license text, or marketplace
  publish before the M4 license decision by the founder.

## Key external identities

| Thing | Value |
|---|---|
| GitHub org | applivity-com |
| Marketplace publisher | `applivity` (alias parked: `applivityllc`) |
| npm org | `applivity` |
| Proving-ground repo | `/Users/ai/Desktop/HcadPublicAndroid-demo` |
