# Field tests — the nine live checks, driven automatically

`tmp/plato-field-test.html` lists nine things that unit tests and the render
suites can prove in pieces but that had never been exercised in a real run. It
was written for a human to run by hand in VS Code. This directory runs them
without a human.

```
node scripts/field/run-field.mjs              # all nine
FIELD_CASES=1,5 node scripts/field/run-field.mjs   # just those
node scripts/field/verdict.mjs --list         # what runs exist to judge
node scripts/field/verdict.mjs --case 5 --last 1   # judge a run from its transcript
```

## Why there are three pieces

**The model is scripted, not real — `stub-model.mjs`.** These tests ask whether
Plato gates, refuses, remembers and reports correctly. None of them asks whether
a model writes good Java. So the model is replaced by a local server that plays
a canned script of turns: no API key, no network, no cost, and — the point — no
variance. A failure is reproducible, and the failure is Plato's.

One rule in there is load-bearing: a call carrying `tools` consumes a script
step, a call WITHOUT tools does not. Plato makes auxiliary calls (the
conversation-title call), and if those consumed steps the script would silently
shift and every later assertion would be measuring the wrong turn.

**The transcript votes too — `verdict.mjs`.** Every run writes JSONL to
`~/.plato/runs/<project>/`. This reads it and decides pass or fail on its own,
using nothing the UI driver reported. That matters because the two witnesses are
wrong in different ways: the driver knows what it clicked but can be wrong about
what that meant, and the transcript knows what Plato did but cannot see the
screen. When they disagree, the disagreement is the finding.

It is also the answer to the field-test page's own promise — "no card appeared
is verifiable from the file rather than from memory". It works on a run you did
by hand, too.

**A real VS Code, driven like a person — `driver.mjs`, `field.test.mjs`.**
Selenium and ChromeDriver drive an actual VS Code window with the extension
installed: typing into the composer, switching mode through the real picker,
clicking Allow once / Deny, ticking question checkboxes and jumping tabs. That
is what "like a human" buys, and it is why a window opens and takes focus.

Two rules keep the driver honest:

- **A run ends when the transcript says so** (a `run-completed` line), never
  when the screen looks settled. Everything read from the DOM afterwards
  therefore belongs to a finished run.
- **An unexpected approval card never blocks anything.** It is recorded,
  denied, and the run is allowed to finish so the transcript can be judged. A
  harness that hangs on a surprise reports nothing at all.

## What each case is checked by

| Case | Screen | Transcript |
|---|---|---|
| 1 secret guard | no card at all | `denied`, and no card raised |
| 2 plan mode | no card at all | reads allowed, the build `denied` |
| 3 edit mode | one card, for the build | a card, then an approved run |
| 4 write refused / asks | plan: no card · edit: card | `denied` · user `declined` |
| 5 multi-file patch | exactly one card + the session notice | one card, two calls, second not gated |
| 6 question card | tabs, boxes vs circles, ticks survive a tab round-trip | `ask_user` not gated, answer delivered |
| 7 plan card | exactly one step in progress | plan writes not gated |
| 8 read/run memory | the log names the files | the recap turn makes 0 tool calls |
| 9 auto | no card anywhere | the edit landed — and it is on disk |

## Dependencies

**Install once, in this directory:**

```
cd scripts/field && pnpm install --ignore-workspace
```

This directory has its own `package.json`, and it is **deliberately not a member
of the pnpm workspace** (`pnpm-workspace.yaml` lists only `packages/*`). The
reason is the four dependencies the harness needs — Selenium, ChromeDriver and
`vscode-extension-tester`, plus mocha — are browser automation the *product*
never uses. In the root manifest they were downloaded by every `pnpm install`,
including any future CI, to run a suite nothing else invokes. The `--ignore-workspace`
flag is what makes pnpm install them here instead of resolving up to the
workspace root and ignoring this manifest entirely.

The cost is the extra command, so `run-field.mjs` checks for the dependencies
**first** and prints that line if they are missing — before it bundles anything
and before it touches the demo repo.

## Honest boundaries

- **Model judgement is out of scope.** With a scripted model, test 6's
  "the model chooses multi-select" and test 7's "is the plan any good" become
  "does the card behave correctly". The visual claims hold; the judgement half
  cannot be automated deterministically.
- **Test 8 does not force a compaction.** The page suggests forcing one so the
  log has to survive it. `/compact` needs a run in progress, and a scripted
  model has an unknown context window, so the compaction trigger cannot be
  reached deterministically from here. What IS checked is that the log records
  what each tool did and that the recap costs no tool calls.
- **The `vscode` API surface is real here, but the provider is not.** These runs
  prove the webview, the extension host, the gates and the transcript. They do
  not prove a real vendor endpoint — no test touches the network by design.

## Traps

