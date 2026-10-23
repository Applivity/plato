# Plato for Visual Studio — implementation plan

Status: **M0 DONE; M1, M2, M3a AND M3b (CHECKPOINTS 1, 2a AND 2b) PASSED (2026-10-23), SO M3 IS COMPLETE. M4a, THE AGENT-FEATURES HALF OF M4, PASSED (2026-10-24); M4b IS NEXT.** Phase 3 opened 2026-10-23.
M0 is verified on Windows (unit and real run), and the shim gate is green: the
existing VS Code host runs outside VS Code. M2 is built and witnessed in a real
Visual Studio 2026 window. M3a (settings and keys) and M3b (modes, approvals,
teams, history) passed; M4a (MCP, images and attachments, undo, masking/reveal,
and the stuck card) passed and M4b is next. The founder approved this plan.
The decision record is D49cf in
[`docs/DECISIONS.md`](../../docs/DECISIONS.md). This file is the implementation
plan and the definition of done.

## Read this first

You are building a Visual Studio 2026 host for the same Plato engine and the
same chat UI that the VS Code extension uses. You are not building a second
agent and not building a second chat UI.

Read in this order:

1. [`docs/HANDOFF.md`](../../docs/HANDOFF.md) — the current state.
2. [`docs/DECISIONS.md`](../../docs/DECISIONS.md) — D49cf and the host decisions
   D49bw–D49cc.
3. This file.
4. [`packages/vscode/src/extension.ts`](../vscode/src/extension.ts) — the IDE
   host that you will reuse.
5. [`packages/vscode/src/webview.ts`](../vscode/src/webview.ts) — the chat UI
   that you will reuse.
6. [`packages/core/src/runtime/loop.ts`](../core/src/runtime/loop.ts) — the
   loop's host contract (`LoopOptions`).
7. [`packages/cli/src/host.ts`](../cli/src/host.ts) — the `RunSink` contract and
   `executeTask`, the fallback engine.
8. [`scripts/render/README.md`](../../scripts/render/README.md) and
   [`scripts/field/README.md`](../../scripts/field/README.md) — how the product
   is verified.

## What it is

A Visual Studio 2026 extension that runs Plato in a dockable tool window. It
supports the same Solo, Duo, and Academy teams; the same three modes; the same
approval, question, stuck, undo, reveal, and mode-request cards; the same
providers, keys, MCP servers, images, transcripts, undo store, and protected-file
rules as the VS Code extension and the CLI.

Visual Studio is Windows-only. Visual Studio for Mac is retired. Visual Studio
2022 is **not** in v1; the VS 2026 extension model is backward compatible, so
VS 2022 support is a later compatibility test, not a second codebase.

## Locked decisions (founder, 2026-10-23)

| Decision | Choice |
|---|---|
| Target | Visual Studio 2026 first |
| Scope | Full parity before public publish |
| Architecture | Shim first; no functional compromise. Use the conventional bridge if the shim cannot reach parity |
| Environment | Full Windows machine with Visual Studio 2026 |
| Repository | Shared over SMB, but **built from a local clone** (see “Environment”) |
| Publishing | Visual Studio Marketplace after parity; signed VSIX for internal builds |
| Windows repair | First. It is a prerequisite and it fixes the VS Code extension and CLI on Windows |

## Principles

1. **One engine, one IDE host, one UI.** Do not fork the loop, tools, permission
   table, security checks, card copy, or chat UI.
2. **Core has no Visual Studio imports.** The Visual Studio shell is a host
   adapter, like the CLI.
3. **The shell is thin.** The agent runs in a Node sidecar. A sidecar crash must
   not stop Visual Studio.
4. **No secrets in files.** API keys live in Windows Credential Manager. They
   never enter settings, logs, transcripts, screenshots, or the Marketplace
   listing.
5. **Fail closed.** If the shim cannot answer an approval, the call is refused
   and the model is told why.
6. **Copy comes from core.** Do not write new product copy in C#. Cards,
   refusals, notices, and undo text are already in core.
7. **Windows is a first-class platform.** No POSIX assumption may remain in the
   path of a run.
8. **Verify in a real window.** A screenshot in real Visual Studio and a
   transcript are the two witnesses. A passing unit test is not parity.

## Architecture

```
Visual Studio 2026 (devenv.exe)
  └─ Plato VSIX (C#, in-process VSPackage, WPF)
       ├─ Tool window hosting WebView2
       │    └─ chatHtml() from packages/vscode/src/webview.ts
       ├─ Native services
       │    ├─ VS theme colors
       │    ├─ Windows Credential Manager
       │    ├─ file dialogs and open-file
       │    ├─ solution/folder root
       │    └─ optional diff and diagnostics
       └─ newline-delimited JSON over stdio
            ↕
       plato-host.cjs (Node 22 LTS sidecar)
            ├─ vscode API shim
            ├─ existing IDE host (packages/vscode/src/extension.ts, unchanged)
            └─ @applivity/plato-core (unchanged)
                 ├─ providers
                 ├─ tools and Windows shell layer
                 ├─ MCP servers
                 └─ ~/.plato state
```

### Why this shape

- The existing IDE host is 4.9k lines of tested product behaviour: settings,
  sessions, titles, folding, attachments, cards, notices, and every edge case the
  field tests found. Reimplementing it is the duplication this plan exists to
  avoid.
- The chat UI is one HTML file. It talks through `acquireVsCodeApi()` and
  `window.postMessage`. WebView2 can provide both with an injected script. The
  render harness already proves this pattern by faking `acquireVsCodeApi`.
