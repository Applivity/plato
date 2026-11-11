import { check, page, checkPageClean, finish } from './plib.mjs';

/** D49cd: History opens on Chats; the run-record checks switch to their tab. */
async function openRunRecords(p) {
  await p.evaluate(() => document.getElementById('htab-runs').click());
  await p.waitForTimeout(120);
}

// The History page's empty Runs state answers the only question a user has when
// they find no runs: where did they go? It used to answer with ".plato/runs/" —
// the pre-D46 repo-relative path. That was wrong twice over: the transcripts had
// moved to a flat ~/.plato/ four releases earlier, and a bare ".plato/runs/"
// reads as a folder inside the user's own project, which is exactly where D46
// decided Plato must never write.
{
  const p = await page(720, { type: 'history', runs: [], chats: [] });
  await openRunRecords(p);
  checkPageClean(p, 'history');
  const r = await p.evaluate(() => {
    // D49cd: the Run Records tab now carries a description first, so the
    // empty-state sentence is the note that mentions the runs directory.
    const notes = [...document.querySelectorAll('#hibody .note')];
    const note = notes.find((n) => n.textContent.includes('No runs recorded'));
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
  await openRunRecords(p);
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
  await openRunRecords(p);
  checkPageClean(p, 'history empty controls');
  const r = await p.evaluate(() => ({
    danger: document.querySelectorAll('#hibody .btn-danger').length,
    rowDelete: document.querySelectorAll('#hibody .rdel').length,
  }));
  check('no destructive control is drawn when there are no runs',
    r.danger === 0 && r.rowDelete === 0, r);
  await p.close();
}

// M3b checkpoint 2b: saved chats, resume, the conversation title, and the fold
// banner. The host and this page are shared with the VS Code extension, so
// these assertions hold in both hosts.
{
  const chats = [
    {
      id: '__current__',
      title: 'Release run',
      ts: '2026-10-23T10:00:00.000Z',
      count: 6,
      current: true,
    },
    {
      id: 'saved-1',
      title: 'Older conversation',
      ts: '2026-10-20T10:00:00.000Z',
      count: 2,
    },
  ];
  const p = await page(720, { type: 'history', runs: [], chats });
  checkPageClean(p, 'history with chats');

  const shape = await p.evaluate(() => {
    const headings = [...document.querySelectorAll('#hibody .sec h4')].map((h) => h.textContent);
    const items = [...document.querySelectorAll('#hibody .sec')][0]
      ? [...document.querySelectorAll('#hibody .sec')][0].querySelectorAll('.runitem')
      : [];
    return {
      headings,
      titles: [...items].map((i) => (i.querySelector('.rt') || {}).textContent),
      meta: [...items].map((i) => (i.querySelector('.rm') || {}).textContent),
      current: [...items].filter((i) => i.classList.contains('current')).length,
    };
  });
  check('the Chats section renders, with its one-line description',
    shape.headings.includes('Chats'), shape);
  check('every saved chat is listed',
    shape.titles.join(',') === 'Release run,Older conversation', shape);
  check('the live chat says it is the current one',
    shape.meta[0].includes('current chat · click to open'), shape.meta);
  check('a saved chat says clicking resumes it',
    shape.meta[1].includes('click to resume'), shape.meta);
  check('exactly the live chat is marked current', shape.current === 1, shape);

  const resume = await p.evaluate(() => {
    window.__posted.length = 0;
    const items = document.querySelectorAll('#hibody .sec')[0].querySelectorAll('.runitem');
    items[1].click();
    return window.__posted.slice();
  });
  check('clicking a saved chat asks the host to resume it',
    resume.length === 1 && resume[0].type === 'resumeChat' && resume[0].id === 'saved-1',
    resume);

  const current = await p.evaluate(() => {
    window.__posted.length = 0;
    const items = document.querySelectorAll('#hibody .sec')[0].querySelectorAll('.runitem');
    items[0].click();
    return {
      posted: window.__posted.slice(),
      historyOpen: document.body.classList.contains('show-history'),
    };
  });
  check('clicking the current chat returns to it without a host call',
    current.posted.length === 0 && current.historyOpen === false, current);
  await p.close();
}

// The title chip: model-generated, persisted by the host, renamed in place.
{
  const p = await page(720);
  checkPageClean(p, 'title chip');
  const hidden = await p.evaluate(() => document.getElementById('chatTitle').hidden);
  check('an untitled chat shows no chip', hidden === true, hidden);

  await p.evaluate(() => window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'title', text: 'Field test run' } }),
  ));
  await p.waitForTimeout(150);
  const shown = await p.evaluate(() => ({
    hidden: document.getElementById('chatTitle').hidden,
    text: document.getElementById('chatTitleText').textContent,
  }));
  check('the generated title appears in the header',
    shown.hidden === false && shown.text === 'Field test run', shown);

  const renamed = await p.evaluate(() => {
    window.__posted.length = 0;
    document.getElementById('chatTitle').click();
    const input = document.getElementById('chatTitleInput');
    const open = { hidden: input.hidden, value: input.value };
    input.value = 'Release run';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { open, posted: window.__posted.slice() };
  });
  check('clicking the chip opens an editor with the current title',
    renamed.open.hidden === false && renamed.open.value === 'Field test run', renamed.open);
  check('Enter renames the conversation',
    renamed.posted.length === 1 && renamed.posted[0].type === 'rename'
      && renamed.posted[0].value === 'Release run', renamed.posted);

  await p.evaluate(() => window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'title', text: '' } }),
  ));
  await p.waitForTimeout(120);
  const cleared = await p.evaluate(() => document.getElementById('chatTitle').hidden);
  check('a cleared title hides the chip again', cleared === true, cleared);
  await p.close();
}

