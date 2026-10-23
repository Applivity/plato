# Licensing — extension, website, and the CLI

Status: **live 2026-10-20.** Plato is licensed under **Apache-2.0**; the
extension is published as **`applivity.plato`** under the display name
**Plato by Applivity**. The repository remains private. The website says
"licensed under the Apache License 2.0," not "open source."

This file records what is true, why the private-repository path is allowed, and
the remaining publish work. **The CLI is phase 2, opened 2026-10-21 (D49bw).**
Its npm plan and checklist are in section 8. **`@applivity/plato` `0.1.0` is
published (2026-10-22)**; the registry, a clean install, and `npx` verify it.

## 1. What is true today

| Item | Finding |
|---|---|
| Project license | `LICENSE` at the repository root and in `packages/vscode`. Both copies are the Apache License, Version 2.0, and are identical. |
| Notices | `NOTICE` and `THIRD-PARTY-NOTICES.md` at the root and in `packages/vscode`. |
| Root `package.json` | `"private": true`, `"license": "Apache-2.0"`. |
| `packages/core/package.json` | `"private": true`, `"license": "Apache-2.0"`. |
| `packages/vscode/package.json` | `"private": true`, `"license": "Apache-2.0"`, `"name": "plato"`, `"publisher": "applivity"`. |
| Stale manifest | `packages/vscode/package.vsix.json` is **deleted**. It claimed `SEE LICENSE IN docs/DECISIONS.md`, which contains no license text. |
| Runtime dependencies | Four packages, all MIT: `@anthropic-ai/sdk` 0.65.0, `json-schema-to-ts` 3.1.1, `@babel/runtime` 7.29.7, `ts-algebra` 2.0.0. No copyleft and no source-available dependency. |
| Current VSIX (`plato-0.26.6.vsix`) | **Prepared 2026-10-21; not yet uploaded.** 15 files, 141.38 KB. The manifest Identity is `Id="plato" Publisher="applivity" Version="0.26.6"`, the display name is `Plato by Applivity`, and the description is the public-facing sentence. `0.26.4` is the live version. It contains the `.gitignore` search switch and its panel section, the real `request_mode` request and its card, and the readme line that says Plato can ask for a mode. It carries `LICENSE.txt`, `NOTICE`, `THIRD-PARTY-NOTICES.md`, `readme.md`, and `media/icon.png` (128x128 PNG; dark tile, cyan rim, natural-proportion owl with no horizontal stretch). Categories: `Machine Learning`, `Other`. The packaged manifest says `"license": "Apache-2.0"`. No `src/`, `test/`, `out/`, `scripts/`, or `**/*.map`. |
| Installed locally | `applivity.plato@0.26.6`. The old `applivity.plato-vscode` was uninstalled on 2026-10-20. |
| Local VSIX history | 23 files, from 0.1.0 to 0.26.0, plus 0.26.1, 0.26.2, 0.26.3 (superseded before upload), 0.26.4 (live), 0.26.5 (superseded before upload), and 0.26.6 (prepared). The historical files carry no licence. |
| Marketplace | **Live** at `https://marketplace.visualstudio.com/items?itemName=applivity.plato`. Display name `Plato by Applivity`; publisher `applivity` (verified); **version 0.26.4 is live**; category `Machine Learning`; public and validated. **0.26.6 is prepared, pending upload; 0.26.3 and 0.26.5 were superseded before upload.** |
| Publication | VS Code Marketplace: live (see above). No npm or Open VSX listing. |
| Website | A static `index.html` and `styles.css` in `../plato-website`. The stale "no licence" copy was replaced with the Apache-2.0 line on 2026-10-20. |

The repository is private. The license does not change that.

## 2. Apache-2.0 with a private repository

**This is allowed.** Apache-2.0 does not require a public repository. It does not
require source distribution with a binary. It requires that each distribution
carry:

- a copy of the license text;
- the copyright and attribution notices;
- the `NOTICE` file, if the work includes one;
- a statement of changes, if you modify the work.

The VSIX is the distribution. Include `LICENSE`, `NOTICE`, and
`THIRD-PARTY-NOTICES.md` in it. The repository can stay private.

**What users get.** The license grants the right to use, copy, modify, merge,
publish, distribute, sublicense, and sell the software. It also grants a patent
license. Users do not get the source repository.

**What users can still do.** The VSIX contains compiled JavaScript. It is
readable, and minification only raises the effort. A user may inspect, modify,
and redistribute the code under Apache-2.0. The license does not prevent that.