- The VS Code API surface the extension uses is about 25 members. The shim is
  small enough to read in one sitting and type-check.

### Fallback

The M1 gate passed on 2026-10-23, so the bridge is a contingency, not the
default. If a later parity item cannot be expressed through the shim, use the
conventional bridge:

- Reuse `executeTask` and `RunSink` from `packages/cli/src/host.ts` as the
  headless engine.
- Write a protocol adapter from the chat webview's messages to the sink.
- Keep the C# shell and the WebView2 UI.

The bridge is the fallback because it creates a third host implementation. Set
go/no-go gates so you do not discover this after months of work.

## Environment

- **Windows 10 22H2 (19045) development machine**, Visual Studio 2026
  18.11.1 Community with the **Visual Studio extension development** workload
  (`C:\Program Files\Microsoft Visual Studio\18\Community`). Microsoft supports
  VS 2026 on Windows 11 only; this machine is a development and smoke-test
  proxy. **The final acceptance VM must be Windows 11.**
- **Clone the repository locally on Windows** at `C:\src\plato`. Do not build,
  run, or open the solution from the SMB share. SMB guest logons are blocked on
  this machine; the code travels as a Git bundle over SSH.
- **Node 22.20.0** at `C:\Users\DummyUser\AppData\Local\nvm\v22.20.0`, with
  pnpm 11.23.0. The default `node` is 21.7.3; put the Node 22 directory first.
- Windows SDK and .NET Framework 4.8 targeting pack, as required by the VS SDK.
  Both are present.
- A second “clean” **Windows 11** VM for the final install test. It must have no
  Node installed and no repository.
- The macOS field harness is not replaced. It stays the regression suite for the
  engine and the UI. The Windows suite is added beside it.

## Repository layout

New code lives in `packages/vs`:

```
packages/vs/
  PLAN.md                        this file
  README.md                      user-facing, written in M5
  src/
    Plato.Vs/                    C# VSIX
      Plato.Vs.csproj
      source.extension.vsixmanifest
      PlatoPackage.cs            AsyncPackage, commands, tool window registration
      PlatoToolWindow.cs         ToolWindowPane
      PlatoWebViewControl.xaml   WPF UserControl hosting WebView2
      PlatoWebViewControl.xaml.cs
      Bridge/
        SidecarProcess.cs        start, stop, restart, stdio JSON
        Protocol.cs              message types, serialization
      Native/
        ThemeService.cs          VSColorTheme -> CSS variables
        CredentialStore.cs       CredRead/CredWrite/CredDelete
        FileDialogService.cs     open file, pick attachments
        EditorService.cs         open file, close active editor
        SolutionService.cs       solution/folder root, change events
        DiagnosticsService.cs    optional; see “Known gaps”
      Commands/
        PlatoCommands.vsct
      Resources/
        icon.png
  host/                          TypeScript sidecar
    main.ts                      entry point, stdio framing
    shim/vscode.ts               the VS Code API compatibility layer
    bridge.ts                    RPC client/server
    defaults.ts                  generated from packages/vscode/package.json
    esbuild.mjs                  bundle to one CJS file
  test/
    shim/                        Node contract tests
    bridge/                      protocol tests
    windows/                     Windows-only integration tests
  scripts/
    build-host.mjs
    package-vsix.ps1
    install-vsix.ps1
    run-field.ps1                Windows field driver
```

New file in core:

- `packages/core/src/tools/shellPlatform.ts` — one place that answers “which
  program runs this command, and how do I stop it”. The CLI, VS Code host, and
  Visual Studio host all use it.

Do not change `packages/vscode/src/*` for the first version. The WebView2
injected script makes the chat UI work unchanged. If a change is unavoidable,
keep it backward compatible and record it in DECISIONS.

## The sidecar

- **Runtime:** `node.exe` from the pinned Node 22 LTS Windows x64 build.
- **Bundle:** one CommonJS file, `plato-host.cjs`, built by esbuild. It contains
  the extension host, the shim, core, and the provider SDK. No native modules.
- **Start:** C# starts `node.exe plato-host.cjs` with redirected stdin/stdout/
  stderr, `UseShellExecute=false`, `CreateNoWindow=true`.
- **Stop:** on package dispose and on Visual Studio exit. Send `shutdown`, wait
  2 seconds, then kill the process tree.
- **Restart:** if the sidecar exits unexpectedly, show a notice and restart it
  on the next command. Do not restart during a run.
- **Logs:** `%LOCALAPPDATA%\Plato\logs\host-<timestamp>.log`. stdout is the
  protocol only. The shim must not `console.log`.
- **No ports. No HTTP. No WebSocket.** Local stdio only.

### Protocol

One JSON object per line. Every request has `id`, `method`, and `params`.
Responses have `id`, `result` or `error`. Notifications have `method` and
`params`, no `id`.

Host → sidecar:

| Method | Purpose |
|---|---|
| `init` | root, settings path, state path, theme, version |
| `webview.message` | a message from the page (the existing message protocol) |
| `command` | run a registered VS Code command, e.g. `plato.openChat` |
| `theme.changed` | theme colors changed |
| `solution.changed` | root changed |
| `shutdown` | stop cleanly |

Sidecar → host:

| Method | Purpose |
|---|---|
| `webview.html` | set the page HTML |
| `webview.post` | post a message to the page |
| `panel.reveal` | show/activate the tool window |
| `panel.disposed` | the host disposed the panel |
| `ui.quickPick` | native pick list |
| `ui.inputBox` | native text/password input |
| `ui.openDialog` | native file picker |
| `ui.message` | info/warning/error message with optional buttons |
| `editor.open` | open a file in Visual Studio |
| `editor.closeActive` | close the active editor |
| `secrets.get` | read a credential |
| `secrets.store` | write a credential |
| `secrets.delete` | delete a credential |
| `diagnostics.get` | optional; see “Known gaps” |
| `diagnostics.subscribe` | optional |
| `log` | write a line to the log file |

