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

## Current state (verified 2026-09-24)

- Location: `/Users/ai/Desktop/plato`. Canonical remote
  `https://github.com/applivity-com/plato` (private, default branch `main`;
  `applivity-com` is a personal user account, **not** an org).
- Monorepo (pnpm workspaces): `packages/core` — the engine, v0.1.0, **no VS Code
  imports** — and `packages/vscode` — the extension shell, **v0.25.0**. There is
  no `packages/cli` yet (phase 2).
- HEAD = **M5.0 / D49al + D49ak + D49aj** (multi-select questions; three modes; the
  question tabs) on top of **D49ah + D49ai** — Phases 0–6 of the agent capability plan
  are **complete** (roadmap in DECISIONS **D49**). Push stays with the founder.
  Working tree clean.
- **There are THREE modes, not four (D49ak).** `act` was merged into `edit`, so
  `edit` **runs the shell** and `plan` is the only mode that cannot. **`auto` fetches
  without asking** — the founder's call, amending D49p. **Any doc or comment that still
  lists four modes is stale**; the two architecture documents keep their bodies verbatim
  by design (D48) and carry superseded-map rows instead.
- **2026-09-23/24 was a long run of real-use repairs, driven by the founder running
  Plato on an external Android repo (the trial ground — see "Trial runs" below).
  In order: `D49r` compaction could strand tool results; `D49s` an empty turn was
  sent to the wire; `D49t` the model's advertised context window reached the run;
  `D49u` **the environment was choosing Plato's endpoint and lending it a
  credential** (a security fix); `D49v`/`D49w` the Settings bounce and the invented
  16,384 output ceiling; `D49x`/`D49y` a deselected model was still the model to
  run, and the answer box grows to three lines; `D49z` the model tick boxes are
  gone, so every fetched model is eligible; `D49aa` **the chat log is append-only
  and compaction is a request, not a deletion** (the founder's scrollback was being
  erased); `D49ab` **the turn cap is deleted**; `D49ac`/`D49af` reply readability;
  `D49ad` thematic breaks; `D49ae` per-claim evidence in the worker prompt;
  `D49ag` **the log now records what a tool DID, not only that one ran** — the
  fold and the cross-run request were both blind to 80.8% of a run.**
  **The two that changed the product's shape are D49aa and D49ab** — read those
  first if you are picking this up cold.
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
  evade a text check still can, and in `act`/`edit` the approval card is the real gate.
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
- **The questions panel numbers its questions as tabs (D49aj).** The card said
  *"Question 2 of 3"*, which tells the user how many questions there are and nothing
  about **which are already answered or how to reach one** without stepping through
  every question before it. The strip shows the whole set, marks an answered question
  on its own tab, and jumps on a click. **Three states, and colour is not the only
  cue** — active filled, answered outlined, untouched grey. **`← Back` was already
  there and is unchanged**: it restores a prior answer including free text, pinned by
  the `question` render suite since D49y, and the tabs do not replace it.
- **A question may be multi-select, and the model asks for it (D49al).** Set
  `multiple: true` on a question and the card draws **checkboxes** instead of radios;
  the user picks several, and the answer travels as **one `"; "`-joined string per
  question** — so the transport, the callback signature and the transcript are
  unchanged. **The tool result reads `Answers:` for a multi question and `Answer:` for a
  single one**, because a string of labels is otherwise indistinguishable from one
  answer containing semicolons. **The shape is the affordance** — box for multi, circle
  for single — and the fill carries the same state, so neither reading rests on colour.
  **Free text joins the picks rather than replacing them.** Still capped at 6 options,
  with no select-all and no minimum-picks rule: the question is the model's, and the
  card adds no policy the model did not ask for.
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
  **Known and open:** in `auto` nothing now stops a model that loops without concluding.
  The PROGRESS backlog carries the design question and what is known about it — **the
  failure mode is repetition, so a bound should detect a repeated identical tool call**.
  Two tests pin the absence (one runs 55 turns); **deleting the cap broke no test because
  no test had ever described it.**
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
- **A model's context window comes from the CONNECTION, not the catalog alone (D49t).**
  `LoopOptions.advertised` carries what the connection reported; the ring and the RUN
  resolve through one rule, `resolveMaxContext` / `resolveMaxOutput`, which **takes the
  smaller when two sources disagree** — too small summarises early and works, too large
  overflows, and on local servers it overflows *silently*. The catalog still covers
  well-known names; `null` still means unknown, and the UI says so. Discovery runs
  automatically before a run (5 s bound, 24 h staleness) instead of waiting for "Fetch
  models". **`max_tokens` is NOT a window** — it is the output cap; it used to be read as
  one. **LiteLLM reports sizes only on `/model/info`**, which is implemented but
  **unverified against a live LiteLLM**. Ollama and llama.cpp runtime windows are not read
  at all.
