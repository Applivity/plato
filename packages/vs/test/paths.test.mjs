/**
 * Host test: local paths, attached paths and pasted bytes (D49cd).
 *
 * What it proves:
 *   - `check-paths` offers a thumbnail only for an image inside the workspace,
 *     and says WHERE it is served from; a text file and a missing file stay
 *     links;
 *   - `attach-paths` accepts a path with a SPACE in it, and refuses a secret
 *     path, an oversized image and a missing file with the real cause;
 *   - `attach-bytes` (a pasted screenshot) is written to Plato's own storage and
 *     attached by path, so the chip names it;
 *   - the temp sweep at activation removes a pasted file older than a week and
 *     keeps a fresh one;
 *   - `open-path` on a missing file says so in the chat.
 *
 * It does NOT prove the page draws any of it — `scripts/render/paths.mjs` is
 * the page's witness, and the real window is the other one.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-paths-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-paths-root-'));
const STATE = join(HOME, 'state');
const PASTED = join(HOME, '.plato', 'pasted');
process.env['HOME'] = HOME;
process.env['USERPROFILE'] = HOME;

const require = createRequire(import.meta.url);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/* ---- the workspace: a spaced image, a note, a secret, an oversized image -- */
mkdirSync(join(ROOT, 'shots'), { recursive: true });
writeFileSync(join(ROOT, 'shots', 'My Screenshot.png'), PNG);
writeFileSync(join(ROOT, 'notes.txt'), 'a note\n', 'utf8');
writeFileSync(join(ROOT, '.env'), 'SECRET=1\n', 'utf8');
writeFileSync(join(ROOT, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]));

/* ---- the pasted folder: one old file to sweep, one fresh file to keep ----- */
mkdirSync(PASTED, { recursive: true });
const OLD = join(PASTED, 'pasted-old.png');
const FRESH = join(PASTED, 'pasted-fresh.png');
writeFileSync(OLD, PNG);
writeFileSync(FRESH, PNG);
const eightDays = 8 * 24 * 60 * 60 * 1000;
utimesSync(OLD, new Date(Date.now() - eightDays), new Date(Date.now() - eightDays));

mkdirSync(STATE, { recursive: true });
writeFileSync(
  join(STATE, 'workspace-state.json'),
  JSON.stringify({
    'plato.chatMode': 'edit',
    'plato.chatLog': [],
  }),
  'utf8',
);

const posts = [];
const waiters = [];

const transport = {
  html: '',
  setHtml(html) {
    transport.html = html;
  },
  post(message) {
    posts.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  },
  reveal() {},
  disposed() {},
  async request() {
    return {};
  },
};

const { start } = require('../dist/plato-host.cjs');