Rules:

- Unknown methods return an error; do not crash.
- A request must time out. Use 30 seconds for UI and secrets, 10 seconds for
  the rest.
- The sidecar never sends a request before `init` completes.
- The C# side marshals all UI work to the Visual Studio UI thread with
  `JoinableTaskFactory`.

## The `vscode` shim

The shim implements only what the extension uses. Type-check it by compiling
the sidecar with a path alias:

```json
{ "paths": { "vscode": ["./shim/vscode.ts"] } }
```

A member the extension adds later becomes a compile error, not a runtime crash.

### Local implementations

- `Uri` (`file`, `joinPath`, `fsPath`, `toString`)
- `RelativePattern`
- `EventEmitter`, `Event`, `Disposable`
- `TreeItem`, `TreeItemCollapsibleState`, `ThemeIcon`
- `ViewColumn`, `ConfigurationTarget`, `DiagnosticSeverity`
- `workspace.fs` (`stat`, `readFile`, `writeFile`, `createDirectory`)
- `workspace.workspaceFolders` (one folder: the solution or open-folder root)
- `workspace.getConfiguration('plato')` with defaults generated from
  `packages/vscode/package.json`
- `workspace.onDidChangeConfiguration`
- `workspace.createFileSystemWatcher` (`fs.watch`, recursive)
- `workspace.openTextDocument` (returns `{ uri }`)
- `ctx.workspaceState` and `ctx.globalState` (JSON files, atomic writes)
- `ctx.subscriptions`
- `commands.registerCommand` and `commands.executeCommand` (local registry)

### RPC-backed implementations

- `window.createWebviewPanel` → tool window
- `panel.webview.html` → `webview.html`
- `panel.webview.postMessage` → `webview.post`
- `panel.webview.onDidReceiveMessage` ← `webview.message`
- `panel.reveal` → `panel.reveal`
- `panel.onDidDispose` ← `panel.disposed`
- `window.showQuickPick`, `showInputBox`, `showOpenDialog`,
  `showInformationMessage`, `showErrorMessage`, `showWarningMessage`
- `window.showTextDocument`
- `ctx.secrets.get/store/delete`
- `languages.getDiagnostics`, `languages.onDidChangeDiagnostics` (optional)
- `commands.executeCommand('workbench.action.closeActiveEditor')`
- `window.tabGroups.activeTabGroup.activeTab` (stub with `activeTab: undefined`)
- `window.createTreeView` (stub for v1; the webview History page is the UI)

### Defaults

Generate `host/defaults.ts` from the `contributes.configuration` block in
`packages/vscode/package.json` at build time. Do not copy the values by hand.
The values that matter: `connections: []`, `model:
anthropic:claude-sonnet-4-5`, `reasoning: off`, `orchestration: solo`,
`compaction.threshold: 0.8`, `secrets.protect: []`, `secrets.allow: []`,
`search.respectGitignore: false`.

### State files

- Settings: `%APPDATA%\Plato\settings.json` as a `{ "plato.<key>": value }`
  object. One file for all scopes in v1; log a note if the extension asks for a
  workspace scope.
- Chat log: `%APPDATA%\Plato\workspace-state\<project-key>.json`, where
  `project-key` is the same first 8 hex of SHA-1 of the root that the CLI and
  extension use.
- Runs, undo, teams, MCP, `PLATO.md`: `~/.plato` unchanged. This is shared with
  the other hosts.

## Native services

### Window

- A `ToolWindowPane` registered with `[ProvideToolWindow]`.
- Content is a WPF `UserControl` with a `Microsoft.Web.WebView2.Wpf.WebView2`.
- Initialize with `EnsureCoreWebView2Async` on the UI thread.
- User data folder: `%LOCALAPPDATA%\Plato\WebView2`. Keep the WebView2 loader
  local to the extension. Test on a clean Visual Studio for DLL conflicts.
- The tool window can be docked, floated, and hidden. Hiding must not unload
  the page; closing disposes the panel.

### Page and transport

1. The sidecar calls `activate()` and sets `panel.webview.html`.
2. The shim sends `webview.html` to C#.
3. C# calls `AddScriptToExecuteOnDocumentCreatedAsync` with a small script:

```js
window.acquireVsCodeApi = () => ({
  postMessage: (m) => window.chrome.webview.postMessage(m),
  getState: () => undefined,
  setState: () => {}
});
window.chrome.webview.addEventListener('message', (e) => {
  window.dispatchEvent(new MessageEvent('message', { data: e.data }));
});
```

4. C# calls `NavigateToString(html)`. The HTML is about 136 KB; the limit is
   well above that.
5. Page → host messages arrive in `WebMessageReceived`; C# sends
   `webview.message` to the sidecar.
6. Host → page messages use `PostWebMessageAsJson`; the injected listener
   dispatches them.

Do not change the webview file. The render harness already proves this pattern.

### Theme

Visual Studio has no `--vscode-*` variables. Read the colors in C# with
`VSColorTheme.GetThemedColor` and send them to the page as CSS custom
properties. Start with these, because they carry most of the UI:

