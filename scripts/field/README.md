# Field tests — the live checks, driven automatically

`tmp/plato-field-test.html` lists nine things that unit tests and the render
suites can prove in pieces but that had never been exercised in a real run. It
was written for a human to run by hand in VS Code. This directory runs them
without a human. **Cases 10–17 were added here** — the cancel path, the editor's
diagnostics, the three faces of the repetition bound, and the three acceptance
clauses that had no witness at all — **18–21 with the undo and masking work**
(what undo puts back, what it refuses, and the masked read round trip), **and
22–23 with the two halves of D49bc** (a protected file Plato cannot mask is
offered once, and a command that reaches a protected file indirectly prints no
value) — see the table below.

**This directory is also the M4 acceptance test's machine.** The seven clauses
(D49at) are executed by `acceptance.mjs`, which maps each clause onto the cases
that witness it and judges them independently from the transcripts:

```
node scripts/field/acceptance.mjs --run        # run the cases, then judge the clauses
node scripts/field/acceptance.mjs              # judge the last run only
```

```
node scripts/field/run-field.mjs              # all of them
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
| 1 secret guard | no card at all | **run 1** the shell is refused · **run 2** the read completes and the model is handed a MASKED view (D49bb) |
| 2 plan mode | no card at all | reads allowed, the build `denied` |
| 3 edit mode | one card, for the build | a card, then an approved run |
| 4 write refused / asks | plan: no card · edit: card | `denied` · user `declined` |
| 5 multi-file patch | exactly one card + the session notice | one card, two calls, second not gated |
| 6 question card | tabs, boxes vs circles, ticks survive a tab round-trip | `ask_user` not gated, answer delivered |
| 7 plan card | exactly one step in progress | plan writes not gated |
| 8 read/run memory | the log names the files | the recap turn makes 0 tool calls |
| 9 auto | no card anywhere | the edit landed — and it is on disk |
| 10 cancel | the card is gone, and the run says "cancelled" | `run-completed` carries `reason: cancelled` |
| 11 editor diagnostics | the chat is back in front afterwards | a `diagnostics:` notice naming one of three states |
| 12 repetition bound | the card names the repeated call, says what to do, and Stop ends the run | `run-completed` carries `reason: stuck` |
| 15 egress asks | the card shows the exact URL that would be sent (denied, so nothing is) | a `web_fetch` card, then a decline — and no fetch |
| 16 observer live (Duo) | the closing line reports `observer N checks` | the read work ran under a team; no intervention required |
| 17 unfinished plan | the closing line says `N of M plan steps unfinished` | the plan was written and the run completed |
| 13 keep going | the card is answered "keep going" and the run finishes | `run-completed` carries `reason: complete` |
| 14 no-progress | turns that all FAIL raise the card too | a `turns in a row have failed` notice, then `reason: stuck` |
| 18 undo | the card names the files, and `/undo` is the only way in | a write completed with no card (`auto`) |
| 19 undo refuses an edited file | the card names the refused file and says WHY, before the click; the other file is gone from the tree | the `shell` call the report names really ran; two writes completed |
| 20 undo refuses the only file | **no card at all**; the file survives with the user's line intact | the edit that had to be refused completed |
| 21 masked read + write | no card (`auto`) | the protected file reads and the write completes — and the disk still holds the real value (D49bb) |
| 22 unmaskable file | the reveal card states the cost, and it is drawn **once** in `auto` | both reads complete, and the second raises no card (D49bc) |
| 23 indirect secret | no card (`auto`) | the `cat .en*` call RUNS — so the masking is the stub's log, not the transcript (D49bc) |

**Case 12 scripts a stuck model, and the script IS the evidence.** Five turns of
the same `todo_write` call with the same arguments — byte-identical, every time.
`todo_write` is chosen because it repeats identically, touches nothing on disk
and needs no approval, so the case measures the guard and not a tool or a gate.
**The count is the point:** three identical turns earn the model a nudge and
five is where the user is asked, so a four-turn script would test only the
nudge. The step AFTER the repeats is deliberately there — without it a build
with no bound at all would end the run normally on the model's own next step and
the case would pass while testing nothing, which is the toothless-check mistake
case 10 was fixed for.

**Cases 12, 13 and 14 are the same bound seen from three sides, and each covers
something the others structurally cannot.** 12 proves the run STOPS and that the
card names the call. **13 proves the card is a question and not a stop** — the
driver answers "keep going" AND types what to do differently, and the run must
then finish normally; a product that raised the card and stopped anyway would
look identical on screen. **14 proves the SECOND trigger**, which repetition
detection cannot see by construction: its five calls are deliberately *different*
read paths, so nothing repeats and only "turns where nothing succeeded" can fire.

13 and 14 exist because the first pass had no case for either — the keep-going
button had only ever been clicked in the render suite, which renders a fixture
and never touches the host, and the no-progress trigger had unit tests and no
run. **The screen assertions for these cases read the REAL copy**, which no other
suite does: core pins the wording and the render suite renders a fixture, so case
12 is the only place the two are proved to meet.

**Case 18 is the only case that drives a slash command, and it is in `auto` on
purpose.** `/undo` is not a run — it writes no transcript — so this case's
evidence is split deliberately: the transcript can only say there was something
TO undo (a write completed, with no card in front of it), and **whether the bytes
actually came back is asserted on disk**, by the spec, which is the only witness
that can see it. Three runs in one case, because the halves of undo are different
actions: **run 1 creates a file and undo REMOVES it** (a created file has no
before, so removing it is what undoing means); **run 3 edits a file and undo puts
the exact bytes back**; and the second `/undo` after run 3 **undoes the undo**,
which is the claim that redo was never built — it is what the mechanism already
does, because a restore is itself a write with a before.

`auto` is not incidental. The approval-card preview also reads the file, and in
`auto` **no preview is built** — so a design that captured the old bytes at the
preview would store nothing here and the case would find nothing to put back.
That is the failure this case exists to catch, and it is invisible in `edit` and
`plan`, where a card is drawn.

The probe files are created by THIS harness, so they are removed in the suite's
`after` hook rather than at the end of the case — a case that fails half way
through still leaves the demo repo as it found it. One of them is meant to be
deleted by the feature under test, which is exactly the file a failed run would
leave lying around.

**Cases 19 and 20 are the refusal, and they are the reason the feature is safe.**
D49ax's whole argument is that a file the user has edited since is REFUSED rather
than overwritten — Kilo Code's reported bug, *"Restore checkpoint removed all the
changes of mine also"*. A unit test can pin the hash comparison; only a real
window can show that the refusal is **visible before the click** and that the
file is genuinely left alone afterwards. So the user's edit is written by the
HARNESS, between the run and the `/undo`, because nothing a scripted model can do
produces it.

They are two cases because the two outcomes are different products:

- **19** — two files, one edited by the user. The card must show **both**: the
  file that will be put back, and the one that will not, with the reason, before
  anything is written. A refusal that arrives after the click, or as a silent
  omission, is Kilo's bug wearing a nicer coat. It also carries a `shell` call in
  the same request, because the report has to **name the commands undo cannot
  cover** — the founder rejected a draft that said commands "are not affected"
  and named none of them.
- **20** — one file, edited by the user, so nothing at all can be put back. There
  must be **no card**: a button whose only outcome is a refusal is worse than a
  sentence. And the file must survive byte for byte, which is the actual safety
  claim — a refusal that still wrote something would be indistinguishable from
  success on screen.

**Case 19's first run FAILED, and the failure was worth more than the pass.** The
report read *"Partly undone. Plato put back 1 file of the 1 it was going to
change."* — the wrong verb for a file that had just been REMOVED from the tree,
and a denominator counting only the files it meant to act on, so a request that
also refused one read as a complete success under a headline saying "partly". No
assertion caught it and no test would have: every substring it checked was
present. **A screenshot caught it**, which is the whole reason the undo block
now takes one with the card up and one with the report on screen. The fix is in
`undoCopy.ts` and pinned by `undoCopy.test.ts`.

**Case 11 needs the editor, so it touches the screen.** It writes a deliberately
broken TypeScript file and checks that what the editor says reaches the model.
The file carries **two** errors on purpose — a syntax error any analyser catches,
and a type error only a full one does — so the notice's count says which kind of
analysis ran. It is the only case that can move the user's editor, briefly; see
the section above for why that is unavoidable here.

**Why case 10 scripts work AFTER the question.** It stops a run that has a
question on screen, and the two steps below that question are there so a run that
was NOT stopped has something left to do. Without them the model's own next step
would end the run, the transcript would say `complete`, and the case could pass on
a product that ignored the Stop button entirely — a check that cannot fail. The
case also refuses to pass if no question card was ever detected, and the driver
treats a DISABLED Stop button as an error rather than a no-op click.

## The acceptance test, executed (D49at)

M4's definition of done is **seven clauses**, and `acceptance.mjs` runs them. It
is not a separate suite: it maps each clause onto the cases that witness it and
judges them, so a clause cannot pass without a case that ran.

**Two witnesses, deliberately.** The spec reports what it saw on **screen**; the
judge recomputes the **transcript** verdict from the JSONL, independently. They
are wrong in different ways — the driver knows what it clicked but can be wrong
about what that meant, the transcript knows what Plato did but cannot see the
screen — so a disagreement is reported rather than averaged away.

**The manifest is the join.** A transcript records its task and its root, never
which case produced it, so a judge over transcripts alone cannot tell whether a
clause's case even ran. `field.test.mjs` writes `tmp/field/last-manifest.json` —
**including when a case fails**, so a failing run still reports which clauses
passed.

**Running it.** `node scripts/field/acceptance.mjs --run` does the whole thing:
it drives `run-field.mjs`, then judges. `--run` inherits the launcher's demo-repo
reset, which is destructive — see the branch-reset trap below.

**What the exercise found, both recorded because a witness that does not exist is
worse than none:**

- **Clause 6 had no witness at all.** D49at listed it as covered by the scripted
  cases and no case touched `web_fetch`. Case 15 is that witness.
- **Clause 6 as written was also STALE.** It required `web_fetch` to ask "in every
  mode including `auto`", but **D49ak amended D49p on 2026-09-24 so that `auto`
  fetches without asking** — the founder's own decision. A clause describing the
  pre-amendment product cannot be passed or failed, which is the exact defect
  D49at was written to fix. The clause is now stated as what the product does, and
  its two halves name two witnesses: the card in `edit` (case 15, a real window)
  and the `auto` policy (`modes.test.ts`, where that decision lives).
- **Clause 3's original third witness is subsumed, not separate.** "The model's log
  showing the content was never in a request" is implied by "no read ran" — the
  guard refuses by NAME before anything is opened. **The content half is now a
  direct test, and it uses a file the HARNESS seeds with a deliberately FAKE
  marker** (cases 21–23): a test that reads a real credential to prove it does not
  read a real credential has already lost the argument. **Clause 3 has been
  restated twice** — by D49bb (the file reads, the VALUE is what never arrives)
  and by D49bc (the values arrive when the user answers a card that states the
  cost). A clause that still said *never* would pass by forbidding the card that
  replaced the refusal.
- **The stuck cases' screen notes were not fatal.** `STUCK:` and `GUIDANCE:` were
  missing from the spec's failure regex, so "no stuck card was ever detected" —
  the check written to give cases 12–14 their teeth — could not fail a case. Found
  while wiring the acceptance clauses. **A note is not a check.**

**Falsified.** Blanking `unfinishedPlanNote` in core makes case 17 fail with
*"the run ended with 2 of 3 plan steps unfinished and did not say so"*, the judge
reports **clause 5 FAIL** naming that case, and the command exits 1 — which is the
property the old unfalsifiable test never had.

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

## A language server only reports on a file the editor is SHOWING

**Established by experiment after two failed attempts, and it is the reason case
11's feature needs to touch the screen at all:**

| What was done to a deliberately broken `.ts` file | Diagnostics |
|---|---|
| written to disk only | none |
| `openTextDocument` (loaded, not shown) — waited 5 s | none |
| `openTextDocument` + a valid `tsconfig.json` | none |
| a broken `.json` instead, opened not shown | none |
| **`showTextDocument` (preview, `preserveFocus`)** | **2 — a syntax error and a type error** |

So it is not the language, not the project, and not the API (this build's bundled
typings still carry `getDiagnostics`/`onDidChangeDiagnostics` unchanged). **A
merely-open document is not analysed here; a visible one is.** Measured while
`typescript-language-features` was *active* with seven `tsserver` processes
running, so "the server was not running" is ruled out.

**Two consequences to hold on to.**

1. **The feature's quiet route is tried FIRST and only then the visible one**, so
   a window whose servers answer on open — mainstream VS Code is expected to —
   never has its editor disturbed for nothing. Trying the visible route first
   would make the flash the normal case.
2. **A file left in front breaks this harness.** The driver drives the Plato chat
   webview, and a backgrounded webview is unreachable. A first attempt restored
   the previously-active *text editor*, which is the wrong signal when the user
   was looking at the chat: `activeTextEditor` can still answer with a stale text
   editor, a file went back in front, and **every case after that one failed to
   find the chat**. The fix names what must be restored — the host's panel is
   re-revealed — rather than closing a tab and hoping VS Code picks the right
   successor. The full suite is what caught it; case 11 passing alone did not.

`tmp/diagprobe/` holds the throwaway extension that answered all of this in about
a minute. It is scratch — `tmp/` is gitignored — and the lesson is the method:
**before building on what an environment does, write the smallest thing that
measures it.** Two harness runs were spent guessing first.

### Driving a page the field cases do not cover

D49ay's history page — compress aged transcripts, delete one run, delete all —
is reached by no field case, so it was verified with the same throwaway method:
a probe **spec** run through `ExTester` against a **scratch workspace**, never
the demo repo. Three things about the shape are worth reusing.

- **Use a scratch workspace, and compute its project key the same way the
  extension does** — `sha1(workspacePath).slice(0, 8)`. That gives the probe its
  own `~/.plato/runs/<key>/`, so seeding a transcript is safe and **delete-all
  can only ever reach files the probe created**. Pointing it at the demo repo
  would have put the founder's real run history behind a "delete all" button.
- **The key must be derived from the path the window ACTUALLY opened.** The first
  version hardcoded one path while the runner created the workspace somewhere
  else, so the seeds went to a directory the extension never looked in and the
  sweep correctly compressed nothing. The failure reads as "the feature is
  broken" and is entirely the harness's.
- **`new WebView()` after the panel is open, not before.** Constructed first, the
  object does not match the panel that appears and `switchToFrame()` times out
  with *"webview iframe was not found"* — the same error a genuinely unopened
  panel gives.

The probe itself is deleted; the spec that ran it lived in this directory only
because `vscode-extension-tester` resolves from here.

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
- **A secret's masking is judged on the stub's log, not the transcript
  (D49bb/D49bc).** Tool RESULTS are deliberately not written to a transcript, so
  the JSONL can show that a call ran and cannot show what it returned. Cases 21,
  22 and 23 therefore assert the value-level claims on the scripted model's own
  log (`expectModelTold`, `expectModelNotTold`, the `masked` flag) and keep the
  transcript rules to what the transcript can see: the call ran, nothing was
  refused, the run did not fail. **Do not "fix" this by writing results into the
  transcript** — the record is not a secret-bearing file, and that is the point.
- **`/undo` is not a run, so it has no transcript.** No case can witness an undo
  in the transcript, because there is nothing there to witness: the command
  writes no run. Case 18 therefore asserts on DISK, which is the stronger witness
  anyway — "the bytes came back" cannot be true of a transcript.
- **A multi-run case's printed notes accumulate.** `notes` is declared once per
  CASE, not per run, so run 2's output repeats run 1's notes. Nothing is measured
  wrongly — each run's own checks run against its own events, and a real failure
  still fails the case — but the log reads as though run 2 did what run 1 did.
  Seen while writing case 18, whose undo notes are per-run and so repeat visibly.
  Not changed here: it is shared by cases 4, 5 and 8, and moving the declaration
  into the loop changes reported output for all of them, which wants its own pass.

## Traps

Every one of these cost time to find. They are here because they are the kind of
fault that reports as something else.

**A card with a new class is INVISIBLE to the driver until `cardKind` knows it
(D49bc).** `waitRunEnd` answers a question card, a stuck card and an approval
card, and DENIES anything else it recognises. A card whose class is not in
`cardKind` matches nothing, so the harness sees no card, does not answer, and the
run parks until the 180-second timeout — reported as "run never completed", which
names neither the card nor the question. Adding a card means adding it to
`cardKind` AND giving `waitRunEnd` a branch for it. **An unrecognised card is a
hang, not a failure.**

**The stub answers every `calls` entry in ONE turn.** So a case that scripts two
reads of the same file does not get two turns to answer a card in — both calls
run back to back inside one turn. That is still the right shape for case 22: the
session memory lives in the shell, so the second call never raises a card, and
`askOnce: 1` holds within a single turn as well as across turns.

**A seeded file goes on the RUN, not the case (D49bb).** The per-run checks all
read `run.<field>` — `mode`, `cards`, `prompt` — so a `seed` written one level up
on the case object is never seen. It fails as `ENOENT` from the round-trip read
at the END of the case, which reads like a product bug that deleted a file and is
really a field on the wrong object. Same family as the `run.question` slip
recorded below.

**A tool result's head is a window, and a placeholder can fall outside it
(D49bb).** Case 1 reads `local.properties`, which is ten comment lines before its
one assignment. The stub truncated tool results to 400 characters, so the masked
line was past the window and a masked read was indistinguishable from an unmasked
one — the check passed for the wrong reason and then failed once the window
moved. The stub now stores a `masked` boolean alongside the head, and the
assertion asks the boolean. **When a check searches a truncated string, ask what
falls outside it.**

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

**The harness bundles BUILT core, so a core change is invisible until `tsc -b` runs.** The bundle
resolves `@applivity/plato-core` through that package's `main`, which is **`dist/src/index.js`** — so
editing `packages/core/src/…` changes nothing the extension actually runs until it is compiled. The
launcher rebuilt the bundle and the VSIX before every run and called that fresh, which was true of
the shell and **false of core**: a core change could be tested against stale code, and the run would
look exactly like success. **Found by a falsification that refused to fail** — the D49aw guard was
neutered in `loop.ts`, the case was expected to break, and it passed. `run-field.mjs` now runs
`tsc -b` first. **Never remove that step**, and if you package a VSIX by hand, compile before you
package. The general rule is the same one the diagnostics work learned: *an experiment that comes
back green is not evidence until you know it could have come back red.*

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

**The `git checkout --` on a `plato-field-test-*` branch destroys HAND EDITS to
those two files, silently.** The guard that protects a founder's work — refusing
to start on a dirty tree — **does not run on that branch**; the reset does. So if
real work is ever done on the harness branch, an edit to `DateHelper.java` or
`SubmissionsViewModel.java` is gone at the next run with nothing said. Seen for
real on 2026-09-25: the trial-repo edit the handoff recorded for `DateHelper.java`
was no longer in the tree, and only the harness's own scratch edits were. **Two
ways out, and one of them should be taken:** teach the launcher to stash those
files instead of discarding them, or keep the harness on its own branch and the
trial work off it. Until one is chosen, **check `git diff` in the demo repo before
a run, not after.**

**One failed case can leave Settings open and take out every case after it.** A
full acceptance run reported **"M4 is NOT met" and was wrong**. Case 17 threw a
`StaleElementReferenceError` inside `setOrchestration` — the Settings panel
repaints as it settles, replacing the mode card's node between being located and
being clicked — so its `#sback` click never ran and **Settings stayed on screen**.
Settings is a full-surface panel in the webview, so it covers the New Chat
button, and cases 18, 19 and 20 each then failed at the FIRST line of their
bodies with `ElementNotInteractableError`: three cases that had never started,
reported as failures, under a clause that is actually met.

Two fixes, and neither one weakens an assertion. `setOrchestration` now retries
the **locate and the click together** for a stale or un-clickable node (the chip
label read afterwards is still the only thing that decides the mode took).
`newChat` calls `settleUi()` first, which closes Settings if a previous case left
it open and sends Escape for any popover. **The remedy is deliberately not in
`clickElement`**: that fallback fires only on `intercepted` on purpose, and
swallowing `not interactable` would let a genuinely disabled New Chat button pass
as a success. Cleaning up after a failure is not the same as hiding one.

**The recovery was then PROVEN, not merely written, and proving it needed its own
probe.** When the suite was re-run after the fix, both repairs stayed silent — the
flake simply did not recur — so the repair itself never ran. A green run says
nothing about code that did not execute, which is this directory's own rule about
experiments coming back green. A throwaway probe therefore put the failure in
place ON PURPOSE, through the same throwaway-probe method as the history page:
open Settings, **prove it is open** (without that the probe proves nothing, since
a closed Settings is where it starts), prove New Chat is unreachable, call
`settleUi()`, prove both are fixed. It reported `4/4` — and **neutering the
Settings branch made it `2/4`**, which is what makes the four meaningful. The
probe is deleted; this paragraph is what remains of it.

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
