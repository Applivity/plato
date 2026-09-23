# Plato — Complete Decision Log

Produced by a structured grilling interview (questions Q1–Q22). Founder =
Umair (GitHub `ukhan`, umair1808@gmail.com). "Delegated" means the founder
explicitly left the decision to the assistant, which decided with recorded
reasoning. Nothing is silently assumed.

## Foundations

**D01 — Product (Q1, Q2).** Build an AI coding agent like Claude Code /
Copilot / Goose: company is Applivity (applivity.com), working name Plato.
Goal: a releaseable, usable MVP. Start small, enhance incrementally.

**D02 — Effort model (Q16).** Full-time solo founder, code written
end-to-end with AI assistance, ASAP pace. Consequence: use mainstream,
heavily documented tech (AI generation reliability), and make every
milestone end in something runnable and demoable.

**D03 — Language (Q9, delegated).** TypeScript. Research basis: Cline
(TS: VS Code ext + CLI + SDK), Goose (Rust: desktop + CLI), Aider (Python:
CLI only), all Apache-2.0, all using user-supplied provider keys. TS wins
because the extension host is natively JS/TS, one language covers
extension + future CLI over a shared core, and Cline proves the pattern.
Rust rejected (optimizes CLI-first distribution — phase two concern);
Python rejected (no extension story).

**D04 — Form factor (Q9, delegated).** VS Code extension first; CLI wraps
the same core later. Reasons: multi-agent supervision needs rich visible
UI (timelines, panes, approvals) which terminals show badly; marketplace
gives one-click install; core stays a UI-agnostic library either way.
Founder accepted; treated as settled unless vetoed (none came).

## Capability scope

**D05 — Tool loop (Q4).** Option (b): read file, write file, apply-diff,
shell, list/search files, git status/diff. Diff-based editing separates
"usable" from "toy"; whole-file rewrites are slow and clobber code.

**D06 — MCP (Q14).** Option (b): built-in tools + MCP stdio client reading
user-configured servers from `mcp.yaml`; tool permissions slot into team
profiles. Self-discovery/self-configuration of tools explicitly excluded
from v0.1 (v2 candidate).

**D07 — Providers (Q5).** Any OpenAI-compatible endpoint (covers OpenAI,
OpenRouter, Ollama, self-hosted) plus Anthropic native. User-provided API
keys only, stored exclusively in VS Code SecretStorage.

**D08 — Modes (Q6, A6).** `plan` (read-only), `edit` (file diffs, no
shell), `act` (per-action approval), `auto` (autonomous with hard caps).
Approval defaults: reads auto-approved; writes and shell commands approved
once per session; YOLO available as `auto`.

**D09 — Sessions (Q15, delegated).** No resume in v0.1. Events persist to
disk anyway (they power the cost meter, observer feed, debugging), so
browsable transcripts come free. True resume is a context-management
project, deliberately out of scope.

**D10 — Live supervision (Q10, A10).** Option (b): the observer receives
every coder tool call as an event-stream subscription and can send
messages injected into the coder's context, up to pausing it.
Reviewer-at-end becomes an observer with interrupt rights; the architect's
plan is the pipeline's *starting event*. Technically rides the same event
bus as the approval system. Verified gap: competitors coordinate only at
task boundaries.

**D11 — Team definition (Q11, A11).** Option (b) plus presets:
`.aplivity/teams.yaml` at repo level, global fallback
`~/.applivity/teams.yaml`; profile = {name, role prompt, model, allowed
tools, permissions}. Convenience solved with a shipped JSON schema bound
via VS Code `jsonValidation` (autocomplete, hover docs, red squiggles) +
copy-paste preset files. Root cause analysis of the founder's continue.dev
pain: silent invalid config, not config files themselves. Visual editor
deferred (would consume 30–40% of UI work for zero core value). Flag:
renaming the directory to `.plato/` is cheap any time before M3.

**D12 — Solo = team-of-one (Q13).** Everything is a team; a solo agent is
a team config with one profile. One code path, no dual engines.

**D13 — Flat teams (A10 scope).** v0.1 has no agent spawning agents.

**D14 — Cost governance (Q12).** Option (c): per-profile model mapping
(cheap model observes, strong model codes), hard budget cap per run in USD
or tokens with graceful wind-down, max concurrency limit, per-team turn
limits, live per-agent cost meter. Basis: Anthropic reports token spend
explained ~95% of multi-agent performance variance. Nothing hidden from
the user.

## Ground truth and identity

**D15 — Acceptance test (Q8, Q19, A19).** See BLUEPRINT section 4.
Proving ground: `/Users/ai/Desktop/HcadPublicAndroid-demo` — founder's
real Android project (Groovy DSL Gradle, `app` module, `gradlew`).
Implications: Java/Gradle handling must be first-class; secret-bearing
files (`keystore.properties`, `local.properties`) and `.gitignore`d files
must never enter model context.

**D16 — Name (Q17, Q18).** Plato, suggested by the founder. Legal
position: nothing legally required while building privately; USPTO/EUIPO
trademark sweep is a pre-release checklist item; domains are optional.

**D17 — Namespaces (facts, verified).** GitHub org `applivity-com`;
marketplace publisher `applivity` (verified live; extension ID
`applivity.plato`); publisher `applivityllc` also registered, kept parked
as alias (publisher IDs are permanent and cannot be renamed); npm org
`applivity`.

## Engineering strategy

**D18 — Repository (Q20).** Monorepo named `plato` under `applivity-com`:
pnpm workspaces + TypeScript project references; `packages/core`,
`packages/vscode`, `packages/cli` (later). Private until M4; license
decision at M4 (founder leans open source; Apache-2.0/MIT candidates).
Future devs can join without restructuring (add CODEOWNERS/review rules
then).

**D19 — Distribution reality (Q7, A7).** Repo stays private through MVP.
Marketplace publishing requires passing Microsoft review at first
release; both publisher accounts already exist.

**D20 — Handoff doctrine (A22).** All decisions live in-repo documents,
not chat history, so any developer or AI agent can continue the work
without the founder present. This file set is that doctrine.

**D21 — M0 scaffolding choices (A-first-code, delegated).** Founder left
implementation details to the assistant; recorded here per doctrine.
(a) Provider access via the official `@anthropic-ai/sdk` in
`core/src/providers` — mainstream, heavily documented, matches D02.
(b) One addition to the ARCHITECTURE tree: `core/src/security/` holds the
secret deny-list filter. It guards every tool and context builder, so it
needs a cross-cutting home; flagged here as the only tree deviation.
(c) Unit tests run with vitest (mainstream, zero-config, D02). Nothing
else new: no bundler, no framework, tsc project references only.

**D22 — M1 tool-loop choices (delegated).** (a) Loop uses Anthropic's
native tool-use API (`tools` + `tool_use`/`tool_result`), non-streaming
per turn; assistant text is forwarded per turn. Structured calls beat
prompt-hacked JSON; streaming adds risk with no M1 demo value. (b)
`apply_diff` uses SEARCH/REPLACE exact-match blocks (Aider-style);
re-applying an identical block is a no-op success (idempotence is in the
ARCHITECTURE test list); ambiguous matches are rejected, never guessed.
(c) Modes are one permission-policy table (`decide`) over a single loop;
approvals surface to the shell through one async callback. `plan`: reads
only. `edit`: reads auto, writes approve-once-per-session (cache lives in
the shell), shell denied. `act`: writes/shell per-action clicks. `auto`:
everything auto-approved under a hard turn cap. All modes turn-capped.
(d) list/search ships as two tools (`list_dir`, `grep`) for clean JSON
schemas; capability surface unchanged from D05. (e) git tool accepts only
`status`/`diff` verbs (read-only, per D05). (f) Known limitation, carried
to M2: shell output is not content-scanned for secrets yet; M1 refuses
commands that reference deny-list filenames and relies on approvals.

**D23 — edit vs act boundary.** The line is command execution plus memory
of consent. `edit`: no shell, ever; the first approved write to a file
consents for that file for the session. `act`: shell available; every
write and every command needs its own click; nothing is remembered.
Rationale: file edits are reviewable as diffs and revertible with git;
executed commands are neither, so they never inherit prior consent.
`auto` removes clicks entirely (turn cap remains the backstop); `plan`
cannot mutate. UI should label these so the difference is visible at
pick time.

**D24 — M2 event bus, transcripts, cost (delegated).**
(a) One synchronous in-process pub-sub bus in core (`runtime/bus.ts`).
Events are a typed discriminated union; listeners are isolated — a
throwing listener is swallowed, never breaks the run. The loop is the
single emitter; the M1 shell callbacks (`onText`, `onToolEvent`) become
bridge subscribers so the public surface is unchanged.
(b) Observer injection (D10) enters now as a first-class inbound mailbox
on `RunController`: `guidance` queues FIFO and is injected as user-role
text at the next safe point; `pause` blocks at safe points until
`resume`; `cancel` stops after the in-flight tool call finishes. Safe
points are between API turns and between tool calls. Killing a tool
mid-execution is deferred (child-process teardown is M3 work).
(c) Transcripts: JSONL, header line first (`schemaVersion` 1), one line
per event, one file per run under `<root>/.plato/runs/`, on by default
(per D09 they power cost, observer feed, debugging). Secret-safety by
construction: the writer whitelists fields — tool arguments, approval
previews, and raw outputs are never written (file content can carry
secrets); full-fidelity capture is future opt-in behind redaction.
(d) Cost meter: hardcoded per-MTok USD prices for models Plato uses;
unknown model quotes $0 flagged `estimated:false`. Usage accumulates per
turn (`usage` events) and per run (`LoopResult` + `run-completed`).
Display-only — never authoritative for billing; prices drift.
(e) MCP client (D06) trimmed to early M3: largest surface, least M2 demo
value. Recorded as a decision, not drift.

**D25 — M3 execution choices (delegated).**
(a) Chat rendering: assistant replies render as Markdown through a safe
mini-renderer in core (`format/markdown.ts`) — escape FIRST, then a
fixed subset: fenced code blocks (with language label), inline code,
bold, italic, #-headings, bullet/ordered lists, blockquotes, paragraphs,
and http(s)-only links. Raw HTML never passes through; no renderer
dependency is added (supply-chain discipline per D02/D15 posture). The
host converts once per turn and at restore; the webview only inserts
host-built HTML.
(b) Provider abstraction: canonical message/tool-call/usage types with
two adapters behind one interface — AnthropicNative (current behavior)
and OpenAICompatible (chat-completions tool calling; covers
OpenAI/OpenRouter/Ollama/custom baseURL per D07). The M2 bus stays
provider-neutral; adapters emit into it.
(c) Keys: per-provider entries in VS Code SecretStorage
(`plato.providers.<id>.apiKey`); the legacy `plato.anthropicApiKey` is
honored/migrated so founders see no break.
(d) Model & reasoning UX: workspace setting for the default model plus a
header dropdown of known models; reasoning controls (`reasoning_effort`
for OpenAI-style, extended-thinking budget for Anthropic) as per-model
settings; invalid combinations rejected at request-build time. Model is
fixed at run start (no mid-run switching this milestone).
(e) Cost: price table keyed by model id across providers;
reasoning/thinking tokens count as output tokens; unknown models stay
$0/unestimated (D24d rule stands).
(f) Build order within M3: markdown rendering first (founder-flagged) →
observer supervision UI (guidance/pause/cancel over RunController) →
provider abstraction + model/reasoning UX → transcript replay view →
MCP stdio client. Team profiles stay early-M4 unless room remains.
(g) Non-goals this milestone: vision/image inputs, agent-authored HTML
beyond the renderer subset, mid-run model switching.

**D26 — Connections, key management, cost honesty (delegated).**
(a) Named connection profiles replace the single global OpenAI base URL:
`plato.connections` is an array of `{id, kind: 'anthropic'|'openai',
baseUrl?, models?}`. Defaults `anthropic` (native) and `openai`
(api.openai.com/v1) are pre-seeded unless the user defines their own
with those ids. Model refs become `<connection-id>:<model>`; the id
selects base URL and key slot, `kind` selects the adapter. Adding a
provider is data, not code — any number of compatible endpoints
coexist (founder need: LiteLLM + OpenRouter side by side).
(b) Keys stay in SecretStorage under `plato.providers.<connectionId>
.apiKey`; the legacy `plato.anthropicApiKey` slot remains a fallback
for the default anthropic connection only. New command
`Plato: Manage API Keys`: QuickPick lists every configured connection
with ●set/○missing status → Set or Clear. No key value is ever
displayed.
(c) Cost honesty (founder-flagged): flat price tables cannot see cache
tiers (Anthropic cache-read ≈10% of input), off-peak windows
(DeepSeek), or router-side discounts (LiteLLM) — so per-provider dollar
accuracy is NOT pursued. Done cards lead with exact token totals;
the dollar figure is demoted to `≈$x` and omitted when unknown.
Known limitations recorded rather than modeled. Future candidate:
OpenRouter's authoritative `usage.cost` passthrough.
(d) Non-goal: modeling cache/off-peak price schedules.

**D27 — In-panel settings surface (founder directive).** Plato targets
non-technical users, so provider/connection configuration moves INTO
the panel: a ⚙ gear toggles a Settings page listing connections (kind,
baseUrl, models, key status ●/○) with Add/Delete for user-defined
profiles, plus default-model and reasoning selects. Keys are entered
through password prompts and stored ONLY in SecretStorage — values are
never sent to or rendered in the webview; the panel shows status dots.
Palette commands remain for power users; the panel is the primary
surface. Amends D26(b): palette-first → panel-first. The teams config
UI (M4) will reuse this component.

**D29 — Provider/chat UI polish (founder directives 2026-08-25).**
(a) Add-provider flow is fully automated: pick preset → Add → auto-prompt
for API key → auto-fetch models. The manual comma-separated model field
is removed; /models discovery (D28) is the only model source, populating
a dropdown (manual entry remains only as fallback code, not UI).
(b) The chat model dropdown groups by provider (optgroup per connection),
labels show bare model ids, values keep `<conn>:<model>` refs. The mode
button handler is scoped to `[data-m]` so gear/new can't hijack it.
(c) Chat header becomes two clean rows — row 1: brand + model select +
gear; row 2: mode pills + new-chat + status chip — to end the
one-line-crowd (mode/model/settings/"done") complaint.

**D30 — Observer-AI v1 (M4).** A second model ("observer") subscribes to
the coder's run and steers it, per D10. (a) Trigger: at each turn
boundary the observer receives a condensed digest of the run so far
(task, tool events, last text) and must answer with exactly one JSON
action: `{"action":"noop"|"guidance"|"pause"|"cancel","message"?}`.
Actions map onto the existing RunController mailbox — no new loop
machinery. (b) Tiers via `plato.observer.*` settings: `enable`
(default false), `model` (connection:model ref), `role` (extra system
text), `guidance` (default true), `pause`/`cancel` (default false),
`maxInterventions` (default 5). Unsupported actions are ignored.
(c) Invariant: the observer can NEVER approve tool calls — human
approvals stay human; it only nudges, pauses, or stops. (d) Audit:
every observer action renders in chat as `[observer] …` and rides the
event bus/transcripts like any event. (e) v1 limitations: observer
costs are not metered separately; digests are text-condensed, not
full-fidelity. (f) Teams (D11) land after v1 proves out.

