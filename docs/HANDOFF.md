# HANDOFF — Read me first if you are a new developer or AI agent

You are continuing **Plato**, an AI coding agent by Applivity. The founder
may not be available when you work; everything you need is in this repo.

## Read order

1. **This file** — what is true *now*, and how to work here.
2. [PROGRESS.md](PROGRESS.md) — the running change log, newest first. **The
   D-series history lives there.** Do not re-narrate it in this file.
3. [DECISIONS.md](DECISIONS.md) — why, and what was already debated. Each `D#`
   is a locked decision; later entries supersede earlier ones explicitly.
4. [BLUEPRINT.md](BLUEPRINT.md) — **historical.** The founding design record
   (the Q1–Q22 interview), kept verbatim. Read its status banner before its body.
5. [ARCHITECTURE.md](ARCHITECTURE.md) — **historical.** The v0.1 target. Same
   banner; the parts that still bind are named there.

**Ownership rule (D48):** every fact has exactly one home — *current state* →
this file, *what changed* → PROGRESS, *why / what is locked* → DECISIONS. When
something goes stale, fix it where it lives instead of restating it elsewhere.
This file used to carry the whole D47 series and `D37 → D43` release notes; both
are now only in PROGRESS.

## Current state (verified 2026-10-06)

- **A protected file is READABLE, and its values are not — the secret is guarded where it MOVES
  (D49bb, built 2026-09-28).** The deny-list used to refuse every call that named a protected file,
  in every mode, with no way out. Now **a text config file reads with every value replaced by
  `«masked:NAME»`**: the keys, the comments and the line structure survive, and the model never
  holds a value it could move. **Five rules carry it** — D49bb has the fourteen-agent survey, the
  measurements and the four falsifications:
  1. **It fails closed.** A file whose lines cannot ALL be accounted for is refused, not passed
     through — a keystore, a private key and a one-line blob all land here, because a multi-line
     value masked on its first line would leak the rest.
  2. **Every tool result is scrubbed** of any value the session has seen. This closes the hole
     masking alone leaves open: materialise the value into an unprotected file, then read it back.
  3. **A write un-masks**, and a diff is applied against the **masked** view — the model wrote its
     SEARCH string against what it was shown. Without this, an ordinary "add one key" edit destroys
     every secret in the file.
  4. **A placeholder with no known value is refused**, not written: writing it through produces a
     config that looks right and authenticates nothing.
  5. **A commented-out value is masked too.** `# API_KEY=sk-live-…` is what people leave behind when
     they comment a key out to test something, and the first version passed it through.
  **`shell` is the one place the old refusal stays** — a command's output cannot be masked before
  Plato has seen the values — and the message says what to do instead. **The list is the owner's
  now:** `plato.secrets.protect` adds names, `plato.secrets.allow` takes exact paths off, a refusal
  names the setting that would allow it, and the secret map is **in memory only**. **The three
  follow-ups D49bb left open are all built (D49bc, 2026-09-28)** — see the next bullet.
  `scripts/field/README.md` carries the harness traps this found.

- **The three things D49bb left open are BUILT (D49bc, 2026-09-28).** D49bb named them, left their
  shape recorded, and did not build them; the founder's instruction was *"build all 3 recommendations
  and let's close this for good."* D49bc has the reasoning and the falsifications.
  1. **A protected file Plato cannot mask is OFFERED, and the answer splits by CAUSE.** An **opaque**
     file — a `.jks`, a keystore — **stays refused and no card is drawn**, because showing it is
     useless *and* its whole content is the secret. **Text** the masker merely cannot parse — a JSON
     blob on one line, an INI with sections — **gets a card**: *"Show this protected file in full?"*
     **Plato tells them apart with a UTF-8 decode**, so the split is deterministic. The card states
     **the cost** (*every value in this file goes into this conversation*) as its own field, so a
     reordering of the wording cannot move the emphasis off it, and names the setting that allows the
     file permanently. **Two buttons, no "always"** — the permanent answer is a setting, not a
     decision taken once inside a dialog. **It is raised in every mode, `auto` included**, on D49aw's
     precedent, and the answer is remembered **once per file per session**.
  2. **The secret map is seeded from the workspace at run start.** `cat *.properties` in `auto` was
     D49bb's largest hole: the scrub only knows what the session has **seen**, so a command reaching
     a protected file **indirectly** printed a value nothing hid. `seedVault` reads the workspace's
     protected text files through the **same masker** at run start, closing the **class**. **The cost
     is recorded rather than hidden: Plato reads the user's secrets into memory at every run start** —
     never to disk, never to a model, gone with the session. **It does not close `cat
     ~/.aws/credentials`**, which is outside the workspace.
  3. **The Protected files section is in the panel** (D45c), two lists that deliberately do not look
     alike: **names** match the last path segment and allow `*` at the ends; **allowed files** are
     exact paths and take no wildcard, because a wildcard exception would unprotect silently. **The
     built-in names are shown and cannot be removed** — the deliberate way to unprotect one file is a
     path, where the user can see which file they meant. **An entry that could never match is refused
     with the reason**, and the store stays VS Code settings so the panel and `settings.json` cannot
     disagree.

- **M4 IS DONE (2026-09-27).** Its two deliverables are complete and both are measured. **The
  acceptance test is restated *and executed*: 7 of 7 clauses pass**, by
  `node scripts/field/acceptance.mjs --run` across every scripted case in real VS Code — the
  first time that test has ever been runnable, let alone run. **The secret audit is done (D49au).**
  Running the test corrected the test itself: one clause had **no witness at all**, one was **stale
  against a later decision**, and the recorded "clause 4 is not automated" gap is **closed** by a
  harness case that runs a Duo team. It is falsifiable — blanking one product string makes a clause
  fail and the command exit 1. The trademark sweep and license decision remain the **publish gate**,
  not milestone work.

- **Undo is BUILT: Plato keeps its own copies of what it replaced, and /undo puts them back (D49az,
  built 2026-09-28; decided in D49ax).** It was scoped as *"checkpoints / undo — large, and it
  changes what an approval means."* Both halves were wrong in useful ways. **It is small:** the old
  bytes are already read at the write site, so capture costs one disk write and no extra read. **And
  it does not change what an approval means** — the write still happens as approved; what changes is
  what a *mistake* costs. **No parallel history**: Plato stores the **old bytes and a fingerprint,
  never the new bytes**, with a **fingerprint** (not the content) answering "has this file changed
  since Plato wrote it" — which is what lets an undo **refuse rather than clobber a file the user has
  since edited**, Kilo Code's reported bug closed by construction. **Three things the building of it
  decided that D49ax had not**, and each is load-bearing: the copy is taken **at the executor, not at
  the approval preview** (in `auto` no preview is built, so that would be the one mode with no undo);
  the plan is **made again when the user clicks, never held from the card** (the user can edit a file
  between reading the card and clicking it, and that is the same bug returning); and **a file Plato
  created is undone by deleting it**, guarded by the same fingerprint and performed last, with the
  card saying *"Plato created this one, so it is removed"* rather than "put back". **The store is
  bounded and sweeps itself**: 30 days, 200 MB per project, the most recent 10 requests always kept,
  whole requests evicted oldest-first, dead projects and crash orphans reclaimed at activation, and
  **a corrupt index deletes nothing**. Deletion is confined to the store and verified to be. The
  message names the files, the sizes, and **the terminal commands undo cannot cover**. See D49az.
  **Verified in a real window, in `auto`:** case 18 has a created file removed, an edited file come
  back byte for byte, and the undo of the undo return the edit.

- **Old run transcripts are compressed, never deleted — the user decides what goes (D49ay, BUILT
  2026-09-28).** D49ax recorded that `~/.plato/runs/` grows without bound and called it *"the same
  class of leak, already shipping"*. **The measurement says otherwise and that claim was corrected
  in place:** 285 runs occupy **1.4 MB**, a mean of **5 KB per run**, and at that mean 50 runs a day
  for a year is 89 MB raw and **6.4 MB gzipped** (9.2× measured). So: transcripts older than **15
  days** are gzipped at panel open and at run end, and the History page lets the user **delete one
  run or all of them**. **The two stores get different policies because they hold different kinds
  of data** — an undo copy is *derived* (a file that still exists is the truth, so dropping it costs
  convenience), a transcript is *primary* (nothing else holds it, so a timer would destroy the only
  record of what a run did). **Two rules the module enforces:** the gzip is read back, gunzipped and
  **compared byte-for-byte** before the original is unlinked, and the sweep **never throws**, because
  it runs where a failure could block the panel opening. **The delete paths are the dangerous ones**
  and are the user's alone: `isRunFileName` refuses `/`, `\` and `..`, so every unlink is confined
  to the runs directory. **No destructive control is drawn when there is nothing to delete**, and a
  delete never doubles as "open the run". See D49ay.

- **The editor's local history cannot undo Plato's work — measured, not assumed (2026-09-27).** A
  throwaway extension in real VS Code 1.136.0 wrote one file directly to disk and another through
  the editor API, and VS Code's own history store was then read off disk. **A direct disk write
  records nothing at all** — and that is how Plato writes today, so Plato's edits are invisible to
  the Timeline the user already has. Routed through the editor, entries appear, but **the store keeps
  what the editor SAVED, never what it FOUND**: the earliest entry holds the file *after* Plato's
  first save, so **the pre-Plato state is never in it** — and that is the state most often wanted
  back. **Rapid saves merge** (the merge window defaults to 10 s, and Plato's edits are back to
  back). There is **no extension API** for it, and the entry was not even on disk while the window
  was open. The line-ending fear recorded before the test **did not reproduce** — a CRLF file kept
  CRLF with `files.eol` forced to `\n`, because that setting governs new files, not existing ones.
  But a worse hazard **is** real and was measured: with the file open and unsaved typing in it,
  routing through the editor **writes the user's unsaved work to disk**. So Plato writes to disk as
  before and keeps its own copies.

