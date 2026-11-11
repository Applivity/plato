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
`applivity`. *The GitHub namespace changed on 2026-11-02: the repository is
now `Applivity/plato`, public (D49cp). The Marketplace and npm namespaces are
unchanged.*

## Engineering strategy

**D18 — Repository (Q20).** Monorepo named `plato` under `applivity-com`:
pnpm workspaces + TypeScript project references; `packages/core`,
`packages/vscode`, `packages/cli` (later). Private until M4; license
decision at M4 (founder leans open source; Apache-2.0/MIT candidates). *The repository is now `Applivity/plato`, public since 2026-11-02 (D49cp).*
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

D39g was recorded in PROGRESS's change log rather than here.

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
  **EXTENDED (D49bn, 2026-10-07):** archiving was all `dispose()` did, so a run in
  flight kept going with nothing able to see or stop it. `dispose()` now also
  cancels the run and **awaits it before archiving** — the order matters, because
  the unwinding run pushes its last rows and closes its writer, and archiving first
  would persist a log about to change.
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
  chats payload at the webview dispatch site — see PROGRESS. The
  lettered D42 sub-decisions, D42b–D42h, were recorded in PROGRESS's
  change log rather than here.)

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

> **REVERSED, then SUPERSEDED (2026-10-06, D49bf).** The rule in (a) — that a discovered
> window must NEVER drive compaction timing and only the catalog may — was reversed by
> D49t (2026-09-22) on the founder's call, and D49bf finished the job: **the connection's
> advertised number is now the ONLY source, the catalog carries no window at all, and an
> unadvertised model is assumed to hold 128k rather than 8,192.** The paragraph above is
> kept as the record of a rule reasoned carefully and then found wrong in practice.

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
c7484bc, 2026-09-09).**

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
render-aborting crash (M4.1, 0.25.0 — committed 6259920, 2026-09-11).**

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

> **SUPERSEDED (2026-09-27).** The paragraph above was true when written and is not now:
> the acceptance test was restated (**D49at**) and **executed — 7 of 7 clauses pass** — and
> **M4 is done**. Left in place as the record of what was true on 2026-09-17; the current
> state lives in HANDOFF and PROGRESS, per this entry's own rule.
>
> **Clause count moved again (2026-10-07):** it is **8 of 8** — the run-control work
> (D49bm/D49bn/D49bo) added clause 8, *"The run controls mean what they say."* The sentence
> above is kept as written because it was true of the suite it describes.

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
   it is in git history at `0aeb309`,
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
6. **Task coherence** — a `todo_write` tool and a panel. **DONE (D49ah, 2026-09-24)**,
   with one addition the sketch did not make: **state is legible without colour**.
   The sketch also expected a new `AgentEvent` for todo state; it turned out to be
   unnecessary — the shell already receives every tool call's arguments — so no bus
   event was added.
7. **Recorded, not built** — subagents, hooks, skills, notebook and PDF input.
   Each needs its own decision. (**LSP diagnostics after edits** was built —
   D49av, 2026-09-27. **Checkpoints/undo** is built as **undo**, deliberately
   *not* checkpoints — decided D49ax, built D49az, 2026-09-28.)

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
before D19. M4 closeout — the acceptance test and the D15 secret audit (read D49ar:
the D16 trademark sweep and the D19 license decision left M4 for the publish gate) —
is **not** advanced by this work and is not claimed by it.

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
history at **`0aeb309`**.

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

> **EXTENDED (D49bp, 2026-10-08).** The `[DONE]` sentinel was handled from the start; a stream that
> ended WITHOUT one was not, and was returned as a completed turn. The completeness check and the read
> timeouts are D49bp's subject.

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

> **FIXED (2026-10-06, D49bf).** The gap left open above is closed, and the founder took the
> option this paragraph named *"trusting a `/models` payload"* — the one it had rejected.
> The window now comes from the connection alone and the shipped catalog is gone; a model
> nothing is known about is assumed to hold **128k**, not 8,192, which is what had folded
> this run after three files. The trade that bought (a 400 instead of an early fold) is
> recorded in D49bf.

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

---

**D49af — size the rungs the model actually writes (M5.0, 0.25.0 — 2026-09-24).**

Corrects D49ac. Two passes were needed, and the second one is the interesting one.

**Pass one — "pronounced".** D49ac's ladder cleared the body but the founder's second read was
that the headings were still not **pronounced**, with Claude Code as the reference. A section
title at 1.19× the prose is a label, not a heading. So 17/15.5 became **20 / 17.5 / 15.5 / 14px**
and the top two rungs went to weight 700. **The suite's assertion was the problem here:** "bigger
than the body" was satisfied by the ladder he had just rejected, so the test now pins
**dominance** — top rung ≥1.45×, second ≥1.3×.

**Pass two — and why the first pass still looked flat.** He reloaded, looked at the same report,
and said he was *"not sure"* the change had landed. **It had landed** — the installed CSS was
verified — and the reason he could not tell is the finding.

**A model does not write a four-level document.** That report was a single second-level heading
for the title and a **third-level heading for every section**. So all three section headings — the
whole visible structure of the page — landed on `h3`, and the strong first and second rungs were
**dead weight for the only document shape that exists**. `h3` had gone from 13px (exactly the body
size) to 15.5px: a difference of two and a half pixels, which is precisely the uncertainty he
reported.

**So the rungs were sized for the table, not for the page.** The ladder is compressed to
**21 / 19 / 17 / 15px** — ratios 1.62 / 1.46 / 1.31 / 1.15 — so every rung a model actually writes
is pronounced, at the cost of a shallower gap between them. **That trade is the decision:
prominence for the levels in use beats hierarchy across levels that never appear.**

**The suite had the same blind spot, which is the generalisable part.** It pinned `h1` and `h2`,
and the document used `h2` once and `h3` three times — so **the assertion that mattered did not
exist**, and the fix passed its tests while the page still read flat. That is the same failure as
the turn cap that no test had ever described: **a suite that measures the ladder instead of the
document.** `h3` now carries its own assertion at ≥1.25×, and the falsification is exact — with
the ladder he was looking at, it fails reporting `h3 15.5` against `body 13`. **His uncertainty,
as a number.**

---

**D49ae — say how you know (M5.0, 0.25.0 — 2026-09-24).**

The founder read a report that fixed five things across four files and asked the question that
matters: *what do you suggest about this?* — the one finding that was wrong.

**What actually went wrong is not the obvious candidate.** The report cited `file:line`
everywhere; citations were never the gap. It read the code and drew a **wrong conclusion about
what a library does** — what `SimpleDateFormat` emits from a `SSSSSSS` pattern — and stated it
as fact. And it was not dishonest: its verification section was excellent (*"I could not compile
or run anything… reasoning from the SimpleDateFormat specification"*), and it flagged the ICU
uncertainty by name.

**The hole is that the caveat was REPORT-level while the claims were PER-CLAIM.** One flagged
uncertainty sat beside an unflagged wrong one, and the reader has no way to tell which is which.

**The rule, and the founder's constraint that shaped it.** Every factual claim is **observed**
(you ran it), **read** (you read the code — name the file and line), or **inferred** (you
reasoned from a library, a spec, a convention). Inference is allowed; **presenting it as
observation is not**, and a third-party library's edge-case behaviour is the high-risk case
because that is exactly where confident recall is wrong.

**He rejected the shape I first proposed, and he was right.** I had suggested using `act` mode
rather than `edit` when verification matters — making accuracy a function of which mode you
happen to be in. His answer: *"let's make verification etc not dependent on mode. accuracy is
uncompromisable under any mode."* So the rule is written the other way round: **a tool you do
not have limits what you may CLAIM; it never licenses a guess.** `edit` denies the shell — under
my version, `edit` would have been the mode whose findings were least trustworthy, which is
backwards. The prompt now says so in those words, and a test asserts that sentence.

**Two smaller rules ride with it.** A fix must **name the assumption it rests on** — this fix was
correct only if the strings came from a producer meaning fractional seconds, and nothing in the
report said so. And for a task that asks for **findings and then fixes**, the findings are written
out **before the first edit**: a wrong premise is cheap while it is a sentence and expensive once
it is a change.

**D49ad — a report's own separators were rendering as junk (M5.0, 0.25.0 — 2026-09-24).**

Found while measuring the headings, and reported rather than bundled — the founder asked for
headings, and adding markdown syntax is a different thing. He said do it.

Reports separate their sections with `---`, and the renderer emitted **three literal dashes in the
middle of the prose**: `renderMarkdown('a\n\n---\n\nb')` gave `<p>---</p>`. Claude Code draws a
rule there, which is part of why its reports read better.

A standalone `---`, `***` or `___` line is now `<hr>`. **The one thing that must not change is
the setext case** — `Title` then `---` is an *underline*, not a rule — so the rule only fires when
no paragraph is open. That matters because this renderer has never supported setext: that line
already folded into a paragraph, and turning a title's underline into a horizontal rule would be
worse than the bug. Tables are unaffected (`|---|` starts with a pipe), and a rule inside a fenced
block is untouched because fences are swapped for sentinels first.

**A wrong reason of my own, caught by measuring.** I wrote `height:0` on the rule and a comment
explaining that Chrome otherwise paints it two pixels thick. Both were wrong: the stylesheet is
`box-sizing: border-box`, so the 1px border *is* the whole 1px and the `height:0` did nothing. I
removed the declaration and corrected the comment — the same failure this entry is about, one
screen after describing it, and caught by reading the computed style instead of the reasoning.
The assertion was fixed too: it now measures the **painted** thickness, because a border-box
element's content height is not something a rule can vary.

---

**D49ac — a reply has to be readable, and it was not (M5.0, 0.25.0 — 2026-09-24).**

The founder, reading the first long report Plato produced: *"the headings and important stuff
is all too jammed up and headings are too small… since this is the part the user will read."*
The arithmetic backs him up exactly.

**The heading ladder was broken, not merely small.** Body text is 13px and the headings were
**15 / 14 / 13 / 12.5px** — so an `h3` was **the same size as the paragraph beneath it**, and
an `h4` was *smaller than the text it introduced*. A ladder whose lower rungs sit at or below
the prose is not a ladder. It now climbs clear: **17 / 15.5 / 14 / 13.5px**.

> **Superseded twice, the same day — see D49af.** The sizes above were the first correction
> (a ladder that climbs), then **17/15.5** became **20/17.5** when the founder judged them still
> not pronounced, and then the whole ladder was **compressed to 21/19/17/15** once a real report
> showed which rungs a model actually writes. **The spacing, the line-height and the first-heading
> rule below are unchanged and still current.**

**"Jammed" was the space BELOW, which was .25em.** Every heading carried `.7em 0 .25em` — so
section titles sat on top of the text they introduced, and the gap above them was fine. The
asymmetry is the point: space above a heading must dominate space below it, or the heading
binds to the text above instead of to what follows. Below is now `.35–.45em`, above `.9–1.1em`.
Paragraphs went `.35em → .5em`, list items `.15em → .3em`, and the reply as a whole gained a
**1.5 line-height** — for a long report, spacing between lines does more than any of it.

**Also: the first heading gets no space above it.** A reply that opens with `Summary` would
otherwise start with an empty gap under its own name line.

**A rule that looked right and was a no-op.** The first version gave `strong` a brighter colour
so identifiers would stand out in the prose — and the render suite caught it being **exactly the
body colour**, because the body already uses `--vscode-editor-foreground`. It was deleted rather
than fixed: there is nothing to change, and a rule that does nothing is worse than no rule,
because the next reader assumes it does something.

**Verified by measurement, not by looking.** The new `summary` render suite reads computed
styles and asserts the properties **relative to the body size**, because the body size is the
thing that was broken — "headings are big enough" passes against 13px headings; "no heading is
the same size as body text" does not. Falsified, reverted: the old ladder fails four assertions
and reports `h3.size === 13 === body`, which is the founder's complaint as an assertion.

---

**D49ab — there is no turn cap (M5.0, 0.25.0 — 2026-09-24).**

`MAX_TURNS = 40` is deleted. The founder's question was not "raise it" but *"why is there
even a cap"* — and the record answers it badly.

**Nobody asked for it.** It arrived inside **D22, marked "(delegated)"** — the M1
tool-loop choices the founder left to the assistant — as one clause of the mode table:
*"`auto`: everything auto-approved under a hard turn cap. **All modes turn-capped.**"* The
first half has a real reason: `auto` is the one mode with no click in the loop, so
something should stop a runaway. **The second half is where the reasoning stops.**
`edit` and `act` gate every write behind an approval and `plan` cannot mutate at all, so
in those three modes the cap guarded nothing that was not already guarded by a human.

**What that cost, from a real run.** In `edit` mode, against a task to review three
classes, the run was stopped at turn 40 — `reason: "cap"` — with the third class untouched
and no written review, **after the founder had already approved eleven writes.** It was
not looping or burning anything: 10,442 output tokens across all 40 turns, 99.5% of its
input served from cache, 45.7k of a 1M window. **The user was the backstop and the cap
still fired.**

**Turns were also the wrong unit.** That run averaged ~261 output tokens a turn; a run
that thinks can spend more than its whole total in three. A count of steps bounds neither
money nor time — it bounds the one thing a larger task legitimately needs more of. **The
concrete that settles it:** two days earlier D49h built a *user-facing* `$/turns` budget
and the founder removed it the same day as a capability nobody had asked for, while its own
text noted that `MAX_TURNS` was the only remaining bound. So the bound he asked to remove
went, and the bound nobody asked for stayed, enforcing a number with no reason behind it.

**The run now ends when the model stops calling tools** — work until done, with cancel
available at any point and, since D49aa, the transcript preserved whatever happens.
`reason: 'cap'` now means exactly one thing, a **truncated answer**, so the string
`'[plato] turn cap reached; stopping.'` is gone; the `auto` mode blurb no longer promises a
cap as its backstop; and `background.ts` no longer tells the model it has 40 turns to spend.

**A coverage finding worth keeping.** Deleting the cap broke **no test** — because **no test
had ever described it.** Three weeks of changes never touched it. That is why it survived
unchallenged, and it is the same gap as D49aa's notice: a behaviour with no test is a
behaviour nobody re-reads. Two tests now pin the replacement, one of them running **55
turns** with the model still calling tools.

**Deliberately NOT replaced.** In `auto` nothing now bounds a model that loops without
concluding. The founder's read is that the runway fear is exaggerated — models conclude
their tasks — and that Claude Code ships an auto mode with no limit. Rather than invent
another number, the question is recorded in the PROGRESS backlog with what is already
known: **the failure mode is repetition, not volume**, so a bound should detect a repeated
identical tool call rather than count steps; and `duo`/`academy` already put a supervising
observer in the loop, which is the structural answer for an unattended run.

---

**D49aa — the transcript is append-only; compaction is a request, not a deletion
(M5.0, 0.25.0 — 2026-09-23).**

The founder cancelled a run and watched his conversation disappear, replaced by a
summary he had not asked for. **The fold was scheduled in the run's `finally`**, so it ran
on every way a run can end — success, error, or cancel — and the trigger is a message
COUNT (26 pairs), which his ~30-turn run passed the moment it stopped.

**The damage was two lines.** `foldTail` did `this.log.length = 0` and then pushed the
summary plus the kept tail. **The reader was never wrong:** `historyFor` already found the
newest summary row and built the request as *[summary] + everything after it*. Only the
writer destroyed anything. **So the fix is the deletion of a step, not a redesign** — the
fold now WRITES a row at the cut, and both readers handle that correctly with no change.

**Why this happened, and what to learn from it.** The log is the user's transcript; the
request is what the model sees. They are two different things that were the same array, so
a reasonable thing to do to a request — rebuild it from a summary — was a catastrophic
thing to do to a transcript. **The industry separates them, and Plato is not the first to
get this wrong:** Codex shipped the same defect, and its fix proposal describes Plato's
bug exactly — *"rewrites the live transcript… the user can no longer scroll up."* In
Codex's case the original text was still on disk and only the RENDER failed to backfill
it. **Nothing here needed to be lost.**

**The summary is no longer printed.** It is the model's memory, written to be terse and
fact-only; putting it in the transcript showed a machine note in place of the conversation
that is already there. The marker says where the model's memory now starts, and the rows
it accounts for are all still above it. **This is the same conclusion the founder reached
independently** — Claude Code does not print its summary either, and he preferred that.

**The display cap is now honest too.** With the fold no longer deleting, `LOG_MAX` (400
ENTRIES — not 400 messages; every completed tool call is one row, so a tool-heavy run
spends ~70) became the only thing that could still drop rows, and it did so silently. It
now leaves a `trim` row saying how many went, and says separately when the cap took the
summary — because that is the model's memory going, not just the view.

**Verified by testing the code, not the shell.** The rules moved to core
(`runtime/chatlog.ts`) — `planFold`, `applyFold`, `requestFromLog` — because the shell has
no unit tests and a data-loss bug must be reproducible. **The falsification is the
decisive evidence:** implementing `applyFold` as the discarded rewrite fails
*"writes a row without removing any row"* with a log that shrank from 33 rows to 25.

**Confirmed in production, the same day.** A real 40-turn run on the Android repo triggered
a fold of 28 messages, and the founder could still scroll back to his original message. The
transcript survived, which is the whole claim of this entry.

**And the notice it printed was still describing the old behaviour** —
*"Compacted 28 earlier messages into a summary"* — sitting directly under the 28 messages it
implied were gone. A mechanism and the sentence that reports it are two things, and changing
one leaves the other lying. The wording now says a summary was ADDED and that nothing was
removed. **Worth remembering as a class:** any message that reports what a mechanism did has
to be re-read whenever the mechanism changes, and the founder found this one by scrolling.

**Not done, and next:** the summariser still sees only message text, never tool calls or
results — which is why a tool-heavy run summarises to nothing, and why the founder's own
summary admitted it saw no work. Then the threshold (an absolute window, not a percentage
of a window that can never fill), then a cheap first layer that trims old tool OUTPUT
before any summary. **A summary is currently the only tool we have for a 26-pair tail that
is 92% tool results.** That is the next thing to fix.

---

**D49z — every fetched model is eligible; the tick boxes are gone (M5.0, 0.25.0 —
2026-09-23).**

D49x fixed the *symptom* the founder saw — a chat running a model he had unticked. This
removes the **state** that made it possible, on his call after reading the options:
*"user can't uncheck or opt out of model (that's confusing). Right now, all fetched models
from a provider are eligible."*

**The tick boxes were an opt-out, not a gate, and that is worth recording because it
changes how big the change looked.** "Fetch models" wrote the whole fetched list into both
fields, so the default was already "everything is available"; the boxes only ever narrowed
it. The founder's own screenshot is that narrowing — nine models fetched, one ticked.

**What the narrowing cost, beyond the bug he hit.** The chat is not the only place a model
reference is stored. **Every Duo and Academy member stores one**, and those are validated
only for SHAPE — `<connection>:<model>` — never against what is available. So unticking a
model could leave a council member pointing at a name the key refuses, and that 403 would
land **mid-run, after the doer had already done work**. D49x covered the chat; nothing
covered the members. With no opt-out, no stored reference can be out of the offered set,
so that whole class is gone rather than guarded.

**Two fields became one, and the read rule is the migration.** A connection carried
`models` (the ticked subset) and `allModels` (the fetched pool), and the boxes were the
only thing that could ever make them differ. `resolveOfferedModels` reads **the wider list
first**, falling back to the narrower one only when no fetch has happened — so a config
narrowed before this change offers everything immediately, with no migration step and
nothing rewritten in the user's settings. Reading the narrow one would have preserved the
fault, which is the whole reason the order matters.

**The Settings list is now a reference, not a control**, and says `Models — N available`
instead of `N of M active`. That wording was doing real damage: it promised *active*, which
is why the founder's own screenshot read as a bug rather than a preference. Its rows also
lost the pointer cursor and the hover, because an inert row that highlights is claiming to
be clickable.

**D49x's rule is NOT superseded.** With nothing to untick, the rule now covers what
nothing can prevent: the endpoint withdrew a model, or the connection was deleted — the
same fallback, now reached only by real absence rather than by a preference.

**Deliberately NOT built, and held as a backlog item:** the founder's next idea was to
replace the boxes with **drag-to-reorder** so the picker shows his priority. That is a
**capability, not a repair**, so it does not belong in this change — and it is worth more
than its name suggests, because the top of the list becomes the fallback default. The four
unsettled points (keyboard path, testability of the gesture, capability-vs-repair, and not
scaling past a few dozen models) are recorded in the PROGRESS backlog.

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

**D49ag — the log recorded that a tool ran, never what it did (M5.0, 0.25.0 — 2026-09-24).**

D49aa fixed the *rules* around the chat log: a fold writes a row instead of clearing the array, so
the transcript only ever grows and the request is derived. This entry is the other half of that
fault, and it was found by reading a real run rather than the code: **the rules were right and the
data they read was empty.**

**A tool row said `{tool, phase}` and nothing else.** So the log held a record that *something* ran,
with no account of what it was for. Both readers of that log were therefore blind:

- **The fold's summariser**, which is handed message rows, could see that work had happened and
  never what the work was. A real run's own summary said so in as many words —
  *"No files read (contents not available in transcript)"* — which is a sentence about an empty
  prompt, not about the model.
- **`requestFromLog`**, which is the model's memory at the start of the next run, dropped tool rows
  entirely. So a second message in the same conversation arrived with no record of the files read
  or the commands run — the same blindness, one turn earlier.

**Measured on the founder's own 78-turn run** (`muejgc51j21i`, `~/.plato/runs/ff47b78d`), because
this decided whether the work was worth doing. At the final turn: **91,987 of 113,793 estimated
tokens were tool results — 80.8%** — against 17.9% assistant text and 0.2% user text. The fold could
see **0%** of the largest part of the run.

**The digest is the ARGUMENT, never the result, and that line is the whole design.** `digestToolCall`
takes the salient argument *by tool name* — the path for a file tool, the pattern and glob for a
`grep`, the command for a `shell`, the URL for a `web_fetch` — and never dumps `args`, because `args`
for `write_file` is a whole file body and for `apply_diff` is a whole diff. Copying those in would
put the work back into the log that compaction exists to shed, and persist it to workspace state to
be re-sent on every run. The digest says what was done; the model re-reads for the content. A test
pins it with a 50,000-character body.

**Four decisions inside the fix:**

1. **`planFold`'s `covered` now includes the tool rows, in log order.** Not a separate list, because
   *when* each thing happened is most of what a summary is for. A caller wanting the exchange count
   filters with `isMessageRow` — the count the user is told stays a count of messages, since
   *"Summary added for 47 earlier messages"* would be a lie if 40 were tool calls.
2. **The fold prompt moved to core (`buildFoldPrompt`).** The shell had its own copy of that loop,
   and the shell has no unit tests — so the half of this change that decides whether a fold records
   the work would have been invisible to every suite in the repo. That is D49aa's argument for
   `applyFold`, applied to the part it missed.
3. **The request carries the tail's digests as a bracketed turn** — `[tool activity — what Plato
   ran]` — rather than as a sentence tacked onto the assistant's turn, so nothing arrives at the
   model as words it did not write. `maxTailPairs` still counts exchanges: a run of tool rows
   belongs to the exchange it happened in.
4. **A tool row with no digest is skipped entirely**, so a log written before this change produces a
   byte-identical request. The existing `requestFromLog` tests use exactly such rows and passed
   unchanged.

**A refusal, a decline and a failure are said differently:** `(not permitted in this mode)`,
`(the user declined)`, `(failed)`. The first two are not things to retry, and a model that cannot
tell them apart retries into a wall.

**Not done, and why.** The in-run compaction path (`compactMessages`) already fed tool blocks to its
summariser — it was never the blind one. The queued *"trim old tool output before summarising"* item
was measured and left alone: on this run the guard's threshold was 80% of a 1,000,000 window, the run
ended at **11.4%** of it, and the transcript contains **zero `context-compacted` events** — so the
in-run guard never fired and the between-runs fold was the only mechanism running. Trimming tool
output is worth doing for a small-window model; it is not what the founder was seeing.

**Also recorded: the digest is now persisted data that was not there before** — workspace state
carries paths, commands, patterns and URLs the log did not hold. It is the model's own call echoed
back, and the commands were already shown on an approval card, so nothing is newly exposed to the
model. But a future secret audit (D15) should know it is there.

**Confirmed in real use, the same day.** The founder asked Plato *"which files did you read?"* before
and after the change. **Before:** *"I can't honestly give you a precise log of every read_file call —
that detail isn't in my current context"*, reached after two `git` calls spent trying to re-derive
it. **After:** the complete list, grouped by how each file was used, with **0 tool calls in 3s** —
the tell, because it re-derived nothing. It even knows the **order** (*"read in full, then re-read
after editing"*), which only the log order preserved here could supply. **The control is clean:** the
same question in the same conversation, with the model's own earlier report text in context both
times, and the first run said outright that the detail was not available — so the report is not what
changed. *This is the level of evidence a product claim should have: the same question, a stated
inability, and the inability gone.*

---

**D49ai — a shell command could read a protected file by naming it plainly (M5.0, 0.25.0 — 2026-09-24).**

**Found by accident, while writing an unrelated test.** One of the assertions had a
"control" line — the same words in a tool that CAN read — and the control did not refuse. The
invariant broken here is the one this project lists as non-negotiable: *secret-bearing file
content never enters model context.*

**The defect is a basename.** `isSecretPath` matches a whole string after taking its basename, so:

| command | basename seen | outcome |
|---|---|---|
| `cat app/keystore.properties` | `keystore.properties` | refused |
| `cat keystore.properties` | `cat keystore.properties` | **ran** |

**The spelling that read the file is the natural one**, because the proving-ground repo keeps
`keystore.properties` at its ROOT. **Verified by running it**, not by reading: with the file present,
`executeTool(root, 'shell', {command: 'cat keystore.properties'})` returned `ok: true` with the file's
contents in the output — which is the model's context and the transcript — and `shell` is **`allow`
in `auto`**, so nothing asked.

**Two things had to change, because the check exists in two places and both were blind:**

1. **The executor** (`shellTool`), which is the guarantee. `isSecretPath(cmd)` → `mentionsSecretPath(cmd)`.
2. **The loop's pre-flight** (`secretRefusal`), which is the courtesy: it refused nothing here, so
   the approval card never even mentioned the file. It now scans a shell command as TOKENS.

**`mentionsSecretPath` is a token scan, not a substring one**, and that choice is the design:
`echo do not commit keystore.properties` is refused (the safe direction), while `grep -rn
"secretsmanager" app/src` and `./gradlew assembleRelease` are not, so the guard does not fight the
model over words instead of files. **Recorded as best effort:** a command built to evade a text check
(`cat key'store'.properties`) still can. In `act` and `edit` the approval card is the real gate; in
`auto` the user has chosen not to have one, which is why the plain case was worth closing.

**`todo_write` is exempt from the scan** (D49ah) and the exemption is deliberate: the scan is for
arguments that can cause a secret to be READ. A plan item is the model's own sentence about work it
intends, and *"rotate the keystore"* is a legitimate step. Nothing is weakened — the file is still
refused by `read_file`, `grep` and `shell`, and a test asserts exactly that pairing.

**Falsified:** restoring `isSecretPath(cmd)` in the executor fails the two new executor tests, which
run the command for real against a workspace that has the file.

---

**D49ah — the agent writes its plan down, and the user can see it (M5.0, 0.25.0 — 2026-09-24).**

Phase 6 of the plan in D49, and **the first phase whose reason got STRONGER while it waited.** The
plan justified it as "coherence, not decoration, for a 40-turn cap" — and D49ab deleted that cap. A
real run then reached **78 turns**. A long run with no externalised plan drifts: the model
re-derives what it is doing from a conversation that is mostly tool results (80.8% on that run,
D49ag), and a summarised turn can drop the thread entirely.

**`todo_write` replaces the whole list on every call.** A delta protocol (add item 3, complete item
1) lets the model's picture and the real list drift apart silently; a full list makes the model
restate its plan, so the list IS what it currently believes. Same choice as Claude Code's, for the
same reason.

**The tool's RESULT is the rendered list** — the same string the panel draws, so there is no second
representation to disagree with — and that is what makes the phase's central claim checkable: **the
model is handed its own plan back on the next turn**, pinned by a loop test.

**Three design calls worth recording:**

1. **It is a META tool, beside `ask_user`** — allowed in every mode, never approved. It touches
   nothing in the user's world: no workspace, no network. An approval card reading *"write down your
   plan"* would be friction with nothing behind it, and **`plan` mode is where writing the plan down
   is the whole job**, so gating it there would be exactly backwards.
2. **A malformed plan is refused, never guessed at.** An unknown status returns the model a
   correction, not a coerced item — a silently coerced status would put a plan in front of the user
   that the model never wrote, which is the ambiguous-diff rule applied to a panel line. An
   over-long item is **refused rather than truncated**, for the reason behind D49c.
3. **The plan is recorded as a LOG ROW, and drawn where it was set.** A run that replans shows each
   plan as it stood, so the transcript keeps showing what actually happened; a reload rebuilds them
   from the log rather than from state the shell would have to hold. **No new bus event was needed**
   — the shell already receives every tool call's arguments, and a second channel for the same data
   would have been machinery for nothing.

**Its digest is the plan's SHAPE, not its text** (D49ag): *"3 items, 1 done, in progress: Fix the
formatter"*. Ten item lines would spend the log's room on a list the panel already shows, and
`DIGEST_MAX` would cut them mid-list — which reads as a whole plan that is not one.

**Asserted in the panel too, and this is the part the plan did not ask for:** **state is legible
without colour.** Completed is struck through, in-progress is the heaviest item, and every state
carries a distinct glyph — a plan read by someone who cannot separate the accent colours is still a
plan. A render suite pins all three, and every assertion was falsified (removing the strike rule
fails it; making a replan replace the previous card fails it).

**Not done, and honestly:** the escaping assertion (a plan item is text, never markup) is verified by
construction — `textContent`, and an item containing an `img onerror` renders as text — but its
**falsification was blocked by the sandbox classifier**, which correctly refuses to let a session
build an XSS payload and then drive a browser at it. That one assertion therefore rests on review,
not on a watched failure.

---

**D49aj — the questions panel gets numbered tabs (M5.0, 0.25.0 — 2026-09-24).**

The founder's ask, and a cosmetic one: number the questions as tabs. The change is small;
what is worth recording is the weakness it exposed in my own tests.

**The label was carrying one fact out of three.** The card said *"Question 2 of 3"*. That
tells the user how many questions there are, and nothing about **which of them are already
answered** or **how to reach one** without stepping through every question before it with
Next. The strip shows the whole set at once, marks an answered question on its own tab, and
jumps on a click.

**Three states, and colour is not the only cue:** the active tab is **filled**, an answered
one is **outlined in the accent**, an untouched one is **grey**. Standing on question 2, the
user sees that 1 is done and 3 is not.

**Back already existed and is unchanged.** The card has offered `← Back` since D34/D35, and
it restores the previous answer — free text included — which the `question` suite has pinned
since D49y. The tabs make a question faster to reach; they do not replace stepping, and the
button was not removed to make the strip look tidier.

**The part worth keeping: my first version of the tests was wrong twice, in the same way.**
An assertion — *"no tab is marked answered before an answer exists"* — **passed vacuously**
on a card that drew no tabs at all, because zero tabs means zero answered tabs. It now
repeats the count it forgot to check. And the jump step **threw** on a missing tab, which
aborted the block and hid every assertion after it, so it is guarded and reports instead.
**A vacuous assertion is worse than no assertion: it is a green light on the exact
regression it names.** Both were found by falsifying rather than by reading the test.

**Falsified:** suppressing the strip fails **8 assertions** and the suite exits 1.

> **LABELS SUPERSEDED (2026-10-01, D49bd).** The tabs are still tabs, with the same three
> states, the same jump-on-click and the same `← Back` — but **a tab is now NAMED rather than
> numbered**: each question carries an optional one- or two-word `header` the model writes, and
> a question without one still falls back to its number. The paragraph above about the strip,
> and the paragraph about the vacuous assertion, both stand unchanged.

---

**D49ak — three modes, not four: `act` is merged into `edit`, and `auto` fetches without asking
(M5.0, 0.25.0 — 2026-09-24).**

**The founder's finding, and it was correct: he could not tell `edit` and `act` apart.** The reason
is that the two differed in places the names do not describe:

| | `edit` (old) | `act` (old) |
|---|---|---|
| reads | allow | allow |
| writes | ask, **then remembered per file for the session** | ask, **every single time** |
| shell | **denied** | ask |
| `web_fetch` | ask | ask |

So the old `edit` was **quiet about edits and could not run anything**, and the old `act` **could run
anything and nagged**. Both are unsatisfying, and neither name tells a user which they want.

**Two things settled the merge, and the second is the one that makes it more than tidiness.**

1. **The merged mode is strictly better than either it replaces** — the old `edit`'s per-file memory
   plus the shell. That is what ships: `edit` reads freely, asks for a write, **remembers a "yes"
   per file for the session**, and asks for every command.
   **The founder confirmed this half explicitly (2026-09-24): *"what edit can offer user is to
   remember the decision per session."*** It had been written here as the choice that shipped out of
   the two old behaviours; it is now his decision, so the per-action alternative is closed rather
   than pending. **A command is deliberately NOT covered by that memory** — a `shell` call asks every
   time, and the approval card's own "approve all {tool} for this session" is the way to widen it,
   because a command is unbounded in a way that a named file is not.
2. **The old `edit` could not satisfy the prompt it ran under.** It denied the shell, and the worker
   prompt *requires* verification — *"mark a step completed only once you have verified it"*. A mode
   that cannot run a test cannot verify, so `edit` was asking the model to obey a rule it had no tool
   for. **That argument is the founder's decision, not his words**, and it is recorded as such.

**The three, in his terms:** `plan` looks and does not touch; `edit` changes the project and asks
first; `auto` asks nothing.

**`plan` keeps NO shell, and that is the one part of his proposal that was not built as stated.** He
asked for a `plan` that could "do full search or execute scripts but not change project files". **The
host can classify a TOOL; it cannot classify a COMMAND.** A shell command is a program — `rm`,
`sed -i`, `>` redirection, `git checkout`, `npm install` all write — and telling a mutating command
from a reading one means reading the text, which is **exactly the mechanism that failed on
2026-09-24 in D49ai**, where one missed spelling put a protected file into a model's context. So the
choice was: no shell in `plan` (shipped), a shell in `plan` that makes it `edit` under a friendlier
label (rejected — it would misdescribe what is protected), or a command **allowlist** (not built;
it is enforceable, unlike a denylist, but every command added to it is a new chance to be wrong).
**What he wants from `plan` is mostly the missing `web_search`, not more shell** — `web_fetch`
already asks-and-works in `plan`; what it cannot do is *find* a URL, and `web_search` is deferred by
his own decision (D49p).

**Second change, and this one AMENDS D49p: `auto` now fetches without asking.** D49p made egress
`ask` in every mode including `auto`, on the ground that a request cannot be un-sent. **The founder
overrode it** — *"let's allow auto all perms including fetching urls mode thinks are necessary."*
**What he is buying out of, recorded rather than argued again:** in `auto` no card stands between a
fetched page and the model, so a page carrying instructions can steer the model to a URL with the
user's data in the query string and nothing asks. **Three rules still hold, and they hold in the
EXECUTOR rather than by permission, so `auto` cannot reach around them:** a redirect onto a loopback,
private or link-local address is refused; a non-text content type is refused; fetched content still
arrives labelled untrusted. `plan` and `edit` still ask.

**What the merge cost, and what it did NOT cost.** It supersedes a documented contract in two
architectural documents — `BLUEPRINT.md` (*"`edit` (diffs, no shell)"*) and `ARCHITECTURE.md`
(*"`plan` and `edit` modes cannot execute it"*, security invariant 3) — and per D48 their bodies stay
verbatim, so each gained a **superseded-map row** rather than an edit. **There is no settings
migration:** the mode is not persisted across sessions, so a stored `edit` or `act` cannot exist to
be migrated. The default moved from `act` to `edit` in both the host and the webview.

**The test gap this exposed, closed in the same commit.** The unit tests covered `decide()` — the
permission table — and **no render suite had ever opened the mode picker**, so the list of modes a
user actually sees was asserted nowhere. Survivable while the list was stable; not survivable when a
mode is removed from it. A new `modes` suite pins four things a removal gets silently wrong: the row
is gone, the survivors are right and ordered, the default moved, and **the description that belonged
to the old `edit` did not survive the mode it described** — the old text still said the shell was
denied.

**Falsified:** restoring the `act` row and the old `edit` description fails **4 assertions** and the
suite exits 1 (three for the row, one for the stale description).

---

**D49ao — `plan` runs read-only commands too, and a background command is never one
(M5.0, 0.25.0 — 2026-09-24).**

**One sentence from the founder — *"plan can run read only commands"* — and it changes what `plan`
IS rather than only what it permits.**

**The character of the mode changes, and that is worth stating plainly.** `plan` was "runs
nothing"; it is now **"changes nothing"**. That is a weaker promise in one sense and a truer one in
another: the property that makes `plan` the safe place to be is that **nothing it can do alters the
project**, and that property is untouched — `plan` has no write tool, and a command that passes
`isReadOnlyShellCommand` cannot write by construction. What it gains is the power the founder asked
for in the first place, when he described this mode as *"read only for project files, but with full
power to do search"*: `grep`, `rg`, `git log`, `git diff`, `find`, `ls`, `cat`.

**D49an refused him this, and the refusal was wrong.** That entry argued that "plan runs nothing" is
what makes plan safe, and that one exception would turn a rule into a judgement call. **The founder
overrode it, and the argument he overrode it with is the better one:** the rule was never "runs
nothing", it was "cannot change anything" — and a read-only *allowlist* enforces exactly that, in
the one form that is enforceable. The old objection was to a **denylist** of writing commands, which
is a guess; it does not apply to an allowlist, which fails closed. **So the refusal rested on a
mechanism I had already rejected in the same entry** — the two halves of D49an disagreed with each
other, and the founder's sentence is what exposed it.

**What did NOT change:** only the shell is widened, and only for commands the allowlist recognises.
Everything else `plan` denied stays denied — writes, `web_fetch` still asks rather than running,
MCP tools, `kill_shell`. **And in `plan` a COMMAND refusal is a `deny`, never an `ask`** — an
unrecognised command is refused outright rather than offered, because `plan` draws no card for a
command, so the safe direction there is refusal and not a question.

**CORRECTED (2026-10-07), because this passage claimed more than it could support.** It read *"plan
shows no approval cards at all"* — a sentence a user can falsify in one keystroke, and it contradicted
the clause about `web_fetch` two lines above it. **`plan` is a mode without cards for WRITES; it is not
a mode without cards.** Four things appear in `plan`, and every one is deliberate:

1. **An approval card for `web_fetch`.** Its rule is evaluated *before* the plan branch, so it returns
   `ask` in `plan` and `edit` alike, and a test pins it (`decide('web_fetch', 'plan')` is `ask`). This
   is the card the old wording denied while the same paragraph asserted it.
2. **The question card.** `ask_user` is allowed in every mode on purpose (D49ah), and `plan` is the
   mode where writing the plan down matters most — so denying it there would be exactly backwards.
3. **The stuck card.** Raised on the repetition bound in every mode; the ask is **not mode-gated at
   all**, so a `plan` run that goes in circles still puts the card up rather than stopping silently.
4. **The reveal card** for a protected text file the masker cannot parse — raised in every mode by
   design, `auto` included (D49bc).

**The generalisation was the whole error:** a fact about the **shell** was written as a fact about the
**mode**. What survives, and what this entry actually decided, is the narrow and useful version — *an
unrecognised command is denied rather than offered* — and that is the sentence to quote from here.

**The gap the widening exposed, which is a defect in D49an rather than in this change: a background
command was being treated as a read.** `shell` takes `run_in_background`, and D49an's check looked
only at `command` — so `shell({command:'ls', run_in_background:true})` would have been auto-approved
in `edit` and, after this change, in `plan`. **A background command is not a read:** it starts a
process that outlives the turn and keeps running while the run continues, and the only tool that
stops one is `kill_shell` — which `plan` denies. An auto-approved background shell in `plan` would
therefore be **a process the user could not stop from the mode they were in.** One rule for both
modes, at the top of the check: **a background command asks.**

**The tool test is what keeps both widenings exact.** The refinement returns `allow` only after
`tool !== 'shell'` has already returned, so the only verdicts it can change are the shell's own —
`deny` in `plan`, `ask` in `edit`. A `deny` belonging to any other tool cannot be upgraded by
supplying a `command` argument, and that is asserted with an MCP tool and `kill_shell`, both of which
are denied in `plan` and both of which take arguments shaped like the ones the allowance looks for.

**The user-facing copy moved with the behaviour.** The mode picker said plan *"never … runs shell"*,
which would now be a claim the user could falsify in one keystroke; it says **"run commands that only
read"** and **"never changes anything on disk"**. The render suite asserts the new sentence *and*
asserts the absence of the old claim, because a stale sentence here is a lie rather than a stale
label.

**Falsified, two reverts at once:** putting `plan` back to no-shell, and removing the background
guard, each fail exactly one test, and the suite exits 1.

---

**D49an — a read-only shell command runs in `edit` without a card, and the allowance is an
allowlist (M5.0, 0.25.0 — 2026-09-24).**

**The founder's instruction:** *"for read only shell commands the edit should not ask permission."*
The problem it solves is real and is about attention rather than speed: a run that stops to approve
`git status` and `ls` is a run whose approvals the user starts clicking through, and an approval
nobody reads protects nothing.

**The design decision is that this is an ALLOWLIST, not a "does this command write?" check.** A
shell command is a program, so predicting what its text will do is a guess — and the guess fails in
both directions. The question this answers instead is narrower and answerable: *is this one of a
small set of programs, given only plain words, that cannot write?* **Everything not recognised asks
as before, so a mistake costs a click instead of a write.** `sort` (has `-o`), `sed` (has `-i`),
`awk` (can write from inside its own program), `tee`, and every network tool are absent on purpose;
`find`, `tree` and `file` are present with their write flags named and refused.

**Three ways out of the list, all refused, and the second is the one that matters:**

1. **Shell syntax.** `; & | < > $ ` ( ) { } !` and a newline all disqualify a command, so what
   passes is a plain sequence of words with no shell meaning left in it.
