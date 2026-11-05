/**
 * Shared archived-chat file: the inter-process lock and the merge check.
 *
 * What it proves, deterministically:
 *   - a second writer waits for the lock instead of reading and writing while
 *     the first writer is between its read and its write;
 *   - after the first writer releases, the second re-reads, merges, and both
 *     chats are in the file;
 *   - a lock older than five seconds is broken, so a crashed writer cannot
 *     block archiving forever.
 *
 * The interleave is forced by a test hook that runs after the read and before
 * the write inside the lock; it is not a timing accident. Removing the lock
 * makes this test fail (the second writer reads before the first writes and
 * the first write then drops it), which is the property the lock exists for.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { WorkspaceMemento, __setSharedWriteHook } =
  require('../dist/plato-host.cjs');

const KEY = 'plato.chatSessions';
const chat = (id) => ({
  id,
  title: id,
  ts: '2026-11-03T00:00:00.000Z',
  log: [{ k: 'msg', cls: 'you', who: 'You', text: id }],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dir = mkdtempSync(join(tmpdir(), 'plato-shared-chats-'));
const shared = join(dir, 'project-chats.json');
const lock = join(dir, 'project-chats.lock');
const first = new WorkspaceMemento(join(dir, 'first.json'), shared);
const second = new WorkspaceMemento(join(dir, 'second.json'), shared);

let releaseFirst;
const released = new Promise((resolve) => {
  releaseFirst = resolve;
});
let enteredFirst;
const entered = new Promise((resolve) => {
  enteredFirst = resolve;
});
let firstCall = true;

__setSharedWriteHook(async () => {
  if (!firstCall) return;
  firstCall = false;
  enteredFirst();
  await released;
});

try {
  const firstUpdate = first.update(KEY, [chat('first')]);
  await entered;
  assert.equal(
    existsSync(shared),
    false,
    'the first writer has not written while it holds the lock',
  );
  assert.equal(existsSync(lock), true, 'the lock file exists while it is held');

  const secondUpdate = second.update(KEY, [chat('second')]);
  const state = await Promise.race([
    secondUpdate.then(() => 'done'),
    pause(150).then(() => 'waiting'),
  ]);
  assert.equal(
    state,
    'waiting',
    'the second writer waits for the lock instead of writing',
  );
  assert.equal(
    existsSync(shared),
    false,
    'nothing is written while the first writer holds the lock',
  );

  __setSharedWriteHook(null);
  releaseFirst();
  await Promise.all([firstUpdate, secondUpdate]);

  const ids = JSON.parse(readFileSync(shared, 'utf8'))[KEY]
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(
    ids,
    ['first', 'second'],
    `both chats survive, got ${ids.join(', ')}`,
  );
  assert.equal(existsSync(lock), false, 'the lock is released');

  /* A lock left by a crashed writer is broken after five seconds. */
  writeFileSync(lock, 'dead-writer');
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old);
  const third = new WorkspaceMemento(join(dir, 'third.json'), shared);
  await third.update(KEY, [chat('third')]);
  assert.equal(existsSync(lock), false, 'the stale lock is broken');
  const after = JSON.parse(readFileSync(shared, 'utf8'))[KEY]
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(
    after,
    ['first', 'second', 'third'],
    `the stale-lock writer lands, got ${after.join(', ')}`,
  );

  console.log(
    'PASS shared chats: lock waits, both chats survive, stale lock broken',
  );
} finally {
  __setSharedWriteHook(null);
}
