# Windows worker brief — Plato for Visual Studio

You are the Windows machine worker. You own **M2 onward** (the Visual Studio
extension) and the **Windows verification of M0** (the shared-core shell
repair). The Plato CLI worker owns the M0 code on the Mac. The VS lead owns the
shim, the plan, and the integration.

Read first:

1. [`PLAN.md`](PLAN.md) — the full plan, milestones, parity checklist, and the
   platform facts.
2. [`../../docs/HANDOFF.md`](../../docs/HANDOFF.md) — current state.
3. [`../../docs/DECISIONS.md`](../../docs/DECISIONS.md) — D49cf.

## Machine facts (verified 2026-10-23)

- **OS:** Windows 10 22H2 (build 19045). **Visual Studio 2026 requires Windows
  11**, so this machine cannot run VS 2026. Do not attempt to install it.
- **Visual Studio 2022 Community 17.14.27** is installed at
  `C:\Program Files\Microsoft Visual Studio\2022\Community`.
  The **Visual Studio extension development workload is NOT installed yet.**
  M2 cannot build until it is added. The VS lead/founder will decide whether
  this machine is the VS 2022 development proxy or whether a Windows 11 machine
  with VS 2026 is used instead.
- **Node 22.20.0** is installed under
  `C:\Users\DummyUser\AppData\Local\nvm\v22.20.0`. The default `node` is still
  21.7.3. Put the Node 22 directory first on `PATH` for every build:
  `set "PATH=C:\Users\DummyUser\AppData\Local\nvm\v22.20.0;%PATH%"`.
- **pnpm 11.23.0** is installed in that Node 22 directory.
- **Claude Code 2.1.226** is at `C:\Users\Omega-PC\.local\bin\claude.exe`.
- **.NET Framework 4.8** targeting pack is present. .NET SDKs 3.1–9.0 are
  installed.
- **Disk:** about 282 GB free.
- **Code:** `C:\src\plato`, branch `vs/m1`. It was cloned from a Git bundle.
- **M1 spike:** passes on Windows. The existing host runs through the shim,
  produces the chat HTML, completes three scripted runs, and writes three
  transcripts.
- **SMB:** the Mac Desktop share rejects this machine (Windows 10 blocks guest
  SMB logons). Use SSH bundles, not SMB.
- **SSH:** `ssh omega@192.168.4.62` from the Mac works with the installed key.

## M2 — start after the extension workload exists

The first run uses `write_file` and `read_file`, not the shell tool, so M2 does
not wait for M0.

1. Build the VSIX skeleton: C# in-process VSPackage, WPF `ToolWindowPane`,
   WebView2, the VSIX v3 manifest, and the VSCT commands.
2. Bundle `node.exe` (Node 22 LTS, Windows x64) and `plato-host.cjs` from the
   M1 build. Start and stop the sidecar; speak newline-delimited JSON over
   stdio.
3. Inject `acquireVsCodeApi` and the message bridge with
   `AddScriptToExecuteOnDocumentCreatedAsync`. Load the chat HTML with
   `NavigateToString`.
4. Map the Visual Studio theme colors to the CSS custom properties listed in
   the plan. Credential Manager for keys. Open file and file picker. Solution
   root. Commands and menu.
5. Prove a real Visual Studio window: open the tool window, load the chat, run a
   scripted task with `write_file`, approve the write, confirm the file on
   disk, and take light and dark screenshots.

Do not add parity features until the shell loads the page and runs the
scripted task.

The VSIX must remain compatible with both VS 2022 and VS 2026. The extension
model is the same. The final acceptance run belongs on a Windows 11 machine
with VS 2026.

## M0 verification (when the Mac branch is ready)

The Plato CLI worker is changing `packages/core/src/tools/` and `packages/cli`.
When its branch is available:

1. `pnpm install`, `pnpm build`, `pnpm test` with Node 22 on `PATH`.
2. Run a real CLI task on Windows with:
   - a `shell` command;
   - a background shell;
   - an MCP `npx` server.
3. Check the policy:
   - `plan` denies every shell command and draws no card;
   - `edit` asks for every shell command;
   - `auto` runs without asking;
   - macOS/Linux behavior is unchanged.
4. Report the transcript, the commands, and any failure. Do not claim Windows
   is verified from a Mac.

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