- **A tool result must answer a tool call, so compaction may not cut inside an
  exchange (D49r).** `compactionSplit` sliced by COUNT alone, so a cut landing inside
  a tool exchange stranded the results with no `tool_calls` above them — and a strict
  server rejects that outright rather than guessing. **This killed the first real run**
  (`openai HTTP 400: Messages with role 'tool' must be a response to a preceding
  message with 'tool_calls'`). The cut now walks back until the kept tail can stand
  alone, keeping fewer messages than asked. **Anthropic enforces the same rule**, so
  this was never OpenAI-specific. **Related, open, and NOT fixed:** a model name
  outside the catalog is assumed to hold only **8,192 tokens**, so compaction fires
  very early for any LiteLLM group or custom model — see the PROGRESS backlog.
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

## M4 closeout — what is actually left

M4 is *not* done. Its definition of done is the acceptance test in BLUEPRINT §4,
and **that test has not been run** — no run of it is recorded anywhere in the
docs, and **it has gone stale: three of its five clauses no longer describe this
product.**

| BLUEPRINT §4 clause | Status |
|---|---|
| "default 3-profile preset (architect → coder → Socrates the observer)" | **STALE** — the product lock (D45a-3, D47e) made it one worker + N philosophers: Solo / Duo / Academy, Plato always the doer |
| "a small bug fix or feature across 1–3 files" | **stands** |
| "the observer intervenes at least once meaningfully" | **STALE as written** — it measures chattiness, so a philosopher who correctly stays quiet fails it. Assert the observer path is LIVE and its activity reported; do not require an intervention |
| "stays within its budget cap" | **VOID** — D49h built a budget cap and removed it the same day as unrequested, and D49ab deleted the turn cap. The clause contradicts a recorded decision |
| "`./gradlew` verification passes" | **NOT RUNNABLE HERE — dropped by the founder's decision (2026-09-24)**, see below |
| secrets never reach a model | **stands**, and D49ai (2026-09-24) closed a hole in it |

**The founder's decision (2026-09-24): drop the build clause for now**, and record the
toolchain as the prerequisite it is. **Verified that day: this machine has no JDK, NO Android
Studio, and NO Android SDK** — so `./gradlew` is not a missing binary but a build with nothing
to build against. That is the same gap that left the `DateHelper` reason unverifiable. **The
prerequisite to restore the clause: a JDK plus the Android SDK command-line tools and
platform.** Until then the test verifies a change by reading, and says so.

**Still to do, in priority order:**

1. **Restate the acceptance test** for the current model and write it into DECISIONS as its own
   entry, replacing BLUEPRINT §4's version. **The hold is lifted (2026-09-24):** it was held so
   that a change the founder was about to describe would land in the text rather than in a rewrite
   after it, and his two items have now been heard — one is built (the question tabs), one is a
   pending decision that does not touch the acceptance test. **The restatement is therefore
   unwritten for a plainer reason: nobody has written it yet.**
2. **Secret audit** (D15) — everything that leaves the machine: **Plato's own** repo history,
   VSIX/npm artifacts, transcripts, docs, screenshots. Scoped to Plato, not the proving ground.
