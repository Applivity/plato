# Field test — findings log

A record of what was built to run the nine live field tests autonomously, what
was learned about Plato while doing it, and the traps that will cost the next
agent time. Written to be read cold by someone (or something) who was not here.

Source of the nine tests: `tmp/plato-field-test.html` (untracked, gitignored).
The harness lives in `scripts/field/`; its design is in `README.md` there.

---

## 1. What the harness is

Three layers, each answering a different question.

| Layer | File | Answers |
|---|---|---|
| Scripted model | `stub-model.mjs` | "What did Plato do when the model did *exactly this*?" |
| Transcript verdicts | `verdict.mjs` | "What does the run's own record say happened?" |
| Real VS Code driver | `driver.mjs`, `field.test.mjs` | "What did a person see on screen?" |

`run-field.mjs` is the single entry point: it strips the editor's environment,
puts the demo repo on a dated test branch, bundles and packages the extension
fresh, starts the scripted model, and drives a real VS Code through Selenium.

**Why a scripted model at all:** none of the nine tests asks whether a model
writes good Java. They ask whether Plato gates, refuses, remembers and reports.
Pinning the model's replies removes the only nondeterministic actor, needs no
API key, costs nothing, and makes a failure reproducible.

**Why two witnesses:** the driver knows what it clicked but not what that meant;
the transcript knows what Plato did but not what the screen showed. Where they
disagree, the disagreement is the finding.

---

## 2. Findings about Plato

### F1 — A pre-flight refusal leaves no trace in the transcript

`loop.ts` (~line 773) refuses a call that names a protected file or escapes the
workspace by pushing a `tool_result` to the model and `continue`-ing. It emits
**no bus event**. `transcript.ts` writes bus events only, so the transcript is
completely silent about the refusal.

Consequence: from the transcript alone, *"the secret guard refused the command"*
and *"the model never called a tool"* are indistinguishable. The field-test page
claims a reader "can check independently" that no card appeared and that a call
was refused. The first half is true (no `approval-requested` entry is written);
**the second half is not verifiable from the file.**

The harness works around it honestly: test 1 asserts the absence of a card and
that nothing ran, and checks that the refusal reached the model against the
*scripted model's own record* of the tool result it received. If this record is
ever wanted, the fix is one bus event on that path.

**Status: FIXED (D49aq, 2026-09-25).** The refusal now emits a `tool-event` with
phase `refused` and a reason of `secret` or `containment`. The reason is a fixed
word rather than the refusal sentence, because the sentence can quote the
argument and no argument reaches the transcript (D24c). The run's transcript view
renders it as `shell — refused (protected file)`, covered by the new
`scripts/render/refusal.mjs` suite. **Still true:** a refusal produces no
`approval-requested` entry, so "no card appeared" remains checkable.

### F2 — `find` is not treated as a read-only command

`isReadOnlyShellCommand` (a deliberately conservative allow-list) returns:

```
true   "git log -10 --oneline -- app/x.java"
true   "git status --short"
true   "ls app/src/main/java"
false  "find app/src/main/java -name \"*.java\""
false  "find app/src/main/java -name *.java"
false  "./gradlew assembleDebug"
false  "gradlew assembleDebug"
```

So in `plan` mode a `find` is refused while an `ls` is allowed. The field-test
page says "a `find` or `ls`" — the `ls` half is the one that holds today. This
may be intentional (any wrong `true` in that function is an unapproved write),
but a genuinely read-only search being refused is worth a decision either way.

**Status: FIXED (D49aq, 2026-09-25), and the cause was quoting.** Both `find`
forms above were refused for one reason: every `*` was refused wherever it
appeared. But the command does not run argv-style — the executor hands the whole
string to `/bin/bash -c` — and bash expands a glob only when it is UNQUOTED, so
inside quotes the character reaches `find` as the pattern it is meant to be. The
allowlist now reads the command the way bash reads it: `find … -name "*.java"`
runs, `cat *.properties` (unquoted) still does not, and a double-quoted `$` or
backtick is still refused because those expand even inside double quotes.

**The same fix closed a containment hole nobody had reported.** The workspace
check ran on the raw text, so `ls ".."` produced the token `".."`, whose path
segments are `"..` and `.."` — neither of them `..` — and the command was
**auto-approved and listed the parent directory.** The argument checks now run on
the unquoted tokens, which is what the program actually receives.

`./gradlew assembleDebug` is unchanged and still refused: a build file executes
arbitrary code and cannot be inferred from its text.

### F3 — Test 3 as written writes to the repo, which the page does not admit

