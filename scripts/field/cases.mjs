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
];
