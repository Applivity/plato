# Plato — Blueprint (confirmed)

Confirmed by the founder after a full design-tree interview (Q1–Q22).
Every decision behind this document is logged with rationale in
[DECISIONS.md](DECISIONS.md).

> ## ⚠ Status: historical — the founding record, kept verbatim
>
> This is what was decided at the start. **The product has moved; do not read
> §§3–5 as current.** The body below is deliberately unchanged, because it is the
> record of the original design. What it says now, and where the current answer
> lives:
>
> | Blueprint says | Now |
> |---|---|
> | `.aplivity/teams.yaml` (repo) + `~/.applivity/teams.yaml` (global) | flat `~/.plato/` — `ACADEMY.yaml` (council), `DUO.yaml` (Duo philosopher), `mcp.yaml` (D33 → D46 → D47) |
> | `profiles:` — `name` / `role` / `model` / `tools` / `supervises` | `philosophers:` — a `TeamMember` with `persona` / `role` / `model` / `powers` / `color` (D47e, D47f) |
> | "Teams" = coordinator + workers, ordered profiles | **one worker + N philosophers.** Solo / Duo / Academy are the same worker with 0 / 1 / N watchers; cap 5; Plato is always the doer (D45a-3, D47e) |
> | Preset teams ship as example files (Solo, Architect+Coder, Coder+Observer) | shipped examples are `academy.example.yaml` and `duo.example.yaml`; Solo/Duo/Academy are **modes**, not files |
> | Non-goal: "visual team editor (config file + schema instead; editor comes later)" | **shipped** in D47 — the Settings UI edits Duo and Academy over the yaml, two-way |
> | §4 acceptance test (architect → coder → Socrates) | predates the product lock; **must be restated before it can be run**, and it has not been run — see HANDOFF and PROGRESS |
>
> **Still binding and unchanged:** the differentiator (§2 — the event bus, and
> live mid-flight supervision with a write-back channel), the six-tool surface,
> the four modes, user-supplied keys in SecretStorage only, transcripts on disk,
> and the hard requirement that secret-bearing / `.gitignore`d files never reach
> a model context.

## 1. What it is

An AI coding agent: a VS Code extension where a developer composes **a team
of agents with distinct profiles** to solve a coding problem, headlined by
live mid-flight supervision — an observer agent watches the coder's
tool-call stream in real time and can inject guidance or pause it.
TypeScript throughout; CLI wraps the same core library in phase 2.
Built full-time by a solo founder with AI-written code; ASAP pace.

## 2. The differentiator

Competitors (Claude Code subagents, Cline Teams, Goose lead-worker)
coordinate agents **at task boundaries**: worker finishes, returns a
summary, coordinator dispatches next. Plato's first-class primitive is the
**event bus**: every tool call is an event; profiles subscribe;
supervisor-class profiles get a write-back channel (inject message /
pause) into a running worker. Teams are user-composed via validated
config. Everything else is deliberately conventional.

## 3. MVP scope

**In:**
- Six built-in tools: read file, write file, apply-diff, shell,
  list/search files, git status/diff.
- MCP client (stdio transport) reading server config from `mcp.yaml`.
- Providers: any OpenAI-compatible endpoint + Anthropic native.
  User-supplied API keys, stored in VS Code SecretStorage only.
- Modes: `plan` (read-only), `edit` (diffs, no shell),
  `act` (per-action approval), `auto` (autonomous, hard-capped).
- Teams via `.aplivity/teams.yaml` (repo level) plus global fallback at
  `~/.applivity/teams.yaml`. Shipped JSON schema gives autocomplete and
  validation squiggles natively in VS Code. Preset teams ship as example
  files: Solo, Architect+Coder, Coder+Observer (observer persona named
  Socrates).
- Solo = team-of-one. Single code path; there is no separate solo engine.
- Cost governance: per-profile model mapping, hard budget cap per run
  (USD or tokens, graceful wind-down), concurrency limit, per-team turn
  limits, live per-agent cost meter. Nothing hidden from the user.
- Every event persisted to disk. Transcripts are browsable after a run.

**Out (explicit non-goals for v0.1):**
- Visual team editor (config file + schema instead; editor comes later).
- Session resume after restart (transcripts viewable, runs not resumable).
- Tool self-discovery / self-configuration by the agent.
- Agents spawning agents (flat teams only).
- Auto-commits by the agent.
- Browser automation.
- Telemetry, accounts, hosted services.
- Broad OS testing beyond macOS during MVP.

## 4. Acceptance test (definition of done)

> On `HcadPublicAndroid-demo` (founder's real Android project):
> the default 3-profile preset (**architect → coder → Socrates the
> observer**) plans, implements a small bug fix or feature across 1–3
> files, the observer intervenes at least once meaningfully, the run
> stays within its budget cap, and `./gradlew` verification passes.

Hard requirement attached to the proving-ground repo: secret-bearing files
(`keystore.properties`, `local.properties`, anything `.gitignore`d) must
never be sent to a model context.

## 5. Milestones — each ends runnable and demoable

| # | Deliverable | Verified by |
|---|---|---|
| M0 | Skeleton extension: Solo-team chat, API key entry, one grounded LLM answer about the workspace | "What does this project do?" answered correctly on HcadPublicAndroid-demo |
| M1 | Full tool loop + modes/approvals + diff rendering | Single agent fixes a trivial injected bug with approval clicks |
| M2 | Event bus + persisted transcripts + cost meter + MCP client | Costs visible live during a run; one MCP tool usable |
| M3 | Teams: `teams.yaml` + presets; architect pipeline, then live observer injection/pause | Observer redirects coder mid-task |
| M4 | Acceptance test passes; packaged VSIX installs cleanly; release/license decision | The sentence in section 4 |

## 6. Known risks

- Token burn on multi-agent runs — mitigated by caps and live meter.
- Observer chatter degrading the coder — injection rate limiting planned.
- Gradle builds are slow/flaky under agent control — timeouts and scoped
  shell permissions.
- Solo-maintainer risk — mitigated by complete docs (this set).
- Marketplace review timing at first publish.
