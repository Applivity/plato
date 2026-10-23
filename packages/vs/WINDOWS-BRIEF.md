# Windows worker brief — Plato for Visual Studio

You are the Windows machine worker. You own **M2 onward** (the Visual Studio
extensions) and the **Windows verification of M0** (the shared-core shell
repair). The Plato CLI worker owns the M0 code on the Mac. The VS lead owns the
shim, the plan, and the integration.

Read first:

1. [`PLAN.md`](PLAN.md) — the full plan, milestones, parity checklist, and the
   platform facts.
2. [`../../docs/HANDOFF.md`](../../docs/HANDOFF.md) — current state.
3. [`../../docs/DECISIONS.md`](../../docs/DECISIONS.md) — D49cf.

## Get the code

The Mac project directory is shared over SMB. **Copy it to a local Windows
clone. Do not build or run from the SMB share.** pnpm symlinks, MSBuild file
locks, file watchers, and long paths are unreliable there.

- Copy the whole repository, including `.git`, to a local path such as
  `C:\src\plato`.
- The M1 shim spike is in `packages/vs/`. It is not committed or pushed.
- The Plato CLI worker is editing `packages/core` and `packages/cli` for M0.
  Do not edit those files at the same time; coordinate through the VS lead.
- Do not push to GitHub. The founder pushes when the work has taken shape. Use
  a local branch and report the diff.

## M2 — start now (parallel with M0)

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
5. Prove a real VS 2026 window: open the tool window, load the chat, run a
   scripted task with `write_file`, approve the write, confirm the file on
   disk, and take light and dark screenshots.

Do not add parity features until the shell loads the page and runs the
scripted task.

## M0 verification (when the Mac branch is ready)

The Plato CLI worker is changing `packages/core/src/tools/` and `packages/cli`.
When its branch is available on the shared folder or a local remote:

1. `pnpm install`, `pnpm build`, `pnpm test`.
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