// The fold: the transcript keeps every row and gains a banner at the cut. The
// summary itself is the MODEL's memory and is not printed.
{
  const log = [
    { k: 'msg', cls: 'you', who: 'You', text: 'Question 1' },
    { k: 'msg', cls: 'bot', who: 'Plato', text: 'Answer 1' },
    { k: 'msg', cls: 'you', who: 'You', text: 'Question 2' },
    { k: 'compact', text: 'A terse machine summary that must stay hidden.' },
    { k: 'msg', cls: 'you', who: 'You', text: 'Question 3' },
  ];
  const p = await page(720, {
    type: 'restore',
    log,
    hasConnections: true,
    model: 'stub:stub-model',
    title: '',
    mode: 'edit',
    queue: [],
    queueHeld: false,
  });
  checkPageClean(p, 'fold banner');
  const fold = await p.evaluate(() => {
    const banners = [...document.querySelectorAll('#log .msg.compact')];
    return {
      banners: banners.length,
      head: banners.length ? banners[0].querySelector('.cc-head').textContent : null,
      printsSummary: banners.length
        ? banners[0].textContent.includes('A terse machine summary')
        : true,
      messages: [...document.querySelectorAll('#log .msg.you, #log .msg.bot')].map((e) => e.textContent),
    };
  });
  check('the fold draws one banner', fold.banners === 1, fold);
  check('the banner says what it means',
    fold.head === 'Plato now carries a summary of the work above', fold.head);
  check('the summary text is NOT printed', fold.printsSummary === false, fold);
  check('every message around the fold is still on screen',
    fold.messages.length === 4
      && fold.messages[0].includes('Question 1')
      && fold.messages[1].includes('Answer 1')
      && fold.messages[2].includes('Question 2')
      && fold.messages[3].includes('Question 3'), fold.messages);

  const p2 = await page(620);
  await p2.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'notice',
      text: 'Summary added for 18 earlier messages. Nothing was removed.',
    },
  })));
  await p2.waitForTimeout(150);
  const notice = await p2.evaluate(() =>
    [...document.querySelectorAll('#log .msg.sys')].map((e) => e.textContent).join('\n'));
  check('the fold notice says nothing was removed',
    notice.includes('Summary added for 18 earlier messages. Nothing was removed.'), notice);
  await p2.close();
  await p.close();
}

