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
| M1 | Tool loop + modes/approvals + diff rendering | **in review** (code done, tests pass; founder demo pending) | 2026-08-24 |
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

## M1 checklist

- [x] D22 recorded before code (loop, diff format, modes, known limits).
- [x] Mode policy table (`decide`): plan reads-only; edit writes
      approve-once-per-session; act clicks per action; auto capped.
- [x] Six-tool surface (read_file, write_file, apply_diff, shell,
      list_dir, grep) + read-only git status/diff.
- [x] Agent loop over native tool-use with approval callback and hard
      turn cap (MAX_TURNS = 40).
- [x] SEARCH/REPLACE diff engine: exact match, single-location,
      idempotent re-apply; ambiguous edits rejected, never guessed.
- [x] Secret guard on every tool call (deny-list paths + command text).
- [x] Shell rewrite: mode picker, approval cards with rendered diffs,
      session approval cache in the shell (core stays stateless).
- [ ] Founder demo: inject trivial bug into a scratch file in
      HcadPublicAndroid-demo, ask Plato to fix it in edit mode, approve
      via diff card. Closes M1.

## Change log (newest first)

| Date | Commit | Area | Summary | Verified by |
|---|---|---|---|---|
| 2026-08-24 | (this commit) | M1 | Durable chat log: conversation persisted to workspaceState and restored on every panel open (survives reloads/restarts; panel DOM also kept while hidden); UI rebuilt — proper input area (textarea + styled Send), mode header pills, colored diff cards; Plato replies now recorded too; XSS-hardened rendering (text nodes by default, HTML only for host-built tool labels/diffs) | `tsc -b` clean; 23/23 vitest; VSIX packaged + installed (@0.2.2); persistence + CSP markers verified in installed bundle |
| 2026-08-24 | (this commit) | M1 | Shell fixes from founder trial: retainContextWhenHidden + single-panel reveal (chat no longer clears), mode tooltips per D23, system prompt now demands defect enumeration before editing and re-read verification after; D23 recorded (edit vs act boundary); version bumped to 0.2.1 so builds are distinguishable | `tsc -b` clean; 23/23 vitest; VSIX packaged + installed (@0.2.1) |
| 2026-08-24 | (this commit) | M1 | Tool loop + modes/approvals + diff rendering: mode policy table, six tools + read-only git, native tool-use agent loop with approval callback and turn cap, idempotent SEARCH/REPLACE engine, secret guard per call, shell rewritten (mode picker, diff approval cards, session cache) | `tsc -b` clean; 23/23 vitest incl. diff idempotence + mode matrix + secret refusals; VSIX build green |
| 2026-08-24 | (this commit) | M0 | M0 closed: founder demo on HcadPublicAndroid-demo returned a correct, grounded answer; all cited components verified against repo tree and manifest | demo answer + assistant cross-check of file tree/manifest |
| 2026-08-24 | (this commit) | M0 | Monorepo scaffold + extension minimum: pnpm workspaces, TS project refs, core (secret filter, walker, Anthropic streaming provider, single-prompt runner), vscode shell (webview chat, SecretStorage); VSIX packaged and installed locally | `tsc -b` clean; 9/9 vitest; vsce package OK; `code --install-extension` OK |
| 2026-08-24 | (this commit) | docs | Added PROGRESS.md tracker; recorded public-release secret-audit open item; recorded D21 scaffolding decisions | review |
| 2026-08-24 | 6d8428b | docs | Corrected local repo path to `plato`; marked toolchain setup resolved | diff review |
| 2026-08-24 | 053d93a | repo | Expanded .gitignore: secret deny-list, node/pnpm, TS output, VSIX, logs | `git check-ignore` probes |
| 2026-08-24 | 8343c15 | docs | Recorded canonical remote applivity-com/plato | review |
| 2026-08-24 | 0f22cdf | docs | Corrected GitHub account-type fact (user, not org); recorded finished toolchain setup | review |
| 2026-08-24 | 211d6e6 | docs | Blueprint, decision log, architecture, handoff authored | founder confirmation |