The page's "Before you start" says tests 4, 5 and 9 write. Test 3 approves
`./gradlew assembleDebug`, which starts an Android build: minutes of work and
build output written into the repo. The harness substitutes
`./gradlew noSuchTaskFieldTest`, which still starts Gradle and runs the wrapper
(so the card is raised for real execution — the thing under test) but fails in
seconds and writes nothing.

### F7 — the question card was never detected, and the reason was one wrong property

**Solved. The cause was not a selector, not a frame, and not a click.**

The card's markup, for the record: the heading (`div.card h3`) reads **"Plato has
a question"** or **"Plato has a few questions"**; the body is `div.q-form`; each
question's options are `div.q-option` rows carrying a cosmetic `div.q-check`
(multi-select) or `div.q-radio` (single); picking one adds a `selected` class to
the row. Navigation is a **"Next →"** button that becomes **"Submit answers"**
only on the last question, and it is **disabled until that question has an
answer**. There is no `<input>` anywhere in this card.

Three attempts, and the first two were both wrong in the same way — looking for
the fault in the wrong layer:

1. **Attempt one** assumed real `<input type="checkbox">` elements, so it clicked
   nothing, in BOTH suites. Worse, scripted case 6 reported **PASS anyway**,
   because the tick counts were printed *notes* rather than assertions. **A check
   that cannot fail is not a check**, and this one had never once been exercised.
2. **Attempt two** rewrote the selectors correctly against the markup above and
   promoted the interaction to a failure. Case 6 still passed on the transcript
   verdict alone, the handler never fired, and the added diagnostic printed
   **nothing** — it was written to print only when it found *some* card, so "no
   card" and "the diagnostic never ran" were the same output. A diagnostic that
   cannot tell its own two failure modes apart is not a diagnostic.
3. **Attempt three found it, and it was in the harness, not the UI.** The
   scenario's question lives on the **run** object (`cases.mjs`: `runs[0].question`),
   but the spec read it off the **case** (`c.question`). It was therefore always
   `undefined`, so the handler was never passed to the waiter, so nothing ever
   looked for the card. No selector, frame or click was involved at any point.

**How it was finally pinned in a single run.** The diagnostic was changed to
speak when it finds *nothing*, and the detection was routed through the one
lookup that provably works (`div.card h3`, the same one that finds approval
cards — asking it what KIND of card it found). With the property fixed, one run
printed the whole story:

```
watch: 0 card(s) — none                 <- the diagnostic now speaks when it sees nothing
watch: 1 card(s) — Plato has a few questions
question card is open
picked 2 option(s) of 4 offered
picks: 2 before the tab round trip, 2 after
case 6 run 1 (plan): PASS transcript, 0 card(s)     <- 9.4s, was a 180s hang
```

The screenshot taken while the card was live (`tmp/field/shots/case-6-plan-question.png`)
shows the heading, tabs 1/2/3, and two options ticked with the accent box — the
driver's clicks landed, visually confirmed.

**Two checks were added with teeth, and both are the same lesson:**

- `QUESTION:` — a case that expects a question card now FAILS if no card was ever
  handled. Every assertion about the card used to live *inside* the handler for
  it, so a card that was never detected asserted nothing and the case still said
  PASS. The first version of this new check had the same wrong property
  (`c.question`) and would never have fired either.
- `MEMORY:` — case 8 declared `expectZeroToolCalls: true` and **no code read it**,
  so its whole point (a recap is answered from what the run already knows, not
  from re-reading the files) was asserted nowhere. Same family: a declared
  expectation that nothing consumed.

**The generalisable lesson, which is why this finding is worth more than the bug:**
a handler that never fires is indistinguishable from a feature that never
appeared. Both attempts at this finding assumed the second and went looking in
the UI. The cheap discriminator is a diagnostic that reports absence — and an
assertion that lives *outside* the handler it is testing.

**Falsified, not merely passed.** To prove the new check has teeth, the scenario
was temporarily replaced by a shell command — so the model asks nothing while the
case still expects a card — and the run FAILS exactly where it used to pass:

```
watch: 0 card(s) — none
case 6 run 1 (plan): FAIL transcript, 0 card(s)
  QUESTION: no question card was ever detected, so nothing about it was exercised
```

The scenario was then restored from a backup and proved byte-identical to the
file that passed (`diff` clean). The launcher returned exit 1 on the falsified
run and 0 on the real one, so a caller can trust the exit code too.

**Status: FIXED and VERIFIED in a real run** — `case 6 run 1 (plan): PASS
transcript`, 9.4 s, card detected, 2 picks surviving the tab round trip.

### F9 — An unanswered question blocks the run INDEFINITELY (no timeout)

**Corrected. The first version of this finding said the opposite, and it was
wrong.** It claimed the host waits a bounded time and then continues without an
answer. There is no such wait. Two independent reads of the source:

