# Local sync — Mac and Windows workers

This is the private LAN sync for the Visual Studio work. `main` is the published
truth on GitHub at `https://github.com/Applivity/plato` (public since
2026-11-02, D49cp); the LAN repository mirrors it and is the rendezvous for the
Windows machine. Every clone uses the `Applivity` URL — the old `applivity-com`
one cannot authenticate and returns 404.

## Layout

```
/Users/ai/Desktop/plato-sync/
  README.md          short bootstrapping note (not versioned)
  plato.git/         bare Git repository (the LAN rendezvous)
```

The main working tree is `/Users/ai/Desktop/plato`. Its `main` is the release
source and matches GitHub. The LAN bare repository is the rendezvous for the
Windows machine.

The Windows machine clones the bare repository to a **local** path, for example
`C:\src\plato`. Do not build from SMB.

## Branches

| Branch | Purpose | Owner |
|---|---|---|
| `main` | The published truth: CLI 0.1.4 and VS Code extension 0.26.7 at `1696dd2` | founder |
| `vs/m2` | The active Visual Studio work: C# VSIX shell, WebView2, sidecar, and parity | Windows worker |

`windows/m0` and `plato-bugs` are merged and deleted. `vs/m1` is merged into
`vs/m2`; its remote copy is retired when `vs/m2` is pushed. `vs/m2` is the only
active work branch.

Rules:

- `main` is the only published truth. Both GitHub and the LAN repository point
  at it.
- A work branch is temporary. `vs/m2` is the one active exception. It is pushed
  to both remotes after review and deleted when it reaches `main`.
- Never edit `main` directly.
- Each worker works on a branch. The bare repository is the LAN rendezvous.
- Merge into `main` only after the founder reviews it.
- The original repository is not a remote. It is the source of the stable
  commit and the working tree of the VS lead.

## Current checkpoint (2026-10-28)

- `main` is `1696dd2` (CLI 0.1.4 / VS Code 0.26.7, both published). `vs/m2` is the Visual Studio work on GitHub and the LAN repo; the Windows 10 and Windows 11 clones follow it.
- **The Visual Studio extension is published:** 0.1.0 at `https://marketplace.visualstudio.com/items?itemName=applivity.plato-vs` — publisher `applivity`, internal name `plato-vs`, identity `applivity.plato-vs` (D49cm), unsigned (D49ck), install target `[17.14,)` (D49cl). The package is 33,293,332 bytes, SHA-256 `ebc5b2e6…08ce`; copies on the Mac at `/Users/ai/Desktop/plato-artifacts/superseded/Plato.Vs.0.1.0.vsix`, on Windows 11 at `C:\src\Plato.Vs.vsix`, and the build output on Windows 10.
- **Windows 11 acceptance passed (2026-10-28).** Three real DeepSeek (`deepseek-flash`) runs in `auto` on copies of the founder's two projects: a DatingApp analysis (36 tool calls, 254.8k tokens, 38 s), a DatingApp write that created `ARCHITECTURE.md`, and a CviConnector analysis (9 tool calls, 92.6k tokens, 20 s). Suites there: Visual Studio host 10/10, CLI 213 pass / 3 skipped, core 914 pass / 2 skipped with one shell flake that passed 3/3 reruns. Evidence: `C:\src\plato-vs-field\evidence\m5\real\` (its `REPORT.md`), and `...\m5\package\` for the packaging audit. Do not delete either folder.
- **VS Code 0.26.9 is live (founder, 2026-10-28):** `/Users/ai/Desktop/plato-artifacts/plato-0.26.9.vsix`, 146,495 bytes, SHA-256 `bdac17dc…730f`. It changes only the listing text (the license paragraph now names `LICENSE.txt` and `THIRD-PARTY-NOTICES.md` and says both ship; the README adds support and privacy). Built from the local branch `release/0.26.8` at `9a5a4c9b`, which is **not pushed**; `main` is untouched.
- **Visual Studio 2022 is supported as of 0.1.1 (D49cn, 2026-10-28).** On Community 17.14.37806.7 the 0.1.0 package installed, drew the tool window and started the bundled sidecar, but the page never left "loading…": 2022 loads Newtonsoft.Json 13.0.3 and the package was compiled against 13.0.4, so the stdout reader stopped on the first message. The project now references 13.0.3 (the compiler binds the call both versions have) and the version is 0.1.1. `package-vsix.ps1` now runs MSBuild with `/restore`, because an incremental tree otherwise keeps the old resolution and rebuilds the same failure. Witnessed: a scripted round trip in 2022 17.14 and again in 2026 18.11 from one package. Evidence: `C:\src\plato-vs-field\evidence\m6-2022\`.
- **0.1.2 is published and verified from the public endpoint (2026-10-28):** the anonymous Marketplace download is 33,293,629 bytes, manifest `0.1.2`, `Plato.Vs.dll` `14b577ae…f2c6` — the tested binary. 0.1.1 was superseded before publication.
- **0.1.3 is live (founder, 2026-10-29) and verified from the public endpoint:** the gallery returns version `0.1.3` with `lastUpdated` `2026-10-29T13:46:20Z`, and the anonymous download is 33,293,606 bytes with SHA-256 `dc7d9461…1b14` — the same bytes that were built and inspected locally. It changes four user-visible strings named `SecretStorage` (a VS Code term) on the Settings page, including on Visual Studio, where keys go to Windows Credential Manager; they now say "the system credential store", which is true of both hosts. The same strings reach the VS Code extension at its next release. `package-vsix.ps1` now compiles the shared shell first, because a stale `packages/vscode/out/extension.js` had shipped the old sentence silently.
- **0.1.4 is live (founder, 2026-11-02) and verified from the public endpoint:** the gallery returns `0.1.4` with `lastUpdated` `2026-11-02T12:55:05Z`, and the anonymous download is 33,293,656 bytes with SHA-256 `ea9e5ef4…7136` — byte-identical to the package built on Windows 10 from `vs/m2` `18bb5b70`. It adds `<MoreInfo>https://github.com/Applivity/plato</MoreInfo>`, the only link the Visual Studio Marketplace renders. It was installed and run in Visual Studio 2022 17.14.37806.7 and 2026 18.11.12315.225 before upload; evidence is in `C:\src\plato-vs-field\evidence\m7-0.1.4\`.
- **The 1000-pixel website screenshots are final** (2026-10-29): six files in `/Users/ai/Desktop/plato-website/vs-shots/`, all 1000×500, with `VS-SHOTS-REPLY.md` recording each frame's contents and honest limits.
- **Still open:** installing through Visual Studio's own Manage Extensions (the download path is proven; the in-IDE flow is not), the website's version and privacy lines (brief parked at `../plato-website/VS-RELEASE-UPDATE.md`), and code signing (D49ck).
- The Windows agent must use `--model claude-sonnet-5-5`; the gateway does not route `claude-haiku-5-5`. The gateway budget is separate from the model-provider key.
- Preserve the Mac copy of the M4a evidence text at `/Users/ai/Desktop/plato-sync/incoming-vs-m4a-52d933fe/evidence/evidence.txt`; the Windows M4a screenshots were lost.

