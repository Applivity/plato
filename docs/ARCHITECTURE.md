# Plato — Architecture (v0.1 target)

This describes the system we committed to in BLUEPRINT.md. It is the
design contracts, not yet implementation. Package names and config shapes
here are binding unless a DECISIONS.md entry supersedes them.

> ## ⚠ Status: historical — the v0.1 target, kept verbatim
>
> Read this for the contracts that still hold, not for the module list. The body
> below is unchanged as the record; here is what is superseded:
>
> | Here | Now |
> |---|---|
> | `src/eventbus/`, `src/cost/` | the bus is `core/src/runtime/bus.ts` and cost is `core/src/runtime/cost.ts` — neither has its own directory (D24) |
> | `packages/cli/` (phase 2) | **does not exist.** `packages/` is `core` + `vscode` only |
> | `Profile {name, rolePrompt, model, allowedTools[], permissions}` | `TeamMember` / philosopher (D47e) |
> | `Team` = ordered set of profiles; Solo = team-of-one | one worker + N philosophers; Solo/Duo/Academy are modes over the same worker (D45a-3) |
> | `.aplivity/teams.yaml` + `~/.applivity/teams.yaml` | `~/.plato/ACADEMY.yaml` for the council, `~/.plato/DUO.yaml` for Duo (D33, D46, D47) |
> | `mcp.yaml` at the repo root | `~/.plato/mcp.yaml` (D46). Parsed by a zero-dependency subset parser in core; it has **no JSON schema and no editor binding** — only `academy.yaml` and `duo.yaml` are bound in `package.json` |
> | "supervisor channel … rate-limited injections" | shipped as `core/src/runtime/observer.ts` + `RunController` (pause / cancel / guidance) |
>
> **Still binding, verbatim:** the monorepo rule (`packages/vscode` and
> `packages/cli` are thin shells; all logic, tools, providers and team logic live
> in `core` and communicate through the event bus — read "cli" as "any shell"),
> the **no VS Code imports in `packages/core`** rule, the event bus as the spine
> with the runtime as single emitter and isolated listeners, the four modes as
> permission filters over one runtime rather than separate loops, transcripts on
> disk, and **§ Security invariants 1–4** in full. The verification approach
> also holds, with one addition since: the real-DOM render suites in
> `scripts/render/` (see HANDOFF).

## Monorepo layout

```
plato/                      (this dir; GitHub repo applivity-com/plato)
├── docs/                   you are here
├── packages/
│   ├── core/               agent library — no VS Code imports allowed
│   │   ├── src/eventbus/     event bus + typed events + replay
│   │   ├── src/runtime/      agent loop, profile runner, pause/resume hooks
│   │   ├── src/tools/        read, write, applyDiff, shell, search, git
│   │   ├── src/mcp/          MCP stdio client, tool permission filtering
│   │   ├── src/providers/    anthropic.ts, openai-compatible.ts
│   │   ├── src/teams/        config parse+validate, presets
│   │   └── src/cost/         usage accounting, budgets, caps
│   ├── vscode/             extension — webview UI, SecretStorage, schema
│   └── cli/                (phase 2) wraps packages/core
├── pnpm-workspace.yaml
└── package.json
```

Rule: `packages/vscode` and `packages/cli` are thin shells; all logic,
tools, providers, and team logic live in `core` and communicate through
the event bus.

## Core concepts

- **Event** — immutable record: tool call requested/approved/executed,
  LLM message, cost, error, injection. Every event is appended to a
  run-scoped JSONL transcript on disk.
- **Event bus** — the spine. Publishers: runtime, tools, UI. Subscribers:
  UI renderers, observers, cost governor, transcript writer.
- **Profile** — {name, rolePrompt, model, allowedTools[], permissions}.
- **Team** — ordered/subscribed set of profiles on one problem. Solo is a
  one-profile team; single execution engine for all sizes.
- **Supervisor channel** — a profile capability: subscribe to another
  profile's event stream + write back (inject message into worker
  context, request pause). Rate-limited injections.
- **Modes** — plan/edit/act/auto; implemented as permission filters over
  the same runtime, not separate loops.
- **Cost governor** — counts tokens/USD per profile per run; enforces
  budget cap (graceful wind-down), concurrency and turn limits.

## Data flow (one coder + one observer)

```
user task ──► runtime(coder profile) ──► tool call ──► approval gate ──► execute
                  ▲                          │ event                       │
                  │ inject / pause           ▼                            ▼
              supervisor channel ◄────── event bus ◄────────────── result event
                                             │
                    ┌────────────────────────┼─────────────────────┐
                    ▼                        ▼                     ▼
              observer profile          cost governor        transcript (JSONL)
```

## Config formats

`.aplivity/teams.yaml` (repo) with global fallback `~/.applivity/teams.yaml`.
A JSON schema ships in the extension and is bound via `jsonValidation`
so editors autocomplete and flag errors natively.

```yaml
team: architect-coder-observer
budget: { usd: 2.00, turns: 80 }
profiles:
  - name: architect
    role: plans the change, writes PLAN.md, then goes idle
    model: anthropic/claude-sonnet-4-5
    tools: [read, search, write]
  - name: coder
    role: implements the plan
    model: anthropic/claude-sonnet-4-5
    tools: [read, write, applyDiff, shell, search, git]
  - name: socrates
    role: watches coder live; intervenes only on risky moves
    supervises: coder
    injectRateLimitPerTurn: 2
    canPause: true
```

`mcp.yaml` (repo): list of stdio servers {name, command, args, env},
each mapped to allowed profiles.

## Security invariants (non-negotiable)

1. API keys live only in VS Code SecretStorage; never in settings files,
   transcripts, or logs.
2. Files matched by `.gitignore`, plus explicit deny-list patterns
   (`keystore.properties`, `local.properties`, `.env*`, `*.keystore`),
   never enter model context or tool output sent to providers.
3. Shell tool runs with a scoped permission set per mode/profile;
   `plan` and `edit` modes cannot execute it.
4. All provider traffic records token usage into the cost governor;
   nothing hidden from the user.

## Verification approach

- Unit tests in `core` (event bus ordering, budget enforcement, diff
  apply idempotence, secret filtering).
- Milestone demos against HcadPublicAndroid-demo are the integration
  tests (see BLUEPRINT section 5).