- **A run is bounded by repetition, not by volume (D49aw, Tier C item 2).** The turn cap was deleted
  (D49ab) because it counted the wrong thing — it cut a *working* run at turn 40 after eleven
  approved writes — and nothing replaced it, so in `auto` nothing stopped a model that kept calling
  tools without concluding. **Two triggers, one card:** the same call with the same arguments
  returning the same result consecutively, and turns in which something failed and nothing
  succeeded. Both reset on any success. **Nudge at 3, card at 5** — Cline's CLI ships exactly those
  numbers on exactly that signal. **The key is the call AND its result**, which is what makes it
  safe: re-running the test suite after each edit issues the same command many times and the output
  differs every time, so that false-positive class disappears. **A call the user DECLINED counts for
  nothing** (not a repeat, not a failure, not a reset) — otherwise five declines in `edit` would
  raise "you look stuck" at the user because the user said no. Deliberately **not** detected:
  alternating patterns (edit→build→edit→build is the normal cycle), an unchanged workspace, and
  paraphrased repeats. **Nothing ends a run on its own** — the model is nudged first, and only a
  repeat after that reaches the user, because a silent stop cannot be told apart from a finished
  run. **Every user-facing line answers two questions: what happened, and what you can do about it.**
  The card names the call in words a person reads (`describeCall`, deliberately NOT the log's
  `digestToolCall`), says **what last worked**, and always ends on the way out — *"Tell Plato what to
  do instead, or press Stop and rephrase your request."* The closing line adds *"Nothing was lost"*,
  because that is the worry. Every escape hatch is open — Keep going (with the user's own typed
  guidance), Stop, the composer's Stop button, typing mid-run, switching modes — and answering "Keep
  going" exempts that one call for the run so it cannot nag. **Verified end to end by field cases 12,
  13 and 14** — stop, keep-going-with-guidance, and the no-progress trigger respectively — and **all
  fourteen scripted cases pass together**.

- **Plato is told what the editor thinks of a file it just changed (D49av, Tier C item 1).** After a
  successful write it collects the language servers' errors for the files that call changed, keeps
  the ones **new since the write**, and appends them to the tool result — so the model learns in the
  same turn that it broke something. **The rule that shapes it: the ABSENCE of diagnostics is not
  evidence of correctness.** `getDiagnostics` answers `[]` for a clean file *and* for one no server
  has ever looked at, so the host records one of three states (clean / found N / **not analysed**), a
  timeout counts as not analysed, and it never appends on a guess. **A language server only reports
  on a file the editor is SHOWING** — measured: merely writing or opening one gives nothing, showing
  it gives the errors at once. So collection tries the **quiet route first** (`openTextDocument`,
  short wait — a window whose servers answer on open never has its editor touched) and only then
  shows the file as a preview tab and puts the view back **by name** (the chat panel is re-revealed;
  restoring "the last text editor" is the wrong signal and once left a file in front, which broke
  every later field case). **Verified end to end: case 11 has the model told about two deliberate
  errors, and the whole scripted suite passes** — eleven cases when this landed, the whole suite now. The
  notice says when a file had to be shown.
  `scripts/field/README.md` carries the measurements.

- **The secret deny-list had never been in the repository (D49au, found 2026-09-25).**
  `.gitignore` carried a bare `secrets.*`, meant for local secret files, and it matched
  `packages/core/src/security/secrets.ts` — **the module implementing the deny-list**, imported by
  six others including the package barrel. Never committed, once, in the whole history: **a fresh
  clone could not build, and the most safety-critical file in the product had no history or
  review.** The glob is replaced by named files and the module and its test are added to the working
  tree, and **the founder staged both files on 2026-09-26**, so they are tracked from the next
  commit and a clone builds again. **The rule: an ignore pattern must not be able to match source.**
  Found by listing ignored-but-present files — the one check that sees a file the repository does
  not have.

- Location: `/Users/ai/Desktop/plato`. Canonical remote
  `https://github.com/applivity-com/plato` (private, default branch `main`;
  `applivity-com` is a personal user account, **not** an org).
- Monorepo (pnpm workspaces): `packages/core` — the engine, v0.1.0, **no VS Code
  imports** — and `packages/vscode` — the extension shell, **v0.25.0**. There is
  no `packages/cli` yet (phase 2).
- HEAD = **D49bb + D49ba + D49az** — a protected file now reads with its values masked (D49bb),
  the whole product moved to Simplified Technical English (D49ba), and **undo shipped** (D49az:
  Plato keeps its own copies of what it replaced). On top of **D49av** (editor diagnostics) and
  **D49aw** (a run bounded by repetition), so **Tier C is complete** and Phases 0–6 of the agent
  capability plan are done (roadmap in DECISIONS **D49**). Push stays with the founder.
- **A read-only shell command runs with no approval card — in `plan` and `edit` (D49an,
  D49ao).** In `plan` that is a change of character, not just convenience: **plan is no
  longer "runs nothing", it is "changes nothing"** — no write tool, and a command the
  allowlist passes cannot write by construction. An
  **allowlist**, not a "does this write?" guess: `ls`, `cat`, `grep`, `rg`, `find`, `diff`,
  `wc`, `tree`, `file` and the read-only `git` subcommands (`status`, `diff`, `log`, `show`,
  `blame`, …) run unasked when given **plain words**. Refused, and each for a reason that
  matters: **shell syntax** (`; & | < > $` backtick, parens, newline — one command cannot
  become several), **globbing** (`* ? [` — `cat *.properties` would name no secret and read
  one, which is the deny-list's one bypass), and **anything leaving the workspace** (`/`,
  `~`, `..`). **A background command is never auto-approved** (`run_in_background` starts a
  process that outlives the turn, and `kill_shell` is denied in `plan`, so it would be
  unstoppable from that mode). **The tool test keeps the widening exact** — anything that is
  not the `shell` tool keeps its own verdict, so a `deny` for an MCP tool is never upgraded.
  The secret refusal fires first — a command naming a protected file is refused outright with
  no card. **Still gated on purpose: `npm test`, `./gradlew`, `node` and every run script** — a
  build file runs arbitrary code, so **a run still stops before it runs your tests**; the
  fix would be a per-project allowlist the user writes. **Residual risks are in D49an** (a
  symlink defeats the lexical check; `git status` may touch `.git/index`) — read them before
  widening the list.
- **There are THREE modes, not four (D49ak).** `act` was merged into `edit`, so `edit`
  asks for every command instead of denying the shell. **`plan` denies every command that is
  not read-only** — not "asks": plan shows no cards, so anything the allowlist does not
  recognise is refused outright (D49ao). **`auto` fetches without asking** — the founder's call, amending D49p. **Any doc or comment that still
  lists four modes is stale**; the two architecture documents keep their bodies verbatim
  by design (D48) and carry superseded-map rows instead.
- **The 2026-09-23/24 repairs are history, and PROGRESS is their home (D49r–D49ag).** They were a
  long run of real-use faults found by running Plato on the trial ground below, and this file used
  to narrate all of them — which is the duplication D48 exists to stop. **Two changed the product's
  shape and are worth reading first if you are picking this up cold: D49aa — the chat log is
  append-only and compaction is a request, not a deletion — and D49ab, which deleted the turn cap**
  (its replacement is D49aw, in "Current state"). The traps those repairs left behind are recorded
  where they belong, under "Critical gotchas".
- **A protected file was readable by naming it plainly in a shell command (D49ai).**
  `isSecretPath` matches a whole string after taking its **basename**, so
  `cat app/keystore.properties` was refused while **`cat keystore.properties` ran** — and
  the spelling that read the file is the natural one, because the proving-ground repo
  keeps it at the **root**. `shell` is `allow` in `auto`, so nothing asked. **Checked in
  TWO places, and both were blind:** the executor (`shellTool`, the guarantee) and the
  loop's pre-flight (`secretRefusal`, the courtesy — it refused nothing, so the approval
  card never named the file). Both now use **`mentionsSecretPath`, a token scan**:
  `echo do not commit keystore.properties` is refused, while `grep -rn "secretsmanager"
  app/src` and `./gradlew assembleRelease` are not, so the guard does not fight the model
  over words instead of files. **Best effort and recorded as such** — a command built to
  evade a text check still can. **Where the real gate is has changed since:** in `edit` the
  approval card covers everything that is not a read-only command (**D49an**), and `auto` has
  no card at all — which is why the globbing refusal in that same entry matters.
  **`todo_write` is exempt** from that scan, because its arguments are the model's own
  words about work it intends, not an instruction to open a file — do not "fix" that
  exemption without reading D49ai, and note a test asserts the pairing (the same words in
  `read_file` and `shell` still refuse).
- **The agent writes its plan down and the user sees it (D49ah, Phase 6).** `todo_write`
  **replaces the whole list on every call** — a delta protocol lets the model's picture and
  the real list drift apart silently. **The tool's result IS the rendered list**, the same
  string the panel draws, which is what makes the phase's claim checkable: a loop test pins
  that **the model is handed its own plan back on the next turn**. It is a **META tool
  beside `ask_user`** — allowed in every mode, never approved, because it touches no
  workspace and no network and **`plan` mode is where writing the plan down is the whole
  job**. **A malformed plan is refused, never guessed at** (an unknown status gets a
  correction, not a coerced item; an over-long item is refused, not truncated). The plan is
  a **log row drawn where it was set**, so a replan adds a card rather than rewriting one,
  and a reload rebuilds them from the log — **no new bus event was needed**, since the shell
  already receives every tool call's arguments. **The rule a user lives with: state is
  legible WITHOUT COLOUR** — completed struck through, in-progress heaviest, a distinct
  glyph per state.