3. **Trademark sweep** (D16) and the **license decision** (D19) — the founder's; D19 is the one
   thing gating any publish. Note "Plato" is a common noun and an ancient name, so it is a weak
   mark.

Everything else in M4 (packaged VSIX, onboarding, the whole D44–D47 UI series)
has shipped; the code is well past the `0.9.8` that PROGRESS's milestone table
used to claim.

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
  `pnpm exec tsc -b --force` then `pnpm -r test` (expect **534** passing
  vitest cases across **34** files in packages/core).
- Validate the **UI** separately with the render suites (they need a headless
  browser, so they are not part of `pnpm test`): `pnpm run render` (builds first)
  or `pnpm run render:fast` (reuses the bundle). `pnpm run verify` runs build +
  unit tests + render suites. Fifteen suites, **318 assertions**; see
  `scripts/render/README.md` — every suite fails on ANY uncaught page error, and
  since D49a a **failed assertion also fails the command**. That README also says
  how to **drive** a control (type into it, fire its real event, read back the
  message it posted) rather than only rendering it, and why the screenshot is
  part of the check.
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
- `scripts/render/` — the real-DOM render suites (`pnpm run render`). Eleven
  suites driving the actual webview in headless Chromium. They exist because
  `tsc` and the unit tests cannot see the rendered page; see its README for the
  list of defects they caught.

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

**State of the trial repo as of 2026-09-24 (re-verified against the working tree, not the
previous session's notes).** `git status` shows **six modified files and two untracked**, none
committed — the repo's last commit is the pre-existing `31bf716`, so nothing Plato did has been
committed there:

| File | Change |
|---|---|
| `DateHelper.java` | **1 line** — the `ISO8601` *constant*: `SSSSSSS` → `SSS` (see 1 below) |
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
   than it first looked.** The diff is on the *constant itself* (`SSSSSSS` → `SSS`), and
   `ISO8601` is what `DatabaseHelper` **writes into DB rows** and what the cache-expiry value is
   stored as. So it does not only change how a 7-digit fraction is parsed: it changes what the
   app writes, and **rows already stored with 7 digits may no longer round-trip.** The fix may
   still be right; its stated reason is not — it claims the project's own formatter emits 3
   digits, and the constant it edited said otherwise. **Unverifiable here: no JDK.**
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

## Verification loop (every change)

1. `pnpm exec tsc -b --force` — clean
2. `pnpm -r test` — 538/538 vitest in packages/core (34 files)
3. `pnpm run render` — the real-DOM render suites, **15 suites / 318 assertions**
   (or `render:fast` to reuse the bundle). Add an assertion here for any UI defect
   you fix, and prove it falsifiable.
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
8. Update PROGRESS.md (newest-first row) and DECISIONS.md when the
   change warrants a decision; commit.

## Queued next work (in priority order — pick up here)

**First, what the 2026-09-23/24 repairs left open.** One of the three is now done
and the other two were **measured and turned out not to be what the founder was
seeing** — which is worth knowing before anyone spends a session on them.

1. ~~**Compaction cannot see tool activity**~~ — **DONE (D49ag, 2026-09-24).** The
   log's tool row was `{tool, phase}`, so both readers of the log saw *that* work
   happened and never what it was. A tool row now carries a **digest** — the
   salient argument per tool, never the result — the fold summarises the span in
   log order, and the cross-run request carries the tail's digests too. **The
   number to remember: on a real 78-turn run, tool results were 80.8% of the final
   request and the fold could see 0% of them.**
2. **Trim old tool OUTPUT before summarising anything.** Still worth doing for a
   model with a **small or unknown** window (Claude Code and Codex run a cheap snip
   first). **Measured, and it is not what the founder was seeing:** his runs end
   around **11%** of his window and his transcript holds **zero
   `context-compacted` events**, so the guard never trips and there is no
   summarising to avoid. Do not spend a session on this believing it explains a
   fold he complained about.
3. ~~**The compaction threshold should be an absolute token window**~~ — **CLOSED
   as NOT a defect (2026-09-24).** The premise was a previous session's note copying
   Claude Code, and **it was wrong.** `shouldAutoCompact` is
   `estimated >= window * threshold`, default **0.8**, clamped `[0.5, 0.95]`, and the
   slider already says *"80% of context"* — **nothing is hardcoded**, and a percentage
   **scales with the model** (256k trips at 204,800; 512k at 409,600). **The 800,000
   figure was 80% of the founder's own reported window, not a constant**, and reading
   it back as one is the mistake this line exists to stop. The real defect here is
   **discovery**, not the unit: an unknown window falls to 8,192 — see the catalog
   backlog entry.
   **Related and unmeasured:** the fold's cadence constants (`AUTO_FOLD_AT = 26`,
   `KEEP_AFTER_FOLD = 12`) are called *pairs* in the code and in this doc, but
   `tailPairs` counts **message rows** — so the fold fires on ~13 exchanges, twice
   as often as the names suggest. Recorded, not changed.