**What it does not do.** It does not prevent reverse engineering, modification,
or redistribution. If the founder later needs to restrict those, future versions
must use a proprietary EULA. Versions already published under Apache-2.0 stay
under Apache-2.0.

**Wording.** "Licensed under the Apache License 2.0" is accurate. "Open source"
usually implies that the source is available. Do not use "open source" while the
repository is private. If the repository opens later, the same license applies
and the term becomes accurate without a license change.

## 3. Why this path

- Apache-2.0 is recognized and accepted by enterprises and contributors.
- It has an express patent grant and a patent-retaliation clause. MIT has
  neither.
- It has a trademark clause. It does not grant the "Plato" name.
- It has clear warranty and liability language. A tool that runs shell commands
  needs that.
- It lets the repository open later without a license change.
- It keeps the option of a paid hosted service or separate premium features.

The tradeoff is that the source is not public. The project does not get the
source-availability trust signal that Cline, Roo Code, Kilo Code, Continue, and
Aider get from their public repositories. The website and README must describe
the license accurately and must not imply a public repository.

## 4. Extension publish checklist

Done:

- [x] `LICENSE` at the root and in `packages/vscode`.
- [x] `NOTICE` at the root and in `packages/vscode`.
- [x] `THIRD-PARTY-NOTICES.md` at the root and in `packages/vscode`, with the
      four MIT notices.
- [x] `"license": "Apache-2.0"` in the root, core, and extension manifests.
- [x] `packages/vscode/README.md` for the Marketplace listing.
- [x] Delete `packages/vscode/package.vsix.json`.

Remaining:

- [x] Run `vsce package` and confirm that `LICENSE`, `NOTICE`,
      `THIRD-PARTY-NOTICES.md`, and `README.md` are inside the VSIX. The package
      step renames `LICENSE` to `LICENSE.txt` and `README.md` to `readme.md`.
- [x] Confirm that `src/`, `test/`, `out/`, `scripts/`, and `**/*.map` are
      absent from the VSIX.
- [x] Install the VSIX. `applivity.plato@0.26.4` is installed locally; the old
      `applivity.plato-vscode` was uninstalled.
- [x] Publish `0.26.1` with the first owl icon and the Marketplace install text
      in the README. It is live.
- [x] Publish `0.26.2` with the full-bleed owl and the `Machine Learning`
      category. It is live.
- [x] Prepare `0.26.3` with the dark tile + cyan rim icon and the canonical owl
      asset pack in `../plato-website/assets/`.
- [x] Upload `0.26.4` to the Marketplace. It is live.
- [ ] Upload `0.26.6` to the Marketplace (the `.gitignore` search switch in
      Plato's Settings → Others and in VS Code Settings, and the real
      `request_mode` card the model asks through).
- [x] Run the secret audit on the VSIX. No secrets, no forbidden files, and no
      local paths were found.
- [ ] Run the acceptance test.
- [x] Extension ID: `applivity.plato` (chosen 2026-10-20; see section 6).
- [x] Publish. The extension was uploaded through the Marketplace management
      page on 2026-10-20. Version 0.26.4 is live; 0.26.6 is ready to upload.

The extension manifest has no `repository` field while the repository is
private. `vsce` warns about this but packages the VSIX. Adding the private URL
would create links that users cannot open. Add the field only if the repository
becomes public.

Keep the root and package copies of `LICENSE`, `NOTICE`, and
`THIRD-PARTY-NOTICES.md` identical. The package copies are what ship in the
VSIX. The root copies are what the repository and the website link to.

### Marketplace listing fields

- `displayName`: **Plato by Applivity**. The Marketplace rejected "Plato"
  because `iabacus-publisher.plato-code` already uses it. Display names are
  global; the extension ID is publisher-scoped.
- `description`: "An AI coding agent for VS Code that shows its work, lets you
  steer mid-run, and stops at a safe point."
- `license`: Apache-2.0.
- `README`: `packages/vscode/README.md`, included in the VSIX.
- `icon`: **present in 0.26.3 and 0.26.4** at `media/icon.png` (128x128 PNG; dark tile,
  cyan rim, full-bleed owl). The source is `media/icon.svg`. The live 0.26.2
  listing uses the transparent full-bleed owl until 0.26.4 is uploaded.
- `categories`: `Machine Learning` and `Other` in 0.26.2, 0.26.3, and 0.26.4. The live
  0.26.2 listing shows `Machine Learning`. The category comes from the VSIX
  manifest, not a management-page editor.
- `keywords`: none. Optional.
- `repository`, `homepage`, `bugs`: absent. The repository is private. `vsce`
  warns; this is not a blocker. Add a public support page only if one exists.