`--vscode-editor-background`, `--vscode-editor-foreground`,
`--vscode-descriptionForeground`, `--vscode-focusBorder`,
`--vscode-input-background`, `--vscode-input-foreground`,
`--vscode-input-border`, `--vscode-button-background`,
`--vscode-button-foreground`, `--vscode-button-secondaryBackground`,
`--vscode-button-secondaryForeground`, `--vscode-editorWidget-background`,
`--vscode-textCodeBlock-background`, `--vscode-textLink-foreground`,
`--vscode-list-hoverBackground`, `--vscode-list-activeSelectionBackground`,
`--vscode-charts-blue`, `--vscode-testing-iconPassed`,
`--vscode-testing-iconFailed`, `--vscode-editorWarning-foreground`,
`--vscode-font-family`, `--vscode-editor-font-family`.

Verify in light and dark themes with screenshots. The fallbacks keep the page
usable if a color is missed.

### Secrets

Use Windows Credential Manager:

- Target: `plato.providers.<connection-id>.apiKey`.
- Generic credential, current user.
- `CredRead`, `CredWrite`, `CredDelete` from `advapi32.dll`, or a small wrapper
  such as `Meziantou.Framework.Win32.CredentialManager`.
- Never write a key to settings, logs, transcripts, or the `.vs` folder.
- The shim's `ctx.secrets.get/store/delete` call these methods.

### Editor

- Open file: `VsShellUtilities.OpenDocument` or `DTE.ItemOperations.OpenFile`.
- Close active editor: `DTE.ExecuteCommand("File.Close")` or the documented
  close command; confirm in the spike.
- Diff: `IVsDifferenceService.OpenComparisonWindow2` only if a later feature
  needs it. The approval cards render diffs inside the page.

### Workspace root

- If a solution is open: the solution directory.
- Else if a folder is open: the folder.
- Else: the directory of the active document.
- Else: show a message that asks the user to open a solution or folder.
- Subscribe to solution open/close and send `solution.changed`.

### Commands

VSCT commands, routed to the sidecar's `command` method:

- `Plato: Open Chat` (`plato.openChat`)
- `Plato: New Chat` (`plato.newChat`)
- `Plato: Set API Key` (`plato.setApiKey`)
- `Plato: Manage API Keys` (`plato.manageKeys`)

Add `Plato: Open Chat` to the Tools menu and to View → Other Windows.

## Windows foundation (M0)

This is a repair, not a Visual Studio feature. It also fixes the existing VS
Code extension and CLI on Windows. The project record says the CLI runs on
Windows; the terminal UI can, but a run that uses `shell` cannot.

### Execution

- Add `packages/core/src/tools/shellPlatform.ts`:
  - POSIX: `/bin/bash -c <command>`.
  - Windows: `process.env.ComSpec ?? 'cmd.exe'` with `/d /s /c <command>`.
- Use it in `shellTool` and `ShellManager.start`.
- Set `windowsHide: true` on Windows.

### Process trees

- POSIX: keep the negative-PID process-group kill and `SIGKILL`.
- Windows: kill the tree with `taskkill /PID <pid> /T /F`. Wait for exit.
  Do not use negative PIDs.
- `killAll` must still await exits and report the count.

### MCP

- On Windows, resolve `.cmd` shims (`npx.cmd`, `uvx.cmd`, `pnpm.cmd`). Either
  resolve the path yourself or spawn through `cmd.exe /d /s /c`. Test with a
  real `npx` server.
- Keep environment merging case-insensitive on Windows.

### Read-only shell policy

The existing allowlist is a bash parser. It can prove that a command such as
`git status` only reads. It cannot prove what `cmd.exe` will do. So the Windows
policy is deliberately more conservative than the POSIX policy:

- **On Windows, `plan` denies every shell command and draws no card.** The mode's
  promise is read-only, and asking could let a write run under plan's name. The
  model keeps `read_file`, `list_dir`, `grep`, `glob`, and the dedicated
  `git status` / `git diff` tools, so it can still inspect the workspace.
- **On Windows, `edit` asks for every shell command.** There is no read-only
  auto-approval. The user can approve a command; edit is allowed to run it.
- **On Windows, `auto` is unchanged.** Commands run without a card.
- **On macOS and Linux, nothing changes.** The existing allowlist still
  auto-approves proven read-only commands in plan and edit.
- The refusal message must say why: “Plato cannot prove a command is read-only
  on Windows. Use the file tools or the git tool, or switch to edit.”
- A Windows read-only allowlist is a later security project, not v1. It needs
  its own decision and its own tests.

### Paths and keys

- Settings and data: `%APPDATA%\Plato` and `%LOCALAPPDATA%\Plato`.
- Shared state: `~/.plato` (which is `C:\Users\<name>\.plato`).
- Keychain: use Windows Credential Manager through the existing keyring
  dependency. Test the 0600-file fallback on Windows; file modes do not work
  there, so prefer the keychain.

### Tests and CI

- Unit tests for invocation selection and process-tree kill. Inject the
  platform so the tests run on macOS too.
- A Windows CI job runs `pnpm test` and the CLI scripted matrix.
- A real-model run on Windows, with a command and a background command.
- The macOS suite must stay green. The Windows change must not alter POSIX
  behavior.

### M0 exit criteria

- The CLI runs a real task on Windows.
- A `shell` command and a background shell both work, and both stop at run end.
- An MCP `npx` server starts and its tool is used.
- The existing macOS tests pass.
- No `/bin/bash` remains outside the POSIX branch of `shellPlatform.ts`.

## Milestones

Each milestone ends in something runnable. A milestone is done only when its
verification passes. Do not mark it done from a passing build.

### M0 — Windows foundation

