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
- [x] Founder demo: inject trivial bug into a scratch file in
      HcadPublicAndroid-demo, ask Plato to fix it in edit mode, approve
      via diff card. Closes M1.
      - [x] Founder confirmed 2026-08-24: edit mode identified all three
            planted bugs; prompt corrected so Plato fixes without stopping
            to ask; founder's act→edit mid-run switch exposed a snapshot-
            mode bug, fixed via live getMode(). M1 closed.

## M2 checklist

- [x] D24 recorded before code (bus semantics, observer mailbox,
      transcript format, cost rules, MCP trim to early M3).
- [x] Event bus (`core/src/runtime/bus.ts`): typed discriminated-union
      events, listener isolation, loop as single emitter; legacy shell
      callbacks bridged onto the bus (public surface unchanged).
- [x] Observer inbox (`RunController`): guidance queues FIFO and is
      injected at safe points (between turns/tool calls); pause blocks
      until resume; cancel stops after the in-flight tool call.
- [x] Transcripts: one JSONL file per run under `<root>/.plato/runs/`,
      header line first (schemaVersion 1), on by default; secret-safe by
      whitelist — tool args, approval previews and raw outputs are never
      written to disk.
- [x] Cost meter: per-turn `usage` events plus run totals returned in
      LoopResult and shown on the completion card ("✓ done … · $0.0042");
      unknown models quote $0 flagged not-estimated (D24d).
- [x] Unit coverage: bus delivery/isolation/unsubscribe, controller
      guidance/pause/cancel gates, cost math incl. unknown model,
      transcript whitelist + header + post-close silence (37 total).
- [x] Founder check PASSED 2026-08-25: transcript written under
      .plato/runs/ with schemaVersion-1 header, per-turn usage, complete
      event arc; args/previews absent from disk (whitelist verified by
      founder-inspected file); cost shown on done card ($0.0133 run,
      math reconciled against the price table). Remaining open item:
      MCP stdio client → early M3 (D24e).
- [ ] MCP stdio client → early M3 (D24e trim recorded).

## Change log (newest first)

| Date | Commit | Area | Summary | Verified by |
|---|---|---|---|---|
| 2026-08-25 | (this commit) | M2/shell | Completion-card pluralization ("1 tool call" vs "tool calls"). M2 founder check passed and recorded: transcript whitelist verified by founder inspection, cost reconciled against price table. Version 0.2.8 | `tsc -b --force` clean; 37/37 vitest; bundle in gate; VSIX @0.2.8 installed; marker grep |
| 2026-08-24 | (this commit) | M2/shell | New-chat mechanism (founder request): "Plato: New Chat" palette command + ＋ button in chat header; modal confirm, clears persisted workspaceState log, resets per-session write consents (new chat = new session per D23), blanks webview via restore handshake; refuses while a run is active. Process fix: VSIX packaging must run after esbuild bundle (0.2.7 first cut shipped a stale bundle — caught by marker grep) | `tsc -b --force` clean; 37/37 vitest; bundle step in gate; VSIX @0.2.7 packaged + installed; newChat/confirm markers verified in installed bundle |
| 2026-08-24 | (this commit) | M2 | Event bus + observer mailbox + transcripts + cost meter per D24: typed bus with isolated listeners, loop single-emitter with legacy callbacks bridged; RunController guidance/pause/cancel honored at safe points; JSONL transcripts per run under .plato/runs/ (secret-safe whitelist, header schemaVersion 1); usage/cost per turn and run, cost on completion card. MCP trimmed to early M3. Version 0.2.6 | `tsc -b --force` clean; 37/37 vitest (14 new: bus/controller/cost/transcript); VSIX @0.2.6 packaged + installed; transcript/cost/bus markers verified in bundle |
| 2026-08-24 | (this commit) | M1 | Run-visibility UX from founder feedback: live status chip in header ("working Ns · read_file…", pulses; green "✓ done" state persists after finish); explicit completion entry "✓ done in Xs · N tool calls" appended to transcript; smart auto-scroll follows output only when already near bottom, never yanks while reading; host now reports duration + tool count with done event | `tsc -b` clean; 23/23 vitest; VSIX @0.2.5 packaged + installed; chip/completion markers verified in bundle |
| 2026-08-24 | (this commit) | M1 | Mid-run mode switches now apply immediately: loop reads mode live via getMode() callback instead of a snapshot taken at run start (founder trial: act→edit switch mid-run kept old policy). Confirmed-by-design: act asks per action with no memory; edit asks once per file per session. Version 0.2.4 | `tsc -b` clean; 23/23 vitest; VSIX @0.2.4 packaged + installed; getMode marker in bundle |
| 2026-08-24 | (this commit) | M1 | Prompt fix from founder trial: Plato enumerated bugs then stopped to ask permission; system prompt now says fix immediately in the same run since the UI enforces write approval anyway. Founder confirmed edit mode identified all planted bugs (3/3). Version 0.2.3 | `tsc -b` clean; 23/23 vitest; VSIX packaged + installed |
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