- `privacy policy`: the Marketplace may ask for a URL. Plato sends prompts to the
  configured model provider. Prepare a public privacy page if the upload form
  requires one.
- `preview`: not set. Add `"preview": true` if the listing should carry the
  Preview badge, or publish as a pre-release version.
- `pricing`: Free (from the manifest).

### Live listing verification (2026-10-20)

Verified through the public Marketplace API and the public page:

- URL: `https://marketplace.visualstudio.com/items?itemName=applivity.plato`
- Display name: **Plato by Applivity**.
- Publisher: `applivity` (verified).
- Version: `0.26.2`.
- Category: `Machine Learning`.
- License: Apache-2.0. The license asset is present.
- README: present and rendered.
- Flags: `validated, public`.
- Pricing: Free.

Gaps to fix in a later version or in the management page:

- **Icon:** the live 0.26.2 listing uses the full-bleed owl. **0.26.4** replaces
  it with the dark tile + cyan rim treatment, keeping the same owl shape and
  colours. It is prepared and pending upload.
- **Category:** fixed in 0.26.2. The live listing shows `Machine Learning`; no
  tags.
- **Preview badge:** absent. The README says pre-release.
- **README install text:** fixed in 0.26.1. It describes the Marketplace install
  (`code --install-extension applivity.plato`).
- **Links:** no repository, homepage, or support link. The repository is private;
  a support page is optional.
- **Privacy policy:** none. The extension sends prompts to the model provider.

## 5. Proprietary fallback, not chosen

If the founder later needs to prevent modification or redistribution, use a
proprietary EULA for **future versions**. Do not try to apply it to versions
already published under Apache-2.0. A lawyer must draft the EULA. The website
must then say "proprietary" and link to the EULA, and it must not say "open
source" or "free" unless the EULA grants that.

## 6. Extension ID — decided: `applivity.plato`

The Marketplace ID is `publisher.name` from the extension `package.json`:

- Publisher: `applivity`.
- Package name: `plato`.
- Marketplace ID: **`applivity.plato`**.
- The root workspace package is named `plato-workspace` so the pnpm filters stay
  unambiguous. The extension package is `plato`.
- The schema paths in `configurationDefaults` use `%applivity.plato/...`.
- The VSIX file is `plato-<version>.vsix`.

The ID is derived from the package name and cannot be renamed in place after the
first publication. It was chosen before the first publish.

## 7. Website readiness

The website is a static site in `../plato-website`. The chosen line is:

> Pre-release. Plato is licensed under the Apache License 2.0.

The footer links to the license text. While the repository is private, the page
must not say "open source." It may say "licensed under Apache-2.0."

The stale copy was updated on 2026-10-20:

- `index.html:23` — the comment now states the Apache-2.0 licence.
- `index.html:420` — the install note now states the licence and links to it.
- `index.html:456` — the footer now states the licence and links to it.
- `../plato-website/HANDOFF.md:155` — the phrase table now records the
  Apache-2.0 line.
- `../plato-website/HANDOFF.md:166` — the claims list now records the licence
  footer.
- `../plato-website/HANDOFF.md:253` — the licence is now under "Closed since the
  first pass."
- `../plato-website/WEBSITE.md` lines 17, 25, 364, and 491 — the brief now requires the
  licence footer and forbids the "open source" claim while the repository is
  private.

Keep these rules:

- Do not add a marketplace badge or download link until the listing is live and
  the URL is verified.
- Do not call Plato "open source" while the repository is private.
- Do not say "free." The user pays their model provider.
- Keep the "do not deploy" rule until the founder decides to publish the site.
  "Ready" is not "deployed."
- The website's own source and copy are a separate licensing question. The
  footer statement is about the product.

## 8. CLI — phase 2, opened 2026-10-21

**Status.** The founder opened phase 2 on 2026-10-21. The CLI is a first-class
host over the same core. It ships Solo, Duo, and Academy in v1 (D49bw).
`packages/cli` is complete through M6. **`0.1.0` through `0.1.3` are published**
and passed the post-publish checks (registry metadata, a clean install, every
documented command, the TUI, and `npx`). **`0.1.4` is the release candidate on
branch `plato-bugs`**: it adds Windows support for commands, background shells,
and MCP, and fixes four terminal defects. The publish remains the founder's.
The CLI keeps its own version line. npm's staged-publishing gate applies to
this account: the first `npm publish` created a `0.0.0-stage` placeholder and
the release went live when the founder approved it.

**Package identity.**

