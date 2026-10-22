# Plato CLI

Status: **in progress** — M0 through M5 are done (2026-10-21); M6's packaging
half is done, including the publish-ready manifest and the secret audit, the
real-model matrix passes 19/19 against both live providers, and the TUI passes
under a pty. **The carried-forward mode request is built (D49cc): the terminal
offers `request_mode`, and its loop reads the mode live.** The publish is
pending. The scope and the locked choices are in `docs/DECISIONS.md`
(D49bw–D49by). This file is the implementation plan. The user-facing package
README is `README.md`.

## What it is

A terminal host for the same engine as the VS Code extension. It supports Solo,
Duo, and Academy. It has the same three modes, tools, safety checks, transcripts,
undo store, MCP servers, and team files as the extension.

## Principles

1. **One engine, two hosts.** `packages/cli` calls `@applivity/plato-core`. It
   does not fork the loop, the tools, the permission table, or the security
   checks.
2. **Shared state.** Both hosts use `~/.plato` for runs, undo, MCP, teams, and
   `PLATO.md`. The project key is the first 8 hex characters of the SHA-1 of the
   workspace root.
3. **One command to authenticate.** The user never edits JSON to start.
4. **Fail closed.** If nobody can answer an approval, the call is refused and
   the model is told why.
5. **The renderer is replaceable.** The host state is a pure view model. Ink, a
   plain-text renderer, and a JSON renderer consume the same state.
6. **Copy comes from core.** The terminal and the extension say the same words
   for approvals, questions, refusals, and undo.

## Package identity

