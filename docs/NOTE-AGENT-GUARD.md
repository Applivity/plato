# Note — an action guard, and what Plato could take from one

**Status: a proposal, kept, and one of its three parts is now built.**
This note records how a guard behaved against a real agent (me) during the
field-test work on 2026-09-25, and sketches what a near-equivalent feature would
take in Plato. Per D48 it has a PROGRESS row (2026-09-25) now that it is kept.

**Section 2b — making refusals visible — is DONE** (D49aq, 2026-09-25). The
pre-flight guard now emits a `tool-event` with phase `refused` and a reason of
`secret` or `containment`, so a refusal is readable in the transcript and in the
run's transcript view instead of being indistinguishable from the model never
having called a tool. **That was this note's "smallest honest first step", and it
was taken for its own sake rather than as part of this proposal** — the guard
finding came from the field harness independently.

**What remains a proposal:** 2a (a taint rule for secret *materialisation*, as
opposed to a name check) and 2c (owner-configurable protected names, a visible
and expiring per-session allowance, and a refusal that names the human's way
forward). Neither is built, and a DECISIONS entry is required before either is.
**One part of 2c is now doubly relevant** because of a limitation D49aq recorded
rather than fixed: `mentionsSecretPath` still cannot see a quote-spliced name
(`cat key'store'.properties`), and the new shell tokenizer *can*, so closing it
is one line — deliberately left as a decision.

---

## 1. What the guard actually did

Four refusals, all during ordinary work, and each one is instructive because of
*how* it refused rather than *that* it refused.

| The action attempted | How it was refused | What the refusal did |
|---|---|---|
| Copy a key out of the founder's credential file into `~/.plato/` | `[Credential Materialization]` | Named the *category* of harm, not the file |
| Run a test harness whose code reads that credential file | `Blocked by classifier` | Refused the *run*, not just the copy — so writing the code was allowed, executing it was not |
| `git checkout -- <two files>` in the founder's repo | `Blocked by classifier` | Classed as destructive to uncommitted work |
| `node scripts/field/run-field.mjs` (the same script, clean tree) | Allowed | No refusal once the harm was gone — the guard is about the action, not the file |

Three properties stand out.

**It grades the action, not the stated intent.** The third row matters most: the
same command was refused and then allowed, and the only thing that changed was
the state of the working tree. Nothing I said about my intentions entered into
it. An agent cannot talk its way past it, which is exactly what makes it worth
having — the agent is the thing being guarded against, so its reasoning must not
be the input.

**It refuses in a way that leaves the human sovereign.** Every refusal named the
harm, offered a safer path ("use `head` instead of `cat`"), told the agent to
*stop* if the capability was essential, and stated how the founder could grant it
(a permission rule). Refusal was never a dead end; it was a hand-off.

**It is not a wall but a boundary with a gate.** The founder could add a rule and
the action would be permitted — deliberately, once, by the human. Compare a
hard-coded prohibition, which the founder cannot relax without editing code.

## 2. What a Plato equivalent would need

A near-equivalent in Plato is not a copy of a model-based classifier; Plato's own
doctrine points elsewhere (D49k: containment is **lexical**, and the limitation is
stated rather than implied). Three pieces, in order of value.

### 2a. A category of "sensitive material", enforced at the executor

Plato already refuses tool arguments that *name* a protected file
(`secretRefusal`, and `mentionsSecretPath` for a command). That is a name check.
The guard above exercises a second, harder idea: **materialisation** — a value
read from a sensitive source reaching a new sink. Reading a secret to use it is
ordinary; copying it somewhere new, printing it, or sending it out is not.

A deterministic version is reachable without any model: track which tool results
originated from a sensitive path, and refuse a subsequent **write**, **shell
command that emits it**, or **egress** whose content derives from one. That is a
taint rule, and it is checkable in the same style as the existing ones.

### 2b. A refusal the user can see — which Plato currently fails

**This is the part that should be built first, and it is a finding in its own
right (F1 in `scripts/field/FINDINGS.md`).** Today the pre-flight refusal in the
loop pushes a `tool_result` to the model and emits **no bus event at all**. So
the transcript says nothing, and a refusal is indistinguishable from the model
never having called a tool. A guard whose refusals are invisible cannot be
trusted, audited, or debugged — the user has to take its word for it. Any guard
feature must emit an event, render a line in the log, and be readable in the
transcript afterwards.

### 2c. The founder owns the policy, and the override is explicit

- The protected-name set should be owner-configurable (today it is a fixed list
  in `security/secrets.ts`), with the defaults named in the UI rather than only
  in code.
- A per-session allowance must exist, must be visible, and must expire — the way
  `web_fetch` approvals already work (`tool:host`, session-scoped).
- A refusal must offer the human's path forward in its own text, not require them
  to read source to learn why they are blocked.

## 3. What would NOT be worth copying

- **A model-based classifier deciding what is safe.** It is opaque, probabilistic
  and unarguable-with in both directions — it will one day refuse something
  innocent and allow something harmful, and no one will be able to say why. The
  useful part of the guard above was not that a model judged; it was that the
  *rule* was stable and the human held the override.
- **A guard with no stated limit.** Plato's existing security notes state their
  own weaknesses (lexical symlink checks, literal address classification). A
  guard that implies completeness it does not have is worse than none, because
  the user stops checking.
- **A silent guard.** See 2b. If the user cannot see the refusal, they cannot
  consent to the policy, and they will not notice when it fires wrongly.

## 4. The smallest honest first step

If this is ever wanted, the smallest useful piece is not the taint analysis — it
is **making refusals visible**: one bus event on the pre-flight refusal path, a
log line, and a transcript entry. That is a small change to `loop.ts`, it fixes a
real observability gap, and it is a precondition for every other part of this
note. The taint rule (2a) is the interesting engineering; the visibility (2b) is
the part that makes any of it trustworthy.