## Windows clone (actual, 2026-10-23)

**SMB does not work from this Windows machine.** It is Windows 10, which refuses
guest SMB logons; `dir \\10.0.10.119\Desktop\...` returns “The user name or
password is incorrect.” SSH works, so the code travels as a Git bundle.

From the Mac:

```sh
git --git-dir=/Users/ai/Desktop/plato-sync/plato.git \
  bundle create /tmp/plato-sync.bundle --all
scp /tmp/plato-sync.bundle omega@192.168.4.62:C:/src/plato-sync.bundle
```

From the Windows machine:

```powershell
cd C:\src
git clone plato-sync.bundle plato
cd plato
git checkout vs/m2
git branch -a
```

For later updates, create a new bundle on the Mac, copy it over, then:

```powershell
cd C:\src\plato
git fetch C:\src\plato-sync.bundle "refs/heads/*:refs/remotes/sync/*"
git merge --ff-only sync/vs/m2
```

The Mac host name is `AIs-Mac-mini`; the IP is `10.0.10.119`. The Windows host
is `192.168.4.62`. SSH routes between them. If SMB is wanted, a macOS sharing
user and a credentialed `net use` are required; guest access is blocked by
Windows 10.

## Windows machine facts (2026-10-23)

- **OS:** Windows 10 22H2 (19045). Microsoft supports Visual Studio 2026 on
  Windows 11 only. **VS 2026 18.11.1 is installed and runs here anyway.** Treat
  Windows 10 as an unsupported development environment; the final acceptance
  run belongs on Windows 11.
- **Visual Studio 2026 Community 18.11.1** is installed at
  `C:\Program Files\Microsoft Visual Studio\18\Community`. `devenv.exe` and
  MSBuild 18.11.1 are present. The **extension development workload is
  installed.** WebView2 runtime 155.0.4283.62. .NET Framework 4.8 targeting
  pack present.
- **Visual Studio 2022 Community 17.14.37806.7** is also installed, without the
  extension development workload. The workload is only needed to build; a
  published VSIX installs with 2022's own `VSIXInstaller.exe`. Since 0.1.1 this
  host is a **supported test target** (D49cn), not just a bystander.