- **The questions panel NAMES its questions as tabs (D49aj; the labels replace the
  numbers, D49bd).** The card said *"Question 2 of 3"*, which tells the user how many
  questions there are and nothing about **which are already answered or how to reach
  one** without stepping through every question before it. The strip shows the whole
  set, marks an answered question on its own tab, and jumps on a click. **Each tab is
  named by the question's `header`** — one or two words the model writes, naming the
  decision (*"Contract"*, *"Test runner"*) rather than the topic — and **a question
  with no header keeps its number**, so the field is additive and can only improve a
  card. **The strip wraps to a second row** rather than clipping when the names are
  wider than the panel. **Three states, and colour is not the only cue** — active
  filled, answered outlined, untouched grey. **`← Back` was already there and is
  unchanged**: it restores a prior answer including free text, pinned by the `question`
  render suite since D49y, and the tabs do not replace it.
- **A question may be multi-select, and the model asks for it (D49al).** Set
  `multiple: true` on a question and the card draws **checkboxes** instead of radios;
  the user picks several, and the answer travels as **one `"; "`-joined string per
  question** — so the transport, the callback signature and the transcript are
  unchanged. **The tool result reads `Answers:` for a multi question and `Answer:` for a
  single one**, because a string of labels is otherwise indistinguishable from one
  answer containing semicolons. **The shape is the affordance** — box for multi, circle
  for single — and the fill carries the same state, so neither reading rests on colour.
  **Free text joins the picks rather than replacing them.** **The card is kept small on purpose (D49am):** a question
  carries **2-3 options**, never more, and one call carries **1-4 questions** — the founder's
  call, *"we don't want to overwhelm the users."* The free-text *Others* row is added ON TOP of
  the declared options, so 3 options are 4 rows on screen. **How many boxes may be ticked is
  unlimited.** A ceiling binds only the model, which may offer fewer; the card renders whatever
  arrives.
- **The question card is one of the five parked cards that survive a reload (D49bg).** Four cards
  park a run — approval, stuck, undo, reveal — and the question card was the one **not** written
  into the transcript log, so a reload took it off the screen while the host stayed parked on a
  promise nothing else could resolve. It now writes a `question-open` row (carrying the questions,
  **`multiple` included** — a restored card that lost that flag draws **circles where the live card
  drew boxes**) and a `question-done` row, and **the answer is in the log too**: one `You: <question>:
  <answer>` row per question, worded like the view's own echo, because a fold used to summarise a run
  in which the user appeared to have said nothing. **Cancel writes no echo row on purpose** — the
  user answered nothing. **The `recommended` flag renders as ` (recommended)` after that option's
  label**, for single-answer and multi-select questions alike, and it is **advisory only** — nothing
  is pre-selected (a deliberate choice: the marker is the whole feature). **Core resolves the model's
  string against its own options before the card sees it (D49bh)** — ignoring surrounding whitespace
  and case, and **only ever finding the same option or none**, never a different one — and the
  question is **asked either way**, so a recommendation that names no option loses its marker and
  nothing else. A genuine miss is **recorded as a notice on the run**, because the model writes the
  recommendation and the options as two unrelated fields and can abbreviate its own label — **and
  that notice reaches the model too late to fix the question it is about**, since the ask tool's
  result *is* the user's answer; the run is parked in between, so the model is first told anything
  when the answer comes back. **A question is NOT time-bound**: the run waits until the user answers,
  cancels, or VS Code closes, and nothing auto-picks the recommended option.
- **`web_fetch` sends nothing without consent, and that is enforced by a KIND
  (D49p).** `net` is the only tool kind that returns `ask` in **every** mode,
  `auto` included — egress cannot be un-sent. **An approval covers ONE HOST**:
  session approval is keyed **`tool:host`**, not on the tool, so "approve all
  requests to `docs.example.com` this session" cannot widen to every later host
  (keyed on the tool it could — a hole that already existed). **Redirects are
  followed, and every hop is validated.** The request is issued with
  `redirect: 'manual'` so the HTTP layer cannot follow anything itself — the walk
  is ours, bounded at 5 hops, or no hop gets checked. **A hop onto a private,
  loopback or link-local address is REFUSED**, while **a URL the user was shown
  and approved is never refused on its address** — the card prints what the
  address means instead. That asymmetry is the decision: a hop is chosen by a
  *page*, so consent does not cover it; consent covers what the user saw. **The
  check is literal**, so a *name* that resolves to a private address is followed —
  recorded, not implied. **The domain allow/deny lists were DELETED** (2026-09-21):
  they could only ever subtract, because `web_fetch` always asks, and other agents
  ship no such UI. Do not re-add them without reading D49p. **Script and style
  bodies are removed WITH their contents** — tags alone would leave a page's
  JavaScript in the prompt as prose. **`web_search` does not exist and must not be
  added without reading D49p**: Anthropic's server-side search needs no key, but
  it runs inside the API call, so **no approval card can fire** — it would break
  the always-ask rule.
- **A model the user unchecked is not the model to run (D49x).** `pickEffectiveModel`
  (core) is the one rule: a ref is kept only if the connections still **offer** it.
  Asking whether the ref's **connection** existed was the defect — a deselected model
  satisfies that, and a key scoped to a model list answers **403** for a name it does not
  allow, so a stale selection is a failed run and not a no-op. A **sibling on the same
  connection** is preferred over the first available model, because losing a model is not
  a reason to change vendors, prices or keys. **The picker now writes `plato.model`**: the
  composer and the Duo/Academy doer selects are the only model controls in the product,
  and they used to write memory only, so every reload reverted to a setting with **no UI**
  — which is how a hand-set model kept reappearing.
- **A model writes a two-level document, so style the rungs it uses (D49af).** A real report was
  a single second-level heading for the title and a **third-level heading for every section** —
  so the third rung carried the whole visible structure while the first and second were dead
  weight. The reply heading ladder is **21 / 19 / 17 / 15px** against 13px body, deliberately
  compressed: **prominence for the levels in use beats hierarchy across levels that never
  appear.** **The lesson is about tests, not sizes:** the suite pinned `h1` and `h2` and the
  document used `h2` once and `h3` three times, so the assertion that mattered did not exist and
  a fix passed while the page still read flat — **assert the rungs the document uses, not the
  rungs the stylesheet has.** Same failure as a cap no test described.
- **The worker prompt demands per-claim evidence, and it is MODE-INDEPENDENT (D49ae).** Every
  factual claim about code must be **observed** (you ran it), **read** (name the file and line),
  or **inferred** — and inference must never be written in the voice of observation. A **third-party
  library's edge-case behaviour** is named as the high-risk case, because that is where confident
  recall is wrong; a real report was wrong about `SimpleDateFormat` while its report-level caveat
  covered a different thing. **A tool you do not have limits what you may CLAIM; it never licenses
  a guess — the prompt says so in those words and a test asserts them.** The founder rejected the
  alternative ("use `act` when verification matters") because it made accuracy a function of the
  mode. **Do not reintroduce mode-dependent accuracy claims.** Two riders: a fix must name the
  assumption it rests on, and a findings-then-fixes task gets its findings written out **before the
  first edit**.
- **There is NO turn cap (D49ab).** `MAX_TURNS = 40` is deleted, and `reason: 'cap'` now
  means exactly one thing — a **truncated answer**. **The run ends when the model stops
  calling tools**; that is the whole termination rule. The bound arrived under D22's
  delegated mandate for `auto` and was applied to every mode, where an approval card was
  already the backstop — it cut a working `edit`-mode run at two-thirds after eleven
  approvals. **Do not re-add a step count:** turns bound neither money nor time, and a
  user-facing `$/turns` budget was already built and removed as unrequested (D49h).
  **CLOSED (D49aw):** in `auto` nothing stopped a model that looped without concluding, and
  that is now bounded by **repetition** — the same call returning the same result, and turns
  in which nothing succeeded. The replacement keeps the lesson the cap taught: it counts
  **wasted effort and resets on any success**, so a long working run is never cut. See the
  current-state entry above. Two tests pin the absence of a turn count (one runs 55 turns);
  **deleting the cap broke no test because no test had ever described it** — and the D49aw
  bound then broke that 55-turn test, because its stub issued the *same* `read_file` 55 times
  with identical results. The bound was right and the stub was wrong; it now advances a plan,
  so the test proves **both** claims at once.
- **The chat log is append-only; compaction is a REQUEST, not a deletion (D49aa).** The log
  is the user's transcript and the request is what the model sees — they used to be the
  same array, so a fold that rebuilt the request from a summary also deleted the
  transcript. **A fold now writes one `compact` row at the cut and removes nothing**, and
  `historyFor` already treated the newest such row as the boundary of the model's memory.
  **Never reintroduce a log rewrite here** — `applyFold` is the only write, it is in core,
  and a shell-side test asserts it does not shrink the log. The rules live in
  `packages/core/src/runtime/chatlog.ts` (`planFold` / `applyFold` / `requestFromLog`)
  **because the shell has no unit tests and this is a data-loss path**. The summary is
  **not printed** — it is the model's memory, not a document for the reader. The display
  cap leaves a `trim` row, and says so differently if it took the summary.
  **`LOG_MAX` is 400 ENTRIES, not messages** — every completed tool call is one row.