**Also open from that work, smaller:**

- **How to bound `auto` now that no turn cap exists (D49ab).** Nothing stops a model
  that loops without concluding. **Do not replace it with a step count** — and do
  not re-propose a `$/turns` budget without reading D49h, which was built and
  removed the same day as unrequested. The promising shape is a **repetition
  detector** (the failure mode is a repeated identical tool call, not volume), and
  `duo`/`academy` already put a supervising observer in the loop.
- **Ordering the model list** — drag or arrows, so the user controls picker
  priority. Founder-requested and deliberately held back as a capability rather
  than a repair. Four unsettled points are in the backlog; **read them before
  building**, especially that drag has no keyboard path and is hard to drive from
  the render harness.
- **The model should report what it did at the end of a run** — the user-facing
  account, which is what makes folding stop feeling like theft. Founder's idea,
  not yet scoped.
- **Plato never reads a reasoning model's thinking tokens.** Recorded in the
  backlog. **Do not build a thinking display without the founder.**

**Three items the founder raised on 2026-09-24 — all three settled, and one of them was a
contract change.** The full analysis is in the PROGRESS backlog and DECISIONS; the short
form:

- ~~**Numbered tabs on the questions panel**~~ — **DONE (D49aj, 2026-09-24).** Plus the
  answer he asked for, which is *no change needed*: the card **does** have a Back button
  and it **does** restore a prior answer, pinned by a render suite since D49y.
- ~~**Multi-select questions (checkboxes)**~~ — **DONE (D49al, 2026-09-24).** Built rather
  than only answered, on his reasoning: *"a model can reason to ask a multiple choice
  answer, so we should support checkboxes."* A question carries an optional `multiple`
  flag; the answer stays one string per question.
- ~~**Simplifying the action model**~~ — **DONE (D49ak, 2026-09-24).** `act` is gone;
  `edit` absorbed it. **The mode table is now three rows: `plan` reads and does not
  touch; `edit` reads freely, asks for a write and remembers the yes per file for the
  session, and asks for every command; `auto` asks nothing** — including `web_fetch`,
  which **no longer asks in `auto`** (this amends D49p; the cost is recorded in
  D49ak). **`plan` keeps no shell, and that part of his proposal was NOT built as
  stated** — "run scripts but change no project files" is not enforceable, because a
  host classifies a *tool* and not a *command*. **Read D49ak before touching the mode
  table** — two architecture documents state the opposite of what now ships, and their
  bodies stay verbatim with a superseded-map row instead.