2. **Globbing — `*`, `?`, and `[`.** **This one is load-bearing for the secret rule.** The deny-list
   (D49ai) matches the file NAMES written in a command, so `cat *.properties` names no secret and
   would open `keystore.properties` if it is there. With globbing refused, a command can only open
   files it spells out — and spelling one out is what the deny-list catches. `[` is the same hole
   through a character class, which is why it is refused with the other two.
3. **Leaving the workspace.** An argument starting `/` or `~`, or containing `..`, is refused, so an
   auto-approved read stays inside the project — the containment the file tools already enforce
   (D49k).

**The composition, which is where a widening actually goes wrong.** Only `ask` becomes `allow`; a
`deny` is never upgraded. So **`plan` kept no shell at all, even for `git status`.**
*(Superseded the same day on this one point — see D49ao: the founder then said "plan can run read
only commands", so `plan` does now run them. Everything else in this entry stands, including the
exactness argument, which is what made the widening safe to make.)* And the secret and containment refusals run **before** the
mode decision in the loop, so a command naming a protected file is refused outright and never
reaches the allowance — with one consequence worth stating: for that command there is now **no card
at all**, where before the user at least saw it and clicked Deny. The refusal is asserted
end-to-end at the loop level, because the ORDER is the thing that makes it safe and the order is
not visible from either half alone.

**What is deliberately still gated, and the founder should know it:** build and test commands.
`npm test`, `./gradlew`, `node`, `python3` and every `run` script ask as before, because a build
file executes arbitrary code and that cannot be inferred from the command text. **So a run still
stops before it runs your tests.** The follow-up that would fix it is a per-project allowlist of
exact commands (a `PLATO.md` field), which is enforceable because it is a list the user wrote rather
than a pattern the model satisfies. **Not built:** nothing has shown the remaining prompts are the
annoyance, and `auto` already exists for a run that wants no prompts at all.

**Residual risks, recorded rather than implied.** A **symlink** defeats the lexical check —
`notes.txt` pointing at `keystore.properties` passes every rule here. The secret check has the same
limitation (D49ai), but it used to be backed by a card the user read and for these commands it no
longer is. **`git status` is not strictly read-only**: it may refresh `.git/index`'s stat cache.
Accepted, because it changes no tracked content and refusing it would remove the single most common
thing an agent runs. And the per-program flag lists are **audit results, not proofs** — a
writing flag added to one of these programs in future would widen this until someone notices.

**Found by the suite, not by review:** D49p's "gives no host to a tool that contacts nobody" used
`shell` with `echo hi` as its fixture, and `echo hi` is now auto-approved — so the test would have
asserted a card that no longer appears. The fixture became a command that still asks, and its
subject (the host field) is unchanged. **A second test was added at the loop level for the new
behaviour itself:** a read-only command in `edit` runs with **zero** approval calls.

**Falsified, three reverts at once:** dropping the globbing refusal, dropping the workspace-escape
refusal, and letting the allowance reach `plan` each fail exactly one test, and the suite exits 1.

---

**D49am — the question card is kept small, and `apply_patch` joins the session memory
(M5.0, 0.25.0 — 2026-09-24).**

**Two things, from one founder message, and the second was found while answering the first.**

**1. The limits are now 3 options and 4 questions.** His words: *"I guess 6 is too many, lets cap it
to 3 choices (radio or checkbox) and one free text box. and maybe may ask up to 4 questions at a
time. we don't want overwhelm the users."* The schema said **2-6 options** and **1-3 questions**;
it now says **2-3** and **1-4**. **The free-text row is not counted** — it is added by the card on
top of the declared options, so 3 options are 4 rows on screen, and that is the shape the founder
had in mind. **The model is told the limits in prose as well as in the schema**, because a
constraint the prompt never mentions is one the model will cross.

**Why 3 and not 4 or 5.** Four or five options is where a person stops comparing and starts
re-reading; three is the point where the choice is still visible at once. **The cost is stated
plainly rather than hidden: this is tight for a MULTI-select question**, where offering candidates
is the point ("which of these files should I read?"). It was flagged to the founder before the
change and he chose one number for both kinds, which is also the simpler thing to explain and to
hold in the head. **If it bites, the split is one line** — 3 for single-answer, more for multi —
and nothing else in the design depends on the number.

**The ceiling is a limit on the MODEL, not on the user.** A model may declare fewer options than it
is allowed, the card renders whatever arrives, and nothing truncates. So a model that ignores the
schema still renders correctly; it just asks a worse question. **Refusing an over-long call was
considered and rejected**: the card would then be unable to show a question the model had already
decided to ask, which is worse than a slightly crowded card.

**Pinned by test, because these are product limits rather than technical ones** — a later session
raising them should have to delete an assertion that says why. The test also asserts the prose
mentions the limits, since the schema alone is not what the model reads first.

**2. `apply_patch` was the one write tool with NO session memory, and that is a defect the founder's
own worry found.** He asked whether per-file approval *"will constant nagging the user be annoying"*.
Checking the answer turned up this: the shell decided "is this a write?" with **its own hardcoded
pair, `write_file || apply_diff`**, while the mode table classified `apply_patch` as a write when it
landed (D49l). The two lists disagreed, and the consequence was exactly the nagging he was asking
about — a multi-file patch raised an approval card on **every call**, even for files the user had
already approved in that session.

**The fix is not "add `apply_patch` to the list"; it is "delete the second list."**
`isWriteTool` now derives from `TOOL_KIND`, so a write tool added later is covered by being
classified, which is the one place it has to be classified anyway. **A second list that must agree
with the first is a list that will not.** A new `writePathsOf` returns the files a write would
change — one path, or every path in a patch — and the rule is: ask unless **all** of them are already
approved, and remember **all** of them once the user says yes. A malformed entry is dropped rather
than stored as an empty path, so a nameless write cannot enter the approved set. Both functions live
in **core**, where they can be tested — the shell has no unit tests, which is why the bug was
possible there in the first place.

**Falsified:** restoring the hardcoded pair fails the test that names the three write tools, with
`apply_patch` as the failing case.

---

**D49al — a question may be multi-select, and the several picks travel as one string
(M5.0, 0.25.0 — 2026-09-24).**

**The founder's reason is the design, so it is recorded first: *"a model can reason to ask a
multiple choice answer, so we should support checkboxes."*** A model that can see several
correct answers and can only offer one forces the user to throw away the rest — and the free-text
row is a poor workaround, because then the user writes the option labels out by hand.

**The change is one new optional field and one state model.** The schema's question object gains
`multiple?: boolean`. A question **without** it behaves exactly as before, so nothing that already
works changed shape.

**Four decisions worth keeping:**

1. **The answer is still ONE string per question** — the picks joined by `'; '`. This is what kept
   the change small: the tool-result transport, the `askUser` callback signature and the transcript
   all stay as they were. The cost is that a pick containing `'; '` would be ambiguous, and that is
   accepted rather than hidden: options are the model's own 2–6 short labels.
2. **The model is told which kind it asked for.** The tool result reads `Answers:` (plural) for a
   multi question and `Answer:` for a single one. Without that label a multi answer is
   indistinguishable from a single answer that happens to contain semicolons — a string of labels
   looks like a string.
3. **The shape is the affordance: a BOX for multi, a CIRCLE for single.** The fill carries the same
   state, so neither reading depends on colour. A user who has never seen the feature can tell from
   the marker whether one answer or several are wanted.
4. **Free text joins rather than replaces.** Picking *Others* on a multi question adds the typed
   answer to the picked labels. This is the case where "one string per question" could have silently
   dropped half of what the user said, so it has its own assertion.

**One state model for both kinds, deliberately.** The card previously kept a single `answers[i]`
string, which cannot hold a set. It now keeps the chosen labels as a list per question plus the free
text, and derives the sent string from them. **The alternative — a second code path for multi — was
rejected:** it would have meant two restore-on-Back paths, two "is it answered" rules and two
Submit gates, and the single-select behaviour those paths already had (the D49y box-growth and the
Back restore) is pinned by existing assertions that the rewrite had to keep passing.

**A wording note, because the first version of this entry misled the founder when he read it.**
The **6** was not a multi-select cap: the schema let the model declare **2-6 labels per question**,
unchanged for both kinds. **The card adds the free-text *Others* row on top of the declared
labels** — three declared labels showed as three boxes plus a text row — and **the number of boxes
the user may tick is unlimited.** **The 6 is now 3, on the founder's instruction — see D49am.**

