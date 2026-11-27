#!/usr/bin/env node
/**
 * One command for the five publish surfaces.
 *
 *   node scripts/release/release.mjs npm     0.5.2
 *   node scripts/release/release.mjs vscode  0.32.0
 *   node scripts/release/release.mjs openvsx 0.32.0
 *   node scripts/release/release.mjs vs      0.6.0
 *   node scripts/release/release.mjs github  cli-v0.5.1 [--target <sha>]
 *
 * Without --go it checks everything, prints the report and stops. With --go it
 * publishes and then reads the public surface back. The report is identical on
 * both sides, so the two can be compared line by line.
 *
 * The tool publishes artifacts the build lanes already made. It does not build.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/Users/ai/Desktop/plato';
const ART = '/Users/ai/Desktop/plato-artifacts';
const NOTES = `${ART}/release-notes`;
const NPM_NAME = '@applivity/plato';
const MARKET = 'https://marketplace.visualstudio.com';
const SERIES = {
  cli: { title: (v) => `Plato CLI ${v}`, asset: (v) => `applivity-plato-${v}.tgz` },
  vscode: { title: (v) => `Plato for VS Code ${v}`, asset: (v) => `plato-${v}.vsix` },
  vs: { title: (v) => `Plato for Visual Studio ${v}`, asset: (v) => `Plato.Vs.${v}.vsix` },
};
const KEYCHAIN_SERVICE = 'plato.release.marketplace';

const say = (label, detail) => console.log(`  ${label.padEnd(12)}  ${detail}`);
const rule = (t) => console.log(`\n${t}\n${'-'.repeat(Math.max(t.length, 40))}`);
const die = (msg) => {
  console.error(`\n  STOP  ${msg}\n`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})\n${r.stderr || r.stdout}`);
  }
  return r;
}

const hashOf = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

const bytesOf = (file) => statSync(file).size;
const withCommas = (n) => n.toLocaleString('en-US');

/** The version and identity recorded inside the artifact itself. */
function insideVsix(file) {
  const listing = run('unzip', ['-l', file]).stdout;
  if (listing.includes('extension/package.json')) {
    const pkg = JSON.parse(run('unzip', ['-p', file, 'extension/package.json']).stdout);
    return { id: `${pkg.publisher}.${pkg.name}`, version: pkg.version, kind: 'vscode' };
  }
  const xml = run('unzip', ['-p', file, 'extension.vsixmanifest']).stdout;
  const m = xml.match(/Identity\s+Id="([^"]+)"\s+Version="([^"]+)"/);
  if (!m) throw new Error(`no Identity found inside ${file}`);
  return { id: m[1], version: m[2], kind: 'vs' };
}

