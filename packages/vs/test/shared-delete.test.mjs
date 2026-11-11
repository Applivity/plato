/**
 * Deleting a chat from a shared History must survive the merge.
 *
 * The shared-chat merge exists so two windows can add to one History without
 * replacing each other (see shared-chats.test.mjs). Its first shape rebuilt the
 * list as incoming + carry + existing, which also restored anything this window
 * had just deleted: a delete was a silent no-op in every Visual Studio window.
 * These cases pin the opposite property:
 *
 *   - an id this window removes is a tombstone, dropped from the file and from
 *     any concurrent writer's incoming list;
 *   - Delete all tombstones every id this window had seen;
 *   - a chat another window added at the same moment survives the deletion;
 *   - a chat both windows still list is not resurrected by the other window's
 *     merge;
 *   - tombstones older than a week are pruned.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { WorkspaceMemento } = require('../dist/plato-host.cjs');

const KEY = 'plato.chatSessions';
const DELETED = 'plato.chatSessions.deleted';
const chat = (id) => ({ id, title: id, ts: '2026-11-03T00:00:00.000Z', log: [] });
const ids = (list) => (list ?? []).map((c) => c.id);
const readShared = (file) => JSON.parse(readFileSync(file, 'utf8'));

const dir = mkdtempSync(join(tmpdir(), 'plato-shared-delete-'));
const shared = join(dir, 'project-chats.json');
const windowA = new WorkspaceMemento(join(dir, 'a.json'), shared);
const windowB = new WorkspaceMemento(join(dir, 'b.json'), shared);

// Both windows start from the same two saved chats.
await windowA.update(KEY, [chat('c1'), chat('c2')]);
assert.deepEqual(ids(windowB.get(KEY, [])), ['c1', 'c2'], 'window B sees the shared chats');

// --- 1. A delete is a delete, in the file and in the other window ---------
await windowA.update(KEY, [chat('c1')]);
assert.deepEqual(
  ids(readShared(shared)[KEY]),
  ['c1'],
  'the deleted chat is gone from the shared file',
);
assert.deepEqual(ids(windowB.get(KEY, [])), ['c1'], 'window B no longer lists it');
const fresh = new WorkspaceMemento(join(dir, 'reload.json'), shared);
assert.deepEqual(
  ids(fresh.get(KEY, [])),
  ['c1'],
  'a reloaded window no longer lists it',
);

// The other window still listing the deleted chat must not restore it.
await windowB.update(KEY, [chat('c1'), chat('c2')]);
assert.deepEqual(
  ids(readShared(shared)[KEY]),
  ['c1'],
  "another window's stale list does not resurrect the deleted chat",
);

// --- 2. Delete all ------------------------------------------------
await windowA.update(KEY, []);
assert.deepEqual(ids(readShared(shared)[KEY]), [], 'Delete all empties the file');
assert.deepEqual(ids(new WorkspaceMemento(join(dir, 'r2.json'), shared).get(KEY, [])), []);

// --- 3. A chat added by the other window at the same moment survives ------
await windowA.update(KEY, [chat('c1'), chat('c2')]);
windowA.get(KEY, []); // A's view: c1 and c2
await windowB.update(KEY, [chat('c1'), chat('c2'), chat('c3')]); // B adds c3
await windowA.update(KEY, []); // A deletes everything it knew about
assert.deepEqual(
  ids(readShared(shared)[KEY]),
  ['c3'],
  "the other window's new chat survives A's Delete all",
);

// --- 4. Tombstones are pruned after a week --------------------------------
const file = readShared(shared);
file[DELETED] = {
  ...file[DELETED],
  old: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
};
writeFileSync(shared, JSON.stringify(file));
await windowA.update(KEY, [chat('c1')]);
assert.equal(
  'old' in (readShared(shared)[DELETED] ?? {}),
  false,
  'a tombstone older than a week is pruned',
);

// --- 5. A window's own local keys are untouched ---------------------------
await windowA.update('plato.local', { a: 1 });
assert.deepEqual(windowA.get('plato.local', null), { a: 1 });

console.log('PASS shared History deletes: tombstones, Delete all, concurrent adds, pruning');
