/**
 * The nine field tests, as data.
 *
 * Each case is what a person would do: a mode, a prompt to paste, and — for the
 * writes — a decision to make on the card. `runs` holds the runs in order, since
 * tests 4 and 8 need two (plan then edit; work then recap).
 *
 * The model's replies are scripted in `steps`, so the model is never the thing
 * under test. What IS under test is Plato: whether it gates, refuses, remembers
 * and reports. Where a step carries `calls`, the scripted model is making a tool
 * call, which is what provokes the behaviour being checked.
 */
export const DEMO_REPO = '/Users/ai/Desktop/HcadPublicAndroid-demo';

export const DATE_HELPER = 'app/src/main/java/com/localgsa/hcad/utilities/DateHelper.java';
export const VIEW_MODEL = 'app/src/main/java/com/localgsa/hcad/activities/submissions_screen/SubmissionsViewModel.java';

// Real snippets from the demo repo — the writes must actually apply, because
// tests 5 and 9 assert that the change landed rather than that a card appeared.
const ISO_DECL = 'public final static String ISO8601 = ';
const ISO_DECL_RENAMED = 'public final static String ISO_8601 = ';
const URLDECODE_LINE = 'url =  URLDecoder.decode(builder.build().toString(), "UTF-8");';

export const CASES = [
  {
    n: 1,
    title: 'The secret guard refuses a command that names a protected file',
    // The guard matches the file NAME before anything is opened, so a name that
    // does not exist exercises the identical path with nothing at risk — the
    // field-test page chose `notes.keystore` for exactly that reason.
    runs: [
      {
        mode: 'plan',
        prompt: 'Run this exact shell command and show me its raw output: cat notes.keystore',
        steps: [
          { tool: 'shell', args: { command: 'cat notes.keystore' } },
          { text: 'That command was refused because it references a protected file, so I cannot show its output.' },
        ],
        cards: [],
        // The loop emits NO bus event for a pre-flight refusal, so the transcript
        // is silent about it. The model's received tool result is the only
        // witness that the guard fired rather than the tool simply not running.
        expectModelTold: 'refused',
      },
      {
        mode: 'plan',
        prompt: 'Read local.properties and summarise it',
        steps: [
          { tool: 'read_file', args: { path: 'local.properties' } },
          { text: 'That file is protected, so the read was refused.' },
        ],
        cards: [],
        expectModelTold: 'refused',
      },
    ],
  },
  {
    n: 2,
    title: 'Reading commands run with no card in plan — and the build still does not',
    runs: [
      {
        mode: 'plan',
        prompt:
          'Using shell commands, show me: the last 10 commits that touched DateHelper.java, the current git status, and the list of .java files under app/src/main/java.',
        steps: [
          { text: 'Looking.', calls: [{ tool: 'shell', args: { command: 'git log -10 --oneline -- ' + DATE_HELPER } }] },
          { calls: [{ tool: 'shell', args: { command: 'git status --short' } }] },
          // `ls`, not `find`. A quoted `find` is not on the read-only allow-list,
          // so plan mode REFUSES it — see the note in the README. The field-test
          // page says "find or ls"; the `ls` half is the one that holds today.
          { calls: [{ tool: 'shell', args: { command: 'ls app/src/main/java' } }] },
          // Every step above this carries a call, because a run ENDS when the
          // model stops calling tools: a narration-only step in the middle would
          // silently skip everything after it.
          { calls: [{ tool: 'shell', args: { command: './gradlew assembleDebug' } }] },
          { text: 'The reads returned real output; the build was refused in plan mode.' },
        ],
        cards: [],
      },
    ],
  },
  {
    n: 3,
    title: 'The same reading commands run unasked in edit, and the build asks',
    runs: [
      {
        mode: 'edit',
        prompt: 'Using shell commands, show me the last 10 commits that touched DateHelper.java and the current git status.',
        steps: [
          { calls: [{ tool: 'shell', args: { command: 'git log -10 --oneline -- ' + DATE_HELPER } }] },
          { calls: [{ tool: 'shell', args: { command: 'git status --short' } }] },
          // A task that does not exist, deliberately. It still starts Gradle and
          // runs the wrapper — so the card is raised for real execution, which is
          // what this test is about — but it fails in seconds instead of kicking
          // off an Android build that would take minutes and write build outputs
          // into the repo. The GATE is under test, not the build.
          { calls: [{ tool: 'shell', args: { command: './gradlew noSuchTaskFieldTest' } }] },
          { text: 'The reads needed no card; the Gradle command asked first.' },
        ],
        // One card, for the build. The two reads must not raise one.
        cards: ['allow'],
      },
    ],
  },
  {
    n: 4,
    title: 'A write is refused in plan, and asks in edit',
    runs: [
      {
        mode: 'plan',
        prompt: 'In DateHelper.java, rename the ISO8601 constant to ISO_8601 and update every use of it.',
        steps: [
          { calls: [{ tool: 'apply_diff', args: { path: DATE_HELPER, diffs: [{ search: ISO_DECL, replace: ISO_DECL_RENAMED }] } }] },
          { text: 'I cannot modify files in plan mode, so nothing was changed.' },
        ],
        cards: [],
      },
      {
        mode: 'edit',
        prompt: 'In DateHelper.java, rename the ISO8601 constant to ISO_8601 and update every use of it.',
        steps: [
          { calls: [{ tool: 'apply_diff', args: { path: DATE_HELPER, diffs: [{ search: ISO_DECL, replace: ISO_DECL_RENAMED }] } }] },
          { text: 'You declined the change, so the file is untouched.' },
        ],
        // The denial path: the card appears and is declined.
        cards: ['deny'],
      },
    ],
  },
  {
    n: 5,
    title: 'One card covers a multi-file change, then that file stops asking',
    runs: [
      {
        mode: 'edit',
        prompt:
          'Change the date-format helper and its caller together, as one atomic edit across DateHelper.java and SubmissionsViewModel.java.',
        steps: [
          {
            text: 'Changing both files together.',
            calls: [
              {
                tool: 'apply_patch',
                args: {
                  patches: [
                    { path: DATE_HELPER, diffs: [{ search: ISO_DECL, replace: ISO_DECL_RENAMED }] },
                    // The import line, NOT the URLDecode call: test 9 patches that
                    // call, and a change here would make test 9's SEARCH block
                    // unmatchable — a case-to-case coupling that shows up as test 9
                    // failing for a reason that has nothing to do with test 9.
                    { path: VIEW_MODEL, diffs: [{ search: 'import java.net.URLDecoder;', replace: 'import java.net.URLDecoder; // field test' }] },
                  ],
                },
              },
            ],
          },
          {
            calls: [
              {
                tool: 'apply_patch',
                args: {
                  patches: [
                    {
                      path: DATE_HELPER,
                      diffs: [
                        {
                          search: 'String ISO_8601 = "yyyy-MM-dd\'T\'HH:mm:ss.SSSSSSZ";',
                          replace: 'String ISO_8601 = "yyyy-MM-dd\'T\'HH:mm:ss.SSSSSSZ"; // field test',
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          { text: 'Both files changed together; the second edit to DateHelper.java needed no card.' },
        ],
        // Exactly ONE card for the first patch; the second must be silent.
        cards: ['allow'],
      },
    ],
  },
  {
    n: 6,
    title: 'The question card: tabs, checkboxes, three options at most',
    runs: [
      {
        mode: 'plan',
        prompt:
          'I want to refactor date handling here. Before you start, ask me the questions you need — and where I might reasonably want several things at once, offer that as a multi-select question.',
        steps: [
          {
            calls: [
              {
                tool: 'ask_user',
                args: {
                  questions: [
                    {
                      question: 'Which date behaviours should the refactor cover?',
                      multiple: true,
                      options: ['Formatting', 'Parsing', 'Time zones'],
                    },
                    {
                      question: 'Where should the shared helper live?',
                      options: ['Stay in utilities', 'Move next to the caller'],
                    },
                    {
                      question: 'How much should change in one go?',
                      options: ['One file at a time', 'Everything at once'],
                    },
                  ],
                },
              },
            ],
          },
          { text: 'Thanks — I will work to those answers.' },
        ],
        // The question card is not an approval card and must not be gated.
        cards: [],
        question: { tickFirst: 2, roundTripTab: 1 },
      },
    ],
  },
  {
    n: 7,
    title: 'The plan card appears and moves on real work',
    runs: [
      {
        mode: 'edit',
        prompt:
          'Look at the URL handling in SubmissionsViewModel.java around line 144 and fix what is wrong there. Work in steps and show me your plan.',
        steps: [
          {
            calls: [
              {
                tool: 'todo_write',
                args: {
                  todos: [
                    { content: 'Read the URL handling around line 144', status: 'in_progress' },
                    { content: 'Fix the defect', status: 'pending' },
                    { content: 'Verify the fix', status: 'pending' },
                  ],
                },
              },
            ],
          },
          { calls: [{ tool: 'read_file', args: { path: VIEW_MODEL } }] },
          {
            calls: [
              {
                tool: 'todo_write',
                args: {
                  todos: [
                    { content: 'Read the URL handling around line 144', status: 'completed' },
                    { content: 'Fix the defect', status: 'in_progress' },
                    { content: 'Verify the fix', status: 'pending' },
                  ],
                },
              },
            ],
          },
          { text: 'I have read it and I am part-way through the fix.' },
        ],
        cards: [],
        plan: { inProgress: 1 },
      },
    ],
  },
  {
    n: 8,
    title: 'After a long run, Plato still knows what it read and ran',
    runs: [
      {
        mode: 'edit',
        prompt: 'Read DateHelper.java, then SubmissionsViewModel.java, and tell me what each does with dates and URLs.',
        steps: [
          { text: 'Reading both.', calls: [{ tool: 'read_file', args: { path: DATE_HELPER } }] },
          { calls: [{ tool: 'read_file', args: { path: VIEW_MODEL } }] },
          { calls: [{ tool: 'shell', args: { command: 'git log -3 --oneline' } }] },
          { text: 'The helper formats and parses dates; the view model builds and decodes a URL.' },
        ],
        cards: [],
      },
      {
        mode: 'edit',
        prompt: 'List every file you have read in this conversation so far, and what each command you ran told you.',
        steps: [
          { text: 'Files read: DateHelper.java and SubmissionsViewModel.java. Commands run: git log, which showed the last three commits.' },
        ],
        cards: [],
        // The tell: a recap costs no tool calls.
        expectZeroToolCalls: true,
      },
    ],
  },
  {
    n: 9,
    title: 'auto is hands-off — the only test with no gate at all',
    runs: [
      {
        mode: 'auto',
        prompt: 'Add a one-line comment above the URLDecode call in SubmissionsViewModel.java explaining what it does.',
        steps: [
          {
            calls: [
              {
                tool: 'apply_diff',
                args: {
                  path: VIEW_MODEL,
                  diffs: [
                    {
                      search: URLDECODE_LINE,
                      replace: '// Decode the assembled query string into a usable URL.\n                ' + URLDECODE_LINE,
                    },
                  ],
                },
              },
            ],
          },
          { text: 'Added the comment.' },
        ],
        cards: [],
        // The edit must actually be on disk — that is the whole promise of auto.
        expectOnDisk: { file: VIEW_MODEL, contains: '// Decode the assembled query string into a usable URL.' },
      },
    ],
  },
  {
    n: 10,
    title: 'Stop works while a question is open — the run ends and the card goes',
    // D49as. The one repair from the 2026-09-25 batch that had no automated
    // check, because the driver could click Allow, Deny and question options but
    // never Stop. It is the only way to reach the defect: the cancel handler
    // unblocked a waiting APPROVAL and never a waiting QUESTION, so a run that
    // had asked something could not be stopped until the user answered it.
    runs: [
      {
        mode: 'plan',
        prompt: 'Before you do anything, ask me which date behaviour matters most to me.',
        steps: [
          {
            calls: [
              {
                tool: 'ask_user',
                args: {
                  questions: [
                    {
                      question: 'Which date behaviour matters most?',
                      options: ['Formatting', 'Parsing'],
                    },
                  ],
                },
              },
            ],
          },
          // The steps below exist so a run that was NOT stopped has work left to
          // do. Without them the model's own next step would end the run, and the
          // case would pass on a product that had ignored the Stop button — the
          // same shape of mistake as a check that cannot fail.
          { calls: [{ tool: 'shell', args: { command: 'ls app/src/main/java' } }] },
          { text: 'Here is what I found.' },
        ],
        cards: [],
        cancelOnQuestion: true,
      },
    ],
  },
  {
    n: 11,
    title: 'The editor reports what Plato broke in a file it just wrote',
    // D49av. Plato writes a file and learns only that the write succeeded; on a
    // machine with no compiler that is no feedback at all. The host now asks the
    // editor's language servers what they think of the files just changed.
    //
    // The probe is a TypeScript file ON PURPOSE, and it carries TWO errors ON
    // PURPOSE. The harness's VS Code has no language extensions installed, so the
    // only server available is the built-in TypeScript one — and whether it fully
    // analyses a loose `.ts` file in a folder with no tsconfig is contested. So:
    // the SYNTAX error is caught even by a degraded syntax-only server, and the
    // TYPE error is only caught by a full one. **The notice's count says which** —
    // 2 means full analysis, 1 means syntax only, and "not checked" means neither.
    runs: [
      {
        mode: 'auto',
        prompt:
          'Create a file called probe-diagnostics.ts in the workspace root with exactly these two lines of TypeScript.',
        steps: [
          {
            calls: [
              {
                tool: 'write_file',
                args: {
                  path: 'probe-diagnostics.ts',
                  // `overwrite` is harmless on a file that does not exist and is
                  // what makes a second run work if the launcher's cleanup failed.
                  overwrite: true,
                  content:
                    'const n: number = "not a number";\n' + 'const broken = ;\n',
                },
              },
            ],
          },
          { text: 'Created the file.' },
        ],
        cards: [],
        // Deliberately NO `expectModelTold`. Whether the model can be told at all
        // depends on the window publishing diagnostics, which is not something
        // this repo controls — see the README's note. The model-told check lives
        // in field.test.mjs and runs only when the editor actually reported
        // something, so the case asserts Plato and not the environment.
      },
    ],
  },
  {
    n: 12,
    title: 'A run that repeats itself stops and asks, instead of looping forever',
    // D49aw. The script IS the shape of a stuck model: the same call, with the
    // same arguments, returning the same result, over and over. Nothing else in
    // the product stops that — the turn cap was deleted (D49ab) because it also
    // stopped WORKING runs, and nothing replaced it.
    //
    // `todo_write` is chosen deliberately. It repeats byte-identically, it
    // touches nothing on disk, and it needs no approval in any mode — so this
    // case measures the guard and not a tool, a gate, or the filesystem.
    //
    // FIVE identical turns is the number that matters: three earns the model a
    // nudge and five is where the user is asked. Four would test only the nudge.
    runs: [
      {
        mode: 'auto',
        prompt: 'Keep working until the task is done.',
        steps: [
          ...Array.from({ length: 5 }, () => ({
            calls: [
              {
                tool: 'todo_write',
                args: {
                  todos: [{ content: 'the same step', status: 'in_progress' }],
                },
              },
            ],
          })),
          // The step below is what a product that IGNORED the guard would do
          // next. Without it the model's own next step would end the run, the
          // transcript would say `complete`, and the case could pass on a build
          // with no bound at all — a check that cannot fail.
          { text: 'Everything is done.' },
        ],
        cards: [],
        // The driver presses Stop, because a card nobody answers parks the run.
        stuckStop: true,
      },
    ],
  },
  {
    n: 13,
    title: '"Keep going" resumes the run, and the user\'s own words reach Plato',
    // D49aw. Case 12 proves the run STOPS. This proves the other answer works,
    // and it is the one a person reaches for first: "keep going, but do this
    // instead". Nobody had clicked that button in a real window — only in the
    // render suite, which renders a fixture and never touches the host.
    //
    // The script is case 12's: five identical turns, then a step to finish with.
    // The difference is what the driver does at the card.
    runs: [
      {
        mode: 'auto',
        prompt: 'Keep working until the task is done.',
        steps: [
          ...Array.from({ length: 5 }, () => ({
            calls: [
              {
                tool: 'todo_write',
                args: {
                  todos: [{ content: 'the same step', status: 'in_progress' }],
                },
              },
            ],
          })),
          { text: 'Everything is done.' },
        ],
        cards: [],
        stuckGuidance: 'That step is already recorded — stop updating the plan and finish.',
      },
    ],
  },
  {
    n: 14,
    title: 'Turns that all FAIL are caught too, not only repeated ones',
    // D49aw's second trigger, and it had no end-to-end case at all — only unit
    // tests. A model can also get stuck by trying different things that all
    // fail, which repetition detection cannot see by construction.
    //
    // The calls are DELIBERATELY DIFFERENT read_file paths, so the repetition
    // trigger cannot fire: this case measures the no-progress trigger and
    // nothing else. Reads need no approval in any mode and touch nothing, so
    // the case measures the guard rather than a gate or the filesystem.
    runs: [
      {
        mode: 'auto',
        prompt: 'Find the file and read it.',
        steps: [
          ...Array.from({ length: 5 }, (_, i) => ({
            calls: [{ tool: 'read_file', args: { path: `does-not-exist-${i + 1}.txt` } }],
          })),
          { text: 'I could not find it.' },
        ],
        cards: [],
        stuckStop: true,
      },
    ],
  },
  {
    n: 15,
    title: 'web_fetch asks wherever a user is in the loop, and the card carries the exact URL',
    // D49at CLAUSE 6, and this case is EDIT mode on purpose — not auto.
    //
    // The clause as originally written said web_fetch "asks in every mode
    // including auto", and that is STALE: **D49ak amended D49p on 2026-09-24 so
    // that `auto` fetches without asking**, the founder's own decision. A clause
    // describing the pre-amendment product cannot be passed or failed, which is
    // the exact defect D49at was written to fix — so the clause is corrected and
    // this case tests what the product does.
    //
    // The auto half is witnessed by `modes.test.ts` (`decide('web_fetch','auto')
    // → 'allow'`), which is where that decision lives. What only a real window
    // can witness is the CARD: that egress asks where the user is in the loop,
    // and that the card shows the exact URL — the URL being the thing that
    // leaves the machine.
    //
    // The driver DENIES it, deliberately on two counts: the clause is about the
    // ask rather than the fetch, and this harness touches no network on purpose.
    // A denial means no request is ever sent, so the gate is proved without a
    // socket being opened.
    runs: [
      {
        mode: 'edit',
        prompt: 'Fetch the page at https://example.com/acceptance-check and summarise it.',
        steps: [
          {
            calls: [
              { tool: 'web_fetch', args: { url: 'https://example.com/acceptance-check' } },
            ],
          },
          { text: 'I did not fetch it.' },
        ],
        cards: ['deny'],
      },
    ],
  },
  {
    n: 16,
    title: 'The observer path is live in Duo, and its work is reported',
    // D49at CLAUSE 4, and the gap the decision entry names as unautomated: no
    // harness case ran a Duo or Academy team, so the observer's liveness was
    // verified by hand or not at all.
    //
    // **The clause does NOT require an intervention.** An observer that
    // correctly stays quiet must pass — requiring an intervention would measure
    // chattiness and push the product toward a noisy philosopher. What is
    // asserted is that the path RAN and that its work is REPORTED.
    //
    // The script is read-only work, so no card is involved and the case is
    // about the team rather than about a gate. The observer's own model call
    // carries no tools, so the stub treats it as auxiliary and the script does
    // not shift — see the stub's rule 1.
    runs: [
      {
        mode: 'edit',
        orchestration: 'duo',
        prompt: 'Read DateHelper.java and tell me what it does.',
        steps: [
          { calls: [{ tool: 'read_file', args: { path: DATE_HELPER } }] },
          { calls: [{ tool: 'grep', args: { pattern: 'ISO8601', path: 'app/src/main/java' } }] },
          { text: 'DateHelper formats and parses the app date formats.' },
        ],
        cards: [],
      },
    ],
  },
  {
    n: 17,
    title: 'A run that ends with an unfinished plan says so',
    // D49at CLAUSE 5, the half that had no witness: "a run that ends with
    // unfinished plan steps says so". The note exists (`unfinishedPlanNote`,
    // D49as) and nothing had ever exercised it end to end — the same shape of
    // gap as the observer clause.
    //
    // The model writes a three-step plan, completes one, and then simply stops.
    // The closing line must say two of three are unfinished: a run that ends
    // mid-plan and reports only "done" is the fault this exists for. Test 7's
    // fourteen-minute run that completed zero steps is the real case behind it.
    runs: [
      {
        mode: 'edit',
        prompt: 'Do the three things, then stop.',
        steps: [
          {
            calls: [
              {
                tool: 'todo_write',
                args: {
                  todos: [
                    { content: 'Read the file', status: 'completed' },
                    { content: 'Fix the formatter', status: 'in_progress' },
                    { content: 'Add a test', status: 'pending' },
                  ],
                },
              },
            ],
          },
          { calls: [{ tool: 'read_file', args: { path: DATE_HELPER } }] },
          { text: 'I stopped before finishing.' },
        ],
        cards: [],
      },
    ],
  },
  {
    n: 18,
    title: 'Undo puts back what Plato changed — restores, removes, and redoes',
    // D49ax, and the whole feature end to end in a real window: Plato keeps its
    // own copy of what a write REPLACED, and /undo puts it back.
    //
    // Deliberately in `auto`, which is the only mode that proves the copy is
    // taken at the EXECUTOR. The approval-card preview reads the file too, but
    // `auto` builds no card — so a design that captured at the preview would
    // pass in `edit` and store nothing here.
    //
    // Three runs, because the two halves of undo are different actions:
    //   run 1 creates a file  -> undo REMOVES it (there was no before)
    //   run 3 edits a file   -> undo restores the exact bytes
    //   the third /undo      -> puts the edit back, because a restore is a write
    //
    // The refusals are not exercised here: a file the user edited since is
    // refused in `undo.test.ts`, where the hash can be changed deliberately. What
    // only a real window can show is that the copies are taken, the card names
    // the files, and the bytes come back.
    runs: [
      {
        mode: 'auto',
        prompt: 'Create a probe file for the undo test.',
        steps: [
          {
            calls: [
              { tool: 'write_file', args: { path: 'PLATO_UNDO_A.txt', content: 'created by plato\n' } },
            ],
          },
          { text: 'Created it.' },
        ],
        cards: [],
        undoAfter: [{ names: 'PLATO_UNDO_A.txt', gone: 'PLATO_UNDO_A.txt' }],
      },
      {
        mode: 'auto',
        prompt: 'Create the second probe file.',
        steps: [
          {
            calls: [
              { tool: 'write_file', args: { path: 'PLATO_UNDO_B.txt', content: 'version one\n' } },
            ],
          },
          { text: 'Created it.' },
        ],
        cards: [],
      },
      {
        mode: 'auto',
        prompt: 'Change the second probe file.',
        steps: [
          {
            calls: [
              {
                tool: 'apply_diff',
                args: { path: 'PLATO_UNDO_B.txt', diffs: [{ search: 'version one', replace: 'version two' }] },
              },
            ],
          },
          { text: 'Changed it.' },
        ],
        cards: [],
        undoAfter: [
          { names: 'PLATO_UNDO_B.txt', text: { 'PLATO_UNDO_B.txt': 'version one\n' } },
          // The last request is now the redo the previous undo wrote, so undoing
          // it puts the edit back. This is the claim that redo is free: it was
          // never built, it is what the mechanism already does.
          { names: 'PLATO_UNDO_B.txt', text: { 'PLATO_UNDO_B.txt': 'version two\n' } },
        ],
      },
    ],
  },
  {
    n: 19,
    title: 'Undo refuses a file the user edited, puts back the rest, and names the commands',
    // D49az. This is the case D49ax was really about: Kilo Code's bug was
    // "Restore checkpoint removed all the changes of mine also", and the answer
    // is that a file the user has touched since is REFUSED rather than
    // overwritten.
    //
    // The user's edit is made by the HARNESS, from outside Plato, between the
    // run and the /undo — because that is precisely what the fingerprint exists
    // to notice, and no scripted model can produce it.
    //
    // Two files in one request so both halves are visible at once: one that CAN
    // be put back and one that cannot, on the same card, before the click. And a
    // shell command in the same request, because the report has to NAME the
    // commands undo cannot cover — the founder rejected a draft that said
    // "changes made by commands Plato ran are not affected" without naming one.
    runs: [
      {
        mode: 'auto',
        prompt: 'Change two files and run a command.',
        steps: [
          {
            calls: [
              { tool: 'write_file', args: { path: 'PLATO_UNDO_C.txt', content: 'plato made c\n' } },
              { tool: 'shell', args: { command: 'echo plato-undo-probe' } },
              { tool: 'write_file', args: { path: 'PLATO_UNDO_D.txt', content: 'plato made d\n' } },
            ],
          },
          { text: 'Done both.' },
        ],
        cards: [],
        undoAfter: [
          {
            names: 'PLATO_UNDO_C.txt',
            refuses: 'PLATO_UNDO_D.txt',
            card: true,
            // The user's own edit, written after Plato's, from outside Plato.
            before: { 'PLATO_UNDO_D.txt': 'plato made d\nthe user added this line\n' },
            gone: 'PLATO_UNDO_C.txt',
            text: { 'PLATO_UNDO_D.txt': 'plato made d\nthe user added this line\n' },
            report: ['echo plato-undo-probe', 'cannot undo those'],
          },
        ],
      },
    ],
  },
  {
    n: 20,
    title: 'Undo refuses the only file, and says so without drawing a card',
    // D49az. The other side of case 19: when NOTHING can be put back, there is no
    // card to draw — a button whose only outcome is a refusal is worse than a
    // sentence. The file must also survive untouched, which is the actual safety
    // claim: a refusal that still wrote something would be indistinguishable from
    // success on screen.
    runs: [
      {
        mode: 'auto',
        prompt: 'Create the file for the refusal test.',
        steps: [
          {
            calls: [
              { tool: 'write_file', args: { path: 'PLATO_UNDO_E.txt', content: 'version one\n' } },
            ],
          },
          { text: 'Created it.' },
        ],
        cards: [],
      },
      {
        mode: 'auto',
        prompt: 'Change it.',
        steps: [
          {
            calls: [
              {
                tool: 'apply_diff',
                args: { path: 'PLATO_UNDO_E.txt', diffs: [{ search: 'version one', replace: 'version two' }] },
              },
            ],
          },
          { text: 'Changed it.' },
        ],
        cards: [],
        undoAfter: [
          {
            card: false,
            before: { 'PLATO_UNDO_E.txt': 'version two\nthe user added this line\n' },
            text: { 'PLATO_UNDO_E.txt': 'version two\nthe user added this line\n' },
            report: ['you changed it after Plato did'],
          },
        ],
      },
    ],
  },
];
