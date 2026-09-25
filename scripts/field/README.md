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

## Two traps worth knowing

**The editor's environment leaks.** Started from inside VS Code, the process
inherits `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary start as
plain Node. The VS Code under test then dies instantly and ChromeDriver reports
it as `session not created: Chrome instance exited` — an error that says nothing
about the cause. `run-field.mjs` deletes that variable and the `VSCODE_*` ones
before launching. Never remove that block.

**The demo repo is the founder's real project.** Tests 4, 5 and 9 write files by
design, and the repo holds `keystore.properties` and `local.properties`. So the
launcher refuses to start if the two target files already carry uncommitted
edits, puts the repo on a dated `plato-field-test-*` branch, and leaves the diff
standing at the end. It never commits and never pushes. Test 1 uses a name that
does not exist (`notes.keystore`) precisely so the guard can be tested without
any secret being at risk — never change that to a real filename.