/** Versions the public gallery serves today, newest first. No credential needed. */
async function galleryVersions(id) {
  const res = await fetch(`${MARKET}/_apis/public/gallery/extensionquery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.2-preview.1' },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: id }], pageNumber: 1, pageSize: 1, sortBy: 0, sortOrder: 0 }],
      assetTypes: [],
      flags: 914,
    }),
  });
  const j = await res.json();
  const ext = j.results?.[0]?.extensions?.[0];
  return ext?.versions?.map((v) => v.version) ?? [];
}

function marketplacePat() {
  const r = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) {
    die(
      `no marketplace PAT in the keychain.\n\n` +
        `  Add it once, replacing <PAT> with the token:\n\n` +
        `    security add-generic-password -s ${KEYCHAIN_SERVICE} -a applivity -w '<PAT>'\n\n` +
        `  The token needs the Marketplace (Manage) scope on publisher applivity.`,
    );
  }
  return r.stdout.trim();
}

/** PUT the vsix to the gallery. This is the call vsce itself makes. */
async function uploadVsix(file, extensionName) {
  const pat = marketplacePat();
  const res = await fetch(
    `${MARKET}/_apis/gallery/publishers/applivity/extensions/${extensionName}?api-version=7.2-preview.2`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-TFS-FedAuthRedirect': 'Suppress',
        Authorization: `Basic ${Buffer.from(`OAuth:${pat}`).toString('base64')}`,
      },
      body: readFileSync(file),
      signal: AbortSignal.timeout(600_000),
    },
  );
  if (res.status === 401) die('the marketplace refused the PAT (expired, or the wrong scope).');
  if (res.status === 409) die(`the gallery already has this version.`);
  if (!res.ok) die(`the gallery answered ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

/** Poll until the public gallery serves the version. Propagation can be slow. */
async function awaitGallery(id, version) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if ((await galleryVersions(id)).includes(version)) return true;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}

// ---------------------------------------------------------------- npm

/**
 * The registry's `dist` block for a version, or null if it never becomes
 * readable. `npm view <pkg>@<version> dist --json` prints the dist object
 * itself, so the fields sit at the top level.
 */
async function npmDist(version, ms = 180_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const r = run('npm', ['view', `${NPM_NAME}@${version}`, 'dist', '--json'], { allowFail: true });
    if (r.status === 0) {
      try { return JSON.parse(r.stdout); } catch { /* not readable yet */ }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((res) => setTimeout(res, 10_000));
  }
}

async function npm(version, go) {
  rule(`npm — ${NPM_NAME} ${version}`);
  const file = `${ART}/applivity-plato-${version}.tgz`;
  try { statSync(file); } catch { die(`no artifact at ${file}`); }

  const manifest = JSON.parse(readFileSync(`${ROOT}/packages/cli/package.json`, 'utf8'));
  if (manifest.version !== version) die(`packages/cli is ${manifest.version}, not ${version}. Bump and build first.`);

  const live = run('npm', ['view', `${NPM_NAME}@${version}`, 'version'], { allowFail: true });
  if (live.status === 0) die(`the registry already serves ${version}.`);

  const size = bytesOf(file);
  say('artifact', file);
  say('bytes', withCommas(size));
  say('sha256', hashOf(file));
  say('manifest', `packages/cli/package.json ${manifest.version}  ok`);
  say('registry', `no ${version}  ok`);
  say('will do', `npm publish ${file}`);

  if (!go) return console.log('\n  NOT PUBLISHED — re-run with --go to publish.\n');

  console.log('\n  publishing...');
  run('npm', ['publish', file, '--access', 'public'], { cwd: ART, stdio: 'inherit' });

  // npm answers 202 "being processed" and the version is not readable for a
  // few minutes. Reading once made a successful publish look failed, and the
  // obvious next move — re-run with --go — is a duplicate. Wait it out, then
  // say so plainly; the publish itself already succeeded.
  const d = await npmDist(version);
  if (d === null) {
    say('published', `${version} accepted; not readable after 3 min`);
    console.log('\n  npm took the upload. Do NOT re-run — a second publish of this version is a duplicate.\n');
    return;
  }
  say('published', `${version}  ok`);
  say('shasum', d.shasum ?? d.dist?.shasum ?? '?');
  say('integrity', d.integrity ?? d.dist?.integrity ?? '?');
}

// ---------------------------------------------------------------- marketplaces

async function marketplace(kind, version, go) {
  const spec = {
    vscode: { file: `${ART}/plato-${version}.vsix`, pkg: `${ROOT}/packages/vscode/package.json`, name: 'plato' },
    vs: { file: `${ART}/Plato.Vs.${version}.vsix`, pkg: null, name: 'plato-vs' },
  }[kind];
  rule(`${kind === 'vscode' ? 'VS Code Marketplace' : 'Visual Studio Marketplace'} — ${spec.name} ${version}`);

  try { statSync(spec.file); } catch { die(`no artifact at ${spec.file}`); }

  const inside = insideVsix(spec.file);
  if (inside.version !== version) die(`the artifact inside says ${inside.version}, not ${version}.`);
  if (inside.id !== `applivity.${spec.name}`) die(`the artifact inside is ${inside.id}, expected applivity.${spec.name}.`);
  if (spec.pkg) {
    const m = JSON.parse(readFileSync(spec.pkg, 'utf8'));
    if (m.version !== version) die(`packages/vscode is ${m.version}, not ${version}. Bump and build first.`);
  }

  const live = await galleryVersions(inside.id);
  if (live.includes(version)) die(`the gallery already serves ${version}.`);

  say('artifact', spec.file);
  say('bytes', withCommas(bytesOf(spec.file)));
  say('sha256', hashOf(spec.file));
  say('inside', `${inside.id} ${inside.version}  ok`);
  say('gallery', `latest ${live[0] ?? 'none'}, no ${version}  ok`);
  say('will do', `PUT .../publishers/applivity/extensions/${spec.name}`);

  if (!go) return console.log('\n  NOT PUBLISHED — re-run with --go to publish.\n');

  console.log('\n  publishing...');
  await uploadVsix(spec.file, spec.name);
  const seen = await awaitGallery(inside.id, version);
  say('published', seen ? `${version} is live  ok` : `${version} accepted but not visible yet after 3 min`);
  if (!seen) process.exit(1);
}

// ---------------------------------------------------------------- open vsx

const OPENVSX = 'https://open-vsx.org';
const OPENVSX_KEYCHAIN = 'plato.release.openvsx';

/** The registry's own view of one extension: its latest version and every version it lists. */
async function openvsxState(id) {
  const res = await fetch(`${OPENVSX}/api/${id.replace('.', '/')}`);
  if (!res.ok) return { latest: null, versions: [] };
  const j = await res.json();
  return {
    latest: j.version ?? null,
    versions: Object.keys(j.allVersions ?? {}).filter((v) => v !== 'latest'),
  };
}

async function openvsxHas(id, version) {
  const res = await fetch(`${OPENVSX}/api/${id.replace('.', '/')}/${version}`);
  return res.ok;
}

function openvsxPat() {
  const r = spawnSync('security', ['find-generic-password', '-s', OPENVSX_KEYCHAIN, '-w'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) {
    die(
      `no Open VSX token in the keychain (${OPENVSX_KEYCHAIN}).\n\n` +
        `  Add it once, replacing <token> with the token from open-vsx.org:\n\n` +
        `    security add-generic-password -s ${OPENVSX_KEYCHAIN} -a applivity -w '<token>'`,
    );
  }
  return r.stdout.trim();
}

/**
 * Publish to the Eclipse Foundation registry. The token travels in the
 * environment, never in argv: a command line is readable in the process list,
 * and this one is a credential.
 */
async function openvsx(version, go) {
  const file = `${ART}/plato-${version}.vsix`;
  rule(`Open VSX — plato ${version}`);
  try { statSync(file); } catch { die(`no artifact at ${file}`); }

  const inside = insideVsix(file);
  if (inside.version !== version) die(`the artifact inside says ${inside.version}, not ${version}.`);
  if (inside.id !== 'applivity.plato') die(`the artifact inside is ${inside.id}, expected applivity.plato.`);

  const state = await openvsxState(inside.id);
  if (state.versions.includes(version)) die(`Open VSX already serves ${version}.`);

  say('artifact', file);
  say('bytes', withCommas(bytesOf(file)));
  say('sha256', hashOf(file));
  say('inside', `${inside.id} ${inside.version}  ok`);
  say('registry', `latest ${state.latest ?? 'none'}, no ${version}  ok`);
  say('will do', `PUT ${OPENVSX}/api/-/publish`);

  if (!go) return console.log('\n  NOT PUBLISHED — re-run with --go to publish.\n');

  console.log('\n  publishing...');
  const r = spawnSync('npx', ['--yes', 'ovsx@1.4.0', 'publish', file], {
    stdio: 'inherit',
    env: { ...process.env, OVSX_PAT: openvsxPat() },
  });
  if (r.status !== 0) die(`ovsx publish failed (${r.status}).`);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await openvsxHas(inside.id, version)) {
      say('published', `${version} is live  ok`);
      return;
    }
    await new Promise((res) => setTimeout(res, 10_000));
  }
  say('published', `${version} accepted but not visible yet after 3 min`);
  console.log('\n  The upload was accepted. Do NOT re-run — a second publish of this version is a duplicate.\n');
}

