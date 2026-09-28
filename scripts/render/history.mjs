import { check, page, checkPageClean, finish } from './plib.mjs';

// The History page's empty Runs state answers the only question a user has when
// they find no runs: where did they go? It used to answer with ".plato/runs/" —
// the pre-D46 repo-relative path. That was wrong twice over: the transcripts had
// moved to a flat ~/.plato/ four releases earlier, and a bare ".plato/runs/"
// reads as a folder inside the user's own project, which is exactly where D46
// decided Plato must never write.
{
  const p = await page(720, { type: 'history', runs: [], chats: [] });
  checkPageClean(p, 'history');
  const r = await p.evaluate(() => {
    const note = document.querySelector('#hibody .note');
    return {
      shown: document.body.classList.contains('show-history'),
      note: note ? note.textContent : null,
    };
  });
  check('the empty Runs state renders', r.shown && !!r.note, r);
  const text = r.note || '';
  // Strip the CORRECT form before searching for the stale one — the good string
  // contains the bad one as a substring, so a bare /\.plato\/runs\// matches
  // both and would pass either way.
  const stale = text.split('~/.plato/runs/').join('');
  check('it names the home runs directory', text.includes('~/.plato/runs/'), text);
  check('it names no repo-relative path', !/\.plato\/runs\//.test(stale), text);
  await p.close();
}
// D49ay: deletions are the user's, and a transcript is otherwise never removed
// automatically. Two rules to hold: the controls exist only when there is
// something to delete — a button that cannot do anything is noise — and a
// destructive control must never fire on the first click.
{
  const runs = [
    {
      file: '2026-09-28T10-00-00-000Z-new.jsonl',
      task: 'recent thing',
      startedAt: '2026-09-28T10:00:00.000Z',
      turns: 4,
    },
    {
      file: '2026-09-01T10-00-00-000Z-old.jsonl.gz',
      task: 'old thing',
      startedAt: '2026-09-01T10:00:00.000Z',
      turns: 12,
      inputTokens: 900,
      outputTokens: 100,
      costUsd: 0.02,
    },
  ];
  const p = await page(720, { type: 'history', runs, chats: [] });
  checkPageClean(p, 'history with runs');

  const shape = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#hibody .runitem')];
    const head = document.querySelector('#hibody .runhead');
    const all = head ? head.querySelector('.btn-danger') : null;
    return {
      items: items.length,
      perItem: items.filter((i) => i.querySelector('.rdel')).length,
      deleteAll: all ? all.textContent : null,
    };
  });
  check('every run row offers its own delete', shape.items === 2 && shape.perItem === 2, shape);
  check('the Runs heading offers delete-all', shape.deleteAll === 'Delete all', shape);

  // A compressed run is still a run: it is listed and it can be deleted.
  const compressed = await p.evaluate(() =>
    [...document.querySelectorAll('#hibody .runitem')]
      .filter((i) => (i.querySelector('.rt') || {}).textContent === 'old thing').length);
  check('a compressed run still appears in the list', compressed === 1, compressed);

  // The run card opens the run on click. The delete inside it is NOT that.
  const first = await p.evaluate(() => {
    // The webview announces itself with a `ready` on load; only what the click
    // adds is under test here.
    window.__posted.length = 0;
    const b = document.querySelector('#hibody .runitem .rdel');
    b.click();
    return { posted: window.__posted.slice(), armed: b.classList.contains('is-armed') };
  });
  check('one click arms the delete and asks nothing', first.posted.length === 0, first);
  check('and it shows it is armed', first.armed === true, first);

  const second = await p.evaluate(() => {
    document.querySelector('#hibody .runitem .rdel').click();
    return window.__posted.slice();
  });
  check('the second click asks the host to delete that run',
    second.length === 1 && second[0].type === 'deleteRun', second);
  check('and deleting a run never opens it',
    !second.some((m) => m.type === 'openRun'), second);

  // Still true after all that: the card itself opens the run.
  const open = await p.evaluate(() => {
    window.__posted.length = 0;
    document.querySelector('#hibody .runitem .rt').click();
    return window.__posted.slice();
  });
  check('clicking the row itself still opens the run',
    open.length === 1 && open[0].type === 'openRun', open);

  const all = await p.evaluate(() => {
    window.__posted.length = 0;
    const b = document.querySelector('#hibody .runhead .btn-danger');
    b.click();
    const armed = { posted: window.__posted.slice(), label: b.textContent };
    b.click();
    return { armed, after: window.__posted.slice() };
  });
  check('delete-all arms before it fires', all.armed.posted.length === 0, all.armed);
  check('and says what it is about to delete', all.armed.label === 'Delete all 2?', all.armed);
  check('the second click deletes them all',
    all.after.length === 1 && all.after[0].type === 'deleteAllRuns', all.after);

  await p.close();
}

// Nothing to delete means nothing to offer: the empty state must carry no
// destructive control at all.
{
  const p = await page(720, { type: 'history', runs: [], chats: [] });
  checkPageClean(p, 'history empty controls');
  const r = await p.evaluate(() => ({
    danger: document.querySelectorAll('#hibody .btn-danger').length,
    rowDelete: document.querySelectorAll('#hibody .rdel').length,
  }));
  check('no destructive control is drawn when there are no runs',
    r.danger === 0 && r.rowDelete === 0, r);
  await p.close();
}

await finish('history: empty state, per-run delete and delete-all');