**Two things were considered and deliberately left out**, and neither is an option limit: a
one-click "tick everything", and a minimum-picks rule (the model cannot require "pick at least
two"). The question is the model's; the card adds no policy the model did not ask for.

**Follow-through, same day (2026-09-24): the description now says what a good option IS.** The
founder's point: *"a model should really work hard to give us plausible options within limits."*
A tighter ceiling only helps if the model spends the smaller space better, so the tool description
now asks for **three real alternatives rather than three variations of one**, requires every option
to be one the model **would genuinely act on**, and tells it to **ask only when the answer changes
what it does next**. It also gives the model the way out that makes the ceiling safe: **the
free-text row already covers what it cannot anticipate, so it must not pad the options with weak
ones** — and **a question with only one plausible answer should not be asked at all**. Each of those
is pinned by an assertion, because description text is the only place this behaviour lives.

**An observation for the founder, not a recommendation:** 6 is generous for a *single-choice* list,
where the user has to weigh the options against each other, and it may be tight for a *multi* list,
where offering many candidates is natural ("which of these files should I read?"). The ceiling could
be raised for multi questions alone. Not done, because nothing has shown the limit biting, and the
free-text row is the escape hatch.

**Falsified, three reverts at once:** drawing a circle for every question, making a multi click
replace instead of toggle, and forcing every question to be multi **fails 5 assertions** and the
suite exits 1.

---

**D49ba — product copy is ASD-STE100, and a control states exactly what it does (founder,
2026-09-28).**

The founder read one line of the undo card and could not tell what the button would do:

```
Put back the file from your last request?
  PLATO_UNDO_C.txt — Plato created this one, so it is removed
  Not this one: PLATO_UNDO_D.txt — you changed it after Plato did. ...
                                          [ Put these back ]   [ Cancel ]
```

*"What does put these back mean for us — put one file back, or put the edited file back too?"*
Nothing in the card answered it. **Three faults, and they were all in the copy rather than in the
behaviour:**

- **The button did not say what it does.** "Put these back" left "these" to the reader, on a card
  that listed **two different outcomes** — one file that would be deleted and one that would not be
  touched.
- **One list held both kinds of row with nothing to separate them.** A row saying what WILL happen
  and a row saying what will NOT sat together under a shared heading that existed only in the
  reader's head. The heading "Not this one" pointed at a file by position, not by name.
- **Two sentences described the mechanism and left a word to be guessed at.** *"you changed it
  after Plato did"* — after Plato **did what?** And *"Plato created this one, so it is removed"*
  never says who removes it or that it is now gone from the tree.

**The rule, for every string and every label from here on.**

1. **A control states exactly what the click does.** Not a topic, not a reference — the action and
   its object. `Delete 1 file`, not `Put these back`. Where the effect differs per item, the label
   names both halves: `Put back 2, delete 1`.
2. **What will happen and what will not are in separate, labelled groups.** A reader must never
   have to work out which rows are which.
3. **Every row names the file it is about.** No row depends on a heading or on a position in a list
   to be understood.
4. **ASD-STE100 Simplified Technical English.** Short sentences. Active voice with the actor named.
   One idea per sentence. The same term for the same thing every time — *undo*, everywhere, never
   alternating with *revert* or *roll back*. The approved vocabulary, not a synonym hunt.
5. **Say the situation, not the mechanism.** *"you edited it after Plato wrote it. Undo would erase
   your edits"* — not *"the fingerprint does not match"* and not *"you changed it after Plato did"*.

**The same standard applies to existing copy, not only to new copy.** That is the founder's
instruction — *"note down this for future and existing messaging and label"* — and it is why the
undo status line was fixed in the same pass: it read *"waiting for you — put these files back?"*,
which asked the reader **which** files at the moment the card was saying one of them would not be.

**What this does not license.** Rewriting every string in the product unasked. Each change to copy is
a change to what the user is told, and a batch nobody reviews is how a wrong sentence gets shipped.
The audit went to the founder; **he said convert all of it** (*"doesn't hurt, does it?"*), and it
did hurt in one specific way worth recording: see "the copy is a contract" below.

**The sweep, and the one structural change it needed.** Eleven more strings now follow the rule:

| Where | Was | Is |
|---|---|---|
| the approval card's heading | `Approve write_file?` | `Let Plato write src/a.ts?` |
| its session button | `Approve all requests to write_file this session` | `Allow every edit this session` |
| the guard line | `guard stopped write_file — it named a protected file` | `Plato did not run the write. That file is protected.` |
| the activity row | `read_file × 12 · shell × 2` | `12 files read · 2 commands run` |
| the progress line | `using shell` | `running a command` |
| session approvals ×3 | `write_file auto-approved (session approval)` | `Plato did not ask — you already allowed this for the session.` |
| `/compact` blurb | `Condense the conversation — now, or at the next safe point` | `Condense the conversation. Runs now if Plato is idle, otherwise at the next safe point.` |
| the orchestration chip | `Orchestration mode — click to change` | `Who works on this task — click to change` |
| the empty history | `Every Plato run is transcribed to ~/.plato/runs/ automatically.` | `Plato saves the record of every run in ~/.plato/runs/.` |
| the compaction note | `so it no longer remembers that part` | `so Plato no longer remembers that part` |
| undo's write failures | `src/a.ts — the write failed.` | `src/a.ts — Plato could not write to it.` |

Three of those are not string edits but structure, and each is what makes the rule holdable:

- **The approval card is found by its CLASS and its tool by `data-tool`, never by parsing its
  heading.** The field harness used to detect every approval card with `/^Approve .+\?$/` and read the
  tool out of the heading with a string replace. **That is why the sweep "hurts": the copy was a
  contract.** A reworded heading would have broken twenty field cases at once, and the failure would
  have read as a product regression. The contract is now a class and a data attribute — stable things.
- **`approvalHeading` and `approvalAllowAll` live in core**, and the render suite builds its fixtures
  by CALLING them rather than pasting strings, so those suites assert the product's wording instead
  of the harness's memory of it.
- **One tool-word table in core, three forms per tool** (`the command` / `running a command` /
  `commands run`), posted to the view like the slash menu. The three places that named tools by
  identifier now share it, so a tool added later falls back to a generic phrase instead of printing
  its identifier — pinned by a test that asserts no entry contains its own key.

**Two places the audit's suggestion was not taken, and why.**

- **"Keep going" keeps its two words.** The audit proposed *"Continue — do not ask about this call
  again"*, which puts two ideas in one label and breaks the same rule it is enforcing. The button
  states its action; the card now says the rest: *"Keep going resumes the run, and Plato will not ask
  about this same call again."* That second sentence is on **repeat cards only** — a no-progress card
  has no single call to exempt, so it would be false there.
- **The three session-approval notices were simplified, not noun-ified.** The audit wanted each to
  name its subject via a per-tool noun; that is a second table that must stay in step with the first.
  The notice's actual job is to answer *"why was there no card?"*, and the call it is about is named
  on the row directly below it. Two sentences, no table.

**A bug the sweep introduced, found by the render suite within the hour.** Rewriting the approval
card's answered state, two things broke that no copy review would have caught: `decideAll` referenced
a variable deleted in the same edit (a `ReferenceError` on every "allow every … this session"), and
**neither handler marked the card answered** — which would have left a spent card reading as live,
exactly the failure the field driver's `:not(.answered)` selector exists to prevent. Both are fixed,
and the render suite now asserts the answered state and the class directly.

---

**D49bb — a protected file can be READ, with its values masked; the secret is guarded where it
MOVES, not where it is named (founder, 2026-09-28).**

The deny-list refused any call whose arguments named a protected file, in every mode, with no way
out. The founder challenged it in one sentence: *"it don't waant plato refusal to become annoyance
for user, Plato can warn but must not outright reject"* — his example being a user who pastes a key
into the chat and asks Plato to write it into a config file. **That example does not describe the
shipped product, and measuring it first is what made the rest of this decision precise:** the write
it describes is **allowed today**, because the guard looks for a file NAME and a pasted key is a
VALUE. But the instinct was right, and the measurement says why — **the refusal fires on the ACCESS,
and the access is not the dangerous act.** Moving the secret somewhere new is.

**Fourteen agents were surveyed before deciding, and the field does not agree with itself.**

| Agent | Reading `.env`, default | Escape |
|---|---|---|
| Continue.dev | refuses hard — *"is not allowed because it is a security concern"* | none |
| Zed | refuses — `private_files` defaults to `**/.env*`, `**/*.pem`, `**/*.key` | edit the setting |
| Roo Code | refuses, against the user's own `.rooignore` | `!` negation |
| Kilo Code | refuses by permission rule — **and leaked anyway** (`.env.local` was read) | edit the rules |
| Gemini CLI | **excludes `.env` by default** — `SYSTEM_FILE_EXCLUDES = ['**/.DS_Store', '**/.env']` | `.geminiignore`, policy rule |
| Cursor | blocks its own file tools; not the terminal or MCP — *"complete protection isn't guaranteed"* | `.cursorignore` `!` |
| GitHub Copilot | never refuses; silently withholds the file from suggestions | admin setting only |
| Windsurf | index-only; no documented read block | config |
| Cline | **does not block**, and is REMOVING `.clineignore` | opt-in plugin |
| Aider | never blocks an explicitly named file; `/read` always works | — |
| OpenHands | **never blocks** — classifies risk and at worst asks; reading is LOW risk | confirm threshold |
| Claude Code | **no built-in credential deny list** — *"only the files and variables you list are restricted"* | deny/ask rules |
| Codex CLI | no `.env` handling; the sandbox bounds writes and network, not names | approval policy |

**Three findings decided it.**

1. **Name-based blocking is being abandoned, and the maintainers say why.** Cline is removing its
   ignore file *"to avoid creating a false sense of security"*, and says the plugin that replaces it
   *"should not be treated as a security boundary"*. Cursor: *"complete protection isn't guaranteed
   due to LLM unpredictability."* Kilo's block **failed in the field** — a `.env.local` read went
   through anyway. **And Plato has this exact history: `cat keystore.properties` ran (D49ai).** A
   name check is a claim about protection that the shell walks around.
2. **It is annoying in a documented way.** Continue had to relax patterns that were blocking
   legitimate files called `tokens.py` and `credentials.go`. Roo users complained that files they
   wanted were unreachable and could not even be mentioned. Aider nags about `.env` at every start.
3. **Not one product detects a secret VALUE.** Every mechanism above guards a name, so the founder's
   pasted-key case is guarded by nobody, and the published guidance for that threat is enforcement at
   the **sink**, not a name check. The one prior art worth copying is **Claude Code's sandbox `mask`
   mode**: the command is shown a placeholder and the real value is substituted only on the way out
   to an allowed host. The tool keeps working, the secret never enters the model's hands, and the
   user is not interrupted at all.

**The decision — the read is allowed and the value is never handed over.**

1. **Reading a protected file is ALLOWED.** A text config file comes back **masked**: every value is
   replaced by a placeholder, and the keys, line structure and comments survive. The model learns
   what configuration exists without ever holding a secret.
2. **The placeholder is `«masked:NAME»`.** It names its own key, so the real value can be restored
   per key, and it is detectable — which is what makes the sink check possible without knowing the
   value.
3. **Masking FAILS CLOSED.** If a protected file yields no maskable value — a keystore, a private
   key, a binary, a one-line blob — the read is **refused**, with a reason and an alternative. A
   masking step that silently returns the original text is worse than the refusal it replaced.
   **And a COMMENTED-OUT value is still a value**: `# API_KEY=sk-live-…` is what people leave
   behind when they comment a key out to test something, so a masker that passes comment lines
   through hands over the key while the file still reads as protected. The first version did
   exactly that and passed every test in its own file — the trap was found by asking what the
   comment branch does, which is the reason that branch now has a test.
4. **Every tool result is scrubbed** through the run's secret map before it reaches the model, so a
   value that arrives by another route (a `shell` command's output, a file copied somewhere else)
   comes back as its placeholder. The model cannot read a secret back out of a place it moved it to.
5. **A write un-masks.** A write whose content carries a placeholder has the real value restored
   before it lands, and a diff is applied against the MASKED view of the file so that untouched
   secrets survive. **This is not optional and it is not a follow-up:** masking a read without
   restoring the write turns an ordinary "add one key" edit into the destruction of every secret in
   the file. The two halves ship together.
6. **No new approval card for reading.** With the value withheld there is nothing to approve — the
   interruption was the cost and it is now unnecessary. Every *sink* already has a gate in the modes
   that have gates: a write asks in `edit`, a command asks in `edit`, egress asks in `edit` and
   always in `auto`. `plan` writes nothing at all.
7. **The protected list becomes the owner's** — the built-in defaults stay, a user may add their own
   names and take a default off, and the list is visible in Settings rather than only in source.
   This is the escape the refusal never had.

**What is deliberately NOT built.** Value **shape** detection (a pasted key that "looks like" a
key) is out of scope: it needs a model or a regex zoo, it is wrong in both directions, and the
pasted-key case it would cover is **already allowed and already harmless** — the user put it there.
The **taint/IFC** literature (provenance labels enforced at the sink) is where this design points,
but labels that survive arbitrary text in a prompt are research, not a feature; masking the value
sidesteps the whole problem by never giving the model the value to move.

**Recorded limits.** A command can read a file indirectly (`tar`, a recursive grep, a script), and
the scrub only knows values it has seen, so the shell path is **best effort** — the same limit D49ai
already records. **The sharper form, found while reviewing this decision: in `auto`, where `shell`
runs unasked, `cat *.properties` prints a protected file that was never read through `read_file`,
so its value is not in the map and nothing hides it.** Pre-existing rather than a regression (the old
name check could not see `*.properties` either), and closable by seeding the map from the workspace
at run start — see HANDOFF → "Open work". **And even that does not close the case outside the
workspace:** `cat ~/.aws/credentials` names nothing Plato can pre-read, and containment deliberately
does not cover `shell`, so **`auto` plus arbitrary commands stays best-effort for anything outside
the project.** Masking hides values, not the *existence* of a file or its key names.

**Three things this decision does NOT settle, each recorded with its reason in HANDOFF → "Open
work" so they are not re-derived:** the **in-panel Settings section** the owner's list is owed under
D45c, and the shape it should take (names are patterns, exceptions are **exact paths and never
wildcards**, because a wildcard exception unprotects silently); a **card for the file Plato cannot
mask, split by cause** — opaque (a keystore) stays a refusal, text the masker could not read becomes
a session-scoped card; and **seeding the secret map from the workspace at run start**, which closes
the indirect-read class above. **ALL THREE ARE BUILT — see D49bc immediately below**, which also
records the two places the building changed the design: the card's cost is its own field, and the
seeded map accepts a placeholder the model never read.

**D49bc — the three things D49bb left open are BUILT: the owner's panel, the card for a file Plato
cannot mask, and the secret map seeded at run start (founder, 2026-09-28).**

D49bb named three open items and left each with its shape recorded but unbuilt. The founder's
instruction was *"build all 3 recommendations and let's close this for good"*, so this entry records
what was built, what was deliberately not, and what the build measured. **Every item was reshaped by
building it** — the two that changed most are the card's copy and the seeding's notice, and both
changes came from writing the thing rather than from thinking about it.

**1. The card for a file Plato cannot mask — split by CAUSE, not by file.**

D49bb left this as one case: *"Plato cannot mask this file"*, answered with a refusal and a pointer
to `plato.secrets.allow`. Building it made the split obvious, and the split is the whole decision:

- **Opaque content — a `.jks`, a `.p12`, a keystore: stays a refusal, and no card is drawn.**
  Showing it is useless *and* the whole content is the secret, so a card would offer a bad deal
  behind a reasonable-looking button. This is the "false sense of security" Cline removed its ignore
  file over, and a card is exactly how it comes back.
- **Text the masker cannot parse — a JSON blob on one line, an INI with sections: a CARD.**
  *"Show this protected file in full?"* The only reason for the refusal is the masker's own limits,
  the content is plausibly useful, and the alternative is the dead end the founder objected to.

**Plato tells them apart with a UTF-8 decode**, so the split is deterministic: no model, no guess, no
regex zoo. `isPlainText` decodes with `fatal: true` — a *lossy* decode turns every bad byte into
U+FFFD and would call a `.jks` text, which is why this is a decode and not a search for the
replacement character. A NUL byte is rejected too: UTF-8 permits one, no config file Plato masks
holds one, and binaries are full of them.

**The card's copy is the decision, not the dressing.** Three things had to be on it, and one of them
is why the card exists at all:

- **The cost, as its own field.** *"If you show it, every value in this file goes into this
  conversation. Plato cannot hide the values afterwards."* It is a **separate field in `RevealCard`**
  rather than one row among the prose, so the view can give it weight **and so a reordering of the
  wording cannot silently move the emphasis off it.** A security prompt that reveals its cost after
  the click is the dishonest kind.
- **The way out, named.** *"To allow this file in every session, add it to the plato.secrets.allow
  setting."* Nobody should click yes for want of a setting they were never told about.
- **Two buttons and no third.** There is deliberately no "always" button: the permanent answer is a
  setting the user can read and change in the panel, not a security decision taken once inside a
  dialog. That is also why the panel section (item 2) had to ship with it.

**The card is raised in EVERY mode, including `auto`.** `auto` means "no card for every write", not
"no question may ever be asked" — the precedent is D49aw's stuck card, which `auto` also raises. The
alternative here is a refusal with no way through, which is precisely what the founder rejected. The
answer is remembered **per file, for the session**, so the second read of the same file never asks
again; that is the difference between a question and a nuisance, and the field case asserts the count
is exactly one.

**A file the user shows is not a file Plato unmasked.** Nothing remembers its values — a blob the
masker could not parse cannot be enumerated, and guessing at its values is the one thing that would
put a secret in the map the masker refused. **So the revealed file's values are outside the scrub for
the session, and that is a recorded limit, not an oversight.** The notice appended to the file says
the one rule that keeps them in place: *do not write a value from this file into another file.*

**2. Seeding the secret map at run start — D49bb's largest hole, closed for the class.**

`cat *.properties` in `auto` is the whole problem in one line. The scrub hides a value the session
has **seen**; a command reaches a protected file **indirectly**; and the name check cannot see it
either, because the token scan splits on `*`. `seedVault` reads the workspace's protected text files
through the **same masker** at run start and registers their values, so from then on any tool result
carrying one of them comes back as its placeholder whatever route it took. It closes the **class**
rather than the example.

**The cost was weighed and recorded, because it is real: Plato reads the user's secrets into memory
at every run start.** Never to disk, never to a model, and the map dies with the session — the same
containment the vault already had. A file the masker cannot account for is skipped rather than
guessed at, so seeding cannot put a value in the map that masking would have refused.

**A limit this does NOT close, stated rather than implied: `cat ~/.aws/credentials`.** That file is
outside the workspace, so Plato cannot pre-read it, and containment deliberately does not cover
`shell`. **`auto` plus arbitrary commands stays best-effort for anything outside the project.**

**One interaction worth naming, because it is a cost of seeding.** The vault now knows values from
files the model never read, and `materialise` accepts any placeholder the vault knows — so a model
that has read a protected file masked can write its placeholder into another file and have the real
value written there, without ever seeing it. **This is not new: it already worked that way the moment
a file was read, and seeding widens which values it applies to, not the class.** It is the sink rule
HANDOFF → "Open work" item 1 records as deliberately unbuilt, and it is not fixed here.

**3. The owner's panel — the list is theirs, and the asymmetry is the security property.**

`plato.secrets.protect` and `plato.secrets.allow` shipped in D49bb, and D45c obliges every knob to be
discoverable in the panel. The section was settled in discussion and built as settled:

- **Rows, not CSV.** A comma is a storage format leaking into a UI: a filename can contain one, and a
  list cannot be read at a glance. Each row carries its own Remove.
- **Two lists that must not look alike, because they are different kinds of thing.** *Protected names*
  match the file's **last path segment** anywhere in the project and allow `*` at the start or the
  end. *Allowed files* are **exact workspace-relative paths and take no wildcards at all.** **The
  asymmetry is the security property:** a wildcard exception (`allow *.env`) would silently unprotect
  everything matching it and nothing on screen would say so, while an exact path is a decision the
  user can see. Each list's help text says so in the user's own terms.
- **The built-in names are shown and cannot be removed.** They appear, so the user can see what is
  protected without reading a document, and they carry a `built in` tag where the Remove button would
  be — **a row that is deliberately locked must say so, or it reads as broken.** Removing `.env`
  everywhere is a silent hole, so it stays awkward on purpose: a project that keeps no secrets in
  `.env` lists its `.env` paths instead.
- **An entry that could never match is REFUSED, with the reason.** `isSecretPath` compares the last
  path segment, so `app/config/*.jks` would protect nothing and nothing on screen would say so.
  `protectNameError` and `allowPathError` live in core beside the matcher, which is the only place
  that can say what a name must look like.
- **The store stays VS Code settings**, written at Global scope the way the composer writes
  `plato.model`. The panel and a hand-edited `settings.json` cannot disagree, and a workspace override
  still wins for anyone who wants one.

**What was deliberately NOT built.** No third button on the reveal card (above). No wildcard on the
allow list (above). **No toggle for seeding**: it is on whenever a vault exists, so there is no state
where the map is half-filled and the user cannot tell which. And no "remember this file forever" in
the card — that is the setting, and the setting is in the panel where it can be read.

**Verified by building it, and the falsifications are the record.** `isPlainText` forced to `true`
fails the two split tests; `seedVault`'s `remember` removed fails three (two in core, one through the
loop); every unmaskable file treated as opaque fails four. **Each was reverted and re-run green.**
Field cases 22 and 23 witness the two halves against real VS Code: the card drawn exactly once in
`auto` and stating its cost, and `cat .en*` printing no value because the map was seeded. **Clause 3
of D49at was RESTATED** — see the clause table below — because "a protected file's values never reach
a model" stopped being true by design the moment the card existed.

**Two defects in the VERIFICATION were found by falsifying it, and both are the same species as the
things they check.** Falsifying case 22 (the shell's reveal answer forced to `false`) failed the case
for the right reason — and showed that **the transcript rule would have passed anyway**: it asked for
a `read_file` at phase `done`, and a read the EXECUTOR refused also ends at phase `done`, so only
`ok` separates a call that worked from one that failed. `analyse` now carries `doneFor(tool)`, and
cases 1, 21, 22 and 23 use it. **Second:** case 22's "no card was drawn" note was written with a
`REVEAL:` prefix that was **not in the fatal-prefix list**, so a run in which no card appeared at all
would still have PASSED — the identical defect `scripts/field/README.md` already records for the
stuck cases ("a note is not a check"), made again one decision later. `REVEAL` is fatal now, and
falsifying the seeding proves the case's teeth: with `seedVault` disabled, case 23 fails with
`SECRET: the real value reached the model` and prints the value it saw.

**Files:** `packages/core/src/security/mask.ts` (`isPlainText`), `packages/core/src/runtime/seedVault.ts`
(new), `packages/core/src/runtime/secretCopy.ts` (`revealCard`, `revealedFileNotice`,
`declinedRevealRefusal`), `packages/core/src/security/secrets.ts` (`protectNameError`,
`allowPathError`), `packages/core/src/tools/execute.ts` (`secretBase`), `packages/core/src/tools/files.ts`
(`includeSecret`), `packages/core/src/runtime/loop.ts` (the seed, and the `revealProtected` seam),
`packages/vscode/src/extension.ts`, `packages/vscode/src/webview.ts`. **Tests:**
`packages/core/test/secretReveal.test.ts` (17), two in `packages/core/test/loop.test.ts`.
**Render:** `scripts/render/reveal.mjs`, `scripts/render/secrets.mjs`. **Field:** cases 22 and 23.

---

**D49bd — a question's tab is NAMED by the model, not numbered (founder, 2026-10-01).**

The founder's ask: *"for questions in plato, we have tabs, but tabs are numbered (which I guess serve
not particular purpose) can we replace numbers with properly 1,2 word titles on tabs?"* **The numbers
did serve two purposes** — they mark the position in the set and carry the answered state — but he is
right that they are a weak *name*, and D49aj's own argument is what makes renaming the tab the
completion of it: the strip exists so the user can tell the questions apart, and a digit never did
that. **This entry supersedes the LABELS of D49aj; the strip, its three states and `← Back` are
unchanged.**

**The label comes from the MODEL, and that is the decision.** Every question already carries
`question`, `context`, `options` and `recommended`; it gains one optional `header`. The alternative —
deriving a title from the question text — was rejected on evidence, not taste: trimming *"Should
behaviour that affects public method contracts change?"* yields *"Should behaviour"*, which is a
fragment that is **neither a position nor a name**, and it repeats the heading printed directly
underneath it. A number at least says where you are. **Only a name beats a number here, and only the
model can write one.** The header names the **decision**, not the topic — `Contract`, `Test runner`,
`Cleanup` — so a strip reads as the set of things being decided.

**The field is optional, and the number is the fallback.** A question that arrives without a header
keeps its number, in the schema (not `required`), in core (a blank becomes `undefined`) and in the
view (an absent or blank label falls back). **Three layers, because each is falsifiable on its own**
and because the field can then only ever improve a card — the property that makes adding a field to a
tool contract safe. **The prompt asks for it and the schema bounds it** (`maxLength: 12`, and the
description says one or two words): a constraint the prompt never mentions is one the model will
cross, which is the rule D49am already set for this declaration.

**The label never enters the transcript.** The answer still comes back as the **full question** — the
`Q2: <question>` the model reads, and the `You: <question>: <answer>` the user sees are both
unchanged — so the header is **UI-only**: it costs no tokens and cannot confuse the model about what
it asked.

**CSS: the strip wraps, and the first guard I wrote for it was wrong.** Named pills are much wider
than digits; four of them overflow a narrow panel. `flex-wrap: wrap` fixes that, and the field case
below measures it. **I also added `flex-shrink: 0`, and falsifying it changed nothing** — every
assertion stayed green. Reasoning about flexbox says why: with wrapping on, a line is broken using
each item's **full** width and shrinking only applies within a line, so at any width the tabs wrap
before they squeeze. **In the one case the guard did affect — a single label wider than the whole
strip — it would clip the label instead of letting it wrap, which is worse than not having it.** So
it was removed. **This is D49ap running in the other direction: a guard I could not falsify was a
guard I could not justify, and reading the spec afterwards is what turned "harmless" into "harmful".**

**Verified by falsification — eight reverts, each re-run green afterwards. Seven proved the
assertions have teeth; the eighth proved a guard had none.** The view made to ignore
the header fails four assertions (the name, the answered tab's name, the blank fallback, and the
narrow wrap, because four digits fit where four names do not); `flex-wrap` removed fails two, and
prints the last tab **88px past the card's edge**; core dropping the header fails one; core passing a
blank through fails one; `maxLength` removed fails one; the prompt sentence removed fails one; and the
view's number fallback removed fails three, printing the nameless tab as `""`. **One self-inflicted
error is worth recording because the file warns about it and I did it anyway:** the CSS comment was
first written with backticks, and `webview.ts` is **one template literal**, so it closed the template
and failed the build — the exact trap the comment at the top of `showUserQuestion` names.

**Files:** `packages/core/src/tools/schemas.ts` (the `header` property and the prompt line),
`packages/core/src/runtime/loop.ts` (the passthrough, and `header?` on `LoopOptions.askUser`),
`packages/vscode/src/extension.ts` (the shell's type), `packages/vscode/src/webview.ts` (`tabLabel`,
and `.q-tabs`). **Tests:** one in `packages/core/test/loop.test.ts`, one in
`packages/core/test/modes.test.ts`. **Render:** the `question` suite, one new block of ten
assertions. **Field: no new case** — a tab is not a card kind, so nothing in the driver changes; the
existing question cases re-prove the card in a real window.

---

**D49be — the secret check reads the command the way bash reads it (founder, 2026-10-06).**

The recorded defect, closed: **`cat key'store'.properties` was refused by nothing.** The deny-list
check matched whole strings and, for a command, split the text on every character a filename cannot
contain — and a single quote is one of those. So the command became the four harmless tokens `key`,
`store`, `properties`, while **bash concatenates adjacent quoted and unquoted runs into one word**
and opens `keystore.properties`. The guard was reading a different command from the one that ran.

**The fix was already written and unexported.** D49aq built a tokenizer that models bash's quoting
faithfully (`readOnlyShell.ts`) for the read-only-shell allowance; it returns the UNQUOTED tokens and
answers `null` for anything it will not model. The secret check now runs the command through it
first. **One tokenizer, so the two readers cannot disagree about what bash will open** — which is the
whole point, and the reason this was worth doing as a shared call rather than a second quoter written
beside the first.

**The two scans are UNIONED, never swapped.** The tokenizer refuses a command containing a backslash,
a newline or an unbalanced quote; the text scan from D49ai still runs afterwards, so the check
**cannot start catching less than it did before**. That the union matters is itself tested: a command
the tokenizer refuses still has its plainly-written name caught by the text scan.

**What this does NOT close, stated rather than implied:** a splice the tokenizer refuses to model — a
backslash (`cat keystore\\properties`) — is left to the text scan, which cannot see it. The check is
still **best effort, as D49ai recorded it**, and the guard that actually holds for a masked file is
the value scrub, not this name check. This decision removes the quoted case, which was the one a
model would reach by accident; it does not claim the check is now a guarantee.

**Verified by falsification, re-run green after:** removing the tokenizer pass fails the quoted-splice
test and nothing else — the other nine assertions in the file still pass, which is what proves the
tokenizer is exactly what catches the splice and not incidental cover.

**Files:** `packages/core/src/security/secrets.ts` (`mentionsSecretPath`, now unioned),
`packages/core/src/security/readOnlyShell.ts` (`tokenize` exported). **Tests:**
`mentionsSecretPath` — a new `describe` of five assertions in `packages/core/test/secrets.test.ts`.
**Field:** case 1 gains a third run whose command is `cat .en'v.production'` — falsified by removing
the tokenizer pass, which prints the hole in the failure message (`cat .env.production: No such file
or directory` reaching the model). The file does not exist in the field page, so a regression opens
nothing.

---

**D49bf — the model's context window comes from the CONNECTION, and the shipped catalog stops
claiming one (founder, 2026-10-06).**

Two changes in one decision, because the second is what the first is worth.

**1. The table is gone.** `MODEL_CATALOG` carried a context window for each model Plato knew by name,
and `resolveMaxContext` took the SMALLER of that and the number the connection advertised. The
founder's judgement: *"it would be misleading or error prone to keep an internal table. let the
plato discover model context from what model advertises."* A shipped window is **a claim about a
machine Plato is not talking to**: it rots the moment a name is re-released under a different limit,
it cannot describe a self-hosted route capped to fit a GPU, and it is precisely the number that
decides when a long session is folded away. The connection is the only party that knows what it will
accept. **`resolveMaxContext(advertised?)` now returns the advertised number or `null`, and the
catalog field is deleted** — not merely ignored, so it cannot creep back, which a test enforces.

**2. The assumption for "nothing knows" is 128k, raised from 8,192.** The old floor was chosen to be
safe for any model, and the price was paid on every run against an endpoint whose `/models` did not
answer — the defect HANDOFF carried: **Plato folded a good session at about 6,500 tokens.** 128k is
the modal window for the models people actually run now.

**The trade, recorded rather than glossed, because it is real and it runs the other way.**
8,192 could not be exceeded; **128k can**. A model that advertises nothing and truly holds less than
128k now gets sent more than it accepts. **That is a 400 the user sees, not a silent truncation** —
the guess is client-side and the provider is the one that refuses — and the repair is visible and
local: refresh the model list so the connection's own number is used. The founder took that error
over folding good work early.

**Where the two facts live, since they are not the same fact.** "We do not know the window" stays
`null` and the UI keeps saying **"ctx unknown"** — printing an assumption as a fact is the
misleading-ness this decision is against. "What to assume when folding" is a separate number with a
separate home, `DEFAULT_CONTEXT_WINDOW` in `runtime/context.ts`. **The catalog keeps `maxOutput` and
the prices**, and the asymmetry is deliberate: a too-high output request is a hard 400, a wrong
window only changes when Plato folds. One is a mistake; the other is a preference, and only the
first is worth shipping a table for.

**Verified by falsification — two reverts for this decision, each re-run green afterwards.** The
default put back to 8,192 fails two tests: the unit one that pins the trip points, and a new loop
test whose whole subject is that the *old* trip point no longer folds (about 5,000 tokens, which used
to compact and now does not). A window added back to a catalog entry fails the test that inverts
D37's own rule — that rule required a non-null window on every entry, and it is now required to
carry none.

**Files:** `packages/core/src/providers/registry.ts` (`ModelEntry`, `MODEL_CATALOG`,
`resolveMaxContext`; `maxContextFor` deleted), `packages/core/src/runtime/context.ts`
(`DEFAULT_CONTEXT_WINDOW`), `packages/core/src/runtime/loop.ts` and `packages/vscode/src/extension.ts`
(three call sites). **Tests:** `providers.test.ts` (the D37 rule inverted, the resolver block
rewritten), `context.test.ts`, `loop.test.ts` (one new wiring test, one new regression test).

---

**D49bl — the commands button draws a forward slash in a key cap, and the button now has coverage
(founder, 2026-10-07).**

**The founder's report, in two halves:** *"the commands button in plato shows backslash; I think it
should be /"* — and, *"since it is just a simple line it could be visually difficult to recognize; can
we choose an / with a square outline on button or something."* Both halves were right, and the first
was a defect no check in this repository could see.

**The defect, stated geometrically because that is what makes it invisible.** The icon was one SVG
line from `(8,5)` to `(16,19)`. **In screen coordinates y runs DOWNWARD**, so that line starts at the
upper left and ends at the lower right — which is a **backslash**: the one glyph that means the
opposite of what the button does. Every artifact around it was valid. The markup parsed, the button
worked, the tooltip said *Commands*, and a diagonal line is a diagonal line to every assertion that is
not about **direction**. **So the assertions written for it are about direction**, and they test the
property rather than the numbers: read both endpoints, find the one with the smaller `y` (the higher
end), and require it to be the one with the larger `x`. A forward slash leans that way and a backslash
does not, so the check survives a redraw with other numbers, reordered endpoints, or a rewrite in a
path — none of which a `x1 === 15` assertion would. A companion assertion requires the line to
actually lean, so a horizontal or vertical stroke cannot satisfy the reading by accident.

**The second half is a legibility decision, and it was made by looking rather than by reasoning.**
A lone diagonal reads as a stray stroke; **a slash inside a rounded square reads as a KEY**, which is
what the affordance is — a control that types `/`. So the icon is now a rounded rect with the slash
inside it, and the slash **centred** in the box (asserted against the box's midpoint, because a keycap
glyph jammed into a corner is the kind of thing nobody writes a test for and everybody sees).

**Two numbers were settled by rendering the alternatives and comparing them**, which is recorded
because the reasoning is not obvious from the values: the icon is **16px where the paperclip beside it
is 14**, because **a box is mostly empty space and measures lighter than a solid glyph at the same
size** — at an equal 14 it read as the fainter of the two controls, which is the opposite of what the
report asked for. And the slash **fills the box** (12 of the 16 inner units): the first attempt drew
it 11 long and it looked lost in the middle, so the assertion pins a minimum rather than an exact
length. The corner radius stays **4**, matching the button's own `border-radius` and the rounding of
the icons around it.

**The coverage gap this exposed is the more durable half of the entry: the commands button had NO
render coverage at all** — not the glyph, not the click. So the new suite also asserts the two ways a
cosmetic icon swap stops being cosmetic: the accessible name and tooltip still say what the button
opens, and **clicking it opens the command menu with rows in it, and clicking again closes it**.
Those are new assertions about behaviour that was never checked.

**Fields, and the one that is deliberately NOT asserted.** Assertions cover direction, the box, the
centring, the fill, the rendered size against both a floor and the button's own box, the accessible
name, and the open/close click. **Nothing asserts the icon's COLOUR**, because it is `currentColor`
inheriting `--pl-muted` like every other control in the bar — a theme property with one home, where a
second assertion would pin the theme rather than the icon. It was checked by eye in both grounds
before shipping; it is not claimed to be tested.

**Verified.** `tsc -b --force` clean; **825 unit tests** unchanged; render now **22 suites / 614
assertions** (+19 in the new `commands button` suite); bundle, extract-inline and `node --check` pass,
and the new geometry is confirmed present in the built bundle. **Eight falsifications, each reverted
and re-run green:** restoring the original backslash fails the direction assertion — **the suite fails
on the exact defect reported**; removing the box fails six; moving the slash off-centre fails one;
shortening it fails the fill assertion; drawing the icon at 13px fails the paperclip comparison and at
8px fails the legibility floor; emptying `aria-label` fails the accessible-name check; and breaking
the open and the close each fails its own assertion. **The field acceptance suite was NOT re-run, on
the handoff's own rule** — it is for changes touching the mode gates, refusals, cards, session memory,
plan note, transcript or egress, and an icon inside a button is none of those; the field driver also
never touches this control, which was checked rather than assumed.

**Files:** `packages/vscode/src/webview.ts` (the `#cmds` icon), `scripts/render/cmdbutton.mjs` (new
suite), `scripts/render/run.mjs` (registered), `scripts/render/plib.mjs` (`SLASH_META_MSG`),
`scripts/render/README.md` (the suite documented).

**One process failure, recorded because it cost the founder a round trip and is not visible in any
artifact.** The change was made and verified and reported as done — and **the founder reloaded and
still saw the backslash**, because the VSIX had never been packaged or installed. **The reasoning
error is the part worth keeping: the field acceptance suite is conditional and installation is not,
and a decision about the first was allowed to stand in for the second.** The render suite proves a
change is *correct*; `pnpm run package` → `pnpm run install:vsix` → reload is what makes it *exist for
him*. The packaged VSIX was afterwards unpacked and read back to confirm the new geometry is inside
it, so what he reloaded into is known rather than assumed.

---

**D49bm — pause says what is true, and the run record says it too (founder, 2026-10-07).**

**The founder's audit question was "do they really mean what they claim", and for Pause the answer was
no.** `pause()` set a flag that the loop looks at in **exactly two places** — before a turn and before
each tool call — while the button flipped its own label to *Resume* **on the click**. So between the
click and the next safe point the control claimed the run had stopped while only a REQUEST had been
recorded; and when a turn returned no tool calls the run ended without ever reaching a gate, so the
pause was claimed and never happened. **It also left no record anywhere** — not the chat, not the
transcript — so afterwards a run that was paused could not be told from one that was not. And **no
field case had ever clicked it**: the controller was unit-tested in isolation, and the wiring from
button to loop lives in the shell, which has no unit tests at all.

**The design follows from one fact: only `gate()` knows the run has stopped.** So `RunController`
gained an optional `onPark?: (parked: boolean) => void`, fired from `gate()` — and the three rules in
that body are each a bug avoided rather than a style choice:

- **Edge-triggered.** `false` fires only when a park actually happened, or every ordinary gate would
  report a resume that never occurred. Pinned by a test that an idle gate announces nothing.
- **`true` fires on ENTERING the wait**, not before it, so a resume-then-pause inside one wait cannot
  leave the outside believing the run was never parked.
- **The callback is isolated with a `try`/`catch`, exactly as `AgentBus.emit` is.** Without it a throw
  from the UI callback propagates out of the `await` and **kills the run** — the controller has to be
  as hard to break as the bus it reports to. A test asserts a throwing listener does not reject
  `gate()`, and the falsification removes the guard and watches it fail.

**The UI is three states derived from two different facts**, and the distinction is the whole point:
`pauseWanted` is what the user asked for and is known in the view at once; `pauseParked` is what the
RUN is doing and is only ever set by the host. The label is `Pause` → `Pausing…` → `Resume`, the click
on `Pausing…` takes the request back, and the status line says `Paused` while the run is genuinely
stopped — because it previously said *writing* while the run sat still, which is the same claim in a
second place. Both flags clear together on a click, so a second click cannot arrive while the first
round trip is out and re-pause a run the user just released.

**The pause that never lands is named rather than swallowed.** In the run's `finally`, if a pause was
requested, never parked, and the run was not cancelled, one notice goes out: *"The run finished before
the pause took effect."* Cancel already narrates itself, so it is not doubled.

**Two defects were found by building this, both in the same window — the seconds between the view
showing its buttons and the host reaching `running = true`.** The view's controls appear the instant
`ask` is posted, but the host reads the key, fills the model pool and starts MCP servers first, and
that last step can take twenty seconds. **A pause clicked in that window was dropped in silence**, and
so was a cancel — which is worse, because losing a cancel means Plato starts the run the user just
asked it to stop. Both are now held (`pendingPause`, `pendingCancel`) and applied when the run exists;
a pending cancel means the run never starts, and says so.

**Proving it found a third defect that no render suite could have seen.** The host's `send()` builds
`{type, text, …meta}`, so `send('pause-state', {parked})` arrives as `m.text.parked` — while the view
read `m.parked`. The render suite passed because it *fakes* the host and posted the shape the view
expected; the field case is what caught it, through the label never leaving `Pausing…` while the run
sat still. **The render suite now posts the host's real shape**, so the fake cannot agree with a view
that is wrong about its host.

**Fields, verified.** Field case **24** clicks Pause on a run the stub holds open with a new
`delayMs` (without it the scripted run is over in microseconds and there is no window to click in),
asserts the label is `Pausing…` and **not** `Resume`, waits for the park, asserts `Resume` and the
`paused` row, then releases and asserts the run finishes. Case **25** asks to pause during the final
answer and asserts the run completed **and** the record carries the too-late notice and does **not**
claim a park. Real-model case **31** accepts either honest outcome and asserts only that the record
accounts for the request one way or the other — **the silence is what fails.**

**Known limit, recorded rather than hidden:** a pause still cannot stop a model call already in
flight. The fix is honesty, not new power. The pre-run window is covered by the held flags and
exercised opportunistically by case 24; making it deterministic would need test-only machinery in the
host's startup path, which was judged not worth it.

> **CORRECTED (2026-10-07, hours later, by the queue's own bug — see the amendment to D49bo).** Two
> things in the paragraph above did not survive the day. **The held flags covered Pause and Cancel and
> NOT the queue**, which reached the same window: a `/queue` typed there started a second run
> alongside the one still being prepared, found by real-model case 30 failing once in ten. So "the
> pre-run window is covered" was true of two controls and false as a statement about the window.
> **And it CAN be entered deterministically** — `modelsDelayMs` stalls the model-discovery call the
> host makes while preparing, and a solo `FIELD_CASES=26` run is the one whose model pool is stale, so
> the stall applies. The judgement that it "was judged not worth it" was made before knowing where the
> window was reachable from.

**Falsifications, each reverted and re-run green:** removing the isolation guard fails the throwing
listener test; removing the edge guard fails both "announces nothing" tests; restoring the
label-flips-on-click behaviour fails three render assertions **including the one written for exactly
that defect**; and dropping the `parked` payload shape fails the field case.

---

**D49bn — closing the chat panel stops the run (founder, 2026-10-07).**

**The gap, in the founder's own framing of the controls: the panel IS the run's supervisor.** The
buttons, the cards and the log all live in it — and closing it did nothing to the run. `onDidDispose`
archived the chat and tore down the watchers and **never touched the controller**. The run kept calling
tools and writing files with no UI, no Pause, no Cancel, and **no timeout on a parked card**, so the
first write in `edit` parked forever on a card nobody could answer. In `auto` there are no cards at
all, so nothing would even ask. **The founder chose "stop the run" over "keep it running in the
background", and the reasoning is that nothing in the code ever claimed a run survives the tab.**

`dispose()` now sets `disposed` first, then releases parked cards and cancels when a run is active,
then **awaits the run promise before archiving** — the cancelled run pushes its last rows and closes
its writer on the way out, so archiving first would persist a log that was about to change. A run
still being prepared has no controller to cancel, so `run()` checks `disposed` itself once it exists.

**The record of WHY is written by the run, in its `finally`, and that placement is load-bearing.** A
run still being prepared has no bus yet, and a bus notice emitted before the first `run-started` is
**dropped for having no file to land in** — which is exactly the silence this entry is about. Writing
it from `dispose()` would have produced a notice that vanishes in the case that needs it most.

**Field case 28 closes the real tab and asserts the run ended cancelled with the panel-close notice in
the record.** Building it found the sharpest defect of the three: **`dispose()` never reached its
`cancel()`**, because `releaseParkedCards()` posts to a webview that is already gone and the throw
abandoned the teardown half-done. The symptom was a transcript carrying the panel-close notice **next
to** `run-completed {reason: 'complete'}` — the run said its supervisor had closed and then reported
finishing normally. `send()` now survives a disposed panel, and the falsification rethrows and watches
case 28 fail on exactly that.

**THE HARNESS LIMIT, stated because the case's coverage is not what it looks like.** Case 28 asserts
from the **run record only**. The harness cannot step back inside a webview panel it has closed — a
new one is created but its iframe is never found — so the on-screen half is not checked, and the spec
skips the screen read for that one case by name rather than quietly. The record is the right witness
anyway: the same bus notice is what writes the chat row, so the transcript proves the row was written
even though this case cannot look at the panel it was written in. **Case 28 must stay LAST** — it
leaves the driver outside a frame it cannot re-enter.

> **RENUMBERED (2026-10-08, see D49bp).** This case is now **case 29**. A new case had to run *before*
> it — a cut provider stream — and the cut case took 28 so the numbers stay in run order around the one
> case that must run last. The claim above is unchanged; only its number moved.
>
> **RENUMBERED AGAIN (2026-10-15, see D49bt).** It is now **case 32**. The MCP case needed a slot
> *before* it and took 29; 30 and 31 are the real-model cases, so rather than collide with them the
> panel-close case moved above them and still sorts last among the scripted cases. The claim is
> unchanged; only its number moved, and the rule it exists to protect — it must run last — still holds.

**Two harness routes were tried and both failed in a FULL-suite run while working in isolation**,
which is a shape worth recognising: `EditorView.closeEditor('Plato Chat')` left the panel open once
the earlier cases had crowded the tab bar and pushed it behind the overflow control, and the command
palette — `executeCommand('workbench.action.closeActiveEditor')` — never became visible at all that
late, timing out after five seconds. The tab's own close button is now clicked **in the workbench
DOM**, which needs neither the tab to be visible nor the palette to open.

---

**D49bo — `/queue`: a follow-up can be held for the next run (founder, 2026-10-07).**

**The founder's read was that steering already exists, and he was right — so `/steer` was not built.**
Typing while a run is active already posts guidance, which queues FIFO and is injected into the
model's next turn; a command for it would be a rename. **`/queue` is the genuinely missing thing**, and
the gap is that one channel carries two meanings: while a run is active Enter means *change this run*,
while idle it means *start a task*, and there is no way to say **"when you are done, do this next."** A
user who types a follow-up mid-run gets it injected into the current run, where the model may blend the
two or drop the first. Checked against the field before cutting: Claude Code ships exactly this with
three priorities — send now, after the current step, after the whole reply as a new turn — and Plato
had working equivalents of the first two and lacked the third.

**The advance rule lives in core, and it is narrower than the obvious rule.** `nextQueued(queue,
reason)` returns the head only for `complete` and `cap`. **"Not cancelled" was the first version and it
is not enough**: an **errored** run would burn the whole queue against a dead provider, one run at a
time, and a **stuck** run would drain it into the loop the model could not escape. A failure carries no
reason at all, so `null` holds too. The hold is sticky until the user asks for the queue to continue —
one cancel must not be quietly undone by the next run that happens to end cleanly.

**`/queue` is the first command that carries TEXT**, which needed a small piece of plumbing: the
webview kept only the command token. `leadingCmd` now yields the remainder, `runSlash(id, text)` posts
it, and the four older commands ignore the argument exactly as before. **The typed path and the
menu-picked path share one payload rule**, and that is not tidiness — typing `/queue fix the tests`
opens the command menu, so Enter runs the highlighted row, and an earlier version sent that row with an
empty payload: the message was dropped and the host answered with the usage note instead. **The field
driver found it before the field run existed**, by typing the way a person does. A bare `/queue` sends
nothing and the host states the usage rather than queueing the literal word.

**The queue is in memory only, deliberately.** A reload kills the run too, and a persisted non-empty
queue would either sit there forever or **start a run the moment the panel opened** — a run nobody
asked for. The chips reuse the attachment vocabulary in their **own row**, because an attachment is
consumed by the send while a queued message outlives runs, so one row could not serve both. Removal
posts the **index** and is not applied locally: the host is authoritative and a local edit that
disagreed with it would take out the wrong message.

**Verified.** Core: `nextQueued` over all five endings, and the park tests. Render: a new `queue` suite
(23 assertions) — the list is visible, numbered and removable, an empty queue shows no row, `Start`
appears only while held, removal posts the index and does not edit the view, a restored panel draws the
queue it is sent, and a long queue does not push the panel sideways. **Field case 26** queues mid-run
and asserts a second run started by itself carrying the queued task, with the stub's script covering
both runs because the harness sets the script once per run and the second run is started by the queue;
**case 27** cancels and asserts both messages are still waiting with a way to continue. **Real-model
case 30** does the same against a real model, and asserts the advance from the second transcript rather
than from the chip, because a real run can finish inside the round trip. **Acceptance clause 8** was
added for all of this: *"The run controls mean what they say."*

**Falsifications, each reverted and re-run green:** draining on cancel fails the hold test; making the
view edit the queue locally fails the render assertion; and dropping the payload rule fails the typed
`/queue` assertion in both the render suite and the field case.

**Known limit:** guidance typed during the model's final answer still reaches nobody **in that run** —
the row is recorded and the words carry into the next run's history. That is untouched here; `/queue`
is the answer for a deliberate follow-up.

> **AMENDED (2026-10-07, same day, after real-model case 30 failed once in ten runs).** The rule above
> was right and its GUARD WAS WRONG. `advanceQueue` — and the `run()` it starts — refused only when
> `this.running`, and **`running` is set at the END of a run's preparation**, after the key is read,
> the model pool filled and MCP servers started, a span that allows twenty seconds. So a `/queue`
> arriving in that window found `running` false, drained the queue, and started **a second run
> alongside the one still being prepared**. Two runs then shared one controller, one webview and one
> runs directory.
>
> **The diagnosis came from the evidence rather than from guessing, which is why the flake was worth
> leaving one diagnostic in place for.** The single failure reported the queued run's task as the
> FIRST prompt's — which is only possible if the queued run sorted EARLIER, which is only possible if
> it STARTED EARLIER. That, plus a run that took two minutes where the same case takes thirty-five
> seconds, is the whole mechanism. `runInFlight` now spans start-to-unwind, set in `startRun` and
> cleared in its promise's `finally` — **so it is cleared on every exit, including the eight guard
> clauses that return early from `run()`, which is why the queue's advance moved out of the body and
> into that chain.** `lastRunEnd` carries the ending out with it, because the advance can no longer
> see the local that held it.
>
> **This is the same window D49bm found for Pause and Cancel, and the queue was the case left
> uncovered** — which is the durable lesson: when a hazard is found in one control, the others that
> reach the same state need looking at in the same pass.
>
> **Proving it needed a way INTO the window, and the stub now has one.** `modelsDelayMs` stalls the
> provider's model-discovery call — which the host makes while preparing a run — turning a window
> milliseconds wide into a four-second one. A solo `FIELD_CASES=26 node scripts/field/run-field.mjs`
> walks into it on purpose, because that case's run is then the session's first and the model pool is
> stale, so the call is made at all. **Against the pre-fix source that run fails with the evidence
> printed: the queued run started at 17:56:51.449 and the first run's last write was 17:56:54.117 —
> 2.7 seconds of overlap.** With the fix it is green, and six further real-model runs pass at ~30s.
>
> **One assertion in the case was written, tested against the broken build, and DEMOTED for having no
> teeth.** It compared the two transcripts' header stamps, and passed against the defect: `startedAt`
> is written when a run REACHES THE WIRE, after its preparation, so two runs started into one window
> stamp in either order. **The check that catches it reads the two runs' OVERLAP** — the queued run's
> `startedAt` against the first transcript's own last-write time — and the chip assertion catches it
> too, because a queue that drains instantly never shows the chip. **A check that passes against the
> bug it was written for is worse than no check**, which is the same rule D49at learned about notes.

---

**D49bw — Phase 2 opens: the CLI is a first-class host, and Duo and Academy ship in v1 (founder, 2026-10-21).**

**The instruction.** The extension is live. The next release is a command-line version,
published on npm. The founder stated that professional users prefer a CLI. Therefore the CLI
must be a polished product, not an afterthought. This entry replaces the earlier "CLI is phase 2,
recorded only; do not start this work now" note in `docs/LICENSING.md`.

**Scope: the prime feature ships in v1.** The CLI v1 includes Solo, Duo, and Academy. A Solo-only
first release was considered and rejected: Duo and Academy are the product's differentiator, and a
CLI without them is a weaker product. The three modes (`plan`, `edit`, `auto`), approvals with
session memory, questions, the stuck card, the protected-file reveal card, masked reads, the secret
vault, undo, transcripts, MCP, images, streaming, and session resume are also in v1.

**One engine, two hosts.** `packages/cli` is a new host over `@applivity/plato-core`. It does not
fork the loop, the tools, the permission table, or the security checks. The loop's options are the
host contract: approve, get-mode, ask-user, stuck, reveal, provider, model, root, and task. A second
engine was rejected because it would fork the safety behaviour, and the security work is the part
that must not drift.

**Not in v1.** Editor diagnostics: a terminal has no language server. Subagents, hooks, skills, and
notebooks remain deferred under the existing decisions.

**Distribution.** The package is `@applivity/plato`; the command is `plato`. The unscoped names
`plato` and `plato-cli` are taken. The scoped name was verified available on 2026-10-20. The first
version is `0.1.0`. The CLI has its own version; it does not follow the extension's `0.26.x` line.
The release posture is the same as the extension: Apache-2.0, a private repository, and the licence
and notices inside the tarball. A public repository is not required. Provenance is not available
while the repository is private.

**Shared state.** Both hosts use `~/.plato`. Run transcripts, undo copies, `mcp.json`,
`DUO.yaml`, `ACADEMY.yaml`, and `PLATO.md` are shared. The project key is the same: the first 8 hex
characters of the SHA-1 of the workspace root. A run started in the extension is visible to the
CLI, and the reverse is true.

**Owner actions.** The founder controls the npm login, the first publish, and every push.

**Files:** `packages/cli/`, `packages/cli/package.json`, `packages/cli/PLAN.md`,
`docs/LICENSING.md` §8. **The phased plan with milestone exit criteria is
`packages/cli/PLAN.md`.**
**Verification:** unit tests for the host, a scripted-provider end-to-end run, a
real-model run on the proving-ground repo, and `npm pack` inspection before publish.

---

**D49bx — CLI keys: environment first, OS keychain second, a 0600 file last — never the config (founder, 2026-10-21).**

**The question.** The extension stores keys in VS Code SecretStorage. A CLI cannot use that store.
The founder asked what comparable tools do and what is standard in the industry. **He approved the
keychain on 2026-10-21 with one condition: setup must not be cumbersome.**

**What the six comparable tools do.**

| Product | Key sources, in order | Where a stored key lives |
|---|---|---|
| Claude Code | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`; `apiKeyHelper`; stored OAuth | macOS Keychain (`Claude Code-credentials`); fallback `~/.claude/.credentials.json` mode 0600. Linux and Windows use the 0600 file |
| opencode | environment; `auth.json` | `~/.local/share/opencode/auth.json` (XDG data dir), mode 0600, plaintext. The `opencode auth` group has `login`, `list`, and `logout` |
| Codex CLI | environment; stored login | `auth.json` mode 0600 under `CODEX_HOME`. The storage mode is `file`, `keyring`, `auto`, or `ephemeral`; `auto` prefers the OS keyring |
| Gemini CLI | `GEMINI_API_KEY` or `.env`; OAuth for Google accounts | OAuth tokens are cached under `~/.gemini/`. The settings file is not the key store |
| Aider | environment or `.env`; CLI flags | `.env` or the config file. The docs recommend `.env` and warn that the YAML file is often committed by accident |
| Goose | environment; system keyring; `secrets.yaml` | System keyring. `secrets.yaml` mode 0600 is the fallback. `GOOSE_DISABLE_KEYRING` forces the file for headless use |

**The pattern.** Every tool puts the environment first, because CI and containers use it. Every tool
that persists a key keeps it in a separate credential store, not in the main config. Most use the OS
keychain when one is available. All of them fall back to a 0600 file. Each has an `auth` command
group and a documented headless path.

**The decision.**

1. **Resolution order:** `PLATO_KEY_<CONNECTION_ID>` > the provider-standard variable for that
   connection kind (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) > the OS keychain entry (service
   `plato`, account `<connection-id>`) > `~/.local/share/plato/auth.json` with mode 0600.
   `PLATO_DATA_DIR` overrides the data directory. **A known preset uses its own vendor variable**
   (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, and so on), and a connection whose kind disagrees with its
   vendor name falls back to the variable for its kind. This keeps an OpenAI key from being sent to
   OpenRouter.
2. **No key in the config.** `~/.config/plato/config.json` holds connections, the default model, the
   mode, orchestration, and compaction. It never holds a key. `PLATO_CONFIG_DIR` overrides the
   config directory.
3. **Commands:** `plato auth login|status|logout|list`. `login` writes to the OS keychain by
   default. `--no-keyring`, or `PLATO_DISABLE_KEYRING=1`, writes the 0600 file and says so.
   `status` reports which source resolved the key and whether the file has mode 0600. It never
   prints the key.
4. **Keychain backend:** `@napi-rs/keyring` (2.1.2). It has prebuilt binaries for macOS, Linux, and
   Windows, and no compiler is needed. `keytar` was rejected because it is unmaintained.
5. **The environment trap stays closed.** The Anthropic SDK reads `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_AUTH_TOKEN` on its own. The CLI passes the endpoint and the token explicitly, as the
   extension does (D49u). Reading `ANTHROPIC_API_KEY` is deliberate. Letting an ambient
   `ANTHROPIC_BASE_URL` move a connection is not.
6. **Never on another path.** Keys do not enter logs, transcripts, error output, or the config. The
   transcript writer already uses a field whitelist.

**Setup must be one command.** The founder's condition is part of the decision. The normal flow is:

```
$ plato auth login
? Provider: Anthropic / OpenAI / OpenRouter / LiteLLM / Custom
? Connection name: litellm
? Base URL: http://localhost:4000/v1
? API key: ********
✓ Saved to the OS keychain.
```

`plato auth login anthropic` skips the provider question. For a standard provider, the flow is one
prompt: `plato auth login anthropic` asks for the key and nothing else. The provider and connection
name have defaults, and the base URL is asked only for a custom endpoint. The user never edits JSON,
never names a keychain service, and never handles a file path. Provider presets supply the wiring.
If no key is present on the first run, the CLI offers this flow once and names the command. `plato auth status`
prints one line per connection and its source (`keychain`, `env:NAME`, or `file`), never the key.
`plato auth logout <connection>` removes it. `plato doctor` checks the keychain, the config, and the
resolved source. **Headless:** `echo "$KEY" | plato auth login anthropic` reads the key from a pipe,
so a container never prompts and the key never appears in a shell history.

**When the keychain is not available.** The fallback is automatic and stated once. The user is not
asked to install anything. `--no-keyring` and `PLATO_DISABLE_KEYRING=1` are explicit choices, not
requirements. The keychain module is an optional dependency; if it fails to load, the CLI continues
with environment variables and the file. On Linux, the keyutils backend is not used for a saved key
because it does not survive a reboot. Secret Service is used when present, and the file when it is
not.

**Stated boundary.** A 0600 file is plaintext. Any process that runs as the user can read it. The
keychain raises the effort, but it does not protect a compromised account. `plato auth status` names
the source, so the user knows which protection is in use.

**Files (planned):** `packages/cli/src/keys.ts`, `packages/cli/src/auth.ts`,
`packages/cli/src/config.ts`.
**Verification (planned):** unit tests for precedence and file mode; a test that an ambient
`ANTHROPIC_BASE_URL` does not move a configured connection; a headless run with
`PLATO_DISABLE_KEYRING=1`.

---

**D49by — The CLI follows the terminal conventions professional users already know (founder, 2026-10-21).**

**The instruction.** The founder asked the CLI to follow the standards and conventions of Claude
Code, opencode, and similar tools. Professional users expect a polished tool. A terminal UI that
looks improvised will lose them.

**Command shape.**

- `plato` opens the interactive terminal UI in the current directory.
- `plato "task"` opens the interactive UI with the first task filled in.
- `plato -p "task"` runs one task and exits. `-p` matches Claude Code's `--print`.
- `plato -c` continues the most recent session for this project. `plato -r <id>` resumes a named
  session.
- `plato auth ...`, `plato models`, `plato sessions ...`, `plato mcp ...`, and `plato doctor` are the
  noun-based command groups.

**Machine-readable output.** `--output-format text|json|stream-json`. `text` is the default. `json`
prints one result object at the end. `stream-json` prints one JSON object per line for text, tool
events, and notices. Results go to stdout. Logs and progress go to stderr. Exit code 0 means the
run completed. 1 means a failure, a refusal, or a cancel. 2 means a usage error.

**Interactive conventions.**

- `/` opens the command menu with completion.
- `@` mentions a file and offers path completion.
- `Shift+Tab` cycles `plan`, `edit`, and `auto`.
- `Esc` interrupts the current turn. `Ctrl+C` interrupts; a second `Ctrl+C` exits. `Ctrl+D` exits.
- `Ctrl+R` searches history. `Ctrl+L` redraws. `\` followed by Enter, or `Shift+Enter`, adds a new
  line.
- `?` on an empty prompt shows the shortcuts.
- `!` shell passthrough is deferred. Direct output could carry a value the secret scrub has not
  seen. Define that rule before shipping the feature.

**Permission prompts.** The default answer is No. The choices are Yes; Yes, do not ask again for this
file or session; and No. A write shows its diff. `Esc` declines. The copy and the session-memory
rules come from core, so the terminal and the panel say the same words. Fetch approvals stay keyed
on `tool:host`.

**Terminal UI stack: Ink 8, pinned to `8.0.0`.** The founder delegated the choice on 2026-10-21
with three criteria: flexible, reliable, and painless long term. Ink meets them.

- **Flexible.** The host is split into a pure view model and a renderer. A plain-text renderer and a
  JSON renderer use the same view model, so the TUI is replaceable. Product state, copy, and
  decisions stay in core and in the view model, never in a component.
- **Reliable.** Pure JavaScript. No native build, no platform binaries, no compiler. The same
  tarball runs on macOS, Linux, and Windows. Ink is the renderer used by tools in this class, and
  `ink-testing-library` drives real keystrokes.
- **Painless long term.** One dependency tree, a stable public API, and a pinned version. The first
  release stays on `8.0.0` until a later 8.x patch line has proven itself. Ink 8's four breaking
  changes are avoided by design: no percentage widths on `Box`, `useWindowSize()` for terminal size,
  no reliance on mouse or focus sequences, and React 19.3.x.

OpenTUI was rejected because it needs Node 26.4, experimental FFI, and native Zig binaries. Raw
`readline` was rejected because Duo and Academy need a live multi-agent feed, and building that by
hand would cost more than the dependency. This is a recorded exception to the project rule that a
new framework needs a reason.

**Duo and Academy on screen.** A persistent observer strip shows each philosopher's name and colour.
Observer notices appear inline. Guidance, pause, and cancel work as they do in the extension. The
closing line reports checks and interventions. State stays legible without colour.

**Status line.** The mode, the model, the context used, the cost, and the observers.

**Headless and accessibility.** The CLI detects a non-TTY. It respects `NO_COLOR`. A flat
screen-reader mode is recorded for later; it is not in v1.

**Testing.** The host is split into a pure view model and a thin renderer. `ink-testing-library`
drives keystrokes. The plain renderer is exercised in CI without a terminal. A scripted provider
drives full runs, so the tests need no network. The existing core tests are not duplicated.

**The escape hatch.** If Ink ever becomes the problem, the plain renderer is not a stub: it is the
same view model with a different output layer. Replacing it touches one directory, not the host or
the engine.

**Files (planned):** `packages/cli/src/tui/`, `packages/cli/src/host.ts`,
`packages/cli/src/session.ts`.
**Verification (planned):** view-model tests, keystroke tests, a scripted-provider end-to-end run,
and a manual session with a real model in Duo and Academy.

---

**D49bz — The trace names its target, the search obeys `.gitignore`, and `doctor` replaces the debug log (2026-10-21).**

Three questions came from running the CLI on the proving-ground Android repo, not from the test
fixtures.

**The live trace names what a call touched.** The trace printed `→ grep` and `✓ read_file`. On an
eighteen-turn run that is a list of verbs: the user cannot tell which file was read or what was
searched for. It also broke the product's own rule from D49ba — a user should never have to decode a
tool identifier.

- The wording comes from the existing `toolWords` table (`doing`), so there is still one table and
  no second list that must agree with it.
- The target is one identifying value read from the call's arguments: a path, a pattern (with its
  `glob` scope), a command, a URL, a git verb, or the paths of an `apply_patch`. A tool with no such
  value prints no target rather than falling back to its first string — `write_file`'s other string
  is the file's CONTENT and `todo_write`'s is the plan.
- `→` carries the target, `✓` confirms without repeating it, and a failure repeats it because that
  is the one line a reader needs. Long targets are cut to 60 characters with the middle elided, so
  a path keeps its filename.
- The arguments are read from the event the loop already emits and are still never written to the
  transcript (D24c).

**The search obeys the repository's `.gitignore`, when the user turns that on (founder, amended
2026-10-21).** The walker had a fixed directory list (`.git`, `node_modules`, `build`, `.gradle`,
`.idea`, `.vscode`, `dist`, `out`), which cannot know that a project's `vendor/`, `target/`, or a
generated tree beside it is noise.

The first version of this filtered by default and said nothing. The founder corrected the default:
**an agent that silently misses a file its repository owner ignored is worse than one that sees
noise**, and the user must be able to choose. So:

- **Off by default.** Search sees every file, and a tool that returns an ignored one LABELS it:
  the model reads `[plato] 4 of 37 results are in paths that .gitignore excludes: dist/a.js, …`
  with the result, and the user is told once per run. A file named directly (`read_file`) says it
  is ignored whichever way the switch is set — the switch decides what a SEARCH returns, not what
  is true. **It also does not restrict access:** a file the user names is still read and EDITED with
  the switch on, which is the question this rule exists to answer. Turning search off must not
  quietly make a generated file un-editable. The protected-file guard is separate and unchanged:
  a protected file still reads masked, and a shell command that names one is still refused.
- **On by request.** `plato config set respectGitignore true`, `/gitignore on` in a session, and
  `plato doctor` prints which way it is set. The extension gets the same switch as
  `plato.search.respectGitignore`; the engine work is shared, and the setting is read there.
- The fixed directory list above is NOT part of the switch. It must stay: without it, "off" would
  mean walking `.git`.
- The matcher is `ignore@7`, the package that implements git's own rules, rather than a second
  implementation of gitignore syntax that would drift from git's.
- Root and nested `.gitignore` files both apply, the deepest opinion wins, and a walk that starts in
  a subdirectory still reads the files above it.
- **The forms are checked against git 2.50 itself, not against a reading of the spec:** a name
  pattern at any depth (`*.log`), an anchored path (`/root-only.txt`), a path with a slash
  (`docs/*.md`), a directory (`build/`), `?`, `[abc]`, `**/temp/**`, a negation (`!keep.log`), a
  comment, a blank line, and a nested `.gitignore` scoped to its own directory. 21/21 paths agree
  with `git check-ignore`.
- **A directory's exclusion is inherited.** A file inside an excluded directory stays excluded
  however a later rule spells its name — git's rule, and the first version of this got it wrong by
  asking only about the file. Re-including the directory itself (`build/*` then `!build/keep/`) does
  bring its contents back, and that distinction is a test.
- An ignored DIRECTORY is not entered when the switch is on, for the same reason.
- Seeding the secret map always ignores the switch. `local.properties` is gitignored in most
  Android projects and is exactly the file whose values must be scrubbed; a git-based skip there
  would remove a guard rather than noise.

**`doctor` replaces `--debug`; there is no second log.** The M6 plan called for a `--debug` log in
`~/.plato/logs/`. The transcript already records every turn, its usage, its tool events, and its
context, and the CLI never prints a stack trace — a second file would duplicate the first and could
drift from it. Instead the one command a user already runs first now answers the two questions that
matter: can Plato write its three homes (a probe that creates the directory and writes one file,
because a file left owned by another user is the common failure that `access` misses), and what did
the last run in THIS directory do (its age, how it ended, its turn count, and the path to the
transcript). A run that has no outcome recorded is reported as interrupted rather than hidden.

**The extension toggle is shipped, in Plato's own settings page, with the VS Code setting as the one
storage (founder correction, 2026-10-21).** `plato.search.respectGitignore` is a contributed setting
— boolean, default false, resource scope — read inside each run rather than at activation, so a
change applies without a reload. The founder's intent was the **gear's page**, not the workbench
Settings editor, so the first version (an editor-only toggle) was corrected: a new **Others** section
in `showSettings` carries the switch, using the same `beh()` row the MCP section uses, and the host
writes the SAME setting. One value, two doors: the gear, and `settings.json`/the editor for anyone
who prefers it. The panel writes to whichever target already holds a value (folder, workspace, then
user), because writing Global under a workspace override would change nothing visible and read as a
broken switch. **Two defects were found and fixed while proving it.** (1) The extension PERSISTED the
loop's notices but never posted them, so a stopped shell, a stuck nudge, or this note appeared only
after a reload; the notice branch now does both, as `context-compacted` always had. (2) A payload
built immediately after `update()` could read the OLD value, so the switch re-rendered in the state
the user had just clicked away from; the writer now waits (bounded) for the configuration change
event before re-reading. Field case 32 drives the switch where a user looks for it — opens the gear,
opens Others, clicks, reads it back, closes — and then reads the profile's user settings file,
because that file is what the editor shows. Falsified the way this directory requires: with the
setting read hardcoded to `false`, the second run fails in all four places that can see it — the
model's result, the empty-result claim, the user-facing notice, and the transcript rule.

**Verification.** Core 877 (a turn boundary in `finalText` and a binary skipped by grep were found
in the same session); CLI 159; e2e 6/6; the real-model matrix 19/19; the pty proof; field case 32
passes in a real window and was falsified; case 33 (the panel close, renumbered from 32 so it stays
last) still passes after it; and the three behaviours were re-checked against the repo itself: the
trace names each pattern, `local.properties` is invisible to `glob`, and `doctor` reports the last
run.

---

**D49bv — Apache-2.0, with the repository private (founder, 2026-10-20).**

**The decision.** Plato is licensed under Apache-2.0. The repository remains
private. The VSIX carries `LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md`. The
website and the extension README say "licensed under the Apache License 2.0,"
not "open source." The working record is `docs/LICENSING.md`.

**Why a private repository is allowed.** Apache-2.0 does not require a public
repository, and it does not require source distribution with a binary. Section 4
requires the license text, the notices, the `NOTICE` file when one exists, and a
statement of changes when the work is modified. The VSIX is the distribution.
The repository can stay private. A recipient receives the rights in the license,
not the repository.

**What the license does not do.** It does not prevent reverse engineering,
modification, or redistribution. The VSIX contains readable JavaScript;
minification is a speed bump, not a lock (D49bu). If the founder later needs to
restrict modification or redistribution, future versions must use a proprietary
EULA. Versions already published under Apache-2.0 stay under Apache-2.0.

**Wording.** "Licensed under Apache-2.0" is accurate. "Open source" usually
implies that the source is available. Do not use it while the repository is
private. If the repository opens later, the same license applies and the term
becomes accurate without a license change.

**What changed.** `LICENSE` at the root and in `packages/vscode`; `NOTICE` and
`THIRD-PARTY-NOTICES.md` at both paths; `"license": "Apache-2.0"` in the root,
core, and extension manifests; `packages/vscode/README.md` for the Marketplace;
the stale `packages/vscode/package.vsix.json` deleted; the website footer and
install note updated; `docs/WEBSITE.md`, `docs/HANDOFF.md`, and the website
handoff updated. The four runtime dependencies remain MIT; their notices are in
`THIRD-PARTY-NOTICES.md`.

**Extension ID.** The founder chose `applivity.plato` on 2026-10-20. The
extension package is named `plato`; the root workspace package is named
`plato-workspace` so the pnpm filters stay unambiguous; the
`configurationDefaults` schema paths use `%applivity.plato/...`; the VSIX file is
`plato-<version>.vsix`. The display name is **Plato by Applivity**: the
Marketplace rejected "Plato" because `iabacus-publisher.plato-code` already uses
it. Display names are global; the ID is publisher-scoped.

**Verified.** `vsce package` produced `plato-0.26.0.vsix` with 13 files (423,637
bytes uncompressed); the manifest Identity is `Id="plato" Publisher="applivity"`
and the display name is `Plato by Applivity`; `LICENSE.txt`, `NOTICE`,
`THIRD-PARTY-NOTICES.md`, and `readme.md` are present; the packaged manifest says
`"license": "Apache-2.0"`; no source, tests, or maps are present. The VSIX was
installed locally as `applivity.plato@0.26.0`; the old
`applivity.plato-vscode` was uninstalled. The VSIX secret scan found no secrets,
forbidden files, or local paths.

**Published.** The VSIX was uploaded through the Marketplace management page on
2026-10-20 and is live at
`https://marketplace.visualstudio.com/items?itemName=applivity.plato` as
`applivity.plato`, version 0.26.0, display name `Plato by Applivity`. The public
API reports `validated, public`; the publisher is `applivity` (verified). The
listing uses the Marketplace default icon, has no tags, is category `Other`, has
no Preview badge, and its README install text still describes a local VSIX.
These are follow-up polish items, not publish blockers.

**Update 0.26.1 is live.** Added a 128x128 owl icon at `media/icon.png` (dark
ground, light ink, cyan eyes), set `"icon"` in the manifest, rewrote the README
install section to make the Marketplace primary, and published version 0.26.1.
The public page serves the 0.26.1 icon asset.

**Update 0.26.2 is live.** The founder asked for the owl itself as the icon, not
a small owl inside a tile, and for a squarer head, larger ear tufts, and a small
visible beak. The icon became full-bleed: the cropped `viewBox` makes the owl
fill the 128x128 canvas, with a squarer head, larger ears, and an olive beak.
The categories are `Machine Learning` and `Other`; the live listing shows
`Machine Learning`. `plato-0.26.2.vsix` has 15 files (431,356 bytes).

**Update prepared (0.26.3).** The founder said the full-bleed icon works but is
not eye-catching enough, and asked that every icon-based asset stay in sync
because the website uses the same owl in light and dark modes. Four variations
were rendered. The founder chose **A**: the dark tile with a cyan rim, the large
light owl, cyan eyes, and an olive beak, with the owl at natural proportions and
**no horizontal stretch**. The canonical activity-bar mark in `media/plato.svg`
is the same squarer owl, and `docs/assets/` holds the website asset pack:
`owl.svg`, `owl-ink.svg`, `owl-accent.svg`, `owl-tile.svg`/`.png`, and
`favicon-16.png`/`favicon-32.png`. `plato-0.26.3.vsix` has 15 files (432,372
bytes) and is installed locally as `applivity.plato@0.26.3`. It has not been
uploaded. The tags, publisher display name, and Preview badge remain
management-page or later-version items.

**What did not change.** The repository is still private. The CLI is phase 2.
**Update 2026-10-21:** phase 2 is now open (D49bw).

**Why this fits.** Apache-2.0 is the category norm and gives a patent grant, a
trademark clause, and clear liability language. It allows the repository to open
later without a license change, and it keeps the option of a paid hosted service
or separate premium features.

---

**D49bu — the VSIX is minified, which raises the cost of reading it and is not a lock (founder, 2026-10-19).**

**The founder asked whether a published VSIX would be "properly obfuscated and not easily reverse
engineered", and how fast the Marketplace review is. The first answer was measured; the second
turned out to be a question with no queue in it.**

**What shipped before.** Unzipping 0.26.0 showed the source tree and the maps were gone (D49br) —
but the bundle itself was plain readable JavaScript: **20,581 lines, 866 comments, 6,166 distinct
identifiers, and 95 banner comments naming every module it came from** (`runtime/loop.js`,
`security/secrets.js`, `tools/execute.js`). Renaming `.vsix` to `.zip` gave anyone the source, minus
the type annotations. The `.vscodeignore` had done its job; the compiler step had not.

**Two changes.** `minify: true` for the bundle. And because the whole interface ships as one HTML
template literal that esbuild cannot reach into, a build plugin now extracts the inline `<style>`
and `<script>`, minifies each, and puts each back as an **interpolation of a module constant**
rather than as template text. That is the decision worth keeping: re-inserting minified code as
literal text would have to be escaped for backticks and `${`, and escaping is exactly where such a
step silently corrupts a page. The constant is built with `JSON.stringify`, so the template
interpolates a value and no escaping exists to get wrong. The declarations are inserted **after**
the `"use strict"` directive — inserting at byte zero would have quietly dropped the module out of
strict mode. If either block ever disappears, the build throws instead of shipping readable source.

**The verification decision matters as much as the change.** The render harness built its HTML from
`out/webview.js`, the unminified `tsc` output, so every suite would have been testing source that no
longer ships. The plugin therefore writes the transformed module to `dist/webview.min.js`, and the
harness loads **that** when it exists. All 24 suites now exercise the bytes in the VSIX. Measured:
818 KB → **390 KB** for the bundle, the HTML string 255 KB → **132 KB**, the VSIX 215 KB → **122 KB**,
zero comments and zero module banners in the artifact.

**Checked before mangling was turned on, because mangling breaks code that reads names.**
`this.name = 'ProviderError'` is a string literal, so it survives; `instanceof` compares bindings,
not names; there is no `.constructor.name` and no `Function.prototype.toString` on our own
functions; and esbuild does not mangle property names, so `mcpServers` and the tool schema keys are
untouched.

**Stated plainly, because the question was about obfuscation: this is not obfuscation.** A VS Code
extension is ordinary Node.js on the user's machine, and nothing can withhold the code. Minification
moves the effort from "open it in an editor" to "run a formatter for a few minutes". It also makes
our own stack traces unreadable, which is why the source map is still built and `.vscodeignore`
still keeps it out — that leaves a dead `sourceMappingURL` comment in the artifact, accepted rather
than special-cased. **The real protections are a license and never shipping a secret**, and the
artifact was checked for both: no key-shaped strings and no absolute home paths.

**The review question has no queue to wait in.** The Marketplace runs automated validation and signs
the package; an extension is installable within minutes, and Microsoft's own tracker describes the
absence of a review gate as a known supply-chain risk. Publisher *verification* is separate — five
business days, and it requires six months of listing history, so it is unavailable at a first
publish. One dated risk belongs here: global Azure DevOps personal access tokens are retired on
**2026-12-01**, so publishing should use Entra ID (`vsce publish --azure-credential`) rather than a
token that has weeks left.

**Files:** `packages/vscode/esbuild.mjs` (minimum: `minify`, plus the webview plugin),
`packages/vscode/.vscodeignore` (excludes `dist/webview.min.js` from the package),
`scripts/render/harness.mjs` (loads the minified module when present).
**Tests:** the full render suite, **24 suites / 700 assertions**, now against the shipped HTML and
unchanged in count from the unminified run — which is the evidence that minification altered no
behaviour; `pnpm -r test` 858; field cases 1 and 29 re-run green against the packaged VSIX.

---

**D49bt — MCP becomes discoverable: the config is JSON, and Settings has a section for it (founder, 2026-10-15).**

**The founder's question was blunt — "is there no UI toggle or anything that lets a user know where
and how to configure it?" — and the answer was that there was nothing at all.** MCP had shipped in
0.6.0 and the word "mcp" did not appear once in `webview.ts`, which is the whole interface. No
command, no setting, no view, no panel, no schema: `mcp.yaml` was the only one of the three config
files without an editor binding, so the feature could be found only by reading a document and then
hand-writing a format documented nowhere in the product. **Plato's own website told the user to
configure something and never said where.**

**Nine competitors were surveyed before anything was designed** (VS Code/Copilot, Cursor, Claude Code,
Codex CLI, Cline, Roo Code, Zed, Devin/Windsurf, Continue.dev). Every maintained product has an
in-product surface; none relies on documentation alone. The per-server control set has converged
(toggle, restart, delete, timeout, per-tool allow), the button is always named for the ACTION rather
than the path ("Configure MCP Servers", "MCP: Open User Configuration"), and the ecosystem has
converged on an `mcpServers` JSON map. **The one product with no management UI — Continue.dev — has
since been acquired and archived.** That is a correlation and not a proof, but it is why the omission
was treated as a defect rather than a backlog item.

**The founder's directive settled the format: there are no users, so build what is most reliable
going forward and what the industry understands.** That is `{"mcpServers": {...}}`, read and written
with `JSON.parse`/`JSON.stringify` — and **the change is a DELETION**: ~130 lines of hand-rolled
line-based parsing go, and with them the indentation rules, the two `args` forms (inline `[a,b]` vs
block `- item`), the block-only `env` and the quote handling. The old inline form carried a live
round-trip bug: an argument containing a comma came back as two. **A hand-written emitter was
designed, built, and then deleted too** — rebuilding the file from our own subset would have silently
dropped fields Plato does not read, and `"type": "stdio"` is in every Claude Code entry, so the first
click of a toggle would have quietly rewritten a config the user pasted from somewhere else.
`withServerDisabled` round-trips the parsed DOCUMENT instead. **The trade is that `~/.plato/` is
otherwise YAML and `mcp.json` is the odd one out**; accepted, because MCP is the one format where the
ecosystem has a convention.

**Unknown keys are KEPT, not rejected** — a deliberate reversal of the old parser's `unknown key`
throw. A strict loader would refuse a config copied from the very tools this shape imitates. A
JSON Schema was written to put the strictness in the editor instead — and then **REMOVED, because
it cannot reach the file.** Three deliveries were measured in a real window, each with controls
proving the file was open and the status bar was being read: `contributes.jsonValidation` with a
bare `fileMatch`, the same with `**/mcp.json`, and a `$schema` line in the config with the schema
written beside it. **All three failed identically — VS Code reported a schema as configured while
catching neither a missing required key nor an unknown one** — and the last of them named the cause
outright: *"Unable to resolve schema"*. The binding matches the file; the schema does not load for
a path outside every workspace. Shipping it anyway would have left the product claiming an editor
affordance it does not have, so **there is no schema, and no editor validation, for `mcp.json`** —
recorded as a known limit rather than papered over. The Settings panel is where the format is
explained, and its hover text is what the schema was meant to provide. The runtime does say why a
`url`-only remote entry cannot be used, because "missing 'command'" alone would not explain it.

**The section reports CONFIGURATION plus the outcome of the last run, and never spawns a server.**
This is the decision with the most reasoning behind it. `McpServer.start()` executes a command from
the user's own config with a 20-second handshake, and `sendSettings()` is not a once-per-open call —
it fires on every connection change, model fetch and home-file watcher event — so a panel that
started servers to render would run the user's commands repeatedly, invisibly, and could block for
20 seconds per hung server. **But the decisive fact is structural: MCP servers exist only DURING a
run.** They are built at the top of `run()` and stopped in its `finally`, so between runs there is
nothing live to read and a "live state" panel would be reporting dead processes. A row therefore says
`not run yet` rather than showing a count nobody measured — **the render suite asserts the ABSENCE of
a digit for that state, not the presence of a phrase**, because the failure being guarded is an
invented number whatever words sit around it. Recorded cost: a count goes stale until the next run.
If live state is ever wanted, the only honest mechanism is an explicit "Test servers" button that
spawns on demand and stops; it is deliberately not built.

**`plan` no longer starts MCP servers at all.** `plan` denies every MCP tool (`modes.ts`), so
starting them bought nothing: it ran the user's configured commands in the one mode that promises to
change nothing, and a hung server cost up to 20 seconds before the first turn, for tools that could
never be called. The last run's outcome is deliberately NOT cleared by a plan run — nothing ran, so
"not run yet" would be a worse answer than the last run that did, and a server removed from the
config stops appearing regardless because the panel only reports names the file still has. Asserted
in the field case by its second run, which is the same config in `plan`: no MCP tool may be offered
and no MCP line may reach the chat, and removing the skip fails both.

**Three smaller decisions worth keeping.** The tool-name separator is now a DOUBLE underscore
(`mcp__server__tool`), matching Claude Code and Codex: server names may contain underscores and tool
names almost always do, and `loop.ts` keys its tool map by the joined string, so a collision silently
dropped one server's tool with nothing reported anywhere. A field case that needs MCP config must
touch the founder's REAL `~/.plato`, so the harness backs the file up for the whole suite and restores
it in `after`, and removes a case's seed the moment that run ends — otherwise every later case would
run with MCP servers attached. And the two START notices stay on screen only: servers start while the
run is being PREPARED, before `run-started`, and the writer drops a notice that arrives before the
record it would land in exists (D49bn's rule). **Emitting them on the bus was tried, measured against
a real transcript, and reverted as inert** — the field case witnesses them from the screen and says
so, rather than the product being restructured to make a test easier.

**Two harness facts the work exposed.** The panel-close case was renumbered **29 → 32** (the MCP case
took 29; 30 and 31 are the real-model cases, so it moved above them rather than colliding) and **a
hard-coded `c.n === 29` in the spec had to move with it** — a check keyed on a case number fails
silently, because the notes simply stop being written. And a new render suite must `await
checkSections()`: calling it un-awaited let `p.close()` land mid-evaluation, which failed
intermittently and looked like a product defect.

**Files:** `packages/core/src/mcp/config.ts` (rewritten: JSON + validation + `withServerDisabled` +
`EMPTY_MCP_CONFIG`), `packages/core/src/mcp/client.ts` (`disabled`, the separator),
`packages/core/src/index.ts`, `packages/vscode/src/extension.ts` (`mcpStatus`, `mcpLastRun`, the
start-loop skip, `open-mcp` and `set-mcp-disabled`, `mcp.json` added to `ensureHomeWatch`),
`packages/vscode/src/webview.ts` (the fifth Settings section), `packages/vscode/package.json`
(0.26.0). **No schema ships** — see the measured limit above.
**Tests:** `mcp-config.test.ts` (rewritten for JSON, 9), `mcp-write.test.ts` (new, 6),
`mcp-client.test.ts` and four other suites' `mcp_` literals moved to the new separator,
`scripts/render/mcp.mjs` (new suite, registered in `SUITES`), `scripts/field/fake-mcp.mjs` (new) and
field case 29 with `seedHome` plus home backup/restore in `field.test.mjs`.

---

**D49bs — the mark is an owl, and the temple could not be saved (founder, 2026-10-09).**

**The founder asked for something less generic than the speech bubble D49bq shipped, and for the
pediment to be improved.** A run of marks — nineteen drawn designs across five rounds — was rendered at
104, 24 and 16 pixels on the real editor grounds, and judged at those sizes rather than as path
data. **That method is the entry's real content: four ideas that read correctly as paths did not
survive being drawn**, and the reasoning is below rather than asserted.

**The temple could not be saved, and this was established rather than assumed.** It was drawn again and
again across the studies — the first study's temple front on three columns with a stepped base, a
bolder version of it, and a minimal one of a pediment over two fat columns. **Every one read as a
house.** A triangle over a rectangle is a roof, and changing what sits underneath it does not change
that — the perception is in the silhouette,
not in the drawing. **The improvement is therefore subtractive:** keep the raking cornice and the
stylobate and put nothing between them. Stripped of its columns the shape stops being a building and
becomes geometry. That is the option the founder was shown for the pediment.

**The mark is Athena's owl.** The bird struck on Athenian coins — the same city, and the same goddess,
as the Academy. It was the only candidate that stayed distinctive at 16px: the ear tufts
carry the outline and the two eyes are the only detail left, and the face still reads as a face. It is
also the only one a person could describe to a colleague from memory, which is what makes it a mark
rather than a shape.

**Rejected, each for a reason the render produced:**

- **The compass** (geometer's divider — the inscription over the Academy's door) read as a capital
  **A**: the pivot, the splayed legs and the adjusting bar literally are one. Adding the drawn arc
  turned it into a delta instead.
- **The arch with a base bar and a keystone** read as a **padlock** — the bar became the lock body and
  the keystone the shackle. Removing both fixed it; the plain arch survives as an option.
- **The column with a ring** read as a **keyhole**, and at small sizes as a person. The ring never
  fused with the column.
- **The fluted column** read as a **roman numeral III** at 24px, and the grooves closed into a bar at
  16px. The flutes were removed.
- **The Greek key** needs corridor width to turn; at 16px the corridors shut and it became a solid
  square.
- **The amphora** was genuinely distinctive at 104px and a grey smudge at 16px — its detail *is* its
  silhouette, so there was nothing left to simplify.

**The earlier P was rebuilt rather than dropped.** The Form and the Column, which the founder had
called adequate but unimpressive, became a solid letterform with a quarter-round counter and real
contrast between stem and bowl. It was offered alongside the owl and the founder chose the owl; **the
rebuilt P is recorded here as the mark to return to if the owl ever reads as too informal.**

**How it is drawn.** The head is one path with `fill-rule="evenodd"`: the two eyes are its holes and
the pupils are islands inside them. That is what keeps the face legible small — at 16px the tufts give
the outline and the eyes are the only thing left to read. **The mark is monochrome in `currentColor`
by necessity, not preference:** the activity bar recolours whatever it is handed, so any colour would
be discarded.

---

**D49bq — the activity bar gets a Plato entry; the conversation stays an editor tab (founder,
2026-10-08).**

**The founder's question was why there is no Plato icon in the left bar, as Claude Code, Git and
Search have.** There was none, and there could not be: the manifest contributed only commands and
settings — **no `viewsContainers`, no `views`** — and the chat is a `WebviewPanel` opened in
`ViewColumn.Beside`, which is an **editor tab**, exactly like an open file. Git, Search and Extensions
are built into VS Code; Claude Code contributes its own container. An extension that contributes none
has no icon there, by construction.

**What shipped.** A container in the activity bar — a speech-bubble icon, `media/plato.svg`, drawn
with `currentColor` so the theme recolours it — holding one view, **Chats**, which lists the ways into
the conversation and the conversations already stored: **Open Chat**, **New Chat**, then up to twelve
archived chats with a relative time, each one click from being restored. Both actions are also buttons
in the view's title bar, and **Open a saved chat** is hidden from the palette (it takes an argument and
means nothing without one).

> **SUPERSEDED (D49bs, 2026-10-09):** the icon is now **Athena's owl**, not a speech bubble. The
> container, the view, the rows and everything else this entry records are unchanged — only
> `media/plato.svg` was swapped.

**It is a TREE, not a second webview.** Three reasons, each of which the alternative gets wrong: it
takes the theme's colours for free, it carries **no script surface** — a second webview would be a
second place script runs, for a list of strings — and **every row is a command**, so nothing in it is
reachable only by clicking. A launcher holds no state, which is what makes it cheap.

**Why the conversation was NOT moved into the sidebar — deferred, not decided against (option A).**
The run controls are built on the panel lifecycle: **closing the panel stops the run (D49bn)**, and the
park and resume, the approval cards, the question cards and the transcript all live in that panel. A
sidebar entry is a `WebviewView`, not a `WebviewPanel` — a different lifecycle, in which "closed" is
not a thing that happens (**hidden** is, and it can be shown again), `retainContextWhenHidden` means
something else, and the host must re-decide what it means for a run to outlive its supervision. That
is a deliberate change to the product's centre, not a contribution point, and it wants its own
decision. **Recorded as deferred.** The work it would need, if it is ever taken up: a
`registerWebviewViewProvider`, the view's visibility as the new supervision signal, and an answer to
what stops a run when the view is hidden rather than closed.

**One guard added, because the sidebar made an unsafe state reachable.** `resumeSession` — the restore
path, now shared by the webview's History list and this new list — **refuses while a run is active**.
Replacing the log under a live run feeds the model a different conversation while the run's own events
keep landing in the panel. The webview's History did not offer that state; the sidebar does. Nothing
else about restoring changed: it is the same body, lifted out of the message handler so both callers
share one copy.

**Verified in a real window, not by inspection.** The harness launched VS Code with the packaged VSIX:
the activity bar reads `["Explorer","Search","Source Control","Run and Debug","Extensions","Claude
Code","Plato","Cline"]`, the view opens as **PLATO: CH…**, its title bar carries **Plato: Open Chat**
and **Plato: New Chat**, and the rows read **["Open Chat","New Chat"]**. The passing assertion and the
screenshot are the evidence; the temporary spike that produced them was deleted rather than committed.

---

**D49br — the VSIX ships only what runs (founder, 2026-10-08).**

**Found while answering "how do I hand this to a user".** There was **no `.vscodeignore`**, so
`vsce package` shipped whatever was on disk: the whole TypeScript source tree, `out/` (a second,
duplicate build from `tsc`), **1.6 MB of source maps**, the build config and the build scripts — 25
files, 879 KB. **It was clean of secrets** — no key material, no transcripts, no local storage, no
demo-repo data; that was checked rather than assumed — **but it handed the complete source to anyone
who unzipped it**, which is more than is intended while the repository is private and the license
decision (D19) is still open. A `.vsix` is a zip; the source was in the payload, not implied by it.

**Now 9 files, 206 KB, no source and no maps.** Only `dist/` is loaded at runtime (`main` points at
`dist/extension.js`), so the source, the maps, `out/`, `tsconfig.json`, `esbuild.mjs`, the build
scripts and `package.vsix.json` — a stale v0.1.0 leftover that nothing references — are excluded.

**Two files were kept although nothing references them.** `schemas/` and `examples/` appear in no
bundle and in no source file; the grep is empty in both directions. They are **not removed here**:
declaring them dead is a separate call, and a packaging change is the wrong place to make it.
Recorded so the next person does not have to re-derive it.

**This is a distribution decision, and it belongs to the audit.** D15's secret audit sweeps
"everything that leaves the machine: repo history, VSIX/npm artifacts, transcripts, docs, screenshots".
The artifact now carries one fewer thing for that sweep to find.

---

**D49bp — the provider stream says when it was cut, and gives up when it stalls; and a compaction that
summarised nothing is refused (founder, 2026-10-08).**

**Two defects, found by reading a list of harness bugs the founder met on the wire.** He asked for a
casual read of whether any of it applied, and explicitly not binding. Most did not: the list is from a
durable, distributed, multi-tenant cloud harness, and Plato is in-process, single-user, one run at a
time, with no message queue, worker pool, reconnect loop or tracing pipeline. **Two items did apply,
and both live in the OpenAI-compatible adapter** — the path his own DeepSeek/LiteLLM runs take.

**1. A stream the provider cut was returned as a COMPLETED turn.** `consumeSse` read until the socket
said `done`, then returned whatever it had accumulated, without ever checking that the stream had
actually FINISHED — that a `[DONE]` sentinel or a `finish_reason` had arrived. A proxy timeout, a
gateway idle kill or a mid-stream 502 therefore produced a response with `finish_reason: null`, and the
loop's rule — no tool calls and not a length cap means the run completed — turned a half-written answer
into a finished run, and a stream cut before any content into **a successful empty turn**. **The loop
already had the vocabulary for "this ended early"** — a `max_tokens` stop is reported as a cap — and an
abrupt EOF simply was not in it. The stream must now say it finished: `[DONE]` OR a `finish_reason`, and
neither is a retryable transport failure. The mid-tool-call variant was already self-limiting (a
half-written `arguments` string fails to parse and becomes `{_raw}`, so the tool errors), which is why
the silent half was the dangerous one.

**2. There was no read timeout at all.** The Anthropic adapter inherits the SDK's own default; this one
used a bare `fetch` carrying only the caller's cancel signal, so a server that accepted the connection
and then stopped talking held the run open until the user pressed Cancel — and the retry policy could
not help, because a stall never throws. The turn now carries an idle watchdog that resets on every chunk
RECEIVED, never on a particular field: a model streaming reasoning fragments this adapter does not read
still proves the connection is alive, and a keepalive that reset the clock without carrying progress
would defeat the guard. Headers and a non-streamed body get a separate, generous deadline.

**3. The minor one, fixed because it is the same shape.** `compactMessages` returned the trimmed message
list even when the summariser produced no text, so the older conversation was dropped and replaced by
nothing while the run reported the compaction as done. It now returns the ORIGINAL messages — a declined
compaction — the summary call's tokens are still counted, and the loop emits a notice instead of a
`context-compacted` event.

**Falsified, each reverted and re-run green:** the cut-stream check removed → the new streaming test
resolves instead of rejecting, and **field case 28 fails on all three of its witnesses**; the idle
watchdog neutered → that test hangs to its 5s timeout; the connect deadline neutered → the same;
`messages: keep` restored → both the empty-summary test and the loop test fail.

**One existing test changed, and why that is right.** `abort.test.ts` asserted the signal handed to
`fetch` was the caller's own OBJECT. The timeout machinery relays through Plato's controller, so the
object changed while the property the test exists for did not: it now asserts that aborting the caller's
signal aborts what the request carries. A test that pins an identity rather than the behaviour breaks on
the right change.

**End-to-end, and a constraint learned the hard way.** The stub can now cut a stream (`step.cut`), and
the case is judged by **recovery** rather than by a stop: the second scripted step exists only for the
retry, so a build that still takes the half answer as complete never reaches it. **It was first added as
case 29, after the panel-close case — and the full suite proved why the panel-close case must be LAST**:
the harness cannot re-enter a closed panel, so 29 never ran and clause 5 reported "no run in the
manifest". The two
were renumbered — cut is 28, panel close is 29 — so the numbers stay in run order around the one case
that must run last. It joins **acceptance clause 5**, *"the run's account of itself is honest"*, which is
the claim it is: a cut stream is a failed attempt to retry, not a reply the model chose to end. **Real
model: zero retries and zero failures across the whole pass** — the check that matters most, since this
adapter is the one the founder's runs use.

**Stated boundaries.** A real provider cannot be made to cut a stream on demand, so the cut is provable
on the stub only; the real-model pass is a regression check that the new completeness rule does not
false-positive on a real stream, and it did not. The idle window is 120s of total silence and the
header/body deadline 300s — generous on purpose, because a slow first token is not a stall. A server
that ends a stream with neither `[DONE]` nor a `finish_reason` is now retried and, if it does it every
time, fails the run: that is a malformed server being reported honestly, not a working one being broken.

---

**D49cj — New Chat asks in a real dialog, and a UI request waits for the person (2026-10-26).**

**Why.** Gap 16 was the last partial parity row. In the Visual Studio host, `+ new`
posts `newChat`; the shared host asks
`showWarningMessage(..., { modal: true }, 'New Chat')`; the shim maps that to
`ui.message`; the C# shell showed it with `VsShellUtilities.ShowMessageBox`. On VS 2026
18.11.12315 that call **blocked the UI thread and never created a window**. The sidecar
logged `ui.message timed out after 30000 ms`, nothing appeared on screen, the conversation
was not cleared, and the UI thread stayed inside the call until the process was killed —
inside that window, DTE calls were rejected with `RPC_E_CALL_REJECTED` and even `Quit`
could not run. An instrumented build logged `ui.message: showing` and never reached
`answered`; a scan of every top-level window on the session-2 desktop found no dialog.
`ui.inputBox`, which is a WPF `ShowDialog`, worked in the same build, so the fault was the
shell box and not the joinable-task path.

**The rule.** `MessageWindow` is a WPF dialog in `Native/Dialogs.cs`, built like the quick
pick and input box, and it shows the caller's own action labels (`New Chat`) plus Cancel,
or a single OK when there is no action. It returns the label of the button that was
pressed. **All four** `VsShellUtilities.ShowMessageBox` call sites use it — the `ui.message`
handler, two error boxes, and the "open a solution or a folder" notice — because the API
hangs in this build, not only for New Chat. No copy moves out of core; the message and the
label still come from the shared host.

**A UI request now waits ten minutes, not thirty seconds.** A modal that expires under the
person leaves a control that does nothing when it is finally pressed: the answer arrives
with no request to receive it (the same build showed `response for an unknown request id`).
`protocol.ts` gives `ui.*` ten minutes, `secrets.*` the plan's 30 seconds, everything else
ten seconds; the menu command's outer wait matches at ten minutes, because New Chat and Set
API Key both wait for a person.

**Verified.** `packages/vs/test/newchat.test.mjs` drives the host directly: a cancel leaves
the log, the title and History untouched; an answer asks first with the exact core payload
(`kind: warning`, the message, `actions: ['New Chat']`), then archives the live
conversation, clears the log, resets the title and tells the page to start empty. It was
**falsified twice** on the compiled host — a changed label failed "the confirmation carries
the core copy", and removing the archive failed "the conversation is in History". **In the
real VS window:** `+ new` and the `Plato: New Chat` menu command each raised the dialog; each
was left open 35–59 seconds (past the old 30-second timeout) and then answered, the
conversation cleared, and the answer produced a new 142-entry archive; **Cancel** left the
139-entry log, its title and History intact; the host log has no timeout and no error. The
C# shell has no automated test — the window is its witness. Evidence:
`C:\src\plato-vs-field\evidence\newchat\`.

---

**D49ck — Visual Studio 0.1.0 ships unsigned; signing follows the release (2026-10-26).**

**Why.** A code-signing certificate proves who published the VSIX. It does not change what
the extension does, and it is not required to publish. The founder's decision on
2026-10-26 is to release 0.1.0 unsigned rather than wait for procurement and identity
verification, which take days to weeks.

**What this costs, stated plainly.** On a machine with default policy, Visual Studio and
Windows may show the publisher as unverified; some organisations block unsigned
extensions outright. The clean-VM acceptance run must record the exact wording a default
Windows 11 machine shows, so the limitation is known rather than assumed.

**What comes next.** Azure Trusted Signing is the intended route: identity verified through
Microsoft, about $10 a month, and a certificate Windows already trusts. It is a release
step for the next version, not a reason to hold 0.1.0.

---

**D49cl — The Visual Studio install target uses the stable extension API (2026-10-28).**

**Why.** The first Marketplace upload was rejected: *"Your extension has specified an API
version of 18.0 as the lower bound in its installation target. This API version is
experimental, and not allowed in the Marketplace at this time. Please change your
installation target to use the latest stable API version 17.14."* Microsoft's VS 2026
compatibility model is explicit: Visual Studio 2026 runs extensions built against API 17.x,
and compatibility is decided from the lower bound alone.

**The rule.** The three `InstallationTarget` entries (Community, Pro, Enterprise) use
**`[17.14,)`**: the latest stable API, which is what the Marketplace accepts and what
Visual Studio 2026 runs.

**The consequence, stated honestly.** Under the new model an upper bound no longer excludes
a host, so the manifest cannot restrict itself to Visual Studio 2026. Visual Studio 2022
17.14+ is therefore *allowed* to install the 0.1.0 VSIX; it has never been tested there and
remains M6. The listing, the README, and the support answer all say Visual Studio 2026 on
Windows 11, which is the supported combination.

---

**D49cm — The Marketplace identity is `applivity.plato-vs` (2026-10-28).**

**Why.** The Marketplace's Internal Name becomes the permanent item URL and cannot be edited
after the first publish. The first two attempts were rejected as "contains non-permitted
characters"; the characters were never the problem — the field had a **leading space**. With
the space removed, `plato-vs` is accepted, hyphen and all.

**The rule.** Publisher `applivity`; internal name **`plato-vs`**; the VSIX `Identity Id` is
**`applivity.plato-vs`**, so the package, the VSIX ID and the URL agree:
`https://marketplace.visualstudio.com/items?itemName=applivity.plato-vs`. Published
2026-10-28 as 0.1.0.

**The consequence.** Every later version must carry the same identity; a build with a
different VSIX ID reads as a different extension to the Marketplace and to Visual Studio's
update path. A name that looks rejected is worth checking for invisible characters before
the package is rebuilt.

---

**D49cn — Visual Studio 2022 17.14 is supported, and the shell's own library decides the
binding (2026-10-28).**

**Why.** The install range `[17.14,)` (D49cl) admitted Visual Studio 2022, and the C# was
already compiled against the 2022 17.14 SDK, but nobody had run the package there. The
first field run on Community 17.14.37806.7 went most of the way: the package installed,
its four commands registered, the tool window drew in both themes, the bundled
`sidecar\node.exe` started — and the page stayed at "loading…". The extension log named
the cause: `stdout reader stopped: Method not found:
'System.String Newtonsoft.Json.Linq.JToken.ToString(Newtonsoft.Json.Formatting)'`.
Visual Studio supplies Newtonsoft.Json and resolves an extension's reference to its own
copy whatever version the extension was compiled against: 2022 loads **13.0.3**, 2026
loads **13.0.4**. 13.0.4 added the one-argument `ToString(Formatting)`; the compiler had
picked it; on 13.0.3 the call cannot bind, and the exception escaped the message handler
and stopped the stdout reader on the first message from the sidecar.

**The rule.** The project references the **oldest** Newtonsoft.Json the supported shells
load — 13.0.3 — so the compiler binds the two-argument overload that exists in both. A
newer reference is what broke it, and any future call to a newer-only API is now a compile
error rather than a field failure.

**The consequence.** 0.1.1 runs a complete scripted round trip in 2022 17.14 and in 2026
18.11 from one package; the transcripts and screenshots are in
`C:\src\plato-vs-field\evidence\m6-2022\`. The install range is unchanged, and the README
now says: Plato runs in Visual Studio 2022 17.14 or later, including Visual Studio 2026,
on 64-bit Windows.

**The build trap, recorded because it cost a round.** Changing the reference is not enough:
`package-vsix.ps1` did not restore, so an incremental tree kept the 13.0.4 resolution,
built a VSIX that still failed in 2022, and the failure looked like the fix had not worked.
The script now passes `/restore` to MSBuild. A package built by that script from a clean
tree is the one to ship.

---

**D49co — a screenshot is captured at display width, in a window sized to its slot
(2026-10-29).**

**Why.** The website asked for 1000×500 images. The first set was captured in a large
window (1872×912, the Marketplace size) and scaled down, and the website rejected it: UI
text fell to about 8px and stopped being legible. The second set was captured in a Visual
Studio window **sized to 1000×500** (Plato panel 590px, editor 370px) at 1x, and all six
images render at about 13.5px. Nothing else changed. The difference was the capture, not
the compression.

**The rule.** Decide the width the image will be shown at, size the window to it, and
capture at 1x. Do not capture large and scale down. Two sets now exist and they are not
interchangeable: the Marketplace listing shots stay 1872×912, and the website copies stay
1000×500. The evidence and the capture record are in
`C:\src\plato-vs-field\evidence\m6-shots\`.

---

**D49cp — the repository is public, under the `Applivity` organization (founder, 2026-11-02).**
Numbering continues after the Visual Studio series on this branch (D49cf–D49co).

**The change.** The founder moved the repository to the `Applivity` organization and made it public.
The old personal account `applivity-com` is deleted, and its URL returns 404. The canonical remote is
now `https://github.com/Applivity/plato`. The move is a rename, not a rewrite: the new remote serves
`main` at `e154a1f` and `vs/m2` at `52af87b8`, the same commits as the local branches, so nothing in
the history changed.

**The secret audit was required before this, and was run after it (D15).** The rule in the open
items says a secret sweep must precede any repository visibility change. The founder made the change
without one, so the sweep was run immediately afterwards against the full history: 383 commits,
scanned for provider keys, GitHub tokens, AWS keys, private-key blocks, and assigned secret strings.
Every match is a synthetic test fixture — `sk-plato-invalid-000000`, `sk-live-plato-probe-0001`, and
a fake PEM block, all in tests. No real credential has ever been in the repository; provider keys go
to SecretStorage or Windows Credential Manager and never to a file, so there was nothing to leak. The
known external exposure (`HcadPublicAndroid-demo`) is outside this repository and is unaffected.

**What it changes.**

- Package metadata may now carry `repository`, `homepage` and `bugs` pointing at the public URL.
  `docs/LICENSING.md` previously forbade a `repository` field because the target was a private URL;
  that reason is gone.
- The Visual Studio package gains `<MoreInfo>` in its manifest — the only link the Marketplace
  listing renders — and the version moves to 0.1.4. The VS Code package gains `repository`, which
  the listing shows as Repository.
- "Open source" is now accurate for the licence (D49bv, Apache-2.0). The rules that forbade the term
  while the source was private no longer apply. The trademark sweep (D16) is still owed before a
  wider public release.
- Every clone updates its `origin` to the new URL; the old one cannot authenticate.
- A repository that anyone can read needs a front page, so the root `README.md` exists and states
  what Plato is, the three hosts, the install commands, and the licence.

---

**D49ci — a bad MCP command is a failed server, not a dead sidecar (2026-10-24).**

**Why.** The M4a field run configured a fake MCP server in `~/.plato/mcp.json`. The command
path had single backslashes, so JSON parsed them as escapes and the resolved path did not
exist. `child_process.spawn` emitted `'error'` on the child — and an EventEmitter `error`
with no listener is an **uncaught exception**, so the whole Node sidecar died. The window
said *"Plato's agent process stopped. Use a Plato command to restart it."* and the run was
lost. This is the class M2 fixed for a timed-out UI dialog: a bad input must not take the
agent down. It is worse here, because the input is a user-editable file that any MCP README
can be copied into, and the failure looked like Plato crashing rather than a server failing.

**The rule.** `McpServer.start` attaches an `error` listener to the child and races the
handshake against it. A spawn failure rejects `start()` with the real error and rejects every
pending call; the handshake timer is cleared on every exit. The host's existing per-server
`try/catch` turns that into *"MCP <name> failed to start — …"* on the run and
`tools: 0, error` in Settings, and the run continues with no tools from that server. A dead
server is reported, never fatal.

**Verified.** `packages/core/test/mcp-client.test.ts` adds a command that cannot spawn and
asserts `start()` rejects. **Falsified** by removing the listener: the vitest worker died
with the same uncaught `'error'` event the sidecar did. `packages/vs/test/m4a.test.mjs` adds
a bad server to a working config and asserts the run completes, the notice names the failure,
and Settings reports `tools: 0` with a non-empty error. The real-window run reproduced the
crash on the old build and completed on the fixed VSIX. **Shared core, so the VS Code
extension and the CLI get the same fix.**

---

**D49ch — the council card renders, a pause line is written once, and the page speaks UTF-8 to the host (2026-10-23).**

**Why.** M3b checkpoint 2a drove Solo, Duo, and Academy through a real Visual Studio 2026 window. The
feature work needed no new code — the shared host and the unchanged chat HTML carry it — but the
witness found three defects. Two are in shared code, so the VS Code extension gets the same fixes.
One is in the Visual Studio bridge.

**1. The council card had never rendered in either host.** The host built the team payload and posted
it through `send()`, which wraps its argument in `{ type, text }`. The page's `showTeam` reads
`m.name` and `m.members` at the top level. Every Academy run therefore drew **"Team unnamed"** with
no rows, since the card was introduced in 0.8.0. Structured payloads (`restore`, `settings`, `queue`)
are posted flat; the team payload is one of them now. `send()` is for text messages only.

**2. Every pause and resume line appeared twice.** `RunController.onPark` emitted a `notice` on the
bus AND called `send('notice', line)`. Since D49bz the bus `notice` listener also posts the line, so
the user saw two "Plato paused at a safe point." rows. The explicit send is removed; the bus notice
is the one source.

**3. Non-ASCII text from the page reached the host as U+FFFD.** On .NET Framework 4.8,
`Process.StandardInput` is a StreamWriter with the system ANSI codepage, and
`ProcessStartInfo.StandardInputEncoding` does not exist there. An em dash in a council role was
written as byte 0x97; Node's UTF-8 reader reported U+FFFD and the host saved it. The bridge now
writes the UTF-8 bytes to `StandardInput.BaseStream` itself. This is the Visual Studio shell only.
Host-to-page text was never affected.

**Verified.** `packages/vs/test/teams.test.mjs` covers the modes, the philosopher's powers, the
council card payload, both observer notices, and the five-intervention cap. The team-payload
assertion was falsified by restoring the old envelope, and the pause-line assertion by restoring
the explicit send; both failed for the expected reason and were restored. The encoding fix is
witnessed only where it can be: the real window creates a council through the Academy editor, and
the driver asserts the saved role still contains `— mismatched lists`. `scripts/render/teams.mjs`
adds the DOM assertions for the lead to run on macOS. Evidence:
`C:\src\plato-vs-field\evidence\m3b\checkpoint2a\`.

---

**D49cg — an approval card closes when its run ends, and a replayed card is never live (2026-10-23).**

**Why.** The M3b checkpoint 1 witness found three defects that are shared with the VS Code extension:
a fold rebuilt an answered approval card as live, so clicking it wrote an echo for an answer that
reached nobody; a run advanced by the queue did not set the page's run UI, so Pause and Cancel were
hidden even though the run was live; and cancel released the approval resolver but left the card's
buttons live. These are repairs to the one card lifecycle, not new capability, so they are fixed in
the shared host and webview and both hosts get them.

**The rules.**

1. Every approval `card-open` writes a `card-done` row beside it on allow, deny, session allow, and
   cancel. Replay pairs the rows and draws the answered card; a lone old `card-open` replays
   non-interactive. A late `approve` or `approve-all` is inert: no echo, no closed card, no widened
   session.
2. A queue-advanced run posts `queue-run` with the task, and the page sets the same run UI as a
   user's send, including Pause and Cancel.
3. Cancel closes the open approval card with the heading "<heading> — cancelled", not "denied",
   because the user did not answer. The card stays as the record of what was asked.

**Verified.** `packages/vs/test/approval-lifecycle.test.mjs` drives the real host through a
`/compact` fold, late clicks, a cancelled card, and a queued pause/resume/cancel; it was falsified
three times. `scripts/render/runlifecycle.mjs` asserts the DOM rules on macOS. All three defects were
re-verified in a real Visual Studio 2026 window; evidence is
`C:\src\plato-vs-field\evidence\m3b\checkpoint1-fix\`.

---

**D49cf — Phase 3 opens: Visual Studio 2026 is the next host, and the Windows repair comes first (founder, 2026-10-23).**

**The instruction.** The founder set full Visual Studio support as the next goal and approved the
R&D recommendation. The plan is [`packages/vs/PLAN.md`](../packages/vs/PLAN.md). This entry records
the decisions that bind the work; the plan carries the milestones, the parity checklist, and the
verification.

**The decisions.**

1. **Target Visual Studio 2026 first.** Visual Studio 2022 is not in v1. The extension model is
   backward compatible, so a later 2022 pass is a compatibility test, not a second codebase.
2. **Full parity before public publish.** The founder chose parity over an early release. Internal
   signed builds are allowed; the Marketplace listing waits until the parity checklist is complete.
3. **Shim first, bridge as the fallback.** The existing VS Code IDE host and chat UI are reused. If
   the shim cannot reach parity, use the conventional bridge over the CLI engine. No functionality
   is dropped to make the shim work.
4. **Windows repair first.** The shell and background-shell tools call `/bin/bash` directly, MCP
   commands need `.cmd` resolution, and process cleanup uses POSIX process groups. This is a repair
   of the shipped VS Code extension and CLI on Windows, and a prerequisite for Visual Studio. It is
   M0; the extension does not start until M0 passes.
5. **Environment.** Development is on a full Windows machine with Visual Studio 2026. The repository
   is shared over SMB, but the working tree is a local clone. SMB is not a build directory: pnpm,
   MSBuild, file watchers, file locks, and long paths are all unreliable there.
6. **Publishing.** Visual Studio Marketplace after parity, under the `applivity` publisher. A signed
   VSIX is used for internal builds. The exact signing method, item id, and privacy policy are open.

**The platform facts that shape the design.**

- **Visual Studio 2026 is GA.** It shipped as 18.0 on 2025-11-11; the current build is 18.11.1
  (2026-10-20). The VS 2022 extensibility documentation still applies. Extensions are VSIX v3,
  authored in C#/VB/C++.
- **Visual Studio has no JavaScript or Node extension host.** A web UI must live inside a .NET
  extension. WebView2 is the practical way to render it.
- **There are two extension models.** The classic in-process VSPackage model uses .NET Framework
  and WPF and can host WebView2. The newer out-of-process VisualStudio.Extensibility model uses
  .NET 8 and Remote UI; its core API has been stable since 17.9, but the landing page still calls
  the SDK a preview, and WebView2 hosting is not confirmed there. The HTML UI points to the
  **in-process** model for v1.
- **There is no secret store like VS Code's SecretStorage.** Use Windows Credential Manager, or
  DPAPI. Never the Settings store and never the `.vs` folder.
- **There is no WebviewPanel equivalent.** Use a dockable tool window. A custom editor tab is
  heavier and is not needed.
- **There is no free theme system like `--vscode-*`.** Read Visual Studio colors with
  `VSColorTheme.GetThemedColor` and send them to the page as CSS custom properties.
- **Node's single-executable format is still stability 1.1** and needs a temp-file extraction step
  for native modules. Plato has no native modules, so ship the standard `node.exe` plus one bundled
  CJS file. Do not use SEA or `node-api-dotnet` in v1.
- **Marketplace policy requires disclosure of executable code**, a privacy policy, HTTPS, and no
  credentials in the listing. The bundled Node runtime must be named in the listing.

**The architecture.**

```
Visual Studio 2026
  └─ Plato VSIX (C#, in-process VSPackage, WPF)
       ├─ tool window + WebView2 → existing chatHtml()
       ├─ native: theme, Credential Manager, dialogs, open file, solution root
       └─ newline-delimited JSON over stdio
            ↕
       Node 22 sidecar
            ├─ vscode API shim
            ├─ existing IDE host (packages/vscode/src/extension.ts, unchanged)
            └─ @applivity/plato-core (unchanged)
```

The shim implements only the ~25 `vscode` members the extension uses. Settings, sessions, titles,
folding, attachments, card copy, and the edge cases the field tests found stay in one place. The
chat UI does not change: C# injects a small `acquireVsCodeApi` adapter and a WebView2 message
bridge before the page script runs. The render harness already proves this pattern by faking
`acquireVsCodeApi`. The agent runs in a separate process, so a sidecar crash does not stop Visual
Studio.

**The Windows repair, in specific terms.** One `shellPlatform.ts` answers which program runs a
command: `/bin/bash -c` on POSIX, `%ComSpec% /d /s /c` on Windows. Process trees are killed with
`taskkill /T /F` on Windows. MCP commands resolve `.cmd` shims. On Windows, `plan` **denies** every
shell command and draws no card, because asking could let a write run under plan's name; `edit`
**asks** for every shell command, with no read-only auto-approval; `auto` is unchanged. The bash
read-only tokenizer does not describe `cmd.exe`, and a wrong "read-only" answer is a security
defect. POSIX behavior does not change. A Windows allowlist is a later security project.

**The gates.** M1 proves the shim on macOS with a fake panel and a scripted run. M2 proves the shell
in a real Visual Studio 2026 window. If the shim cannot pass M1, switch to the bridge before
building parity. If the shell cannot host the page and the sidecar in M2, fix the shell before
adding features.

**Ownership.** The **Plato CLI worker** (the tab on the Mac) writes the M0 code and its macOS tests,
because M0 is shared-core and CLI work. The **Windows machine worker** verifies M0 on Windows and
owns M2, because it has Visual Studio 2026 and the Windows test loop. M2 may start in parallel with
M0: the first shell run uses `write_file` and `read_file`, not the shell tool. No parity and no
public release until M0 is green.

**M1 passed (2026-10-23).** The existing VS Code host now runs outside VS Code through
`packages/vs/host/shim/vscode.ts`. The spike bundles the compiled host with `vscode` aliased to the
shim, starts `activate()` with a fake panel, and drives three scripted runs through the real host:
a `write_file` with the approval card and the file on disk; `/undo` removing the file Plato created;
a question card and a mode request, with the picker told `auto` and the run continuing. It persists
the mode in `workspaceState`, writes three transcripts under `~/.plato/runs`, and disposes the panel
cleanly. **The strict alias check is clean:** the whole host type-checks against the shim, so a
missing API member is a compile error. Core is 886/886, CLI is 175/175, and all 25 render suites
pass. **The bridge is not needed for the shim gate**; it remains the fallback if a later parity item
cannot be expressed through the shim. The proof is `packages/vs/test/spike.mjs`.

**M0 and M2 (2026-10-23).** M0 is **DONE and verified on Windows**: Mac core 908/1 skipped and
CLI 180; Windows core 907/2 skipped and CLI 177/3 skipped; a real `cmd.exe` command, a background
shell read and killed, and the fake MCP `echo` tool passed with 5/5 transcript checks. The first
Windows run found 21 core and 3 CLI failures (POSIX command strings and file-mode assumptions); all
were fixed, and `resolveInRoot` now returns forward slashes on Windows. **M2 is PASSED
(2026-10-23):** the C# shell, the WebView2 tool window, the sidecar, and the VSIX were built and
witnessed in a real Visual Studio 2026 18.11.1 window. A scripted `write_file` run drew the approval
card and wrote the file, the transcript landed in `~/.plato`, light and dark screenshots exist, and
the sidecar exits when Visual Studio closes. Commit `6697d81` is on `vs/m2`; the bundle is
`C:\src\vs-m2.bundle`. **VS 2026 18.11.1 Community is installed on Windows 10; Microsoft supports
VS 2026 on Windows 11 only, so the final acceptance belongs on Windows 11.** CLI 0.1.4 and VS Code
extension 0.26.7 were released from `main` at `e154a1f`; `plato-bugs` and `windows/m0` are merged
and deleted.

**Open items.** The Marketplace VSIX size limit, signing requirement, and review time; the item id
(`applivity.plato-vs` is the working name); the privacy policy; diagnostics after a write (the
Error List API for third parties is not clearly documented; report "not checked" if unavailable);
ARM64; a shared settings store with the CLI; and a Chats tree (the in-panel History page is enough
for v1).

**Files:** `packages/vs/PLAN.md` (the plan), `docs/HANDOFF.md` (current state), `docs/PROGRESS.md`
(the phase row and change log), and the future `packages/vs/src/` and `packages/vs/host/`.

**Verification:** the plan's milestone exit criteria; core and render suites on macOS; a Windows CI
job; shim contract tests; a scripted run through the sidecar; a real Visual Studio window driven by
FlaUI plus the WebView2 DevTools protocol, with screenshots and transcript witnesses; and a clean
Windows VM install with no Node installed.

---

**D49ce — the CLI has a start screen: the owl from the mark, a wordmark, and one line of wayfinding (2026-10-22).**

**Why.** The founder's report: *"the start screen is very blank-ish"*, and after the first draft,
*"the logo looks unimpressive and the word PLATO looks more like RLATO."* Both were fair. A terminal
that is the front door to the product opened with one grey line and a cursor.

**The owl is drawn from the mark, not sketched.** The extension's icon is a rounded head with two ear
tufts, two big eyes and a small beak. The art was **rasterised from the same geometry** — corner
tables, not hand-typed characters — at two pixels per character row with `▀▄█`, so the curves are
round and the eyes are true circles. The eyes are CUT (the terminal background shows through) with
the pupils left filled, and the beak is painted in its own colour, so the face reads at a glance.
Two earlier hand-drawn drafts were rejected by inspection: one had eyes that read as goggles, and
one put the beak in the chin as a sliver that looked like a tongue.

**The wordmark was rebuilt twice, and the second rebuild came from critique.** The first draft's P
was `█▀▀▄ / █▀▀▄ / ▀  ▀` — the bottom row's two feet made it an R, exactly what the founder saw. The
repair made it four thin rows, and the founder's next note was that it still looked weak beside a
solid owl. Three independent reviews (typography, competitor research, terminal rendering) then
agreed on the cause: one-pixel strokes are 18% of the owl's ink and 31% of its height, so the word is
a caption. **The final mark is six rows of full blocks with two-pixel stems and bars, 35 columns
wide, 46% of the owl's height.** The P closes its bowl and carries two rows of stem with no ink under
the bowl's right side — the cue that reads as R — the A has a full crossbar, the T a two-wide stem,
and the O is closed. `bold` was removed from the block art: it does not thicken block glyphs, and in
some terminals it brightens instead, which was part of why the old word sat thin.

**Three forms, chosen by the window.** Side by side (owl + wordmark, 66 columns) when the window is
at least **68 columns and 24 rows** — two columns of slack, because a line exactly as wide as the
window can wrap; the wordmark alone from 37 columns; one line below that. At
24 rows the side form drops the path line rather than the owl, and it fits exactly with the header,
status, and composer still on screen — measured, not assumed. The path is shortened with `~`, the
middle dropped, and capped at the window's width; the tips shorten at 64 and 40 columns so they
never wrap mid-word.

**It shows only on an empty conversation.** Once there is a row, every line belongs to the work; a
banner would cost space in every scrollback for the rest of the session. A resumed session has rows
already, a `plato "task"` start runs at once, and `plato -p` and `--plain` have no Ink screen at all.
`/new` clears the rows and the screen returns — verified.

**Colour, and one measured gap.** Cyan owl and wordmark, yellow beak — no new palette, the brand's
own accent. **`NO_COLOR` is honoured by this screen** (cyan spans drop from 18 to 2 — the two that
remain belong to the header), but **Ink's own `Text` colours ignore `NO_COLOR` in this build**: the
mode colour and the card borders stay coloured. The plan has claimed since M3 that `NO_COLOR` is
respected; that claim is true of this screen and false of the rest, and is recorded here rather than
quietly fixed, because disabling colour everywhere in the renderer is its own change.

**What the critiques changed, and what they did not.** Adopted: full-block glyphs only where the
mark is solid (Monaco ships `█` but not `▀`/`▄`, so a half-block wordmark could fragment), two-pixel
strokes, optical rather than geometric vertical centring (the owl's ink is bottom-heavy, so the mark
moves down one row), no `bold`, and the wider guards above. Rejected: enlarging the owl's eyes and
re-cutting the beak. Those critiques read the dark eye sockets as background and the cyan centres as
the whole eye, so their "small eyes" were the pupils — the opposite of the art. The screenshot is the
evidence, not the text transcription.

**Verified.** Unit tests for the layout thresholds and the path shortening; CLI **175/175**;
`tsc -b --force` clean. **Driven in a real pty at four sizes** — 100×40 and 80×24 draw the owl, the
wordmark and the tagline with no clipping; 40×30 and 30×30 fall back without a wrapped word; `/help`
retires the screen and `/new` brings it back; `NO_COLOR=1` removes the owl's and beak's colour and
keeps bold. The bundle is still six tarball files.

---

**D49cd — the composer's `/` menu: one table, a filtered list, and ten rows that scroll (2026-10-22).**

**What it does.** A slash at the start of the composer opens the command list. Typing after the
slash filters it by name prefix, case-insensitively. `↑`/`↓` move the selection, `Tab` fills the
command into the line, `Enter` selects — and for a command that takes no arguments, runs it, because
a second Enter to say "yes, that one" is noise. A command that takes arguments is filled in with a
trailing space and waits for them. `Esc` closes the menu until the text changes; a space ends the
name and closes it, so the menu never competes with argument typing. `↑`/`↓` fall back to prompt
history whenever the menu is closed.

**The list is capped at ten rows, and it scrolls with the selection.** Ten is what fits above the
composer without hiding the conversation; a longer list moves one row at a time as the selection
reaches either edge, and the footer reads `3–12 of 14` so a missing command is visibly a scroll
away. The cap is a constant (`MENU_ROWS`), not a layout accident.

**One command table.** `completion.ts` holds name, argument form, and one-line summary. The menu
draws from it, `/help` is generated from it, and a test asserts the help names every command. A
second list would have drifted the first time a command was added; there is now no second list.

**Why the state is in the App, not the session view model.** The menu follows the composer buffer,
and that buffer has always been the App's (`editor.ts` is pure, `App.tsx` owns the buffer). Putting
completion in the session would copy every keystroke into the view model to serve a control that
only the Ink renderer has. `completion.ts` is pure and fully tested, which is what the D49bw
principle actually asks for; the plain renderer has no menu and needs none.

**Verified in the real terminal.** At 80 columns in a `screen` session: `/` drew all ten commands in
declared order with Stay-style selection on the first, `/m` narrowed to `/mode` and `/model`, the
down arrow moved the highlight, `Esc` closed the menu with the text intact, `/he` narrowed to
`/help`, `Tab` completed it, `Enter` ran it (the derived help rendered), and `/mo` + `Enter` filled
in `/mode `, after which `edit` + `Enter` switched the mode. The pty harness cannot deliver DEL, so
backspace was verified by the editor's own tests, not here. Six unit tests cover the query rules,
prefix filtering, the ten-row window at every edge, the Enter/Tab split, and the help/menu agreement;
the CLI suite is 173/173.

---

**D49cc — the CLI offers the mode request, and its mode is read live (2026-10-21).**

**The boundary D49cb left, and why it was open.** D49cb said the CLI keeps the prose fallback until it
grows an equivalent card. There were two reasons, and a card alone would have fixed only one: the CLI
had no card, **and** its loop read `options.mode`, a run-start snapshot. A card that changed
`Session.mode` would have left the permission table in the old mode — the same silent disagreement the
extension's screenshot caught during D49cb.

**What changed in the host contract.**

- **`ExecuteOptions.getMode`** is the loop's live read. `executeTask` uses
  `options.getMode ?? (() => options.mode)`, so a host without one keeps the old behaviour and a
  host with one gets a switch at the next tool call. `options.mode` still decides `startMcpServers`,
  which is a run-start decision and not a permission.
- **`RunSink.requestMode`** is the card. `executeTask` passes the callback to the loop **only when
  the sink has it** — and that alone is what makes core offer `request_mode` and add the prompt
  paragraph. No second switch, no duplicated schema.
- **The record is emitted in `executeTask`,** around the sink call, because the host owns the bus:
  `mode-requested` on both answers with `from`, `to` and `approved`, and `mode-changed` only on a yes
  with `via: 'request'`. The run id comes from `run-started` rather than being guessed. **The
  model's reason is not recorded**, for the reason D49cb gives.

**What the terminal does.** A `mode` card: the target in the heading, the model's reason as its own
line, the target mode's meaning, the mode in force, *Stay in …* and *Switch to …*, **Stay selected by
default**. Only the second choice calls `setMode`, which updates the header and the status line and
saves the config. The notes and the three-per-run cap are the extension's, word for word, so the two
hosts say the same thing. **Cancel and Ctrl+C answer Stay** — Ctrl+C was ignored while a card was
open, which is the one moment the run is waiting on the user, so it is now the same as Esc.

**A defect this exposed in the CLI, fixed here.** `Session.cancel()` stopped the loop but left any
parked card's promise unresolved. The loop awaits a card with nothing that can interrupt the wait, so
a cancel with a card on screen did not unwind — the extension's D49aq fault, through the CLI's door.
Cancel now settles the open card with its safe answer (No, Stop, Stay, or the empty question) before
stopping the controller.

**Both other hosts still decline to offer it, deliberately.** `plato -p` draws no card, so a request
there could only be refused; offering the tool and then failing it would be the exact lie D49bk
removed. `--plain` has no card either and leaves `requestMode` undefined. It passes a live `getMode`
all the same, so its own `/mode` command is honest — it simply never advertises a request.

**Verified.** Host (4 new tests): the tool appears in the provider's list only for a sink with the
callback, and **not** through the one-shot sink `plato -p` builds; an approved request asks the sink
with the right target, reason and current mode, the note reaches the model, and the transcript carries
both events with the reason absent; the live read — a write refused in `plan` is approved in the
**same run** after the switch, with one approval proving the second call reached the gate; a decline
changes nothing, writes nothing, and records `approved: false` with no `mode-changed`. Session (4 new
tests): the card's fields and default, Switch updating the status line and the next write raising
edit's approval card, Stay and Esc leaving the mode with the decline line, the fourth request refused
without a card, and cancel settling a parked card. **The regression is proven by mutation**: with
`getMode` reverted to `options.mode`, three of the new tests fail and the rest pass. **The TUI under a
pty** (built file, scripted provider): both cards render, Switch moves the header to `edit` and the
next write raises the approval card, Ctrl+C leaves `plan` with the decline line and no write, the
transcript records each answer, and the reason never reaches it. **The real model
(`deepseek-flash`)**: plan, asked to create a file — it tried the write, was refused, called
`request_mode` with its reason, the card was approved, it wrote the file through edit's approval card,
and verified the content. **Nothing was published, and nothing was committed.**

---

**D49cb — the mode request is real: the model asks, the user's card decides, and the run continues
(founder, 2026-10-21).**

**The decision.** After reading the D49ca evidence and the competitor research, the founder chose the
request channel and rejected auto-resume on the picker: *"ignore my alternative. and go for Make the
mode request real."* The condition D49bk left is now met — the card acts on its own answer.

**What the model gets.** A `request_mode` tool, offered only to a host that can draw its card. It
takes `mode` (plan, edit or auto) and a one-sentence `reason`. The description says the user decides,
that a decline must not be repeated, and that a mode change never goes on an `ask_user` card. **Core
validates and never switches anything**: it refuses an unknown or already-current mode without
reaching the host, then hands the request to the host and returns the host's note as the tool result.
**The note on a yes names the mode now in force** — that is what ends the stale belief a run used to
carry until its next refused call.

**What the user gets.** A dedicated card: the target in the heading, the model's reason set apart as
its own block, the target mode's own description, and the mode in force now. The buttons are *Switch
to edit* and *Stay in plan*; only `allow === true` approves. **Cancel and panel close answer NO**, by
the same `releaseParkedCards` rule as every other parked card — the permission table must not change
because a run was stopped. A declined request leaves a line in the conversation, so a reload keeps
the fact that Plato asked. **Three requests per run** is the cap; asking again with a new sentence was
the way around the repetition bound, and the cap ends the nag without counting anything the user did.

**The record and the prompt.** `mode-requested` carries `from`, `to` and `approved` — so a DECLINED
request is in the file too, which `mode-changed` alone could not show. `mode-changed` gains `via`
(`picker` or `request`). **The reason is deliberately not recorded**: it is model prose written for
a card, and the transcript's rule is that model prose that could quote what was in front of it stays
out. The prompt now tells the model to use `request_mode` when the mode blocks a call. **The
instruction is appended as a host capability, not baked into the bundled body**: a host without the
card (the CLI, today) keeps the old prose-only paragraph and is never told about a tool it cannot
honour.

**One defect the first real screenshot caught, and the fix.** After an approved switch the transcript
said `edit` while the picker at the bottom still read `plan`: the host had changed the mode without
telling the view. `applyMode` now sends `mode-state` to the view — the picker was the view's own
account of the mode, and the two must not disagree. The scripted field case, the real cases and the
render suite all assert the label now.

**Boundary: the CLI does not offer the tool yet.** `request_mode` is declared only when the host
passes a `requestMode` callback, and the CLI does not until it grows an equivalent card; its mode is
also a run-start snapshot today, so a card there would not be honest. That is a capability for the
CLI milestone, not a defect in this one, and the prompt is already written to the host's capability.

**Verified.** Core: `request_mode` is allowed in every mode (the card is the gate); it is offered only
with the callback; a yes, a no, an unknown mode and the already-current mode each behave, and the
note reaches the model (five loop tests). The prompt names the tool only for a capable host (two
worker-role tests). The transcript carries both new events (one test). Render: a new **mode card**
suite (**35 checks**: the target, the reason, the target's meaning, the current mode, two answers, the
boolean answer, text-not-markup, dismissal, one live card, and the rebuild from the log on a reload)
plus **three checks in the mode suite** for a host-side switch moving the picker label and its active
row; **all render suites pass** (the mode suite is 31 checks). **Scripted field case 36** in real VS
Code: run 1 approves edit, the record is `mode-requested` → `mode-changed via request` → the write
through one card, the picker reads `edit`, the file is on disk; run 2 declines auto, no
request-driven change, no write, and the decline line is on screen. **Real model
(`deepseek-v4-flash`)**: all three pass. **Plan → edit:** the model tried the write, was refused, said
*"The write is blocked by plan mode, as expected. Requesting edit mode."*, called `request_mode`,
the card was approved, and it wrote and verified the file. **Plan → auto:** same shape, and the write
needed **no card** — the switch reached the permission table. **Edit:** the write asked and landed.
The picker read the approved mode in both switch cases. **This was the founder's credential file, run
because he asked for it explicitly; the key was read inside the harness and never printed.** A model
that does not ask is reported as a finding about the model, not a failure of the card — the prompt
invites the request but does not require it.

---

**D49ca — a mode switch is recorded, and the line says when it takes effect (founder, 2026-10-21).**

**The report, from the first real use of the product.** A user worked in `plan`, and Plato told them
the patch it would apply "the moment writes are permitted", with switching to `edit` as the unblock.
The user then either switched and expected Plato to resume, or believed they had switched while Plato
still acted as if in `plan`. They could not tell us which, and **the run record could not either** —
which is the defect this entry fixes.

**What the code actually does, and it is not a detection failure.** The permission table reads the
mode at **every tool call** (`getMode`), the picker is never disabled, and the host accepts a switch
at any moment (D49bj). A run that is still live does use the new mode at its next call. Two different
facts produced the observation:

- **A switch made after the run ends starts nothing.** The model's last turn handed the decision back
  to the user, which is how a run normally ends. Clicking the picker then changes the mode for the
  next request; it does not resume the request that just finished. The line said `Mode: edit` and
  named no consequence, so the customer expected the run to continue — a fair reading of a line that
  did not say what it meant.
- **The model is never told the mode.** This is deliberate (D49bk): the prompt names the three modes
  and never says which is active, so a model learns where it stands only when a call is refused. A
  model whose previous turn said *"switch to edit and I will apply it"* has no later event that tells
  it the switch happened. It has to try a write to find out, and a cautious model may ask again
  instead — the exact loop the customer described.

**What was built, and it is the record half only.**

- **`mode-changed` is now a structured transcript event** — `from`, `to`, the click's `at`, and the
  run it belongs to. It is emitted when the click lands during a live run, and **held and emitted
  after the next run's header** when no run is live, because a transcript is per run and does not
  exist between them. The header still names only the mode the run BEGAN in; that fact did not
  change. A reader can now tell a switch during a run from one before it, which is the question this
  report could not answer.
- **The chat line says when the switch applies**: *"applies from the next tool call"* during a run,
  and *"applies from your next message"* when idle. The second sentence is the expectation the
  customer did not get. A card already on screen keeps its verdict (D49bj), so the live wording names
  the next call rather than the rest of the run.
- **The mode message is validated against the three the picker offers.** D49bj validated the STORED
  value because it comes off disk; the message is the other boundary into the permission table, and
  an unrecognised value fell through `decide` as `auto` — a permission it never earned. Ignoring a bad
  value is the safe answer, and the picker offers nothing else.

**What the competitors do — researched 2026-10-21 because the founder asked whether Claude Code and
Cline continue by themselves, and it is NOT auto-resume on the picker.**

- **Claude Code:** switching permission mode by hand (Shift+Tab) changes the posture **for the next
  turn** and does not send a message. **Approving `ExitPlanMode` does continue automatically** — the
  approval is a tool result that tells the model the plan is approved, and it exits plan mode, so the
  model goes straight on to editing. The automatic half belongs to the model's REQUEST, not to the
  user's toggle.
- **Cline / Roo Code:** the `switch_mode` tool lets the model **request** a mode change, with a
  reason and an optional target; **the user must approve it**, and then the model continues. Its Plan
  & Act documentation describes the manual toggle with the conversation carried over, not a toggle
  that starts a run. The model-initiated switching users complained about in
  [cline#10497](https://github.com/cline/cline/issues/10497) — *"it will just switch automatically to
  act mode and start implementing"* — is a different, newer behaviour, which the maintainer called
  expected while saying they would *"re-think this approach"*.

**So the pattern the founder remembered is a real request from the model that the user approves.**
None of the three auto-sends on a manual mode switch. That makes auto-resume-on-the-picker a
Plato-specific choice, and the competitor evidence points instead at **making the mode request real
again** — the condition D49bk left: the host accepts a mode request and switches on a Yes. That is a
posture choice for the founder, not a defect, and it is NOT built.

**Two things were deliberately NOT done, and they are the founder's call.** **An idle switch does not
auto-resume the last task** — a click has never been a request to spend a model call, and the user may
have switched to do something else. The founder raised auto-resume on 2026-10-21; it is recorded as
an open choice, not built. And **the model still is not told the active mode**; that is D49bk's
posture, and this entry does not quietly reverse it. The diagnosis above says putting the mode in the
run's prompt would end the stale-belief half; it also says the record and the copy are what could be
done without changing that posture. **If the stale belief recurs in real use, the prompt line is the
repair to decide then.**

**Verified.** The transcript test pins the event and its fields, and fails without the whitelist
change (the class this test exists for). The mode message's validation is host-side and has no unit
test; the field harness drives the real picker. **Field case 4 switches `plan` → `edit` between its
two runs, and both transcripts now carry the event before their first turn** — run 1 records
`edit → plan` at 16:53:57.265 with its header stamped 16:53:57.847, and run 2 records `plan → edit`
at 16:54:00.416 with its header stamped 16:54:01.035. **The click's `at` precedes each run's
`startedAt`, which is the between-runs fact the header alone could never state**, and it was read
back from the files rather than inferred.

**The customer's story is now two field cases, run in a real window on 2026-10-21.** **Case 34** is
the idle half: the plan run's `write_file` is refused with no card and the probe file stays absent;
the driver then switches to `edit` through the real picker **and sends nothing for 2.5 seconds**, and
no run starts — the transcript set is unchanged. The message after it produces one card, the write
lands, and the screen says *"applies from your next message"*. **Case 35** is the live half: the run
starts in `plan`, the write is refused, and the driver waits until the refusal has reached the model
(the stub's log is the mid-run witness) before switching to `edit`. The record's order is exact —
`write_file:denied` at index 4, the `mode-changed` at 6, `write_file:done` at 13 — the click is
*after* `startedAt`, and the retried call asks through one card. **The model's words in both cases are
scripted**, because the scripted suite replaces the model; the real-model pass is the founder's to
run, and no claim here rests on what a real model would say.

---

**D49bk — the mode-change question card is closed, because its answer would be a lie (founder,
2026-10-07).**

**This closes the one thing D49bj recorded and did not fix.** That entry left a risk: with `auto`
live and reachable, a model could ask the user to loosen the mode mid-run. The founder read the
whole picture back and reached the sharper conclusion himself — *"it is only a suggestion then no
point showing a question card"* — and he was right, for a reason worth writing down precisely.

**First, a correction to this repository's own account of itself, made while answering him.** An
earlier statement (mine, in conversation) was that the worker prompt never names the three modes.
**That is false and the prompt says so at the top:** *"Modes gate how edits are approved (plan =
read-only, edit = writes and commands with your approval, auto = trusted) and the host enforces
them."* What the prompt does **not** say is **which mode is active** — the mode is never passed into
`buildWorkerRole`, so the model knows the vocabulary and not where it stands. It learns where it
stands one way only: by being refused. In `plan`, a write or a non-read-only command returns
`blocked: <tool> is not permitted in plan mode` as a tool result, and that single line names the mode
and implies the one that would allow the work. **So there is no detection in Plato and no
suggestion machinery** — there is a refusal, and a model that can read it.

**Second, why a card is worse than useless here, which is the whole decision.** A question card's
answer travels back to the model **as a tool result**. So a card reading *"switch to auto?"* would
return **"Yes"** to a model whose mode is unchanged: **the model is then told the user agreed to
something that did not happen, and its next move rests on a permission it does not hold.** In `edit`
it recovers, because the write raises its own card; in `plan` it hits the same wall again. It is
recoverable, and it is still the exact failure this codebase keeps removing — a control whose own
framing implied it would act, leaving a false belief behind. **The card was rejected for creating the
belief, not merely for failing to act.**

**Third, why the fix is wording and not a guard.** There is nothing to enforce. The model has no mode
tool, and core is handed a read-only getter, so it **cannot** change the mode; the only defective
channel is the wording it chooses. So one passage joins the prompt where modes are introduced: *the
mode is the user's to change and you cannot change it; if a call comes back refused because of the
mode, say in one sentence what you would do if it were permitted and let the user decide; never put a
mode change on a question card.* **The positive half is as load-bearing as the prohibition** — a rule
that only forbade the card would leave a model that hit a refusal with nothing to say, and a refusal
is exactly when the user most needs to hear what is blocked. Prose keeps the decision with the user,
which is where D49bj recorded that it belongs.

**The alternative, named and not taken: make the card real.** The host could accept a mode request and
switch on a Yes. That would make the card honest — and it would hand the model a sanctioned channel
for asking to loosen its own permissions mid-run, which is the one party with an incentive to ask. It
is a posture choice rather than a defect, and it stays available.

**Verified.** Three assertions pin the passage — the prohibition, its reason, and the positive
instruction — and **each half fails on its own when removed**: deleting the card sentence fails one,
and deleting the statement-plus-instruction fails two. Everything else was re-run green on the same
state: `tsc -b --force` clean, **825 unit tests**, render **21 suites / 595 assertions**, bundle and
inline syntax check, and the field acceptance suite re-run because a prompt change alters what a real
model is told — **7 of 7 clauses over 23 cases and 30 runs**, with clause 2 (the gates hold, per mode)
and clause 5 (the run's account of itself is honest) the nearest to the change. **The new passage is
confirmed present in the built bundle**, not only in the source.

**Files:** `packages/core/src/runtime/workerRole.ts` (`DEFAULT_PLATO_BODY`), **Tests:**
`packages/core/test/workerRole.test.ts` (a new `D49bk` block).

---

**D49bj — the mode is remembered, and a mode switch is written into the record (founder,
2026-10-06).**

**The question that found it: does Plato handle a mode switch mid-turn?** It does, and that part is
deliberate — the mode is read fresh at **every tool call**, not snapshotted at run start, which is
exactly the fix the founder's own act→edit switch forced in M1 (`getMode` is read live in the loop).
The picker is never disabled and the host accepts a switch at any moment, a card on screen included.
**But three things around that live switch did not hold up, and two of them were silence.**

**1. The mode did not survive a reload.** Neither half stored it. The host started at `edit` and the
view started at `edit`, independently, so after any reload — a window reload, an extension update, a
VS Code restart — **the user's choice was gone and nothing said so.** This is the identical defect
the model picker already had fixed for the model (D49x: *"its choice is a preference and must outlive
the panel"*), and the mode never got the same treatment. **The two sides agreeing by luck is what hid
it**: both defaulted to the same value, so the disagreement this creates was invisible until one of
them was stored. Storing one of them alone would have been worse than storing neither.

**2. A switch left no trace in either record.** The line the user sees when they switch was posted to
the live view alone, never pushed into the saved conversation — so a reload dropped it — and it was
never a bus event, so the run transcript never had it. Worse, **no run record named the mode at all**,
not even the one the run began in. A transcript could therefore not tell a write that a card let
through from one that ran free in `auto`, unless the reader reconstructed it from the approval rows —
and a run in `edit` where nothing happened to be gated is indistinguishable from a run in `auto`.

**3. A card already on screen is not reconsidered.** Switching to `plan` while an approval card is up
leaves the card live, and Allow on it still writes: the verdict was computed under the mode in force
and the switch does not withdraw it. **This is deliberately left as it is.** The user is the one
clicking, Deny is on the same card, and the honest fix is wording rather than mechanism — the notice
now says the change applies from the next request. **Auto-answering the card was rejected outright:**
a mode click that resolved a pending approval would grant a permission the user never gave for that
action, which is the opposite of the rule the codebase already follows everywhere else — a card
released early is always answered with the SAFE value (`releaseParkedCards` denies, cancels and
stops).

**What was built, for 1 and 2.** The mode is stored beside the log and the title, validated **on the
way in** because a stored value is a boundary and an unrecognised one would otherwise reach the
permission table and deny every tool; the host sends it on the restore payload, because the view
cannot guess it. **And the record now carries the mode twice, from two different truths:** the run
header names the mode the run **began** in — a required field on `run-started`, not an optional one,
so an emitter that forgets it is a compile error rather than a record that cannot say what its own
writes were gated by — and a mid-run switch is pushed into the conversation and emitted as a notice
on the run's own bus. **The field means "what this run started under" and never "what it ended
under"**; a single field claimed over the whole run would be wrong about every write made before the
switch, which is why the switch gets its own line instead. The transcript's `schemaVersion` stays
**1**: the field is added, not redefined, and nothing branches on the number — a bump would claim the
older shape needs different handling, and it does not.

**The known risk, addressed by D49bk and otherwise left: the model can ask for its own loosening.**
`auto` is the wide mode and the switch is live, so a model can write *"this needs several commands —
switch to auto"* mid-run and one click removes the card from every remaining write and every remaining
fetch. **Nothing is bypassed** — the user still clicks, and can decline — but the model is now a party
that can request more permission in the middle of a run. There is no mode tool and no setter: the mode
is host state reachable only from the panel's own picker, so a model cannot switch it, only ask.
Freezing the mode for the duration of a run would undo the live switch M1 exists to have. **D49bk
closes the one channel that made this worse than a suggestion** — a question card, whose answer would
have told the model the user agreed while nothing changed — and leaves the ask itself in prose, where
the decision stays with the user.

**Verified, and each assertion falsified.** The run record's starting mode: hardcoding a wrong mode in
the emit fails the loop test, and snapshotting the mode once before the loop — the old bug — fails its
companion assertion that the mode is genuinely re-read after the run starts. The header's field:
removing it fails the transcript test. The view's restore: removing the `setMode` call fails three
render assertions. The replayed switch line: giving that log row an unknown kind fails the two
assertions that draw it. **One assertion was rewritten because it was not discriminating** — *"a
stored value that is not a mode falls back to edit"* also passes when the payload is ignored
entirely, so it cannot tell "validated" from "never read"; it is replaced by a second restore that
must land, which does fail when the feature is removed. The junk-value guard is asserted where it is a
real boundary instead: the host, which reads the value off disk.

**And confirmed end to end in a real window, which is the check that matters for a record.**
**Field acceptance: 7 of 7 clauses over 23 cases and 30 runs**, and the transcripts those runs left
were read back afterwards: **the headers carry `plan`, `edit` and `auto`**, each matching its own
case — `"mode":"auto"` on *Print the environment file in the workspace root*, `"plan"` on *Read
local.properties and summarise it*. So the value written is the run's real mode and not a constant
that happens to satisfy a test. **What is still not covered, stated rather than implied: no case
switches mode MID-run**, because the harness sets a case's mode before the run starts and drives no
switch during one — so the live read rests on the unit and render tests and on M1's own history, not
on a real window.

**Files:** `packages/core/src/runtime/bus.ts` (`run-started` carries the mode),
`packages/core/src/runtime/loop.ts` (the emit), `packages/core/src/runtime/transcript.ts` (the
header), `packages/vscode/src/extension.ts` (the stored key, the restore, the switch handler, the run
id), `packages/vscode/src/webview.ts` (the restore applies the mode). **Tests:**
`packages/core/test/loop.test.ts` (one new block), `transcript.test.ts` (the header assertion),
`bus.test.ts` (the event literal), `scripts/render/modes.mjs` (two new blocks, nine assertions).

---

**D49bi — an observer's cancel releases the parked cards, because only the user's Cancel button ever
did (founder, 2026-10-06).**

**The defect, found while auditing the parked cards for D49bg and fixed on the founder's instruction
— *"if this can easily be fixed with low risk do it, and if not leave it for later."*** The release
of every parked card lived **inline in the user's own Cancel button**. The button unblocked a waiting
approval, question, stuck card and reveal card, and then cancelled. **An observer in `duo`/`academy`
never ran that code**: it called `controller.cancel()` directly, which sets the abort flag and wakes
the pause gate — and then the run stayed parked anyway, because the loop is `await`ing a card's
promise, and **that await is not signal-aware**. So an observer could not end a run the user had not
answered. It is the same defect D49aq fixed for the button, and it survived that fix because the fix
went into the button rather than into the operation.

**The fix is an extract-method, which is what made it low risk.** `releaseParkedCards()` holds the
release and both callers now run it: the button, unchanged in behaviour because the statements are
the same ones moved, and the observer's cancel, which is the new caller. The owner of the fact — *a
cancel must answer every card the run is parked on* — is now one method instead of a block inside one
of its callers.

**Why the other candidate fix was NOT taken.** The alternative was to make every parked `await` race
the abort signal, so that an abort released a card by itself. That is the deeper fix and it was
rejected for now: it changes four awaits in the loop, each needs to know the SAFE answer to resolve
with, and the host would still need telling so the card leaves the screen — a protocol change, not a
refactor. **This entry buys the behaviour without touching the loop**, and leaves the signal-aware
version available if a third caller ever appears.

**The taxonomy this corrected, and it was an error in an earlier draft of D49bg.** Four cards park a
run — approval, **question**, stuck, reveal. **Four cards were recorded in the log** — approval,
stuck, undo, reveal. The sets differ by the undo card, which is raised between runs and keeps **no
resolver**, so it has nothing to release and is deliberately absent from the new method. An earlier
draft listed undo among the parked cards and said "five parked cards"; both were wrong, and the audit
that fixed the code is what caught them.

**Verified as far as this repository can, and no further — stated because the shell has no unit
tests.** The button path is **behaviourally identical** because the release is the same statements
moved, and the second caller is inert on the fields the first already nulled. The regression evidence
is the field harness, re-run on this change: **clause 7 (Stop works — cancel ends the run as cancelled
and dismisses the card) and clause 4 (the observer path is live in Duo) both pass**, and those are the
two clauses that exercise the code that moved. **There is no automated check that an observer's cancel
releases a card**, and making one means scripting a stub that emits a `cancel` intervention while a
card is on screen — possible, flaky, and not bought here. It is recorded rather than implied.

**Files:** `packages/vscode/src/extension.ts` (`releaseParkedCards`, the button's cancel branch, the
observer's `action === 'cancel'` branch).

---

**D49bh — a question's recommended option is resolved against its own choices, and a miss is recorded
rather than silent (founder, 2026-10-06).**

**The defect, and it is the quiet kind.** The model writes `recommended` and `options` as two
separate fields of one `ask_user` call, and nothing tied them together. The card compared them
**exactly**, so a model that abbreviated its own label — recommending `"Keep signatures"` where the
option read `"Keep signatures and correct minimally"` — marked **nothing at all**. The card rendered
perfectly, the question was asked, the options were all there, and **the loss was invisible in all
three places it could have shown**: the user saw a card with no recommendation and no way to know one
had been meant, the model was never told its recommendation was ignored, and the run record said
nothing. This is the same shape as the defects this repository keeps removing — a failure
indistinguishable from normal operation.

**The founder's call, and it sets the shape: the question is what matters.** *"doesn't look like a big
problem if the card can't show word 'recommend' but we will do our best effort and yes questions can
still and should be shown and answered by user normally."* So **a miss never withholds the ask.** The
alternative — refusing the call — was already rejected for this exact tool, when an over-long option
list was allowed through for the same reason: the model had already decided to ask, and a card that
cannot show the question is a worse outcome than a card missing a marker.

**The leniency is bounded, and the bound is the point.** Matching ignores surrounding whitespace and
case, which covers the realistic slips. It **can only ever find the same option or find none** — a
prefix is explicitly NOT accepted, because `"Change"` starting `"Change and fix callers"` would put a
recommendation on screen that the model never made, and **a recommendation on the wrong option is
worse than no recommendation**. For the same reason, two options differing only in case resolve to
nothing rather than to a guess. The resolver returns **the option's own string**, not the model's, so
the view's exact comparison stays correct and **one place decides what a match is**.

**A miss is audible.** The loop emits a `notice` on the run — the channel it already uses for things
it has to say about an ask — naming the question whose recommendation was dropped. It is deliberately
**not** on the user's card: that would tell the user about a field they cannot see. **What it cannot
do is repair the call in flight:** `ask_user`'s result *is* the user's answer, so the model is parked
between the question and the answer and is first told anything when the answer comes back. The note
therefore reaches it too late to fix that question — it can only do better on the next one. That is
the accepted cost of never withholding a question, and it is the reason the alternative (refuse and
let it retry) exists but was not taken.

**Verified, five falsifications, each reverted and re-run green.** Restoring the exact comparison
fails four assertions (spacing, case, the ambiguity bound, and that the OPTION's string is returned);
accepting a prefix fails three, including the one that forbids marking the wrong option; making a miss
refuse the call fails the test whose whole subject is that the question is still asked; removing the
notice fails it too. **A sixth gap was found by the work itself:** `recommended` had been in the
`question` render suite's fixtures from the start and **no assertion had ever checked what it does** —
the field was exercised and its one visible effect was unpinned. Nine assertions now cover it: exactly
one option marked, marked on the full label the model named, nothing marked when there is no
recommendation, and a recommendation on a **checkbox** question alongside its boxes.

**Files:** `packages/core/src/runtime/loop.ts` (`resolveRecommended`, exported, plus the `ask_user`
arg mapping and the notice). **Tests:** `loop.test.ts` (a resolver block, 8 assertions, and one loop
test), `scripts/render/question.mjs` (block I).

---

**D49bg — the question card is recorded, and the answer it produced is too (founder, 2026-10-06).**

**The gap, and the two counts it turns on — which an earlier draft of this entry ran together.**
**Four cards were written into the transcript log** — approval, stuck, undo and reveal — so a reload
replayed them and the user could still act on them. **Four cards PARK a run**, meaning each holds a
promise the loop is `await`ing with nothing else able to interrupt it: approval, **question**, stuck
and reveal. The two sets are not the same set, and the difference is the undo card, which is raised
between runs and keeps no resolver, so there is nothing for a reload to lose. **The question card was
therefore the only PARKED card missing from the log**, and the only recorded card missing from it as
well. It was posted straight to the view and never written down, so a reload that discarded the
webview took the card off the screen while the host stayed parked on a promise nothing else could
resolve — a run waiting for a click that could no longer be made. The founder asked for it closed
after the audit said which card was missing.

**Two rows, and the second is the one that makes the transcript honest.** `question-open` carries the
questions, so the replay rebuilds a card that is still answerable; `question-done` closes it, so an
answered or cancelled question does not come back. Without the second, a reload would resurrect a
question the user had already dealt with.

**The answer echo is the other half, and it was not in the request but is the same fault.** The
question and the user's answer existed only in the view: the host pushed nothing for either. A
reload therefore lost the whole exchange, and — worse, because it is invisible — **a fold summarised
a run in which the user appeared to have said nothing at all.** D49ag fixed exactly this shape for
tool rows (*"a fold summarising the row could not say what the run had done"*). The host now pushes
one `msg` row per question, worded identically to the view's own echo, so a reloaded transcript reads
like the live one. **The cancel path deliberately writes no echo row:** the user answered nothing,
and a row saying otherwise would be the transcript lying about what happened.

**The `multiple` flag has to travel with the record, and that is a behaviour fix, not bookkeeping.**
The card draws boxes for a multi question and circles for a single one. A restored card that lost the
flag draws **circles** — which does not merely look different, it silently changes what the user
believes they may pick. The value was already arriving at runtime; the shell's declared type was
narrower than it, so the shell was the one place that could not see it. The shared `AskQuestion`
type now carries it.

**Verified.** A new block in the `question` render suite rebuilds from the exact rows the host now
writes and **drives the card to Submit**, because "a card is present" passes on a card whose buttons
do nothing; it also feeds the closed sequence and requires **no** card. **Four falsifications, each
reverted and re-run green:** removing the `question-open` replay fails five assertions; removing
`question-done` fails the two that require the card to stay closed; dropping `multiple` from the row
draws **4 radios where 4 boxes belong**; removing the echo row fails the transcript assertion. The
"no card" assertions were first written as bare absences, and the falsification showed they passed
**vacuously** when replay drew nothing at all — so the block now draws the card from the open row
first and then requires it gone, which is the rule D49aj records for the same mistake.

**One guard the recording made necessary, and it is why the two handlers are not symmetric with what
they were.** Both `user-answer` and `cancel` are received whether or not a question is open — a
reloaded transcript can leave an old card clickable, and every ordinary cancel arrives the same way.
Writing the closing row unconditionally would have put a `question-done` row in the log for every
cancel, and an echo row for every click on a stale card, **inventing exchanges that never happened.**
`user-answer` with nothing pending is now dropped outright, and the closing row is written only when
a question was actually open.

**Boundary, stated rather than implied.** The view half is proved by the render suite, which feeds
the rows; **that the host writes them is type-checked and read, not tested** — the shell has no unit
tests and a window reload takes the extension host with it, so the field harness cannot reach this
either. **Found while auditing the parked cards, and left open here:** an observer's cancel did not
release a parked card. It was pre-existing and not caused by this change, and **D49bi fixes it.**

**Files:** `packages/vscode/src/extension.ts` (`AskQuestion`, the two `Entry` rows, `askUser`,
`openQuestions`, the `user-answer` and `cancel` handlers), `packages/vscode/src/webview.ts` (two
`appendEntry` cases). **Harness:** `scripts/render/question.mjs` (blocks G and H, 13 assertions).

---

**D49az — undo is BUILT: the copy is taken at the executor, and the plan is made again when the
user clicks (Tier C item 3, built 2026-09-28).**

D49ax decided the shape. This is what was built from it, in three parts, plus **four places where
building it changed the decision** — recorded because a silent deviation from a decided design is
exactly what this repository keeps having to un-believe.

**1. The capture is at the EXECUTOR, not at the approval preview, and that is not a detail.**
D49ax said the old bytes are *"already read at the write site for the guard and the approval diff"*.
Those are two different places and only one of them is always reached. `buildApprovalPreview`
([loop.ts](../packages/core/src/runtime/loop.ts)) reads the file — but **`auto` builds no preview
at all**, which is the mode where an undo matters most, because nothing else stands between the
model and the disk. So the copy is taken inside the three write tools in
[execute.ts](../packages/core/src/tools/execute.ts), each of which reads the previous content
unconditionally, in every mode. **The proof is field case 18, which runs in `auto`**: a design that
captured at the preview would store nothing there and the case would find nothing to put back.

**2. The plan is made again when the user clicks, never held from the card.** This is the one
place where the obvious implementation is the bug. The card names specific files and sizes; the
tempting move is to keep that plan and apply it. But between reading the card and clicking it, the
user can edit a file — and then the old copy goes back over their work. That is Kilo Code's
reported bug, and it would be this feature's too. So `applyUndoNow` re-plans from the files as they
are at that moment, and anything that changed in between is refused and reported. The card is a
description of a moment; the guard has to be evaluated when the write happens.

**3. A file Plato CREATED is undone by deleting it.** D49ax was silent on this, and it is the
feature's one destructive action. Only `write_file` can create — `apply_diff` and `apply_patch` both
refuse a missing file — and for a created file there is no before to put back, so "undo" means
"remove it". That is not collateral damage: the file exists *because this request made it*, so
removing it is what undoing the request means. It is still the case Cline's worst bug came from, so
it is guarded the same way everything else is: the fingerprint is checked first, a file the user has
edited since is refused, and deletes are performed LAST, after every restore has landed. The card
says **"Plato created this one, so it is removed"** rather than "put back", because a click that
deletes a file must not be described as a restore.

**And the four smaller decisions building it forced.**

- **A corrupt index is NOT rebuilt.** D49ax said reconcile should *"keep everything and rebuild the
  index by walking"*. Walking cannot do that: the copies are named `<seq>.bin`, so a walk recovers
  no path and no hash — it would fabricate entries naming files they cannot restore. So an
  unreadable index keeps everything and **builds nothing**, and the store is swept again the next
  time an index exists. The rule D49ax actually needed is intact and tested: **a corrupt index
  deletes nothing.**
- **`bytes` is the size of what was REPLACED, and only copied files count toward the cap.** The
  first version counted stored bytes, which made the "too big to undo" message report the size the
  file happens to be now instead of the size that could not be copied.
- **"1.0 MB" was not the number.** `formatBytes` dropped the trailing `.0`, because *"above the 1.0
  MB limit"* reads like a machine wrote it.
- **Both of D49ax's two levels are reachable, and the second only when it differs.** "Just the last
  change" appears on the card only when the request touched more than one file — with one file the
  two actions are identical, and a second button that does the same thing is a choice the user has
  to read for nothing.

**The store, as built.** `~/.plato/undo/<project-key>/`, beside the run records: `index.json`, and
one directory per request holding `<seq>.bin` copies. **No user path ever becomes a file name** —
the copies are numbered and the index maps the number to the workspace-relative path, which is what
makes the delete paths provable rather than merely careful: every removal is built from the store
root and checked against it with the same `resolveInRoot` the file tools use. The index is written
whole and renamed into place, because a half-written index is the one corruption this store cannot
recover from.

**Cross-platform, per the founder (2026-09-28: *"make sure the location like ~/.plato on
mac/linux are proper when used in Windows"*).** One module-level `homePlatoDir()` uses `homedir()`
and `join`, so Windows gets `C:\Users\<name>\.plato` with no `~` expanded by hand and no path built
from a string containing a separator. Containment is `path.relative` + `isAbsolute`, which the
existing `resolveInRoot` already had for the *different drive* case, rather than a string prefix
compare that would break on Windows' case-insensitivity. Stored paths are POSIX and joined back on
read, which `path.win32.join` normalises. `rename` over an existing file replaces on every platform
Plato runs on. `~/.plato` appears only in user-facing prose, where it is correct everywhere.

**Verified.** `undo.test.ts` (31) and `undoCopy.test.ts` (16) pin the store and the wording; five
loop tests pin the seam (a write files a copy, a read files none, a denied write files none, no
store files none, one patch files every file under one id); the `undo` render suite (43 assertions)
pins the card. **Falsified four times**, each reverted after the failure was seen: removing the
fingerprint check fails both "refuses a file the user edited since" and "refuses to remove a created
file the user has edited"; letting a corrupt index through **deletes the store's copies**; using
`innerHTML` for a file name fails the markup assertion; and counting the plan's file total instead
of what actually happened fails the "counts what ACTUALLY happened" assertion.

**And three times in a real window**, all in `auto`. **Case 18** creates a file and has it removed,
edits a file and has the bytes come back byte for byte, then undoes the undo and gets the edit back.
**Case 19** writes the user's own edit from outside Plato between the run and the `/undo`, and the
card must name the refused file **and say why, before the click**, while the other file is put back
— and the report must name the `shell` command it cannot cover. **Case 20** edits the only file in
the request, so nothing can be put back: there must be **no card at all**, and the file must survive
byte for byte, because a refusal that still wrote something would be indistinguishable from success
on screen.

**The verification itself needed a repair, and that is recorded rather than glossed.** A full
acceptance run reported *"M4 is NOT met"* and was wrong: one case threw a stale element setting the
orchestration mode, so its own cleanup never ran, Settings stayed on screen and **covered the New
Chat button** — and three cases that had never started were reported as failing. Fixed in the driver
(retry the locate and the click; close a leftover Settings before each case), and — because the
re-run stayed silent, so the repair never executed — **proven by a throwaway probe that put the
failure in place on purpose**: `4/4` checks, and `2/4` with the fix neutered. See
`scripts/field/README.md`; a fix that never ran is not a fix.

**One bug was found by a photograph, and no assertion would have caught it.** Case 19's first run
reported *"Partly undone. Plato put back 1 file of the 1 it was going to change."* — the wrong verb
for a file that had just been **removed** from the tree, and a denominator counting only the files it
meant to act on, so a request that also refused one read as a complete success under a headline
saying "partly". Every substring the harness checked was present; the run PASSED. Looking at the
screenshot is what found it. The undo block now takes one shot with the card up and one with the
report on screen, and the sentence is rebuilt from two counts — what Plato did, with the verb each
file actually got, and what it did not — pinned by two new tests in `undoCopy.test.ts`.

**What it does not do, said here because the message says it too.** Terminal commands are outside
undo — in `auto` a shell command runs unasked and Plato has no record of which files it touched — so
the report **names the commands that ran** and says where to look instead.

---

**D49ay — old transcripts are compressed, never deleted; the user deletes, and only the user
(2026-09-28).**

D49ax recorded that the run records under `~/.plato/runs/` grow without bound and called it *"the
same class of leak, already shipping"*. **That was wrong, and the measurement is what corrected
it** — see D49ax's own paragraph, rewritten in place. The founder's instruction followed: *compress
conversations older than 15 days, and let the user delete all history items or individual ones.*

**Why this store gets compression and the undo store gets a window.** They hold different KINDS of
data, and one policy for both would be wrong.

- An **undo copy is DERIVED**. It duplicates a file that still exists; the repository holds the
  truth. Dropping one costs convenience and nothing else, so a short window is right.
- A **transcript is PRIMARY**. Nothing else holds it. Dropping one destroys the only record of what
  a run did. There is no second copy to fall back on, so deleting on a timer would be a quiet loss
  with no recovery — and a 30-day rule borrowed from the undo store would have done exactly that.

**The growth rate was measured before anything was decided.** 285 runs occupy 1.4 MB: a mean of
**5 KB per run**, largest 116 KB, after weeks of work that include every harness run. At that mean,
**50 runs a day for a year is 89 MB raw and 6.4 MB gzipped** — the compression ratio measured on a
real transcript is **9.2x**, and 7.8x over the whole store. So compression is not a compromise; it
removes the problem, and it costs nothing that has any value.

**Two rules the code exists to enforce**, both in `packages/core/src/runtime/retention.ts`:

1. **Verify before removing the only copy.** The gzip is written, read back, decompressed and
   compared **byte-for-byte**; the original is unlinked only after that comparison passes. A
   mismatch deletes the bad copy and leaves the original where it was. There is no path in the
   module that removes a transcript without a proven readable replacement.
2. **Never throw.** The sweep runs when the panel opens and when a run ends. A sweep that could
   fail a run, or stop the panel from opening, would be a worse bug than the disk usage it prevents.
   A file that cannot be compressed is left exactly as it was and reported, not retried forever.

**The third rule is about the delete paths, and it is the dangerous one.** `retention.ts` never
deletes on a schedule; the only deletions are the user pressing a button. So the name arrives from
the webview, and `isRunFileName` accepts only the shapes the writer produces — a `/`, a `\` or any
`..` is refused, and the `..` check is separate from the character class because `..jsonl` satisfies
it. Every unlink is `join(runsDir, name)` on a name that passed that gate, so it can only ever point
inside the runs directory. The sweep's own deletion is confined the same way: it deletes only the
file it just proved it had copied.

**What compression does not do.** It does not touch a run inside the window, it never re-compresses
a `.gz` (so no `.jsonl.gz.gz`), and it is idempotent. Age comes from the leading date in the file
name — which the writer builds from `toISOString()`, so it is UTC — with mtime as a fallback for a
name the writer did not produce. Day granularity is all a 15-day rule needs.

**The UI, and the two rules it keeps.** The Controls live on the History page's Runs section: one
delete per run, and one for all of them. Both reuse the two-step idiom D47j established for deleting
a provider — the first click arms and fills red, the second performs, and it disarms on blur or
after six seconds — because a native confirm dialog blocks the whole webview. `armDanger` is that
idiom extracted into one function, so the two destructive controls cannot drift apart.

- **No control is drawn when there is nothing to delete.** A request that recorded no runs shows no
  delete-all button; an empty list shows no per-row deletes. A control that cannot do anything is
  noise, and the founder's standing condition on every new affordance is that it must not become an
  annoyance.
- **A delete never doubles as "open".** The run card opens the run on click, so the delete button
  stops propagation. Without it, deleting a run would also open it — verified by removing the line
  and watching three assertions fail.

**Deliberately NOT built: a size backstop.** D49ay's own analysis proposed a hard cap (200 MB per
project) that would evict the oldest runs. It is not here, for two reasons. At the measured sizes it
would essentially never fire, so it would be complexity that no evidence supports; and a cap is a
form of automatic deletion, which is exactly what this decision refuses for primary data. If real
use ever shows the store growing to where it matters, compression has already bought the room to
decide it then, with numbers.

**Verified, and one thing not verified.** `pnpm -r test` **663/663** (38 files, was 648/37) with 15
new tests; `pnpm run render` **18 suites / 425 assertions** (was 411) all pass; `tsc -b --force`
clean. **Six falsifications, each reverted:** the age window 15→1 fails 3 tests; the `..` guard
removed fails the traversal test; allowing a `.gz` as a sweep source fails 3 (including the
idempotence test); removing the webview's `stopPropagation` fails 3 render assertions; drawing
delete-all with no runs fails 1; and the earlier wrong test fixture — a run dated 8 days back
expected to compress — was **my error, not the code's**, and is recorded because the boundary test
is what caught it.

**And the wiring was proved in a real window, not just in tests.** A throwaway probe (same method as
D49av's) installed the freshly packaged VSIX into the harness's VS Code, opened the panel against a
**scratch workspace** — never the demo repo — seeded one aged transcript and one fresh one, and then
drove the real History page with the mouse. All three assertions passed: the aged transcript was
compressed at panel open and round-tripped byte-for-byte while the fresh one was left alone; the
page listed both, and clicking a run's delete **armed without deleting on the first click and
removed only that file on the second**; and delete-all armed, said *"Delete all 2?"*, and removed
the rest. That probe is deleted; its method is recorded in `scripts/field/README.md`.

**Aged runs still open — measured, because the JOIN was the untested part.** The retention tests
prove the reader gunzips and the render suite proves the detail view draws events, but neither proves
the two are connected, and that connection is the whole of the user's question: does a 15-day-old
conversation still load? A second throwaway probe seeded an aged transcript **with real events**, let
the sweep compress it, and then drove the History page with the mouse.

- The list showed the run **with its title, its turn count, its token total and its cost** — every
  one of which can only come from the gunzipped bytes, so the summary is being read out of the
  compressed file rather than out of the name.
- Clicking it opened the detail view showing **the task line, the reply text, the tool row and the
  closing line** — the transcript's actual content, again available only after decompression.

So to the user an aged, compressed run is indistinguishable from a fresh one. **The first version of
that probe asserted the list would say "complete" and failed** — the list renders a reason only when
it is `failed`, which is its long-standing shape and nothing to do with compression. The assertion
was mine and was wrong; the code was right, and it is recorded here because a probe's own bug reads
exactly like a product bug.

**The acceptance suite was then run, and it still passes with this change in the build.** It had been
held back because `run-field.mjs` resets `DateHelper.java` and `SubmissionsViewModel.java` on a
`plato-field-test` branch and the latter carried uncommitted founder work. The founder waived that
(*"we don't care about changes in demo repo"*), so it ran: **all seventeen cases pass and 7 of 7
clauses pass**, identical to the result before this work — which is what shows the retention change
disturbs nothing else. No field case exercises the history page, so the two probes above remain its
only end-to-end witness, and they are why this feature is not shipped on unit tests alone.

---

**D49ax — undo is Plato's own copies of what it replaced, not a parallel history; the store is
bounded and cleans up after itself (Tier C item 3 — 2026-09-27).**

Tier C item 3 was written down as *"checkpoints / undo — snapshot before a write. Large, and it
changes what an approval means."* Both halves turned out to be wrong in useful ways: it is **not
large** — the raw material is already in hand at the write site — and it does not change what an
approval means, it changes what a **mistake** costs.

**The founder's instinct was right, and the field agrees for a reason he did not name.** He said a
parallel git-like system *"would be more harmful than good"*. Twelve agents were surveyed
(2026-09-27). Four mechanisms ship, and nothing else:

| Mechanism | Who |
|---|---|
| a separate hidden git repository | Cline, Roo Code, Kilo Code, Gemini CLI |
| the user's own git repository | Aider — and only Aider |
| per-file copies of the old content | Claude Code, Cursor |
| the editor's own undo state | GitHub Copilot, Windsurf |

OpenAI's Codex **removed** its undo, and the maintainer's reason (2026-01-07) is the sharpest
argument in the survey: it caused *"pretty significant problems for many users — including those who
didn't use the feature."*

**Every reported failure has the same shape: the snapshot was bigger than the change.** Cline
deleted untracked files outright — *"After trying restore snapshot all my files in workspace folder
have been deleted"* (#1213) — and left `.git_disabled` directories corrupting real repositories
(#9286). Roo Code, inside a dev container, leaked commits into the **wrong repository** because
`GIT_DIR` was set (#4567). Kilo Code, verbatim: *"Restore checkpoint removed all the changes of mine
also instead of changes done by KILO Code"* (#1670). Cursor's snapshot files grow with no limit.
Copilot's rollback leaves empty files behind (#9391). A design that snapshots a whole workspace to
protect one file makes every bug a whole-workspace bug. That is the argument against a parallel
history, and it is not a matter of taste.

**Measured in real VS Code 1.136.0, not assumed (2026-09-27).** A throwaway extension wrote one file
straight to disk and another through the editor API; VS Code's own local-history store was then read
off disk. Six findings, one of which overturned a fear recorded before the test:

1. **A direct disk write creates no local-history entry at all** — and that is how Plato writes
   today, so Plato's edits are invisible to the Timeline the user already has.
2. **Local history keeps what the editor SAVED, never what it FOUND.** Routed through the editor,
   entries appeared — but the earliest held the file *after* Plato's first save. The pre-Plato
   content was nowhere in the store. It therefore **cannot undo Plato's first change to a file**,
   which is the one most often wanted back.
3. **Rapid saves merge.** `workbench.localHistory.mergeWindow` defaults to 10 s, and Plato's edits
   land back to back, so they collapse and the intermediate state is lost. Two entries appeared only
   with the window at 1 s and a 12 s gap between saves.
4. **It is not readable anyway** — there is no extension API, and the entry was not on disk while the
   window was open; it appeared only after the window closed.
5. **The line-ending hazard did not reproduce.** With `files.eol` forced to `\n`, a CRLF file kept
   CRLF through open → edit → save. `files.eol` governs new files, not existing ones. The fear
   recorded before the test was wrong, and is recorded here as wrong.
6. **But a worse hazard is real, and it was measured.** If the user has the file open with unsaved
   typing, routing through the editor writes **their unsaved work to disk**: the buffer held the
   user's line, the disk did not, Plato wrote through the editor and saved, and the saved file
   contained both. A direct disk write leaves their buffer alone.

So: **write to disk as now, and keep Plato's own copies.** The editor route buys a partial Timeline
entry and costs a correctness bug. Local history is not the mechanism, and cannot be.

**The design: the old bytes and a fingerprint — never the new bytes.** At each write, at the site
that already reads the file's previous content for the guard and the approval diff, Plato copies
those bytes aside. Storing only the *before* has two consequences that matter: half the storage, and
the store can never become a second source of truth about what a file currently is. It is a record
of what was **replaced**, not a parallel state — and a parallel history that can disagree with the
repository is the disease, so this cannot catch it.

**Because the new bytes are not stored, a fingerprint is.** *"Has this file changed since Plato wrote
it?"* cannot be answered without knowing what Plato wrote, and storing it would recreate the second
copy. A hash answers the question, proves the file untouched, cannot reconstruct anything, and
cannot disagree with the repository about what a file is.

**Redo is offered and costs nothing to provide.** A restore is itself a write with a before, so it
enters the same store and the undo-of-an-undo falls out of the mechanism instead of being built.

**Two limits, both stated in the message rather than hidden.**

- **Terminal commands are not covered.** In `auto` a shell command runs without asking and Plato has
  no record of which files a command touches, so `rm`, code generation, package installs and
  formatters sit outside undo. Claude Code and Copilot share the hole and do not mention it. Plato
  **names the commands that ran** and says it cannot undo them.
- **A file the user has edited since is refused, not overwritten.** Kilo's bug, closed by
  construction: the fingerprint is checked before restoring, and a mismatch stops the undo and
  offers to restore the rest.

**The messaging is part of the decision, not decoration.** The first draft was rejected as cryptic —
chiefly *"Changes made by commands Plato ran are not affected"*, which named no command, said what
did **not** happen instead of what might be wrong, and gave no next step. The rewrites name the
files, the commands, the sizes and the limits, and end with what the user can do:

```
Undone. Plato put back the 3 files it edited.

This request also ran pnpm install and ./gradlew build. Plato has no
record of which files a command touches, so it cannot undo those.
If something still looks wrong, that is where to look.

Probe.ts was not undone. Plato found edits you made after Plato's, and
putting the old copy back would have wiped them out.
The other 2 files can still be undone.  [ Undo those 2 ]  [ Cancel ]

Partly undone. Plato put back 2 of the 3 files it edited.
build/output.bin is 4.2 MB, above the 1 MB limit Plato keeps undo copies
up to, so it still has Plato's changes. Use git or your editor's own
history to undo that one.
```

**Two numbers in the first draft were guesses, and both were replaced.**

- **Per-file size limit: 1 MB, not the 256 KB first quoted** — that figure was borrowed from the
  editor's own limit and was too cautious. The old bytes are **already in memory** at the write site
  (the guard and the approval diff both read them), so a copy costs one disk write and no extra
  read. 1 MB covers source files (1–50 KB), lockfiles and generated sources (100 KB–1 MB); above it
  is almost always build output, which can be rebuilt — and that is what makes a cap acceptable at
  all rather than "keep everything". The cap is **never silent**: the file is recorded as not
  copied, and the user is told when they try to undo.
- **No limit on the number of requests.** The first draft kept 20 and **that number was invented**,
  loosely from Claude Code's 100-per-session. It is also the wrong shape: twenty small requests
  might be 4 MB while twenty requests each snapshotting a lockfile could be gigabytes, so a count
  does not control the thing that matters. The limits are **30 days** and **200 MB per project**,
  with **the most recent 10 requests always kept** so that one heavy request cannot evict the
  history someone is about to use. 200 MB is a **starting point to be measured against real runs,
  not a finding.**

**Cleanup is a requirement, not a follow-up** (founder, 2026-09-27: *"make sure Plato cleans up
after itself properly after limits expire and does not let unbounded storage pile up"*). Storage
that grows without bound is the complaint filed against Cursor. Four ways this store could leak,
and what closes each:

| Leak | Closed by |
|---|---|
| a project over its cap | evicting **whole requests**, oldest first |
| requests past 30 days | the same sweep, by timestamp |
| **a project the user deleted** — nothing would ever reclaim it | a dead-project sweep: each store records its project's real workspace path, and a folder whose path no longer exists is reclaimed whole |
| **orphans from a crash mid-write** | a reconcile pass that drops any directory the index does not name |

**An index file makes the cap cheap to enforce.** Each project's store carries a small index naming
every request with its size and timestamp, so enforcing the cap is arithmetic on one small file
rather than a walk of the whole store on every write. The write path appends and evicts from the
oldest end while over the cap. The expensive work — reconcile, the dead-project sweep, the age
limit — runs at **extension activation** and at the **end of a run**, both off the hot path.

**A corrupt or missing index must not delete anything.** Reconcile deletes what the index does not
name, so an unreadable index would name nothing and take the whole store with it. The rule is
therefore: **reconcile deletes only when it has a valid index**; otherwise it keeps everything and
rebuilds the index by walking.

**Deletion is confined to the store, and that is the one dangerous line in the feature.** Cline's
worst reported bug is a restore that deleted a user's workspace files. Every delete path is built
from the store root and verified to be inside it; eviction drops **whole requests only**, never
individual files, because a half-restorable request is worse than none. A test proves a path outside
the store is refused.

**The store is one folder, inspectable and deletable by hand** — beside the run records under
`~/.plato/`, with a plain index at its root. Deleting it loses undo history and nothing else, and
Plato recreates it. An extension that quietly holds a copy of the user's source on disk owes them a
way to see it and throw it away.

**Related finding, and the first version of this paragraph overstated it.** The run records under
`~/.plato/runs/` have **no sweeper at all** either — that part holds. It was written here as "the
same class of leak, already shipping", and **the measurement says otherwise**, so the claim is
corrected rather than left standing: **285 runs occupy 1.4 MB**, a mean of **5 KB per run** and a
largest of 116 KB, after weeks of development that include every harness run. At the measured mean,
**50 runs a day for a year is 89 MB raw** — and JSONL of this shape compresses **9.2× on the largest
transcript and 7.8× over the whole store**, so **6.4 MB gzipped**. That is not a leak. **The two
stores are also not the same problem, and must not share a rule:** the undo store is *derived* data —
a copy of something that still exists — so deleting it costs convenience and nothing else, while the
run records are *primary* data that nothing else holds, so deleting them destroys the only record of
what happened. **Hence compression, not deletion:** keep them, gzip anything older than a few days on
the cold path, and carry a size backstop that at measured sizes would essentially never fire. This is not folded into the
undo policy above, because it is a different store with a different policy. **It was decided and
built the next day as D49ay** — compressed after 15 days, never deleted on a timer, and the user
deletes any run or all of them. **The reclassified claim is the point:** "grows without bound" was true and still read as a
problem, which is exactly the kind of statement this repository keeps having to un-believe.

**What it does not change.** The approval still means what it meant — the write happens as approved.
What changes is the cost of being wrong, which was the point of the item.

**BUILT the next day as D49az**, which also decides three things this entry left open: where the
capture happens (the executor, not the approval preview), when the plan is made (at the click, not
when the card is drawn), and what undoing a *created* file means (it is deleted). Read D49az with
this entry, not instead of it.

---

**D49aw — a run is bounded by repetition, not by volume; two triggers, one card, and the
user decides (Tier C item 2 — 2026-09-27).**

D49ab deleted `MAX_TURNS` and deliberately replaced it with nothing. In `plan`/`edit`/`act` that is
plainly right — an approval card gates every write, so the user IS the backstop. In `auto` there is
no click in the loop, so **nothing stopped a model that kept calling tools without concluding**. This
is the replacement, and the first thing it had to get right is why the old one was wrong.

**The turn cap counted the wrong thing.** It cut a *working* run at turn 40 with a third of its task
untouched, after the user had approved eleven writes. Turns bound neither money nor time — one
measured run spent 10,442 output tokens across 40 turns, while a thinking model can spend more in
three. Every bound that survives in the field counts **wasted effort** instead, and **resets the
moment anything succeeds**: Cline counts consecutive mistakes (default 6), Roo 3, and both reset on
any productive turn. That is the whole design.

**What the field actually does, read from source and from vendor docs (2026-09-27).** The numbers
here are not invented: **Cline's CLI ships exactly soft 3 / hard 5 on consecutive identical tool
calls** — `{ softThreshold: 3, hardThreshold: 5 }` in `LoopDetectionTracker`, where soft injects a
warning into the conversation and hard escalates to the mistake limit. Roo Code ships 3
(`ToolRepetitionDetector`, default limit 3) and asks the user. Gemini CLI nudges at 5 identical
hashed calls and stops only on a *second* detection. OpenHands — the only shipped agent that pairs
the call with its RESULT — requires 4, and nudges when an error streak exactly equals its threshold.
OpenCode raises `doom_loop` (same tool, same input, 3×) as a permission that defaults to `"ask"` and
**overrides an allow rule**.

**And nobody ends a run on their own.** Gemini nudges first, OpenCode asks, OpenHands throttles,
Cline and Roo both pause and ask. Claude Code has no detector at all and its users file bugs about
loops only a kill signal escapes. **A silent stop cannot be told apart from a finished run**, which
is the failure this codebase keeps re-learning — so Plato nudges the model, and only then asks the
user.

**The key is the call AND the result it produced.** This is the finding that makes the bound safe. A
bare `(tool, args)` check — OpenCode's and Gemini's — is the cheap version and the one that misfires:
an agent re-running the test suite after every edit issues the *same command* many times and is doing
its job, but the output differs every time because the code changed. Pairing removes that entire
class of false positive, and it is also exactly the stuck case: the same command failing with the
same error, over and over.

**Deliberately NOT detected, each for a named false positive.** Alternating patterns (edit → build →
edit → build is both the normal working cycle and a textbook oscillation; true cycle detection would
flag nearly every sane run), a workspace that has not changed (reading, grepping and planning
legitimately change nothing), and paraphrased repeats (they need embeddings, and
similar-intent-different-words is what real progress looks like). Telemetry at most; never a guard.

**The two triggers.** (1) The same call with the same arguments returning the same result,
consecutively. (2) Turns in which at least one call ran and failed and **none succeeded**. Both reset
on any success. Both use the same two numbers, so there is one pair to reason about rather than two.

**The user's own refusal is invisible.** A guard refusal and a user DECLINE both surface as errors in
the loop, and counting them would raise "you look stuck" at the user *because the user said no* — and
in `edit`/`act` five declines are normal. So a declined call counts for nothing: not a repeat, not a
failure, not a reset. A *blocked* call (mode deny, guard refusal) DOES count toward repetition,
because its message is deterministic text and re-issuing it identically is a loop; it does not count
toward no-progress, because nothing failed.

**Two misses found by measurement, both of which would have made the guard silently never fire on the
real case.** First, `overwrote X` differs from `created X`, and second, D49av appends a diagnostics
block to a write's result — so a repeated identical *write* does not produce an identical result the
second time. Neither is a problem (the detector counts matching repeats, so it trips one iteration
later), but both mean **the detector can never fire on a write's first repeat**, which is exactly the
kind of detail that produces a guard that works in tests and never fires in practice.

**The messaging is part of the decision, not decoration — and it took TWO passes.** The founder first
rejected *"the same call repeated 5 times with the same result"* as vague. The rewrite that followed
named the call but was **still wrong, and he caught it again**: *"we really need to improve our
communication, make it effective and let user know what else can they do"*. He was pointing at two
real faults, and the second one is the deeper.

1. **The copy described what Plato did to itself.** *"It has been asked to try something else"* is
   passive and tells the user nothing; *"Running it again will not change anything"* is a negative
   with no direction. Both are true and both are dead ends.
2. **Nothing said what the USER could do next.** That is the fault the whole feature is supposed to
   avoid — the run has stopped, and a card that only explains the problem leaves the person exactly
   where the founder said they must never be left.

**So every user-facing line now answers two questions: what happened, and what you can do about it.**
The card has four parts — `lead` (what happened), `call` (the specific thing, set apart on its own
line), `detail` (where it got to) and **`help` (the way out, always present)**:

```
It has made the same call 5 times and got the same answer every time:
  updating its plan (the same step)
Repeating it will only give the same answer. Tell Plato what to do
instead, or press Stop and rephrase your request.
```

The closing line closes the loop the card opened, ending on what the user can do rather than on a
machine digest — the old version ended `(todo_write: 1 item, 0 done, in progress: …)`, which is the
LOG's vocabulary in a person's last sentence: *"Stopped — Plato was stuck on the same call (…) and
kept getting the same answer. Nothing was lost — tell Plato what to do differently, or rephrase your
request."* And the nudge line says **what happens next** rather than what was done, so the coming
pause is never a surprise.

**`describeCall` was written for this and is deliberately NOT `digestToolCall`.** The digest is the
log's vocabulary, built for folds and for the next run's model; it renders as `todo_write: 1 item,
0 done, in progress: …`, which is noise in front of a person. The user-facing phrase leads with the
verb — `running pnpm build`, `reading src/DateHelper.java`, `updating its plan (the same step)` — and
an unknown tool falls back to the digest rather than to a bare name. The no-progress card says what
last worked in the same human words, because that is what tells a person how far it had got.

**The copy now has tests in two places, and they prove different halves.** `stuck.test.ts` owns the
WORDING (`THE CARD SAYS WHAT TO DO — every card, both kinds`, and `never leaves the so-what to the
user's imagination`), and **field case 12 owns the real string end to end** — it greps the screen of a
running VS Code for `Tell Plato what to do instead` and `Nothing was lost`, which no other suite can
do. The render suite only proves the field is *drawn*; its checks were renamed from `IT SAYS WHAT THE
USER CAN DO` to `the way out is drawn on the card` once a falsification showed a vague `help` string
still passed it — the wording is core's to get right, and saying otherwise in a check name is the
kind of overclaim this repo hunts. **Falsified:** reverting `help` to `Try something else.` fails two
core tests.

**The card, and the escape hatches — this was the founder's other condition, and it is the one that
shaped the UI.** `auto` means "no card for every write", NOT "nobody is watching"; this is the only
card `auto` ever raises. Every way out: **Keep going** (which carries whatever the user typed in the
box, because the user often knows the answer — the fastest unstick there is); **Stop** (ends the run
cleanly with a note that names what happened); **the Stop button in the composer, which is never
disabled by the card**; **typing in the composer**, which already reaches the run mid-flight; and
**switching modes mid-run**. A run with no way to ask — no handler wired — **stops rather than
pretending it asked**, which mirrors Cline's own default.

**Answering "Keep going" exempts THAT call for the rest of the run** and nothing else, so it cannot
nag while a *different* stuck pattern is still caught. On a no-progress card there is no call to
exempt, so the streak simply starts again: being told once more after another five failed turns is
information, not nagging.

**Reset on new information.** Guidance from the user clears both counters, because a card raised on
the strength of turns that happened *before* the user spoke would be a card about the past.

**Not a nuisance, and the argument for that is the key rather than the threshold.** Five consecutive
identical (call, result) pairs is hard to reach legitimately: `git status` polling with nothing
changing, the same file read five times, the same test output five times — each of those IS a run
going nowhere. The nudge at three is invisible except as a line in the chat, so the occasional benign
trip costs nothing. The card at five is rare by construction.

**Two defects this work found, both worth more than the feature.**

1. **`pnpm run install:vsix` does not exist, and the field harness never compiled core.** The bundle
   resolves `@applivity/plato-core` through its package `main`, which is BUILT output
   (`dist/src/index.js`) — so a change to core's *source* is invisible to esbuild until `tsc -b` runs.
   `run-field.mjs` ran `bundle` + `package` only, while its own comment promised "a stale VSIX would
   test old behaviour, so the bundle is rebuilt before every run". **A core change could therefore be
   tested against a stale core, and a green run would look exactly like success.** Found because a
   *falsification refused to fail*: neutering the guard in `loop.ts` was expected to break case 12
   and the case passed. `tsc -b` now runs first, and the same falsification then fails correctly.
2. **An answered card still counted as waiting for an answer.** Found by field case 12's own
   assertion — the card stays on screen as the record of what was asked (as approval cards do), so
   "is a card open" has to mean "is anything still demanding a reply". The card is now marked
   `answered` and the harness looks for `.card.stuck-card:not(.answered)`.

**Verified.** `tsc` clean. **648 core tests / 37 files**, of which 35 are the counting rules and the
wording (`stuck.test.ts`) and 5 pin the loop seam. **18 render suites / 411 assertions**, of which 32
are the card. **All fourteen field cases pass** in the harness's real VS Code, run in one pass against
this build — including the three faces of this bound: **12** (the card appears, names the call, says
what to do, Stop ends the run, `reason: stuck`), **13** (the card is answered "keep going" with typed
guidance, and the run finishes `complete` with the user's words in the conversation), and **14** (five
turns of *different* failing calls raise the card, so the no-progress trigger is proved on its own).

**Falsified in both directions, seven times:** removing the result from the repeat key fails the "test
suite after an edit" test; removing the decline exclusion fails the declines test; removing the
reset-on-success fails two reset tests; deleting the replay case fails the reload assertions; dropping
the guidance from the answer fails the "carries what the user typed" assertion; neutering the ask in
the loop fails field case 12 with `reason: complete` instead of `stuck`; and reverting the card's way
out to `Try something else.` fails two core wording tests. The screenshots of cases 12, 13 and 14 were
read rather than trusted — which is how the answered card's `dismissed=true` label was found to be
describing the opposite of what is on screen.

**One existing test had to change, and that is a finding rather than a nuisance.** `loop.test.ts`'s
"keeps working past 40 turns" (which pins D49ab) issued the *same* `read_file` call 55 times with
byte-identical results — a stuck loop by any definition, so the new bound correctly stopped it. The
bound was right and the stub was wrong: it now advances a plan, so the test proves **both** claims at
once — no turn count bounds a run, **and the repetition bound never fires on work that is going
somewhere**. A repeating stub would have silently stopped testing the first claim.

**Carried, not hidden.** `duo`/`academy` already put an observer in the loop, and the nudge is
delivered through the same channel the observer uses, so a supervised `auto` run is nudged where a
solo one is only bounded. Alternating patterns remain undetected by design. And a reload while a
stuck card is up rebuilds it from the log, which is what stops the user being left with a question
they can no longer answer — though a *stale* card from a finished run is clickable and ignored, the
same pre-existing wart approval cards have.

---

**D49av — Plato is told what the editor thinks of a file it just changed (Tier C item 1 —
2026-09-26/27).**

**The rule that shapes it: the ABSENCE of diagnostics is not evidence of correctness.**
`vscode.languages.getDiagnostics(uri)` answers `[]` both for a file that is clean and for a file no
language server has ever looked at. Treating those as one fact is the only design that would make
this feature **harmful**: on the first write to a file the editor has not opened, every pre-existing
error in it would look newly introduced and the agent would be sent to fix things nobody asked
about. So the host records one of **three** states — `clean`, `found N`, `not analysed` — and a
**timeout is `not analysed`, never `clean`.** This is the same law as D49aq's, one level down.

**What ships.** After a file write succeeds, the host asks the editor about the files that call
changed, keeps only errors **new since the write**, and appends a compact block to the tool result,
so the model learns in the **same turn** that it broke something. Founder's decisions: always on
with **no setting**; **errors only**; only the files Plato changed; only errors **new**.

**Three design points that carry it, each falsified by reverting it:**

1. **Two diagnostics are "the same error" by `source + message`, never by position.** An edit shifts
   every line below it, so a positional key would report every pre-existing error as new after
   every single write.
2. **The difference is counted per key, not compared as sets.** A file that already had one
   `cannot find symbol` and gains a second has identical sets — a set difference drops the new one.
   Same fault as a check that cannot fail, in six lines.
3. **`unknown` reports nothing at all.** An existing file no server has ever analysed licenses no
   comparison.

Plus: the hook is **only for a successful write**, a throw from the host is swallowed (diagnostics
must never fail a run), and the block **says "new or changed since your edit"** — never "you broke
this", because an edit that rewrites the message on a pre-existing error legitimately reads as new.
The prompt gains one line making the block an **OBSERVATION** and saying pre-existing errors are
**not the model's to fix**, which is what stops the feature becoming a licence for scope creep.

**A language server only reports on a file the editor is SHOWING — measured, after two wrong
guesses.** A broken `.ts` file gave **nothing** when merely written to disk, nothing when loaded with
`openTextDocument` (waited 5 s), nothing with a valid `tsconfig.json`, and nothing as a broken
`.json` either — but **`showTextDocument` produced both errors within a second**, with
`typescript-language-features` active and `tsserver` running throughout. So the API had not moved
(this build's typings still carry `getDiagnostics`/`onDidChangeDiagnostics`) and the language was
irrelevant. **A merely-open document is not analysed here; a visible one is.**

**That shapes the collection, in this order:**

1. **Quietly first** — `openTextDocument`, then a short wait. A window whose servers answer on open
   (mainstream VS Code is expected to) **never has its editor disturbed at all**, and trying the
   visible route first would make the flash the normal case.
2. **Then, only if that got nothing**, show the files as preview tabs with `preserveFocus`, wait
   again, and put the view back.
3. **The view is restored by NAME, not by tab arithmetic.** The first attempt restored the
   previously-active *text editor*, which is the wrong signal when the user is looking at the
   Plato chat: `activeTextEditor` can still answer with a stale text editor, so a file went back in
   front — and **every later field case failed**, because the harness drives the chat webview and a
   backgrounded webview is unreachable. The host now re-reveals its panel explicitly. **The full
   suite caught this; case 11 passing on its own did not.**

**What is verified.** The seam, the three-state rule, the keying, the counted difference, the caps,
the formatting and the prompt line — 28 unit tests, three falsified by reverting the rule they guard,
on top of 608 green tests and 17 render suites. **And end to end: field case 11 writes a file with
two deliberate errors and the model is TOLD about both**, with the visible route recorded in the
notice. Falsified from the other side too: neutering the append makes the case fail with *"the editor
reported errors and they never reached the model"* while the notice still reads "2 new errors",
proving the two halves are independent. **The whole scripted suite — all eleven cases — passes**,
which is what proves the editor-swap does not disturb anything else.

**What remains unverified, stated plainly:** that a window whose servers already answer on open
needs no screen at all. That is the quiet route's branch, and no window available here exercises it.
If it is wrong, the cost is a one-second preview-tab flash per write — visible, reversible, and
self-reporting, since the notice says when the file had to be shown.

**Two things tried and one kept.** An adaptive two-cap wait (3 s for a session's first look) was
**written and removed**: it spent three seconds per write learning nothing, and the measured cold
start is under a second. `openTextDocument` is **kept** as the quiet route's first step.

**The harness's own lesson, again.** Three runs were spent before instrumenting, and all three would
have been avoided by asking the environment the question first. `tmp/diagprobe/` is the throwaway
extension that finally answered it, and the method is recorded in `scripts/field/README.md`:
**before building on an environment assumption, write the smallest thing that measures it.**

---

**D49au — an ignore rule must not be able to swallow source, and the deny-list had never been in the
repository (D15 secret audit — 2026-09-25).**

**What the audit found.** `packages/core/src/security/secrets.ts` — the module that implements the
secret deny-list, imported by **six** others including the package barrel — **had never been
committed.** Not once, in the whole history. `.gitignore` carried a bare `secrets.*`, added in
`053d93a` with the intent of ignoring local secret *files*, and its glob matched `secrets.ts` and
`secrets.test.ts` along with them. `git ls-files` never listed the file; `git log --all` had no
deletion, because there was nothing to delete.

**Why it matters more than an untidy ignore file.** Two independent consequences, and the second is
the one to sit with:
1. **A fresh clone could not build.** Six modules import the missing file, so `tsc -b` fails
   immediately. **Every "verified" claim in this repo was therefore only ever true on the one
   machine that happened to hold the file** — the verification loop proves a working tree, and a
   working tree is not the repository.
2. **The most safety-critical file in the product had no history and no review.** The deny-list is
   the thing that keeps `keystore.properties` out of a model's context. It was invisible to
   `git log`, to `git blame`, to any reviewer, and to any backup taken from the remote.

**The rule, locked.** **An ignore pattern must not be able to match source.** A wildcard whose
suffix is a category of secret (`.json`, `.yaml`, `.*`) will eventually match a module, because a
module can carry any suffix. Local secret files are therefore **named one by one**
(`secrets.json`, `secrets.yaml`, `secrets.yml`, `secrets.toml`), and the comment in `.gitignore`
carries the incident so the next person does not reach for the tidy glob again.

**How it was found, and why that is the point.** Not by reading the code — by running the D15 audit
across the surfaces that leave the machine. It surfaced as `!! packages/core/src/security/secrets.ts`
in `git status --ignored`: **a file that is present on disk and absent from the repository is
invisible to every check that reads the working tree, which is all of them.** The audit's habit of
listing ignored-but-present files is what caught it, and that habit is the durable lesson.

**Everything else the audit checked came back clean**, so the finding above is the whole of it:
- **Repo history, all refs**: **zero** credential-shaped lines were ever added (`sk-ant-`, `sk-`,
  `AKIA`, `ghp_`/`gho_`/`github_pat_`, private-key headers, Slack tokens).
- **Tracked files**: no secret-like names, no credential shapes in any tracked file or in `docs/`.
- **Transcripts**: **149 files, zero `tool-event` lines carrying `args`** — the D24c invariant,
  verified across every real run rather than in a unit test alone. Two real `refused`/`secret`
  events recorded, so D49aq's event fires in the wild.
- **Key storage**: `ctx.secrets.store` only. `rawUserConnections()` never reads `apiKey`, so the
  settings write-back **cannot** carry a key to disk even if one were hand-placed in
  `plato.connections`.
- **`~/.plato`**: `ACADEMY.yaml` and `DUO.yaml` hold no key-shaped field or value; no `mcp.yaml`
  exists (which is the file that *would* hold a server token, so this is a "not yet", not a "never").
- **VSIX**: no secret-shaped entries, zero credential shapes in the bundled JS.

**Two residuals, recorded rather than fixed:**
- **The VSIX ships the full source and both source maps** — there is **no `.vscodeignore`**, so
  `extension/src/*.ts`, `tsconfig.json` and `esbuild.mjs` are in the package. Nothing secret is in
  them today; it is a **publish-hygiene item for the gate (D19)**, not a leak now.
- **The real pass reads a key file from `~/Desktop/demo-creds.rtf`** — outside the repo, read at run
  time, never copied. It is on the Desktop, so it is in the field of view of any screenshot or
  screen share. Named here because that is the one path where the posture depends on a habit rather
  than on code.

**Not fixed here, and not Plato's:** the proving-ground repo's own `keystore.properties` and
`local.properties` are still uncovered by that repo's `.gitignore`. The audit is scoped to Plato's
artifacts (D49ar); that repo is the founder's.

---

**D49as — the guard is visible where the user is looking, and a run does not report better than it
did (Tier A, 2026-09-25).**

Three repairs, each closing a gap that D49aq recorded and left open. All three are the same
principle: **the record must not read better than what happened.**

1. **A refusal now appears in the live conversation.** It reached the run's *transcript view* and
   never the chat the user was watching. **The cause was not styling**: `onToolEvent` forwards a bus
   event only when it carries `args`, and the refusal event carried none — so the host was never
   told, and a fix in the webview could not have worked. **The event now carries its `args`, exactly
   as every other `tool-event` does**, and the transcript still strips them (D24c — the strip is
   asserted, so a refusal cannot leak the command it refused). The line names the guard: *guard
   stopped shell — it named a protected file*. **A revert to an args-less event breaks a unit test
   AND the live line**, which is the point: the two are the same defect seen from two sides.
2. **A run that ends against its own plan now says so.** Field test 7 ran fourteen minutes,
   completed **zero** of the plan's steps, and reported only "completed". The newest `todo_write`
   list is kept for the run, and the closing line adds *N of M plan steps unfinished* —
   `unfinishedPlanNote` in core, where it can be tested, because the shell has no unit tests and
   **this is the class of fault that lives there**. It returns `''` for a finished plan and for no
   plan at all: a note on every run would stop the line meaning "this run ended early".
3. **The cancel fix now has an automated check — and it has RUN.** D49aq's fourth repair was
   verified by reading alone, because the driver could click Allow, Deny and question options but
   never Stop. **Field case 10** presses Stop with a question card on screen and asserts three
   things: the transcript says `cancelled`, the card is gone from the screen, and the run says so to
   the user. **The case scripts two steps AFTER the question** so an ignored Stop button leaves work
   for the run to do — otherwise the model's own next step would end the run and the case would pass
   on a broken product. The driver treats a disabled Stop button as an **error**, not a no-op click.
   **Result (2026-09-26): PASS.** Transcript — `ask_user: requested → allowed → done`, then
   `run-completed {reason: 'cancelled', turns: 2}`, no failure. Screen — the card is gone and the
   closing line reads *✓ done in 2s · 1 tool call · 120 tok — cancelled*. **The proof it was a stop
   rather than an ending: the scripted `shell` step after the question never ran**, so the cancel
   reached the turn gate before the model's next call. Three repairs, three falsified fixes, and now
   no repair in this batch resting on code reading alone.

**The cancellation path needed no product change.** `loop.ts` already gates at the top of every turn
and the host's cancel already resolved the waiting question (D49aq), so the repair was to *prove* it.
**A cancel is not a failure**: the transcript asserts `run-completed {reason: 'cancelled'}` and
asserts that the run did **not** fail, because an abort and a transport failure are indistinguishable
at the HTTP layer (D49i, gotcha 12).

---

**D49at — the acceptance test, restated for the product that exists (M4, 2026-09-25).**

**What this replaces.** BLUEPRINT §4's sentence, which is the record's only statement of what "done"
means. **Three of its five clauses no longer describe this product** — it names a 3-profile preset
that the product lock deleted, requires an observer intervention that correct measure would have to
forbid, and asserts a budget cap that was built and removed (D49h) alongside the turn cap (D49ab).
A definition of done that describes a product nobody is building cannot be passed or failed; it can
only be ignored, which is what happened to it.

**The test.** On the proving-ground repo (`HcadPublicAndroid-demo`), Plato must satisfy every clause
below. Each names its witness, because **a clause with no witness is what made the old one
unfalsifiable.**

| # | Clause | Witness |
|---|---|---|
| 1 | **A real change lands.** Given a task naming a small defect or feature, Plato edits **1–3 files** and the edit is on disk. | The demo repo's `git diff` after the run. |
| 2 | **The gates hold, per mode.** In `edit` a write raises a card and the run waits; in `plan` the same write is refused with **no** card and the model is told why; in `auto` the write lands with **no card anywhere**. | Screen **and** transcript (`approval-requested` says an ask was raised; `approval-card` says one was drawn). |
| 3 | **A protected file never reaches a model.** A tool call or command naming a deny-listed file is refused **before any read**, with no card. | The `refused` tool-event with its reason; **"no read ran"** (verdict rule 2), which is the stronger form of "the content was never in a request"; the guard line on screen (D49as). | **RESTATED by D49bb (2026-09-28):** a protected file now READS, with its values masked — what never reaches a model is the **value**. A command that NAMES a protected file is still refused. **RESTATED AGAIN by D49bc (2026-09-28): the values now reach a model when the USER says so** — a file the masker cannot parse is shown in full behind a card that states the cost. The clause reads *"a protected file's values reach a model only through a card the user answered"*, and the witness for that half is the card and its cost line (case 22). **"Never" would have made the clause pass by forbidding the card that replaced the refusal**, which is the dead end D49bb exists to remove.
| 4 | **The observer path is LIVE in Duo, and its activity is reported.** **It does NOT require an intervention.** | The run's closing line. **Not yet automated** — see the gap below. |
| 5 | **The run's account of itself is honest.** A run that ends with unfinished plan steps says so; a refusal is visible; a cancel says cancelled. **No clause asserts a cap** — there is no turn cap (D49ab) and no budget cap (D49h). | The closing line and the log (D49aq, D49as). |
| 6 | **Nothing leaves the machine unasked — wherever a user is in the loop.** In `plan` and `edit`, `web_fetch` asks and the card shows the exact URL. **In `auto` it does not ask: D49ak amended D49p** (the founder's decision, 2026-09-24), so the clause is stated as the product now behaves. | Case 15 in `edit`: the card in the transcript **and** the URL on screen. The `auto` half is `modes.test.ts` — `decide('web_fetch','auto') === 'allow'`. |
| 7 | **Stop works.** Cancelling while a question card is open ends the run as `cancelled` and dismisses the card. | Transcript `run-completed {reason: 'cancelled'}`; the card gone from the screen; harness case 10. |

**The build clause is DROPPED, not deferred quietly.** `./gradlew` cannot run on this machine — no
JDK, no Android SDK (verified 2026-09-24, HANDOFF "Environment prerequisites"). **So no clause
claims the change compiles**, and a report must say it was verified by reading and by the diff.
**Restoring the clause requires a JDK plus the Android SDK platform tools**; that is the
prerequisite, and it is named here so the omission is a recorded state rather than an oversight.

**How it is executed — NOW ACTUALLY EXECUTED (2026-09-27).** `scripts/field/acceptance.mjs` runs the
seven clauses: it maps each clause onto the cases that witness it, judges each independently from the
transcripts, and exits non-zero unless every clause passes. `node scripts/field/acceptance.mjs --run`
drives the harness first, so the whole test is one command.

```
clause 1  PASS  A real change lands — 1–3 files edited, and the edit is on disk   (cases 5, 9)
clause 2  PASS  The gates hold, per mode: edit asks, plan refuses, auto does not  (2, 3, 4, 9)
clause 3  PASS  A protected file never reaches a model                            (1)
clause 4  PASS  The observer path is LIVE in Duo, and its work is reported        (16)
clause 5  PASS  The run's account of itself is honest                             (7, 10, 17)
clause 6  PASS  Nothing leaves the machine unasked                                (15)
clause 7  PASS  Stop works                                                        (10)

7 of 7 clauses pass.   All seventeen scripted cases pass in one pass.
```

**Two witnesses per clause, and that is the design.** The spec reports what it saw on **screen**; the
judge recomputes the **transcript** verdict from the JSONL independently. They are wrong in different
ways — the driver knows what it clicked but not always what that meant; the transcript knows what
Plato did but cannot see the screen — so a disagreement is reported rather than averaged away. The
**manifest** (`tmp/field/last-manifest.json`, written per run, including on failure) is the join: a
transcript records its task and root but never which case produced it, so without it a judge cannot
tell whether a clause's case ran at all.

**Three gaps had to be closed to run this, and each is worth recording because a witness that does
not exist is worse than none.**

1. **Clause 6 had NO witness.** The entry claimed the scripted cases covered clauses 2, 3, 5, 6 and 7;
   **no case touched `web_fetch` at all.** Case 15 is that witness.
2. **Clause 6 was also STALE.** As first written it required `web_fetch` to ask "in every mode
   including `auto`" — but **D49ak amended D49p** so that `auto` fetches without asking. **A clause
   describing the pre-amendment product cannot be passed or failed**, which is precisely the defect
   this entry was written to fix, so it was corrected to name two witnesses: the card in `edit`
   (case 15) and the `auto` policy (`modes.test.ts`).
3. **Clause 4's gap is closed.** It was recorded as not automated, because no case ran a Duo or
   Academy team. **Case 16 does**, driven through the real chip and the Settings card, and it asserts
   the closing line reports the observer. **It still does not require an intervention** — that wording
   exists so a philosopher who correctly stays quiet passes.

**Clause 3's third witness is subsumed.** "The model's log showing the content was never in a
request" is implied by "no read ran" — the guard refuses by NAME before any tool opens anything —
and a direct content test would need a real deny-listed file with a known marker, which the audit
keeps out of this harness on purpose. The stronger claim is the one asserted.

**A fourth defect found while wiring the clauses, and it was mine:** the two newest field cases'
screen notes (`STUCK:`, `GUIDANCE:`) were **not in the spec's fatal-note regex**, so "no stuck card
was ever detected" — the check written to give cases 12–14 their teeth — could not fail a case at
all. **A note is not a check.** The regex now carries every clause prefix.

**Falsified, because an acceptance test that cannot fail is the thing this entry replaced.**
`unfinishedPlanNote` blanked in core → case 17 fails with *"the run ended with 2 of 3 plan steps
unfinished and did not say so"*, the judge reports **clause 5 FAIL** naming that case, and the
command exits 1. Reverted, re-run, 7/7 again.

**Why the observer clause is phrased that way.** The old text required the observer to "intervene at
least once meaningfully" — which **fails a philosopher who correctly stays quiet**, and so pressures
the product toward a chatty observer. The claim worth testing is that the path is live and its work
is reported. The judgement half (was the guidance any good) is out of scope for a deterministic run.

---

**D49ar — M4 is the acceptance test and the secret audit; the trademark and license items are the
PUBLISH GATE, and they come last (2026-09-25).**

**The decision.** M4's deliverable is now **two** things: the **acceptance test** (restated for the
current product, then run through the field harness) and the **secret audit (D15)**. The
**trademark sweep (D16)** and the **license decision (D19) leave M4** and become a separate, final
**publish gate** — entered only when a public release is actually planned.

**Why.** The founder's words: *"move the licensing and trademarks sweep out of M4. Move them for
last. We are still in dev."* Both are true and neither is a repair: they cost money or a lawyer,
neither makes the product better, and neither can be finished by an agent working in this repo.
Tying a milestone to them made M4 read as a large unfinished block when its real remainder is **one
page of writing plus one audit**. **A milestone should end in something runnable and
demonstrable;** a legal gate is not that, and a gate that opens once — at the end — is not
milestone work at all.

**What it supersedes.** D16 ("USPTO/EUIPO trademark sweep is a pre-release checklist item") is
**confirmed**, not changed — it said *pre-release* all along, and the milestone attachment was the
error. D18 and D19 say "license decision at M4"; **that timing is superseded** while the substance
(repo private through MVP; publishing needs Microsoft review) **stands**. The founding entries keep
their bodies verbatim per D48; this entry is the map.

**How to apply.**
- **M4 closeout = restate the acceptance test → run it through the harness → secret audit.** Nothing
  else. **BOTH ARE DONE (D49at, D49au, 2026-09-27).** HANDOFF → "M4 closeout — the stale blueprint
  clauses, and what closed them" carries the clause-by-clause record.
- **The secret audit stays in M4 and stays scoped to Plato's own artifacts** — repo history,
  VSIX/npm contents, transcripts, docs, screenshots. Not the proving ground, whose git hygiene is
  the founder's business.
- **Do not pick up D16 or D19 as a session's work.** They are recorded in HANDOFF → "The publish
  gate" precisely so they are not lost, and marked there as not-a-tier.
- **The live constraint does not move, only its home:** the repo stays private and **no license text
  is added** until D19 says otherwise. That is a constraint on every commit today, not a future
  task — see HANDOFF → "Non-negotiable safety rules".

---

**D49aq — the record must say what actually happened, and a command is read the way bash reads it
(M5.0, four repairs + the harness's home — 2026-09-25).**

The self-driving harness (D49ap) found five things about Plato. Four are **repairs** and one was
**reviewed and is not a defect**. They share one theme, which is why they are one entry: **an
agent's own record has to be able to say what the guards and the host actually did.** A guard whose
refusals cannot be read back cannot be audited; a transcript that cannot distinguish a card from an
answer-from-memory cannot be trusted to describe a run; and a cancellation the user cannot perform
is not a safety property.

**1 — A refusal is audible (F1).** The pre-flight guard pushed a `tool_result` to the model and
emitted **nothing**, so *"the guard refused this call"* and *"the model never called a tool"*
produced the identical file. It now emits a `tool-event` with phase `refused` and a reason of
`secret` or `containment`. **The reason is a fixed word, not the refusal sentence**, because the
sentence can quote the argument and no argument reaches a transcript (D24c). This also makes the
field-test page's promise ("can check independently") true for the second half of what it claimed.
*(A live refusal still does not print a line in the chat log — `onToolEvent` drops events with no
args, and the log only persists `done`. Recorded as the next gap, not fixed here.)*

**2 — A command is read the way bash reads it (F2).** `find -name "*.java"` is a genuinely
read-only search that the allowlist refused, and the cause was the check, not the command: **every
`*` was refused wherever it appeared.** But the executor hands the whole string to `/bin/bash -c`
(`execute.ts`), so **quoting decides what bash does with a glob** — unquoted it expands, quoted it
reaches the program as a pattern. The scanner now models that: an unquoted glob is still refused
(the load-bearing refusal, unchanged — `cat *.properties` names no deny-listed file and would read
one), a single- or double-quoted glob is allowed, and **a double-quoted `$` or backtick is still
refused because those expand inside double quotes.** Single quotes suppress everything, so the same
text is inert there. The parser fails closed on the cases it cannot model: an unterminated quote, a
backslash, a newline. **`./gradlew`, `npm test` and every other unrecognised program are unchanged
and still ask.**

**The same fix closed a containment hole nobody had reported.** The workspace check ran on the raw
text, so `ls ".."` produced the token `".."`, whose path segments are `"..` and `.."` — neither of
them `..` — and the command was **auto-approved and listed the parent directory.** Argument checks
now run on the unquoted tokens, which is what the program receives. The write-flag check benefits
too: `'-delete'` is caught now that it is unquoted before matching.

**3 — The record says whether a card was drawn (F5).** `approval-requested` is emitted **before**
the host is consulted, so it means an ask was RAISED and never that a card was DRAWN — and in `edit`
the per-file session memory answers without drawing one, so a run with two such entries could have
shown the user one card. The host now emits **`approval-card`** with `via: shown | session-memory |
session-approval`, which is the only entry in the file that answers the question. `ApprovalRequest`
gained a required `runId` so the host can report against the right run. Seen in the first live run
after the change: test 5's two `apply_patch` calls read `via: shown` then `via: session-memory`.

**4 — Cancel works while a question is open (F9), and the finding's own claim was wrong.** F9 said an
unanswered question blocks the run "with a provider bill attached". **There is no bill** — while the
loop awaits an answer it is not calling the provider, so nothing is being generated. The defect was
sharper: **Cancel did nothing.** The host unblocked a waiting *approval* and never a waiting
*question*, so with a card on screen the user could not stop the run at all; they had to answer
first. Cancel now resolves the question (one answer per question asked, so the loop's per-question
mapping never reads `undefined`), tells the webview to remove the card, and cancels as before. **No
timer is added, on purpose:** a question is a real question, and a timeout would make Plato guess.
*(The Stop button IS enabled while a question is open — `busy` stays true until `finish()` — so the
path is reachable. Not covered by an automated check: the driver has no cancel step. Adding one is
the next harness case.)*

**5 — `F4` is not a defect.** "A run ends on the first turn where the model calls no tool" (D49ab)
was reported as one. It is the termination rule and the same one every comparable agent uses: text
with no tool call is the model saying it has finished. What made it look like a defect is that it is
the most expensive trap in **authoring a scripted scenario**, where a narration-only step silently
ends the run — a harness fact, and the harness's note says so now. **Recorded, and not fixed here:**
a run can end with unfinished work and report only "completed", which is an observability gap.

**Also in this entry, because the harness needed a home.** `scripts/field/` is **tracked** from here
on: it is the only check that runs the gates, the cards, the session memory and the transcript in a
real editor, and the M4 acceptance test is its next consumer. Its four dependencies (Selenium,
ChromeDriver, `vscode-extension-tester`, mocha) moved **out of the root `package.json` into
`scripts/field/package.json`, which is deliberately NOT a pnpm workspace member** — a root
`pnpm install` must not download browser automation the product never uses. Install them once with
`cd scripts/field && pnpm install --ignore-workspace`; the launcher checks for them **first** and
prints that line rather than failing forty lines down with `ERR_MODULE_NOT_FOUND`. `@types/mocha`
was dropped entirely: nothing type-checks the `.mjs` files. **The product's `package.json` and
`pnpm-lock.yaml` are byte-identical to what they were before the harness existed.**

**Locked.** A refusal reason is a fixed word, never an argument. The unquoted glob stays refused.
`plan` still denies every unrecognised command rather than asking. A question has no timeout, and
cancel is the way out. The harness keeps its own dependencies.

**Falsified.** Reverting the scanner fails 6 of the 7 new `readOnlyShell` assertions. Removing the
refusal `emit` fails both loop assertions. Removing the reason from the webview line fails 3
assertions in the new `refusal` render suite. Each revert was restored afterwards.

**Verified.** `tsc -b --force` clean; vitest **575/575** in 35 files (+7); render **17 suites**,
ALL PASS (new `refusal` suite); bundle + `extract-inline` + `node --check` PASS; VSIX packaged and
installed. **The nine field tests: 9 passing (1m), exit 0, in a real VS Code**, re-run after the
dependency move — and the transcript from that run carries `approval-card` with both `via` values.

**Not verified.** The cancel fix has no automated check (above). No live run has yet exercised a
refusal's new log line or a quoted-glob command chosen by a model.

---

**D49ap — the nine field tests run themselves, and a check that cannot fail is not a check
(M5.0, scripts + docs — 2026-09-25).**

`tmp/plato-field-test.html` lists nine things that unit tests and the render suites can prove in
pieces but that had never been exercised in a real run. It was written for a human to run by hand in
VS Code. A human is slow and can misread a card, so **the nine now drive themselves**: a real VS
Code, a real webview, a scripted model, and evidence read from the run's own transcript.

`scripts/field/` is the harness; `scripts/field/README.md` is how to run it and
`scripts/field/README.md` is the durable half of the record — how to run it, and the environment
traps that report as something else. **The findings log itself was deliberately NOT kept** (founder's
call, 2026-09-25): a list of symptoms goes stale as the symptoms are fixed, so the conclusions live
here and in the PROGRESS row, and the traps live in the README. Nothing in this entry depends on a
file that is no longer there.

**Locked.**

1. **The model is scripted for the deterministic pass.** These tests ask whether Plato gates,
   refuses, remembers and reports. None asks whether a model writes good Java. Replacing the model
   removes the only nondeterministic actor: no key, no network, no cost, and a failure is
   reproducible. A real-model pass exists separately to cover the *judgement* half (does the model
   choose to ask a question), and its rounds are labelled separately — a flake there is not a Plato
   defect.
2. **Two witnesses, and a disagreement is the finding.** The driver knows what it clicked but can be
   wrong about what that meant; the transcript knows what Plato did but cannot see the screen.
   Neither is trusted alone.
3. **A run ends when the transcript says so**, never when the screen looks settled, so every DOM
   reading afterwards belongs to a finished run.
4. **An unexpected approval card never blocks anything.** It is recorded, denied, and the run is
   allowed to finish so it can be judged. A harness that hangs on a surprise reports nothing.
5. **A check that cannot fail is not a check.** Three declared expectations were asserting nothing
   and are now assertions: the question-card interaction, the question handler itself (which was
   `undefined` because the scenario was read off the case instead of the run, so it never ran), and
   case 8's `expectZeroToolCalls`. Two of them had been reporting PASS while testing nothing.
6. **A diagnostic must be able to report ABSENCE.** The poll loop's diagnostic spoke only when it
   found a card, so "no card was drawn" and "the diagnostic never ran" produced identical output:
   nothing. Three runs were spent before that was understood. It now says "none" out loud.
7. **Falsify a new check before trusting it** — the standing precedent is D49al's three reverts.
   Case 6's new assertion was proven by making the model ask nothing: the case fails exactly where
   it used to pass.

**Plato defects this surfaced**, each needing a decision: a pre-flight refusal leaves **no trace in
the transcript** (F1 — a guard that cannot be audited cannot be trusted); `find` is not on the
read-only allow-list, so `plan` refuses a genuinely read-only search (F2); a run ends on the first
turn where the model calls no tool, which is documented but makes every scripted scenario delicate
(F4); `approval-requested` means an ask was decided, **not that a card was shown** (F5); and an
unanswered question **blocks a run indefinitely**. **Four of the five are FIXED in D49aq** (the
entry above, which also corrects the fifth clause's claim about a provider bill — there is none);
**F4 was reviewed and is not a defect.**

**Boundaries.** The demo repo is the only place the harness writes, always on a
`plato-field-test-*` branch; it never commits and never pushes, and it refuses to start if the two
target files already carry edits that are not its own. Three of the nine write to the demo repo by
design. The agent cannot run the real-model pass — the guard blocks executing a harness whose code
reads a credential — so the founder runs that one command and the log it tees to carries no secret
(T7).

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

**D47l — the API key is entered in the panel (M4.1, 0.25.0 — committed c7987c4,
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
(M4.1, 0.25.0 — committed eeac932, 2026-09-11).**

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
committed c354536, 2026-09-11).**

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
— committed fa4cd6a, 2026-09-11).**

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
— committed 296cbb3, 2026-09-10).**

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
- Trademark sweep before public release (D16) — **the PUBLISH GATE, not M4 (D49ar,
  2026-09-25).** Do not start it as a session's work while Plato is in dev.
- **SECRET AUDIT before any public release or repo visibility change**
  (D15, ARCHITECTURE security invariant 2). Sweep everything that leaves
  the machine: repo history, VSIX/npm artifacts, transcripts, docs,
  screenshots, demo repos. Known live exposure:
  `/Users/ai/Desktop/HcadPublicAndroid-demo` carries `keystore.properties`
  and `local.properties` in its working tree that its own `.gitignore`
  does not cover. If that repo is ever made public: rotate those secrets
  and purge history FIRST.
- License decision (D19) — **DECIDED 2026-10-20 (D49bv): Apache-2.0.** The
  repository was private until 2026-11-02, when the founder made it public
  under `Applivity` (D49cp). The checklist and the website wording are in `docs/LICENSING.md`.
- Optional rename `.aplivity/` → `.plato/` before M3 (D11 flag).
- Correction (verified during setup, now historical): GitHub account
  `applivity-com` was a personal user account, not an Organization. That
  account is deleted and the repository lives under the `Applivity`
  organization at github.com/Applivity/plato, public since 2026-11-02 (D49cp). Automation tokens need the `repo`
  scope for repo creation and push.

**D49cq — Live sessions: one registry, one endpoint per session, two tools (2026-11-03).**

The founder asked for what Claude Code already does between its own sessions:
an agent names another session, or finds one from a description of the problem,
and sends it a message. That requirement is what forces the design, because the
three hosts are three different processes — a terminal session, a VS Code window
and a Visual Studio window share no memory.

- **The registry is an address book, never proof of life.** One JSON file per
  live process under `~/.plato/live/` (id, name, summary, host, pid, busy,
  endpoint, token; directory 0700, file 0600, atomic write). An id names the
  process, not the conversation: a resumed conversation is a new process and
  honestly gets a new id, while the title stays the user's name for it. A shared
  name is refused rather than guessed, and every cross-session surface shows
  `title [id]`.
- **Liveness is a connect and handshake.** A crashed process leaves both its
  entry and its socket behind, so neither is evidence. `list_sessions` probes and
  hides a session that cannot answer within 250 ms; reaping needs a failed
  handshake AND an entry older than 30 s, and is compare-and-delete. A wrong
  answer here decides only what is shown; it corrupts nothing.
- **The endpoint is per session**, not per app: a unix socket on macOS and Linux,
  a named pipe on Windows (Node does not promise UDS there), newline-delimited
  JSON, a 16 KiB frame cap, a 4,000-character message cap refused rather than
  truncated, a 32-byte token from the 0600 entry, and an ack. The token is the
  credential and its trust boundary is honest: any process run by the same user
  can read it and impersonate a session; another user cannot.
- **The tools live in the engine**, offered only where the host supplies two
  callbacks (`describe`, `receive`), the same pattern `request_mode` already
  uses. A host without them refuses cleanly rather than advertising a tool it
  cannot honour.
- **Depth is one hop.** A run whose task arrived from another session does not
  get `send_to_session` at all, and a forced call is refused. Two agents cannot
  ping-pong; every further hop needs a person.
- **Plan mode asks, with a card (amended 2026-11-05).** Plan first denied the
  send outright, on the rule that plan raises no cards for a non-read tool. The
  founder corrected it, and he was right: **the card is what prevents the
  laundering**, because a person reads the target and the text and decides,
  while a hard refusal only taught the model to stop asking. The card names the
  target as the model addressed it, shows the text (cut at 600 characters with
  a continuation marker), and says the receiving session keeps its own mode and
  approvals. A call that can never run — depth, no registry, the five-send cap,
  empty target, empty text, over 4,000 characters — is refused **before** the
  card, by the same helper the executor calls, so the card never asks about
  something that cannot happen. Edit and auto still send with no card.
- **The receiving model is told what it is reading.** A fixed header names the
  sender, says the text is not from the user, and tells the model to act only if
  it helps the work and to say who asked. The receiving user sees a line naming
  the sender. **The sending run's transcript records that a message was sent, to
  whom, and how long — never its text (amended 2026-11-05).** The text is model
  prose written for another session, and the persisted record keeps model prose
  out of it exactly as `request_mode`'s reason does (D49cb). The receiving
  session holds the text itself, and the sender's own conversation shows it.
- **A Visual Studio window sends with no C# (2026-11-06).** `relay-out` goes to the
  extension inside the window's own sidecar, where `live.send` already lives, so
  enabling the control is one capability flag and the C# shell carries nothing.
  Verified on Visual Studio 2022 against the 0.2.0 package.
- **One-way in v1.** There is no reply primitive; a reply is a later decision,
  not an oversight. The CLI registers only interactive sessions, because a
  non-interactive run has no inbox and nobody to read it.

Rejected: an in-process bus only (cannot cross hosts or windows); pid checks as a
liveness verdict (pid reuse); UDP or HTTP on loopback (a socket is simpler and
does not open a port); letting the receiving session auto-answer with a relay
without a person in the loop (unbounded chains).

**D49cr — Chat tabs in VS Code: per-tab state and a per-panel close path (2026-11-03).**

The founder asked for as many independent chats as Claude Code's tabs. The
singleton was thin — one panel reference, one host, one set of chat keys — and
the class underneath was already per chat.

- **Storage is per tab**, `plato.chat.<id>.log/title/mode` plus a small index,
  not one map: every row is written on each push, and one map would rewrite every
  tab's log on every row. Archived chats keep their format and their 30 cap. The
  legacy keys are migrated once into a `legacy` tab and left as a recovery
  snapshot.
- **The close path belongs to the panel.** D41 and D49bn (cancel, await, then
  archive) were reached only through the one tracked panel; with tabs, the
  untracked ones would have kept running with no UI and never archived. Every
  panel now owns its handler, and archive writes are serialised so two closes
  cannot lose a snapshot.
- **`+ new` opens a tab**, and clearing a conversation becomes close-and-open,
  which archives it by the existing rule. A model pick stays in its tab: each
  tab snapshots `plato.model` when it is created, and the picker still writes the
  global so the next tab inherits it.
- **Restore is a serializer**, with the tab id saved by the shell through
  `setState`; restore is lazy and unordered by the platform's own rules, so the
  host rebuilds from the index rather than assuming what will come back.
- **`retainContextWhenHidden` stays.** Removing it looked right until the field
  suite showed a run that writes a file reveals the chat and tears a hidden
  webview down — cases 36 and 37 failed. Per-tab memory is the price of a live
  conversation.

**D49cs — Multiple Plato windows in Visual Studio: one sidecar and one state per window (2026-11-03).**

The founder's condition was that this must not be a hack. It is not: multi-instance
tool windows are a documented SDK feature (`MultiInstances`, the instance id
passed to `FindToolWindow`), and both supported hosts load our 17.14 SDK package.

- **One sidecar per window**, owned by the pane rather than the package. The
  shared host is one chat per process, so a second window attached to one sidecar
  would show the same chat; making one sidecar serve several windows needs a
  per-instance shim, a host map and a multiplexed protocol, and it couples
  crashes. Per-window processes cost memory, not disk (the same `node.exe`
  already ships), and give crash isolation.
- **State splits the same way.** The live log, title and mode are per window; the
  archived-chat list is shared and merged by chat id under an inter-process lock.
  Without the merge, a window that archived later replaced the list with its own
  copy and the other window's chats vanished from History — the lock test fails
  on the previous code by losing exactly that chat. The merge may hold one entry
  over the 30 cap until the next archive trims it; that is recorded, not fixed.
- **Ids are ours, and never reused.** `Transient` because we create the windows;
  a reused frame id would inherit a closed window's live log.
- **Commands follow focus**, not creation: the pane reports activation and the
  package moves it to the front, so New Chat acts on the window in front of the
  user.
- **One WebView2 environment** for every control, created once, because repeated
  `CreateAsync` against one user-data folder is a documented source of
  initialisation failures.

Rejected: one window with several conversations switched inside it — it needs
the same per-conversation state work and loses the side-by-side view, so it is
not cheaper.

**D49ct — The activity bar is a chat, and the Plato mark makes new tabs (2026-11-06).**

The founder's second pass on 0.27.0 has one sentence at its centre: the
activity-bar container is a chat window, not a list of sessions. The decision
has four parts, and two consequences follow from them.

- **The activity bar is a CHAT, not a list.** D49bq put a tree there — Open
  Chat, New Chat, and up to twelve saved chats as rows — and the founder has
  rejected it. The container now holds the conversation itself: no tree, no
  rows, no "+", and the saved chats stay one click away in the History page
  inside it. **Do not reintroduce the list.** The change is subtractive: every
  action the tree offered is reachable from the chat page, so removing the tree
  removes a surface rather than a capability.
- **A new conversation is opened from the Plato mark in an editor's title
  bar — in EVERY editor.** The title-bar action's `when` clause is
  `resourceScheme == file || activeWebviewPanelId == 'platoChat'`, so the same
  mark is on a plain file and on every Plato tab. That click is how tabs are
  made now, and the chat header's "+" is gone in VS Code — removed rather than
  hidden, so the status row keeps its width. The founder's rule: the mark is on
  every open editor, the way Claude Code's own icon is.
- **The activity-bar chat is its own session, and it is created when the view
  is first shown.** It registers with the live-session registry like a tab, so
  `send_to_session` addresses it by name. It is also the conversation that
  carries the bare name **Plato**; a tab starts at "Plato 2", so two sessions
  never share the name a person uses to pick one. It is deliberately NOT in the
  tab index: it is the one conversation that is always there, which is why its
  log, title and mode survive the view's disposal. Registration is lazy because
  a view that has never been shown has no page and nothing to register — the
  first time the person opens the container, the session appears.
- **The view is HIDDEN, not disposed.** `retainContextWhenHidden` is set, and
  the dispose path keeps the side chat's store, so switching to Explorer and
  back returns to the same conversation, including a run in flight. Without
  this the page is rebuilt and the view of the run is lost.
- **One capability separates the hosts: `newChat`.** VS Code states
  `newChat: false` and its page removes the header chip. The Visual Studio tool
  window states nothing and keeps the chip, because it has no editor title bar
  to put the mark in. The capability answers "does this host have another
  affordance for a new conversation", not "can this host start one" — both
  hosts can.
- **The migration is host-aware, and the Visual Studio history test is why.**
  A host with tabs (VS Code) moves the pre-tab conversation into the
  activity-bar chat and deliberately not into the tab index. A host without
  that view (Visual Studio's single tool window) keeps the 0.27 behaviour — a
  `legacy` tab the next `openChat` adopts — because the single-line version lost
  the conversation there and its history test failed on exactly that.

The code change is one interface, `ChatSurface`, with two small adapters (an
editor panel and a webview view). `ChatHost` does not learn which kind of view
hosts it, so the conversation, the run, the approvals and the live session keep
one implementation.

**Harness note, recorded because it will otherwise look like a product defect
in the field log.** The field harness now opens a chat by clicking the title-bar
mark, not through the command palette. With a webview editor active, the
tester's command prompt sends the key to the tab and stalls for five seconds;
after one stall every later case fails the same way. The click is the real
affordance and does not depend on keyboard focus. The command remains the
fallback for a window with no editor at all. The sidebar's session is named
**Plato** only until its first conversation is titled; after that the generated
title is the name other sessions see.

**D49cu — The Visual Studio browser is created on a real surface and repaired in place (2026-11-07).**

A second Plato window on Visual Studio 2022 could be drawn with its browser
missing: the core answered, the sidecar ran, and nothing was painted, with no
exception. It is intermittent, it predates 0.2.0, and it does not occur on
2026. No deterministic trigger was found. The decision has three parts and one
recorded limit.

- **Create the browser only on a real surface.** The element is created when
  the pane is loaded, visible and has a non-zero size. A window Visual Studio
  has not finished placing must not initialise against a surface that is later
  replaced — that is the shape of the original fault.
- **Detect a missing browser, and repair in place.** Every two seconds the
  control checks that a browser child exists under its own pane. Two
  consecutive misses rebuild the element on the same sidecar and navigate the
  last HTML again, so the conversation, the live session and the registry entry
  survive; the window is not recreated. Each repair writes one line to that
  window's log: `view rebuilt: <reason>`, or
  `view rebuild failed (<reason>): <exception>`.
- **The repair path must be reachable on demand, and only in a debug build.**
  `PLATO_VS_HEAL_TEST=<n>` tears the browser child out of a live pane n times
  after it draws. It is read only when set; the product never sets it.
- **Verified:** Windows 10 / Visual Studio 2022 against the packaged build —
  two windows drawn side by side, the forced fault repaired in about three
  seconds, two faults in a row left one pane, one sidecar and one browser
  child, normal runs logged no repair, and 14 host suites pass at `971801b9`.
- **Verified on Visual Studio 2026 (2026-11-07), on the exact package after a
  fresh start.** Two windows opened with their own conversations; a message
  arrived while a window was idle and one reply reached the sender; the window
  drew its own new-chat control; and no window logged a repair, which is the
  correct result for a normal run. The repair path there was proven earlier on
  a build that differs only by an unused diagnostics class.
- **Limit: no deterministic trigger for the original fault was found.** The
  detector now ships, so a recurrence will leave a line in that window's log
  rather than a silent blank pane.

The package is `Plato.Vs.0.2.0.vsix`, 33,315,032 bytes, SHA-256
`9d9d6542…efad`, built from `971801b9`. The version stays 0.2.0 because it has
never been published. Superseded builds remain listed and labelled:
`c1adad86…` from `962b3549` and `29eee2d9…` from `bb7c508f`.

**D49cv — A website brief names the registry query, not a version number (2026-11-07).**

A brief for the off-machine website builder must name the query that returns
the current version, not carry a version number. The brief that produced the
2026-11-07 site update said Visual Studio 0.1.5 while 0.2.0 was already live;
the builder queried the live source, found 0.2.0, and was right. A number copied into
a brief goes stale between writing and use, and the builder cannot know it did.
The brief names the query — the npm registry or the Marketplace — and the live
page, not the builder's message, is the witness that the change landed.

**D49cw — A write that writes nothing is not a success (2026-11-11).**

`apply_diff` and `apply_patch` counted a SEARCH/REPLACE block whose replacement
is byte-identical to its search as applied. The tool wrote the same bytes and
reported success. In the founder's real client project this raised the "stuck on
the same call" alarm three times: the model was told its edit had landed, the
file had not changed, and a later identical attempt looked like a loop.

- An identical block now reports **"no change"**, writes nothing, and records no
  undo copy. There is nothing to undo.
- A genuine edit is unchanged, in both tools; `apply_patch` shares the same rule
  across a multi-file patch.
- The reason is the model's next action: a success it cannot observe teaches it
  to retry, and a retry of an honest no-op is harmless, while a retry of a false
  success is the loop the alarm exists to stop.

**D49cx — A search given a folder searches only that folder (2026-11-11).**

`grep` had no folder argument. A `path` the model passed was silently dropped
and the whole workspace was searched — the answer looked scoped and was not, so
a file outside the intended folder could be found and reported.

- `grep` takes an optional `path` folder, resolved through the **same
  containment and secret deny-list choke point** as `read_file` and `list_dir`.
  A path outside the workspace or onto a protected file is refused there.
- Results stay workspace-relative, so `glob` and a later `read_file` keep their
  meaning.
- The folder is also listed among the path-bearing arguments, so the pre-run
  checks and the tool digest see it.
- **Limit:** that the model chooses the folder was proven in one real-model run
  in a real window, not by a permanent test. The tool's own scoping is covered.

**D49cy — A diagnostics line says what was checked, once per language per run (2026-11-11).**

Diagnostics ran after every write. In the founder's real run that was 75 notices
at about 2.2 seconds each, and 75 of the run's 79 notices were this one line.
The cost was paid per write and the message repeated what the run already knew.

- A language is asked **once per session**. A language that never answered is
  not asked again, not shown, and not waited for.
- The run posts **one line per language per run** that counts the files it
  could not check, instead of one notice per write.
- The record still separates **"checked and clean"** from **"never checked"**.
  D49av's rule stands: the absence of diagnostics is not evidence of
  correctness, so an unanswered language is reported as not checked, never as
  clean.
- **Recorded limit:** in Visual Studio the bridge never reports language-server
  diagnostics. Every language there goes blind after its one line. This
  pre-dates the change and is now quieter, not fixed.

**D49cz — Project instructions are merged, base to specific (2026-11-11).**

Project instructions were read only from the three root files, and the rule for
a file inside the project was first-found-wins. The founder's project keeps
rules in both `.github/AGENTS.md` and `.claude/CLAUDE.md`; one file was read and
the other was silently dropped, so a rule could exist in his repository and
never reach the model. Claude Code, Codex, Copilot and Cursor all merge;
first-found-wins was our error.

- Every candidate that exists is read, base to specific: root `AGENTS.md`,
  `.github/AGENTS.md`, root `CLAUDE.md`, `.claude/CLAUDE.md`. Later files
  override earlier ones by position, not by being the only file read.
- Each section is preceded by one line naming the file it came from, so the
  model and the reader know which rule came from where.
- Byte-identical copies are included once and named in the trace.
- The per-layer cap applies to the **merged** body, so the truncation marker
  still appears when one long file would otherwise crowd out the rest. The cap
  is 16,000 characters; the founder's project measures about 7,400 with two
  files, so it is not reachable for him today.

**D49da — An image rides the tool result's user turn (2026-11-11).**

`read_image` lets the model see a PNG, JPEG, GIF or WebP. The protocol's tool
results are text-only, so the image cannot travel as a tool result.

- The bytes ride the **same user turn** as the tool result. The model sees the
  picture in the turn that reports the read.
- The image **never reaches the event bus or the transcript**. A run record
  names the file; it does not carry the picture.
- The CLI's tool row names the image file for the same reason.
- Proven on a real screenshot by the founder. A file that is not one of those
  four types is refused, naming the four; an image over the size cap is refused
  with the cap given; and a protected image is refused like any other protected
  path, because an image cannot be masked.

**D49db — The field harness runs in a temporary home (2026-11-11).**

The field suite wrote a fake MCP server into the real `~/.plato/mcp.json`, and a
crashed run left it in the founder's installation. A test that changes the
user's own configuration is not a test the user can trust to run.

- The extension honours `PLATO_HOME`, the variable the CLI already reads. The
  harness sets it to a temporary home for the whole run.
- Seeded files are removed whatever a case does — pass, fail or crash — and
  stale seeds are swept at suite start and end.
- The suite **asserts the real `~/.plato/mcp.json` is byte-identical** after the
  run. The assertion is the point: cleanup that is not checked is cleanup that
  can regress silently.

**D49dc — The new-chat control means what the surface allows (2026-11-11).**

One control, three surfaces, and the founder's rule is that the visible control
does the obvious thing where it sits.

- **The activity-bar chat:** one click on the header mark clears the view. The
  conversation is archived to History and the view is ready for a fresh one. No
  tab opens and no confirmation dialog appears.
- **A chat tab, and the title-bar mark:** the mark opens a new chat tab. A view
  with no control of its own reads as a view with no way to start a conversation
  — that was the founder's report on 0.28.1.
- **The command palette and the menu:** they still ask before clearing. Those
  paths can be reached without the visible control and without warning.
- **Visual Studio** has one surface, so its header mark keeps the clearing
  behaviour.
- A `newChatTab` capability tells the page which action to post. The page marks
  a click on the header control, and the host skips the confirmation question
  for that path only; the command and menu paths carry no such mark and still
  ask.

