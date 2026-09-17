import { b, check, page, checkPageClean, counters } from './plib.mjs';

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
console.log(counters.fail === 0 ? 'PASS: history empty state' : 'FAIL: ' + counters.fail);
await b.close();
