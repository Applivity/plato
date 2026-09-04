# HANDOFF — Read me first if you are a new developer or AI agent

You are continuing **Plato**, an AI coding agent by Applivity. The founder
may not be available when you work; everything you need is in this repo.

## Read order

1. [BLUEPRINT.md](BLUEPRINT.md) — what to build and what NOT to build
2. [DECISIONS.md](DECISIONS.md) — why, and what was already debated
3. [ARCHITECTURE.md](ARCHITECTURE.md) — binding design contracts
4. [PROGRESS.md](PROGRESS.md) — the running change log (newest first)

## Current repository state (verified 2026-09-03)

- Location: `/Users/ai/Desktop/plato` (canonical remote is
  `https://github.com/applivity-com/plato`, private, default branch
  `main`). Note: `applivity-com` is a personal user account, not an org.
- **Code exists and ships.** Monorepo (pnpm workspaces):
  `packages/core` (the engine, v0.1.0) and `packages/vscode` (the VS Code
  extension shell, v0.24.0).
- HEAD (`main`) is at **D46** — home storage (`~/.plato/`) + global PLATO.md
  + ≤5 philosophers + Academy-switch fix. **Plato is a personal
  pair-programmer: it never pollutes the shared repo.** Everything Plato owns
  lives in a flat `~/.plato/` — `academy.yaml` (council), `mcp.yaml`,
  `PLATO.md` (global default), and `runs/<project-key>/` (transcripts). The
  repo is only ever read: `<repo>/PLATO.md` (project override, via
  `/system-prompt`) and `<repo>/AGENTS.md`/`CLAUDE.md`. Worker-prompt join =
  project PLATO.md > global PLATO.md > bundled default > AGENTS.md. Academy
  mode now switches without a pre-existing council (block offers "Create
  example"); philosopher cap = 5. Model (D45a-3/4): one worker + N
  philosophers; "Plato" in UI; project files always on; command surface =
  Compact · History · System prompt. Working tree clean. 178 vitest cases
  across 18 files in `packages/core`. **Deferred (recorded in DECISIONS D46):**
  per-project council/academy override ("discussion later"); move convo
  history to `~/.plato/history/` (TODO).
- Git identity on this machine: `ukhan <umair1808@gmail.com>`. The local
  repo uses `git -c user.name='plato-dev' -c user.email='plato@local'`
  when committing (see history).

## Environment prerequisites (verified facts)

- macOS. Git 2.50.1 present.
- Node.js v24.19.0 (LTS) via nvm 0.40.7; pnpm 11.23.0 global.
- If a terminal reports `node: command not found`, open a fresh terminal
  or run `. ~/.nvm/nvm.sh` first.
- Validate the whole repo with:
  `pnpm exec tsc -b --force` then `pnpm -r test` (expect 178 passing
  vitest cases across 18 files in packages/core).

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
2. **CSS octal escapes break in the style block.** The webview CSS is
   inside the same template literal. Write `\u2190` (not `\2190`).
3. **The `hidden` HTML attribute is overridden by author CSS.**
   `.ctxctl-row { display:flex }` beats the browser's `[hidden]` rule —
   always add `.foo[hidden] { display:none }` explicitly.
4. **The webview strips native `title` tooltips.** Custom hover bubbles
   are rendered as a `position:fixed` div tracked with `mousemove`
   (see the Compact-now tooltip, D42h/i).
5. **The webview has a strict CSP** (nonce-gated script, no inline
   handlers, no `eval`). All interactions use `addEventListener`; all
   host calls go through `vsapi.postMessage({ type, ... })`.
6. **No new message types without a host handler.** Webview → host uses
   messages; host → webview uses `this.panel.webview.postMessage`. Keep
   the contracts in `extension.ts` and `webview.ts` in sync.

## Verification loop (every change)

1. `pnpm exec tsc -b --force` — clean
2. `pnpm -r test` — 155/155 vitest in packages/core
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

1. **D45b — Duo customisation.** `~/.plato/duo.yaml` for the Duo
   philosopher (deferred; see DECISIONS D45b — note the config dir is now
   `~/.plato/` per D46, not `.plato/`).
2. **Chat-log message rendering.** Markdown, code blocks, tool-call
   cards, the "done in 26s · 11 tool calls · 66.7k tok" footer — the
   surfaces users actually stare at.
3. **History run-detail view.** Friendlier rendering of a run's
   transcript (turns, tool calls, costs), instead of the raw file.
4. **Small wins:** title regenerate affordance (hover rename → add
   regenerate), title-call token metering into run costs.

> Deferred for later (see DECISIONS D46):
> - **Per-project council/academy override** — "discussion later" (founder
>   deferred 2026-09-04; v1 is a single global council).
> - **Move convo history to `~/.plato/history/`** — TODO (history is in VS
>   Code workspaceState today, not the repo).

> Project-files + model + storage work shipped 2026-09-03/04: D45a-2 (0.21.0,
> `/system-prompt` PLATO.md materialization, empty-composer card), D45a-3
> (0.22.0, one worker + N philosophers lock, `includeProjectRules` removed,
> worker file-state in Orchestration, default body = identity + Karpathy),
> D45a-4 (0.23.0, "Plato" in UI, academy.yaml scoped to Academy mode), and
> **D46 (0.24.0, home storage `~/.plato/`, global PLATO.md, ≤5 philosophers,
> Academy-switch fix)**. Command surface is **Compact · History · System
> prompt**. See DECISIONS D45a-2 / D45a-3 / D45a-4 / D46.

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