**Then the active plan.** **The M5 agent capability plan. Read DECISIONS D49 for
the roadmap — do not restate it here.** **Phases 0–6 are DONE.** **Both Phase 3 and
Phase 6 opened by repairing a fault the phase did not anticipate: no tool enforced
workspace containment (D49k), and a shell command could read a protected file by
naming it plainly (D49ai).** **What remains is Phase 7, which is recorded-not-built
by design** — subagents, checkpoints, LSP diagnostics, hooks, skills, notebooks —
**each needs its own decision before it is built**, and the first of them amends the
one-worker product lock (D45a-3). So the plan is at its end: the next work is a
chosen item, not the next phase. **`web_search` was deliberately deferred (D49p)**:
it needs a backend decision, and the convenient option — Anthropic's server-side
search — bypasses the approval card entirely. **D49q is closed as *not wanted***: `plato.net.allow`
and `plato.net.deny` were deleted on 2026-09-21 rather than given a UI, because
`web_fetch` always asks and an allow list could therefore only ever subtract.

**Two items in this plan were built and then removed on a founder challenge —
read before rebuilding either.** **D49h**, a run budget, and **the domain
allow/deny lists**. Both were plan items nobody had asked for and neither repaired
a demonstrated fault. The pattern is recorded in DECISIONS D49: a plan's items are
not all the same kind, so separate what *repairs a demonstrated fault* from what
*adds a capability*, and say which is which.

**Subagents are deliberately deferred and must not be added without
amending the one-worker lock (D45a-3) in the open.**

The items below predate that plan and remain open:

0. **Founder sign-off on D47c–n** (all committed and pushed as of `136564b`).
   Check Academy at a **narrow** panel
   width — that is where the D47g Role-box clip and the D47h overflow lived — and
   confirm: Academy shows only philosophers; changing `Plato's model` **sticks**
   and stays in sync with the composer; Powers = pause/cancel; the council is
   pre-filled `Lyceum`; a starter council seeds Aristotle + Pythagoras; the `✕`
   is drawn on every card and disabled at 2; the Role counter reads `n / 1000`;
   the mode cards stack to ONE column when narrow; in Providers the section stays
   OPEN across **Set key**, **Refresh models** and **Add connection**, with the
   key entered inline; the Academy mode card reads `Plato + a council of
   philosophers.` with no file path (D47m); and the History empty Runs note reads
   `~/.plato/runs/` (D47n).
   **Then settle the `personas.ts` role prompts** (recorded in D47d as possibly
   too weak for real agentic flow).
1. **Chat-log message rendering.** Markdown, code blocks, the
   "done in 26s · 11 tool calls · 66.7k tok" footer, and the labelled
   tool-summary chip already ship (core `renderMarkdown` + `.md-*` CSS +
   the done line + the D47c chip). What remains is *interleaving* — see the
   deferred note below.
2. **History run-detail view.** Friendlier rendering of a run's
   transcript (turns, tool calls, costs), instead of the raw file.
3. **Small wins:** title regenerate affordance (hover rename → add
   regenerate), title-call token metering into run costs.

> **Deferred / backlog — the full list lives in PROGRESS →
> "Deferred / backlog (do not lose these)",** with dates and the resolved items.
> Two of them matter for planning, and both are bigger than they look:
> - **Interleaved tool-call cards in the live log** need **host-side reply
>   segmentation** (a new segmented `md` contract), not styling — the host
>   streams one cumulative markdown blob per turn, so tool summaries land below
>   the whole reply. The History run-detail view is the cheaper place to get
>   correct ordering first.
> - **Mermaid fences render as labelled code blocks.** Needs its own decision:
>   bundling a ~1MB renderer breaks the zero-dependency doctrine and adds an SVG
>   XSS surface inside the escape-first webview.
>
> Deferred by decision (see DECISIONS D46): per-project council override
> ("discussion later" — v1 is one global council) and moving convo history to
> `~/.plato/history/` (it is in VS Code `workspaceState` today).

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
  publish before the M4 license decision by the founder.

## Key external identities

| Thing | Value |
|---|---|
| GitHub org | applivity-com |
| Marketplace publisher | `applivity` (alias parked: `applivityllc`) |
| npm org | `applivity` |
| Proving-ground repo | `/Users/ai/Desktop/HcadPublicAndroid-demo` |
