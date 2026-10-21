# Licensing — extension, website, and the deferred CLI

Status: **live 2026-10-20.** Plato is licensed under **Apache-2.0**; the
extension is published as **`applivity.plato`** under the display name
**Plato by Applivity**. The repository remains private. The website says
"licensed under the Apache License 2.0," not "open source."

This file records what is true, why the private-repository path is allowed, and
the remaining publish work. The CLI is phase 2. Its npm notes are at the end and
are not work for now.

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
| Current VSIX (`plato-0.26.4.vsix`) | **Prepared 2026-10-21; not yet uploaded.** 15 files, 432,373 bytes uncompressed. The manifest Identity is `Id="plato" Publisher="applivity" Version="0.26.4"`, the display name is `Plato by Applivity`, and the description is the public-facing sentence. It contains `LICENSE.txt`, `NOTICE`, `THIRD-PARTY-NOTICES.md`, `readme.md`, and `media/icon.png` (128x128 PNG; dark tile, cyan rim, natural-proportion owl with no horizontal stretch). Categories: `Machine Learning`, `Other`. The packaged manifest says `"license": "Apache-2.0"`. No `src/`, `test/`, `out/`, `scripts/`, or `**/*.map`. |
| Installed locally | `applivity.plato@0.26.4`. The old `applivity.plato-vscode` was uninstalled on 2026-10-20. |
| Local VSIX history | 21 files, from 0.1.0 to 0.26.0, plus 0.26.1, 0.26.2 (live), 0.26.3 (superseded before upload), and 0.26.4 (prepared). The historical files carry no licence. The 0.26.2 file is the live version. The 0.26.3 file was superseded before upload. The 0.26.4 file is prepared but not uploaded. |
| Marketplace | **Live** at `https://marketplace.visualstudio.com/items?itemName=applivity.plato`. Display name `Plato by Applivity`; publisher `applivity` (verified); version 0.26.2; category `Machine Learning`; public and validated. **0.26.4 is prepared, pending upload; 0.26.3 was superseded before upload.** |
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
- [ ] Upload `0.26.4` to the Marketplace.
- [x] Run the secret audit on the VSIX. No secrets, no forbidden files, and no
      local paths were found.
- [ ] Run the acceptance test.
- [x] Extension ID: `applivity.plato` (chosen 2026-10-20; see section 6).
- [x] Publish. The extension was uploaded through the Marketplace management
      page on 2026-10-20. Version 0.26.2 is live; 0.26.4 is ready to upload.

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

## 8. CLI — phase 2, recorded only

Do not start this work now.

- `plato` is taken on npm (1.7.0, MIT). `plato-cli` is taken (0.0.32, MIT).
  `@applivity/plato` is available.
- `npm whoami` returns `ENEEDAUTH` on this machine. The publisher must log in
  and confirm membership in the `applivity` npm organisation.
- The first npm publish is public and effectively permanent. A public package
  cannot be made private again. Unpublish is limited to 72 hours.
- Apache-2.0 with a private repository is allowed for the CLI too, under the
  same conditions as section 2. The npm tarball is a distribution. It must carry
  the license text and notices.
- Remove `"private": true` from the CLI package. Add
  `"publishConfig": { "access": "public" }`.
- Use a `files` allowlist. `packages/core` currently packs 412 files, including
  `src/` and `test/`, because it has no `files` field. Do not repeat that.
- A scoped package needs `--access public` on the first publish.
- `@applivity/plato-core` is private. Either bundle it into the CLI or publish
  it first. Do not publish a CLI that depends on an unpublished package.
- Provenance is not available while the repository is private.

## 9. Open decisions and owner actions

| Item | Owner decision |
|---|---|
| Copyright holder name in `NOTICE` | Founder. The current notice says Applivity. Change it if the legal entity differs. |
| Trademark sweep (D16) | Founder. Separate from the license. |
| Website deployment | Founder. "Ready" does not mean "deployed." |
| Website source licence | Founder. Separate from the product licence. |
| Open the repository later | Optional. The license does not require it. |

## 10. References

- `docs/DECISIONS.md` — D18 (repository intent), D19 (distribution reality),
  D49ar (the publish gate), D49bv (this decision).
- `docs/HANDOFF.md` — "The publish gate" and "Non-negotiable safety rules."
- `../plato-website/WEBSITE.md` — the website brief.
- `../plato-website/index.html` — the install section and the footer.
- `../plato-website/HANDOFF.md` — the website handoff.