Every one of these cost time to find. They are here because they are the kind of
fault that reports as something else.

**The editor's environment leaks.** Started from inside VS Code, the process
inherits `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary start as plain
Node. The VS Code under test then dies instantly and ChromeDriver reports it as
`session not created: Chrome instance exited` — an error that says nothing about
the cause (the binary also prints `task_name_for_pid: (os/kern) failure (5)`, and
run by hand it reports `--version` as the *Node* version). `run-field.mjs` deletes
that variable and the `VSCODE_*` ones before launching. **Never remove that
block.**

**VS Code's modals are not in the webview.** The "Start a new chat?" confirmation
is the workbench's own, outside the iframe. Unanswered, it blocks every later
click, and the error blames the iframe — which reads like a webview bug.
`driver.newChat()` steps out of the frame to answer it and back in.

**Toasts sit over the composer.** A bottom-right toast covers the send button and
the mode-picker rows, failing as `ElementClickInterceptedError` — again naming the
iframe. Three defences: `extensions.ignoreRecommendations` so the recommendation
never appears; `clearToasts()` before touching that corner (**the helper is
`NotificationsCenter().clearAllNotifications()`** — `Notification().dismissAll()`
does not exist, throws, and is swallowed by the catch, so it silently does
nothing, which is worse than failing); and a JS-dispatch fallback in
`clickElement()` that fires **only** on `intercepted`, never on a missing or
disabled element, so a real regression still fails honestly. Sending uses Enter —
it cannot be intercepted and it is what the placeholder tells a person to do.

**A run with no stored API key never starts.** The host says "Plato needs an API
key" and returns early: no provider call, no transcript error, just a run that
appears to do nothing. The harness sets a throwaway key through the product's own
command first.

**A dependency install can break `pnpm run package`.** It once re-resolved
`@vscode/vsce` and left a dangling symlink in `packages/vscode/node_modules`, so
packaging failed with `Cannot find module …/vsce` while the lockfile was correct
the whole time; `pnpm install` relinks it. After touching the dependency graph,
re-run `pnpm --filter plato-vscode run package` to confirm.

**A re-run needs the demo repo's scratch reset.** Tests 4, 5 and 9 write there, so
a second run would start with the first run's edits. The launcher refuses to start
on a dirty tree and, when already on a `plato-field-test-*` branch, resets the two
target files. That reset is a `git checkout --`, which an auto-mode classifier may
block as destructive — legitimate here (the branch exists only for this, and the
edits are the harness's own), but it needs a human's nod or a permission rule.

**Every step of a scripted scenario except the last must carry a tool call.** A
narration-only step silently ends the run (that is the termination rule, D49ab),
so every later step never executes and the case reports a *product* failure for a
*script* error. This is how cases 3 and 5 first failed.

**The harness must never wait for a person.** Answering a question card was once
opt-in per case, so one omitted handler left the card on screen until the clock
ran out — and against a real model that clock is 900 s, not 180. The driver now
answers any question card the case did not declare and logs it as
`UNEXPECTED question card`, the same rule the approval path already had: an
unexpected card is recorded and dealt with, never allowed to block. **An omission
now costs a wrong answer, never an indefinite wait.**

**An approval list that runs out does not stop approving — it starts DENYING.**
The scripted pass gives each case hand-written decisions, which is right when the
model is scripted. The real pass inherited a fixed six and a real agent asks for
more; the denial read to the model as the user refusing, so it re-planned and
burned fifteen minutes without landing the change. The real pass uses
`plan: 'all'`, which approves every card and still counts it.

**"New Chat" is refused during a run, and silently.** One case overran its clock
by fifteen seconds, so the next case's prompt went into the *still-live*
conversation: no new run, no transcript, and a 900-second timeout reported against
a case that had never started. `newChat` now proves the previous conversation is
gone and fails loudly. **A silent refusal is worse than a loud one.**

**A named-file assertion against a real model measures instruction-following.**
Asked to comment a call in `SubmissionsViewModel.java`, a real model found it in
`FormatterUtility.formatURL`, put it there, and said why. The write landed and the
gate was absent — everything the case exists to check — but the assertion watched
the other file. The disk check now measures the demo repo's diff as a whole and
prints which files changed.

**Test 1 uses a name that does not exist** (`notes.keystore`) precisely so the
secret guard can be tested without a secret being at risk. **Never change it to a
real filename.**

**The real-model pass is the founder's to run.** The guard blocks an agent from
*executing* a harness whose code reads the credential file, not merely from
copying it. Write the assertions, and have the founder run the one command; tee it
to a log the agent can read (the key is never printed):

```
cd /Users/ai/Desktop/plato
PLATO_FIELD_REAL=1 node scripts/field/run-field.mjs 2>&1 | tee tmp/field/last-run.log
```