// D49cd: History's two tabs and its search.
//
// The founder's shape: "Chats" and "Run Records" as tabs, with one search over
// both. The page must open on Chats, remember the tab while open, show a
// result's kind, highlight the match, and return to the list when the query is
// cleared. The file work is the host's; here the host is simulated by
// dispatching the messages it would post.
{
  const chats = [
    { id: 'c1', title: 'Current chat', ts: '2026-11-11T10:00:00.000Z', count: 3, current: true },
    { id: 'c2', title: 'Saved chat', ts: '2026-11-10T10:00:00.000Z', count: 5 },
  ];
  const runs = [{ file: 'r1.jsonl', task: 'a finished run', startedAt: '2026-11-11T09:00:00.000Z', turns: 2 }];
  const p = await page(760, { type: 'history', chats, runs });
  checkPageClean(p, 'history tabs');

  const tabsAtOpen = await p.evaluate(() => ({
    tabChats: !!document.getElementById('htab-chats'),
    tabRuns: !!document.getElementById('htab-runs'),
    active: (document.querySelector('.htab.on') || {}).textContent || '',
    search: (document.getElementById('hq') || {}).placeholder || '',
    heading: (document.querySelector('#hibody h4') || {}).textContent || '',
    desc: (document.querySelector('#hibody .note') || {}).textContent || '',
    deletes: [...document.querySelectorAll('#hibody .runitem')].map((i) => ({
      title: (i.querySelector('.rt') || {}).textContent,
      del: !!i.querySelector('.rdel'),
    })),
  }));
  check('History draws Chats and Run Records tabs',
    tabsAtOpen.tabChats && tabsAtOpen.tabRuns, tabsAtOpen);
  check('it opens on Chats', tabsAtOpen.active === 'Chats', tabsAtOpen.active);
  check('the search field is above them, with its placeholder',
    tabsAtOpen.search === 'Search chats and run records', tabsAtOpen.search);
  check('the Chats tab says what it is',
    tabsAtOpen.heading === 'Chats' && tabsAtOpen.desc === 'Conversations you can reopen.',
    tabsAtOpen);
  check('the current chat has no delete; a saved chat does',
    tabsAtOpen.deletes.find((d) => d.title === 'Current chat')?.del === false
      && tabsAtOpen.deletes.find((d) => d.title === 'Saved chat')?.del === true,
    tabsAtOpen.deletes);

  // Switching to Run Records shows the runs and their description.
  await p.evaluate(() => document.getElementById('htab-runs').click());
  await p.waitForTimeout(120);
  const runTab = await p.evaluate(() => ({
    active: (document.querySelector('.htab.on') || {}).textContent || '',
    heading: (document.querySelector('#hibody h4') || {}).textContent || '',
    desc: (document.querySelector('#hibody .note') || {}).textContent || '',
    items: document.querySelectorAll('#hibody .runitem').length,
    deleteAll: !!document.querySelector('#hibody .runhead .btn-danger'),
  }));
  check('the tab switch shows Run Records', runTab.active === 'Run Records' && runTab.items === 1, runTab);
  check('the Run Records tab says what it is',
    runTab.heading === 'Run Records'
      && runTab.desc === 'Records of finished runs — kept for reference, not resumable.',
    runTab);
  check('and keeps Delete all', runTab.deleteAll, runTab);

  // Typing and pressing Enter asks the host; the query is what it sends.
  await p.evaluate(() => {
    const q = document.getElementById('hq');
    q.value = 'saved';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await p.waitForTimeout(80);
  const asked = await p.evaluate(() =>
    window.__posted.filter((m) => m.type === 'historySearch').map((m) => m.query));
  check('Enter asks the host to search', asked.includes('saved'), asked);

  // Results for both kinds, with the match highlighted.
  const results = [
    { kind: 'chat', id: 'c2', title: 'Saved chat', ts: '2026-11-10T10:00:00.000Z',
      snippet: 'the saved answer is here', start: 4, end: 9 },
    { kind: 'run', file: 'r1.jsonl', title: 'a finished run', ts: '2026-11-11T09:00:00.000Z',
      snippet: 'the run said saved too', start: 13, end: 18 },
  ];
  await p.evaluate((r) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'historySearchResults', query: 'saved', results: r, truncated: true, scanCapped: false },
  })), results);
  await p.waitForTimeout(150);
  const shown = await p.evaluate(() => ({
    kinds: [...document.querySelectorAll('#hibody .hkind')].map((e) => e.textContent),
    titles: [...document.querySelectorAll('#hibody .hcase')].map((e) => e.textContent),
    marks: [...document.querySelectorAll('#hibody .hsnip mark')].map((e) => e.textContent),
    notes: [...document.querySelectorAll('#hibody .note')].map((e) => e.textContent),
  }));
  check('a chat hit and a run hit are both shown, each saying which it is',
    shown.kinds.join(',') === 'Chat,Run' && shown.titles.includes('Saved chat')
      && shown.titles.includes('a finished run'), shown);
  check('the match is highlighted in the snippet',
    shown.marks.join(',') === 'saved,saved', shown.marks);
  check('a capped search says so', shown.notes.includes('Showing the first 40 matches.'), shown.notes);

  // No matches: the line names the query.
  await p.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'historySearchResults', query: 'saved', results: [], truncated: false, scanCapped: false },
  })));
  await p.waitForTimeout(120);
  const none = await p.evaluate(() => ({
    body: (document.getElementById('hibody') || {}).textContent || '',
  }));
  check('no matches says so, naming the query',
    none.body.includes('No matches for') && none.body.includes('saved'), none.body);

  // Clearing the field returns to the active tab's list.
  await p.evaluate(() => {
    const q = document.getElementById('hq');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(120);
  const cleared = await p.evaluate(() => ({
    heading: (document.querySelector('#hibody h4') || {}).textContent || '',
    items: document.querySelectorAll('#hibody .runitem').length,
  }));
  check('clearing the field returns to the list',
    cleared.heading === 'Run Records' && cleared.items === 1, cleared);
  checkPageClean(p, 'history search');
  await p.close();
}

await finish('history: empty state, per-run delete and delete-all, saved chats, title, fold banner');
