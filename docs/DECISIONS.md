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
