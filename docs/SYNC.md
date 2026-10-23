# Local sync — Mac and Windows workers

This is the private LAN sync for the Visual Studio work. It is **separate from
the published repository**. The original working repo's branches, remotes, and
history are not changed by this setup.

## Layout

```
/Users/ai/Desktop/plato-sync/
  README.md          short bootstrapping note (not versioned)
  plato.git/         bare Git repository (the LAN rendezvous)
```

The original repository stays at `/Users/ai/Desktop/plato`. It is not used as a
remote and gets no new branches. The checkpoint is made in a throwaway clone
under `/tmp` and pushed to the bare repository.

The Windows machine clones the bare repository to a **local** path, for example
`C:\src\plato`. Do not build from SMB.

## Branches

| Branch | Purpose | Owner |
|---|---|---|
| `main` | The stable base, at the last published commit | founder |
| `vs/m1` | M1 shim spike, the Visual Studio plan, and the Windows brief | VS lead |
| `windows/m0` | The shared-core Windows shell/process repair | Plato CLI worker |
| `plato-bugs` | M0 + the four CLI fixes + the VS Code Duo parity; the 0.1.4 release candidate | Plato CLI bugs |
| `vs/m2` | The C# VSIX shell, WebView2, sidecar, and parity | Windows worker |

The short-lived `vs/vscode-team` branch was merged into `plato-bugs` and retired.

Rules:

- Never edit `main` directly.
- The stable branches are on GitHub: `vs/m1`, `windows/m0`, and `plato-bugs`.
  WIP branches stay LAN-only until the founder reviews them.
- Each worker works on a branch. The bare repo is the LAN rendezvous.
- Merge into `main` only after the founder reviews it.
- The original repository is not a remote. It is the source of the stable
  commit and the working tree of the VS lead.

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
git checkout vs/m1
git branch -a
```

For later updates, create a new bundle on the Mac, copy it over, then:

```powershell
cd C:\src\plato
git fetch C:\src\plato-sync.bundle "refs/heads/*:refs/remotes/sync/*"
git merge --ff-only sync/vs/m1
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
- **Visual Studio 2022 Community 17.14.42** is also installed, without the
  extension workload. Use VS 2026.
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
  (`246c3e7`), included in `plato-bugs`.
- **M2:** **IN PROGRESS (2026-10-23).** The Windows agent is running in
  `C:\src\plato` on `vs/m2` from `vs/m1`. The installed template is an SDK-style
  net472 project with VSSDK BuildTools 18.9.820; the manifest covers VS 18.x.
  No `C:\src\vs-m2.bundle` checkpoint exists yet.
- **SMB:** blocked from Windows 10 to the Mac share (guest logon). Use SSH
  bundles.

### Returning M2 code

The Windows agent creates a Git bundle at `C:\src\vs-m2.bundle` when it reaches
a checkpoint. The Mac pulls it:

```sh
scp omega@192.168.4.62:C:/src/vs-m2.bundle /tmp/vs-m2.bundle
git -C /Users/ai/Desktop/plato-bugs fetch /tmp/vs-m2.bundle 'refs/heads/*:refs/remotes/win/*'
git -C /Users/ai/Desktop/plato-bugs push origin refs/remotes/win/vs/m2:refs/heads/vs/m2
```

Then review and merge. The Windows agent does not push to GitHub.

Then, for M2:

```powershell
cd C:\src\plato
git checkout vs/m1
pnpm install
pnpm exec tsc -b
node packages/vs/esbuild.mjs
node packages/vs/test/spike.mjs
```

The Mac host name is `AIs-Mac-mini`; the IP is `10.0.10.119`. The Windows host
is on `192.168.4.62`. SSH routes between them. SMB does not.

For the M0 Windows verification, use a separate clone so `vs/m1` stays intact:

```powershell
cd C:\src
git clone plato-sync.bundle plato-m0
cd plato-m0
git checkout windows/m0
pnpm install
pnpm test
```


## Mac checkpoint procedure

This is how `vs/m1` was made without touching the original repo:

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

- **Plato CLI worker** (Mac): `windows/m0` only. It does not edit `packages/vs`
  or the docs.
- **Windows worker** (Windows machine): `vs/m2` onward, and the Windows
  verification of `windows/m0`. It does not edit `windows/m0` code.
- **VS lead** (this session): `vs/m1`, the plan, the briefs, the integration,
  and the gates.
- **Founder**: `main`, GitHub pushes, and every public release.
