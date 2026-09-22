# HANDOFF — Read me first if you are a new developer or AI agent

You are continuing **Plato**, an AI coding agent by Applivity. The founder
may not be available when you work; everything you need is in this repo.

## Read order

1. **This file** — what is true *now*, and how to work here.
2. [PROGRESS.md](PROGRESS.md) — the running change log, newest first. **The
   D-series history lives there.** Do not re-narrate it in this file.
3. [DECISIONS.md](DECISIONS.md) — why, and what was already debated. Each `D#`
   is a locked decision; later entries supersede earlier ones explicitly.
4. [BLUEPRINT.md](BLUEPRINT.md) — **historical.** The founding design record
   (the Q1–Q22 interview), kept verbatim. Read its status banner before its body.
5. [ARCHITECTURE.md](ARCHITECTURE.md) — **historical.** The v0.1 target. Same
   banner; the parts that still bind are named there.

**Ownership rule (D48):** every fact has exactly one home — *current state* →
this file, *what changed* → PROGRESS, *why / what is locked* → DECISIONS. When
something goes stale, fix it where it lives instead of restating it elsewhere.
This file used to carry the whole D47 series and `D37 → D43` release notes; both
are now only in PROGRESS.

## Current state (verified 2026-09-21)

- Location: `/Users/ai/Desktop/plato`. Canonical remote
  `https://github.com/applivity-com/plato` (private, default branch `main`;
  `applivity-com` is a personal user account, **not** an org).
- Monorepo (pnpm workspaces): `packages/core` — the engine, v0.1.0, **no VS Code
  imports** — and `packages/vscode` — the extension shell, **v0.25.0**. There is
  no `packages/cli` yet (phase 2).
- HEAD = **M5.0 / D49p (amended twice on 2026-09-21)** — Phases 0–5 of the agent
  capability plan are **complete** (roadmap in DECISIONS **D49**). Push stays
  with the founder. Working tree clean.
- **`web_fetch` sends nothing without consent, and that is enforced by a KIND
  (D49p).** `net` is the only tool kind that returns `ask` in **every** mode,
  `auto` included — egress cannot be un-sent. **An approval covers ONE HOST**:
  session approval is keyed **`tool:host`**, not on the tool, so "approve all
  requests to `docs.example.com` this session" cannot widen to every later host
  (keyed on the tool it could — a hole that already existed). **Redirects are
  followed, and every hop is validated.** The request is issued with
  `redirect: 'manual'` so the HTTP layer cannot follow anything itself — the walk
  is ours, bounded at 5 hops, or no hop gets checked. **A hop onto a private,
  loopback or link-local address is REFUSED**, while **a URL the user was shown
  and approved is never refused on its address** — the card prints what the
  address means instead. That asymmetry is the decision: a hop is chosen by a
  *page*, so consent does not cover it; consent covers what the user saw. **The
  check is literal**, so a *name* that resolves to a private address is followed —
  recorded, not implied. **The domain allow/deny lists were DELETED** (2026-09-21):
  they could only ever subtract, because `web_fetch` always asks, and other agents
  ship no such UI. Do not re-add them without reading D49p. **Script and style
  bodies are removed WITH their contents** — tags alone would leave a page's
  JavaScript in the prompt as prose. **`web_search` does not exist and must not be
  added without reading D49p**: Anthropic's server-side search needs no key, but
  it runs inside the API call, so **no approval card can fire** — it would break
  the always-ask rule.
- **A tool result must answer a tool call, so compaction may not cut inside an
  exchange (D49r).** `compactionSplit` sliced by COUNT alone, so a cut landing inside
  a tool exchange stranded the results with no `tool_calls` above them — and a strict
  server rejects that outright rather than guessing. **This killed the first real run**
  (`openai HTTP 400: Messages with role 'tool' must be a response to a preceding
  message with 'tool_calls'`). The cut now walks back until the kept tail can stand
  alone, keeping fewer messages than asked. **Anthropic enforces the same rule**, so
  this was never OpenAI-specific. **Related, open, and NOT fixed:** a model name
  outside the catalog is assumed to hold only **8,192 tokens**, so compaction fires
  very early for any LiteLLM group or custom model — see the PROGRESS backlog.