- **A tool row records what the call was FOR, never what came back (D49ag).** The row
  carries a **digest** — `digestToolCall` takes the salient argument *by tool name*
  (path / grep pattern / shell command / URL) and never dumps `args`, because `args`
  for `write_file` is a whole file body and for `apply_diff` a whole diff. **Never let
  a result into the digest**: that rebuilds the weight compaction exists to shed, and a
  test pins it with a 50,000-character body. Both readers of the log consume it — the
  fold (`buildFoldPrompt`, which is **in core because the shell has no unit tests and
  this is the half that decides whether a fold records the work**) and `requestFromLog`,
  which carries the tail's digests as a `[tool activity — what Plato ran]` turn. A row
  with **no** digest is skipped, so a log written before D49ag produces a byte-identical
  request. **The display is deliberately unchanged** — the digest is the model's memory,
  not a new chip. Measured: tool results were **80.8%** of a 78-turn run's final request,
  and before this the fold could see none of them. **Confirmed in real use the same day:**
  asked *"which files did you read?"*, Plato went from *"that detail isn't in my current
  context"* to the full list with **0 tool calls** — see D49ag.
- **There is one model list per connection, and nothing can be ticked out of it (D49z).**
  Every model a provider returns is eligible and appears in the chat picker, in the order
  stored. `resolveOfferedModels` (core) is the one read rule and it prefers the **wider**
  of the two legacy fields — `allModels` over `models` — so a config narrowed while the
  tick boxes existed offers everything with **no migration and nothing rewritten in the
  user's settings**. Do not add an enabled/disabled concept back: it is what allowed a
  stored model reference to outlive its model, and **every Duo/Academy member holds one**,
  validated only for shape — the 403 would land mid-run. `plato.model`'s `models` schema
  description says so. **Ordering the list (drag or arrows) is a recorded backlog item,
  not an oversight** — read the PROGRESS backlog before building it.
- **Never measure a hidden element.** A `display:none` node reports `scrollHeight` **0**
  and a zero `clientWidth`, so a fit that runs while the node is hidden collapses it to a
  sliver or wraps every character. The question card's answer box (D49y) starts hidden
  behind its *Others* radio, so the fit runs where the row is already in the document —
  and a render suite pins the restored-answer path, which is the one that got it wrong.
- **Plato does not cap a model's output below its own limit (D49w).** `maxTokens` comes
  from `resolveMaxOutput` — the provider's advertised limit, the catalog, or a conservative
  8,192 when nothing knows the model. **There is no Plato-invented ceiling.** One used to
  exist (16,384) and truncated a real run at exactly that number after it had spent the
  budget thinking. A single turn can now cost more; that is the model the user chose.
- **A `settings` payload must not move the view (D49v).** The host sends one after any
  connection change, some after a network round trip — so moving the view for one yanks
  the user out of the chat mid-click. Only a payload marked `open: true`, which answers a
  request, may open Settings. **Test fixtures that stand in for that reply set
  `open: true`** (`S()` in `scripts/render/plib.mjs` already does).
- **The environment must never choose Plato's endpoint or lend it a credential (D49u).**
  The Anthropic SDK defaults `baseURL` to `ANTHROPIC_BASE_URL` and `authToken` to
  `ANTHROPIC_AUTH_TOKEN`. Plato passed **only `apiKey`**, so a machine with those set
  had every Anthropic connection redirected to whatever the variable named — the founder's
  LiteLLM proxy — while an ambient token rode along on every request. **Both are now
  passed explicitly** (`baseURL: baseUrl ?? public Anthropic`, `authToken: null`).
  **A connection's own base URL still wins** — that is user-visible configuration. **When
  adding any SDK: set every credential and endpoint option deliberately**, or the library
  will prefer the environment over the app's own settings and the call site will read as
  if it had passed what it needed. `createProvider` must not drop `baseUrl` per kind.
- **A model's context window comes from the CONNECTION, and from nowhere else (D49t,
  D49bf).** `LoopOptions.advertised` carries what the connection reported, and the ring and
  the RUN resolve through one rule, `resolveMaxContext`. **The shipped catalog used to
  supply a window for well-known names; that table is GONE** (founder, 2026-10-06) — a
  hand-maintained window is a claim about a machine Plato is not talking to, it rots when a
  name is re-released under a different limit, and it is exactly the number that decides
  when a long session is folded away. So the rule is now simply **believe the connection**.
  `null` still means unknown and the UI still says "ctx unknown" rather than printing an
  assumption as a fact (D26c); what compaction *assumes* in that case is a separate number
  with its own home, `DEFAULT_CONTEXT_WINDOW` = **128k**, in `runtime/context.ts` — raised
  from 8,192. **`resolveMaxOutput` still takes the SMALLER of catalog and connection**, and
  the asymmetry is deliberate: a too-high output request is a hard 400 the user cannot miss,
  while a wrong window only changes when Plato folds. One is a mistake, the other is a
  preference. Discovery runs automatically before a run (5 s bound, 24 h staleness) instead
  of waiting for "Fetch models". **`max_tokens` is NOT a window** — it is the output cap; it
  used to be read as one. **LiteLLM reports sizes only on `/model/info`**, which is
  implemented but **unverified against a live LiteLLM**. Ollama and llama.cpp runtime
  windows are not read at all.
- **A tool result must answer a tool call, so compaction may not cut inside an
  exchange (D49r).** `compactionSplit` sliced by COUNT alone, so a cut landing inside
  a tool exchange stranded the results with no `tool_calls` above them — and a strict
  server rejects that outright rather than guessing. **This killed the first real run**
  (`openai HTTP 400: Messages with role 'tool' must be a response to a preceding
  message with 'tool_calls'`). The cut now walks back until the kept tail can stand
  alone, keeping fewer messages than asked. **Anthropic enforces the same rule**, so
  this was never OpenAI-specific. **Related, FIXED by D49bf:** a model outside the old
  catalog was assumed to hold only **8,192 tokens**, so compaction fired very early for any
  LiteLLM group or custom model. It is now **128k** — see the bullet above, which also
  states the trade that came with it.
- **Images can be attached, and the rules around them are not obvious (D49n/o).**
  A new `image` member on `CanonicalContent` (`ImageMime` = the four types both
  wires accept; base64 with **no `data:` prefix**). **The MIME is sniffed from the
  BYTES, never the extension**; the *name* only decides whether to try. **Never
  put base64 on the bus or in a prompt** — the transcript writes every event
  verbatim, and the token estimate for an image is a flat constant because
  chars/4 over base64 would price a 1 MB screenshot at ~350k tokens and make the
  compaction trigger fiction. **The OpenAI adapter drops an unknown block
  silently** (it guards each block explicitly), so a new content member must be
  checked there as well as in the Anthropic fallthrough.
- **A file tool may only touch the workspace (D49k).** Before it, **no tool
  enforced this** — `write_file {path: '../../../../tmp/x'}` created a file
  outside the root, and in `auto` mode writes need no approval. The rule lives in
  `security/paths.ts`; the executor resolves every path argument through one
  choke point, and the loop also refuses before asking for approval (the
  executor is the guarantee, the loop is the courtesy). **`pathArgsOf` is the
  single source of truth for which argument is a path** — do not add a
  path-taking tool without adding it there. `shell` is deliberately NOT covered.
- **The tool surface grew (D49l/m).** `grep` takes `regex`/`glob`/`mode`/`limit`
  and is **literal unless `regex: true`**; new `glob` (find files by name — a
  pattern with **no slash matches the basename**, so `*.ts` works at any depth);
  `list_dir` takes a path; `apply_diff` takes a per-block `replace_all` (**it
  needs split/join, not `String.replace` — `$&` in a replacement would be
  substituted**); new `apply_patch` is atomic across files; and `shell` takes
  `run_in_background` with `bash_output`/`kill_shell`. **`decide()` denies a tool
  with no kind in every mode**, so a tool must be added to `TOOL_KIND` (tsc
  enforces this) *and* declared in `schemas.ts` (a test enforces the other
  direction).
- **Background shells stop when the run ends (D49m).** There is no UI that lists
  them, so an orphan would be invisible and unstoppable. `kill_shell` signals the
  process **group** — killing only the shell orphans whatever it spawned.