- `askUser` (`extension.ts:1624`) returns a promise that is resolved by exactly
  one thing: a `user-answer` message from the webview. `pendingQuestion` — the
  resolve slot — appears four times in the whole host, and not one of them is a
  timer.
- `loop.ts:852` awaits `opts.askUser(...)` with no signal, and the run's
  `AbortController` is wired to the provider fetch only. Nothing can interrupt
  the wait.

**Direct observation.** Scripted case 6 left its question card on screen,
unanswered. The run did not complete, did not fail, and did not continue — the
harness's own 180-second clock expired first (`run never completed within
180000ms`). That is what a hard block looks like from outside.

The earlier "case 6 finished in 137 seconds" reading, which F9 was built on, was
wrong about what it measured. The likeliest explanation is a *different* run
whose transcript the waiter mistook for this one's — the same
wrong-thing-read-as-the-right-thing that produced F7.

**Why it still matters as a product question**, only now in the opposite
direction: a question card is not a degrable prompt but a hard stop. A user who
walks away leaves an agent — and a provider bill — waiting with no way to time
out. That deserves a decision, and the decision is not the one this finding
originally proposed.

**Status: FIXED (D49aq, 2026-09-25), and the finding's own claim was wrong twice
over.** *There is no provider bill attached.* While the loop awaits an answer it
is not calling the provider — nothing is generating tokens, and the cost of a
waiting question is a stuck run, not money. And the real defect was sharper than
"it waits forever": **Cancel did nothing.** The host's cancel handler unblocked a
waiting *approval* and never a waiting *question*, so with a card on screen the
user had no way to stop the run at all — they had to answer it first.

The fix makes the two symmetric: cancel resolves the open question (one answer
per question asked, so the loop's mapping does not read `undefined`), tells the
webview to take the card away, and then cancels the run as before.

**Not covered by an automated check, and said plainly:** the harness has no
cancel step — the driver can click Allow, Deny and question options, but it never
presses Stop — so this fix rests on the code path being the mirror of the
approval one plus a read of both sides (the Stop button IS enabled while a
question is open: `busy` stays true until `finish()`, and `cx.disabled` is only
set by the click itself). **A second session should add a cancel case**; until
then this is the one of the four fixes with no live evidence.

### F8 — a real model is slow enough to need a bigger clock

Against `deepseek-v4-flash` with reasoning on, a *trivial* plan run took **161
seconds**. The real-mode per-run timeout was 300 s, so every case involving an
edit or a question timed out — and the timeouts were misread as hangs. Raise it
to ~900 s and switch reasoning off for this pass; the tests measure gating, not
reasoning.

### F6 — A replan adds a second plan card; it does not update the first

Documented behaviour, and it makes a naive assertion wrong. After a second
`todo_write`, the log holds **two** `.card.todo-card` elements, each with its own
single in-progress step — so a count of `.todo-item.in_progress` across the whole
log returns 2 and looks like a bug in Plato. It is not: the first card is the
record of what was planned then, the second is the replan. The meaningful count
is the one inside the newest card, and that is how the harness measures it now.

(It is also why the page's "exactly one step marked in progress" needs the
qualifier "per card" — as written it reads as a whole-run invariant.)

### F5 — `approval-requested` does not mean a card was shown

The loop emits `approval-requested` for **every** decision of `ask`. The *host*
then decides whether to draw a card, and in `edit` mode the per-file session
memory short-circuits `approve()` and returns true **without rendering one**.
So a run can carry two `approval-requested` entries while the user saw exactly
one card — which is precisely what test 5 produced, and what the field-test
page's claim ("it records an `approval-requested` entry per card") gets wrong.

Consequences for anyone reading a transcript:

- Zero `approval-requested` entries ⇒ genuinely no card. (Still a sound test.)
- N `approval-requested` entries ⇒ **at most** N cards; possibly fewer.
- To count cards actually shown, you must either look at the screen or count the
  host's notices. There is no bus event that says "a card was displayed".

The harness now asserts the card count from the screen and the tool outcomes
from the file, which is the division the two-witness design was built for.

**Status: FIXED (D49aq, 2026-09-25).** The host now emits an `approval-card`
event naming how each ask was answered — `shown`, `session-memory` or
`session-approval` — so the file can answer the question this finding said it
could not. Seen in a live transcript from the first run after the change, on the
same case that exposed the problem (test 5's two `apply_patch` calls):

```
{"type":"approval-requested","tool":"apply_patch"}
{"type":"approval-card","tool":"apply_patch","via":"shown"}
...
{"type":"approval-requested","tool":"apply_patch"}
{"type":"approval-card","tool":"apply_patch","via":"session-memory"}
```

One ask drew a card and the next did not, and the record now says which is which.
**`approval-requested` keeps its own meaning** — an ask was raised — so the rule
for a reader is unchanged and now complete: zero `approval-requested` means no
ask; a `via: shown` means the user actually saw a card.

### F4 — A run ENDS on the first turn where the model calls no tool

Documented behaviour (D49ab: "the run ends when the model stops calling tools"),
and the single most expensive trap in authoring a scripted scenario. A
narration-only step in the middle of a script silently ends the run, so every
step after it never executes — and the test then reports a *product* failure for
what is really a *script* error.

This is exactly how cases 3 and 5 first failed. Every step except the last must
carry a tool call.

**Status: reviewed, and it is NOT a defect (D49aq, 2026-09-25).** This was
reported as a Plato defect and it is not one. "The run ends when the model stops
calling tools" (D49ab) is the termination rule, and it is the same rule every
comparable agent uses: a turn with text and no tool call is the model saying it
has finished, and continuing past it would mean inventing work. What made it look
like a defect is that it is the single most expensive trap in *authoring a
scenario* — a narration-only step silently ends the run, and every later step
never executes, so the test reports a product failure for a script error. That is
a fact about this harness, and the fix belongs here (every step except the last
must carry a tool call), not in `loop.ts`.

**What is genuinely worth watching, and is not this:** the run can end with
unfinished work and say only "completed" — test 7's fourteen-minute run finished
with **not one step of its own plan ever completed**, and nothing in the product
said so. That is an observability gap, not a termination bug, and it is not fixed
here.

---

## 3. Findings about the harness and this machine

### T1 — `ELECTRON_RUN_AS_NODE=1` breaks the launch with a misleading error

Started from inside VS Code (its extension host, a task, an integrated
terminal), the process inherits `ELECTRON_RUN_AS_NODE=1`. That makes **any**
Electron binary boot as plain Node, so the VS Code under test rejects
ChromeDriver's switches and exits immediately. ChromeDriver reports it as:

```
SessionNotCreatedError: session not created: Chrome instance exited
```

which names nothing relevant. The binary also prints
`task_name_for_pid: (os/kern) failure (5)`, and running it by hand shows
`--version` printing the *Node* version and the VS Code flags reported as
"bad option". Diagnosis took far too long; the fix is at the top of
`run-field.mjs`, which deletes that variable and every `VSCODE_*` one before
launching. **Do not remove that block.**

### T2 — VS Code's modals are not in the webview

The "Start a new chat?" confirmation is VS Code's own modal, so it lives in the
**workbench** DOM, outside the webview iframe. An unanswered modal blocks every
later click, and the resulting error blames the iframe — which reads like a
webview problem. `driver.newChat()` steps out of the frame (`switchBack`) to
answer it, then steps back in.

### T3 — Notification toasts sit over the composer

A toast in the bottom-right corner covers both the send button and the
mode-picker popover (whose rows are wide because they carry explanations). A
click that lands on one fails as `ElementClickInterceptedError`, again naming
the iframe. Three measures, in order of preference:

1. `extensions.ignoreRecommendations: true` in the test instance's settings, so
   the Java-extension-pack recommendation never appears.
2. `clearToasts()` before any interaction in that corner.
   **Note:** the helper is `new NotificationsCenter().clearAllNotifications()`.
   `Notification().dismissAll()` does not exist; calling it throws, is swallowed
   by the `catch`, and silently does nothing — which is worse than failing.
3. A narrow fallback in `clickElement()` that dispatches the click via JS **only**
   on `intercepted`, never on a missing or disabled element, so a real UI
   regression still fails honestly.

Sending uses Enter rather than clicking the send button — both work, Enter
cannot be intercepted, and it is what the placeholder tells a person to do.

### T4 — A run needs a stored API key or it never starts

With no key in SecretStorage the host shows "Plato needs an API key for <conn>"
and **returns early** — no provider call, no error in the transcript, just a run
that appears to do nothing. The harness sets a throwaway key through the
product's own command (`Plato: Set API Key`) before the first run, and the
scripted stub ignores the value. For a real provider the same path is used with
the real key.

### T5 — A dependency install broke `pnpm run package`

Adding the automation dev-dependencies re-resolved `@vscode/vsce` from 3.6.0 to
3.9.2 in the store and left `packages/vscode/node_modules/@vscode/vsce` a
dangling symlink, so `pnpm run package` failed with `Cannot find module …/vsce`.
The lockfile was correct the whole time; `pnpm install` relinked it. Anyone
touching the dependency graph here should run `pnpm install` and then re-run
`pnpm --filter plato-vscode run package` to confirm.

### T6 — Re-running needs the demo repo's scratch files reset

Tests 4, 5 and 9 write to the demo repo, so a second run starts with the first
run's edits still present. The launcher refuses to start on a dirty tree (they
could be the founder's work) and, when already on a `plato-field-test-*` branch,
resets the two target files. Note: that reset is a `git checkout --`, which the
auto-mode classifier may block as a destructive action — it is legitimate here
(the branch exists only for this, and the edits are the harness's own), but it
needs a human's nod or a permission rule.

### T7 — Do not materialize the credential

Copying the key out of the founder's file was blocked as "Credential
Materialization". That is a fair guard. The intended design is that the harness
reads the key from the founder's file **at run time** and types it into Plato's
key dialog; the secret is never copied to a second location, never printed, and
never written into the repo. Rotate the key when the runs are done.

**Addendum, and the sharper version of the rule:** the guard also blocks *running*
a harness whose code reads the credential file — not only copying the key. An
agent that is not permitted to handle credentials can therefore write the
real-model pass but not execute it; the founder runs that one command. Have it
tee to a file the agent CAN read, and the analysis still works:

```
cd /Users/ai/Desktop/plato
PLATO_FIELD_REAL=1 node scripts/field/run-field.mjs 2>&1 | tee tmp/field/last-run.log
```

The log carries no secret (the key is never printed), so it can be read freely
afterwards. This is the honest division: the agent owns the assertions, the
human owns the credential.

### T8 — answering a question was OPT-IN, so one omission waited out the whole clock

The driver answered a question card only when the case passed it a handler.
Nothing enforced that, and the F7 bug *was* that omission: no handler was passed,
so the card sat on screen untouched while the harness polled until its own 180 s
clock ran out and reported `run never completed within 180000ms`. The failure
named a hang, and the cause was a missing argument.

The founder's reaction is the finding: **"the tests still wait for me to answer
the questions — unacceptable, since I cannot baby-sit tests."** He is right, and
the shape of the fault is what matters: the harness's default was to wait for a
person. Any future omission in any case would have done the same, and against a
real model — whose clock is 900 s, not 180 — one omission would have cost fifteen
minutes per case, per run, with a bill attached.

**The fix is structural, not a patch to the one case.** The driver now answers any
question card itself when the case declared no handler — the first option on each
question, then Submit — and logs it loudly as `UNEXPECTED question card — answering
it so the run can finish`. This is the same rule the approval path already had:
an unexpected card is recorded and dealt with, never allowed to block. **An
omission in a case now costs a wrong answer, never an indefinite wait.**

**Falsified, with the case deliberately broken.** The scenario's question handler
was removed while the scripted model still asked. Before the change: the card was
ignored and the run died at 180 s with `run never completed within 180000ms`.
After:

```
UNEXPECTED question card — answering it so the run can finish
picked 1 option(s) of 4 offered
picked 1 option(s) of 3 offered
picked 1 option(s) of 3 offered
case 6 run 1 (plan): PASS transcript               <- 7.7 s
```

The scenario was then restored and proved byte-identical to the file that passes.

**Related, and checked rather than assumed:** every element wait in the driver is
already bounded (10–15 s), so the question card was the only thing that could
consume the whole clock. The run-end poll is bounded by its own timeout, so a
stalled run ends in a named failure instead of sitting there.

**Also changed with it:** the poll diagnostic now speaks only after a run has been
going 15 s. A healthy case finishes in seconds, so a `watch:` line is now a signal
that something is wrong rather than noise printed on every poll.

### T9 — a harness that runs out of approvals starts DENYING

The scripted pass gives each case a hand-written list of decisions (`['allow']`,
`['deny']`), which is correct when the model is scripted: the case knows exactly how
many cards will appear. The real pass inherited that shape with a fixed six, and a
real agent doing real work asks for more. **The failure mode is not "it stops
answering cards" — it is "it denies them."** A denial is a *decision* that changes
the thing under measurement: the model reads it as the user refusing, re-plans, and
stops trying to write. `real 7` burned 915 seconds that way and ended with *"No file
was changed."* Fixed with `plan: 'all'`, which approves every card and still counts
it, so the gating evidence survives.

### T10 — "New Chat" is refused during a run, and that refusal is silent

The host will not start a new chat while a run is active. `newChat` clicked the
button and carried on regardless, so when `real 7` overran its clock by fifteen
seconds, `real 9` sent its prompt into the **still-live** conversation: no new run,
no transcript, and a 900-second timeout reported against a case that had never
started. It even answered a question card left over from the previous case. One slow
case silently corrupted the next. `newChat` now checks that the previous
conversation is really gone and fails with a sentence that says so. **A silent
refusal is worse than a loud one.**

### T11 — a named-file assertion against a real model measures the wrong thing

The scripted pass can assert "case 9 writes `SubmissionsViewModel.java`" because the
scripted model is told to write exactly that. **A real model reads the code and
decides where a change belongs.** Asked in `real 9` for a comment above the URLDecode
call in `SubmissionsViewModel.java`, it found the call in `FormatterUtility.formatURL`,
put the comment there, and explained the choice in its final message. The write
landed and the gate was absent — everything the case exists to check — but the
assertion watched the other file and failed the run.

The `onDisk` check now measures the demo repo's diff as a whole: more changed lines
than before means a write landed, no increase means none did, and the files that
changed are printed so a model choosing elsewhere is visible without being failed.

---

## 4. Fixes — done and proposed

Recorded as you asked, so that "done" and "proposed" are never confused.

**Done and verified in a real run:**

| Fix | Evidence |
|---|---|
| Strip `ELECTRON_RUN_AS_NODE` / `VSCODE_*` before launching (T1) | VS Code launches; was dead on arrival |
| Answer the workbench modal for a new chat (T2) | cases run past `newChat` |
| Clear toasts + narrow JS-click fallback; send with Enter (T3) | 9/9 scripted pass |
| Set the key through the product's own command (T4) | canary reaches the provider |
| Pin the working directory to the repo (T6a) | runs from `$HOME`, was `require('~/package.json')` |
| Derive shot paths from the module, not cwd (T6a) | same |
| Reset the harness's own scratch *before* the dirty check (T6) | a re-run can start at all |
| Tighten four rules that were measuring the wrong signal (F2, F3, F5, F6) | 5/9 → 7/9 → 9/9 |
| Read the question scenario from `run.question`, not `c.question` (F7) | the handler was `undefined`, so it never ran; case 6 now detects and answers the card |
| Route question detection through the same `div.card h3` lookup as approval cards (F7) | `watch: 1 card(s) — Plato has a few questions`, then handled; `case 6 run 1 (plan): PASS` in 9.4 s |
| Diagnose absence, not just presence, in the poll loop (F7) | `watch: 0 card(s) — none` — the line that made one run conclusive after three |
| Make the question interaction an assertion that lives *outside* its handler (F7) | `QUESTION:` fails a case whose card was never handled |
| Assert case 8's declared `expectZeroToolCalls` (dead key) | `MEMORY:` — a recap that re-reads the files now fails |
| Confirm F9 against the source instead of inferring it from timing | no timer exists; and the unanswered card hung to the harness's own 180 s |
| Never wait for a person: answer any question card the case did not declare (T8) | `UNEXPECTED question card — answering it so the run can finish`; the shape that used to die at 180 s now passes in 7.7 s |
| Answer EVERY question card, not just the first (T8) | second real run: `real 6` asked twice and both cards were answered — the second is what the old latch would have waited on forever |
| Approve every card in the real pass, still counting them (T9) | second real run: `real 7` raised **10 cards and allowed all 10**, completed in 354 s with no denial and no re-planning; the same case cost 915 s and failed before |
| Measure the repo's diff, not one named file, to prove an `auto` write landed (T11) | the failing `real 9` had 1 added line in `FormatterUtility.java`; the new check counts it instead of failing on the file the prompt named |
| Capture EVERY question card, not the last one, and judge the run across all of them | `real 6`'s note described one card while the run raised two |
| Report test 7's run scale, and say when no step ever completed | the passing run that took 839 s, raised 45 cards and completed zero steps |
| PROGRESS row + DECISIONS entry for the harness (D48) | `docs/PROGRESS.md` 2026-09-25 row; `docs/DECISIONS.md` D49ap; `docs/HANDOFF.md` verification-loop step 8 |

**Proposed, not done:**

| Proposal | Why it matters |
|---|---|
| Re-run real 6 / 7 / 9 (the real pass has not run since the F7 fix) | real 6 was the case that exposed this; it needs re-measuring |
| Raise the real-mode timeout to 900 s and switch reasoning off (F8) | **implemented** in `settings.real.json` + the real spec; not yet exercised by a run |

**Fixed in Plato, from this file's findings (2026-09-25, D49aq):**

Four of the five Plato defects below are fixed, and the fifth was reviewed and
turned out not to be a defect. Each is recorded in `docs/DECISIONS.md` under
D49aq with its falsification.

| Finding | What changed |
|---|---|
| **F1** — a refusal left no trace | The pre-flight guard now emits a `tool-event` with phase `refused` and a fixed reason code, so the transcript names the guard that stopped the call. It also renders with its reason in the run's transcript view. |
| **F2** — `find` refused in `plan` | The allowlist now reads the command the way bash reads it, so a QUOTED glob is allowed (bash passes it through literally) and an UNQUOTED one is still refused. `find src -name "*.java"` runs; `cat *.properties` still does not. |
| **F5** — `approval-requested` ≠ a card was shown | The host now emits `approval-card` with `via: shown \| session-memory \| session-approval`, which is the only thing in the file that says whether the user saw a card. |
| **F9** — an unanswered question blocks the run | **The claim about the provider bill was wrong** — see the corrected F9 below; no tokens are spent while waiting. The real defect was that **Cancel did nothing** while a question was open, and that is fixed. |
| **F4** — a run ends on the first tool-less turn | **Reviewed, and it is not a defect.** It is the termination rule (D49ab) and the same rule every comparable agent uses: text with no tool call means the model has finished. What made it look like one was a HARNESS trap — a scripted narration step silently ends the run — which is a fact about authoring a scenario, not about Plato. |

**Found while fixing F2, and NOT fixed (a recorded limitation, not a new one):**
`mentionsSecretPath` is a text scan, so a command that splices quotes
(`cat key'store'.properties`) still names no deny-listed file and is not refused
by it — `security/secrets.ts` says so itself. The new tokenizer produces the real
filename `keystore.properties` and could therefore close it in one line, but that
is a change to the secret check for every tool, so it is left as a decision
rather than taken silently.

## 5. Status at the time of writing

- **Result: all nine pass, in ONE run** — `9 passing (1m)`, in a real VS Code,
  driven through the real webview. Verified end to end: the secret guard, the
  mode gates in `plan`/`edit`/`auto`, approval and denial, the session-approval
  notice, the question card's tabs and checkboxes with a surviving tab
  round-trip, the plan card and its replan, the read/run log, and a real edit
  landing on disk.
- **Eight harness defects were found and fixed**, every one a case of the harness
  measuring the wrong thing rather than Plato misbehaving:
  1. three scripts ended early on a narration-only step (F4);
  2. case 2 passed on the wrong evidence — a quoted `find` refused, not the build
     (F2);
  3. the card count was taken from `approval-requested`, not from the screen (F5);
  4. the plan count was taken across every card instead of the newest (F6);
  5. the launcher checked the tree for dirt *before* clearing its own scratch, so
     a re-run could never start (T6);
  6. the question scenario was read off the case instead of the run, so its
     handler was `undefined` and never ran (F7);
  7. the question interaction was a printed note rather than an assertion, so it
     could not fail (F7);
  8. the poll diagnostic could only report a card it HAD found, so "no card" and
     "never looked" were the same output (F7).
- **Two false PASSes were caught**, and both are now impossible: case 2 passed on
  a quoted `find`, and case 6 passed with its card never detected. Two declared
  expectations that no code read (`expectZeroToolCalls`, and the question handler
  itself) are now asserted.
- **The real-model pass is green too** — 5 of 5, 20 minutes, on its third attempt.
  It took three runs and found four harness defects on the way; see section 6. The
  agent still cannot run it itself (T7), so the founder runs that one command.
- **Docs:** PROGRESS 2026-09-25, DECISIONS D49ap, HANDOFF verification-loop step 8.
- **Nothing is committed or pushed.** The demo repo is on branch
  `plato-field-test-<date>`, which is the only place the harness writes.

## 6. The real-model pass — run 2026-09-25, and what it caught

A DeepSeek key (OpenAI-compatible) drives the same prompts with the model
answering freely. **Two runs on 2026-09-25.** The first: 3 passing, 2 failing, 33
minutes — and it found three harness defects. The second, after those fixes:
**4 passing, 1 failing, 12 minutes.** Connection: kind
`openai`, base URL `https://api.deepseek.com/v1`, model `deepseek-v4-flash` with
reasoning off. The agent cannot run this pass itself (T7) — the founder runs one
command and the log it tees to carries no secret.