**Owner:** the **Plato CLI worker** writes the code and the macOS tests. The
**Windows machine worker** verifies it on Windows.

**Parallel work:** M2 may start before M0 is green. The C# shell and WebView2 do
not need the shell tool; the first run uses `write_file` and `read_file`. The
M0 gate applies before parity and release, not before the shell skeleton.

**Estimate:** 1–2 weeks.

**Status: DONE (2026-10-23).** The Mac suite is core 908 passed / 1 skipped and
CLI 180; the Windows suite is core 907 passed / 2 skipped and CLI 177 passed /
3 skipped. The real Windows run passed: a `cmd.exe` command wrote its marker, a
background shell was read with `bash_output` and stopped with `kill_shell`, and
the fake MCP server's `echo` tool ran. The first Windows run found 21 core and
3 CLI failures (POSIX command strings and file-mode assumptions); all were
fixed, and `resolveInRoot` now returns forward slashes on Windows. The branch was
`windows/m0` (`246c3e7`); it is merged into `main` and deleted.

Deliverables:

- `shellPlatform.ts`, process-tree kill, MCP `.cmd` handling, Windows paths,
  Windows CI job, tests.

Done when:

- The exit criteria above pass.
- The Windows CI job is green.

Verify:

```powershell
pnpm install
pnpm run build
pnpm test
node packages/cli/dist/cli.js -p "Run the tests and report the result" --mode auto
node packages/cli/dist/cli.js doctor
```

### M1 — Shim spike

**Estimate:** 1 week.

Goal: prove the existing IDE host can run in Node without VS Code.

Deliverables:

- `host/shim/vscode.ts` with the members listed above.
- `host/main.ts` with stdio framing.
- A fake panel that captures HTML and messages.
- A scripted provider, the same style as `scripts/field/stub-model.mjs`.
- Tests: `activate()` succeeds; `plato.openChat` creates a panel; the HTML is
  produced; a scripted run streams; an approval is answered; a question is
  answered; undo and mode request work; a panel dispose cancels the run;
  secrets and settings round-trip.

Done when:

- A scripted run completes through the shim with a transcript, no VS Code
  process, and no network.
- The render suites still pass against the same HTML.
- The shim compiles with the `vscode` path alias, so a missing member is a
  compile error.

**Go/no-go:** If the shim cannot pass these tests in one week, stop and switch
to the bridge (Option B). Do not “push through” a failing shim.

**Status: PASSED (2026-10-23).** The gate is green. Evidence:

- `node packages/vs/esbuild.mjs && node packages/vs/test/spike.mjs` — three
  scripted runs through the **existing host**: a write with an approval card,
  undo of the created file, a question card, a mode request and the picker
  update, `workspaceState` persistence, three transcripts, and a clean panel
  dispose.
- `pnpm exec tsc -p packages/vs/tsconfig.json` — the whole VS Code host
  type-checks against the shim. A missing API member is a compile error.
- `pnpm test` — core 886/886, CLI 175/175, and the spike passes.
- `pnpm run render:fast` — all 25 render suites pass. The shared chat UI is
  unchanged.

The bridge is not needed for the shim gate. It remains the fallback if a later
parity item cannot be expressed through the shim. The proof lives in
`packages/vs/host/shim/vscode.ts`, `packages/vs/host/entry.ts`,
`packages/vs/esbuild.mjs`, and `packages/vs/test/spike.mjs`.

### M2 — Visual Studio shell skeleton

**Owner:** the **Windows machine worker**. May start in parallel with M0. Use
`write_file` / `read_file` for the first run; shell parity waits for M0.

**Estimate:** 2–3 weeks.

**Status: IN PROGRESS (2026-10-23).** The Windows agent has started in
`C:\src\plato` on branch `vs/m2` from `vs/m1`. It confirmed the installed VSIX
template is an SDK-style net472 project with VSSDK BuildTools 18.9.820, and the
manifest range covers VS 18.x. No checkpoint bundle (`C:\src\vs-m2.bundle`)
exists yet.

Deliverables:

- VSIX project that builds and installs in Visual Studio 2026.
- Tool window with WebView2.
- Sidecar lifecycle: start, stop, restart, logs.
- Injected `acquireVsCodeApi` script; page loads.
- Theme mapping for the core colors.
- Native: open file, file picker, message boxes.
- Root from the solution.
- Commands and menu items.
- One scripted run: send a task, see streaming, approve a write, see the file
  change on disk.

Done when:

- A real Visual Studio 2026 window shows the chat UI.
- A scripted run completes and the approval card works.
- The transcript is written to `~/.plato`.
- A screenshot shows the tool window in light and dark themes.
- The sidecar stops when Visual Studio closes.

**Go/no-go:** If the shell cannot host the page and the sidecar in this
milestone, fix the shell before adding features. Do not build parity on a
broken foundation.

**Status: PASSED (2026-10-23).** The shell is built and witnessed in a real
Visual Studio 2026 18.11.1 window on Windows 10. Evidence:

- `packages/vs/scripts/package-vsix.ps1` builds `Plato.Vs.vsix` (33 MB,
  including Node 22.20.0 and `plato-host.cjs`); `VSIXInstaller /quiet /force`
  installs it with exit 0.
- The tool window loads the unchanged chat HTML through WebView2. A scripted
  `write_file` task draws the approval card; **Allow once** writes `probe.txt`
  to disk; the run reports `done in 11s`.
- The transcript is
  `~/.plato/runs/b45e2fdd/2026-10-23T14-47-18-725Z-mvl335x12tim.jsonl`.
