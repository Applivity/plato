/**
 * The Visual Studio side of D49dj: a path in a reply.
 *
 * What it proves through the real sidecar bundle:
 *   - `vscode.open` reaches the host as `editor.open` with the absolute path,
 *     and only for a file that exists (a missing path and a folder are said in
 *     the chat, not sent to the host);
 *   - a workspace image is offered as a thumbnail, and the URI the shim hands
 *     the page is a data URI the page's CSP allows — a NavigateToString page
 *     has an opaque origin, so a `file:` image would be blocked no matter what
 *     the CSP said;
 *   - an image over the 512 KB inline cap is offered no thumbnail at all (the
 *     page then keeps the path as a link), and its path still opens;
 *   - a non-image and a missing image are not offered as thumbnails.
 *
 * The fake host answers the bridge methods the C# shell answers in production
 * (`editor.*`). Visual Studio itself — what its editor shows for a PNG — is a
 * field check, not this test.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'plato-host.cjs');
const HOME = mkdtempSync(join(tmpdir(), 'plato-vs-open-home-'));
const ROOT = mkdtempSync(join(tmpdir(), 'plato-vs-open-root-'));
const STATE = mkdtempSync(join(tmpdir(), 'plato-vs-open-state-'));

// A real 1x1 PNG: the shim sniffs the bytes, so the test needs real ones.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(join(ROOT, 'picture.png'), PNG);
writeFileSync(join(ROOT, 'note.txt'), 'a note\n');
// A thumbnail is a 64 px hint, so the host inlines only a small image. This
// one is just over the 512 KB inline cap and is still a valid PNG the shell
// will probe.
const BIG = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
writeFileSync(join(ROOT, 'big.png'), BIG);

const requests = [];
const notifications = [];
const waiters = [];
let cursor = 0;
let nextHostId = 1000;

function dispatch(message) {
  notifications.push(message);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
}

function waitFor(predicate, label, timeoutMs = 20_000) {
  for (let i = cursor; i < notifications.length; i += 1) {
    if (predicate(notifications[i])) {
      cursor = i + 1;
      return Promise.resolve(notifications[i]);
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `timeout waiting for ${label}. recent: ${notifications
            .slice(-10)
            .map((n) => n.method)
            .join(', ')}`,
        ),
      );
    }, timeoutMs);
    waiters.push({
      predicate,
      timer,
      resolve(message) {
        clearTimeout(timer);
        cursor = notifications.lastIndexOf(message) + 1;
        resolve(message);
      },
    });
  });
}

function startSidecar() {
  const child = spawn(process.execPath, [BUNDLE], {
    env: { ...process.env, HOME, USERPROFILE: HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    'line',
    (line) => {
      if (line.trim().length === 0) return;
      const message = JSON.parse(line);
      if (message.method !== undefined && message.id !== undefined) {
        requests.push(message);
        child.stdin.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        return;
      }
      dispatch(message);
    },
  );
  return { child };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const exited = (child) =>
  new Promise((resolve) => child.once('exit', resolve));

/** The page message is answered before its async work finishes, so wait for
 *  the bridge request itself, not for the message's own ok. */
async function waitRequest(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = requests.find(predicate);
    if (hit !== undefined) return hit;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function shutdown(child) {
  send(child, { id: nextHostId++, method: 'shutdown' });
  const code = await Promise.race([
    exited(child),
    new Promise((resolve) => setTimeout(() => resolve('running'), 5_000)),
  ]);
  if (code === 'running') child.kill();
}

let sidecar = null;
try {
  sidecar = startSidecar();
  const { child } = sidecar;

  send(child, {
    id: 1,
    method: 'init',
    params: {
      root: ROOT,
      settingsPath: join(STATE, 'settings.json'),
      stateDir: STATE,
      workspaceStateFile: join(STATE, 'workspace-state.json'),
      version: 'test',
    },
  });
  await waitFor((m) => m.id === 1, 'init');
  send(child, { id: 2, method: 'command', params: { command: 'plato.openChat' } });
  const html = await waitFor((m) => m.method === 'webview.html', 'chat HTML');
  assert.match(
    html.params.html,
    /img-src data:/,
    'the page allows the source the shim serves thumbnails from',
  );
  await waitFor((m) => m.id === 2, 'openChat');

  // ---- a workspace image is offered as a data-URI thumbnail --------------
  send(child, {
    id: 3,
    method: 'webview.message',
    params: {
      message: {
        type: 'check-paths',
        paths: ['picture.png', 'big.png', 'note.txt', 'missing.png'],
      },
    },
  });
  const info = await waitFor(
    (m) => m.method === 'webview.post' && m.params.message?.type === 'path-info',
    'the path-info answer',
  );
  const byPath = new Map(info.params.message.entries.map((e) => [e.path, e]));
  const thumb = byPath.get('picture.png')?.thumb ?? '';
  assert.equal(thumb.startsWith('data:image/png;base64,'), true, 'the image has a data URI');
  assert.deepEqual(
    Buffer.from(thumb.slice('data:image/png;base64,'.length), 'base64'),
    PNG,
    'the data URI carries the file itself',
  );
  // Over the inline cap the host offers NO preview. The page skips an entry
  // whose thumb is falsy, so the path stays a clickable link; the click still
  // opens the full image.
  assert.equal(
    byPath.get('big.png')?.thumb,
    '',
    'an image over the inline cap is offered no thumbnail',
  );
  assert.equal('thumb' in byPath.get('note.txt'), false, 'a text file has no thumbnail');
  assert.equal('thumb' in byPath.get('missing.png'), false, 'a missing image has no thumbnail');

  // ---- open-path: an existing file reaches the host as editor.open -------
  send(child, {
    id: 4,
    method: 'webview.message',
    params: { message: { type: 'open-path', path: 'note.txt' } },
  });
  const opened = await waitRequest(
    (r) => r.method === 'editor.open' && r.params?.path === join(ROOT, 'note.txt'),
    'the editor.open request',
  );
  assert.equal(opened.params.path, join(ROOT, 'note.txt'));

  // ---- an oversized image has no preview, but its path still opens ------
  send(child, {
    id: 4.5,
    method: 'webview.message',
    params: { message: { type: 'open-path', path: 'big.png' } },
  });
  await waitRequest(
    (r) => r.method === 'editor.open' && r.params?.path === join(ROOT, 'big.png'),
    'the editor.open request for the oversized image',
  );

  // ---- open-path: a missing file is said in the chat, not sent ----------
  send(child, {
    id: 5,
    method: 'webview.message',
    params: { message: { type: 'open-path', path: 'nope.txt' } },
  });
  await waitFor(
    (m) =>
      m.method === 'webview.post' &&
      m.params.message?.type === 'notice' &&
      /Could not open "nope.txt"/.test(String(m.params.message.text)),
    'the missing-file notice',
  );
  assert.equal(
    requests.filter((r) => r.method === 'editor.open').length,
    2,
    'a missing path never reaches the host',
  );

  // ---- open-path: a folder is not a file --------------------------------
  send(child, {
    id: 6,
    method: 'webview.message',
    params: { message: { type: 'open-path', path: '.' } },
  });
  await waitFor(
    (m) =>
      m.method === 'webview.post' &&
      m.params.message?.type === 'notice' &&
      /folder, not a file/.test(String(m.params.message.text)),
    'the folder notice',
  );
  assert.equal(
    requests.filter((r) => r.method === 'editor.open').length,
    2,
    'a folder never reaches the host',
  );

  console.log('PASS vscode.open and thumbnails: bridge path, data URI, refusals');
} finally {
  if (sidecar !== null) await shutdown(sidecar.child);
}
