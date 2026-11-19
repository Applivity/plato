# Releasing Plato

Four public surfaces. Two are automated. Two are manual. This file is the operating
record: if a session has to release Plato, everything it needs is here.

## The surfaces

| Surface | How a version ships | Who does it |
|---|---|---|
| npm (`@applivity/plato`) | `scripts/release/release.mjs npm` | the assistant |
| GitHub release | `scripts/release/release.mjs github` | the assistant |
| VS Code Marketplace (`applivity.plato`) | upload at marketplace.visualstudio.com/manage | the founder |
| Visual Studio Marketplace (`applivity.plato-vs`) | upload at the same page | the founder |

## The tool

```
node scripts/release/release.mjs <verb> <version|tag> [--go] [--target <sha>]

  npm    0.5.2            the tarball in plato-artifacts/
  github cli-v0.5.1       the note in release-notes/, plus the asset
  vscode 0.32.0           blocked: needs a Marketplace token (see below)
  vs     0.6.0            blocked: same
```

**Without `--go` it publishes nothing.** It runs every check, prints the report and
stops. With `--go` it publishes, then reads the public surface back and prints the same
facts. The two reports are meant to be compared line by line.

What it checks before it can publish:

- the artifact exists, with its byte count and SHA-256 recorded;
- the version **inside** the artifact is the version asked for — a renamed VSIX is caught;
- the manifest in the repository agrees;
- the surface does not already serve that version;
- for GitHub, the target commit is an ancestor of `origin/main`.

It publishes artifacts the build lanes already made. It does not build, bump or push.

## The rule

- A version ships only when the founder names it or approves it in a chat message.
- **The assistant runs the command. The founder does not.** Handing him a command to
  paste is the manual step the tool exists to remove.
- Every publish reports the file, its size and its hash, on both sides of the publish.
- No token, password or key passes through a chat message, the repository, or an
  evidence file.

## Credentials

Nothing new was created for this. Each surface uses what was already on the machine.

- **npm** — `~/.npmrc`, mode 0600, account `applivity`, who owns the package.
- **GitHub** — the `gh` login for `0xukhan`, with push on `Applivity/plato`.
- **Marketplaces** — none. If one is ever added it goes in the keychain under
  `plato.release.marketplace` and nothing else reads it.

## Why the Marketplaces are manual

Every extension publish so far has been a browser upload, so there is no Azure DevOps
organization and no personal access token. Creating a new organization now requires an
active Azure subscription (Microsoft's *Create an organization* page, updated
2026-11-03; existing organizations are unaffected). The founder's subscription belongs
to a different account that he does not want to explain upstream. He decided on
2026-11-19 to keep both Marketplaces manual and to create no Azure identity.

**This does not reopen on its own.** Revisit it only if he raises it. The two verbs are
already written and checked; the day a token exists they work unchanged.

Microsoft's publishing pages now mark PATs "Not Recommended" and state they retire
2026-12-01. This does not affect the manual upload path.

## What is verified, and what is not

Verified:

- registry hashes for 0.5.1 match our tarball exactly;
- every duplicate and mismatch guard stops the tool;
- a VSIX renamed to a false version is rejected by its own manifest;
- the Marketplace upload route answers 401 to a bad token, so the endpoint and auth
  scheme are correct;
- a real `npm publish --dry-run` reads the tarball the same way we do;
- the first real GitHub release ran end to end.

Not verified:

- **the npm write.** The registry accepts the token; whether the token may publish is
  proven only by the next version. If it may not, the publish fails with a 403 and
  changes nothing.

## History

- **2026-11-19 — first run.** `cli-v0.5.1` created: Latest, target `7ccd7f67`, asset
  350,519 bytes downloaded back and hashed identical, `cli-v0.5.0` marked superseded
  with its original body intact.