**What it proved.** `real 6` PASSED and it is the one result the scripted model
can never give: **a real model chose to ask four questions, with multi-select
boxes** (`tabs=4 rows=4 boxes=4`), and the harness answered the card with no human
anywhere. `real 1` (13 s) and `real 2` (32 s) passed too: the model itself chose
to attempt `cat notes.keystore` and was refused, and in `plan` its build command
was refused — the gates hold against a model that was not told what to expect.

**`real 7` failed at the 900 s clock, and the transcript says exactly why.** Seven
shell commands requested, **six allowed, one denied** — and both `apply_diff`
calls **declined**. The harness's approve list was a fixed six, so the seventh
request was denied. **A denial is not a neutral act: it reads to the model as the
user refusing.** It stopped trying to write, went back to reading (26 `read_file`,
10 `grep`), and finished at turn 29 with *"No file was changed. Here is the exact
diff for your review."* The run did complete — **915 seconds after it started,
fifteen seconds after the harness had given up.** The lesson: a harness that runs
out of approvals does not stop approving, it starts denying, and that changes the
thing it is trying to measure.

**`real 9` failed at the 900 s clock with NO transcript at all** — and its failure
screenshot shows `real 7`'s completed run still on screen, carrying `915 s · 50
tool calls · 579.8k tok`, the exact token total of case 7's transcript. The host
refuses "New Chat" while a run is active, so case 7's fifteen-second overrun meant
case 9's prompt went into a **live conversation**: its run never existed, and the
question card it "answered" belonged to the previous case. One slow case silently
corrupted the next.

**Corrected reading, recorded because I got it wrong first.** My first pass at
these logs blamed the question latch for both failures. It was wrong twice over:
`real 7`'s questions were answered (the denials were the cause), and `real 9` never
had a run at all. The latch *was* a real latent bug — see T8 — but it caused
neither failure, and saying otherwise would have sent the next agent to the wrong
file.

### Three fixes, from this pass

| Fix | Why |
|---|---|
| `plan: 'all'` in the real pass — approve every card, still counting them | an exceeded list DENIES, which derails a real run; this pass measures whether gates exist, not whether denial works |
| Answer EVERY question card, not the first (cap 20 as a loop guard) | the old boolean latch meant a run that asked twice left its second card on screen forever (T8) |
| `newChat` now proves the conversation actually reset, and fails loudly if not | a case that overran by seconds made the next case run inside the previous conversation, with no error (T10) |
| Measure the repo, not one named file, to prove an `auto` write landed | a real model put the comment in `FormatterUtility.java` rather than the file the prompt named — see the second run below |

### Second run, after those fixes — 4 passing, 1 failing, 12 minutes

**The clock went from 33 minutes to 12, and no case timed out at all.** `real 7`
now completes with **ten cards raised and ten allowed** — no denials, no
re-planning, no 915-second runaway. That one change is the whole difference
between the two runs.

**The "answer every card" fix was exercised for real, which is the best evidence it
was needed.** In this run `real 2` raised a question card and the driver answered it
with no handler declared; `real 6` asked, got an answer, and then **asked a second
time** — a card the old boolean latch would have left on screen until the clock ran
out. Both were answered. See T8.

**`real 6`'s judgement note did its job.** This time the model asked two questions,
both single-select (`circles=3 boxes=0`), so the multi-select half was untested
*this run* — reported as a note about the model's choice, not as a failure, which is
the honest reading. The first run asked with boxes (`boxes=4`), so between the two
runs both shapes have now been seen from a real model.

**The one failure was the harness's assertion, not Plato.** `real 9` was told to add
a comment above the URLDecode call in `SubmissionsViewModel.java`. The transcript
shows `apply_diff done`, and the working tree shows **one added line in
`FormatterUtility.java`** — the model found the call in `formatURL`, put the comment
there, and said so in its final message. The gate was absent and the write landed:
the case passed on everything it is about, and failed only on an assertion that
watched a different file. **A named-file assertion against a real model measures
instruction-following, not the behaviour under test** (T11).

### Third run — **5 passing, 20 minutes**

**The real pass is green for the first time, and `real 9` passed on the fixed
assertion:** `disk: the run wrote into the repo (77 → 78 changed lines …)` — the
write counted wherever it landed. Timings: `real 1` 17 s, `real 2` 42 s, `real 6`
243 s, `real 7` 839 s, `real 9` 46 s.

**Two reporting gaps the same run exposed, both fixed.**

- **The question capture kept only the LAST card.** `boxes=0 circles=3` was read as
  "the model never offered a multi-select question this run" when it described a
  single card — and that run raised two, the first carrying three questions whose
  kind was never recorded. The capture is a list of every card now and the judgement
  is made across all of them. **A one-shot capture cannot answer a question about the
  whole run.**
- **Test 7's PASS was narrower than it looked.** Its only hard assertion is the card's
  invariant — never two steps in progress at once — so a fourteen-minute run that
  raised **forty-five** approval cards, read 63 files, ran 42 shell commands and
  rewrote the plan **three times with not one step ever completed** still passed. The
  check now reports the run's scale (seconds, cards, completed tool calls, completed
  steps across every plan card) and says plainly that the model finished nothing —
  without failing, because that is a finding about the model, not the card. **A green
  assertion about a card is not a statement about the run.**

## 7. Reuse

The M4 acceptance test — still never run, and M4's own definition of done — is
the obvious next consumer: it needs the same things this harness now has (a real
VS Code, a real webview, a scripted or real model, and evidence read from the
transcript rather than from memory). Restating it for the one-worker-plus-
philosophers model is the blocking step, not the machinery.