// ---------------------------------------------------------------- github

function seriesOf(tag) {
  const m = tag.match(/^(cli|vscode|vs)-v(.+)$/);
  if (!m) die(`"${tag}" is not of the form cli-v1.2.3, vscode-v1.2.3 or vs-v1.2.3.`);
  return { series: m[1], version: m[2] };
}

function remoteMain() {
  const sha = run('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: ROOT }).stdout.split('\t')[0].trim();
  if (!sha) die('could not read origin/main.');
  return sha;
}

function reaches(target) {
  return spawnSync('git', ['merge-base', '--is-ancestor', target, remoteMain()], { cwd: ROOT }).status === 0;
}

async function github(tag, target, go) {
  const { series, version } = seriesOf(tag);
  const meta = SERIES[series];
  const note = `${NOTES}/${tag}.md`;
  const asset = `${ART}/${meta.asset(version)}`;
  rule(`GitHub — ${tag}`);

  try { statSync(note); } catch { die(`no release note at ${note}`); }
  try { statSync(asset); } catch { die(`no artifact at ${asset}`); }

  const existing = run('gh', ['release', 'view', tag, '--json', 'tagName'], { allowFail: true });
  if (existing.status === 0) die(`release ${tag} already exists.`);

  const sha = target ?? remoteMain();
  const full = run('git', ['rev-parse', sha], { cwd: ROOT }).stdout.trim();
  if (!reaches(full)) die(`${full} is not on origin/main. Push first.`);

  say('note', note);
  say('artifact', asset);
  say('bytes', withCommas(bytesOf(asset)));
  say('sha256', hashOf(asset));
  say('target', `${full}  on origin/main  ok`);
  say('release', `no ${tag}  ok`);
  say('will do', `gh release create ${tag} --target ${full}`);

  if (!go) return console.log('\n  NOT PUBLISHED — re-run with --go to publish.\n');

  console.log('\n  publishing...');
  run('gh', ['release', 'create', tag, '--target', full, '--title', meta.title(version), '--notes-file', note, asset], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // Read it back and hash what GitHub actually serves.
  const dir = mkdtempSync(join(tmpdir(), 'plato-release-'));
  try {
    run('gh', ['release', 'download', tag, '--pattern', meta.asset(version), '--dir', dir], { cwd: ROOT });
    const back = join(dir, meta.asset(version));
    const same = hashOf(back) === hashOf(asset);
    say('published', `${tag}  ok`);
    say('downloaded', `${withCommas(bytesOf(back))} bytes  ${same ? 'identical to ours  ok' : 'DIFFERS'}`);
    if (!same) process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Mark the previous release of the same series superseded.
  const list = JSON.parse(run('gh', ['release', 'list', '--limit', '100', '--json', 'tagName,createdAt'], { cwd: ROOT }).stdout);
  const previous = list
    .filter((r) => r.tagName.startsWith(`${series}-v`) && r.tagName !== tag)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!previous) return;
  const body = run('gh', ['release', 'view', previous.tagName, '--json', 'body', '-q', '.body'], { cwd: ROOT }).stdout;
  if (body.includes('Superseded by')) return say('supersede', `${previous.tagName} already marked`);
  const tmp = join(mkdtempSync(join(tmpdir(), 'plato-body-')), 'body.md');
  writeFileSync(tmp, `${body}\n\n---\n\n**Superseded by ${tag}.**\n`);
  run('gh', ['release', 'edit', previous.tagName, '--notes-file', tmp], { cwd: ROOT, stdio: 'inherit' });
  say('supersede', `${previous.tagName} -> ${tag}  ok`);
}

// ---------------------------------------------------------------- main

const [verb, arg, ...rest] = process.argv.slice(2);
const go = rest.includes('--go');
const targetAt = rest.indexOf('--target');
const target = targetAt >= 0 ? rest[targetAt + 1] : undefined;

if (!verb || !arg) {
  console.error(`
  usage: release <npm|github|vscode|vs> <version|tag> [--go] [--target <sha>]

    npm    0.5.2              publish the tarball to npm
    github cli-v0.5.1         create the GitHub release, mark the previous superseded,
                              then download the asset back and hash it

  Nothing is published without --go.

  The two Marketplace verbs exist and are checked, but they need a token that is
  not configured: the Marketplaces are published by hand at
  marketplace.visualstudio.com/manage. To enable them, add the token once with
    security add-generic-password -s plato.release.marketplace -a applivity -w '<PAT>'
`);
  process.exit(2);
}

if (verb === 'npm') await npm(arg, go);
else if (verb === 'vscode' || verb === 'vs') await marketplace(verb, arg, go);
else if (verb === 'openvsx') await openvsx(arg, go);
else if (verb === 'github') await github(arg, target, go);
else die(`unknown surface "${verb}".`);
