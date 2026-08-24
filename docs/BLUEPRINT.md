# Plato — Blueprint (confirmed)

Confirmed by the founder after a full design-tree interview (Q1–Q22).
Every decision behind this document is logged with rationale in
[DECISIONS.md](DECISIONS.md).

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
