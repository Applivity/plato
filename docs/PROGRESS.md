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
| M0 | Skeleton extension: Solo-team chat, API key entry, one grounded answer | **done** (demo passed 2026-08-24) | 2026-08-24 |
| M1 | Tool loop + modes/approvals + diff rendering | not started | — |
| M2 | Event bus + transcripts + cost meter + MCP client | not started | — |
| M3 | Teams + presets; observer injection/pause | not started | — |
| M4 | Acceptance test, packaged VSIX, release/license decision | not started | — |

Current focus: M1 — full tool loop, modes/approvals, diff rendering.

## M0 checklist (from HANDOFF)

- [x] Monorepo scaffold: pnpm workspaces, `packages/core` + `packages/vscode`,
      TypeScript project references (ARCHITECTURE.md layout).
- [x] Extension activates on command (`plato.openChat`, `plato.setApiKey`).
- [x] Opens webview chat panel.
- [x] Stores Anthropic key in `vscode.SecretStorage`.
- [x] Sends one prompt with workspace-root file listing as context
      (secret deny-list enforced in the walker; unit-tested).
- [x] Streams the answer back into the panel.
- [x] Done gate: unpacked extension installed in VS Code;
      `/Users/ai/Desktop/HcadPublicAndroid-demo` open;
      "What does this project do?" answered correctly and grounded.
      - [x] VSIX built and installed locally (`applivity.plato-vscode`)
      - [x] Founder ran the demo; Plato's answer identified the HCAD
            property-tax exemption domain and cited real components
            (CameraActivity, LicenseScannerActivity, DamageReportActivity,
            IFileLookupActivity, SignatureCaptureActivity, SubmissionsActivity,
            MultiOwnerActivity, WebDataIntentService) — all verified present in
            the repo tree and manifest by the assistant before closing M0.

## Change log (newest first)

| Date | Commit | Area | Summary | Verified by |
|---|---|---|---|---|
| 2026-08-24 | (this commit) | M0 | M0 closed: founder demo on HcadPublicAndroid-demo returned a correct, grounded answer; all cited components verified against repo tree and manifest | demo answer + assistant cross-check of file tree/manifest |
| 2026-08-24 | (this commit) | M0 | Monorepo scaffold + extension minimum: pnpm workspaces, TS project refs, core (secret filter, walker, Anthropic streaming provider, single-prompt runner), vscode shell (webview chat, SecretStorage); VSIX packaged and installed locally | `tsc -b` clean; 9/9 vitest; vsce package OK; `code --install-extension` OK |
| 2026-08-24 | (this commit) | docs | Added PROGRESS.md tracker; recorded public-release secret-audit open item; recorded D21 scaffolding decisions | review |
| 2026-08-24 | 6d8428b | docs | Corrected local repo path to `plato`; marked toolchain setup resolved | diff review |
| 2026-08-24 | 053d93a | repo | Expanded .gitignore: secret deny-list, node/pnpm, TS output, VSIX, logs | `git check-ignore` probes |
| 2026-08-24 | 8343c15 | docs | Recorded canonical remote applivity-com/plato | review |
| 2026-08-24 | 0f22cdf | docs | Corrected GitHub account-type fact (user, not org); recorded finished toolchain setup | review |
| 2026-08-24 | 211d6e6 | docs | Blueprint, decision log, architecture, handoff authored | founder confirmation |