| Item | Value |
|---|---|
| Package | `@applivity/plato` |
| Command | `plato` |
| First version | `0.1.0` (separate from the extension's `0.26.x` line) |
| Node | `>=22` |
| Licence | Apache-2.0; `LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md` in the tarball |
| Terminal UI | Ink `8.0.0`, React `19.3.x`, pinned |
| Keychain | `@napi-rs/keyring` as an optional dependency |
| Publish | scoped, public, `--access public` on the first publish |

## Source layout

| File | Responsibility |
|---|---|
| `src/cli.ts` | Argument parsing, command dispatch, exit codes |
| `src/config.ts` | `~/.config/plato/config.json`: load, validate, defaults |
| `src/keys.ts` | Resolution chain: environment, keychain, 0600 file |
| `src/auth.ts` | `plato auth login`, `status`, `logout`, `list` |
| `src/models.ts` | Discovery, the 24-hour cache, and `plato models` |
| `src/doctor.ts` | The config, key, keychain, and model-limit report |
| `src/paths.ts` | Config, data, and shared `~/.plato` locations |
| `src/host.ts` | The loop host: `executeTask`, the one-shot sink, output formats |
| `src/session.ts` | Interactive view state: rows, cards, commands, history. No React |
| `src/team.ts` | Solo/Duo/Academy specs, observer construction, the shared cap |
| `src/sessions.ts` | The session store and resume |
| `src/sessionsCommand.ts` | `plato sessions list/export/delete` |
| `src/mcp.ts` | MCP startup from `~/.plato/mcp.json` |
| `src/errors.ts` | The host's actionable error type |
| `src/editor.ts` | Composer line editing, pure |
| `src/prompt.ts` | Login prompts; the secret is not echoed |
| `src/io.ts` | Stream and input types |
| `src/tui/` | Ink components; no product logic |
| `src/interactive.ts` | Ink mount and exit |
| `src/plain.ts` | The readline fallback |
| `test/` | Unit tests |
| `scripts/e2e.mjs` | Scripted-provider runs against the built file; not shipped |

## Milestones

Each milestone ends in a runnable command. A milestone is done only when its
verification passes.

### M0 — Package scaffold and build

**Deliverables**

- `packages/cli/package.json` with the package identity, `bin`, `files`,
  `engines`, and the build script.
- `tsconfig.json` with a project reference to `packages/core`.
- esbuild to one ESM file with a shebang. Native keychain bindings stay
  external.
- `--version` and `--help`.
- Copies of `LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md`.

**Done when**

- `node packages/cli/dist/cli.js --version` prints `0.1.0`.
- `node packages/cli/dist/cli.js --help` lists the commands.
- `npm pack --dry-run` shows only the built file, the licence files, and (from
  M6) the README. No `src/`, no tests, no maps.

**Verify**

```sh
pnpm exec tsc -b --force
pnpm --filter @applivity/plato run build
node packages/cli/dist/cli.js --version
node packages/cli/dist/cli.js --help
(cd packages/cli && npm pack --dry-run)
git diff --check
```

### M1 — Configuration, keys, providers, and models

**Deliverables**

- Config loader for `~/.config/plato/config.json`. `PLATO_CONFIG_DIR`
  overrides the directory.
- Connection presets: Anthropic, OpenAI, OpenRouter, LiteLLM, and a custom
  OpenAI-compatible endpoint.
- Key resolution: `PLATO_KEY_<ID>` > the provider-standard variable > the
  keychain > `~/.local/share/plato/auth.json` (0600). `PLATO_DATA_DIR`
  overrides the data directory.
- `plato auth login`, `status`, `logout`, and `list`.
- `plato models`, with a 24-hour discovery cache.
- `plato doctor`: config, key source, keychain availability, model limits.
- One-command login. A standard provider asks only for the key.

**Done when**

- `plato auth login anthropic` saves a key and `plato auth status` names the
  source without printing the key.
- `PLATO_DISABLE_KEYRING=1` writes the file with mode 0600.
- An ambient `ANTHROPIC_BASE_URL` does not move a configured connection.
- `plato models` lists models from a local OpenAI-compatible stub.

**Verify**

```sh
pnpm --filter @applivity/plato test
# Precedence, malformed config, file mode, environment redirect guard,
# keychain fallback, and login flow.
```

### M2 — One-shot run host

**Deliverables**

- `plato -p "task"` runs one task and exits.
- `src/host.ts` builds every `LoopOptions` field: root, task, provider, model,
  advertised limits, mode, history, MCP servers, secret vault, undo store,
  reveal, ask-user, stuck, and approvals.
- Transcripts go to `~/.plato/runs/<project-key>` with the existing schema.
- Streaming text to stdout. Tool events and notices to stderr.
- `--output-format text|json|stream-json`.
- Exit codes: 0 completed, 1 failure/refusal/cancel, 2 usage.
- Ctrl+C cancels the run; a second Ctrl+C exits.
- No TTY: an approval request is refused and the model is told why.

**Done when**

- A scripted provider completes a run that reads a file, writes a file, and runs
  a shell command.
- The transcript matches the extension's schema.
- `json` and `stream-json` output parse without errors.
- `--mode plan` refuses writes; `--mode auto` runs them.
- A non-TTY run with a write ends at the refusal, not at a hang.

**Verify**

```sh
pnpm --filter @applivity/plato test
node packages/cli/scripts/e2e.mjs --case one-shot
node packages/cli/scripts/e2e.mjs --case non-tty-approval
```

### M3 — Interactive terminal

**Deliverables**

- Ink app: transcript pane, composer, status line, observer strip.
- Streaming text, tool activity, plan rendering, context and cost.
- Approval card with the diff. Default is No. Choices: Yes; Yes, do not ask
  again for this file or session; No. Session memory follows core's rules.
- Question card: single and multi-select, named tabs, free text.
- Stuck card.
- Reveal card for a protected text file.
- `Shift+Tab` switches `plan`, `edit`, and `auto`.
- `/mode`, `/model`, `/compact`, `/new`, `/help`, and `/exit`. `/undo` and
  `/sessions` arrive with the session store at M5. `/` and `@` completion moves
  to M6 polish.
- The plain renderer is a complete fallback, selected by `--plain`. It runs the
  same loop through the same sink as `-p`, over readline. It is used when an
  interactive TUI cannot start. It is not a substitute for the non-interactive
  path: `-p` remains the scripted mode.
- `NO_COLOR` is respected. State is legible without colour.

**Done when**

- Every parked card works with a scripted provider: approval, question, stuck,
  and reveal.
- Card, mode, cancel, and exit paths are tested through the session. A pty run
  proves typing, Enter, a pasted line, card selection, `/help`, and `/exit` in
  the real TUI.
- The plain renderer completes a scripted run through the built file.
- A pty session with a stub provider completes a write after the approval card.

**Verify**

```sh
pnpm --filter @applivity/plato test
node packages/cli/scripts/e2e.mjs --case plain
# The TUI is driven through a pty: typing, Enter, a pasted line, card
# selection, /help, and /exit.
```

### M4 — Solo, Duo, and Academy

**Deliverables**

- `--team solo|duo|academy` and `/team`, backed by the config file.
- Observer specs from `DUO.yaml` and `ACADEMY.yaml`. A member with no key gets a
  notice, not a crash.
- Observer strip: name, colour, state, last intervention.
- Guidance, pause, and cancel. The run-wide cap of 5 interventions.
- The closing line reports checks and interventions.
- The same core `ObserverAgent` and team parsers as the extension.

**Done when**

- A scripted observer produces a guidance, a pause, and a cancel, each in its
  own run.
- A five-member Academy runs without layout breakage at 80 columns.
- The observer strip is correct with 0, 1, and 5 members, and without colour.
- A real-model Duo run shows one intervention and names it in the closing line.

**Verify**

```sh
pnpm --filter @applivity/plato test
node packages/cli/scripts/e2e.mjs --case duo
node packages/cli/scripts/e2e.mjs --case academy
# Real model, manual:
plato --team duo "read the README and propose one improvement"
```

### M5 — Sessions, undo, MCP, images, and compact

**Deliverables**

- Session store under `~/.plato/sessions/<project-key>`. One file per session,
  with id, title, timestamps, and the log rows.
- `plato -c`, `plato -r <id>`, `plato sessions list|delete|export`.
- `/undo` uses the core plan-and-apply path and the same `~/.plato/undo` store
  as the extension.
- MCP servers from `~/.plato/mcp.json`, started outside `plan`, stopped at run
  end. Disabled servers are silent.
- Images via `@path`; the MIME is sniffed from the bytes.
- `/compact` runs the manual fold. Auto-compaction remains in the loop.
- Background shells are killed at run end.

**Done when**

- A session survives process exit and resumes with its history.
- Undo restores a file byte-for-byte and refuses a file changed since the write.
- An MCP tool is callable, and a disabled server is absent.
- A renamed text file is not accepted as an image.
- `plan` starts no MCP server.

**Verify**

```sh
pnpm --filter @applivity/plato test
node packages/cli/scripts/e2e.mjs --case resume
# Undo (restore and refusal), MCP (live tool call), and images (renamed text
# refused) are driven through the loop in the test suite.
```

### M6 — Hardening, packaging, and publish

**Deliverables**

- Copy review: every error names what happened and what to do next.
- Composer polish: `/` command completion (**done 2026-10-22, D49cd** — a
  filtered menu over one command table that `/help` also reads, ten rows with
  scrolling, Tab fills in, Enter runs) and `@` path completion (still open).
- Crash handling: no stack trace with a key or a secret. ~~`--debug` writes a
  log to `~/.plato/logs/`~~ — **replaced (D49bz):** the transcript is already
  the log, and `plato doctor` now reports the three state homes and the last
  run in the current directory.
- README: install, auth, modes, teams, examples, licence.
- `files` allowlist finalised. Remove `"private": true` and add
  `"publishConfig": { "access": "public" }` (done 2026-10-21; `npm publish
  --dry-run` accepts the manifest).
- `npm pack` audit and a clean-directory install test.

**Done when**

- The full test suite passes: core and CLI.
- The scenario matrix passes: three modes × TTY/non-TTY × key source.
- Real-model runs pass: Solo in `plan`, `edit`, and `auto`; Duo; Academy.
- The tarball has no source, tests, maps, keys, or local paths.
- The tarball installs into a temporary prefix; `plato --version` runs from an
  unrelated directory.
- `npm whoami` succeeds and the `applivity` organisation is confirmed.
- `0.1.0` is published with `--access public`.

**Verify**

```sh
pnpm exec tsc -b --force
pnpm -r test
pnpm run render
(cd packages/cli && npm pack)
# Unpack the tarball and inspect the file list.
# Install into a temporary prefix and run from /tmp.
```

### Carried forward — the mode request (D49cb) — **BUILT 2026-10-21 (D49cc)**

> The specification below is kept as it was written. The item is done: the live
> `getMode` and the `mode` card are in `host.ts`, `session.ts`, and
> `tui/App.tsx`; 8 new tests cover the wiring, and the live read is proven by
> mutation (reverting `getMode` to the snapshot fails three of them). The TUI
> was driven under a pty with a stub provider and then with a real model; see
> D49cc in `docs/DECISIONS.md` for the evidence and for the two defects it
> fixed on the way.

The extension now offers `request_mode`: the model asks, a card states the target
and the reason, and the host switches **only** on the user's yes; the same run
continues. **The CLI does not offer the tool yet, and that is deliberate** — its
prompt keeps the prose fallback and its loop reads the mode as a run-start
snapshot, so a card that changed `Session.mode` would not change the permission
table mid-run. Adding it is a CLI capability, not an extension change:

- Pass a live `getMode: () => this.mode` through `ExecuteOptions`, and use it in
  `executeTask` instead of `options.mode`, so a switch during a run reaches the
  next tool call.
- Add `RunSink.requestMode` (target, reason, current) returning `{ ok, note }`;
  offer the tool only when the sink implements it, which is what makes
  `toolDeclarations` and the prompt capability sentence follow automatically.
- Draw a `mode` card in the TUI: the target, the reason, the target's meaning,
  the mode in force; **Stay is the default and Esc/Cancel is Stay**; a yes calls
  `Session.setMode`, which updates the header, and the tool result names the mode
  now in force.
- Record `mode-requested` and `mode-changed` (`via: request`) on the run's bus —
  `executeTask` owns the bus, so it emits them around the sink call. The reason
  stays out of the transcript.
- Mirror the extension's cap (three requests per run) and its decline line.

The extension's implementation is the reference: `requestMode`, `applyMode` and
`askModeRequest` in `extension.ts`, `showModeRequest` in `webview.ts`, render
suite `scripts/render/modecard.mjs`, field case 36, and real cases 34–36 in
`scripts/field/field.real.test.mjs`. Do not re-implement the tool's validation
or schema — core owns both.

## Verification harness

Two layers, and neither replaces the other:

1. **Unit tests** for host logic: config, keys, session store, view model,
   command parsing, and card state.
2. **Scripted end-to-end runs** through the real `runAgentLoop`, with a fake
   `ChatProvider`. These prove the host wiring, the transcript, the cards, and
   the exit codes without a network.
3. **Real-model runs** on the proving-ground repo. These prove the product.
   They are manual and are recorded in PROGRESS with the result.

The extension's 858 core tests already cover the engine. Do not duplicate them.
The CLI tests cover the host only.

## Definition of done for v1

A user on a clean machine can:

1. Install the package.
2. Run `plato auth login anthropic`, enter one key, and see a confirmation.
3. Run `plato` in a repository, ask for a change, approve it, and see the write.
4. Run `/undo` and get the file back.
5. Switch to Duo and see the philosopher watching and intervening.
6. Run `plato -p "..." --output-format json` in CI with a key from the
   environment.
7. Run `plato -c` after a restart and continue the same conversation.
8. Read one clear error when a key is missing, a provider fails, or a call is
   refused.

## Risks and traps

- **The Anthropic SDK reads the environment.** `ANTHROPIC_BASE_URL` and
  `ANTHROPIC_AUTH_TOKEN` must never redirect a configured connection. Pass the
  endpoint and token explicitly.
- **A secret must not reach the screen.** Core scrubs tool results, but the host
  must not print raw arguments or the key in errors, debug output, or status.
- **Non-TTY is a real mode, not an afterthought.** Every approval path must have
  a fail-closed answer.
- **Ctrl+C during a run cancels; it does not exit.** A second press exits.
- **Background shells must die with the run.** The loop already does this; do
  not start any outside it.
- **Observer notices can interleave.** The view model owns ordering; components
  must not append.
- **Ink 8 changed four things.** No percentage widths on `Box`, use
  `useWindowSize()`, do not rely on mouse or focus sequences, and use React
  19.3.x.
- **The keychain is optional.** The CLI must run when the native module is
  missing or the keyring is locked.
- **The tarball is a distribution.** It carries the licence and notices, and it
  carries no source or maps.

## How progress is tracked

- **This file** carries the milestone status table. Change a row only when its
  verification passes.
- **`docs/PROGRESS.md`** gets one row per milestone, with the command output
  that proves it.
- **`docs/DECISIONS.md`** gets an entry when a decision changes, not for every
  step.
- **Do not commit a temporary notes file.** Use `tmp/cli-notes.md` (the `tmp/`
  directory is gitignored) or the working task list for scratch. A committed
  scratch file becomes a second source of truth and goes stale.

## Milestone status

| Milestone | Status |
|---|---|
| M0 — Package scaffold and build | done 2026-10-21 |
| M1 — Configuration, keys, providers, models | done 2026-10-21 |
| M2 — One-shot run host | done 2026-10-21 |
| M3 — Interactive terminal | done 2026-10-21 |
| M4 — Solo, Duo, and Academy | done 2026-10-21 (scripted runs; the real-model Duo run waits on a key) |
| M5 — Sessions, undo, MCP, images, compact | done 2026-10-21 |
| M6 — Hardening, packaging, publish | in progress — README, tarball, clean install, publish-ready manifest (`"private"` removed, `publishConfig` added, `npm publish --dry-run` accepted), secret audit, and the real-model matrix (19/19 against both live providers, twice) plus the pty proof of the TUI are done; the `--debug` log is REPLACED by `doctor` reporting the last run (D49bz), the final copy review remains, and publish is pending |
