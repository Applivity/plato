# Windows worker brief — Plato for Visual Studio

You are the Windows machine worker. You own **M3 onward** (Visual Studio parity)
on the Windows machine. **M2 is passed**, and the **Windows verification of M0**
is done. The Plato CLI worker owns the Mac release. The VS lead owns the shim,
the plan, and the integration.

Read first:

1. [`PLAN.md`](PLAN.md) — the full plan, milestones, parity checklist, and the
   platform facts.
2. [`../../docs/HANDOFF.md`](../../docs/HANDOFF.md) — current state.
3. [`../../docs/DECISIONS.md`](../../docs/DECISIONS.md) — D49cf.

## Machine facts (verified 2026-10-23)

- **OS:** Windows 10 22H2 (build 19045). Microsoft supports Visual Studio 2026
  on Windows 11 only. **VS 2026 18.11.1 is installed and runs here anyway.**
  Treat Windows 10 as an unsupported development environment; the final
  acceptance run belongs on Windows 11.
- **Visual Studio 2026 Community 18.11.1** is installed at
  `C:\Program Files\Microsoft Visual Studio\18\Community`.
  `devenv.exe` and `MSBuild.exe` are present. The **Visual Studio extension
  development workload is installed.** WebView2 runtime 155.0.4283.62. .NET
  Framework 4.8 targeting pack present.
- **Visual Studio 2022 Community 17.14.42** is also installed, without the
  extension workload. Use VS 2026.
- **Node 22.20.0** is installed under
  `C:\Users\DummyUser\AppData\Local\nvm\v22.20.0`. The default `node` is still
  21.7.3. Put the Node 22 directory first on `PATH` for every build:
  `set "PATH=C:\Users\DummyUser\AppData\Local\nvm\v22.20.0;%PATH%"`.
- **pnpm 11.23.0** is installed in that Node 22 directory.
- **Claude Code 2.1.226** is at `C:\Users\Omega-PC\.local\bin\claude.exe`.
- **.NET Framework 4.8** targeting pack is present. .NET SDKs 3.1–9.0 are
  installed.
- **Disk:** about 282 GB free.
- **Code:** `C:\src\plato`, branch `vs/m2`. It was cloned from a Git bundle.
- **M1 spike:** passes on Windows. The existing host runs through the shim,
  produces the chat HTML, completes three scripted runs, and writes three
  transcripts.
- **M0 (the shared-core Windows repair):** **DONE and verified on Windows.**
  Mac core 908/1 skipped, CLI 180; Windows core 907/2 skipped, CLI 177/3
  skipped; the real Windows command/background/MCP run passed. Branch
  `windows/m0` (`16b3007`) is merged into `main` and deleted.
- **SMB:** the Mac Desktop share rejects this machine (Windows 10 blocks guest
  SMB logons). Use SSH bundles, not SMB.
- **SSH:** `ssh omega@192.168.4.137` from the Mac works with the installed key.

## M2 — PASSED (2026-10-23)

The shell is built and witnessed in a real Visual Studio 2026 18.11.1 window.
Commit `6697d81` is on `vs/m2`; the bundle is `C:\src\vs-m2.bundle`; evidence
is in `C:\src\plato-vs-field\evidence`. The tool window loads the chat, the
scripted `write_file` task draws the approval card and writes the file, the
transcript is under `~/.plato`, light and dark screenshots exist, and the
sidecar exits when Visual Studio closes.

The read-only planner confirmed the installed VSIX template is an SDK-style
**net472** project with **VSSDK BuildTools 18.9.820**; the manifest range covers
**VS 18.x**; the templates are installed; NuGet is reachable; and the
**WebView2 SDK** is available. The installed template was used.

The first run used `write_file` and `read_file`, not the shell tool, so M2 did
not wait for M0.

What was built:

1. The VSIX skeleton: C# in-process VSPackage, WPF `ToolWindowPane`, WebView2,
   the VSIX v3 manifest, and the VSCT commands.
2. The sidecar: `node.exe` (Node 22 LTS, Windows x64) and `plato-host.cjs` from
   the M1 build, started and stopped by the shell, speaking newline-delimited
   JSON over stdio.
3. The page: `acquireVsCodeApi` and the message bridge injected with
   `AddScriptToExecuteOnDocumentCreatedAsync`; the chat HTML loaded with
   `NavigateToString`.
4. Visual Studio theme mapping, Credential Manager for keys, open file, file
   picker, solution root, commands, and menu.
5. A real Visual Studio window: the tool window loaded the chat, a scripted
   `write_file` task drew the approval card, the write was approved, the file
   was confirmed on disk, and light and dark screenshots were taken.

The gate is met, so M3 parity can start.

The VSIX manifest currently accepts VS 2022 and VS 2026, but VS 2022 is
untested and not in v1. The final acceptance run belongs on a Windows 11
machine with VS 2026.

## M0 verification — DONE (2026-10-23)

The checks that passed on Windows:

1. `pnpm install`, `pnpm exec tsc -b`, `pnpm test` with Node 22 on `PATH`.
2. A real CLI task on Windows with:
   - a `cmd.exe` `shell` command;
   - a background shell, read and killed;
   - a fake MCP stdio server's `echo` tool.
3. The policy:
   - `plan` denies every shell command and draws no card;
   - `edit` asks for every shell command;
   - `auto` runs without asking;
   - macOS/Linux behavior is unchanged.
4. The transcript carried all five required events.

## M4a — PASSED (2026-10-24)

The agent-features half of M4 is witnessed in a real Visual Studio 2026
window: MCP configuration and status, images and file attachments, undo,
protected-file masking and the reveal card, and the stuck card. The shared
host and the unchanged chat HTML carry all five. The host test is
`packages/vs/test/m4a.test.mjs`; the exact-copy render assertions are in
`scripts/render/` for the lead on macOS. **One defect was fixed (D49ci): an
MCP server whose command cannot spawn killed the Node sidecar.** Evidence:
`C:\src\plato-vs-field\evidence\m4\checkpoint-a\`.

Two field-harness traps found here: the session-2 desktop is locked, so
`SendInput` (and `SendKeys`) is denied; the helper fills the native file
dialog with Win32 messages instead. The VS editor surface does not render
through `PrintWindow` on that desktop, so DTE `activeDocument` is the witness
that a file opened.

## Report

For each milestone, report:

- the exact commands you ran;
- their output;
- the transcript path;
- the screenshot paths;
- the diff or branch name;
- anything you could not verify.

The acceptance rule is the same as the rest of the project: a green build is
not a witness. A real Visual Studio window and a transcript are.
