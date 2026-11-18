# CLI terminal checks

Run `npm run build` in `packages/cli` first, then from the repository root run
`node scripts/cli-tui/paste-drive.mjs`. It starts a local fake provider (no key,
no paid model), runs the built CLI in a real terminal through `script -q`, and
drives pasted text through the composer. `node scripts/cli-tui/stream-drive.mjs`
uses the same setup to check streaming: the answer is drawn by its final
renderer while it arrives and does not reflow when it lands. `node
scripts/cli-tui/stop-drive.mjs` checks a long tool and a stop: the running line
names the tool and ticks, the stop is acknowledged at once, and the part of the
answer that arrived is kept. `node scripts/cli-tui/queue-drive.mjs` checks
steering and the queue: Enter during a run sends the line as guidance at the
next safe point, `/queue <text>` waits for the next run, a queued command runs
after the run, and a queued line survives a stop. `node
scripts/cli-tui/approve-drive.mjs` checks the approval card: its hint, Esc that
denies and stops in one press, No that continues, the session answer, and the
decisions read back from the run records, including whether each card was drawn
or settled from memory. `node scripts/cli-tui/context-drive.mjs` checks the
status line's conversation share: the used and window numbers, the summary-due
wording, the drop after a fold, and that nothing wraps at 80 or 120 columns.
`node scripts/cli-tui/setup-drive.mjs` checks setup: the first-run offer, the Ink
setup screen saving a working connection, a rejected key leaving nothing
saved, `/model add` drawing no session frame while it runs, and the context
question when the chosen model advertises no window. `node
scripts/cli-tui/model-drive.mjs` checks the
model pickers: the shell command, the in-session picker, the suspend-and-setup
path, Esc, and a connection that cannot list its models. `node
scripts/cli-tui/window-drive.mjs` checks the window itself: DeepSeek's
`context_window` reaches `plato models` and the status line, a cached list with
no window is refetched, and the fallback is shown as `~131k`. `node
scripts/cli-tui/status-drive.mjs` checks the header and the status line at 100,
80 and 120 columns: the title right-aligned in the header and truncating once,
the fresh empty header, the units (`1M`, not `1049k`), the eight-cell bar, the
labelled team, the running totals, a live rate and the kept last-run figures,
and the drop order when the line is short. `node
scripts/cli-tui/argument-drive.mjs` checks the argument lists under the
composer: each command's words with one line each, arrows, Tab, Enter on an
exact choice only, a partial word completed, and a wrong argument reaching the
command. `node scripts/cli-tui/history-drive.mjs` checks the composer around a
run and the two history keys: the idle hint becoming the run's keys and back, a
card keeping the idle hint, the private per-workspace history file, Ctrl+R
across two processes (stepping, Enter that fills without sending, Esc that puts
the line back), Ctrl+G returning edited text with nothing sent, and a missing
editor's one sentence. `node scripts/cli-tui/file-drive.mjs` checks `@`
completion: the list, filtering, arrows, Tab and Enter, a folder kept open with
`/`, an email that opens nothing, the ignored paths, and the 50-match cap.
`node scripts/cli-tui/coldstart-drive.mjs` delays the model list: the status
line names the step after about a second, once, clears it when the run begins,
and stays silent when the waits are cached. `node
scripts/cli-tui/resume-drive.mjs` checks `/resume`: two saved conversations with
their age and size, arrows, Esc that changes nothing, Enter saving the current
view first and loading the chosen rows, title, model, mode, team and known
window without a chat request, `/sessions` naming the same list, and a deleted
file leaving the current conversation intact. `node
scripts/cli-tui/tools-drive.mjs` checks Ctrl+O on a finished tool row (full
target, start, duration, outcome, and no invented output), a wrapped code line
hanging under its indent, a coloured diff, and a real 100-to-60-column resize.
`node scripts/cli-tui/pause-drive.mjs` checks pause: Esc during a stream holds
the screen where the user stopped it and changes the hint, Enter on an empty
composer does nothing, text typed while paused is held as guidance and delivered
when `/continue` resumes, a pause asked for during a tool lands after the tool
wrote its whole file, a pause asked for while the model call is out does not
swallow the approval card, one Esc while parked (or pausing) does nothing, two
Escs inside 1.5 s stop and the conversation survives, a second Esc after that
window stops nothing, `/continue <text>` sends the text before it resumes,
Ctrl+C stops a parked run in one press, `/continue` with nothing paused says so
(from idle, during an unpaused run, and after a stop where it says the run is
over), the parked hint says `esc esc stops` and is whole at 80 and 120 columns,
Alt+Enter adds a line and
does not pause, and `/help` names the keys and says a paused run does not survive
the process exiting. `node scripts/cli-tui/hint-drive.mjs` checks every hint
state at 80 and 120 columns: an empty box never advertises Alt+Enter, a draft
does, the idle hint keeps the mode explanations, and every hint is one whole
line with nothing wrapped or truncated. `node scripts/cli-tui/command-drive.mjs` checks commands
typed during a live run: `/help`, `/sessions` and `/compact` act, `/continue`
acts only when a pause is in effect, and every other command (`/undo`, `/resume`,
`/model`, `/mode`, `/team`, `/gitignore`, `/new`, `/exit`) is refused with one
line, is not queued, and changes nothing — the mid-run `/undo` leaves its file
untouched and the earlier conversation intact. `--cli <path>` runs the same
checks against another build.

A pass means every line printed says PASS and `paste-capture.txt` is written
next to the driver. The capture holds the frames and the request bodies: a
pasted block shows the line the cursor is on, nothing is sent until Enter, the
body carries exactly the lines the capture shows, and Backspace removes the
block whole; the streaming check adds that the last live frame and the committed
row carry the same lines. Captures are evidence, not source, and are not
committed.

Known limit: a single paragraph longer than the live area has no blank line to
cut at, so its wrapping can shift by one line when the answer lands. Lists, code
blocks and paragraphs separated by blank lines keep their lines.

Known limit: a committed row is printed once through `<Static>`, so a terminal
resize cannot reflow it. Only the live area below the committed transcript
re-measures; the text above keeps the width it was printed at. `tools-drive`
captures both halves of that fact.
