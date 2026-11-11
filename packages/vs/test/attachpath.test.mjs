/**
 * D49cd: what a picked attachment path becomes.
 *
 * A file the USER picked may be anywhere on disk; the workspace rule belongs
 * to tool calls the model makes. An absolute path is stored as itself and shown
 * by its base name. A relative path stays workspace-relative, and one that
 * escapes with `..` is refused — that form is ambiguous, and the absolute path
 * is the honest way to name a file outside the project.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { attachmentTarget, isAbsoluteAttachmentPath } = require('../../vscode/out/attachments.js');

// An absolute path outside the root is accepted, and the chip gets the name.
const outside = attachmentTarget('/Users/someone/Desktop/prop-img-default.png');
assert.deepEqual(outside, {
  stored: '/Users/someone/Desktop/prop-img-default.png',
  name: 'prop-img-default.png',
});

// A Windows drive path is absolute too.
assert.equal(isAbsoluteAttachmentPath('c:\\Users\\Omega-PC\\Desktop\\shot.png'), true);
const win = attachmentTarget('c:\\Users\\Omega-PC\\Desktop\\shot.png');
assert.equal(win.name, 'shot.png');

// A relative path inside the workspace keeps its root-relative form.
assert.deepEqual(attachmentTarget('docs/notes.txt'), {
  stored: 'docs/notes.txt',
  name: 'docs/notes.txt',
});

// A relative path that escapes is refused — the absolute form is the way to
// name an outside file.
assert.deepEqual(attachmentTarget('../notes.txt'), { error: 'outside the workspace' });
assert.deepEqual(attachmentTarget('..\\notes.txt'), { error: 'outside the workspace' });
assert.deepEqual(attachmentTarget('a/../../b.txt'), { error: 'outside the workspace' });

console.log('PASS attachment paths: absolute accepted, ../ refused, base name shown');