- **Node 22.20.0** is under
  `C:\Users\DummyUser\AppData\Local\nvm\v22.20.0`. The default `node` is still
  21.7.3. Put the Node 22 directory first on `PATH`:
  `set "PATH=C:\Users\DummyUser\AppData\Local\nvm\v22.20.0;%PATH%"`.
- **pnpm 11.23.0** is installed in that Node 22 directory.
- **Claude Code 2.1.226** is installed.
- **M1 spike:** passes on both macOS and Windows.
- **M0:** **DONE and verified on Windows.** The Mac suite is core 908/1 skipped
  and CLI 180; the Windows suite is core 907/2 skipped and CLI 177/3 skipped;
  the real Windows command/background/MCP run passed. Branch `windows/m0`
  (`246c3e7`) is merged into `main` and deleted.
- **M2:** **PASSED (2026-10-23), commit `5d4cdcc` on `vs/m2`.** The Windows
  agent built and installed the VSIX in a real Visual Studio 2026 18.11.1
  window; the chat loaded, a scripted `write_file` drew the approval card and
  wrote the file, the transcript landed in `~/.plato`, and the shell was
  captured in light and dark. The bundle is `C:\src\vs-m2.bundle`. Evidence is
  `C:\src\plato-vs-field\evidence`. M3 parity is next.
- **SMB:** blocked from Windows 10 to the Mac share (guest logon). Use SSH
  bundles.

### Returning M2 code

The Windows agent creates a Git bundle at `C:\src\vs-m2.bundle` at each
checkpoint. The Mac pulls it into the main working tree:

```sh
scp omega@192.168.4.62:C:/src/vs-m2.bundle /tmp/vs-m2.bundle
git -C /Users/ai/Desktop/plato fetch /tmp/vs-m2.bundle 'refs/heads/*:refs/remotes/win/*'
git -C /Users/ai/Desktop/plato log --oneline win/vs/m2
```

Review the commit and run the tests before pushing. After review:

```sh
git -C /Users/ai/Desktop/plato push origin vs/m2
git -C /Users/ai/Desktop/plato push /Users/ai/Desktop/plato-sync/plato.git vs/m2
```

The Windows agent does not push to GitHub. Delete the bundle after the fetch.

Then verify a checkpoint on Windows:

```powershell
cd C:\src\plato
git checkout vs/m2
pnpm install
pnpm exec tsc -b
pnpm --dir packages/vs typecheck
pnpm --dir packages/vs test
```

The Mac host name is `AIs-Mac-mini`; the IP is `10.0.10.119`. The Windows host
is on `192.168.4.62`. SSH routes between them. SMB does not.

The M0 Windows verification is complete; its evidence is in PROGRESS. The
`windows/m0` branch is merged and deleted, so a fresh clone uses `main`.


## Mac checkpoint procedure

Historical record: this is how `vs/m1` was made. It is now merged into `vs/m2`
and is retired.

```sh
git init --bare --initial-branch=main /Users/ai/Desktop/plato-sync/plato.git
git clone --no-hardlinks /Users/ai/Desktop/plato /tmp/plato-vs-m1
cd /tmp/plato-vs-m1
git remote remove origin
git remote add sync /Users/ai/Desktop/plato-sync/plato.git
rsync -a --exclude node_modules --exclude dist \
  /Users/ai/Desktop/plato/packages/vs/ packages/vs/
cp /Users/ai/Desktop/plato/docs/{DECISIONS.md,HANDOFF.md,PROGRESS.md,SYNC.md} docs/
cp /Users/ai/Desktop/plato/pnpm-lock.yaml .
git checkout -b vs/m1
git add packages/vs docs pnpm-lock.yaml
git commit -m "vs/m1: the Visual Studio shim spike passes, and the plan is recorded"
git push sync main
git push sync vs/m1
```

The original repo's `.git` is only read by the clone. Its branch, index, and
remotes are unchanged.

## Security

The Desktop is shared over SMB with **guest access enabled**. The bare repo
inherits that share, so anyone on the LAN can read it. The source is already on
that share, so this adds no new folder exposure, but a Git repo carries the
full history. This is acceptable only on a trusted local network. If that is
not acceptable, use SSH or a password-protected share instead.

The SSH key for the Windows machine is `~/.ssh/plato_windows` on the Mac. The
public key is added to `omega@192.168.4.62`. The private key has no passphrase
so non-interactive commands can run; it is readable only by the Mac user.

## Ownership

- **Plato CLI worker** (Mac): `main` and the CLI release. It does not edit
  `packages/vs` or the Visual Studio docs.
- **Windows worker** (Windows machine): `vs/m2` onward, and the Windows
  verification of each checkpoint.
- **VS lead** (this session): the plan, the briefs, the integration, and the
  gates.
- **Founder**: `main`, GitHub pushes, and every public release.
