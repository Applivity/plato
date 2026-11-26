/**
 * The approval card's own button says what its answer does.
 *
 * In `edit`, a yes to an edit is remembered for that file for the session
 * (D49ak) — and the button still read "Allow once", promising one edit while
 * granting a standing approval. The demo video shows the contradiction: the
 * click that said "once" was followed by "Plato will not ask again before
 * editing …".
 *
 * The host now sends the label, because only it knows the mode and the paths.
 * This test proves the whole claim end to end:
 *
 *   - the per-file button reads "Allow this file", and the yes it takes really
 *     is remembered (the same write again draws no card at all);
 *   - a tool whose yes is forgotten keeps "Allow once" — no label is sent;
 *   - a patch that names several files says so.
 *
 * The host under test — this package's compiled `out/extension.js`, started
 * through the Visual Studio lane's shim against the field harness's scripted
 * model — is set up in `host-harness.mjs`.
 */
import assert from 'node:assert/strict';

import { posts, setScript, stub, startHost, waitPost } from './host-harness.mjs';

const write = (path, content = 'x') => ({
  calls: [{ tool: 'write_file', args: { path, content } }],
});

let failure = null;
try {
  const host = await startHost();

  // 1. A single-file write in `edit`. The yes is remembered for that file.
  await setScript([write('a.txt'), { text: 'Done.' }]);
  let mark = posts.length;
  host.receive({ type: 'ask', text: 'Write a.txt.' });
  const card = await waitPost((m) => m.type === 'approval', 'the write card', mark);
  assert.equal(card.heading, 'Let Plato write a.txt?', 'the heading is unchanged');
  assert.equal(
    card.allowOnce,
    'Allow this file',
    'the per-file button says the answer covers this file',
  );
  assert.equal(
    card.allowAll,
    'Allow every edit this session',
    'the session-wide choice is unchanged',
  );
  host.receive({ type: 'approve', value: 'yes' });
  await waitPost((m) => m.type === 'done', 'the approved run to finish', mark);
  assert.ok(
    posts.some(
      (m, i) =>
        i >= mark &&
        m.type === 'notice' &&
        m.text === 'Plato will not ask again before editing a.txt.',
    ),
    'the yes is followed by the sentence that makes "Allow once" a lie',
  );

  // 2. The same write again: no card. That absence is what the label promises,
  //    and if it ever stops holding the label must change back.
  await setScript([write('a.txt'), { text: 'Done again.' }]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Write a.txt again.' });
  await waitPost((m) => m.type === 'done', 'the remembered run to finish', mark);
  assert.equal(
    posts.filter((m, i) => i >= mark && m.type === 'approval').length,
    0,
    'the second write draws no card, because the first yes was remembered',
  );

  // 3. A command's yes is NOT remembered, so its button still says "once".
  await setScript([
    { calls: [{ tool: 'shell', args: { command: 'true' } }] },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Run a command.' });
  const shell = await waitPost((m) => m.type === 'approval', 'the command card', mark);
  assert.equal(
    shell.allowOnce,
    undefined,
    'a command keeps "Allow once": its answer is forgotten',
  );
  assert.equal(shell.allowAll, 'Allow every command this session');
  host.receive({ type: 'approve', value: 'no' });
  await waitPost((m) => m.type === 'done', 'the denied run to finish', mark);

  // 4. One yes over several files is not "this file".
  await setScript([
    {
      calls: [
        {
          tool: 'apply_patch',
          args: {
            patches: [
              { path: 'a.txt', content: 'x' },
              { path: 'b.txt', content: 'y' },
            ],
          },
        },
      ],
    },
    { text: 'Done.' },
  ]);
  mark = posts.length;
  host.receive({ type: 'ask', text: 'Patch two files.' });
  const patch = await waitPost((m) => m.type === 'approval', 'the patch card', mark);
  assert.equal(
    patch.allowOnce,
    'Allow these files',
    'a card that covers several files says so',
  );
  host.receive({ type: 'approve', value: 'no' });
  await waitPost((m) => m.type === 'done', 'the denied patch run to finish', mark);
} catch (error) {
  failure = error;
} finally {
  // The stub is a child process; left running it keeps the test's event loop
  // alive long after the last assertion.
  stub.kill();
}

if (failure !== null) throw failure;