- `plato` is taken on npm (1.7.0, MIT). `plato-cli` is taken (0.0.32, MIT).
  `@applivity/plato` was available on 2026-10-20. Check it again before the
  first publish.
- The package is `@applivity/plato`. The command is `plato`. A scoped package
  can provide an unscoped `bin` name.
- Remove `"private": true` from the CLI package.
- Add `"publishConfig": { "access": "public" }`. A scoped package needs
  `--access public` on the first publish.
- Set `"engines": { "node": ">=22" }`. The terminal stack (Ink 8) needs it.

**What the tarball must carry.** The npm tarball is a distribution under
Apache-2.0. It must include:

- `LICENSE`
- `NOTICE`
- `THIRD-PARTY-NOTICES.md`
- `README.md`
- the built CLI file and only the files it needs

Use a `files` allowlist. Do not repeat the core package's mistake:
`packages/core` packs 412 files because it has no `files` field. The extension's
VSIX lesson applies here too: ship only what runs, keep source and maps out, and
inspect the tarball before publish.

**Dependency choice.** `@applivity/plato-core` is private. Bundle core into the
CLI, or publish core first. The plan is to bundle core into the CLI, as the
extension bundles it into the VSIX. Do not publish a CLI that depends on an
unpublished package.

**Repository.** The repository stays private. Apache-2.0 with a private
repository is allowed, under the same conditions as section 2. A public
repository is not required for npm. Provenance is not available while the
repository is private. Do not add a `repository` field that points to a private
URL that users cannot open.

**Publish checklist (in progress).**

- [x] Create `packages/cli` and build it (M0, 2026-10-21).
- [x] Add `LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md` to the package.
- [x] Add the `files` allowlist.
- [x] Remove `"private": true` and add `"publishConfig": { "access": "public" }`.
      `npm publish --dry-run` accepts the manifest (2026-10-21).
- [x] Run `npm pack` and confirm the file list. The tarball has 6 files — the
      bundle, `package.json`, `README.md`, and the three licence files. It has
      no `src/`, `test/`, maps, keys, or local paths (2026-10-21).
- [x] Install the tarball into a temporary prefix and run `plato --version` from
      a clean directory. `plato doctor` also ran from a scratch directory with
      all three homes redirected.
- [x] Run the secret audit on the tarball. No key pattern and no local path is
      present in the bundle (2026-10-21).
- [x] `npm whoami` succeeds as `applivity`, the scope's owner (2026-10-22).
- [x] Publish `0.1.0` with public access. The account requires 2FA for writes,
      and staged publishing placed the release in an approval queue; it went
      live at 14:13:40Z when the founder approved it (2026-10-22).
- [x] Verify the public listing, the install, and
      `npx @applivity/plato --version`. `latest` is `0.1.0`; the tarball's
      shasum matches the audited build (`75beb7d1…`), it has 6 files, and the
      README served by the registry is byte-identical to the package's.

**Permanence.** The first npm publish is public and effectively permanent. A
public package cannot be made private again. Unpublish is limited to 72 hours.
Do not publish until the local package works and the tarball is inspected.

**Keys.** The CLI does not use VS Code SecretStorage. Key storage follows the
industry chain in D49bx: environment variables, then the OS keychain, then a
0600 credential file. Keys never enter the config, logs, transcripts, or the
tarball.

## 9. Open decisions and owner actions

| Item | Owner decision |
|---|---|
| Copyright holder name in `NOTICE` | Founder. The current notice says Applivity. Change it if the legal entity differs. |
| Trademark sweep (D16) | Founder. Separate from the license. |
| Website deployment | Founder. "Ready" does not mean "deployed." |
| Website source licence | Founder. Separate from the product licence. |
| Open the repository later | Optional. The license does not require it. |
| CLI package publication (npm) | Founder. Log in, confirm the `applivity` organisation, and approve the first publish. |
| CLI key storage | Decided (D49bx, approved 2026-10-21): environment, then the OS keychain, then a 0600 file. Setup is one command, and the fallback is automatic. |
| CLI terminal stack | Decided (D49by, approved 2026-10-21): Ink 8.0.0, with a plain renderer over the same view model. |

## 10. References

- `docs/DECISIONS.md` — D18 (repository intent), D19 (distribution reality),
  D49ar (the publish gate), D49bv (this decision), and D49bw–D49by (the CLI
  scope, key storage, and terminal conventions).
- `docs/HANDOFF.md` — "The publish gate" and "Non-negotiable safety rules."
- `../plato-website/WEBSITE.md` — the website brief.
- `../plato-website/index.html` — the install section and the footer.
- `../plato-website/HANDOFF.md` — the website handoff.