**D31 — Teams v1: `teams.yaml` (M4, approved and implemented 2026-08-26).**
Teams generalize D30's observer into named member
profiles. (a) *File*: `teams.yaml` at the workspace root (AMENDS D11's
`.aplivity/teams.yaml` — `mcp.yaml` already lives at the root; one config
directory would split config across two places; the `.aplivity/` directory
never shipped, so nothing breaks). Missing file → solo mode, current
behavior, zero changes. (b) *Shape* (zero-dep parser, same subset style as
`parseMcpConfig`): top-level `team: {name}`, then `members:` list; each
member = `name`, `model` (`<conn>:<model>` ref, required), `role` (extra
system text), `kind: coder | observer` (default `coder`), and for
observers the D30 tier fields `guidance`/`pause`/`cancel`/
`maxInterventions` with the same defaults. (c) *v1 constraint (D12/D13)*:
exactly one `coder` member and 0–3 `observer` members. Solo = no file or
one coder member only — one code path, no separate engine. Multiple
coders, concurrency, per-run budget caps stay out of v1 (M5 candidates).
(d) *Mapping*: the coder's `model`/`role` override the chat model choice
and plato's base system prompt additions for that run; each observer
member becomes its own `ObserverAgent` on the same bus with its own
digest and intervention budget (total cap = sum of member caps, hard-capped
at 5 per run). The observer's invariant carries over: observers NEVER
approve tool calls. (e) *Precedence*: `teams.yaml` present → it wins over
`plato.observer.*` settings (the Settings → Observer section applies only
in solo mode). (f) *Validation is loud, never silent* (D11's root cause:
continue.dev's silent invalid config): parse errors, unknown fields,
duplicate names, a missing coder, or an unresolvable model ref abort with
a chat notice naming the file and line, and the run does not start with a
half-team. (g) *Schema*: ship `teams.schema.json`; bind it via
`yaml.schemas` configurationDefaults for `teams.yaml` (works when the YAML
extension is installed; its absence degrades to plain editing with loud
parse errors — acceptable). (h) *UI*: read-only team display in the panel
(member cards: name, kind, model, tier flags) — the yaml is the source of
truth, no visual editor (D11 defers it). Founder to confirm (a)–(h)
before implementation; open sub-questions: none blocking.

**D32 — Orchestration modes & philosopher personas (M4, approved and
implemented 2026-08-26).** Fixes terminology before M4 closeout and makes
orchestration an explicit user choice instead of file presence.
(a) *Terms*: the worker (formerly "coder") does the work; philosophers
(formerly "observers") watch and steer. Modes: **Solo** (Plato alone),
**Duo** (worker + one philosopher), **Academy** (the full council from
config — Plato's own school; thematic lock for the product). Setting
`plato.orchestration`: `'solo' | 'duo' | 'academy'`, default `'solo'`.
The config file renames `teams.yaml` → `academy.yaml` and member kind
`coder|observer` → `worker|philosopher` (0.8.0 never circulated beyond the
founder; amends D31a/b — loud errors name the new terms so old files fail
with a hint, not silently). Precedence: the SETTING decides, not file
presence; an academy.yaml present but orchestration != academy shows a
Settings hint ("academy.yaml detected — Academy available"), never hijacks
the run. Academy selected but file missing/broken = loud error at run
start AND at settings selection time.
(b) *Personas*: five philosopher presets, each a name + default role
prompt; used in the Duo picker and as copy-paste academy.yaml members:
- **Aristotle** (default) — the empiricist: judge only from evidence in
  the digest; flag claims without verification, conclusions without
  observation, changes not re-checked.
- **Heraclitus** — the watcher of change: focus on what is changing —
  risky edits, unstable patterns, regressions introduced mid-run.
- **Diogenes** — the Cynic: bluntly call out overcomplication, bloat,
  and gold-plating; prefer the simple answer; one-line gotchas.
- **Pythagoras** — the geometer: check structure, symmetry, correctness
  — types, counts, invariants, patterns; intervene when the numbers do
  not add up.
- **Thales** — the first look: light first-pass review; flag only clear,
  obvious mistakes; stay silent when uncertain (cheap-model friendly).
(c) *Duo*: one philosopher, configured in Settings (persona preset +
model ref + tier toggles + budget) — reuses the existing
`plato.observer.*` storage, renamed `plato.duo.*` with migration-free
fallback (settings never shipped beyond founder).
(d) *Settings restructure*: collapsible `<details>` sections, order:
Orchestration (three mode cards with one-line descriptions; Academy card
shows the parsed member list + validation status), Duo (persona picker +
model + tiers), Connections (collapsed by default), Defaults (collapsed).
(e) *Header chip*: `● solo` / `◐ duo` / `⟐ academy:<name>` next to the
mode pills, clickable → Settings → Orchestration.
(f) *Chat*: academy run shows the member card (already shipped, renamed);
duo shows `[Aristotle] watching — <model>`. Done-card stats unchanged,
aggregated. Observer invariant unchanged: philosophers NEVER approve
tool calls. Founder to confirm terminology + persona set before
implementation.

**D33 — Configs live in `.plato/` (M4, approved and implemented 2026-08-26).
Amends D32(a)/D31(a)/D06.** Founder-flagged: a generically named
`academy.yaml` at the repo root risks collisions with users' unrelated
files and clutters the root. All Plato config moves into the existing
`.plato/` namespace (transcripts already live there since M2):
`.plato/academy.yaml` and `.plato/mcp.yaml`. Root files are NEVER
interpreted — `legacyConfigAtRoot()` reports them so Settings/run errors
ask the user to move them (never silent adoption, never silent ignore).
mcp loader falls back to the legacy root `mcp.yaml` for continuity.
Settings gains affordances (D33b): Create-example writes
`.plato/academy.yaml` pre-filled with the current default model and opens
it in the editor; Open jumps to the file; status re-checks on every
Settings open. Member data stays read-only in the GUI (D11 visual-editor
deferral unchanged) — the yaml is the interface, the buttons are the
on-ramp.

**D34 — ask_user tool (M4.1, approved and implemented 2026-09-01).**
Closes a parity gap with similar tools (Claude Code/Codex) where the agent could only narrate or seek file-change approval. Adds `ask_user` to the M1 tool surface (schema: question, 2–6 options, optional recommended flag, allowCustom). Mode policy treats it as a meta-tool (agent asking user) and ALWAYS allows it in `plan`/`edit`/`act`/`auto` modes without gating. The loop routing diverts `ask_user` calls to a dedicated `askUser` callback (bypassing `executeTool`), resolving the answer text back into a standard `tool_result` block. Host UI renders this as an inline question card (heading, action buttons for options, free-text input field); the chosen option (or custom text) echoes into the transcript.

**D35 — ask_user v2 UI (M4.1, founder review amendment).**
Amends D34 based on founder feedback (preferring Claude Code's presentation). `ask_user` now supports asking multiple questions in a single tool call via a `questions` array. The UI abandons horizontal buttons in favor of a vertical, form-like stacked layout. Each question displays its title, an optional 1-2 line context, and a vertical list of selectable options. The `allowCustom` flag now injects an "Others" choice as the final option, which reveals an inline text input when selected. Answers are submitted together and flow back to the model as an indexed, concatenated block.

**D36 — ask_user v3 UI (M4.1, founder review amendment 2).**
Amends D35. With multiple questions the UI no longer stacks them together; it presents **one question at a time** with "Question X of N" progress, a Back button to revisit earlier answers (restoring the prior selection), and Next/Submit to advance. Each question keeps the title + context + vertical options, and **"Others" for a custom answer is now unconditional** — the `allowCustom` toggle was removed from the schema entirely because models would suppress it, yet the founder wants a custom answer always available. The whole set still submits as one `string[]` batch to the model, so the model-facing contract is unchanged.

**D37 — Live context ring + Auto/Manual compaction (M4.1).**
Three additions, all built on the same D9 primitive (model context is a
managed resource, not a backstop).

(a) *Model max context* — `ModelEntry.maxContext` added to the registry
catalog with verified windows for the 6 known models (Sonnet 4.5 / Opus
4.1 / Haiku 3.5 → 200k; GPT-4o / 4o-mini → 128k; o4-mini → 200k).
`maxContextFor(bareName): number | null` returns `null` for unknown
models — the UI shows "ctx unknown" rather than guessing (D26c: never
fake precision). Discovered models also surface their context window
opportunistically: `fetchModelPool()` reads `max_input_tokens` from
Anthropic's `/v1/models` and `context_length` /
`top_provider.context_length` from OpenRouter's `/api/v1/models`. Plain
OpenAI's `/v1/models` does NOT expose the field, so it stays `null` —
the user still sees "ctx unknown" but the connection works.

(b) *Running context ring* — before every turn the loop emits a
`context` bus event with `maxContext`, the total estimate, and a
breakdown (system / user / assistant / tool). A 28px SVG ring in the
composer footer fills proportionally; color steps green → amber at 70%
→ red at 90%. Hover tooltip shows the breakdown plus a secondary
"last request" line carrying the provider's authoritative `inputTokens`
from the previous turn. The webview header caption next to the model
dropdown shows "ctx 200k" / "ctx unknown" so the window is visible
while picking a model — and Settings → Connections appends "· 200k"
to every known-context option in the multi-select.

(c) *Compaction* — one primitive in two modes. `compactMessages()`
splits the older N messages off, asks the same provider to summarise
them with a small output budget, prefixes the summary onto the
system prompt, and keeps the most recent 6 messages verbatim. The
summariser call's tokens are folded into the run's `inputTokens` /
`costUsd` honestly so the done card stays accurate. **Manual**: a
header pill toggles Manual ↔ Auto (default Auto per founder review,
since no users yet), and an always-on **Compact** button in the
composer fires `RunController.requestCompact()` which the loop checks
at the next safe point. **Auto**: the loop checks before every turn
whether the estimate has crossed `threshold × maxContext` (default
0.8, range 0.5–0.95). There is intentionally no "Off" — a run
*always* manages its context. Failed compactions emit a `notice`
event and continue without compacting; the run never crashes because
context grew. Compaction is a *prompt-shrinking* operation: the
visible chat log is untouched, only what we send the model is
condensed.

**D38 — Settings UI rewrite (M4.1, 0.14.0, founder directive 2026-09-01).**
The settings page (originally shipped in D27) had grown into a wall of
five peer-level collapsible sections with no visual hierarchy: the
Duo section was a sibling of Connections (so it appeared in all three
orchestration modes), the "Defaults" section duplicated controls that
already lived in the chat header, every button was the same secondary
style with the same text, and the threshold slider showed a stale
label. Founder's read: "clumsy, confusing, all over the place,
completely slop." Fix is a full rewrite of the webview page; the
host-side `sendSettings()` payload and all message handlers are
unchanged.

(a) *Three top-level sections, not five peer-level collapsibles.*
**Orchestration** is always-open at the top (it's the *shape* of how
Plato works and the most important user choice). **Providers** is
collapsed by default with the connection count in its summary line,
auto-opened on first run when there are zero providers (so the Add
form is visible). **Context** is collapsed. The old "Defaults"
section is dropped entirely — default model is the chat header
dropdown and reasoning rides the model in the same place; Settings
should own *configuration*, the header should own *session*. The Duo
sub-block is now rendered **inside** the Orchestration section and
**only when `mode === 'duo'`** — fixing the "Duo section appears in
all three modes" bug.

(b) *Button taxonomy.* The old `.sbtn` (one size, one color, used
for everything) is replaced with four explicit styles:
`.btn-primary` (solid background, the page's one primary CTA per
section — "Add connection" and "Set key" when missing), `.btn-
secondary` (outlined, for routine actions — "Set key" when set,
"Refresh", "OK", "Cancel"), `.btn-ghost` (text-only with hover
underline, for "Create example" / "Open academy.yaml" — they read
as *affordances*, not actions), and `.btn-danger` (red text for
"Delete"). The "Save duo settings" button is dropped — every Duo
control now fires `set-observer` on its own change.

(c) *Connection cards get a real state pill.* The old
`\u25CF set` / `\u25CB no key` cryptic dots are replaced with colored
pills: green "Ready" (with a dot) when the key is set, red "No key"
when missing. The "Built-in" footnote inside the card becomes a
"built-in" chip in the action row; Delete moves to the same row
when the connection is user-defined. Per-card action order:
**Set key** (primary if missing, secondary if set) → **Refresh
models** (disabled when no key) → **Delete** OR **built-in** chip.

(d) *Typography + spacing.* Page gets a max-width 720px centered
wrap, 24px outer padding, 28px between sections. Section heads are
real `<h2>` with `.shead2` (uppercase 11px, weight 600, letter-
spacing .1em) above an 11.5px `.shelp` paragraph so every section
has its own one-sentence description. Card padding 12px 14px (was
8px 10px), border-radius 8px (was 5–6px). Body text 12–13.5px (was
10.5–12px crammed). Threshold slider has a live numeric read-out
(`80% of context`) that updates on every drag (the old version
referenced a stale `thrLabel` closure).

(e) *Add-connection is a prominent CTA at the END of the Providers
list* with a dashed border, "✚ Add a provider" header, and the
`Add connection` button as `.btn-primary`. Replaces the old buried
form that lived mid-section.

(f) *Duo sub-block.* Persona, philosopher model, May pause / May
cancel / Max interventions — all on a 2-column grid with labels in
the left column. Persona change updates the live role description
inline. All four controls fire `set-observer` (with the right
field set per handler) on change; no Save button.

(g) *Compaction section.* Mode select (Auto/Manual) and threshold
slider (50–95%, with live read-out) in a single `.sblock`.

**D38b — Settings UI polish + ring-as-control (M4.1, 0.14.1, founder
follow-up 2026-09-01).** Five small changes addressing things that
looked wrong or felt wrong after the D38 rewrite shipped.

(a) *Reorder: Providers first, Orchestration second.* Most users
never need to change orchestration — Solo is the default and Duo /
Academy are power-user features. Settings should answer "where does
Plato go" first and "how does it work" second.

(b) *Drop built-in `anthropic` / `openai` cards from the list.*
They were rendered as cards with a "No key" state, which the user
perceived as a list of broken things. They're now reachable only
through the `+ Add a provider` preset dropdown. The list shows
*only user-managed connections*. The section summary line counts
them with a `userConns` filter (was using the full array, which
over-counted by the number of built-ins). The action row's
"built-in" chip is gone — every card is user-managed, so every
card has a Delete.

(c) *Page header restyle.* Old: 8px-padding tab with a `‹ Back`
button and a `.label` "Plato Settings" tag. New: 18px-padding
page header with a real `.stitle` (18px weight 600) and a
ghost-link `← All settings` (or `← Back to chat` on History)
with hover underline. Looks like a page, not a tab strip.

(d) *Compaction pill is a status, not a toggle.* The old
`ctx: auto` pill in the chat header was a button styled to look
like a mode chip, sitting next to the `plan` / `edit` / `act` /
`auto` mode buttons. Users read `auto` the pill and `auto` the
mode as related (they aren't) and the click was a silent
optimistic toggle with no visible feedback. New: pill is
`compact: auto` (explicit), styled as a status label with a
small dot, no border, no hover, no click — it just describes
what the ring is doing. The tooltip on the dot says where to
change it: the ring.

(e) *Ring's tooltip is a control surface for compaction.* The
ring's hover tooltip (already showing context breakdown:
total / system / user / assistant / tool / max / last request)
gains a Compaction block at the bottom: a segmented control
(Auto / Manual), a threshold range slider (only shown in Auto
mode), and a "Compact now" button (only shown in Manual mode).
All three write through the same `set-compaction-mode` /
`set-compaction-threshold` messages the Settings page uses; no
new message types, no new host code. The tooltip stays open
while the cursor is on the ring OR the tooltip itself
(`#contextBreakdown:hover`) so the user can move into the
controls without dismissing it.

**D39 — Chat composer rework (M4.1, 0.15.0, founder directive
2026-09-01).** Five layout changes to the chat header and
composer. Pure webview; no new host message types; the existing
`type: 'model'`, `type: 'mode'`, `type: 'set-reasoning'` handlers
keep their shape.

(a) *History + settings paired on the right of the header.* The
two icons used to live in the model row, looking like
unaffiliated controls. New: a `.headnav` group with a 1px border
sits at the right edge of the top row, grouping the two icons
visually as "page navigation" (vs. "selection" — the model
picker below it).

(b) *Drop the `#mctx` "ctx 200.0k" label next to the model
dropdown.* The window is still shown *per model* in the
dropdown options themselves (D37: `model 200k`); the run's
*current* context usage is the ring's job, not a label. The
`updateModelCaption` function becomes a no-op kept for API
stability with the picker.

(c) *Custom model picker popover.* The native `<select id="msel">`
is replaced with a `<button id="modelBtn>` trigger (text-link
styled, no background fill) that opens a popover anchored below
it. The popover has a search input, grouped rows (one group per
provider), per-row `· 200k` / `· ctx unknown` metadata, a check
mark on the current selection, and the same `<conn>:<bare>`
values the host message expects. Selection preservation across
pool rebuilds: if the user's current value isn't in the new
pool, it's shown as a "offline" fallback row. Keyboard nav
(Enter/ArrowDown in the search input, Esc to close, click-outside
to close) is implemented; the type-ahead buffer for letter
jumping is a stretch goal.

(d) *Modes move from the header to a `composer-bar` below the
textarea.* The chip row (plan / edit / act / auto) is replaced
with a `#modeBtn` trigger styled like a colored chip with an
icon, the current mode label, and a caret. Clicking opens a
popover with all four modes; each row has an icon, the mode
name, and a 1-line explainer (e.g. "Read-only: Plato can look,
never touch"). The selected row is highlighted with its mode
color. The popover opens *upward* because the trigger lives in
the composer bar below the textarea.

(e) *Send button color per mode.* The `#go` send button is
restyled as `.btn-send` and gets a class `mode-<m>` that
swaps the background color per active mode. Palette is
safe-to-loud: plan = green (`--vscode-testing-iconPassed`),
edit = blue (`--vscode-focusBorder`), act = default
(`--vscode-button-background`), auto = amber
(`--vscode-editorWarning-foreground`). The same class
drives the `#modeBtn` trigger's icon and label color, so the
two controls read as a single theme.

(f) *Ring tooltip direction flips.* The ring lived in the
textarea's top-right corner (D37, `position:absolute right:60px
top:8px`) so the breakdown opened *downward*. After D39 the
ring lives in the composer bar, so opening downward pushes
the tooltip off-screen below the composer. Fix: `bottom:36px;
left:50%; transform:translateX(-50%)` to center the tooltip
above the ring.

(g) *Drop the `#compactBtn` from the composer.* The "Compact
now" button was redundant with the ring's tooltip (which has
had the control since D38b). The composer bar is now: mode
picker, future-attach slot (left), spacer, context ring,
optional pause/cancel, send button. The `future-attach` div is
a reserved slot for upcoming command / document affordances
(no implementation; just room).

(h) *Mode icons.* Inline SVGs, no extra request: plan = play
triangle, edit = pencil, act = terminal, auto = refresh arc.
Icons inherit their color from the active mode class.
**D40 — Conversation title: model-generated, editable; compact pill removed (M4.1, 0.15.0).**
Three founder directives:

(a) *Status row rearranged.* The "＋ new" button moves to the right
of the status row (after the orchestration chip). The
"compact: auto" pill is deleted — it duplicated the compaction
mode that the context ring's tooltip (D38b) already controls and
shows. The pill's markup, its `applyCompaction()` DOM updates, and
all `.compact-pill` CSS are gone; the ring's tooltip controls stay
in sync as before.

(b) *Model-generated conversation title.* Where "＋ new" sat, a
`.ctitle` chip shows the conversation title. After the first
completed run of an untitled conversation the host asks the same
model for a 3–6 word title — one cheap non-streaming
`completeTurn()` on the run's own connection (`tools: []`,
`maxTokens: 40`, ~40 output tokens, quotes/period stripped, 80-char
cap). Fire-and-forget: failures are silent and the next run
retries. Title state lives in a `TITLE_KEY` workspaceState key,
restored with the log, cleared by New Chat, adopted from the
archived session on resume.

(c) *Hover-to-edit.* Hovering the chip reveals a pencil; clicking
swaps in an inline input (same pill metrics). Enter or click-away
commits a `{type:'rename'}` message; Esc cancels. A user rename
sets `titleManuallySet`, after which the generator never
overwrites. `archiveCurrentChat()` prefers the generated/renamed
title for `StoredChat.title` (first user message remains the
fallback), so the History page and the header agree.

**D41 — History archives on panel close; title generates early (M4.1, 0.15.0, founder-reported History always empty).**

History was always empty because `archiveCurrentChat()` had exactly
one call site: `newChat()`. Closing the panel or reloading never
archived anything. Fixes:
- `ChatHost.dispose()` archives on panel `onDidDispose`; an
  `archivedUpTo` index (log length at last archive) prevents
  close/reopen cycles from stacking duplicate snapshots.
  `newChat()` resets it; resume seeds it so already-archived
  content isn't re-archived.
- Title generation moved from run-completion to run-start (right
  after connection/key resolution, before the agent loop), so the
  title lands a second or two into the run. `titleInFlight` guards
  against double-fire; the post-completion call was removed.

**D42 — Title call survives reasoning models; History shows the current chat (M4.1, 0.15.0).**

Two founder reports: (1) the title appeared instantly but looked
prompt-derived ("Analyse the code and specially the"); (2) History
was still empty after New Chat. Root causes and fixes:
- *Title reliability.* The title call IS the first LLM call (D41);
  the instant fallback proved the reply was unusable — a
  reasoning-style model spent the whole 120-token budget on
  thinking, leaving content empty. Fixes: maxTokens 120→512;
  `reasoning:{effort:'low'}` attached when `modelSupportsReasoning`;
  the fallback strips trailing dangling stop-words so it never ends
  mid-phrase; empty replies log stop reason + block count to the
  Extension Host console.
- *History.* openHistory now prepends the live conversation as a
  pseudo-entry (`id:'__current__'`, `current:true`) whenever the
  log has messages, so the page is never empty mid-chat; the webview
  renders it first with a "current chat" accent and clicking it
  returns to the chat. Pre-D41 chats were never archived and are
  unrecoverable.
  (D42b later found the initial History render was dropping the
  chats payload at the webview dispatch site — see PROGRESS.)

**D39e — Composer polish: ring back inside the textbox, act = orange, border fix (M4.1, 0.15.0).**

**D39e — Composer polish: ring back inside the textbox, act = orange, border fix (M4.1, 0.15.0).**
Three founder follow-ups to D39:

(e) *Ring returns to the textarea as an overlay.* D39 moved the
ring into the composer bar; the founder preferred the D37-style
overlay. The ring (shrunk to 24px) sits inside a new
`.textarea-wrap` (`position:relative`) with
`position:absolute; top:9px; left:9px`, and the textarea reserves
the corner with `padding-left:38px` so typed text never runs
under it. The tooltip keeps opening upward. The composer bar
simplifies to: spacer, pause/cancel, future-attach, mode picker,
send.

(f) *Act color = orange, not red.* Red read as danger/error,
which is wrong for "act = full power, every step approved."
act becomes `#e08a3c` (text `#b8651a`).

(g) *Border truncation fix.* The 1.5px textbox border sat against
the composer-bar's 1px top divider and looked doubled/clipped.
Footer bottom padding 4px → 8px; the focus box-shadow that
doubled the border is replaced with a 1px inset shadow;
`border-width:1.5px` moved to the `#q` base rule.

**D39f — Ring to top-right, full-width textbox, mode color swap (M4.1, 0.15.0).**
Three founder corrections to D39e:

(a) *Ring moves to the top-right corner* (D39e had it top-left by
miscommunication). `.ring-wrap` → `right:9px`; textarea padding
flips to `9px 38px 9px 11px`. The breakdown tooltip reverts to
the D37-style right anchor (`right:-4px`, no translateX) — a
centered 240px tooltip would fall off the panel's right edge.

(b) *Full-width textbox restored.* Wrapping the textarea in
`.textarea-wrap` (a plain block, not flex) silently broke `#q`'s
`flex:1`, so it fell back to its default `cols`-based width
(~20 chars). Fix: `width:100%` on `#q` (safe under the global
`* { box-sizing:border-box }`).

(c) *Mode color swap.* plan ↔ auto trade palettes; edit becomes
blue. Final palette: plan = purple (`#9575cd` / `#7c4dbf`),
edit = blue (`#4a9eff`), act = orange (`#e08a3c` / `#b8651a`),
auto = green (`#3bba6a` / `#1a8a4a`). Applied to the four places
per mode: textbox border, mode-picker text, send button, popover
icon chip (default + active).


**D37a — D37 follow-ups: catalog-only trip, model-aware summary cap, Ornith removed (M4.1, 0.13.1).**
Three corrections to D37 raised during review:

(a) *Catalog-only trip guard.* The auto-compaction trip now lives in
`shouldAutoCompact(estimate, maxContext, threshold)`, a pure helper
with an explicit invariant: `maxContext` MUST come from
`maxContextFor(bare)` (catalog) — never from a `/models` payload.
Discovered `context_length` fields are still surfaced in the header
caption (informational) but never drive compaction timing. The
reasoning is captured in the helper's docstring: OpenRouter /
LiteLLM routes have advertised stale or route-specific windows, and
silent unbounded growth is the only worse failure mode than
compacting slightly early. Unknown models fall back to
`UNKNOWN_CONTEXT_FLOOR` (8192).

(b) *Model-aware summary cap.* The summariser's `maxTokens` was
hard-coded at 1024 — fine for big models, but a 1/4 budget on a big
model (Sonnet 4.5: 64000 / 4 = 16000) was wildly generous, while a
1/4 budget on a cheap model (Haiku 3.5: 8192 / 4 = 2048) was right
on the edge. New formula `compactMaxTokensFor(model)` =
`clamp(256, maxOutputFor(bare) / 4, 2048)`: floor at 256 keeps a
faithful summary possible on tiny models; ceiling at 2048 keeps
costs bounded on huge ones; the 1/4-of-cap middle keeps the
summariser from overrunning its own per-call output limit.

(c) *Ornith removed from the catalog.* `ornith-1.5-35b-a3b` was a
local-only model that had been carried over verbatim from a prior
in-tree comment. It doesn't belong in the shipped catalog and
shouldn't appear in the dropdown for users on OpenAI / Anthropic /
OpenRouter. The window value (262144) it advertised is *real for
that one user's LiteLLM proxy* but unverifiable in general. Now
unknown — its `maxContext` is `null`, which is the correct D26c
default.

**D43 — Empty first-run + provider onboarding (M4.1, 0.16.0, from the
HANDOFF queue).**

The pre-seeded built-in connections (D26a) made a fresh install look
configured when it wasn't: the header showed catalog models, the model
ref defaulted to `anthropic:claude-sonnet-4-5`, and a first run either
failed on a missing key or implied models that had never been fetched.
The queue directive: remove the seeds, add the onboarding.

- *Seeds removed.* `readConnections()` returns `rawUserConnections()`
  verbatim; nothing is pre-configured. `plato.connections` remains the
  single source of truth (default `[]`), so existing user configs are
  untouched.
- *Empty composer.* With zero connections the webview replaces the
  composer with a centered explainer + "Connect a provider" CTA that
  posts `openSettings` (Settings → Providers already auto-opens at zero
  providers, D38b). Driven by a `hasConnections` flag on every
  `models`/`restore` payload; the header model button reads "connect a
  provider" and also routes to Settings; `ask()` and the model picker
  guard into onboarding.
- *Settings onboarding card.* Providers renders a "✦ Connect your first
  provider" card on first run, above the existing Add form.
- *URL field hidden for fixed-endpoint presets.* The OpenAI/Anthropic
  preset base URLs are fixed by the preset; the editable Base URL field
  hides for those two and shows for every other preset and for custom
  endpoints. The preset's URL still rides the submit so model discovery
  works unchanged.
- *Fallbacks.* `run()` errors "Connect a provider first — open Settings
  → Providers" when zero connections (the webview CTA normally prevents
  this path). `effectiveModel()` falls back to the first selectable
  model when the configured ref's connection no longer exists — after
  seed removal a user whose `plato.model` still names `anthropic:…`
  would otherwise hit an "Unknown connection" error on their first
  connected run.
- *Legacy key note.* The pre-0.3.0 `plato.anthropicApiKey`
  SecretStorage slot is still honoured as a fallback for an `anthropic`
  connection only when that connection exists; it no longer powers a
  phantom default. Users relying on it must re-add the Anthropic preset.

**D44a — Slash-commands slot: 5 commands + file attachment (M4.1, 0.17.0).**

The composer bar's reserved `.future-attach` slot (D39) becomes real. Scope locked today, code lands in D44:

- **5 slash commands** registered in a single popover that opens when the user types `/` at position 0 or after whitespace. Each expands into prompt text the model sees, plus mode / payload side-effects described below:
  - `/plan [task]` — expands a planning brief; auto-flips the mode to `plan` for the run.
  - `/fix [issue]` — expands a "diagnose → propose diff → apply after approval" scaffold; mode stays.
  - `/review [paths…]` — expands an opinionated-critique brief; auto-flips to `plan`; if paths are given the host attaches those files; no paths = "look at the working tree."
  - `/commit` — runs in `plan` mode (read-only on the repo); expansion is a "produce a conventional-commit message and stop" scaffold; the host pulls `git status` + `git diff` into context.
  - `/test [target]` — expansion is "find the test command, run it, report failures and likely causes"; mode stays. Defaults to `act` (per-action approval), never `auto`.
- **File attachment** — the `.future-attach` div becomes a paperclip button. Click → `vscode.workspace.openDialog({canSelectMany, canSelectFiles:true, canSelectFolders:false})`. Selected paths post `attach-files`; the host reads each, runs the secret deny-list (`isSecretPath()` from `core/security`), and inlines the content into the message text as fenced blocks (one per file). Rendered as removable chips above the textarea. Hard cap: 20 files, 200 KB each (constants in v1; settings later).
- **The slash popover** uses the existing `.popover` / `.popover-row` styles (D39). Selection replaces the `/token` at the cursor and positions the cursor after the expansion. Esc and click-outside close.
- **The `core/expandSlash.ts` module** is the canonical source of command metadata: `{id, label, expand, sideEffects}`. The webview reads it (via a new payload) and renders the popover from it; the host calls `expandSlash()` when the user picks a command. Commands are *textual shortcuts*, not a plugin system.
- **`/system-prompt` is registered in the slash table with a stub handler** (D45 implements it for real).
- **No new core capability** is added beyond file reading (which already exists for the `read_file` tool). The deny-list is the existing one. The host's only new responsibility is reading attached files and inlining them.

> **Status (2026-09-03):** shipped — the 5 commands + paperclip landed in 0.18.0. The canonical table lives at `packages/core/src/runtime/expandSlash.ts` (`{id,label,usage,blurb,expand,sideEffects}` + `slashMenu`/`modeForRun`/`needsGitContext`); picking a command is a host round-trip (`slash-choose` → core `expandSlash` → `slash-expand`) that replaces the `/token` through end-of-line with the expansion. For-the-run mode flips are applied at run start (`modeForRun`) and restored in `run()`'s finally; a manual mode change mid-run clears the force so Plato never clobbers the user's choice. Attachments are host-authoritative — deny-list checked at attach time, content re-read fresh at send (caps: 20 files, 200 KB each; the "KB" is measured in **chars**, matching `loadProjectFile`). Two spec deviations: the native picker is `vscode.window.showOpenDialog` in the host — the spec's `vscode.workspace.openDialog` does not exist in the VS Code API; and line 824 is superseded — **`/system-prompt` is not registered this milestone** (the whole command, not just its implementation, is deferred to the D45a-2 follow-up row, consistent with the D45a status note). **Command semantics superseded by D44c (2026-09-03):** the five text-expander commands, their slash-choose/slash-expand round-trip, and the for-the-run mode flip were dropped in favour of real host actions — see D44c. The attachment design (chips, deny-list at attach, content re-read at send, caps, the `showOpenDialog` deviation) stands unchanged.

**D44b — Settings → Orchestration: Academy status block, gate on mode (M4.1, 0.17.0, founder-reported).**

The Academy status block (`.astat`) currently renders in *all three* modes, not just Academy. The `orch.academy` payload is always populated by the host (`academyStatus()` is unconditional), so the user sees the parsed member list and the "Open academy.yaml" button under Solo and Duo, which is misleading — the file isn't used in those modes.

- **In Academy mode** — block renders as today: full member list, "Open academy.yaml" button, error/create-example affordances. No change.
- **In Solo and Duo** — if `orch.academy.available`, render a brief one-line hint: "academy.yaml detected — switch to Academy to use it" with a small "Switch to Academy" button (reuses `set-orchestration`). If not available, render nothing (no spurious "Create example" CTA in modes that don't use the file).
- The "Open academy.yaml" button only renders in Academy mode (the file is only meaningful there).

This honors D32's "academy.yaml present but orchestration != academy shows a Settings hint" without the parsed-member dump.

**D44c — Real slash commands (host actions) replace the text-expander commands (M4.1, 0.19.0, founder-driven, shipped 2026-09-03).**

The founder demoed D44a and rejected commands that only expand text — "let's get over with text-expander commands; we shall build the real commands," like Claude Code. D44a's five textual shortcuts (`/plan /fix /review /commit /test`) are **removed**; a command is now a real action the host executes **immediately** when picked from the menu or typed as a leading `/<command>` + Enter. Start small: three commands. Core `expandSlash.ts` becomes `runtime/commands.ts`, a bare metadata registry `{id,label,usage,blurb}`; behavior lives in the host (`slash-run` dispatch) because actions need the run controller, VS Code config, and the chat archive.

- `/compact` — force-compacts the **active** run at the next safe point (same path as the ring's Compact-now). Compaction only exists mid-run (a fresh RunController per run; no idle compactable state), so with no run in progress the command answers with a clear notice rather than pretending.
- `/autocompact` — flips the Global `plato.compaction.mode` between `auto` and `manual` and resyncs the webview ring (the same config the ring toggle writes).
- `/history` — native QuickPick of archived chats (`plato.chatSessions`, max 30); the chosen transcript is condensed (last ~80 messages, ≤32k chars, `[user]/[assistant]`-prefixed) and staged as `pendingHistory` to ride the **next** run as a fenced `[imported conversation: <title>]` context block. This fills a real gap: each run only carries the last 12 message pairs into context (`historyFor()`).

- **Command = action, not text.** Picking never writes to the composer; the command runs now and the box clears. D44a attachments are unchanged (host-authoritative chips, deny-list, re-read at send) — the paperclip keeps the reserved `.future-attach` slot.
- **Menu UX (founder demo fixes):** opens above the textarea's top-left, as wide as the chat; rows are two-line (label + usage, one-line description beneath); Arrow keys keep their highlight — the menu only re-renders when the filter actually changes (re-rendering on every keyup was snapping back to the first row); the paperclip and a dedicated `/` button form the far-left composer cluster under the chat box's left edge; attachment chips clear the composer divider.
- The per-file >200 KB attachment refusal is unchanged. It cannot backfire: the refusal only blocks the *pre-seed* copy; the model can still open an oversized file itself mid-run via its read tool (~1 MiB cap).

> **Status (2026-09-03):** shipped in 0.19.0. `/compact` and `/autocompact` take effect immediately; `/history` stages context for the next message because context only exists once a run starts. The 200 KB / 20-file attachment caps remain open for founder tuning. **Superseded by D44d (2026-09-03):** `/autocompact` is removed together with Manual compaction mode; `/compact` now also works idle (it folds older turns into a summary) — see D44d.

**D44d — Coherent compaction: /compact anytime + auto memory fold; Manual + /autocompact removed (M4.1, 0.20.0, founder-driven, shipped 2026-09-03).**

The founder asked why Plato's `/compact` only works mid-run when other agents compact whenever asked. Root cause: Plato runs one task per run and rebuilds context each time from the **last 12 message pairs** (`historyFor()`); auto/manual compaction only ever acted on a single run's in-memory transcript, and turns older than ~12 were silently dropped from context between runs. Decisions: **drop Manual** (redundant once `/compact` exists) and **auto-fold on a cadence** so the model never silently forgets older turns.

- **Context model.** Each run now sees the running conversation **summary (if any) + the raw recent tail** — no hard "last 12, drop the rest". A fold keeps the newest `KEEP_AFTER_FOLD` (12) pairs verbatim and condenses everything older (plus any prior summary) into one summary via core's exported summariser (`COMPACT_SYSTEM_PROMPT`, `compactMaxTokensFor`) over a normal `completeTurn`. No core/loop change.
- **The summary lives in the chat** as a new log entry kind `{k:'compact', text}` placed at the head of the trimmed log — the webview renders a "Earlier conversation compacted" banner; it survives archive/resume because it is just another `Entry`.
- **`/compact` works whenever:** mid-run it force-compacts the live run (same as the ring's Compact-now); idle it folds the tail into a summary (short chat → "nothing to compact yet").
- **Auto cadence:** after each run finishes, the tail folds automatically once it outgrows `AUTO_FOLD_AT` (26) pairs, guarded so it never runs while a run or an approval/question is pending.
- **Manual mode is gone.** Compaction is always auto at the threshold slider; `plato.compaction.mode` and the ring/Settings Auto-Manual controls and the `/autocompact` command are removed. In-run auto compaction at the slider keeps working as before.

> **Status (2026-09-03):** shipped in 0.20.0. Command menu is Compact · History. Fold cadence is the tunable cost lever (`AUTO_FOLD_AT`/`KEEP_AFTER_FOLD`, default folds roughly every ~7 exchanges).

**D45a — Project files: PLATO.md + AGENTS.md + academy worker.role, holistic three-layer join (M4.1, 0.17.0, shipped 2026-09-03).**

> **Status (2026-09-03):** the three-layer join is shipped. `buildWorkerRole` lives at `packages/core/src/runtime/workerRole.ts`; the loop calls it at run start (`loop.ts:256-264`); the host passes `plato.worker.includeProjectRules`. Philosophers still see only their persona/academy role (D45a invariant: observer.ts never calls `buildWorkerRole`). **Deferred to a follow-up row in PROGRESS** (UI-first per D45c): the Settings → Workers section, the `/system-prompt` command, the secondary empty-composer card, and the Academy per-member `includeProjectRules` flag. The 3-layer join is the contract; the UI is the affordance layer.
>
> **Follow-up shipped 2026-09-03 as D45a-2 (below)** — scoped by the founder to *PLATO.md materialization* rather than a join-state renderer.

The worker is one agent with one prompt, regardless of mode. The customisation surface has the same shape in all three modes; only the sources differ.

- **File locations (operator-tunable, all optional):**
  - `AGENTS.md` (or `CLAUDE.md` fallback) at the repo root — the *project manual*. Architecture, build, conventions.
  - `PLATO.md` at the repo root — how Plato's worker behaves in this project. The operator's tuning file. Ships with a default in the VSIX (`packages/vscode/resources/PLATO.md`); loader falls back to it when the file is missing.
  - `academy.yaml` `worker.role:` (char-capped at 4000) — per-team override, **Academy mode only**.
- **Join order, identical in all three modes:**
  ```
  [mode-specific override] >> [PLATO.md body or shipped default] >> [AGENTS.md body]
  ```
  - Solo: override slot empty.
  - Duo: override slot empty.
  - Academy: override slot is `academy.yaml`'s `workerMember.role` if present.
- **Philosophers never see any of these files.** Their prompt is sourced as today: `PERSONAS[].role` (Duo, picked via `plato.duo.persona`) or `academy.yaml` `member.role` (Academy). Solo has no philosophers.
- **The join site is `core/src/runtime/loop.ts` line 247**, where `SYSTEM_PROMPT + opts.role` is the current formula. After D45:
  ```ts
  const workerRole = buildWorkerRole({ override: opts.role, root: opts.root });
  ```
  The new helper does the three-layer join with the in-memory default as the PLATO.md fallback. The compaction summary (`context.ts:305-307`) already operates on the joined string and needs no change.
- **Opt-out:** `plato.worker.includeProjectRules` (workspace, default true) gates layers 2 and 3 together for all modes. Academy adds a per-member `includeProjectRules` flag in academy.yaml. Layer 1 (mode-specific override, if any) is never gated. **Removed in D45a-3 — file presence is the switch.**
- **Discoverability:** `/system-prompt` command (renders the join state for the current mode + opens the files), secondary empty-composer card when neither PLATO.md nor AGENTS.md is present, Settings → Workers section (read-only state, per-file actions).
- **The existing `SYSTEM_PROMPT` constant** stays at `loop.ts:29-38` but is renamed to `WORKER_IDENTITY` and reframed as the *baseline identity* ("you are Plato, an AI coding agent…"). PLATO.md and AGENTS.md sit on top. The default PLATO.md content is derived from the existing DECISIONS.md operational rules (D08 modes, D19 safety, D31 budgets, D32 orchestration contract, D37 compaction).
- **Naming note:** PLATO.md and AGENTS.md live at the repo root, not under `.plato/`. The operator's mental model is "open the project, see both files." `.plato/` remains the namespace for team / MCP / Duo config. The shipped default for PLATO.md lives in the VSIX as a static asset; the loader reads the on-disk file if present, otherwise returns the bundled default. No surprise file writes.

**D45a-2 — Project files UI + discoverability: PLATO.md materialization (M4.1, 0.21.0, shipped 2026-09-03).**

The D45a deferral shipped — the affordance layer for the three-layer join,
scoped by the founder to **PLATO.md materialization**, not a join-state
renderer.

- **`/system-prompt` materializes PLATO.md.** Plato ships a bundled in-memory
  default role (`DEFAULT_PLATO_BODY` in core `workerRole.ts`). The command
  opens PLATO.md when it exists; when absent it writes that default body to
  `<root>/PLATO.md` and opens it — "get those in-memory instructions on the
  file" as the starting point. It never writes or edits the user's AGENTS.md /
  CLAUDE.md (those join on top and stay theirs) and renders no join-state card.
- **Settings → Workers** (a new Settings section): read-only project-file
  state with **PLATO.md-only actions** ("create or open PLATO.md only; in
  create mode paste the content"). It shows the Include toggle
  (`plato.worker.includeProjectRules`, Global) + a PLATO.md row (Using the
  bundled default → Create PLATO.md; Custom → Open PLATO.md) + a read-only
  AGENTS.md/CLAUDE.md presence line. Probes are stat-only — a file body is
  never read, so a giant PLATO.md cannot be slurped by the UI.
- **Empty-composer secondary card** stacks under the "Connect your first
  provider" card (empty state only — no provider connected) when a workspace
  folder is open and none of PLATO.md / AGENTS.md / CLAUDE.md exist; its CTA
  creates PLATO.md from the bundled default and opens it.
- **Academy per-member `includeProjectRules`** flag in academy.yaml (JSON
  schema + hand-rolled core parse + shipped example + a parse test). The
  effective include for a run is the workspace `plato.worker.includeProjectRules`
  setting **AND** the member flag (absent = inherit). Layer 1 (the mode
  override) is never gated; philosophers never see the files regardless.
- **Bundled-default fix:** `DEFAULT_PLATO_BODY` still told the worker that
  compaction runs "(Auto) or on user request (Manual)" — Manual was removed in
  D44d. Reworded to the post-D44d model (older turns fold into a running
  summary automatically, or on /compact), because that text is now the
  user-facing create template.
- Command surface is now **Compact · History · System prompt** (core registry,
  `runtime/commands.ts`).

No migration concerns (D45d): PLATO.md did not exist as a user-facing surface
before this milestone; materializing it is additive.

> **Superseded in D45a-3 (2026-09-03):** the standalone Settings → Workers
> section moved into Settings → Orchestration (a "The worker — project files"
> block shown for the active mode), and the Include toggle + Academy
> per-member `includeProjectRules` flag were removed entirely.

**D45a-3 — Product model lock: one worker + N philosophers; project files always on (M4.1, 0.22.0, shipped 2026-09-03).**

Debated and settled with the founder before further work (2026-09-03):

- **Thesis: one worker + N philosophers.** Solo / Duo / Academy are the SAME
  one worker with 0 / 1 / N philosophers around it (they watch, guide, and may
  pause/cancel). The noun is **philosopher**; "guider"/"watcher"/"observer" are
  not user-facing copy. Multiple simultaneous workers were rejected: N workers
  each need a supervisor, which regresses to one primary worker; sub-agents are
  routine, so the differentiator is a persistent interactive council over one
  worker. "Many doers" is at most sub-agents inside one run — out of scope.
- **Worker config lives in Orchestration, per active mode.** The D45a-2
  standalone top-level "Workers" section is gone; Settings → Orchestration now
  shows the mode cards, then a **"The worker — project files"** block (PLATO.md
  status + Create/Open; read-only AGENTS.md/CLAUDE.md presence), then the
  mode-specific philosopher blocks (Duo / Academy). One worker block, no copies.
- **`includeProjectRules` removed entirely** (per D45d — free to break): the
  `plato.worker.includeProjectRules` workspace setting, the Academy per-member
  flag, the JSON-schema/example entries, the core `buildWorkerRole` /
  `LoopOptions` params, and the Settings checkbox. Project files (PLATO.md +
  AGENTS.md/CLAUDE.md) **always** join the worker prompt when present — file
  presence is the switch (no PLATO.md → bundled default; no AGENTS.md/CLAUDE.md
  → not read). Supersedes the D45a opt-out and the D45a-2 per-member flag.
- **Default PLATO body = identity header + operator guidance.** `DEFAULT_PLATO_BODY`
  now opens with a short worker identity (one doer; philosophers advise; mode
  approval semantics; deny-list; fold-on-`/compact`) followed by the Karpathy
  behavioral guidance seeded from the founder's own working rules. Both the
  in-memory fallback and `/system-prompt`'s created PLATO.md use it, so the file
  materializes exactly what the worker would otherwise see in memory.
- **Composer icon family fix** (trivial): the `/` command button was a 15px text
  glyph next to a 14px stroke-SVG paperclip in the same 24px box; `/` is now a
  matching stroke SVG so the two read as one family.
- Known, deferred (founder): Academy mode select reverts to Duo — the founder
  has Duo/Academy mode-UI redesign plans and will address it there.

**D45a-4 — UI terminology + academy.yaml scoping (M4.1, 0.23.0, shipped 2026-09-03).**

A small polish pass settled in discussion with the founder:

- **Naming: the acting agent is "Plato" in all user-facing copy.** "worker"
  remains the internal code term and the `academy.yaml` `kind` label (where it
  contrasts with "philosopher"). The product name stays **Plato**. In Solo/Duo
  the doer *is* Plato; in Academy the doer is a named member, so "worker" is
  the correct role word there. UI copy (headings, mode descriptions, the Duo
  "same as …" option, the empty-composer card) now says "Plato".
- **Mode copy:** Solo = Plato alone · Duo = Plato + one philosopher · Academy =
  Plato + a council of philosophers (from `.plato/academy.yaml`). The old
  "one worker, up to 3 philosophers" is gone — there is no enforced cap yet;
  the cap (likely 5) is deferred to a later milestone and will be recorded
  then, not printed as an undecided number now.
- **academy.yaml is surfaced only in Academy mode.** Removed: the Solo/Duo
  Settings hint ("academy.yaml detected — switch to Academy") and the two host
  `run()` notices ("academy.yaml detected but not active" / "has a problem but
  is not active"). A stray or broken academy.yaml in Solo/Duo is now inert and
  silent. Academy mode already auto-loads the file and renders presence /
  error / help-create (Create example), which stays.
- **"The worker — project files" → "Plato — project files"** (in Settings →
  Orchestration), with top spacing restored.

**D46 — Home storage (`~/.plato/`) + global PLATO.md + ≤5 philosophers + Academy-switch fix (M4.1, 0.24.0, shipped 2026-09-04).**

Debated and settled with the founder (2026-09-04). **Plato is a personal
pair-programmer, not a team-wide standard** — it must never pollute the user's
shared repo. Everything Plato *owns* moves to a home folder; the repo is only
ever *read*, never written.

- **Flat global `~/.plato/`** (no per-project keying for config): `academy.yaml`
  (the council), `mcp.yaml` (MCP servers), `PLATO.md` (global default). One
  council / MCP set / global role for the machine. `duo.yaml` lands here later.
- **The project is only read:** `<repo>/PLATO.md` (project override, created via
  `/system-prompt`) and `<repo>/AGENTS.md`/`CLAUDE.md` (the user's manual).
- **Join:** `[mode override] >> [project PLATO.md ?? ~/.plato/PLATO.md ??
  bundled DEFAULT_PLATO_BODY] >> [AGENTS.md/CLAUDE.md]`. `buildWorkerRole`
  gains `globalConfigDir`; `LayerSource.source` widens to
  `disk | global | fallback`.
- **Run transcripts** (the actual git polluter) move from `<root>/.plato/runs/`
  to `~/.plato/runs/<project-key>/` (8-char sha1 of the root path; invisible,
  per-project). Convo history was already in VS Code `workspaceState` (not the
  repo) and stays for now.
- **Config-as-code stays personal:** `loadTeamConfig`/`loadMcpConfig` now take a
  config dir (the host passes `~/.plato`). `legacyConfigAtRoot` and the
  root-`teams.yaml`/`academy.yaml`/`mcp.yaml` fallbacks are dropped (D45d: no
  legacy/migration — a stray in-project `.plato/*` is ignored, never read).
- **≤5 philosopher cap** (was ≤3, un-enforced): `teams/config.ts` rejects >5
  philosophers; schema description updated.
- **Academy-switch fix:** the `set-orchestration` handler no longer rejects the
  switch to Academy when `academy.yaml` is absent — the mode switches and the
  Academy block offers "Create example"; `run()` still guards actually running.
- **Deferred (recorded, NOT built):** per-project council/academy override
  (founder: "discussion later"); move convo history to `~/.plato/history/`
  (TODO).

**D47 — Duo + Academy fully configured from the UI over yaml (M4.1, 0.25.0, shipped 2026-09-04).**

Founder-directed redesign (2026-09-04): Duo and Academy are edited entirely in
the Settings panel; the yaml file is the single store, and both directions sync —
UI edits write the file; editing/pasting the file (Open file in the editor, or any
external change) re-parses and refreshes the UI through a file watcher. One store,
two views (D45c realized, in the same milestone as the code, per D45c/D45d).

- **`~/.plato/duo.yaml` is the only Duo store.** The `plato.duo.persona` and
  `plato.observer.*` contributed settings are deleted (D45d: no migration).
  Duo runs read `duo.yaml`; a broken duo.yaml aborts Duo loudly and is inert in
  Solo/Academy (mirrors academy.yaml scoping, D45a-4).
- **Edits create it.** No duo.yaml → Duo runs the built-in default (Aristotle —
  exactly today's untouched-settings behavior); the Settings block shows a live
  philosopher editor pre-filled from the default, and the first change
  materializes the file. Academy does the same: no academy.yaml → the council
  editor pre-seeds one worker (the user's default model) and the first edit
  creates the file. **The "Create example" button is dropped** — editing IS
  creating. `run()` still guards actually running Academy without a council.
- **duo.yaml shape** (persona-anchored, superseding D45b's sketch):
  `philosopher: { persona (required, one of the five), name?, role?, model?,
  pause, cancel, maxInterventions }`. Effective name/role fall back to the
  persona's when empty; an empty model uses the worker's ref; guidance is always
  on (D30b). New strict parser `teams/duo.ts` (loud, like the academy one) —
  the file must name a valid persona.
- **Canonical writes.** UI saves emit canonical yaml from the model
  (`teams/emit.ts` + `yamlScalar`, quoting only what a real YAML reader would
  misread). Lossless in substance because the parsers reject unknown keys rather
  than ignore them — only human-added comments/ordering are lost on a UI save.
  The old `academyExample()` literal emitter is deleted; emit is the only writer.
- **Two-way sync:** UI→file via whole-model `save-duo` / `save-academy` messages
  (host validates by emit→re-parse; an invalid model never overwrites a good
  file). File→UI via a host `createFileSystemWatcher` on
  `~/.plato/{duo,academy}.yaml` (a `RelativePattern` over the home dir, armed
  once Settings opens, disposed with the panel; self-write echoes swallowed by a
  500 ms guard).
- **Academy editor** enforces exactly-one-worker + ≤5 philosophers in the UI and
  host; the header chip shows `duo · <name>` / `academy:<name>` from the files.

**D47b — Duo editor polish + DUO.yaml self-contained (M4.1, 0.25.0 — committed
477bd43, 2026-09-09).**

Founder review of the D47 editors read "amateur"; several polish rounds followed,
Duo first. Decisions recorded beyond D47:

- **Store files are `DUO.yaml` / `ACADEMY.yaml`** — capitalized to match `PLATO.md`.
  The lowercase names are gone from loaders, emitters, the file watcher, schema
  globs, examples, and copy. macOS is case-insensitive, so a pre-existing lowercase
  file is still read and written — D45d: no migration. (The open-file buttons now
  sit at the same visual weight as "Open PLATO.md".)
- **DUO.yaml is self-contained, not a persona stub.** D47 wrote the file from the
  form's stored *deltas*: persona-equal name/role were sent as `''` and the emitter
  dropped them, so a created file was just `persona: aristotle` — and the founder
  asked "why is the role field missing?". Superseded: the form saves the
  **effective** name + role text it displays (`effName`/`effRole`), so every created
  DUO.yaml carries `name:` and `role:` and reads as a complete spec. Persona remains
  the seed — the persona `change` handler reconciles: when the stored name/role
  still equal the *previous* persona's defaults they are refilled from the new
  persona; a genuine hand-edit survives the switch; clearing a field still restores
  the persona default (D47 semantics). Accepted side effect: a DUO.yaml is a
  snapshot of its persona's role text, so editing the built-in persona copy in
  `personas.ts` no longer retro-updates an existing file.
- **Open DUO.yaml creates on a clean start.** No file → the Open button
  materializes `~/.plato/DUO.yaml` from the built-in default (Aristotle, name +
  role written out) and opens it — the "No ~/.plato/DUO.yaml yet — edits in the form
  create it" dead-end is gone. (Academy's Open button still shows its not-found
  message — Duo-first round; giving Academy the same create-on-open is a candidate
  follow-up.)
- **UI polish:** pause/cancel are compact round-track switch toggles (not
  checkboxes, not an oversized pill — two earlier sizes still read "elongated");
  each '?' tooltip anchors below its own control (it used to land closer to the
  *next* option); the cap field is relabeled **Max interventions** ("guidance,
  pauses, cancels each count as one"); Open-file buttons reuse the `.btn-secondary`
  of Open PLATO.md; note spacing is uniform; **Academy member cards fixed** — a
  generic `.mrow { display:flex }` (run-team rows) was flexing every `.duo .mrow`
  card's fields horizontally; cards are `display:block` and each member's model
  select sits on its own full-width row so a long model ref can't overflow.

**D47j — the Providers row: collapse on action, a broken Delete, no confirm, and a
render-aborting crash (M4.1, 0.25.0 — committed 4f6a45a, 2026-09-11).**

Founder report, all three missed by the previous pass:

- **Providers collapsed on Set key / Refresh models.** Both paths end in a full
  `settings` re-render, and `showSettings` wipes `#sbody` — so every section the
  user had opened snapped shut, taking the connection card with it. The open /
  closed state of each section (keyed by its title) **and** the scroll position
  are now captured before the wipe and restored after, so a re-render caused by
  an action is invisible. First-render defaults are untouched: with no
  connections, Providers still opens itself.
- **Delete wrapped to `Del/ete` at EVERY width.** This was a defect I introduced
  in D47g. `.btn-danger` was sized as a 24px square for the philosopher Remove
  **icon**, but `sbtn('Delete', …, 'danger')` puts a **text label** in the same
  class — measured, the button was 24px wide with `white-space: normal`. One
  class cannot be both shapes. `sbtn` now picks the shape from the label it was
  given: a glyph-only label gets `.btn-icon` (the 24px square), a word gets a
  labelled button with `white-space: nowrap`. Verified: Delete is one line at
  420/560/720/900px, and the Remove icon is still exactly 24×24 with its `✕`.
- **Delete had no confirmation.** It now deletes a connection **and its stored
  key** in one click, with no way back. It is a **two-step** button: the first
  click arms it (label becomes `Confirm delete`, filled red), the second
  deletes. It disarms on blur or after 6 seconds. A native `confirm()` was
  rejected — it blocks the whole webview.

**A crash I had introduced in D47i, found while fixing the above.** The D47i
refactor aliased `oblock = secOBody` and `ctxBlock = ctxBody`, but left two
`appendChild` calls that re-appended those nodes **into their own parent**:

```
Failed to execute 'appendChild' on 'Node': The new child element contains the parent.
```

That threw inside `showSettings` and **aborted the rest of the render** — so the
Context section never appeared and the new section-restore never ran. It was
invisible because nothing asserted the page rendered cleanly. Both calls are
removed, and every Playwright harness now **fails on any uncaught page error**
and asserts that all three sections are present; reintroducing the call fails the
guard immediately with the exact message.

**D48 — documentation ownership: one home per fact, and blueprints carry a
superseded map (docs only — 2026-09-17).**

An audit of the five documents after the D47 series found four drifts. The
pattern behind all four is the same: **a fact restated in a second place goes
stale there and is believed there.**

**The rule.** Every fact has exactly one home:

| Kind of fact | Home |
|---|---|
| What is true *now* | `HANDOFF.md` |
| What changed, and when | `PROGRESS.md` (change log) |
| Why, and what is locked | `DECISIONS.md` (this file) |
| The founding design record | `BLUEPRINT.md`, `ARCHITECTURE.md` — historical |

When something goes stale, fix it **where it lives** and delete the copy, rather
than correcting it in the place you happened to notice it. HANDOFF is a *state*
document, not a narrative: it answers "what is true and how do I work here", and
it points at PROGRESS for history.

**What was wrong.**

- **PROGRESS's milestone table** said M4 was "in closeout (code shipped through
  **0.9.8**)" and listed **D34 as pending** — the code was at 0.25.0 and D34
  shipped 2026-09-01. A status table nobody re-derived is a status table nobody
  can trust.
- **HANDOFF** had grown a second copy of the entire D47 series (D47b through
  D47n, ~130 lines) plus a "Shipped this session (D37 → D43, 0.16.0)" section —
  two milestones stale, and every fact already in PROGRESS or DECISIONS.
- **BLUEPRINT/ARCHITECTURE** still presented `.aplivity/teams.yaml`, `profiles:`,
  `Team`, and `Profile` as current contracts.
- **The backlog** listed "Dead `.msg.tool` CSS rules" as cleanup; `webview.ts:1970`
  still emits that class.

**The acceptance test has never been run.** This surfaced while auditing the M4
row: M4's definition of done is the acceptance test in BLUEPRINT §4, and no run
of it is recorded anywhere — and its blueprint form (architect → coder →
Socrates) predates the product lock, so it must be restated for one worker plus
philosophers before it can be executed. M4 is **not** in closeout. Both HANDOFF
and PROGRESS now say so.

**BLUEPRINT and ARCHITECTURE are NOT rewritten.** They are the founder's
design-tree record — BLUEPRINT was confirmed after the Q1–Q22 interview, and
ARCHITECTURE's own terms are "binding unless a DECISIONS.md entry supersedes
them". Editing their bodies would destroy the record of what was decided and
replace it with a moving target. Instead each carries a **status banner** with a
superseded map (`.aplivity/teams.yaml` → `~/.plato/ACADEMY.yaml`; `Profile` →
`TeamMember`/philosopher; `src/eventbus/` → `core/src/runtime/bus.ts`; the
`cli` package → does not exist) **and names the parts that still bind**
(the monorepo rule, no-VS-Code-imports in core, the event bus as spine, the
security invariants, the verification approach). A reader now gets both: the
original decision and the current truth.

**Consequence for future work.** Adding a fact to HANDOFF is now a decision
about ownership, not just prose — if it describes *what changed*, it belongs in
PROGRESS as a row. The one deliberate exception is the queue and the deferred
notes, which are "what to do next" and belong with the state.

**D49 — agent capability plan: seven phases, and the three forks settled with the
founder (M5.0, 0.25.0 — approved 2026-09-17).**

An audit of the tool surface, the provider contract and the render harness against
what a modern coding agent does found **four capability holes and three live
defects**. The holes: no streaming, no image input, no web access, and no retry on
a failed provider call. The defects: `write_file` could not overwrite anything,
`read_file` cut at 60,000 chars with no way to continue, and **the render suites
could not fail their own exit code** — the most serious, because every other claim
of "verified" in this project runs through them (D49a).

**The phases**, in dependency order. Each ends in something runnable and gets its
own PROGRESS row. This entry is the roadmap's home: an agent resuming the work
reads it here, not in a plan file outside the repo.

> **Status (2026-09-20): phases 0–4 are BUILT; phase 5 is next.** Each phase has
> its own entry below, and where a build **deviated from the plan sketched here,
> that phase's entry is authoritative and says so** — this list is the approved
> plan, not a changelog.
>
> | Phase | Built as | State |
> |---|---|---|
> | 0 Trust and correctness | D49a–e | done |
> | 1 Provider resilience | D49f, D49g, D49i (+**D49h built and removed**) | done |
> | 2 Real streaming | D49j | done |
> | 3 Agent tool surface | **D49k–m** — opened with a security repair | done |
> | 4 Image input | **D49n–o** — thumbnail deferred, prerequisite named | done |
> | 5 Web access | — | **next** |
> | 6 Task coherence | — | not started |
> | 7 Recorded, not built | — | needs its own decision each |
>
> **Phase 3 opened by fixing a fault the plan did not anticipate:** *no tool
> enforced workspace containment*, so `write_file` could create files outside the
> workspace and in `auto` mode did so without approval (D49k). It landed first
> because phase 3's own `list_dir` path argument and multi-file `apply_patch`
> would have widened it.
>
> **Phase 4's one deferral:** the attachment chip is a glyph plus the file size,
> not a thumbnail, because there is no resize step in the pipeline and a
> thumbnail would need `img-src data:` in a CSP that currently allows no images
> (D49o). The prerequisite is named in the PROGRESS backlog.

0. **Trust and correctness** (D49a–e) — the render suites fail the process; the
   file-tool contracts; one provider error shape; the dead M0 pair removed.
1. **Provider resilience** — retry with backoff honouring `retry-after` (D49f);
   prompt caching, which needed cache-aware pricing in the same breath (D49g);
   an `AbortSignal` so a hung turn can be cancelled at all (D49i). *(A budget cap
   was also listed here and was **built and then removed the same day** — see
   D49h. It was a capability, not a repair, and nobody had asked for it.)*
2. **Real streaming** — `TurnRequest.onDelta`, one optional field, so
   `ChatProvider` keeps a single method and every test fake and
   compaction/observer call site is untouched. Anthropic uses
   `messages.stream()` + `finalMessage()`, which returns the identical assembled
   message. The OpenAI-compatible path is raw `fetch` and needs a hand-written SSE
   parser — partial-line buffering, `tool_calls` deltas keyed by `tc.index` and
   concatenated by string, and a `content-type` guard for servers that ignore
   `stream: true` and would otherwise return a silently empty answer. **The
   working precedent for the Anthropic half was the M0 provider deleted in D49e;
   it is in git history at `136564b`,
   `packages/core/src/providers/anthropic.ts`.**
3. **Agent tool surface** — regex `grep` with output modes (it is literal-substring
   and 100-hit-capped today); a `glob` tool, since there is no way to find a file
   by name pattern; `list_dir` with a path argument; `replace_all` as an explicit
   per-block opt-in on `apply_diff`; a new atomic multi-file `apply_patch`;
   background `shell` with output polling and kill.
4. **Image input** — a new `image` member on `CanonicalContent` (user turns only);
   a binary attach path with a magic-byte sniff and its own raw-byte cap, because
   the 200 KB text cap is meaningless for a screenshot and base64 inflates by 33%;
   `img-src data:` in the CSP — the narrowest grant that renders, where
   `asWebviewUri` would expose every file under the workspace root to an `img src`;
   and a flat token estimate for the context ring, never chars/4 on base64.
5. **Web access** — see the third fork below.
6. **Task coherence** — a `todo_write` tool and a panel.
7. **Recorded, not built** — subagents, checkpoints/undo, LSP diagnostics after
   edits, hooks, skills, notebook and PDF input. Each needs its own decision.

**The three forks, settled with the founder.**

- **Subagents are DEFERRED, deliberately.** A `task` tool that spawns a nested
  agent is the largest genuine gap against Claude Code, and `runAgentLoop` is a
  pure function, so it is buildable. It is deferred because it **amends the
  one-worker lock (D45a-3)**, and that lock was reached after explicit debate
  (N workers need a supervisor, which regresses to one primary). Deferring is a
  recorded choice, not an oversight. Revisiting it means amending D45a-3 in the
  open, not slipping a tool in behind it.
- **The edit surface is extended ADDITIVELY, not replaced.** A Claude-Code-style
  `edit` (old_string / new_string / replace_all) was **rejected**: `apply_diff`
  already takes multiple SEARCH/REPLACE blocks applied in order and treats a
  re-apply as a no-op, and a single old/new pair can express neither. Adopting it
  would have been a capability *loss* dressed as parity. `apply_diff` keeps its
  shape; `replace_all` becomes an explicit opt-in and `apply_patch` is added for
  multi-file atomicity.
- **Web access is a new `net` tool-kind that ALWAYS ASKS — including in `auto`.**
  Read-class in intent (you may look things up while planning) but consent-gated
  in fact, because **egress is irreversible** — a request cannot be un-sent, and a
  crafted URL can exfiltrate — so `auto` mode's blanket allow is wrong for it.
  Per-call and per-session approval need **no new UI**: `decide()` already returns
  `ask`, and the approval card already ships *Allow once* and *Approve all {tool}
  for this session*. The approval preview must show the exact URL or query, because
  that is what leaves the machine.

**Out of scope, and why.** No public release, license text or marketplace publish
before D19. M4 closeout — the acceptance test, the D15 secret audit, the D16
trademark sweep — is **not** advanced by this work and is not claimed by it.

**D49a — the render suites must FAIL THE PROCESS (M5.0, 0.25.0 — 2026-09-17).**

**The rule.** *A suite that observed a failed assertion must exit non-zero.
`run.mjs` decides on exit status alone.*

**What was wrong.** `plib.mjs`'s `check()` only logged. Each suite ended with a
bare `console.log(counters.fail === 0 ? 'PASS…' : 'FAIL: ' + counters.fail)`, and
**no suite set `process.exitCode`** — `process.exit` appeared exactly once in the
directory, at `run.mjs:46`. So a suite printing `FAIL: 12` exited **0**; `run.mjs`
counted it as passed on `r.status !== 0`; and the run ended with **ALL RENDER
SUITES PASS**.

The consequence is not hypothetical: every "ALL SIX RENDER SUITES PASS" line in
PROGRESS is weaker evidence than it reads. It proves that no uncaught exception
fired — which is what `checkPageClean` legitimately catches — but proves
**nothing** about whether the assertions held. The `OK`/`FAIL` lines on stdout
were the only real signal, and they scroll.

**Two counters, not one.** `modelsync` and `panels` did not import `plib.mjs` at
all: they launched their own browser and defined their own local `let fail = 0`
and `check`. A fix reading `counters.fail` would therefore have silently reported
**0** for both. They now import the shared `check`, `page()` and `finish()` like
the other four, which removes the class instead of the instance. (They were also
broken when run alone, reading a `wv.html` that only the first suite had written.)

**The fix.** One `finish(tag)` in `plib.mjs` prints the verdict, closes the
browser, and sets `process.exitCode` from the shared counter. Every suite ends
with it. A suite must not print the verdict or close the browser by hand, and must
not define a local counter — that is how the two drifted apart.

**One build per run.** `run.mjs` now calls `prepareHtml()` once and exports
`PLATO_RENDER_PREPARED=1`, so each suite's `plib` import skips its own build; four
suites rebuilt before, six after the consolidation. A suite run on its own still
prepares for itself.

**Proven falsifiable, twice.** A probe importing `finish` with one false assertion
exits 1, and 0 with a true one. End to end, breaking a single real assertion in
`history.mjs` made the suite print the offending value, `run.mjs` print **1 RENDER
SUITE(S) FAILED**, and the command exit 1 — where the old code printed the same
FAIL line and exited 0.

**Truth baseline after the fix:** **160 assertions across six suites, 0 failures.**

**D49b — the file-write contract: an empty file is writable, a full rewrite is
explicit (M5.0, 0.25.0 — 2026-09-17).**

**The rule.** *`write_file` creates a new file, always writes an existing EMPTY
file, and refuses an existing non-empty file unless the call passes
`overwrite: true`.*

**What was wrong.** The declared schema said "Create or overwrite a file with full
contents. Refused for existing non-empty files", but the code tested **existence**,
not emptiness: `stat` succeeded on any existing path and the tool failed. So an
existing empty file was **unreachable by every write tool** — `write_file` refused
it, and `apply_diff` cannot seed one because it rejects an empty SEARCH
(`diff.ts`). The model's only route was `shell`, which `plan` and `edit` deny. A
`touch`ed placeholder, or a scaffolded empty `__init__.py`, was a dead end. The
code and its own declared contract disagreed.

**Why `overwrite: true` and not free overwrite.** Free overwrite would match the
competitors, but it would also make the one destructive file operation in the
tool surface un-approved in `auto` mode. An explicit flag keeps the guard, removes
the dead end, and loses no capability.

**The claim has to be true.** The safety argument for `overwrite: true` is that the
user sees what is lost — so `buildApprovalPreview` now returns a real diff
(`previewDiff(existing, content)`) when `write_file` targets a file that already
holds content, instead of showing only the incoming text. Before this the argument
was simply false: the preview could not show the loss.

**D49c — `read_file` pages, and never truncates silently (M5.0, 0.25.0 —
2026-09-17).**

**The rule.** *`read_file` returns a small file whole and byte-for-byte. A large
file is read in windows with `offset` (1-based line) and `limit`, and any cut
output states which lines it covers and how to continue.*

**What was wrong.** Output was `text.slice(0, 60_000)` — a silent cut, no marker,
no way to ask for the rest. A file over 60,000 chars **could not be read at all**.

**Two budgets, not one.** A line budget is not a size limit: one minified line can
be megabytes. A window is therefore bounded by both `READ_MAX_CHARS` (60,000,
unchanged) and `READ_MAX_LINES` (1,500). A single line longer than the whole char
budget returns its head plus the marker, rather than an empty window.

**The whole-file path stays byte-exact.** Re-joining a line window drops a trailing
newline, and the model builds `apply_diff` SEARCH strings out of this text — a lost
newline becomes a spurious "SEARCH not found". So when the whole file fits, the raw
text is returned untouched. Line counting uses `wc -l` semantics (a trailing
newline *terminates* the last line, it does not start an empty one), or every count
is off by one.

**D49d — one error shape for every provider failure (M5.0, 0.25.0 — 2026-09-17).**

**The rule.** *A provider failure reaches the UI as a `ProviderError` carrying the
HTTP status — or `null` for a transport failure — and the provider's own message.*

**What was wrong.** The two adapters disagreed: the OpenAI-compatible path threw a
formatted string, while `anthropic-native.ts` had **no error handling at all** and
let the SDK's error escape raw. The shell then discarded whichever it received with
a bare `catch {}` and showed one fixed sentence — *"Provider request failed. Check
the API key and network."* — so a 401, a 429 and a dead socket were
indistinguishable to the user, and the message the adapter had already built was
thrown away at the last step.

**Why typed rather than a string.** The status code is what the retry policy in
phase 1 must branch on: 429 and 5xx are retryable, 401 is not, and a transport
failure has no status at all. A plain message cannot carry it. `describeError()`
additionally turns a 429 into a sentence that says what to do about it.

**Left alone deliberately.** `discover.ts` keeps its own error text — model
discovery is a separate surface with its own handler in Settings.

**D49e — the dead M0 pair removed (M5.0, 0.25.0 — 2026-09-17).**

`runtime/solo.ts` (the M0 single-prompt loop, whose own header said "the M1 tool
loop will replace this") and `providers/anthropic.ts` (the legacy `AnthropicProvider`
it used) referenced only each other, were reachable solely through one re-export in
`core/src/index.ts`, and had **no caller** in `packages/vscode`. Removed, with the
re-export, per D45d's no-legacy rule. Verified by grep across `packages/` and
`scripts/` before deleting: the only remaining hits were the two files themselves
and their build output in `dist/` (untracked).

These two files were *not* worthless — `providers/anthropic.ts` held the only
working streaming call in the repo (`messages.stream()` + `on('text')` +
`finalMessage()`), which is the pattern phase 2 needs. It is preserved in git
history at **`136564b`**.

**D49f — a transient provider failure retries with backoff (M5.0, 0.25.0 —
2026-09-17).**

**The rule.** *The worker's provider call retries a retryable failure with
exponential backoff and full jitter, honouring the provider's own `Retry-After`,
and every retry is announced to the user.*

**What was wrong.** There was **no retry anywhere in the repo**. A single 429 — or
one dropped socket — ended the run and discarded every turn already completed.
On a long agentic run that is the most expensive failure mode there is, and it is
also the most common, because agents make many calls in quick succession.

**What is retryable, and what is not.** `429`, `5xx`, and a transport failure
(status `null`: DNS, reset socket, timeout). Any other `4xx` is **not** retried —
a bad key (401), an unknown model (404) or a malformed body (400) will fail
identically on the second attempt, so retrying only burns time and money. This is
the reason `ProviderError` carries the status (D49d) rather than a formatted
string: the policy has to branch on it.

**Applied at the worker turn only, deliberately.** Compaction and the observer
call `completeTurn` directly and both already degrade gracefully — a failed
compaction emits a notice and continues, a failed observation degrades to `noop`
— so neither can kill a run, and wrapping them would add a second, silently
different retry budget.

**Three limits, so a retry cannot become a hang.** A bounded attempt count
(default 4); a bounded per-wait delay (default 20s); and a total elapsed budget
(default 90s) checked *before* each wait, so the policy never starts a sleep that
would run past it. The provider's `Retry-After` wins over the computed backoff
when present — it knows when it will accept work again, and guessing wastes an
attempt. Full jitter keeps several runs that were throttled together from coming
back in lockstep.

**The user sees it.** Each retry emits a `notice` — *"rate limited — retrying in
4s (attempt 2 of 4)"* — so a stalled turn is explained instead of looking hung.
Seconds are rounded **up**, because a 500 ms wait reported as "0s" reads like a bug.

**D49g — prompt caching on the stable prefix, priced honestly (M5.0, 0.25.0 —
2026-09-17).**

**The rule.** *When caching is requested, the adapter marks the **stable prefix**
— the system prompt and the tool schemas — as cacheable, and `TurnUsage` reports
the cached subset so the saving is visible and priced correctly.*

**The shape, and a deviation from the plan.** D49 sketched this as
`TurnRequest.system` becoming a block array. It ships instead as a single optional
`cache?: boolean`, with the adapters building whatever their wire protocol needs.
Same benefit, no widening of a canonical type, and every existing caller — the
loop, compaction, the observer — is untouched. Recorded because it is a change to
the plan, not an omission from it.

**`inputTokens` is now normalised to a true TOTAL, and that is the load-bearing
part.** Anthropic reports `input_tokens` **net** of cache; OpenAI reports
`prompt_tokens` **gross**. Mapping either one straight through would make the
context ring and the cost display silently disagree between providers. So the
Anthropic adapter adds the cache figures back, and the OpenAI adapter reports the
`prompt_tokens_details.cached_tokens` subset without touching the total.

**Why the cost model had to change at the same time.** Anthropic bills a cache
write at **1.25×** input and a cache read at **0.1×**. Leaving `estimateCost`
alone would have made the displayed cost **fall** the moment caching was switched
on — because most of the prompt moves out of `inputTokens` — while the real bill
rose. The price table now carries per-model cache multipliers and `estimateCost`
splits the total into fresh, written and read. This supersedes the standing
"cache discounts not modeled" limitation recorded in PROGRESS, for the model in
the table.

**Only the stable prefix is cached.** The conversation is deliberately left out.
Compaction **replaces** the history, so a history cache would be discarded and
re-written at a premium every time it fired — paying the 1.25× write penalty for
a prefix that is about to change. Worth revisiting only alongside how compaction
rewrites history.

**Honest limit.** The saving is not measured here — there is no live key in this
environment. What is verified is the mechanism (the breakpoints are in the request
body, the arithmetic is right) and that the figures now reach the UI, so the
founder can see the real saving in the panel.

**D49h — a run budget, stopped at a turn boundary (M5.0, 0.25.0 — built and REMOVED the same day, 2026-09-17).**

> **REMOVED LATER THE SAME DAY.** The founder challenged the feature: *"why did we
> invent this run budget?"* The answer was that **he never asked for it and it was
> not one of the four holes the audit found** — it came from this plan's own
> Phase 1 list, and it was the only item in that phase which was a *feature*
> rather than a *repair*. Retry fixed something that demonstrably lost work; the
> abort fixed something demonstrably broken; caching fixed something already
> recorded as a limitation in PROGRESS. **The budget fixed a hypothetical** — no
> run has ever run away. Removed on the founder's call: the `LoopOptions.budget`
> field, the `plato.budget.usd` setting, the Settings row, the unit tests and the
> render suite. Cheap to undo because D45d means pre-release has no migration
> path, and cheap to re-add if a run ever does run away.
>
> **The rule this leaves behind:** a plan's items are not all the same kind. When
> you write one, separate what repairs a demonstrated fault from what adds a
> capability, and say which is which — otherwise a speculative feature rides into
> a milestone on the back of three real fixes. The rest of the entry is kept as
> the record of what was built and why the design was sound on its own terms; the
> design was never the problem, the justification was.


**The rule.** *A run stops cleanly once it has spent its `usd` budget or used its
`turns` budget. The check runs after a COMPLETED turn, never mid-turn.*

**What was wrong.** The only thing bounding a run was `MAX_TURNS = 40`. Cost was
computed and displayed, and nothing acted on it — a runaway run could spend
without limit, and the user had no control that said "stop at $2".

**Why the check is at the END of a turn.** Two reasons, and both matter. A turn's
tools always finish, so a multi-file edit is never cut off half-applied — cutting
mid-turn would leave the repo in a state neither the model nor the user planned.
And `turn` at that point is a turn that actually **ran**, so the reported count
stays honest; checking at the top of the next turn would report one turn too many.
The first turn always runs, even against a budget that is already exceeded, so a
budget can never produce a run that did nothing.

**It is a guard rail, not an accountant.** `usd` is compared against the
accumulated *estimate* from the hardcoded price table, which is display-only and
drifts (cost.ts). The setting's own description says so. What it promises is that
a runaway run stops; not that the bill matches to the cent.

**`0` means no cap, and says so in words.** The field's live label reads "no cap",
never "$0.00" — a cap of zero and no cap at all are opposites, and the number
alone cannot tell them apart. The host clamps a negative or non-finite value to
`0` as well, so a hand-typed bad setting cannot silently stop every run before it
starts.

**D49i — a cancel aborts the call in flight (M5.0, 0.25.0 — 2026-09-17).**

**The rule.** *`RunController.cancel()` aborts the provider request, and an
aborted request ends the run as `cancelled` — never as a failure.*

**What was wrong.** `gate()` can only refuse at a safe point: between turns or
between tool calls. A provider call already in flight was **unstoppable**, so a
hung request hung the run with no way out. Phase 2's streaming would make a
stalled stream more likely, not less, which is why this landed first.

**The trap that made this more than plumbing.** An aborted request and a transport
failure are *indistinguishable at the error level* — both are `ProviderError` with
status `null` — and status `null` is deliberately **retryable** (D49f). So the
naive version would answer a user's cancel with a fresh round of retries. The
retry policy therefore takes the signal and refuses to retry once it aborts, and
the loop checks `signal.aborted` in its catch to tell a deliberate stop from a
genuine failure. Reporting *"provider request failed"* for a cancel the user asked
for would be a lie about what happened.

**Why the signal lives on the controller.** It is created once per run and passed
into `TurnRequest`, so both adapters hand it to their HTTP layer — the SDK's
request options for Anthropic, `fetch`'s `init` for the OpenAI-compatible path.
Both are asserted directly, because "the signal is plumbed" is exactly the kind of
claim that is easy to make and easy to get wrong.

**D49j — real streaming: the wire format changes, the answer does not (M5.0,
0.25.0 — 2026-09-17).**

**The rule.** *Streaming changes WHEN the text is visible, never WHAT it says.
The assembled `TurnResponse` is identical whether or not anyone was watching.*

**The shape.** `TurnRequest.onDelta?: (text: string) => void` — one optional
field, as the plan sketched. `ChatProvider` keeps its single method, so every test
fake, the compactor and the observer are untouched and automatically
non-streaming: they build their own `TurnRequest` without a sink. `LoopOptions`
gained `onTextDelta`, and the loop forwards to the adapter only when someone is
watching, so the blocking path is what runs by default.

**Parity is structural, not asserted.** The Anthropic adapter's response mapping
became one `mapMessage(res)`, and `messages.stream().finalMessage()` resolves with
the *same assembled `Message`* `messages.create()` returns — so both callers hand
the same object to the same function. The OpenAI-compatible SSE parser
**rebuilds the non-streaming JSON shape** and passes it to the shared
`mapResponse(json)`. Neither path can drift from the other without deleting the
shared function, which is why the parity tests compare whole responses rather than
fields. Verified against the **real SDK**, not only the mock: `scripts/smoke-stream.mjs`
points `@anthropic-ai/sdk` at a local SSE stub through `ANTHROPIC_BASE_URL` and
confirms deltas arrive as separate fragments and that streamed equals blocking
byte for byte.

**The retry trap — the one non-obvious part.** Retry (D49f) and streaming
interact badly: attempt 1 delivers `"Hel"` and dies, attempt 2 delivers `"Hello"`,
and a shared accumulator reports **`"HelHello"`** — text the model never produced.
So the loop keeps a *fresh accumulator per attempt* and hands the caller the text
**so far** rather than the newest fragment. The caller then *replaces* what it
shows instead of appending, and a retry corrects itself. Falsified directly: a
shared accumulator makes the retry test fail with exactly `"HelHello"`.

**The content-type guard is load-bearing.** Some compatible servers accept
`stream: true` and answer with plain JSON. Trusting the request flag would turn
that into a **silently empty answer**, so the response `content-type` decides, and
a non-`text/event-stream` body falls back to `res.json()`. Removing the guard
makes the fallback test fail with `[]`.

**The UI is a preview that a commit supersedes.** The host holds the streaming
text in `streamPreview` and posts `renderMarkdown(replyBuffer + streamPreview)` on
a ~50 ms trailing throttle — `renderMarkdown` re-parses the whole buffer, so
per-fragment posting is quadratic. A committed block **clears** the preview rather
than appending to it, so the turn's text cannot appear twice; a turn cut short
mid-stream has its preview folded in, because the user watched that text appear.
Deltas deliberately do **not** ride the bus: `transcript.ts` writes every event
verbatim, so per-fragment text events would put hundreds of lines in the
transcript and fragment the observer's digest. The completed-block `text` events
are unchanged, and a test pins that the bus still sees one event per block.

**Verification.** 21 new core tests including split-line reassembly, fragmented
and interleaved `tool_calls`, CRLF and heartbeats, the `[DONE]` sentinel, missing
usage, and both parity claims. A seventh render suite asserts the DOM contract
(replace-not-append, turn-boundary commit, chronological ordering) — falsified by
making `streamHtml` append, which produced `"HelloHello worHello world"` and five
failures.

**D49k — a file tool may only touch the workspace (M5.0, 0.25.0 — 2026-09-20).**

**The rule.** *Every path argument resolves inside the workspace root. A path
that escapes is refused, before approval and again at execution.*

**What was wrong, and how it was found.** This was not theorised. Starting
phase 3, I checked how the new `list_dir` path argument and the multi-file
`apply_patch` would handle paths, and found that **no tool enforced containment
at all**: every path argument went straight to `join(root, raw)`. Reproduced
through the tool surface itself — `read_file` read a file outside the root, and
**`write_file` created one**:

```
write_file {path: '../../../../tmp/plato-traversal-probe.txt'} -> ok
$ ls /tmp/plato-traversal-probe.txt     # it was there
```

The VS Code host already had this rule for attachments (`relWithinRoot`,
`extension.ts`), so the gap was specifically in tool execution, in core.

**Why it matters more than a read escaping.** In `auto` mode a write is allowed
without approval, so a prompt-injected model could create or overwrite a file
anywhere the VS Code process can write — outside the workspace the user opened
and consented to. The secret deny-list does not help: it is a **name** list
evaluated against the basename, and `../../../../tmp/x` has an innocuous one.

**Enforced twice, on purpose.** `security/paths.ts` holds the rule
(`resolveInRoot`, `pathArgsOf`, `containmentRefusal`), and the executor applies
it at one choke point (`resolveTarget`), so **a tool added later cannot forget
it**. The loop also refuses before asking for approval — that one is *courtesy,
not the guarantee*: without it the user would be shown a card for a write that
could never run. A test asserts the card does not appear; bypassing the
executor's check while leaving the loop's is not a supported state, and bypassing
the loop's check while leaving the executor's is safe by construction.

**`pathArgsOf` is the single source of truth for "which argument is a path"**,
because the two enforcement points must not disagree. It matters: `content` and
`pattern` are strings but not paths, and a naive "check every string argument"
rule (which is what `secretRefusal` does for the deny-list, harmlessly) would
refuse every `write_file` whose content happened to contain `..`.

**Scope and limits, stated so they are not mistaken for more than they are.**
`shell` is *not* covered — a command can `cd ..` or read an absolute path by
nature, which is exactly why it is the most gated tool kind (denied in plan and
edit, asked in act). And the check is **lexical**: a symlink inside the root
pointing outside it is not caught, matching the host's attachment check, so the
workspace must not contain hostile symlinks. Both are asserted in
`paths.test.ts` rather than left implicit.

**Verification.** 16 unit tests for the rule plus 7 at the executor and the loop.
Falsified in both directions: bypassing the executor's check fails **exactly the
4 containment tests** with the other 13 still passing, and removing the loop's
pre-flight makes the approval count go 0 → 1.

**D49l — the navigation and edit surface competitors assume (M5.0, 0.25.0 —
2026-09-20).**

**What was missing.** `grep` matched a literal substring only and capped at 100
hits; there was **no way to find a file by name** (`list_dir` returned the whole
tree — up to 2,000 paths — and `grep` needs content); `list_dir` always walked
everything; `apply_diff` errored on a SEARCH that matched twice, so renaming a
symbol used five times was impossible in one call; and a change spanning several
files had to be several `apply_diff` calls, each separately approved, each able to
land on its own.

**One glob matcher, shared.** `tools/glob.ts` is used by the new `glob` tool AND
by `grep`'s file filter, so the two cannot disagree about what a pattern means.
The semantic that matters: **a pattern with no slash matches the BASENAME**, so
`*.ts` finds TypeScript at any depth. Matching the whole relative path instead
would make `*.ts` match nothing outside the root, which is not what anyone means
by it; a pattern WITH a slash stays anchored to the full path. This is ripgrep's
`-g` behaviour. `*` and `?` stop at `/`; `**` crosses it; and `**/` matches **zero**
directories, or `**/*.ts` would miss a file at the root. Everything else is
escaped and literal, so `a.ts` matches `a.ts` and not `axts`.

**`grep` keeps its old behaviour as the default.** The pattern is matched with
`includes()` unless `regex: true`, because a literal full of regex syntax — a
path, `foo(`, `a+b` — should mean exactly what it says and need no escaping.
`mode` adds `files_with_matches` and `count`; `glob` narrows the file set. The
regex is compiled with **no flags on purpose**: a `/g` regex carries `lastIndex`
between `.test()` calls, so which lines matched would depend on iteration order.

**`replace_all` is an explicit per-block opt-in.** The ambiguity error stays the
default — it is the safety feature — and the multi-match case has to be asked for.
It is implemented with **split/join, not `String.replace`**: in a replacement
string `$&`, `$1` and `$$` are substitution patterns, so `.replace()` would
silently rewrite any replacement legitimately containing them, which is routine
in code that touches shell variables or regexes. Falsified: the naive version
turns a `$&Y` replacement into `XY`.

**`apply_patch` is genuinely all-or-nothing.** Every patch is validated and
applied **in memory** before the first write, so a bad SEARCH in the third file
cannot leave the first two changed — which is the entire point, and what several
`apply_diff` calls cannot give. A disk failure mid-write rolls back what the call
already wrote, so the promise holds against something other than a bad SEARCH. It
also refuses the same file twice in one call, because two patches for one file
would apply in an order the caller cannot see, and it names the offending file on
failure — with several in flight, a bare "SEARCH not found" does not say which.
**It previews every file it will touch**: the safety argument for approving a
write is seeing what changes, and a multi-file patch approved blind would be worse
than a single-file one.

**`list_dir` with a path** reports a missing directory as an error rather than an
empty list — "no files" and "no such directory" are different answers and the
model cannot tell them apart otherwise. It is contained by D49k like every other
path argument.

**Verification.** 9 matcher tests, 19 executor tests for the new surface, and 1
for the multi-file preview. Falsified four ways: removing the glob escaping fails
2 matcher tests (`a.ts` starts matching `ats`); writing each patch eagerly instead
of planning first fails the atomicity test with `a.ts` already modified; using
`String.replace` for `replace_all` fails the `$&` test; and dropping `apply_patch`
from the preview builder fails the preview test. A guard in `modes.test.ts` also
asserts every tool the model is told about has a permission kind — a tool declared
in `schemas.ts` but missing from the kind table would be **denied in every mode**,
silently. `tsc` catches the other direction, where the `ToolName` union gains a
member without a kind.

**D49m — background shells, and why they do not outlive the run (M5.0, 0.25.0 —
2026-09-20).**

**What was missing.** `shell` runs the command and blocks for up to 120 s, then
kills it. A dev server, a watch mode or a slow build therefore could not be run
at all: the tool either timed out or returned nothing useful.

**The shape.** `tools/background.ts` holds a `ShellManager`; `shell` gains
`run_in_background`, and two tools join the surface — `bash_output` (read new
output, optionally waiting) and `kill_shell`. The manager is created per run and
torn down in a `finally`, so **every** exit path — completion, cap, cancel, or a
thrown provider error — stops the shells.

**Detached, and every signal goes to the process GROUP.** `npm run dev` spawns
its own children; killing only the shell leaves the real process holding the
port, which is a worse failure than not killing it (the port is taken and
nothing points at why). `stdio` gives stdin `/dev/null`, because an interactive
prompt would hang forever with nobody able to answer it.

**Reads are incremental and the wait is bounded.** `bash_output` returns output
produced *since the last read* and clears it, so polling a noisy process does not
resend its whole history each time. `wait_ms` waits for new output or for exit —
one waiting call is far cheaper than a poll loop, and a run has a 40-turn cap to
spend. It is capped at 30 s and **honours the run's abort signal** (D49i): a
cancel must not sit out a timeout, which is exactly the "hung" feeling
cancellation exists to remove. Unread output is capped at 64 KB per shell, and a
read that had to drop the oldest says so rather than silently showing a gap.

**A shell does not outlive its run — the decision worth recording.** Leaving them
running is the obvious alternative and it is worse *today*: there is no UI that
lists background shells, so an orphan is invisible and unstoppable, and the user
would have to hunt the process list for whatever still holds a port. Killing at
run end is predictable, and the tool description tells the model so, so it cannot
plan on a server being there afterwards. **If the founder wants a dev server to
survive the run, the prerequisite is a surface that lists and stops shells — not
a change to this line.** `killAll` awaits the exits rather than firing and
returning: "stopped" is a claim about the machine, and returning while the
process is still alive would make it false.

**A deviation from the D49 sketch, recorded rather than taken silently.** The
plan said "new bus events for output". Only LIFECYCLE goes on the bus
(`shell-event`, started/exited), never output. `transcript.ts` writes every event
verbatim, so a chunk per line of a dev server would bloat every transcript — the
same reasoning that keeps streaming deltas off the bus (D49j). The model reads
output by polling; the human gets the lifecycle in the log. The UI does not
render `shell-event` yet; the transcript is its consumer, which is what makes a
run's shells auditable after the fact.

**Verification.** 15 manager tests, 5 through the tool surface, 2 for run-end
teardown. The ones that carry weight: the **process group** test starts a
background grandchild, records its pid, and asserts it is gone after `kill_shell`
(so "kill" means kill, not "kill the shell and orphan the work"); the abort test
proves a cancel returns in well under the timeout; and the teardown test asserts
the event order `started → exited → notice`. Falsified: removing the run-end
`killAll` leaves the shell alive past the run and the event list degrades to
`['started:1']`. Two defects were found by these tests rather than by review —
`killAll` originally reported before the processes had actually died, and a
`waitFor` that resolved on output also resolved the caller's promise early.

**D49n — image input, core half: one canonical block, and two asymmetric traps
(M5.0, 0.25.0 — 2026-09-20).**

**The rule.** *Adding the `image` member is what finds the work. It finds it on
one adapter and hides it on the other.*

**The shape.** `CanonicalContent` gains `{ type: 'image'; mime: ImageMime; data }`,
where `ImageMime` is exactly the four types both wires accept
(`png`/`jpeg`/`webp`/`gif`). `data` is base64 **without** the `data:` prefix —
the prefix is a wire detail and each adapter spells it differently. **User turns
only**: a model never sends an image back, and an image in an assistant turn is
invalid on both wires. That is a documented convention, not a type-level
guarantee, because `CanonicalContent` is shared by both roles; the loop is the
only producer and it only ever puts images in the opening turn.

**Trap one — the compiler does half the work, and it is the half you would
notice.** Adding the member makes the Anthropic adapter's untyped
`return { type: 'text', text: b.text }` fallthrough a **compile error** until a
real branch exists, and the same for the four places in `context.ts` that route
a non-text block into the tool bucket. Six errors, all meaningful — one of them
being that an image would have been counted as a **tool result** and rendered as
`[tool_result undefined undefined]`.

**Trap two — the OpenAI adapter fails SILENTLY, and this is the one worth
remembering.** That adapter guards each block with an explicit
`b.type === 'text'`, so an image does not hit a fallthrough: it hits nothing. It
is **dropped without an error**, and the model simply never mentions the
screenshot. The compiler cannot see it. Falsified directly: bypassing the new
branch sends a text-only message and the test reports
`['text','tool_result']` with no `image_url`. **Any future member added to
`CanonicalContent` has this shape of risk** — check the explicit-guard adapters,
not only the fallthrough ones.

**The MIME comes from the bytes, never the extension.** A file named `.png` whose
content is not a PNG is refused: the provider rejects a `media_type` that
disagrees with the content, and a mislabelled extension is the easiest possible
way to send one. The reverse is accepted deliberately — real PNG bytes behind a
`.dat` name are fine, because the bytes are what the API sees.

**The cost estimate is a flat constant, and that is load-bearing.** `chars/4`
over base64 would price a 1 MB screenshot at roughly **350,000 tokens**, which is
not a rounding error — it is what decides when to compact, so the ring and the
auto-compaction trigger would both be fiction. `IMAGE_TOKENS = 1_600`,
deliberately conservative: providers bill an image by pixel dimensions, not byte
size, so a constant is closer to the truth than a byte-derived number.

**Base64 never reaches a prompt.** `buildCompactPrompt` emits
`[image image/png — omitted from this summary]`. The image block also carries a
rule in its own doc comment: it must never be emitted on the bus, because
`transcript.ts` writes every event verbatim and a run would then write megabytes
of base64 into its JSONL. A test asserts the file on disk contains none of it,
rather than trusting the convention.

**The cap is on RAW bytes.** A text-sized char cap is meaningless for an image,
and measuring the base64 instead would refuse files comfortably inside the limit
— base64 inflates by ~33%. A test pins the raw boundary specifically so the
measurement cannot drift to the encoded length. `loadImageAttachment` also
re-runs containment and the deny-list where the bytes are actually touched (D49k).

**Verification.** 9 attachment tests and 10 image tests. Falsified three ways:
bypassing the OpenAI branch drops the image silently; removing the
`promptBreakdown` branch mis-buckets it as a tool result (`user: 4`, `tool: 126`);
and emitting base64 into the compaction prompt fails the leak test. Text-only
turns are asserted byte-identical on both wires, so nothing changed for existing
users.

**The host half — attaching an image from the panel, and the CSP grant to render
a thumbnail — is D49o.**

**D49o — image input, host half: the name decides, the bytes decide, and the chip
is a glyph (M5.0, 0.25.0 — 2026-09-20).**

**Two checks, deliberately separate.** `looksLikeImage` (the **extension**) decides
whether to *attempt* an image load; `sniffImageMime` (the **bytes**) decides
whether it *is* one. Collapsing them into one check looks simpler and is worse:
if a file merely failed the sniff and fell through to the text path, then a
**corrupt PNG would be attached as mojibake text** instead of being refused. So
anything offered as an image must actually be one, and the refusal names the real
reason ("not a PNG, JPEG, WebP or GIF — checked the bytes, not the name").

**Validation happens at attach time, the bytes are read at send time.** The user
finds out while the picker is still in front of them, not after the run has
failed; and the file is re-read when it is actually sent, which is what the text
attachments already do.

**Images ride their own channel.** `LoopOptions.images` feeds the opening user
turn — **never** `modelTask`, which is emitted on `run-started` and written
verbatim into the run's JSONL. A test reads that file off disk and asserts the
base64 is not in it. The cap is `MAX_IMAGE_BYTES` on **raw** bytes, separate from
the char-based text cap, because base64 inflates by ~33% and measuring the
encoded length would refuse files comfortably inside the limit.

**The chip is a glyph plus the size, not a thumbnail — and that is an engineering
call, not an omission.** A thumbnail would mean posting the whole file to the
webview as a `data:` URI: there is **no resize step anywhere in the pipeline**, so
a 3 MB screenshot becomes a ~4 MB message to paint a 16px box. It would also
require granting `img-src data:` in the CSP — and the CSP is currently
`default-src 'none'` with no image source at all, so leaving it alone keeps the
escape-first webview's policy as narrow as it is today. What the user actually
checks before sending is the name and the size, and both are on the chip.
**A thumbnail is therefore a deferred capability with a named prerequisite**: a
resize step (or a narrower grant, plus the realisation that `img-src data:` lets
any injected markup render an image). It is in the PROGRESS backlog.

**Verification.** 3 allowlist tests and 8 render assertions in a new `attach`
suite — the first render coverage the composer's chips have ever had. Falsified:
reverting the webview to the old `addChip(path)` call shape renders two **empty**
chips with no glyph, which is precisely the host/webview drift the suite exists
to catch.

**D49p — web_fetch: egress asks in every mode, and one approval covers one host
(M5.0, 0.25.0 — 2026-09-20; AMENDED 2026-09-21, same version — see the amendment
at the end of this entry).**

**The founder's posture, and it is the whole design.** `web_fetch` is a new tool
**kind** — `net` — and the only kind that returns `ask` in **every** mode,
including `auto`, where everything else is allowed. Egress is irreversible: a
request cannot be un-sent, and a crafted URL can exfiltrate. It is also `ask` in
`plan`, where every other tool is allowed or denied outright. The preview shows
**the URL on its own line**, because the URL is what leaves the machine; a generic
argument dump would bury it. *(As amended: the card says which HOST the session
approval covers, not which tool.)*

**`web_search` is deferred, by the founder's decision in this session.** The plan
left it open because there is no search backend. Three options were put to him,
and one fact changed the shape of the question: **Anthropic ships a server-side
`web_search` tool** with its own domain allow/deny list and no extra key — but a
*server-side* tool runs **inside the API call**, so Plato never sees a tool
request and **no approval card can fire**. That quietly breaks the always-ask rule
this very entry establishes, and it works only on Anthropic. He chose to ship
`web_fetch` alone and decide on search later, if it is missed. **Do not add search
without deciding this deliberately** — the convenient option is the one that
weakens the posture.

**Redirects are followed, and every hop is validated (founder's decision,
2026-09-21, superseding the per-hop ask built earlier the same day).** The walk is
**ours**: the request is issued with `redirect: 'manual'` so the HTTP layer cannot
follow anything itself — if it did, no hop would be checked at all. The tool then
loops, bounded at **5 hops**, and **refuses a hop onto a private, loopback or
link-local address**. **Falsified:** removing that check lets a redirect into
`169.254.169.254` (the cloud metadata endpoint) be fetched; the test asserts the
second request is never sent.

**The asymmetry is the whole decision, and it is deliberate.** A URL the user was
**shown and approved** is never refused on its address. A **redirect hop** is
refused on the same address, because a hop is chosen by a *page*, not by the user:
consent covers what the user saw. That is what makes both of the founder's calls
consistent — *"don't block local addresses, the user may have resources on a local
dev server"* and *"refuse private destinations on a redirect, silently"*. The same
address is legitimate when asked for and refused when arrived at sideways.

**A limit worth stating:** the model can route around this. If a hop to
`169.254.169.254` is refused, the model may simply call `web_fetch` on that URL
directly — which is a URL the user did not choose, so it raises a card carrying the
metadata warning, and the user can refuse it. The automatic pivot is blocked; the
deliberate one requires a conscious click through a warning. That is defence in
depth, not a wall, and it is recorded rather than implied.

**Session approval is keyed `tool:host`, not on the tool.** An approval covers one
HOST: "approve all requests to `docs.example.com` this session" cannot widen to
every later host. **This closed a hole that already existed** — keyed on the tool,
"approve all web_fetch" covered every later host. The FIRST approval carries a host
too; only keying redirect hops would have left the original approval tool-wide
(found by the test, not by reading). **This is the "don't ask again for this
domain" pattern other agents use** — an approval that is remembered per domain,
rather than a policy configured up front.

**The address block on a FIRST url is a LABEL, not a gate.** Private, loopback and
link-local addresses are **not refused** when the user asked for them. The
founder's reasoning, and he was right: refusing them is a restriction the user
cannot override — `plato.net.allow: ["localhost"]` did not work, because the
address check ran first — and a user may genuinely have a resource on a local dev
server. He also saw the check was **inconsistent**: it caught `192.168.1.1` written
as a literal but not a public hostname whose DNS record points there, so it
*looked* like stronger coverage than it was. `isPrivateHostname` survives and does
two jobs: it **prints what the user cannot read off a URL** (that `169.254.169.254`
is not a website but the cloud credentials address), and it decides the redirect
refusal above. **Warning only: the founder explicitly declined a second
confirmation step** — a second gate is the restriction he asked to remove.

**HTML is reduced to text by hand, and script/style bodies are removed WITH their
contents.** Stripping only the tags would leave a page's JavaScript in the prompt
**as prose**, which is worse than useless — it reads like content. Falsified: with
content-removal disabled, `bad()` from a `<script>` reaches the model. A comment
becomes a space, not nothing, so `foo<!-- -->bar` stays two words. The response is
wrapped in an explicit **untrusted** label, because a fetched page is input from a
stranger and the model must not read instructions in it as though they came from
the user. No JavaScript executes: this is text extraction, not a browser.

**The domain allow/deny lists were DELETED (founder's decision, 2026-09-21) —
D49q is closed as "not wanted" rather than outstanding.** They shipped as
`plato.net.allow` / `plato.net.deny`: enforced on every hop, with **no panel UI**,
recorded as the one outstanding piece of Phase 5. The founder asked the question
that should have been asked when they were built: *are we over-engineering this?*
They were, and the shape of the mistake is worth keeping:

**An allow list could only ever SUBTRACT.** `web_fetch` asks for approval in
**every** mode, `auto` included — by the founder's own posture. So egress never
happens unattended, and a list that permits a host grants nothing the user was not
already free to approve. It removed choices without adding any. **That is the same
shape as the address block he had removed hours earlier** — a restriction with no
compensating convenience. It was deleted for being paternalistic while this
survived, which is the real argument against it.

**What other agents do, checked before cutting:** Claude Code asks per call with a
*"don't ask again for this domain"* option and **no domain lists in its UI**; Cline
and Roo expose **per-tool auto-approve toggles**, not domain lists. The pattern is
approve-as-you-go with a remembered decision — which is exactly the `tool:host`
session approval above. The lists were the part nothing else had, and nothing
needed.

**Also deleted with them:** the loop's pre-flight list check (added earlier the same
day, to stop a card firing for a URL the config forbade), `checkHost`, `sameSite`,
the `LoopOptions.net` option and field, the host's `netState()`, and the two
settings. **The loop now knows nothing about the web** — `web_fetch` is an ordinary
tool call again, and its redirect handling is entirely the executor's. That
layering concession (the loop walking redirects because only the loop can ask) went
with the per-hop ask that required it.

**Verification.** `htmlToText`, the content-type allowlist, the address
classification, and the tool end to end against an **injected** fetch (no test
touches the network). Plus a modes test pinning `web_fetch` to `ask` in all four
modes, loop tests pinning that an approval carries its HOST (and that a tool
contacting nobody carries none), and a new **`approval` render suite** (13
assertions) — the first render coverage the approval card has ever had. Falsified
five times, each reverted: removing the redirect-hop address check fetches the
metadata endpoint; removing the declined-hop guard sent the second request;
dropping the metadata warning branch silences the card; making subdomains
same-site stopped the cross-host ask; and reverting the webview to name the tool
instead of the host fails the render suite. The Phase 3 guard that asserts every
declared tool has a permission kind **caught the original change** — it had assumed
declared ⇒ allowed in `auto`, which D49p makes false; it was tightened to the
property it actually guards.

**Known limit, unchanged and now load-bearing.** The classification is **literal**
— a hostname that *resolves* to a private address is not identified, because that
needs a DNS lookup; the same class of limitation as the lexical symlink check in
D49k. That matters more now than it did as a label, because a **redirect** to
`evil.example.com` (a public-looking name pointing at `192.168.1.1`) is followed:
the check reads the name in the URL, not the address the name becomes. Catching it
needs a DNS lookup per hop **and** the connection pinned to the resolved address,
or the attacker simply answers differently the second time. Not built, and
recorded rather than implied.

**D49r — a tool result must answer a tool call, so compaction may not cut inside an
exchange (M5.0, 0.25.0 — 2026-09-22).**

**Found by the first real run, not by review.** Plato's first run on a real project
(Solo, `edit`, the HCAD Android repo) died on its third request:

```
openai HTTP 400: Messages with role 'tool' must be a response to a preceding
message with 'tool_calls'
```

**`compactionSplit` sliced the conversation by COUNT and nothing else.** When the cut
landed inside a tool exchange, the kept tail began with tool RESULTS whose assistant
message — the one carrying the `tool_calls` — had been folded into the summary. The
request then contained a `tool` message with nothing above it to answer, and a strict
server rejects that rather than guessing. **This is not an OpenAI-only fault:**
Anthropic enforces the same rule for `tool_result` blocks, so the same cut would have
broken there too. The invariant is a property of the message list, not of a wire
format.

**The fix walks the cut back** until the kept tail can stand alone, so compaction
keeps FEWER messages than asked when structure demands it. A valid request matters
more than hitting a target count — and the count was only ever a heuristic for *how
much context to keep*, which a broken request keeps none of.

**Reproduced before it was fixed.** The test was written against the unfixed split,
sweeps EVERY keep count, and failed at exactly the counts that land inside an exchange
— then passed once the cut walked back. That is the difference between fixing this and
guessing at it.

**What this exposes, and does NOT fix:** the run hit compaction on turn 3 because the
model ref is a **LiteLLM group name** (`Auto-Act`), unknown to the catalog, so
`shouldAutoCompact` fell back to `UNKNOWN_CONTEXT_FLOOR` = **8,192 tokens** and tripped
at ~6,553. A DeepSeek-class model holds far more. So two faults compounded: compaction
fired far too early, and until this entry every compaction produced an INVALID request
rather than a shorter one. **The context-window gap is recorded in the PROGRESS backlog
as an open decision** — trusting a `/models` payload was deliberately rejected because
OpenRouter and LiteLLM routes report stale windows, so the answer is a product choice
(a per-connection window field, a larger floor, or opt-in endpoint discovery), not a
patch.

**Lesson worth keeping:** three of the four traps in this adapter family were found by
falsification, and this one was found by *running the thing*. A test suite proves what
its author thought to assert; the first real run exercises the paths nobody wrote a
test for. That is an argument for running Plato on real work far earlier than this.

**D49s — do not continue a turn that produced nothing (M5.0, 0.25.0 — 2026-09-22).**

**Found by the second real run**, which got nine turns in before dying with
`openai HTTP 400: Invalid assistant message: content or tool_calls must be set`
(DeepSeek via LiteLLM). **The failure moving is itself the evidence that D49r
worked** — the run was no longer dying at the first compaction.

**Two faults, one visible and one underneath.** The visible one: a turn cut by the
output cap with no content was still recorded as an assistant message, so the wire
carried `{role:'assistant', content:null}` with no `tool_calls` — a shape the contract
forbids. The underlying one: **there was nothing to continue from.** The loop's
auto-continue (D25f) asks the model to *resume exactly where it left off*, which is
meaningless when the turn left off nowhere, and the request that carries it cannot
succeed. Auto-continue now requires content to exist; an empty capped turn ends the
run with the cap note, which is the honest description of what happened.

**The enabling condition is worth recording:** a reasoning model can spend the entire
output budget on `reasoning_content`, a field **this adapter never reads**. So an
all-reasoning turn arrives as an empty turn. The empty-turn guard is correct regardless
— but Plato is blind to thinking tokens, and that has other consequences (a reasoning
model's work is invisible, and its cost is billed as output). Noted in the PROGRESS
backlog rather than fixed here.

**Reproduced before it was fixed, and the reproduction caught a defect in the test
itself:** the first version held the LIVE `messages` array, which the loop keeps
mutating after `completeTurn` returns, so it asserted against post-run state instead of
against what was sent. Snapshotting the array made it measure the real thing. A test
that passes for the wrong reason is worse than no test, because it stops you looking.

**Two real runs, two structural crashes, both in the message list rather than in a
tool.** 429 unit tests never found either. Recorded as the strongest argument yet for
running Plato on real work early and often.

**D49t — use the window the connection reports; never raise the guess (M5.0, 0.25.0 —
2026-09-22).**

**The founder's challenge:** *"we can't be shipping Plato with only 8k context window.
Models report their context sizes and we can be guessing it. Make every effort to get
what the model reports, and only guess as a last resort."* **The first half was exactly
right and the audit proved it better than the challenge assumed:** Plato was ALREADY
fetching the numbers. The header resolved `maxContextFor(model) ?? poolEntry?.maxContext`,
the run resolved `maxContextFor(model)` alone — so a LiteLLM group or a self-hosted model
got 8192 while the panel displayed the real figure beside it. **A wire that was never
connected.** The fix is small; the diagnosis was the work.

**One missing wire, two symptoms.** `maxOutputFor` had the identical disconnect and the
same 8192 fallback — and 8192 output tokens is easily spent on reasoning alone, which
produces the empty turn that D49s exists to defend against. So the premature summarising
and the crashed run were the same fault arriving twice.

**The half that was wrong: "guess 128k or 256k as the last resort."** Research settled
this against the proposal. **Ollama routinely advertises its TRAINING maximum (often
128k) while serving 4k**, because the served window is set by available memory — 4k
under 24 GiB, 32k at 24–48 GiB. llama.cpp serves whatever `--ctx-size` it was launched
with, commonly 4096. So a large guess does not fail loudly on the servers most likely to
be unknown to the catalog: **Ollama truncates silently**, which is precisely the failure
a context window exists to prevent. Raising the floor trades a visible, recoverable
problem for an invisible one. **The floor therefore stays small and is made almost
unreachable instead** — which is what the founder actually wanted: stop guessing, not
guess higher.

**The conservative rule, and why it is not a coin flip.** When the catalog and the
connection disagree, or when a provider reports a ceiling and a per-route value, **take
the smaller** (`minNum`, `resolveMaxContext`). The two errors are asymmetric: too small
summarises early and still works; too large overflows, and on the servers above it
overflows *quietly*. OpenRouter is the concrete case — `context_length` is a ceiling
across every endpoint, `top_provider.context_length` is the route in use.

**A trap removed before wiring anything through.** The OpenAI-compatible parser accepted
**`max_tokens`** as a context-window candidate. It is the OUTPUT cap. A proxy echoing
`max_tokens: 4096` therefore had Plato record 4096 as the model's entire memory —
harmless while the number merely decorated a label, and a direct fault the instant it
drives compaction. Removed, not reordered.

**Fields added:** vLLM's `max_model_len` (on the endpoint Plato already calls; it is the
window actually being served, already lowered to fit VRAM) and **LiteLLM's
`/model/info`**, which is the only place LiteLLM reports sizes — `/v1/models` does not
carry them (upstream issue #25293). **That endpoint is UNVERIFIED against a live
LiteLLM.** It sits on management routes, so a restricted key can be refused; it is
best-effort, soft-fails on every error and unrecognised shape, and can never fail the
discovery it decorates. Recorded as unverified rather than presented as working.

**Discovery now runs on its own.** It required pressing "Fetch models", so a connection
never refreshed had no numbers to wire up. It runs before a run, bounded at 5 s, and
refreshes anything older than 24 h — a rotated key or a withdrawn model must not leave a
stale figure in place.

**Unchanged and deliberate:** the shipped catalog still wins when the connection says
nothing, and `null` is still reported as unknown so the UI says "ctx unknown" rather than
inventing precision (D26c). **Steps 4 (a user-declared window per connection) and 5
(Ollama's `num_ctx` / llama.cpp's `n_ctx` runtime values) are NOT built** — both are the
founder's call, and neither is needed until discovery fails for a setup that matters.

**D49u — the environment may not choose Plato's endpoint or lend it a credential
(M5.0, 0.25.0 — 2026-09-23).**

**Found from one line of an error message: `anthropic HTTP 403` carrying a LiteLLM
body** — the Anthropic adapter, replying as LiteLLM. The cause is in the SDK's own
constructor:

```js
constructor({ baseURL = readEnv('ANTHROPIC_BASE_URL'),
              apiKey  = readEnv('ANTHROPIC_API_KEY')     ?? null,
              authToken = readEnv('ANTHROPIC_AUTH_TOKEN') ?? null, ...opts } = {})
```

**Plato passed only `apiKey`.** So the other two defaults were filled from the ambient
environment — and on this machine `ANTHROPIC_BASE_URL` points at a LiteLLM proxy. Every
Anthropic connection went there regardless of its settings. **Worse, `authToken`
defaulted the same way**, so `ANTHROPIC_AUTH_TOKEN` — also set here — was attached to
every Anthropic request as an extra `Authorization` header, alongside the key Plato had
taken from SecretStorage. **Plato was lending its requests a credential it never chose
and sending them somewhere it never chose.**

**The rule, stated generally: implicit configuration beats nothing, but explicit
configuration must beat implicit.** A connection's own base URL is visible in the UI and
must be the one used; the API key comes from SecretStorage and must be the only one sent.
Anything else means the panel can describe one server while the run talks to another —
which is exactly what happened, and what made the bug so hard to see: **the model list
was fetched CORRECTLY**, because discovery always passed a base URL. Real Anthropic
models with real windows, displayed beside runs that were going elsewhere.

**The fix:** both options are passed explicitly — `baseURL: baseUrl ?? the public
Anthropic endpoint` and `authToken: null`. `createProvider` no longer drops the base URL
for the Anthropic kind, and the three host call sites pass each connection's own URL
instead of an OpenAI-shaped default that only applied to one kind.

**Generalises beyond this adapter, and is worth checking when any SDK is added:** a client
library that reads credentials or endpoints from the environment will silently prefer them
over the application's own configuration unless every one of those options is set
deliberately. The failure is invisible at the call site — the code reads as if it passed
what it needed.

**D49w — the model's output limit, not one Plato invented (M5.0, 0.25.0 — 2026-09-23).**

`maxTokens` was `Math.min(16384, resolveMaxOutput(...))`. The 16,384 was applied even
when the model's own limit was known and larger, and it is the reason the founder's last
run produced nothing: output tokens per turn ran **2,559 → 4,783 → 8,201 → 16,384** —
the last number exactly the cap — with **721 characters of visible text in the entire
run**. The model was thinking, invisibly, until the budget ended.

**The number's history matters, because it was not arbitrary when it was chosen.** It
arrived in 0.7.6 as a **raise** from a hard-coded 4,096, fixing runs that ended with no
answer. It stayed reasonable while the model answered quickly; it became destructive
when the backend started being a reasoning model, whose thinking is billed from the same
budget and is invisible to Plato. **A limit can be right when written and wrong later
for a reason nobody recorded next to it.**

**Removed rather than raised.** Raising it would have left the same mistake one order of
magnitude out. What replaces it is the number the provider already gave us. Nothing is
left unbounded: `MAX_TURNS` caps the run, and `resolveMaxOutput` still falls back to a
conservative 8,192 when **nothing** knows the model — so an unknown model behaves exactly
as before, and only a KNOWN limit is now honoured rather than overridden.

**Accepted cost:** a single turn can be far larger, and the user pays for it. That is the
model's own ceiling and the model the user selected. The counter-argument — a runaway
turn — is bounded by the turn cap, and a run that produces nothing has already cost three
attempts.

**A test asserted the wrong thing and its name said so.** One existing case was called
*"allows the full default for models with a higher cap"* while asserting 16384 — the
ceiling, contradicting its own description. It now asserts 64000, the model's real limit.
Worth noting as a general smell: a test whose name and assertion disagree has stopped
testing the behaviour and started recording an implementation detail.

---

**D49v — only a reply to a request may move the view (M5.0, 0.25.0 — 2026-09-23).**

Selecting a model from the dropdown right after adding a provider moved the user into
Settings. **My first fix addressed the wrong half:** it corrected the stale
`hasConnections` flag (D49u) — a real bug, and a different one — while the actual cause
was that **every `settings` payload called `showSettings`.**

The host sends one after any connection change, and one of those paths,
`fetchAndStoreModels`, completes a **network round trip** first. So a payload could land
after the user had already returned to the chat and clicked the model button, and the
view would move under their cursor. Adding a provider is precisely that sequence, which
is why it looked tied to the first model pick.

**The rule now: a settings payload is CONTENT, and the view moves only for a payload the
host marks as answering a request.** Every other one renders in place — which also means
an open Settings page still refreshes live, and a background one costs nothing.

**The lesson is the one this week keeps teaching:** when a symptom persists after a fix,
the fix was for a different defect. The stale flag was real and worth fixing, but it was
found by reading rather than by reproducing, and it happened to be adjacent to the real
cause. **Reproduce first, then fix** — the D49v reproduction (an unprompted payload while
in the chat) took ten minutes and would have found it immediately.

---

**D49x — a model the user unchecked is not the model to run (M5.0, 0.25.0 — 2026-09-23).**

The founder's screenshot: **`ornith-1.5-35b-a3b` unchecked in Settings → Providers, yet
that model in the chat's dropdown**, marked as the current one and labelled *"not in the
fetched list"*. This is the report carried as "Bug 3" for three days, and the reason it
was left alone was right — the fallback row exists on purpose, so the fix could not be
"delete the row". The question was never the row. It was **what the run would use.**

**Two causes, one symptom.**

**1. The rule asked the wrong question.** `effectiveModel()` kept the preferred ref when
its **connection** existed — and a model the user had just unchecked satisfies that: the
connection is still there. So a deselected model stayed selected, and the run would send
it. That is not a cosmetic mismatch: **a key scoped to a model list answers 403 for a name
it does not allow**, which is the exact error the founder had already hit (*"key not
allowed to access model… can only access models=[…]"*). A stale selection is a failed
run, not a no-op. The rule is now `pickEffectiveModel` in core, and it asks whether the
model is **offered**.

**2. The picker's choice did not survive a reload.** The composer and the Duo/Academy
doer selects are the **only** model controls in the product, and a click wrote
`modelOverride` — **memory only**. Every panel reload reverted to `plato.model`, a setting
with **no UI at all** (its one handler, `set-default-model`, is never posted by any
view). So the durable answer was a value only editable by hand in `settings.json`, and a
hand-edited value from an earlier session is what kept reappearing. The pick now writes
the setting, making the doer row's own help text true: *"change it here or in the
composer — it is the same setting."* It was not.

**The fallback deliberately does not cross connections.** Losing a model is not a reason
to change providers — another connection can mean another vendor, another price and
another key. Only when that connection offers nothing does the choice move, and only when
**nothing** is offered does the preference survive, so a workspace whose connections have
not loaded yet is not blanked.

**Accepted consequence, stated plainly: unchecking the model a chat is using moves that
chat to another enabled model on the same connection, and says nothing.** Every trigger is
either the user's own action or a stale-config correction, and the model chip is visible
at all times. If a notice is wanted, it is one line in the two handlers that shrink the
active set — and it should be added on request, not now.

**Nothing here weakens the fallback row.** It still renders a current model that no
connection offers — a pooled name, a custom entry — which is honest, and is why it is
still there.

---

**D49y — the answer box grows to three lines, then scrolls (M5.0, 0.25.0 — 2026-09-23).**

The free-text *"Others"* answer to a Plato question was a one-line `<input>`, which
scrolled sideways while the answer was still being written — the founder's ask, and a
small one, but it turns out the cap is the part that matters.

**A box that grows with its text is not the feature; a box that stops is.** The question
card carries its own Submit button, so a box that grew without limit would push that
button off the card — trading one unusable state for another. It grows to **three lines**,
then scrolls.

**Measured, not guessed.** The height comes from the box's own `scrollHeight` clamped at
three resolved line-heights, so `line-height` is stated in CSS rather than left to the
font: the role textarea's fitter exists precisely because `normal` resolves differently
per font, and it documents that an unset value is what made a fixed min-height clip real
text.

**One trap, found by predicting it rather than by shipping it:** a hidden element measures
**zero**, and the box starts hidden behind the *Others* radio. So an answer restored by
**Back** — which sets the value while the row is still `display:none` — measured as a
0px sliver. The fit therefore runs where the row is already in the document, and a render
suite pins that path specifically.

---

**D47n — live copy names the real location; history keeps its own (M4.1, 0.25.0 —
this commit, 2026-09-17).**

Two stale strings survived D47m, both found while closing it out.

**1. The History page's empty Runs state** (user-facing):

```
Every Plato run is transcribed to .plato/runs/ automatically.
```

Wrong twice. D46 moved transcripts to a flat `~/.plato/`, so the path had been
dead for four releases; and a bare `.plato/runs/` reads as a folder inside the
user's **own project** — exactly the place D46 decided Plato must never write.
Copy that is wrong about *where the user's data is* is worse than copy that says
nothing. It now reads `~/.plato/runs/`.

**2. The `TranscriptWriter` header comment** (internal):

```
one JSONL file per run under `<root>/.plato/runs/`
```

Wrong at a level deeper than the path. The class **never computes a path** — it
appends into a **caller-supplied** `runsDir` (a constructor argument) and the VS
Code host passes `join(homePlatoDir(), 'runs', projectKey(root))`. Substituting a
different literal would have preserved the same false model of the class, so the
comment now states the real contract — the directory belongs to the caller — and
names the host's location as the current caller.

**Contract, and where it stops.** *Live copy names the real location.* This
extends D47m from mode cards to user-facing text generally. It deliberately does
**not** reach two things, both left alone:

- **Historical rows.** PROGRESS and DECISIONS entries written during the `.plato/`
  era (D33, the M2 transcript rows) describe what was true on their date.
  Rewriting them would falsify the record, and the docs already carry the rule
  that a historical row is not corrected in place.
- **BLUEPRINT.md and ARCHITECTURE.md.** Both still describe `.aplivity/teams.yaml`
  with `profiles:` / `budget:` / `supervises:`, superseded by D33 (`.plato/`),
  D46 (flat `~/.plato/`) and the D45a-3 product lock (Academy carries
  philosophers, not profiles). These are the founder's design-tree record, and
  ARCHITECTURE.md's own terms are "binding unless a DECISIONS.md entry supersedes
  them" — the superseding entries exist. **Flagged for a founder decision, not
  rewritten unilaterally:** they are product documents, not stale copy.

**Asserted.** A new suite, `scripts/render/history.mjs`, pins the user-facing
string by posting an empty `{type:'history', runs:[], chats:[]}` payload. The
subtle part: the correct string **contains** the stale one — `~/.plato/runs/`
ends in `.plato/runs/` — so a bare `/\.plato\/runs\//` would match the fixed copy
and pass either way. The check strips `~/.plato/runs/` before searching for the
stale form, and that construction was confirmed to PASS on the good string and
FAIL on the bad one.

**D47m — a mode description describes the mode, not the file behind it (M4.1,
0.25.0 — this commit, 2026-09-17).**

The Academy mode card read:

```
Plato + a council of philosophers (from .plato/ACADEMY.yaml)
```

Two separate defects sat in that one parenthetical:

- **It named a file inside a description of a mode.** A mode card answers one
  question — *what happens if I pick this?* The path answers a question the user
  did not ask, in the single line of space the card has. Solo and Duo name no
  file; Academy was the odd one out.
- **The path was stale.** D46 moved every Plato-owned file into a flat
  `~/.plato/`, so `.plato/ACADEMY.yaml` had not been the location for four
  releases. A stale pointer is worse than no pointer: the user goes looking for
  a file that is not there.

The description is now `Plato + a council of philosophers.`

**Contract:** *a mode description describes the mode; it never names a config
file.* Where the file lives is the job of the Settings block that edits it, which
already states the real path (`Editing ~/.plato/ACADEMY.yaml — every change saves
it`). Copy that names a path belongs next to the control that opens that path,
not on a card that selects a behaviour.

**The rule is asserted, not merely applied.** `scripts/render/providers.mjs`
gained a block 8: no `.mdesc` may match `.yaml` or `plato/`, and the Academy
string is pinned exactly. It asserts the **requirement**, per rule 2 of
`scripts/render/README.md` — "the description contains no path" would pass a card
that named a *different* wrong path, which is precisely the failure mode being
fixed. Restoring the old string fails both assertions and prints the offending
description, which is the evidence that the check can actually fail.

**D47l — the API key is entered in the panel (M4.1, 0.25.0 — committed a62d682,
2026-09-11).**

Founder question: *"what is 'Set key' doing — it shows a Visual Studio in-build
dialog"*. It called `vscode.window.showInputBox({ password: true })`, a native
modal **above the editor area**.

**Two problems, one cause.** `Add a provider` collected the key **inline in the
panel** (`fkey`), while `Set key` on an existing card left the panel for a
dialog — the same conceptual action on two different surfaces. And because the
native box takes focus, the section re-rendered behind it and appeared to
collapse. Founder chose option **B**: move key entry inline.

- `Set key` now toggles an inline password field on the card, with `Save key` /
  `Cancel`, mirroring the Add-provider inputs exactly. It is hidden until
  pressed, so the card's resting state is unchanged.
- **Enter** saves, **Escape** cancels. The field takes focus when it opens and
  reports `aria-expanded`.
- A new `settings-set-key` message carries the value once. The host stores it in
  `SecretStorage` (and the legacy anthropic slot), then calls
  `fetchAndStoreModels` so a new key immediately unblocks the model list — the
  same behaviour as Add. The value is **never echoed back** to the webview, and
  the webview clears the input as soon as it is sent, so the secret does not
  linger in the DOM.

**The command palette keeps the native box.** `plato.setApiKey` /
`plato.manageKeys` still use `promptForKey`. That is deliberate: the panel is the
canonical UI and the palette is a power-user shortcut, so there is one coherent
story rather than three competing surfaces.

**D47k — "Add connection" closed Providers: the restore key was not stable
(M4.1, 0.25.0 — committed 6f15e52, 2026-09-11).**

D47j restored the open/closed state by keying on the section's **summary text**.
But the Providers summary embeds a live count:

```
before:  "Providers  —  0 configured"   (open)
after:   "Providers  —  1 configured"   (closed — the key no longer matched)
```

So the restore silently missed for the one action that **changes the count**. Set
key and Refresh appeared fixed only because neither alters the label. A
title-derived key is not stable when the title carries state. Each section now
carries a fixed `data-sec` id (`providers` / `orchestration` / `context`) and the
restore keys on that; the always-open section is skipped by tag. The regression
test replays the founder's exact sequence and was proven to fail when the key is
reverted.

**D47i — one Settings surface: unified panels, honest affordances (M4.1, 0.25.0 —
committed 87aa9cf, 2026-09-11).**

Founder review: the Providers and Context header arrows were too small, the
connection action buttons were jammed together ("Set key and Refresh collapse the
panel, and Delete is jammed right"), and **Orchestration read as a different panel
from the other two**.

**Measured, not asserted:** Providers and Context were `DETAILS` sections with a
1px border and 5px radius, while Orchestration was a bare `DIV` with **`0px none`
border and `0px` radius** — it was the only section with no frame at all, which is
exactly why it looked like a different kind of panel. The founder's perception was
structural fact.

- **Every section now shares one shell** (`.sec` + `.sec-static`): same 1px
  border, same 8px radius, same widget background, same header bar. Orchestration
  gets the same treatment but stays **permanently open** (founder decision — the
  mode cards and the council are the point of the panel), so it is a `div` with a
  non-toggling `.sechead` whose marker states that instead of pretending to
  toggle.
- **The disclosure marker is a real control.** It was a 13px glyph with no box;
  it is now a 16px glyph in a 16px hit area, and the header bar grew from 29px to
  ~35px with its own background, a divider when open, and a hover/focus state.
- **The nested `.sblock` is gone.** Orchestration and Context each wrapped their
  content in a bordered box inside a bordered section, while Providers did not —
  two different nesting depths. The section body is now the single container, and
  the D47h narrow-safety rules were retargeted from `.sblock` to `.secbody`. The
  in-body titles were dropped: the header bar already names each section, so only
  the explanatory `.shelp` line remains in all three.
- **Delete is separated from the primary actions.** Measured before: an identical
  8px gap between Set key/Refresh *and* Refresh/Delete, so the destructive action
  read as part of the same group. A flexible fill plus a 1px divider now push
  Delete to the far right; at a very narrow width it wraps to its own line
  instead of crowding.
- **The `Add a provider` inputs no longer clip** (they showed "— or ent",
  "Base URL ("). The grid's fixed `130px` label column becomes auto-fit — and it
  was **also hard-coded as `130px 1fr` in JS**, so the CSS fix alone would not have
  worked.
- **A layout trap worth recording:** `repeat(auto-fit, minmax(190px, 1fr))` still
  **overflows** a container narrower than 190px, because auto-fit honours a fixed
  minimum. The floor is now `min(190px, 100%)` (and `min(220px, 100%)` in the add
  card), which cannot overflow. The harness caught this at 300px after the first
  version of the fix.

Presentation only: no `postMessage` type, parser, emitter, or behaviour changed.

**D47h — the doer model select did not stick, and the narrow panel (M4.1, 0.25.0
— committed fe2cf26, 2026-09-11).**

Founder report: in **both** Duo and Academy, changing `Plato's model` snapped back
to the composer's value; changing it in the **composer** worked. Two defects and a
layout class.

- **The doer select wrote the host, but never the shared value.** The composer
  popover does `setModelSelected(value, label, max)` **and then** posts; the doer
  select only posted. So `currentModel` kept the OLD value, the host accepted the
  NEW one and returned its state, and the webview's preserve logic re-applied the
  stale `currentModel` — the select reverted. **The composer worked precisely
  because it updates first.** D47e's own comment claimed the two views "cannot
  disagree by construction"; the posting half was built, the state-writing half
  was not. The fix gives the doer select the same two steps, restoring the
  documented invariant rather than adding a mechanism.
  **Why the first regression test passed anyway:** `postModelState()` now also
  sends the authoritative `effectiveModel`, and that line alone corrected the UI,
  masking the defect. The harness therefore tests **both** echo shapes — the
  legacy payload (no `effectiveModel`), which is the condition the bug was
  reported under, and the new one. Reverting the fix fails the legacy cases; that
  is the evidence the test is real.
- **The host is now authoritative for the model.** `postModelState()` carries
  `effectiveModel`, and the webview adopts it when it differs. Without this the
  panel could display a value the run would not use — for example a doer select
  echoing a model the host had rejected as an unknown connection.
- **The Settings panel overflowed at a narrow editor column.** Three separate
  causes, all now fixed and all measured:
  1. `.modes` was `grid-template-columns:repeat(3, 1fr)`. At ~290px of content
     each card got ~67px, cramming the descriptions into a clipped ribbon.
     Now `repeat(auto-fit, minmax(190px, 1fr))` — **one column when narrow,
     three when wide**, no JS.
  2. `.sblock label { min-width:140px }` applied to **every** label in the block,
     forcing the box wider than the panel. The same trap as D47b's switch track.
     Now a yielding `flex:0 1 140px`, with `min-width:0` on rows and their
     children so a long model ref or state sentence can shrink.
  3. Long rows did not wrap: `.workers .pline` (the state text crushed
     `Open PLATO.md` onto two lines) and `.duo .dhead` (`Open ACADEMY.yaml` ran
     off the edge). Both now `flex-wrap:wrap`, with `white-space:nowrap` and
     `flex:none` on the action so a button never breaks mid-label.
- **Verification gap closed.** D47g added a width sweep for the **Role box only**;
  this class of defect was still only found by the founder in screenshots. The
  harness now asserts, for **every** settings row: no element overflows its
  scroll container, each action button stays one line, and — the assertion that
  matters most — **each mode card keeps a usable text width**. No-overflow alone
  is not enough: three 67px columns do not overflow, they just cram. Reverting the
  grid fails 6 cases.

**D47g — Role field hardening + the two walls, after founder UI review (M4.1, 0.25.0
— committed 68dc451, 2026-09-10).**

Founder review of the D47f build raised three items. Two were defects I had
shipped.

- **The Role box clipped real text.** `min-height:64px` is a fixed number, but the
  height the text needs depends on the **panel width**. Measured with the real
  persona roles: at a 420px panel the box hid ~42px (about 2.5 lines) behind a
  scrollbar; at 620px it hid 4px. I missed it because every render in D47f ran at
  a **940px** viewport — the one width where it happened to fit. The box now
  auto-fits its text plus **exactly one line**, re-fitting on input and when the
  panel width changes. The fit measures a **hidden mirror** of the text, not the
  textarea's own `scrollHeight`: a textarea over-reports (5.01 lines for text
  needing 4), which rounded the box to a whole extra line. Verified 1.01 / 1.01 /
  0.99 lines of slack at 420 / 520 / 740px, no clipping at any width.
- **`✕` instead of the white "Remove" button — a class-name mismatch, not taste.**
  The CSS defined `.btn-icon-danger`; `sbtn(label, fn, 'danger')` emitted
  **`btn-danger`**, which had **no rule at all**. Only the bare `.btn` applied, so
  the browser painted its default white button. It was the only `danger` call in
  the file, so nothing else exposed it. Now `.btn-danger` is the real rule (a
  24px transparent square, muted, red on hover) and the variant name **is** the
  class name, so it cannot silently fall back again.
- **The two walls now behave alike (founder chose "grey out").** At the floor,
  Remove was *not drawn*, so going from 3 philosophers to 2 made two other
  buttons vanish — the layout moved during a destructive action. Remove is now
  **drawn on every card** and disabled at 2. It uses **`aria-disabled`, not the
  native attribute**: a natively disabled button emits no mouse events, so its
  tooltip could never explain the reason. The tooltip carries the reason, the
  click is swallowed in JS, and the footer states the range permanently
  (`3 of 5 philosophers · minimum 2`) instead of narrating a control.
  Duo has one fixed philosopher — not a bounded list — so it has no `✕` at all.
- **A 1,000-character cap on `role`, enforced in the file too.** A role is
  injected into the observer's system prompt on **every turn**, so an unbounded
  role is a per-call token cost, not only a layout problem. `ROLE_MAX_CHARS` lives
  in core; **both** parsers reject an over-long role with the count (a
  hand-pasted 2000-char line is refused: `role is 1001 characters — the maximum
  is 1000`), both JSON schemas set `maxLength: 1000`, and the box carries
  `maxlength`. The longest shipped persona role is 239 — 761 characters of
  headroom. The counter sits at the **top-right of the Role label row**, so it
  does not move when the box grows; muted, amber at 90%, red at the cap.
- **A stray Enter used to produce an unparseable file.** The Role box is a
  textarea, so Enter was possible, and the emitter quoted the value without
  escaping the newline: `role: "line one` + a raw newline + `line two"`, which
  YAML cannot hold that way. Our own parser then rejected the file and the save
  was lost. `oneLine()` now folds runs of whitespace to single spaces **in the
  emitter** (the guarantee for every caller) and in the webview (so the box
  matches what is stored).

**A template-literal trap, recorded so it is not repeated.** `webview.ts` builds
the panel as one big template literal, so a `\s` in a regex written there is
consumed by the literal and compiles to `/s+/` — which matches the letter **s**,
so the fold silently did nothing while looking correct in the source. The
correct spelling is `\\s`. A unit test now reads the source and asserts the
escaped form, so this cannot return quietly. This bit twice: the existing
regexes in the file only use character classes (`[^a-z0-9_-]`), which have no
backslash, so no prior pattern revealed it.

**D47f — Settings polish after founder UI review: a complete starter council, one
shared card, and a stored identity colour per philosopher (M4.1, 0.25.0 — in the
working tree, 2026-09-10).**

Founder review of the D47e build produced seven items. Two were defects, five were
polish. One changed the file format, so the reasoning is recorded here.

- **Defect — `Open ACADEMY.yaml` wrote a hollow council.** `defaultAcademyMembers()`
  seeded only `name/kind/model/persona/guidance`, so the file it created had **no
  `role`, no `pause`, no `cancel`, no `maxInterventions`**. The UI *displayed* the
  persona's role (it falls back), so the panel looked correct while the file was
  incomplete — the same class of defect as DUO.yaml's missing role (D47b). Fixed at
  the root: the seed now writes the persona's `role` plus
  `pause:false, cancel:false, maxInterventions:5`. The webview pre-seed
  (`seedDefaultPhilosophers`) and **Add philosopher** were fixed the same way.
- **`save()` now writes the effective role** (the D47b rule, now applied to
  Academy): the file receives the role the card shows, so clearing a role snaps
  back to the persona's rather than leaving a blank field in the file.
- **Add philosopher defaults to the first UNUSED persona.** Previously it created
  `persona: ''` **and** `role: ''` — a philosopher with no steering text at all,
  the "what would it even do?" problem from D47d. It now always has a name, a role
  and a colour.
- **Remove is not rendered at the 2-philosopher floor.** It was `disabled` (D47d);
  a greyed button invites a click that does nothing. The footer now carries the
  rule instead ("minimum 2" / "remove is available").
- **One shared card builder** (`philosopherCard`) is used by **both** Duo and
  Academy. The header is the identity line — colour dot + display name + Remove
  (kept far right, never between two inputs); the body is
  **Persona → Role → Model → Powers** in both modes. Duo's old
  `.cols`/Display-name-beside-Model layout and the display-name-below-persona
  layout in Academy are gone, so the two panels cannot drift apart again.
- **`Plato — the doer` → `Plato's model`.** "The doer" is internal vocabulary
  leaking into the UI (the same mistake as "worker"). The noun now matches every
  other field's. Behaviour is unchanged: one session-wide value, two views.
- **Model semantics deliberately left different.** Duo keeps its `(same as Plato)`
  empty option; Academy still requires an explicit `<connection>:<model>` per
  member because its parser demands one. Founder chose "whatever is safest"; only
  the layout was unified, not this rule.
- **The PLATO.md explainer moved behind a `?`** on the "Plato — project files"
  heading (both modes render that heading). The `.help` CSS was widened from
  `.duo .help` to `.help` so the button styles outside a `.duo` block.
- **Lyceum is pre-filled** for a starter council (the placeholder repeats it), so
  the name field is never a blank box.

**A colour is a stored field, not a derived index.** Each philosopher carries
`color:` — one of `violet, blue, teal, amber, rose` — assigned **once, at
creation**, to the first palette entry no member holds. It is written to the yaml
and re-read, so **removing a philosopher never re-colours the survivors**. A
colour derived from council position would shift on every removal; this is why the
field exists.

**This is not a reversal of D47e.** D47e removed the worker because it duplicated
the doer's *model* — a second source of truth for **behaviour**. A colour has no
behaviour, and nothing else in the system can recompute it, so the file is its
honest home. D47e's rule stands: never re-add a per-member *behavioural* field
that the doer's model already owns.

The file stores the **name**, not the hex, so the exact pastels can be tuned
without invalidating anyone's saved council. The palette and its helpers
(`PHILOSOPHER_COLORS`, `findColor`, `colorHex`, `firstUnusedColor`) live in core
(`teams/colors.ts`); the webview is a template literal with no imports, so the
palette rides the settings payload and the resolved hex rides the notice
metadata. The colour appears in three places — the Settings card, the
philosopher's chat notices, and the run-start team card.

**Accepted consequences:** colour follows the member, so two philosophers with the
same persona are still distinguishable (the point of the feature); a hand-edited
file with no `color:` resolves to neutral grey; a member with an unknown colour id
is a **loud parse error**, not a silent fallback.

**D47e — The fail-proof upgrade: no worker in the Academy format; one doer model,
two views (M4.1, 0.25.0 — committed, 2026-09-09).**

Founder-approved closeout of D47d. B1 (hide the worker, warn about a deviation)
is **replaced** by B2 (remove the worker from the format), because B1 still left
the trap: with the doer hidden, a hand-edited `model:` would change the run
silently.

- **`ACADEMY.yaml` carries philosophers only.** `TeamMember.kind` is now the
  literal `'philosopher'`; the parser defaults omitted `kind` to philosopher,
  **rejects `kind: worker` loudly** ("no longer a member — Plato is always the
  doer (D47e). Remove this entry."), and `finishTeam` enforces **2–5
  philosophers** instead of the old exactly-one-worker rule. `emitTeamConfig`
  no longer writes a `kind:` line. `defaultAcademyMembers()` returns Aristotle
  + Pythagoras, no worker. Legacy files are out of scope by founder decision
  (assume no `ACADEMY.yaml` exists; D45d allows the break).
- **Plato is the doer in every mode.** The run path uses
  `this.effectiveModel()` for the doer ref — the same resolution Solo and Duo
  use. Deleted: the `workerMember` lookup and its three uses
  (`ref`, the connection-error hint, and `role`). **Accepted consequence:** an
  Academy worker's custom `role` text is gone; the doer's prompt is the shared
  chain (project PLATO.md > global PLATO.md > bundled default), identical in
  every mode. This is the point of the change, not a regression.
- **One doer model, two views — no pin, no grey-out.** A `Plato — the doer`
  select appears in the **Duo and Academy** blocks. It posts the existing
  `{ type: 'model', value }` message and is repainted by `setModelSelected()`,
  so the composer picker and the Settings control are two views of **one
  session-wide value** — they cannot disagree, so there is nothing to pin and
  no control is ever disabled. Reset on New Chat, like today's override.
  (Rejected: a per-council doer model — it would re-create the second source of
  truth this milestone removed.) Solo keeps its composer picker only; adding
  the row there is a feedback-driven option.
- **Removed with the worker:** the read-only `Plato runs on …` line and the
  `.starter.warn` deviation notice (both D47d/B1). The `.starter` banner now
  reads "(Aristotle + Pythagoras)".

**Never revert this without re-adding a visibility mechanism.** If the worker
returns to the file, a hidden doer model becomes silent again; the doer row and
the parser's loud rejection are the pair that make the hidden doer safe.

**D47d — Academy = Duo + council: implicit doer, forced guidance, persona picker
(M4.1, 0.25.0 — committed, 2026-09-09).** Superseded in part by D47e (the
`kind: worker` member, the B1 `workerNote`, and the doer line). Still in force:
forced `guidance`, the persona picker, 2–5 philosophers, Aristotle + Pythagoras
defaults, and `Lyceum (optional)`.


Founder review of D47c: "I don't get what the worker section is doing" in
Academy, and "if guidance can be off along with pause and cancel, what would
the philosopher even do?". Re-read of the lock in **D45a-3** (one worker + N
philosophers; Solo/Duo/Academy are the same worker with 0/1/N philosophers)
showed the UI contradicted the thesis. Decisions:

- **The doer is implicit in Academy, exactly as in Duo.** The editor renders
  *only* philosophers; there is no worker card and no "Make worker" button
  (D47c's promote control is deleted). A read-only line states
  `Plato runs on <model>`; the doer's model is the chat composer's, not a
  second control. This is the same framing Duo already used.
- **B1 chosen over B2 for the hidden worker.** The `kind: worker` member stays
  in `ACADEMY.yaml` (the parser's exactly-one-worker rule is untouched), but a
  hand-edited file that disagrees with the UI is **surfaced, never silently
  obeyed**: `academyStatus()` derives a `workerNote` when the file renames the
  doer or gives it a model other than the effective chat model. Consequence
  table reviewed: missing/duplicate worker already aborts loudly at parse time;
  renamed worker and overridden model were the silent cases, and both are now
  visible.
- **B2 recorded as the fail-proof upgrade (not built).** Remove `kind: worker`
  from the Academy file format so Academy is literally "Plato + council".
  Touch-points to change: `config.ts` `TeamMember.kind` + the
  exactly-one-worker validation (`finishTeam`), `emit.ts` `memberLines`,
  `extension.ts` `run()`'s `useAcademy && team` branch, `academyStatus()`, and
  `defaultAcademyMembers()`. Also deletes `workerNote` and the doer line. Until
  then B1 is the honest state.
- **Guidance is always on — a mute philosopher is impossible by construction.**
  Duo hard-codes it (`duo.ts` `duoObserverSpec`: `guidance: true`); Academy
  exposed a toggle, so a philosopher could have all three verbs off and
  degrade to a paid `noop` on every check (`observer.ts` tier enforcement).
  Academy now matches Duo: the Powers row is **May pause + May cancel**, and
  the webview pins `guidance: true` on load and save. Old files with
  `guidance: false` are repaired to true on the next save (intended).
  If a "watch only, report at the end" capability is ever wanted, it is a
  *different mechanism*, not a mute philosopher.
- **Academy cards get a persona picker** (Duo parity). Picking a persona
  refills the name/role only while they still equal the previous persona's
  defaults (the D47b reconciliation). `persona` is now a real optional
  `TeamMember` field — parsed, emitted, and carried through `save-academy`.
- **Council = 2..5 philosophers; defaults Aristotle + Pythagoras.** Orthogonal
  by design: Aristotle judges *claims* against evidence, Pythagoras judges
  *structure/counts/invariants*. Seed applies both in the Settings pre-seed and
  in `open-academy`'s create-on-open (`defaultAcademyMembers()` in core).
  `Remove` is disabled at 2; Add is disabled at 5.
- **Council name** moves to the header row beside the `Academy` title with
  placeholder **`Lyceum (optional)`** (the Greek school where a council
  deliberated) — no longer an `unnamed council` field above the list.

**Recorded for a later debate:** the default role prompts in `personas.ts` may
be too weak for real agentic flow; the founder flagged this as a separate
discussion. Not changed here.

**D47c — Academy editor UI + create-on-open, tool-summary polish (M4.1, 0.25.0 —
committed, 2026-09-09).** Superseded in part by D47d (worker card, Make worker,
Guidance toggle).


Founder priority after D47b: the Academy Settings editor was "utterly
disappointing". Fixes are markup + CSS in `webview.ts` (no store, parser, or
sync contract change) plus one host path:

- **`open-academy` creates on open** — parity with `open-duo`. No file → the
  host emits a starter council (one worker on `effectiveModel()`), validates it
  through `parseTeamConfig`, writes `~/.plato/ACADEMY.yaml`, arms the watcher,
  re-pushes settings, and opens the file. The "not found" dead-end is gone.
  A core test pins the seed as a runnable one-worker council
  (`emit.test.ts` — "emits a runnable one-worker starter council").
- **Member cards lead with identity.** A `.mkind` chip (worker / philosopher)
  replaces the bare 10.5px grey word; the card carries a matching left border
  (blue = worker, purple = philosopher). The name input is the only wide
  field in the header row.
- **`Remove` is pushed right, never mid-row.** A `.mspacer` separates the
  promote control (`Make worker`, a compact button — the chip already states
  the kind, so the old duplicate kind-select is gone) from `Remove` at the far
  right edge.
- **The council name is the block's identity**, so it rides the header row
  next to the `Academy` title (placeholder "unnamed council"), instead of
  living in a low-prominence field above the list.
- **The pre-seed is no longer silent.** A dashed `.starter` banner states that
  this is a starter council and the first change writes the file. A `.subhead`
  line reports `N worker(s) · N philosopher(s)`, and the footer shows
  `N of 5 philosophers` next to Add.
- **Tool summary chip.** The live tool-summary line gains a total and a label
  (`tools 26 tool calls · read_file × 15 · …`) and a blue accent edge.

**Deferred (recorded so it is not mistaken for a styling job):** true
*interleaved* tool-call cards in the live log. The host streams one cumulative
markdown blob per turn into a fixed `#streaming` element, so tool summaries
land after the whole reply rather than in place; fixing it needs **host-side
reply segmentation** (a segmented `md` contract). The History run-detail view
is the cheaper place to get correct ordering first.

**D45b — Duo customisation: deferred to a follow-up (M4.1, TBD — SUPERSEDED by D47, shipped 2026-09-04).**

Duo philosophers are hardcoded in `core/src/teams/personas.ts` (five personas, literal role strings). The user has one override surface today (`plato.observer.role` replaces the persona's role wholesale) and a flat list of settings for the other tiers. Academy has richer per-member config via yaml. The asymmetry is real and the user needs richer Duo config too.

**Deferred scope** (recorded so the direction is locked):
- New file: `~/.plato/duo.yaml` with `philosopher: { name, role, model, persona, pause, cancel, maxInterventions }`. (Config dir is `~/.plato/` per D46, not `.plato/`.)
- New schema: `duo.schema.json` bound via YAML extension.
- Discovery: `~/.plato/duo.yaml`. (D47 supersedes the settings-fallback half: the file is the only store; the Settings block always shows a live editor and a missing file runs the built-in default.)
- Settings UI: a "Duo — philosopher" block that shows the file's parsed config and offers "Open duo.yaml" + an in-form editor. Round-trip between the Settings form and the file (D47: two-way, via file watcher).
- The `plato.observer.role` setting becomes the *fallback* when `duo.yaml` is absent.

Not in D44 / D45. Queued in HANDOFF.

**D45c — Customisation principle: UI first, yaml as backup (M4.1, applies to all future work).**

Plato is pre-release. Every new user-facing customisation MUST be discoverable and editable in the in-panel UI before (or in the same milestone as) the underlying yaml is read. The yaml exists for version control, sharing across teammates, and power-user workflows — it is the *fallback* surface, not the primary one. The user who only opens Settings should be able to discover and adjust every shipped knob.

- When a feature is yaml-driven (Duo customisation, Academy members, project files), it MUST have a Settings UI affordance for "open the file" at minimum, and ideally a form-based editor. The "Create example" button (D33) is the template; "Open <file>" is the floor.
- When a feature is settings-driven, exposing a yaml equivalent is a power-user enhancement, not a requirement. PLATO.md and AGENTS.md are the exception — they're discovered by the worker at runtime, so the file *is* the surface — but they're still opened by `/system-prompt` rather than edited through the chat.
- Settings UI must never require yaml knowledge to discover a feature. "Create example" is the bridge; once the file exists, the UI keeps showing the parsed state for read-only inspection (D11: yaml is the interface, the buttons are the on-ramp).

**D45d — Pre-release status: no legacy / migration support (M4.1, applies to all future work).**

Plato is not released publicly. There is no v0 → v1 user base, no shared history, no extension marketplace, no published schema. Customisations moving between surfaces (settings → yaml, yaml → file, file → different file) do not require migration paths, compatibility shims, or deprecation cycles. When a customisation moves, the new surface is the only surface; the old one is ignored; the user is told via the D-decision that lands alongside the change.

This is the "D45c" complement: not just "UI first" but "we can break things on purpose because no one depends on the old shape."

## Open items carried forward

- **Provider matrix gap (flagged 2026-08-25): RESOLVED by D25 (adapters,
  abstraction) and D26 (connection profiles, per-connection keys).**
  Founder decision 2026-08-25 kept it as one M3 workstream, D25/D26
  decisions before code. Remaining from the original note: OpenRouter
  authoritative-cost passthrough (D26c future candidate).
- Toolchain setup: RESOLVED (was "Node.js not installed") — Node v24.19.0
  via nvm 0.40.7 and pnpm 11.23.0 installed and verified; see HANDOFF
  prerequisites.
- Trademark sweep before public release (D16).
- **SECRET AUDIT before any public release or repo visibility change**
  (D15, ARCHITECTURE security invariant 2). Sweep everything that leaves
  the machine: repo history, VSIX/npm artifacts, transcripts, docs,
  screenshots, demo repos. Known live exposure:
  `/Users/ai/Desktop/HcadPublicAndroid-demo` carries `keystore.properties`
  and `local.properties` in its working tree that its own `.gitignore`
  does not cover. If that repo is ever made public: rotate those secrets
  and purge history FIRST.
- License decision at M4 (D19).
- Optional rename `.aplivity/` → `.plato/` before M3 (D11 flag).
- Correction (verified during setup): GitHub account `applivity-com` is a
  personal user account, not an Organization. Repo target URL unchanged:
  github.com/applivity-com/plato. Automation tokens need the `repo`
  scope for repo creation and push.
