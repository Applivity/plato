# HANDOFF — Read me first if you are a new developer or AI agent

You are continuing **Plato**, an AI coding agent by Applivity. The founder
may not be available when you work; everything you need is in this repo.

## Read order

1. [BLUEPRINT.md](BLUEPRINT.md) — what to build and what NOT to build
2. [DECISIONS.md](DECISIONS.md) — why, and what was already debated
3. [ARCHITECTURE.md](ARCHITECTURE.md) — binding design contracts

## Current repository state

- Location: `/Users/ai/Desktop/applivity-harness` (local name differs from
  the GitHub repo name; canonical remote is
  `https://github.com/applivity-com/plato`, private, default branch
  `main`). Note: `applivity-com` is a personal user account, not an org.
- Contains: documentation only. No code exists yet. You are likely here to
  start M0.
- Git identity on this machine: `ukhan <umair1808@gmail.com>`.

## Environment prerequisites (verified facts)

- macOS. Git 2.50.1 present.
- Node.js v24.19.0 (LTS) installed via nvm 0.40.7; nvm init appended to
  `~/.zshrc`. pnpm 11.23.0 installed globally. If a terminal reports
  `node: command not found`, open a fresh terminal or run
  `. ~/.nvm/nvm.sh` first.
- Verify with `node -v && pnpm -v` before scaffolding.

## Your first job: M0 checklist

1. Scaffold the monorepo exactly as ARCHITECTURE.md specifies (pnpm
   workspaces, `packages/core` + `packages/vscode`, TS project refs).
2. Extension minimum: activate on command, open a webview chat panel,
   store the Anthropic key via `vscode.SecretStorage`, send one prompt
   with workspace-root file listing as context, stream the answer back.
3. Done means (do not declare done without it): install the unpacked
   extension in VS Code, open `/Users/ai/Desktop/HcadPublicAndroid-demo`,
   ask "What does this project do?", receive a correct grounded answer.
4. Commit in small steps; keep `packages/vscode` free of business logic.

## Ground rules for any agent working here

- Surgical changes only; touch only what the current milestone requires.
- Every milestone ends in something runnable — demo it, then commit.
- Do not add features from the non-goals list in BLUEPRINT section 3,
  even if they seem easy.
- If a design contract in ARCHITECTURE.md conflicts with reality, stop
  and record the proposed change in DECISIONS.md before deviating.
- Match existing conventions; no new frameworks/libraries without a
  recorded reason.

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