- Screenshots: `C:\src\plato-vs-field\evidence\dark.png` and `light.png`.
- The sidecar exits 0 when Visual Studio closes.
- Native services are witnessed: Credential Manager (the picker reads
  "Key status for stub: ● set"), the file picker, open file
  (`~/.plato/mcp.json` in the editor), and the message box
  ("Plato needs an API key for stub.").

Two defects found by the run are fixed. A UTF-8 BOM in `settings.json` was
rejected; the sidecar now strips it. A timed-out UI request reached Node as an
unhandled rejection and **killed the sidecar**; a dialog with no answer is now a
cancel, and a last-line `unhandledRejection` guard protects the process. The
protocol test and a real-window test with a 2-second timeout pin both.

Limits recorded: Windows 10 is not supported for Visual Studio 2026, so the
final acceptance run belongs on Windows 11. A file picker held open beyond the
plan's 30-second UI timeout now returns a cancel to the extension, while the
dialog stays open and its late answer is ignored; this needs a longer,
picker-specific timeout in M3. The test machine's Visual Studio user settings
were reset to choose the light theme; the original hive is kept at
`%LOCALAPPDATA%\Microsoft\VisualStudio\18.0_535315d0.plato-original`.

### M3 — Parity, part 1: control and configuration

**Estimate:** 2 weeks.

Deliverables:

- Settings page: providers, connections, model discovery, model picker,
  reasoning, compaction, protected files, Others.
- API key storage through Credential Manager.
- Modes: plan/edit/auto; picker; live switch; mode request card.
- Approvals with session memory; queue; pause/resume/cancel.
- Solo, Duo, Academy; observer strip.
- History and session resume.
- Title generation and folding.

Done when:

- Every item has a witness in a real Visual Studio window.
- The same copy as the VS Code extension appears (cards, refusals, notices).

**Status: M3 PASSED (2026-10-23).** This milestone is split for the Windows
worker: **M3a** is the settings page and API keys; **M3b** is modes, approvals,
teams, and history. **M3b checkpoints 1, 2a and 2b all pass**, so every item in
the milestone has a witness in a real Visual Studio window. M3a evidence, in a real Visual Studio 2026
18.11.1 window:

- The shared Settings page (the unchanged `webview.ts`) renders in the tool
  window. Connections add, list, and remove; Fetch models returns `o4-mini`
  and `stub-model` from a local stub; the model picker writes `plato.model`;
  reasoning, the compaction threshold, a protected name, and the Others switch
  all persist to `%APPDATA%\Plato\settings.json`.
- Keys are in Windows Credential Manager (`plato.providers.localhost.apiKey`);
  the settings file contains no key material. The card reads **Ready** after a
  full Visual Studio restart and after a tool-window close/reopen.
- Defects fixed: the `settings` payload omitted `compaction` (the page always
  showed the 0.8 default, so a stored 0.7 displayed as 80%); and VS 2026's light
  theme returns near-white values for the Accent family, making primary buttons
  and an ON switch illegible (the system highlight pair is used now).
- Tests: `packages/vs/test/settings.test.mjs` covers the payload, discovery,
  persistence across a sidecar restart, and the no-key-in-file rule. It was
  falsified by removing the compaction field, then restored.
- The default 346px tool-window width has no horizontal overflow:
  `document.scrollWidth` is 346, `#sbody` is 331/331, and the Providers card's
  right edge is 296. The rebuild from `3f41c5b` installed with exit 0.
