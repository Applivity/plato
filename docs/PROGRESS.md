# Plato — Progress Tracker

This file is the running record of the project. Every merged change gets
a row in the change log. Any developer or agent can reconstruct the
state of the project from this file plus `git log`.

## How to keep this file correct

1. Add a change-log row (date, commit hash or "this commit", area,
   summary, how verified) for every meaningful change, before you push.
2. Flip a milestone status only after its demo passes. Say how it was
   verified, with evidence (command output, screenshot, transcript).
3. Never delete rows. Corrections go in a new row.
4. Keep the "Current focus" line accurate whenever you stop working.

## Status at a glance

| Milestone | Deliverable | Status | Last updated |
|---|---|---|---|
| M0 | Skeleton extension: Solo-team chat, API key entry, one grounded answer | **in progress** | 2026-08-24 |
| M1 | Tool loop + modes/approvals + diff rendering | not started | — |
| M2 | Event bus + transcripts + cost meter + MCP client | not started | — |
| M3 | Teams + presets; observer injection/pause | not started | — |
| M4 | Acceptance test, packaged VSIX, release/license decision | not started | — |

Current focus: M0 scaffold and extension minimum (see checklist below).

## M0 checklist (from HANDOFF)

- [ ] Monorepo scaffold: pnpm workspaces, `packages/core` + `packages/vscode`,
      TypeScript project references (ARCHITECTURE.md layout).
- [ ] Extension activates on command.
- [ ] Opens webview chat panel.
- [ ] Stores Anthropic key in `vscode.SecretStorage`.
- [ ] Sends one prompt with workspace-root file listing as context.
- [ ] Streams the answer back into the panel.
- [ ] Done gate: unpacked extension installed in VS Code;
      `/Users/ai/Desktop/HcadPublicAndroid-demo` open;
      "What does this project do?" answered correctly and grounded.

## Change log (newest first)

| Date | Commit | Area | Summary | Verified by |
|---|---|---|---|---|
| 2026-08-24 | (this commit) | docs | Added PROGRESS.md tracker; recorded public-release secret-audit open item; recorded D21 scaffolding decisions | review |
| 2026-08-24 | 6d8428b | docs | Corrected local repo path to `plato`; marked toolchain setup resolved | diff review |
| 2026-08-24 | 053d93a | repo | Expanded .gitignore: secret deny-list, node/pnpm, TS output, VSIX, logs | `git check-ignore` probes |
| 2026-08-24 | 8343c15 | docs | Recorded canonical remote applivity-com/plato | review |
| 2026-08-24 | 0f22cdf | docs | Corrected GitHub account-type fact (user, not org); recorded finished toolchain setup | review |
| 2026-08-24 | 211d6e6 | docs | Blueprint, decision log, architecture, handoff authored | founder confirmation |