- **Images can be attached, and the rules around them are not obvious (D49n/o).**
  A new `image` member on `CanonicalContent` (`ImageMime` = the four types both
  wires accept; base64 with **no `data:` prefix**). **The MIME is sniffed from the
  BYTES, never the extension**; the *name* only decides whether to try. **Never
  put base64 on the bus or in a prompt** — the transcript writes every event
  verbatim, and the token estimate for an image is a flat constant because
  chars/4 over base64 would price a 1 MB screenshot at ~350k tokens and make the
  compaction trigger fiction. **The OpenAI adapter drops an unknown block
  silently** (it guards each block explicitly), so a new content member must be
  checked there as well as in the Anthropic fallthrough.
- **A file tool may only touch the workspace (D49k).** Before it, **no tool
  enforced this** — `write_file {path: '../../../../tmp/x'}` created a file
  outside the root, and in `auto` mode writes need no approval. The rule lives in
  `security/paths.ts`; the executor resolves every path argument through one
  choke point, and the loop also refuses before asking for approval (the
  executor is the guarantee, the loop is the courtesy). **`pathArgsOf` is the
  single source of truth for which argument is a path** — do not add a
  path-taking tool without adding it there. `shell` is deliberately NOT covered.
- **The tool surface grew (D49l/m).** `grep` takes `regex`/`glob`/`mode`/`limit`
  and is **literal unless `regex: true`**; new `glob` (find files by name — a
  pattern with **no slash matches the basename**, so `*.ts` works at any depth);
  `list_dir` takes a path; `apply_diff` takes a per-block `replace_all` (**it
  needs split/join, not `String.replace` — `$&` in a replacement would be
  substituted**); new `apply_patch` is atomic across files; and `shell` takes
  `run_in_background` with `bash_output`/`kill_shell`. **`decide()` denies a tool
  with no kind in every mode**, so a tool must be added to `TOOL_KIND` (tsc
  enforces this) *and* declared in `schemas.ts` (a test enforces the other
  direction).
- **Background shells stop when the run ends (D49m).** There is no UI that lists
  them, so an orphan would be invisible and unstoppable. `kill_shell` signals the
  process **group** — killing only the shell orphans whatever it spawned.