- Evidence: `C:\src\plato-vs-field\evidence\m3a\`, including
  `settings-narrow.png` and `settings-narrow.txt`.

**M3b** (modes, approvals with session memory, queue and run controls, Solo /
Duo / Academy, observer strip, History and session resume, title generation and
folding) is split for the Windows worker. **Checkpoint 1 — modes and approvals —
PASSED (2026-10-23).** The plan/edit/auto picker, the live switch, the
mode-request card, approvals with session memory, the queue, pause/resume/cancel,
and every parked card were clicked through the real controls in a real Visual
Studio 2026 window. The unchanged chat HTML and the existing IDE host carried
them, so no bridge method and no shared code changed. Two witnesses per item:
28 window screenshots and 16 run transcripts in
`C:\src\plato-vs-field\evidence\m3b\checkpoint1\`, and the new host test
`packages/vs/test/m3b.test.mjs`, which was falsified twice. **The correction
round (D49cg, 2026-10-23) fixed the three shared defects that pass found**, in
the host and webview, so the VS Code extension gets the same fixes: a fold
rebuilt spent approval cards as live; a queue-advanced run hid Pause and Cancel;
and a cancel left an approval card live. Each has a host regression test
(`packages/vs/test/approval-lifecycle.test.mjs`, falsified three times) and
render assertions (`scripts/render/runlifecycle.mjs`, for the lead on macOS),
and all three were re-verified in the real window in
`C:\src\plato-vs-field\evidence\m3b\checkpoint1-fix\`.
**Checkpoint 2a — Solo, Duo, Academy and the observer strip — PASSED
(2026-10-23).** The real Settings picker switched all three arrangements through
the unchanged shared host. A Duo philosopher named itself with its colour,
guided the run, paused it at a safe point until the user resumed, and cancelled
one. The five-intervention cap stopped at five even though the philosopher was
granted eight. An Academy run drew **Team Lyceum** with Aristotle and
Pythagoras, their kind, model, colour and powers, and both watching notices.
**Three defects were found and fixed (D49ch):** the council card had never
rendered because the host wrapped its payload in `text`; every pause and resume
line was drawn twice; and non-ASCII text from the page reached the host as
U+FFFD because .NET Framework's stdin writer uses the ANSI codepage. The first
two are shared fixes, so the VS Code extension gets them too.
`packages/vs/test/teams.test.mjs` pins the behaviour and was falsified twice;
`scripts/render/teams.mjs` carries the DOM assertions for the lead on macOS;
evidence is `C:\src\plato-vs-field\evidence\m3b\checkpoint2a\`.
**Checkpoint 2b — History, session resume, title generation and folding —
PASSED (2026-10-23).** In the real window the model title appeared after the
first run and was renamed through the chip; History listed the live chat first,
the saved chat second (`click to resume`), and the runs with their turns;
clicking the saved chat **Stage A teams** restored its conversation and adopted
its title; and `/compact` folded the older turns, said *"Summary added for 3
earlier messages. Nothing was removed."*, drew the *"Plato now carries a summary
of the work above"* banner, and left every message on screen while the log grew
by one row. **No defect was found in this half.**
`packages/vs/test/history.test.mjs` pins the behaviour and was falsified twice;
`scripts/render/history.mjs` carries the DOM assertions for the lead on macOS;
evidence is `C:\src\plato-vs-field\evidence\m3b\checkpoint2b\`. **M3 is
complete; M4 is next.**

### M4 — Parity, part 2: agent features and editor

**Estimate:** 2 weeks.

Deliverables:

- MCP configuration and server status.
- Images and file attachments.
- Undo card and undo behavior.
- Protected-file masking and reveal card.
- Stuck card.
- `/` commands and completion.
- Plan/todos.
- Open-file links.
- Diagnostics after a write, or a documented “not checked” gap.
- Optional: a Chats tree window. The History page is enough for v1.

Done when:

- The parity checklist below is complete, except items explicitly marked as
  deferred with a reason.
- The acceptance cases pass in a real Visual Studio window.

**M4a, the agent-features half, PASSED (2026-10-24).** MCP configuration and
server status, images and file attachments, the undo card and undo behaviour,
protected-file masking and the reveal card, and the stuck card were driven
through the real controls in a real Visual Studio 2026 window. The shared host
and the unchanged chat HTML carried all five; no bridge method and no webview
change was needed. The new host test `packages/vs/test/m4a.test.mjs` pins them
and was falsified four times; the exact-copy render assertions are in
`scripts/render/` for the lead on macOS. **One real defect was found and fixed
(D49ci): an MCP server whose command cannot spawn killed the Node sidecar.**
Its core and host regressions are falsified. Evidence:
`C:\src\plato-vs-field\evidence\m4\checkpoint-a\`. **M4b — `/` commands and
completion, plan/todos, open-file links, diagnostics after a write (or the
documented “not checked” gap), and the optional Chats tree — is next. M5 is
not started.**

### M5 — Release

**Estimate:** 1–2 weeks.

Deliverables:

- `node.exe` and `plato-host.cjs` inside the VSIX.
- `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md` with Node's notices.
- Signed VSIX and signed sidecar where possible.
- Clean-VM install test with no Node installed.
- Marketplace listing, privacy policy, screenshots, support address.
- Version 0.1.0.
- Install and update test from Marketplace.

Done when:

- The VSIX installs on a clean Windows VM from the Marketplace.
- A real run works with no Node installed.
- The listing names the Node sidecar.
- The founder approves the publish.

**Do not publish before parity.** Internal signed builds are allowed earlier.

### M6 — After release (optional)

- Visual Studio 2022 compatibility test.
- ARM64 build.
- Diagnostics if the API is available.
- Evaluate the out-of-process VisualStudio.Extensibility model for a future
  migration if it can host WebView2.

## Parity checklist

Use this as the definition of done. “Witness” means a real Visual Studio
window, a transcript, or both.

| Area | Item | Done |
|---|---|---|
| Chat | Streaming reply | |
| Chat | Markdown and code blocks | |
| Chat | Tool activity and tool words | |
| Chat | Status line, timer, context ring | |
| Chat | Plan/todos card | |
| Control | Plan/edit/auto modes | |
| Control | Mode picker and live switch | |
| Control | Mode request card | |
| Control | Approval cards and session memory | |
| Control | Question card | |
| Control | Stuck card | yes (M4a) |
| Control | Undo card and undo | yes (M4a) |
| Control | Reveal protected file card | yes (M4a) |
| Control | Pause/resume/cancel | |
| Control | Queue | |
| Teams | Solo | yes (M3b 2a) |
| Teams | Duo | yes (M3b 2a) |
| Teams | Academy | yes (M3b 2a) |
| Teams | Observer strip | yes (M3b 2a) |
| Providers | Connections and model discovery | |
| Providers | Keys in Credential Manager | |
| Providers | Model picker, reasoning, compaction | |
| Agent | MCP servers and status | yes (M4a) |
| Agent | Images | yes (M4a) |
| Agent | File attachments | yes (M4a) |
| Agent | Protected-file masking | yes (M4a) |
| State | History | yes (M3b 2b) |
| State | Session resume | yes (M3b 2b) |
| State | Transcripts in `~/.plato` | |
| State | Undo store | |
| Editor | Open file from chat | |
| Editor | Solution/folder root | |
| Editor | Diagnostics after write (or documented gap) | |
| Shell | Settings page | |
| Shell | Commands and menu | |
| Shell | Theme light/dark | |
| Shell | Install and update | |
| Shell | Licence and notices | |

## Verification

### Unit and contract tests

- Core tests stay green on macOS and Windows.
- Shim contract tests: fake transport, fake panel, scripted run, approval,
  question, undo, mode request, secrets, settings, dispose.
- Protocol tests: framing, timeouts, unknown methods, shutdown.

### Render suites

- The existing 25 suites run against the same HTML, unchanged.
- Add a Visual Studio theme suite: light and dark, core colors, no overflow at
  the tool window's widths.

### Windows CI

- `pnpm test` on `windows-latest`.
- The CLI scripted matrix.
- The shell and process-tree tests.

### Real Visual Studio

- Install the VSIX into a real Visual Studio 2026.
- Drive the shell with FlaUI or UI Automation.
- Drive the page with WebView2's DevTools protocol, not UI Automation, because
  the page content is web content.
- Take screenshots. Inspect them. A green transcript does not prove the screen.
- Use the transcript as the second witness. The existing acceptance judge
  already reads transcripts and works across hosts.

### Clean machine

- A Windows VM with no Node, no repository, and no Visual Studio extension
  installed.
- Install from the Marketplace.
- Run a task, approve a write, confirm the file on disk.
- Confirm the key is in Credential Manager and not in any file.

## Known gaps and open questions

These are recorded, not silently deferred.

1. **Diagnostics after a write.** Visual Studio has an Error List, but
   third-party access to language-server diagnostics is not clearly documented.
   Implement if the API is available. Otherwise the shim returns an empty list
   and the feature reports “not checked”, which is honest. Do not report
   “clean”.
2. **Marketplace rules for a bundled Node runtime.** The certification policy
   requires disclosure of executable code. Confirm the VSIX size limit, signing
   requirement, and review time before packaging. Technical bundling is allowed.
3. **Settings store.** v1 uses `%APPDATA%\Plato\settings.json`. Unifying it with
   the CLI's config is a later decision.
4. **Shared keys.** v1 stores VS keys in Credential Manager under Plato's own
   target names. Sharing them with the CLI keychain is a later decision.
5. **ARM64.** v1 is x64. ARM64 needs an ARM64 Node build and a WebView2 test.
6. **Tree view.** The in-panel History page is the v1 UI. A native Chats tree is
   optional.
7. **Out-of-process model.** VisualStudio.Extensibility is the future direction,
   but WebView2 hosting is not confirmed there. Stay in-process for v1.
8. **Code signing.** Choose OV certificate or Azure Trusted Signing. Confirm the
   Marketplace requirement. Sign the VSIX and the sidecar if possible.
9. **Privacy policy.** The Marketplace requires one. It must name the provider
   traffic, transcripts, and local state.
10. **Windows read-only shell policy.** v1 denies shell in `plan` on Windows
    and asks in `edit`; `auto` is unchanged. A later allowlist is a security
    project with its own decision.
11. **Visual Studio editions.** Target Community, Professional, and Enterprise
    in the VSIX manifest. All three run the same extension. Confirm the manifest
    range at packaging.
12. **Marketplace identity.** Working name: publisher `applivity`, item
    `applivity.plato-vs`, display name “Plato by Applivity for Visual Studio.”
    Confirm the item name is free before publishing.
13. **Telemetry.** v1 sends no telemetry. If that changes, the privacy policy
    and the Marketplace listing must say so before the change ships.
14. **Node runtime distribution.** The recommendation is to bundle a pinned
    Node 22 LTS `node.exe` and disclose it in the listing. The alternative is to
    require Node on the user's machine. Do not choose the alternative without a
    product decision; it makes first-run failures likely.
15. **Support and privacy URLs.** The Marketplace listing needs a support
    address and a privacy policy URL. The CLI already uses
    `plato-feedback@applivity.com`; use the same address and publish the policy
    at `plato.applivity.com/privacy`.

## What not to do

- Do not fork the engine, the permission table, the security checks, or the
  card copy.
- Do not write a second chat UI.
- Do not port the engine to C#.
- Do not put API keys in settings, logs, transcripts, screenshots, or the
  listing.
- Do not run a local HTTP server or open a port.
- Do not use Node SEA or `node-api-dotnet` in v1.
- Do not auto-approve Windows shell commands in plan/edit in v1.
- Do not build or run from the SMB share.
- Do not claim parity without a witness in a real Visual Studio window.
- Do not publish before the parity checklist is complete.

## Estimate

| Phase | Estimate |
|---|---|
| M0 — Windows foundation | 1–2 weeks |
| M1 — Shim spike | 1 week |
| M2 — VS shell skeleton | 2–3 weeks |
| M3 — Parity, part 1 | 2 weeks |
| M4 — Parity, part 2 | 2 weeks |
| M5 — Release | 1–2 weeks |
| **Total** | **9–12 weeks of focused work** |

Add 2–3 weeks if the shim fails and the bridge is needed. Add 25% contingency
for Visual Studio SDK learning and marketplace review.

The estimate assumes one developer, AI assistance, a Windows machine from day
one, and no unrelated feature work.

## Sources used for the platform facts

- Visual Studio 2026 release notes: https://learn.microsoft.com/en-us/visualstudio/releases/2026/release-notes
- Visual Studio SDK: https://learn.microsoft.com/en-us/visualstudio/extensibility/visual-studio-sdk
- VisualStudio.Extensibility (out-of-process): https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/
- Publishing walkthrough: https://learn.microsoft.com/en-us/visualstudio/extensibility/walkthrough-publishing-a-visual-studio-extension
- Marketplace certification policies: https://learn.microsoft.com/en-us/legal/marketplace/certification-policies
- Microsoft.Web.WebView2: https://www.nuget.org/packages/Microsoft.Web.WebView2
- Node single-executable applications: https://nodejs.org/api/single-executable-applications.html