- **The reply now streams (D49j).** `TurnRequest.onDelta` is optional; absent, the
  adapters make the blocking call exactly as before, so every test fake and the
  compactor/observer are untouched. **The assembled `TurnResponse` is IDENTICAL
  either way** — streaming changes only *when* the text is visible. The Anthropic
  path uses `messages.stream()` + `finalMessage()` and maps through the same
  `mapMessage`; the OpenAI-compatible path rebuilds the non-streaming JSON shape
  from SSE and maps through the same `mapResponse`. **Three things not to
  re-derive:** the loop keeps a **fresh text accumulator per attempt** (a shared
  one turns a retried turn into `"HelHello"`); the **content-type guard** is what
  stops a server that ignores `stream: true` from returning a silently empty
  answer; and the host's streaming text is a **preview that a committed block
  supersedes** (never appended to, or the turn's text shows twice). `onDeltaText`
  gets the text **so far**, not the newest fragment. Deltas deliberately do **not**
  ride the bus — `transcript.ts` writes every event verbatim.
- **A transient provider failure no longer ends a run (D49f).** The worker turn
  retries 429 / 5xx / transport failures with backoff. A 4xx other than 429 is
  *not* retried — it would fail identically. **Caveat:** the retry notice is
  emitted on the bus, and bus `notice` events are **log-only** — the extension
  never `send()`s them — so it is visible after a reload, not during the run.
  Recorded in the PROGRESS backlog with the reason it is not a one-line fix.
- **The stable prefix is cached (D49g).** The system prompt and tool schemas are
  marked cacheable. **`inputTokens` is a TOTAL** (Anthropic reports it net of
  cache, OpenAI gross) — do not map either straight through, or the context ring
  and the cost will disagree between providers.
- **Cancel now aborts the call in flight (D49i).** `RunController.cancel()`
  aborts a signal threaded through `TurnRequest` to both HTTP layers. **An abort
  and a transport failure look identical** (status `null`, which is retryable),
  so both the retry policy and the loop's catch have to special-case it — a
  cancel must never be answered with retries or reported as a failure.
- **The render suites now FAIL THE PROCESS on a failed assertion (D49a).** Until
  D49a they could not: `check()` only logged, and no suite set `process.exitCode`,
  so a suite printing `FAIL: 12` exited 0 and the run still ended **ALL RENDER
  SUITES PASS**. Treat any "ALL RENDER SUITES PASS" claim older than D49a as
  evidence of *no uncaught exception* only — not of passing assertions.
- **The tool surface changed this phase (D49b–d).** `write_file` always writes an
  existing **empty** file and needs `overwrite: true` to replace a non-empty one;
  `read_file` takes `offset`/`limit` and never truncates silently; and a provider
  failure now arrives as a typed `ProviderError` carrying the HTTP status.
- **What Plato is: a personal pair-programmer that never pollutes the shared
  repo.** Everything Plato owns lives in a flat `~/.plato/`: `ACADEMY.yaml` (the
  council), `DUO.yaml` (the Duo philosopher), `mcp.yaml`, `PLATO.md` (global
  default), and `runs/<project-key>/` (transcripts; the key is an 8-char sha1 of
  the workspace root). The repo is only ever **read**: `<repo>/PLATO.md` (project
  override, materialised by `/system-prompt`) and `<repo>/AGENTS.md` / `CLAUDE.md`.
- **Product model (D45a-3/4, D47e): one worker + N philosophers.** Solo / Duo /
  Academy are the *same* worker with 0 / 1 / N philosophers watching and steering;
  cap is 5. The acting agent is "**Plato**" in all user-facing copy ("worker" is
  the internal term). `ACADEMY.yaml` carries **philosophers only** — Plato is
  always the doer — and the doer model is one session-wide value with two views
  (the composer picker and the `Plato's model` select). **Never add a per-member
  *behavioural* field back (a model, a role override) without also adding a way
  to see it** — D47e removed the worker precisely because a hidden doer could be
  silently changed by a hand-edited file, and the UI could not show the
  difference.
- **Worker prompt join:** project `PLATO.md` > global `~/.plato/PLATO.md` >
  bundled default > `AGENTS.md` / `CLAUDE.md`. Project files are always on when
  present — **file presence is the switch**.
- **Command surface:** Compact · History · System prompt.
- **Duo + Academy are edited entirely from the Settings UI** (D47), with the yaml
  as the single store and two-way sync: edits write the file, and a host file
  watcher over `~/.plato/{DUO,ACADEMY}.yaml` re-reads external edits. Editing
  creates the file; a missing `DUO.yaml` runs the built-in Aristotle default.
- Git identity: this machine is `ukhan <umair1808@gmail.com>`; commits in this
  repo use `git -c user.name='plato-dev' -c user.email='plato@local'`.

## M4 closeout — the stale blueprint clauses, and what closed them

**This section is a DATED ANALYSIS (2026-09-25), not M4's current status — and its own opening
paragraph had gone stale inside it, which is the defect this file keeps having to repair.** M4 is
**DONE** (2026-09-27; re-verified 2026-09-28). What follows is why the blueprint's clauses had to
change, kept because it is the record of that reasoning. **Read the "BOTH ARE DONE" passage
immediately below for the outcome, and D49at for the detail.**

As of 2026-09-25: M4 was *not* done. Its definition of done was the acceptance test in BLUEPRINT §4,
and **that test had never been run** — no run of it was recorded anywhere in the docs — and **it had
gone stale: three of its five clauses no longer described this product.**

| BLUEPRINT §4 clause | Status |
|---|---|
| "default 3-profile preset (architect → coder → Socrates the observer)" | **STALE** — the product lock (D45a-3, D47e) made it one worker + N philosophers: Solo / Duo / Academy, Plato always the doer |
| "a small bug fix or feature across 1–3 files" | **stands** |
| "the observer intervenes at least once meaningfully" | **STALE as written** — it measures chattiness, so a philosopher who correctly stays quiet fails it. Assert the observer path is LIVE and its activity reported; do not require an intervention |
| "stays within its budget cap" | **VOID** — D49h built a budget cap and removed it the same day as unrequested, and D49ab deleted the turn cap. The clause contradicts a recorded decision |
| "`./gradlew` verification passes" | **NOT RUNNABLE HERE — dropped by the founder's decision (2026-09-24)**, see below |
| secrets never reach a model | **stands, and was sharpened twice.** **D49bb (2026-09-28):** the file now reads with its values masked, so it is the **value** that never reaches a model. **D49bc (2026-09-28):** the values DO reach a model when the user answers a card that states the cost — so the clause is *"only through a card the user answered"*, because "never" would pass by forbidding the card that replaced the refusal. D49ai (2026-09-24) closed a hole in the name check |

**The founder's decision (2026-09-24): drop the build clause for now**, and record the
toolchain as the prerequisite it is. **Verified that day: this machine has no JDK, NO Android
Studio, and NO Android SDK** — so `./gradlew` is not a missing binary but a build with nothing
to build against. That is the same gap that left the `DateHelper` reason unverifiable. **The
prerequisite to restore the clause: a JDK plus the Android SDK command-line tools and
platform.** Until then the test verifies a change by reading, and says so.

**M4 is now TWO things (restated 2026-09-25), and BOTH ARE DONE (2026-09-27).** The trademark sweep
(D16) and the license decision (D19) **left M4** — they gate a *publish*, not a milestone, and Plato
is still in development. They are now the **publish gate** — see its own section below, and
"Open work" for everything else that is not done.

1. **The acceptance test is RESTATED (D49at) and now EXECUTED — 7 of 7 clauses pass.** One command
   runs it: **`node scripts/field/acceptance.mjs --run`** drives the field harness (every scripted case)
   and judges each clause, exiting non-zero unless every one passes. Pass the `--run` flag or run the
   harness yourself first; the judge reads `tmp/field/last-manifest.json`. **Two witnesses per
   clause**, deliberately: the spec reports what it saw on **screen** and the judge recomputes the
   **transcript** verdict independently, because they are wrong in different ways.
   **Running it corrected the test itself in three places**, each recorded in D49at: clause 6 had
   **no witness at all** (no case touched `web_fetch`), clause 6 was **stale** (it demanded that
   `web_fetch` ask in `auto`, which D49ak's amendment of D49p had already changed), and clause 4's
   recorded gap is **closed** — a harness case now runs a **Duo** team and asserts the closing line
   reports the observer, still without requiring an intervention. **Falsified**: blanking the
   unfinished-plan note makes case 17 fail, the judge reports clause 5 FAIL, and the command exits 1.
2. **The secret audit is DONE (D49au, 2026-09-25)** — and it found that
   **`packages/core/src/security/secrets.ts` had never been in the repository at all**, matched by
   `.gitignore`'s bare `secrets.*`. A fresh clone could not build. Fixed, and **the founder staged
   both files on 2026-09-26** so they are tracked from the next commit. Everything else was clean;
   D49au records the two residuals.

**What M4 does not claim.** No clause asserts that a change *compiles* — `./gradlew` cannot run on
this machine (no JDK, no Android SDK), so clause 1 is verified by the diff and by reading. That is a
recorded state, and restoring the clause requires a JDK plus the Android SDK platform tools.

Everything else in M4 (packaged VSIX, onboarding, the whole D44–D47 UI series)
has shipped; the code is well past the `0.9.8` that PROGRESS's milestone table
used to claim.

## The publish gate — last, and not before a public release is actually planned

**Not part of any milestone, and deliberately at the end.** These three are the
founder's, they cost money or a lawyer, and none of them makes the product better
— so they wait until a publish is real. **Recorded here so they are not lost, and
explicitly NOT work item 1 of anything.**

- **Trademark sweep (D16).** Note "Plato" is a common noun and an ancient name, so
  it is a **weak mark** — decide whether that matters before spending on it.
- **License decision (D19).** Name the license, add the text, and settle the
  private-vs-public question. **This is the one thing that gates any publish** — no
  marketplace listing, no public repo, no release before it.
- **Consequence to keep in mind while building:** the repo stays private and no
  license text is added until D19 says otherwise. That is a live constraint on
  every commit, not a future task — see "Non-negotiable safety rules".

## Environment prerequisites (verified facts)

- macOS. Git 2.50.1 present.
- Node.js v24.19.0 (LTS) via nvm 0.40.7; pnpm 11.23.0 global.
- If a terminal reports `node: command not found`, open a fresh terminal
  or run `. ~/.nvm/nvm.sh` first.
- **No JDK / no Java runtime is installed on this machine.** `java`, `javac` and
  `jshell` in `/usr/bin` are the macOS stubs and fail with *"Unable to locate a
  Java Runtime"*. **This matters for trial runs**, which are Java: Plato cannot
  compile or run what it reviews here, and neither can you — so a Java claim is
  verified by reading or not at all. Opening the project in Android Studio (which
  bundles a JBR) is the only local way to run it. Do not offer `./gradlew` as a
  verification step without saying this.
- Validate the whole repo with:
  `pnpm exec tsc -b --force` then `pnpm -r test` — the unit tests, in packages/core.
- Validate the **UI** separately with the render suites (they need a headless
  browser, so they are not part of `pnpm test`): `pnpm run render` (builds first)
  or `pnpm run render:fast` (reuses the bundle). `pnpm run verify` runs build +
  unit tests + render suites. See `scripts/render/README.md` — every suite fails on
  ANY uncaught page error, and since D49a a **failed assertion also fails the
  command**. That README also says how to **drive** a control (type into it, fire
  its real event, read back the message it posted) rather than only rendering it,
  and why the screenshot is part of the check.
  **The counts live in one place — "Verification loop" below — and these two
  commands print them. Do not copy them into a second place: four copies that
  disagreed is how this file last went stale.**
- Validate the **ACCEPTANCE TEST** — M4's definition of done, and the repo's end-to-end
  check — with `node scripts/field/acceptance.mjs --run`. It packages a fresh VSIX, drives
  every field case through real VS Code, and judges the seven clauses (D49at),
  exiting non-zero unless every one passes. `--run` inherits the launcher's **destructive
  demo-repo reset**; to judge a run you already did, drop the flag. Use `render:fast`-style
  judgement (`node scripts/field/verdict.mjs --case N --last 1`) when you want one case.
- Validate the **provider adapters against the real SDK** with
  `node scripts/smoke-stream.mjs`. The unit tests **mock** `@anthropic-ai/sdk`,
  so they prove the adapter's wiring but not that the installed SDK behaves as
  assumed. This points the real SDK at a local SSE stub via `ANTHROPIC_BASE_URL`
  and checks that deltas arrive separately through `stream.on('text')`, that
  `finalMessage()` assembles them, that streamed equals blocking, and that an
  abort rejects instead of hanging. Needs `packages/core/dist` built
  (`pnpm exec tsc -b packages/core`). Use this pattern for any future claim about
  an SDK's behaviour.

## How the packages connect

- `packages/core` — pure logic, no VS Code imports. Providers
  (`anthropic-native`, `openai-compat`, `errors`, discovery, registry), runtime
  (`loop`, `context`, `bus`, `modes`, `observer`, `transcript`, `cost`,
  `commands`, `workerRole`), plus `format`, `tools`, `mcp`, `teams`, `security`.
  The test suite lives at `packages/core/test/*.test.ts`.
- `packages/vscode` — thin shell. `src/extension.ts` is the VS Code host
  (commands, webview wiring, settings, workspace/secret storage, the
  chat `run()` loop orchestration, conversation-title generation,
  session archiving). `src/webview.ts` is a **single giant template
  literal** containing the entire webview HTML + CSS + inline JS.
- `packages/vscode/scripts/extract-inline.cjs` — repo gate: extracts the
  inline `<script>` from the webview bundle and runs `node --check`
  against it.
- `scripts/render/` — the real-DOM render suites (`pnpm run render`): twenty-one
  suites driving the actual webview in headless Chromium. They exist because
  `tsc` and the unit tests cannot see the rendered page; see its README for the
  list of defects they caught.
- `scripts/field/` — the **live** checks: the scripted cases driving a real
  VS Code window through Selenium, plus the acceptance judge (`acceptance.mjs`)
  that turns them into M4's seven clauses. `scripts/field/README.md` is the map,
  including the traps and the honest boundaries.

## Trial runs — the proving-ground repo, and how Plato is actually judged

Plato is developed against a **real** repo, not a demo: `/Users/ai/Desktop/HcadPublicAndroid-demo`,
an Android app, a Git repo, private. The point is that a capability is only proven by real work.

**These files are SECRET-BEARING. Read "Non-negotiable safety rules" before touching that
repo.** `keystore.properties`, `local.properties`, `.env*` and `*.keystore` must never
reach a model — including *you*. When inspecting a run, read the run's transcript, not the
project's secret files. **The trial repo's own git hygiene is the founder's business, not
this doc's** — he has said so, and this file is Plato's current state. Do not audit, fix,
rewrite or report on it from here; Plato's job on that repo is to read the code it is asked
to read and nothing else.

- **Run transcripts** live in `~/.plato/runs/<sha1-of-root-8>/*.jsonl`, one per run, with a
  header then one JSON event per line. The newest is `ls -t | head -1`. **They record tool
  NAMES and phases, not arguments** — so a transcript cannot tell you which files a run
  touched. Useful fields: `usage` per turn (`inputTokens`, `outputTokens`, `cacheReadTokens`,
  `costUsd`), `context`, `text`, `tool-event`, `approval-requested`, and a final
  `run-completed` with `reason`.
- **`costUsd` is 0 for any model outside the shipped price table** — which is every model on
  the founder's LiteLLM. The dollars a run reports are absent, not small.
- **The founder's setup**: LiteLLM at his own base URL, model refs like `litellm:claude-sonnet-5`,
  plus a direct Anthropic connection. Context windows come from the connection (D49t), and
  prompt caching is working — a 40-turn run showed **99.5% of input served from cache**.

> **RETIRED AS DECISION-TRACKING at the founder's direction (2026-09-27):** *"drop the trial
> repo decision — we are building Plato, not fixing bugs for production."* What follows is a
> **dated observation** of another repository's working tree, kept as the record of what a
> trial run left behind. **Plato does not track it, does not maintain it, and owes it no
> decisions.** Nothing here is a task. The one durable fact in it is a *process hazard* that
> belongs to this repo and is documented where it applies: the launcher's `git checkout --`
> on a `plato-field-test-*` branch discards hand edits to the two files it names, silently —
> see the trap in `scripts/field/README.md`. **Do not re-verify this table; it is a snapshot.**

**State of the trial repo as of 2026-09-24 (re-verified against the working tree, not the
previous session's notes).** `git status` shows **six modified files and two untracked**, none
committed — the repo's last commit is the pre-existing `31bf716`, so nothing Plato did has been
committed there:

| File | Change |
|---|---|
| `DateHelper.java` | **NO LONGER THE TRIAL EDIT — re-checked 2026-09-25.** The file now carries **only the field harness's own scratch edit** (`ISO8601` → `ISO_8601`, case 5). The `SSSSSSS` → `SSS` change item 1 below describes is **not in the tree.** **The harness reverts it silently**: on a `plato-field-test-*` branch the launcher runs `git checkout --` on this file and `SubmissionsViewModel.java` **without asking**, and the dirty-tree guard does not run on that branch. See the trap in `scripts/field/README.md`. Item 1 is therefore **moot as a pending decision and live as a process hazard**. |
| `FormatterUtility.java` | **+7/−4** — `setGroupingUsed(false)`, `Integer.parseInt(formatter.format(…))` replacing an `(int)` cast, `encodedAuthority(host:port)` replacing `authority(host)`, and the `URLDecoder.decode` call removed |
| `DamageReportViewModel.java`, `IFileLookupViewModel.java`, `DriversLicenseViewModel.java`, `SignatureCaptureViewModel.java` | **~9–10 lines each** — the error-state guards, from the 2026-09-24 session |
| `PLATO.md` (untracked) | the project override, materialised by `/system-prompt` |
| `CORRECTNESS_REVIEW.md` (untracked) | **new** — the findings document, i.e. D49ae's "write the findings out before the first edit" |

**Superseded from the previous session's note:** `ApiSecurityUtility.java` and
`QualificationViewModel.java` are **clean again** (that run's HMAC-charset fix and its
`QualificationViewModel` edit are no longer in the tree — reverted or discarded, not committed),
and `Formatters`/`Activities` were read but not edited. **Three things need a human decision
before any of it is trusted:**

1. **The `ISO8601` change is a PERSISTED-FORMAT change, not a parse tweak — and that is worse
   than it first looked. SUPERSEDED 2026-09-25: the change is no longer in the tree** (see the
   table above — the field harness reverted it; the file now holds only case 5's rename). Kept
   because the analysis is what makes the harness's silent revert a real loss rather than a
   tidy-up: the diff WAS on the *constant itself* (`SSSSSSS` → `SSS`), and `ISO8601` is what
   `DatabaseHelper` **writes into DB rows** and what the cache-expiry value is stored as. So it
   did not only change how a 7-digit fraction is parsed: it changed what the app writes, and
   **rows already stored with 7 digits may no longer round-trip.** The fix may have been right;
   its stated reason was not — it claimed the project's own formatter emits 3 digits, and the
   constant it edited said otherwise. **Unverifiable here: no JDK.**
2. **The new `Integer.parseInt(formatter.format(…))` in `FormatterUtility` can throw where the
   `(int)` cast it replaces could not.** A cast truncates toward zero and saturates at the int
   bounds; `parseInt` throws `NumberFormatException` on anything non-integral or out of range.
   The change is probably fixing a real bug (the old path formatted under grouping, so a large
   value produced a comma and the result was wrong), but it may **trade a wrong number for a
   crash** on the same input. **Nothing here can be run: no JDK.**
3. **`SubmissionsViewModel.java:144` still has the `URLDecoder` defect** Plato removed from
   `FormatterUtility` — same bug, a fourth file, correctly left alone as outside the named
   scope. Live and unfixed; the founder's call.

## Critical gotchas

1. **webview.ts is one giant template string.** A stray backtick inside a
   JS comment or string literal closes the template and breaks the
   build. `tsc -b` usually catches it; always run it after editing.
   **It is hit far more often than it looks, and it is almost always a COMMENT**
   — four times in one session (D49ac/D49ad), every time while writing *about*
   code or markdown, which is exactly when quoting is natural. The fix is never to
   quote in that file: write the words, not the syntax. Symptom is
   `error TS1005: ';' expected` or `TS1127: Invalid character` at the comment's
   line and column — **go straight to the nearest backtick rather than reading the
   error as a real syntax fault in the surrounding code.**
   **Backslashes are eaten too:** `\s` written on one line here compiles
   to `/s+/` — which matches the letter *s* and silently does nothing.
   Write `\\s`. `tsc` does NOT catch this one, because `/s+/` is valid
   syntax. Caught the hard way in D47g; a unit test now asserts the
   escaped form in `colors.test.ts`. Existing regexes in the file use
   character classes (no backslash), which is why nothing exposed it.
2. **CSS octal escapes break in the style block.** The webview CSS is
   inside the same template literal. Write `\u2190` (not `\2190`).
3. **The `hidden` HTML attribute is overridden by author CSS.**
   `.ctxctl-row { display:flex }` beats the browser's `[hidden]` rule —
   always add `.foo[hidden] { display:none }` explicitly.
4. **The webview strips native `title` tooltips.** Custom hover bubbles
   are rendered as a `position:fixed` div tracked with `mousemove`
   (see the Compact-now tooltip, D42h/i).
5. **An uncaught error in `showSettings` silently aborts the rest of the
   render.** The page still loads, so nothing looks broken — but the sections
   after the throw never appear and the state restore never runs. A D47i
   `appendChild` of a node into its own parent shipped this way and killed the
   Context section for a whole pass. Every render suite now fails on ANY
   uncaught page error, and asserts all three sections exist.
6. **Never key persistent UI state on displayed text.** The Providers summary
   embeds a live count ("Providers — 1 configured"), so the D47j restore that
   matched on summary text silently missed for the one action that changes the
   count (Add connection) while appearing fixed for the others. Use a stable
   `data-*` id — see `data-sec`.
7. **Assert the requirement, not the absence of a symptom.** "Nothing overflows"
   PASSED against three 67px mode cards, because cramming does not overflow. The
   assertion that works is "each mode card keeps a usable width >= 150px". When a
   fix lands, revert it and confirm the test fails — otherwise the test is not
   evidence. Watch the **substring trap** too: D47n's check had to strip the
   *correct* string before searching for the stale one, because `~/.plato/runs/`
   contains `.plato/runs/`.
8. **The webview has a strict CSP** (nonce-gated script, no inline
   handlers, no `eval`). All interactions use `addEventListener`; all
   host calls go through `vsapi.postMessage({ type, ... })`.
9. **No new message types without a host handler.** Webview → host uses
   messages; host → webview uses `this.panel.webview.postMessage`. Keep
   the contracts in `extension.ts` and `webview.ts` in sync.
10. **Live copy must name the real location (D47m/n).** A user-facing string
    that names a path is a claim about where the user's data is. Three defects
    shipped this way — a mode card naming `.plato/ACADEMY.yaml`, the History
    empty state, and the `TranscriptWriter` header comment. Ask whether the
    path is current *and* whether the surface should name a path at all.
11. **A suite that cannot fail is not evidence (D49a).** For the whole D47 series
    the render suites printed `FAIL: n` and still **exited 0**, so `run.mjs`
    reported **ALL RENDER SUITES PASS** either way. Two suites had also grown
    their own browser and their own private failure counter. Every suite now ends
    with `finish(tag)` from `plib.mjs`, which sets `process.exitCode` from the one
    shared `counters`. **Never print the verdict or close the browser by hand, and
    never define a local `check`** — that is exactly how the two counters drifted.
    When you add an assertion, break the thing it guards and watch the command
    fail, or you have not verified anything.
12. **An abort and a transport failure are indistinguishable (D49i).** Both reach
    the loop as `ProviderError` with status `null`, and status `null` is
    deliberately **retryable** (D49f). So cancellation must be special-cased in
    **two** places or it misbehaves in both directions: `withRetry` refuses to
    retry once the signal aborts, and the loop's catch checks `signal.aborted` to
    end as `cancelled` instead of reporting a failure. **Phase 2 sharpened it as
    predicted** (D49j): a stream that died and a stream the user cancelled look
    identical, and the streaming error path had to consult the signal before
    deciding what happened — `finalMessage()` rejects on abort, so an aborted
    stream reaches the same catch as a network failure. Getting it wrong is not a
    crash; it is a truthful-sounding lie ("provider request failed") about
    something the user did on purpose.
13. **Streaming changes WHEN the text is visible, never WHAT it says (D49j).**
    Three traps, all found by falsification rather than review. **(a) A shared
    text accumulator turns a retried turn into `"HelHello"`** — text the model
    never produced — so the loop resets it *per attempt* and passes the text **so
    far**, not the newest fragment. **(b) A server that ignores `stream: true` and
    answers with plain JSON yields a silently EMPTY answer** unless the response
    `content-type` (not the request flag) decides the parse path. **(c) A
    committed block must SUPERSEDE the streaming preview, never follow it**, or
    the turn's text is shown twice. Also: deltas must **not** ride the bus —
    `transcript.ts` writes every event verbatim, so per-fragment `text` events
    would bloat every transcript and fragment the observer's digest. The bottom
    line: if you change a wire path, prove the assembled response is identical to
    the old one — that is what `streaming.test.ts` and `scripts/smoke-stream.mjs`
    exist for.

14. **Never keep a second hand-written list of which tools are writes (D49am).**
    The shell used to answer "is this a write?" with its own hardcoded pair
    (`write_file`, `apply_diff`) while the mode table also classified `apply_patch`
    as a write — so a multi-file patch raised an approval card on **every** call,
    even for files already approved that session. **The fix was to delete the second
    list, not to extend it:** `isWriteTool` derives from `TOOL_KIND`, and
    `writePathsOf` gives the files a write would change. Both live in **core**, where
    they can be tested — the shell has no unit tests, which is why the bug could live
    there. **A `shell` call is deliberately NOT remembered**: it asks every time, with
    the card's "allow every … this session" as the way to widen it.

## Verification loop (every change)

1. `pnpm exec tsc -b --force` — clean
2. `pnpm -r test` — the unit tests. **Current: 821 in packages/core across 45 files**
   (verified 2026-10-06). This is the only place in this file that carries the count;
   update it here when it moves.
3. `pnpm run render` — the real-DOM render suites. **Current: 21 suites / 586
   assertions** (verified 2026-10-06), or `render:fast` to reuse the bundle. Add an
   assertion here for any UI defect you fix, and prove it falsifiable.
3b. `node scripts/smoke-stream.mjs` — when the change touches a provider
   adapter, run the check the mocked unit tests cannot make: the real SDK against
   a local stub. See "Environment prerequisites".
4. `cd packages/vscode && pnpm run bundle && node scripts/extract-inline.cjs
   && node --check ../../tmp/plato-inline.js` — bundle + inline JS syntax
5. `cd packages/vscode && pnpm run package` — produces
   `plato-vscode-0.25.0.vsix`
6. `cd packages/vscode && pnpm run install:vsix` — installs into the
   running VS Code
7. Reload the VS Code window (Cmd+Shift+P → "Developer: Reload Window")
8. `node scripts/field/acceptance.mjs --run` — **the acceptance test (M4's definition of
   done) AND the **23** live field cases it is built on — **30 runs**, since a case may carry
   several, and the run count is what the acceptance test reports — driven automatically in a real
   VS Code through the real webview.** It packages a fresh VSIX, runs every case, and prints
   the seven clauses with a pass or fail each; it exits non-zero unless all seven pass.
   A scripted model answers, so there is no key, no network and no cost; `FIELD_CASES=1,5`
   with `run-field.mjs` runs a subset. Reach for this when a change touches the mode gates,
   a refusal, the approval, question or stuck cards, the session memory, the plan note, the
   transcript, or egress — it is the only check in this list that exercises those in a
   running editor, and the only one where the *screen* and the transcript are cross-examined
   against each other. `scripts/field/README.md` says how to run it and carries the traps
   that will cost you an hour — read it before the first run. A new assertion here must be
   proved falsifiable, as in the suite below (D49ap).
   **Once per clone** (not after every `pnpm install`): the harness owns its
   dependencies and is not a workspace member, so install them with
   `cd scripts/field && pnpm install --ignore-workspace` — the launcher checks
   for them first and says so if they are missing. Never move them back into the
   root `package.json`: a product install must not pull browser automation.
9. Update PROGRESS.md (newest-first row) and DECISIONS.md when the
   change warrants a decision; commit.

## The 2026-09-25 repairs (D49aq) — and the two gaps they leave open

Four defects the field-test harness found are fixed; a fifth turned out not to be
one. **Read D49aq before touching the mode gates, the refusal path, the approval
cards or the question card** — the record now carries events it did not have
before, and something reading those transcripts is affected.

1. **A refusal is audible.** The pre-flight guard emits `tool-event` with phase
   `refused` and a reason of `secret` or `containment`. It used to emit nothing.
2. **A command is read the way bash reads it.** A quoted glob is allowed (bash
   passes it through literally), an unquoted one is still refused. This also
   closed a hole: `ls ".."` was auto-approved, because the workspace check ran on
   the raw text and `".."` has no `..` path segment.
3. **`approval-card` says whether a card was drawn.** `approval-requested` never
   meant that, and in `edit` the session memory answers without drawing one.
4. **Cancel now works while a question is open.** It did not: the handler
   unblocked a waiting approval and never a waiting question, so the user could
   not stop the run until they answered.

**Read this section with D49as next to it — the three gaps it records are now
closed.** (Written 2026-09-25, closed the same day; the record is kept because the
gaps are what the repairs answer.)

- **A refusal printed nothing in the live chat log.** **CLOSED (D49as).** The
  cause was not the webview: `onToolEvent` forwards a bus event only when it
  carries `args`, and the refusal event carried none, so the host was never told.
  The event now carries `args` like every other `tool-event`, and the live line
  names the guard — *guard stopped shell — it named a protected file*.
- **The cancel fix had no automated check.** **CLOSED AND VERIFIED (D49as) — field
  case 10**, which presses Stop with a question card on screen. **Run 2026-09-26 and
  PASSED**: the transcript ends `cancelled` with the question resolved, the card is
  gone from the window, and the closing line says cancelled. **The decisive detail is
  a step that never ran** — the case scripts a `shell` call AFTER the question and no
  such call appears, so the stop reached the turn gate rather than merely arriving
  after the work finished.
- **A run could end with unfinished work and report only "completed".** **CLOSED
  (D49as).** The newest plan is kept for the run and the closing line adds *N of M
  plan steps unfinished*. Test 7's fourteen-minute run that completed zero steps is
  the case this exists for.

## Open work — nothing here is queued; each item needs a decision

**Tier C is complete, so there is no head of the queue.** The ordered capability list held three
items and all three are built and verified end to end: editor diagnostics (D49av), bounding `auto`
by repetition (D49aw), and **undo (D49az)**. Phases 0–6 of the M5 plan are done, and **Phase 7 is
recorded-not-built by design** — subagents, hooks, skills and notebooks each need their own
decision first. **What follows is the recorded backlog, and picking from it needs a decision
rather than a handover.** Each item is named once here so the list is visible in one place;
**PROGRESS → "Deferred / backlog (do not lose these)" carries the detail**, and closed items are
in PROGRESS's change log and in DECISIONS. **The three tiers that got here — A (D49as), B (M4
closeout: D49at, D49au) and C (D49av, D49aw, D49az) — are complete, and this file used to restate
all three of their records, which is the duplication D48 exists to stop.**

**Waiting on the founder:**

1. **A taint rule for secret *materialisation*.** **PARTLY ANSWERED by D49bb, and deliberately not
   built as a taint tracker.** The idea was to catch **a value READ from a sensitive source reaching
   a new sink**. What shipped instead is stronger where it counts and simpler: the value never
   enters the model's context at all (it is masked at the read), and every tool result is scrubbed
   of any value the session has seen — so there is nothing to track, because the model never holds
   the thing that would move. **What remains genuinely open is the sink rule for a value that
   arrives by a route masking cannot cover** — a command that reads a file indirectly (`tar`, a
   script), or content the user pastes. Shape detection was rejected with a reason in D49bb: it
   needs a model or a regex zoo, it is wrong in both directions, and the pasted case is already the
   user's own act. **Do not re-propose a read-time or write-time taint reject** — D49bb's whole
   point is that the access is not the dangerous act. **The nearest thing to a live case is recorded
   in D49bc:** the map now knows values from files the model never read, so a model that has read a
   protected file masked can name a placeholder and have the value written elsewhere without ever
   seeing it. Pre-dates seeding and unchanged by it — it is this sink rule, not a new hole.
2. **`web_search`** — deferred (D49p) because it needs a backend decision, and the convenient
   option has a trap: Anthropic's server-side search runs inside the API call, so **no approval
   card can fire for it**. Needs either a key in SecretStorage (Brave/Tavily) or an accepted
   exception to the egress rule.
3. **Subagents / `task`** — deferred, and it **amends the one-worker lock (D45a-3)**, so it needs
   an explicit amendment in the open rather than a slip-in.
4. **Ordering the model list** — drag or arrows, so the user controls picker priority.
   Founder-requested and deliberately held back as a capability rather than a repair; four
   unsettled points are in the backlog, **read them before building**.
5. **The D47c–n sign-off**, then the `personas.ts` role prompts that D47d records as possibly too
   weak for real agentic flow. The checklist is in the backlog and wants a **narrow** panel width,
   which is where the D47g Role-box clip and the D47h overflow lived.
6. **An observer's cancel does not release a parked card (found 2026-10-06, NOT fixed).** In
   `duo`/`academy` the observer can call `controller.cancel()`, which sets the abort flag — but the
   loop is `await`ing the user's answer on a card, and **that await is not signal-aware**. The run
   therefore stays parked until the user answers, which is what the user's own Cancel button did
   before D49aq fixed it for the button. **It is identical for all five parked cards** (approval,
   question, stuck, undo, reveal), and that is what makes it a decision rather than a patch: either
   every parked await races the abort signal, or an observer cancel routes through the same
   resolution the button uses. **Severity is low, and worth saying:** the user can still cancel
   themselves, so the run does end — what is missing is the observer's ability to end it for them.

**Smaller, each already scoped:**

- **Two residues left by the seeding and the reveal card (D49bc) — the boundaries, not a to-do
  list.** The seeding is built and closed the indirect read (`cat *.properties` in `auto`); what it
  does not reach is worth stating anyway:
  - **Anything outside the workspace: `cat ~/.aws/credentials`.** Plato cannot pre-read it, and
    containment deliberately does not cover `shell`, so **`auto` plus arbitrary commands stays
    best-effort for anything outside the project.**
  - **A file the user chose to show in full is not in the map.** A blob the masker could not parse
    has no values to enumerate, and guessing at them is the one thing that would put a value in the
    map the masker refused — so the revealed values stay outside the scrub for the session, and the
    notice in the file says the one rule that keeps them in place.

- **The two items above this list's old head are CLOSED (D49be, D49bf), and each left a stated
  boundary rather than a to-do.** The **quote-splice hole** (`cat key'store'.properties`) is fixed:
  the secret check reads the command through D49aq's shell tokenizer, so quoting no longer hides a
  filename from it. What it still does **not** model is a splice the tokenizer itself refuses — a
  backslash, an unbalanced quote — which falls to the text scan and is invisible to it. The
  **8,192-token assumption** is gone: an unadvertised model is assumed to hold **128k**. The trade
  that bought is real and recorded in D49bf — a model that advertises nothing and truly holds less
  than 128k now gets a **400** instead of an early fold, and the fix when it happens is to refresh
  the model list so the connection's own number is used.
- **The fold's cadence constants are named *pairs* while counting messages**, so a fold fires on
  roughly 13 exchanges rather than 26 — recorded, not changed; the numbers are a behavioural
  decision and want the founder.
- **Trim old tool OUTPUT before summarising** — worth doing only for a model with a small or
  unknown window; measured, and it is not what the founder was seeing.
- **An end-of-run account of what the model did** — the founder's idea, the thing that makes
  folding stop feeling like theft. Not yet scoped.
- **Plato never reads a reasoning model's thinking tokens** — recorded, and the tokens are billed
  as output and then discarded. **Do not build a thinking display without the founder.**
- **Chat-log interleaving** — separating narration from the delivered answer needs **host-side
  reply segmentation**, not styling; the host streams one cumulative markdown blob per turn.
- **Mermaid fences render as labelled code blocks** and want their own decision (bundling a ~1MB
  renderer against the zero-dependency doctrine).
- **History run-detail view**, and three small wins: title regenerate, title-call token metering.
- **Deferred by decision (D46):** a per-project council override, and moving conversation history
  to `~/.plato/history/` (it is in VS Code `workspaceState` today).

**Not work at all, and deliberately last:** the **publish gate** — the trademark sweep (D16) and
the license decision (D19). They gate a public release, not a milestone. See "The publish gate"
above.

**Do not reopen without answering the recorded objection:** the per-project command allow/reject
list. A list that covers most of a project's commands invites the belief that it covers all of
them, and the gaps are invisible. The honest alternatives if it bites: leave it (`auto` already
runs everything unasked), or grant one command shape at a time as a named, narrow decision like
the read-only allowlist (D49an).

## Ground rules for any agent working here

- Surgical changes only; touch only what the current milestone requires.
- Every milestone ends in something runnable — demo it, then commit.
- Do not add features from the non-goals list in BLUEPRINT section 3 — **but
  check that banner first:** one of those non-goals ("visual team editor …
  comes later") has since shipped.
- If a design contract in ARCHITECTURE.md conflicts with reality, check whether
  a DECISIONS entry already supersedes it; if not, stop and record the proposed
  change in DECISIONS.md before deviating.
- Match existing conventions; no new frameworks/libraries without a
  recorded reason.
- **Customisation principle (D45c): UI first, yaml as backup.** Every
  user-facing knob must be discoverable and editable in the in-panel UI
  before (or in the same milestone as) the underlying yaml is read. Yaml
  is the power-user fallback, not the primary surface.
- **Pre-release (D45d): no legacy/migration support.** Plato is not
  shipped; moving a customisation between surfaces needs no migration
  path or deprecation cycle — record the move in DECISIONS and go.

## Non-negotiable safety rules

- API keys: SecretStorage only. Never logs, transcripts, settings, or
  commits.
- Never send `keystore.properties`, `local.properties`, `.env*`,
  `*.keystore`, or any `.gitignore`d file content to a model.
- Repo stays private; no public release, license text, or marketplace
  publish before the founder's license decision (D19). **This is the publish
  gate, not a milestone task** — it is the founder's, and it waits until a
  publish is real. See "The publish gate" above.

## Key external identities

| Thing | Value |
|---|---|
| GitHub org | applivity-com |
| Marketplace publisher | `applivity` (alias parked: `applivityllc`) |
| npm org | `applivity` |
| Proving-ground repo | `/Users/ai/Desktop/HcadPublicAndroid-demo` |