function waitPost(predicate, label, from = 0, timeoutMs = 20_000) {
  for (let i = from; i < posts.length; i += 1) {
    if (predicate(posts[i])) return Promise.resolve(posts[i]);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${label}`)),
      timeoutMs,
    );
    waiters.push({
      predicate,
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failure = null;
try {
  const host = start({
    root: ROOT,
    stateDir: STATE,
    settings: {
      'plato.connections': [
        {
          id: 'stub',
          kind: 'openai',
          baseUrl: 'http://127.0.0.1:1/v1',
          models: ['stub-model'],
        },
      ],
      'plato.model': 'stub:stub-model',
    },
    secrets: { 'plato.providers.stub.apiKey': 'test-key' },
    transport,
  });

  await host.execute('plato.openChat');
  host.receive({ type: 'ready' });
  await waitPost((m) => m.type === 'restore', 'restore');

  /* ---- 1. The sweep at activation ----------------------------------- */
  const sweepDeadline = Date.now() + 5000;
  while (Date.now() < sweepDeadline && existsSync(OLD)) await sleep(50);
  assert.equal(existsSync(OLD), false, 'a pasted file older than a week is swept');
  assert.equal(existsSync(FRESH), true, 'a fresh pasted file is kept');

  /* ---- 2. check-paths: a thumbnail only for a workspace image -------- */
  let mark = posts.length;
  host.receive({
    type: 'check-paths',
    paths: ['shots/My Screenshot.png', 'notes.txt', 'shots/gone.png'],
  });
  const info = await waitPost((m) => m.type === 'path-info', 'path info', mark);
  const image = info.entries.find((e) => e.path === 'shots/My Screenshot.png');
  const note = info.entries.find((e) => e.path === 'notes.txt');
  const missing = info.entries.find((e) => e.path === 'shots/gone.png');
  assert.ok(image, 'the image is answered');
  assert.equal(image.name, 'My Screenshot.png', 'the thumbnail carries its name');
  assert.ok(
    typeof image.thumb === 'string' && image.thumb.startsWith('file:'),
    `the image is served by URI (${image.thumb})`,
  );
  assert.equal(note.thumb, undefined, 'a text file stays a link');
  assert.equal(missing.thumb, undefined, 'a missing file stays a link (and says so on click)');

  /* ---- 3. attach-paths: spaces work, the rules are the picker's ------ */
  mark = posts.length;
  host.receive({
    type: 'attach-paths',
    paths: [
      'shots/My Screenshot.png',
      '.env',
      'huge.png',
      'shots/gone.png',
    ],
  });
  const attached = await waitPost(
    (m) => m.type === 'attach-result',
    'attach result',
    mark,
  );
  const ok = attached.accepted.find((a) => a.path === 'shots/My Screenshot.png');
  assert.ok(ok, `a path with a space is accepted: ${JSON.stringify(attached)}`);
  assert.equal(ok.image, true, 'it is attached as an image');
  assert.equal(ok.size, PNG.length, 'its raw size is reported');
  const why = (p) => (attached.rejected.find((r) => r.path === p) || {}).error;
  assert.match(why('.env') || '', /secret deny-list/, 'a secret is refused by name');
  assert.match(why('huge.png') || '', /over the 3 MB limit/, 'an oversized image says its size');
  assert.match(
    why('shots/gone.png') || '',
    /ENOENT/,
    'a missing file carries the platform code',
  );

  /* ---- 4. attach-bytes: a pasted screenshot becomes a real attachment - */
  mark = posts.length;
  host.receive({
    type: 'attach-bytes',
    name: 'clip screen.png',
    mime: 'image/png',
    data: PNG.toString('base64'),
  });
  const pasted = await waitPost(
    (m) => m.type === 'attach-result',
    'the pasted attachment',
    mark,
  );
  assert.equal(pasted.rejected.length, 0, JSON.stringify(pasted.rejected));
  assert.equal(pasted.accepted.length, 1, 'one pasted image was attached');
  const chip = pasted.accepted[0];
  assert.match(chip.path, /plato\/pasted|\.plato\/pasted/, `stored in Plato's own folder (${chip.path})`);
  assert.ok(chip.path.startsWith(PASTED), 'the copy lives under the pasted folder');
  assert.ok(
    chip.name.endsWith('clip screen.png'),
    `the chip keeps the name the user saw (${chip.name})`,
  );
  assert.equal(chip.image, true, 'it is an image attachment');
  assert.equal(existsSync(chip.path), true, 'the bytes were written');
  assert.deepEqual(
    readFileSync(chip.path).subarray(0, 8),
    PNG.subarray(0, 8),
    'the file is the bytes that were pasted',
  );

  /* ---- 5. open-path on a missing file says so ------------------------ */
  mark = posts.length;
  host.receive({ type: 'open-path', path: 'shots/gone.png' });
  const notice = await waitPost(
    (m) => m.type === 'notice' && /Could not open/.test(String(m.text || '')),
    'the missing-file notice',
    mark,
  );
  assert.match(notice.text, /file not found \(ENOENT\)/, notice.text);

  console.log('PASS local paths: check-paths, attach-paths, pasted bytes, sweep');
  console.log(`  image thumb: ${image.thumb}`);
  console.log(`  pasted file: ${chip.path}`);

  host.panel()?.dispose();
} catch (error) {
  failure = error;
}

if (failure !== null) {
  console.error('FAIL local paths: check-paths, attach-paths, pasted bytes, sweep');
  console.error(failure instanceof Error ? failure.stack : failure);
  console.error(
    'last posts: ' + JSON.stringify(posts.slice(-12).map((p) => p?.type ?? '?')),
  );
  process.exitCode = 1;
}