- **The reply now streams (D49j).** `TurnRequest.onDelta` is optional; absent, the
  adapters make the blocking call exactly as before, so every test fake and the
  compactor/observer are untouched. **The assembled `TurnResponse` is IDENTICAL
  either way** — streaming changes only *when* the text is visible. The Anthropic
  path uses `messages.stream()` + `finalMessage()` and maps through the same
  `mapMessage`; the OpenAI-compatible path rebuilds the non-streaming JSON shape
  from SSE and maps through the same `mapResponse`. **Three things not to
  re-derive:** the loop keeps a **fresh text accumulator per attempt** (a shared
  one turns a retried turn into `"HelHello"`); the **content-type guard** is what
  stops a server that ignores `stream: true` from returning a silently empty
  answer; and the host's streaming text is a **preview that a committed block
  supersedes** (never appended to, or the turn's text shows twice). `onDeltaText`
  gets the text **so far**, not the newest fragment. Deltas deliberately do **not**
  ride the bus — `transcript.ts` writes every event verbatim.
- **A transient provider failure no longer ends a run (D49f).** The worker turn
  retries 429 / 5xx / transport failures with backoff. A 4xx other than 429 is
  *not* retried — it would fail identically. **Caveat:** the retry notice is
  emitted on the bus, and bus `notice` events are **log-only** — the extension
  never `send()`s them — so it is visible after a reload, not during the run.
  Recorded in the PROGRESS backlog with the reason it is not a one-line fix.
- **The stable prefix is cached (D49g).** The system prompt and tool schemas are
  marked cacheable. **`inputTokens` is a TOTAL** (Anthropic reports it net of
  cache, OpenAI gross) — do not map either straight through, or the context ring
  and the cost will disagree between providers.
- **Cancel now aborts the call in flight (D49i).** `RunController.cancel()`
  aborts a signal threaded through `TurnRequest` to both HTTP layers. **An abort
  and a transport failure look identical** (status `null`, which is retryable),
  so both the retry policy and the loop's catch have to special-case it — a
  cancel must never be answered with retries or reported as a failure.
- **The render suites now FAIL THE PROCESS on a failed assertion (D49a).** Until
  D49a they could not: `check()` only logged, and no suite set `process.exitCode`,
  so a suite printing `FAIL: 12` exited 0 and the run still ended **ALL RENDER
  SUITES PASS**. Treat any "ALL RENDER SUITES PASS" claim older than D49a as
  evidence of *no uncaught exception* only — not of passing assertions.
- **The tool surface changed this phase (D49b–d).** `write_file` always writes an
  existing **empty** file and needs `overwrite: true` to replace a non-empty one;
  `read_file` takes `offset`/`limit` and never truncates silently; and a provider
  failure now arrives as a typed `ProviderError` carrying the HTTP status.
- **What Plato is: a personal pair-programmer that never pollutes the shared
  repo.** Everything Plato owns lives in a flat `~/.plato/`: `ACADEMY.yaml` (the
  council), `DUO.yaml` (the Duo philosopher), `mcp.yaml`, `PLATO.md` (global
  default), and `runs/<project-key>/` (transcripts; the key is an 8-char sha1 of
  the workspace root). The repo is only ever **read**: `<repo>/PLATO.md` (project
  override, materialised by `/system-prompt`) and `<repo>/AGENTS.md` / `CLAUDE.md`.
- **Product model (D45a-3/4, D47e): one worker + N philosophers.** Solo / Duo /
  Academy are the *same* worker with 0 / 1 / N philosophers watching and steering;
  cap is 5. The acting agent is "**Plato**" in all user-facing copy ("worker" is
  the internal term). `ACADEMY.yaml` carries **philosophers only** — Plato is
  always the doer — and the doer model is one session-wide value with two views
  (the composer picker and the `Plato's model` select). **Never add a per-member
  *behavioural* field back (a model, a role override) without also adding a way
  to see it** — D47e removed the worker precisely because a hidden doer could be
  silently changed by a hand-edited file, and the UI could not show the
  difference.
- **Worker prompt join:** project `PLATO.md` > global `~/.plato/PLATO.md` >
  bundled default > `AGENTS.md` / `CLAUDE.md`. Project files are always on when
  present — **file presence is the switch**.
- **Command surface:** Compact · History · System prompt.
- **Duo + Academy are edited entirely from the Settings UI** (D47), with the yaml
  as the single store and two-way sync: edits write the file, and a host file
  watcher over `~/.plato/{DUO,ACADEMY}.yaml` re-reads external edits. Editing
  creates the file; a missing `DUO.yaml` runs the built-in Aristotle default.
- Git identity: this machine is `ukhan <umair1808@gmail.com>`; commits in this
  repo use `git -c user.name='plato-dev' -c user.email='plato@local'`.

## M4 closeout — what is actually left

M4 is *not* done. Its definition of done is the acceptance test in BLUEPRINT §4,
and **that test has not been run** — no run of it is recorded anywhere in the
docs, and the blueprint's version of it (architect → coder → Socrates) predates
the product lock, so it needs restating for one-worker-plus-philosophers first.
Open, in priority order:

1. **The acceptance test** — restate it for the current model, then run it on
   `/Users/ai/Desktop/HcadPublicAndroid-demo`.
2. **Secret audit** (D15) — everything that leaves the machine: repo history,
   VSIX/npm artifacts, transcripts, docs, screenshots, demo repos.
3. **Trademark sweep** (D16) and the **license decision** (D19).

Everything else in M4 (packaged VSIX, onboarding, the whole D44–D47 UI series)
has shipped; the code is well past the `0.9.8` that PROGRESS's milestone table
used to claim.

## Environment prerequisites (verified facts)

- macOS. Git 2.50.1 present.
- Node.js v24.19.0 (LTS) via nvm 0.40.7; pnpm 11.23.0 global.
- If a terminal reports `node: command not found`, open a fresh terminal
  or run `. ~/.nvm/nvm.sh` first.
- Validate the whole repo with:
  `pnpm exec tsc -b --force` then `pnpm -r test` (expect **422** passing
  vitest cases across **32** files in packages/core).
- Validate the **UI** separately with the render suites (they need a headless
  browser, so they are not part of `pnpm test`): `pnpm run render` (builds first)
  or `pnpm run render:fast` (reuses the bundle). `pnpm run verify` runs build +
  unit tests + render suites. Nine suites, **191 assertions**; see
  `scripts/render/README.md` — every suite fails on ANY uncaught page error, and
  since D49a a **failed assertion also fails the command**. That README also says
  how to **drive** a control (type into it, fire its real event, read back the
  message it posted) rather than only rendering it, and why the screenshot is
  part of the check.
- Validate the **provider adapters against the real SDK** with
  `node scripts/smoke-stream.mjs`. The unit tests **mock** `@anthropic-ai/sdk`,
  so they prove the adapter's wiring but not that the installed SDK behaves as
  assumed. This points the real SDK at a local SSE stub via `ANTHROPIC_BASE_URL`
  and checks that deltas arrive separately through `stream.on('text')`, that
  `finalMessage()` assembles them, that streamed equals blocking, and that an
  abort rejects instead of hanging. Needs `packages/core/dist` built
  (`pnpm exec tsc -b packages/core`). Use this pattern for any future claim about
  an SDK's behaviour.

## How the packages connect

- `packages/core` — pure logic, no VS Code imports. Providers
  (`anthropic-native`, `openai-compat`, `errors`, discovery, registry), runtime
  (`loop`, `context`, `bus`, `modes`, `observer`, `transcript`, `cost`,
  `commands`, `workerRole`), plus `format`, `tools`, `mcp`, `teams`, `security`.
  The test suite lives at `packages/core/test/*.test.ts`.
- `packages/vscode` — thin shell. `src/extension.ts` is the VS Code host
  (commands, webview wiring, settings, workspace/secret storage, the
  chat `run()` loop orchestration, conversation-title generation,
  session archiving). `src/webview.ts` is a **single giant template
  literal** containing the entire webview HTML + CSS + inline JS.
- `packages/vscode/scripts/extract-inline.cjs` — repo gate: extracts the
  inline `<script>` from the webview bundle and runs `node --check`
  against it.
- `scripts/render/` — the real-DOM render suites (`pnpm run render`). Nine
  suites driving the actual webview in headless Chromium. They exist because
  `tsc` and the unit tests cannot see the rendered page; see its README for the
  list of defects they caught.

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
   evidence. Watch the **substring trap** too: D47n's check had to strip the
   *correct* string before searching for the stale one, because `~/.plato/runs/`
   contains `.plato/runs/`.
8. **The webview has a strict CSP** (nonce-gated script, no inline
   handlers, no `eval`). All interactions use `addEventListener`; all
   host calls go through `vsapi.postMessage({ type, ... })`.
9. **No new message types without a host handler.** Webview → host uses
   messages; host → webview uses `this.panel.webview.postMessage`. Keep
   the contracts in `extension.ts` and `webview.ts` in sync.
10. **Live copy must name the real location (D47m/n).** A user-facing string
    that names a path is a claim about where the user's data is. Three defects
    shipped this way — a mode card naming `.plato/ACADEMY.yaml`, the History
    empty state, and the `TranscriptWriter` header comment. Ask whether the
    path is current *and* whether the surface should name a path at all.
11. **A suite that cannot fail is not evidence (D49a).** For the whole D47 series
    the render suites printed `FAIL: n` and still **exited 0**, so `run.mjs`
    reported **ALL RENDER SUITES PASS** either way. Two suites had also grown
    their own browser and their own private failure counter. Every suite now ends
    with `finish(tag)` from `plib.mjs`, which sets `process.exitCode` from the one
    shared `counters`. **Never print the verdict or close the browser by hand, and
    never define a local `check`** — that is exactly how the two counters drifted.
    When you add an assertion, break the thing it guards and watch the command
    fail, or you have not verified anything.
12. **An abort and a transport failure are indistinguishable (D49i).** Both reach
    the loop as `ProviderError` with status `null`, and status `null` is
    deliberately **retryable** (D49f). So cancellation must be special-cased in
    **two** places or it misbehaves in both directions: `withRetry` refuses to
    retry once the signal aborts, and the loop's catch checks `signal.aborted` to
    end as `cancelled` instead of reporting a failure. **Phase 2 sharpened it as
    predicted** (D49j): a stream that died and a stream the user cancelled look
    identical, and the streaming error path had to consult the signal before
    deciding what happened — `finalMessage()` rejects on abort, so an aborted
    stream reaches the same catch as a network failure. Getting it wrong is not a
    crash; it is a truthful-sounding lie ("provider request failed") about
    something the user did on purpose.
13. **Streaming changes WHEN the text is visible, never WHAT it says (D49j).**
    Three traps, all found by falsification rather than review. **(a) A shared
    text accumulator turns a retried turn into `"HelHello"`** — text the model
    never produced — so the loop resets it *per attempt* and passes the text **so
    far**, not the newest fragment. **(b) A server that ignores `stream: true` and
    answers with plain JSON yields a silently EMPTY answer** unless the response
    `content-type` (not the request flag) decides the parse path. **(c) A
    committed block must SUPERSEDE the streaming preview, never follow it**, or
    the turn's text is shown twice. Also: deltas must **not** ride the bus —
    `transcript.ts` writes every event verbatim, so per-fragment `text` events
    would bloat every transcript and fragment the observer's digest. The bottom
    line: if you change a wire path, prove the assembled response is identical to
    the old one — that is what `streaming.test.ts` and `scripts/smoke-stream.mjs`
    exist for.

## Verification loop (every change)

1. `pnpm exec tsc -b --force` — clean
2. `pnpm -r test` — 429/429 vitest in packages/core (32 files)
3. `pnpm run render` — the real-DOM render suites (or `render:fast` to reuse the
   bundle). Add an assertion here for any UI defect you fix, and prove it
   falsifiable.
3b. `node scripts/smoke-stream.mjs` — when the change touches a provider
   adapter, run the check the mocked unit tests cannot make: the real SDK against
   a local stub. See "Environment prerequisites".
4. `cd packages/vscode && pnpm run bundle && node scripts/extract-inline.cjs
   && node --check ../../tmp/plato-inline.js` — bundle + inline JS syntax
5. `cd packages/vscode && pnpm run package` — produces
   `plato-vscode-0.25.0.vsix`
6. `cd packages/vscode && pnpm run install:vsix` — installs into the
   running VS Code
7. Reload the VS Code window (Cmd+Shift+P → "Developer: Reload Window")
8. Update PROGRESS.md (newest-first row) and DECISIONS.md when the
   change warrants a decision; commit.

## Queued next work (in priority order — pick up here)

**The active workstream is the M5 agent capability plan. Read DECISIONS D49 for
the roadmap — do not restate it here.** **Phases 0–5 are DONE.** Phase 3 opened by
repairing a fault the plan did not anticipate — **no tool enforced workspace
containment** (D49k). **Next is Phase 6, task coherence** — a `todo_write` tool and
a panel. **`web_search` was deliberately deferred (D49p)**: it needs a backend
decision, and the convenient option — Anthropic's server-side search — bypasses
the approval card entirely. **D49q is closed as *not wanted***: `plato.net.allow`
and `plato.net.deny` were deleted on 2026-09-21 rather than given a UI, because
`web_fetch` always asks and an allow list could therefore only ever subtract.

**Two items in this plan were built and then removed on a founder challenge —
read before rebuilding either.** **D49h**, a run budget, and **the domain
allow/deny lists**. Both were plan items nobody had asked for and neither repaired
a demonstrated fault. The pattern is recorded in DECISIONS D49: a plan's items are
not all the same kind, so separate what *repairs a demonstrated fault* from what
*adds a capability*, and say which is which.

**Subagents are deliberately deferred and must not be added without
amending the one-worker lock (D45a-3) in the open.**

The items below predate that plan and remain open:

0. **Founder sign-off on D47c–n** (all committed and pushed as of `136564b`).
   Check Academy at a **narrow** panel
   width — that is where the D47g Role-box clip and the D47h overflow lived — and
   confirm: Academy shows only philosophers; changing `Plato's model` **sticks**
   and stays in sync with the composer; Powers = pause/cancel; the council is
   pre-filled `Lyceum`; a starter council seeds Aristotle + Pythagoras; the `✕`
   is drawn on every card and disabled at 2; the Role counter reads `n / 1000`;
   the mode cards stack to ONE column when narrow; in Providers the section stays
   OPEN across **Set key**, **Refresh models** and **Add connection**, with the
   key entered inline; the Academy mode card reads `Plato + a council of
   philosophers.` with no file path (D47m); and the History empty Runs note reads
   `~/.plato/runs/` (D47n).
   **Then settle the `personas.ts` role prompts** (recorded in D47d as possibly
   too weak for real agentic flow).
1. **Chat-log message rendering.** Markdown, code blocks, the
   "done in 26s · 11 tool calls · 66.7k tok" footer, and the labelled
   tool-summary chip already ship (core `renderMarkdown` + `.md-*` CSS +
   the done line + the D47c chip). What remains is *interleaving* — see the
   deferred note below.
2. **History run-detail view.** Friendlier rendering of a run's
   transcript (turns, tool calls, costs), instead of the raw file.
3. **Small wins:** title regenerate affordance (hover rename → add
   regenerate), title-call token metering into run costs.

> **Deferred / backlog — the full list lives in PROGRESS →
> "Deferred / backlog (do not lose these)",** with dates and the resolved items.
> Two of them matter for planning, and both are bigger than they look:
> - **Interleaved tool-call cards in the live log** need **host-side reply
>   segmentation** (a new segmented `md` contract), not styling — the host
>   streams one cumulative markdown blob per turn, so tool summaries land below
>   the whole reply. The History run-detail view is the cheaper place to get
>   correct ordering first.
> - **Mermaid fences render as labelled code blocks.** Needs its own decision:
>   bundling a ~1MB renderer breaks the zero-dependency doctrine and adds an SVG
>   XSS surface inside the escape-first webview.
>
> Deferred by decision (see DECISIONS D46): per-project council override
> ("discussion later" — v1 is one global council) and moving convo history to
> `~/.plato/history/` (it is in VS Code `workspaceState` today).

## Ground rules for any agent working here

- Surgical changes only; touch only what the current milestone requires.
- Every milestone ends in something runnable — demo it, then commit.
- Do not add features from the non-goals list in BLUEPRINT section 3 — **but
  check that banner first:** one of those non-goals ("visual team editor …
  comes later") has since shipped.
- If a design contract in ARCHITECTURE.md conflicts with reality, check whether
  a DECISIONS entry already supersedes it; if not, stop and record the proposed
  change in DECISIONS.md before deviating.
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
