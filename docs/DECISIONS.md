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
