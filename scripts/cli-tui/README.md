# CLI terminal checks

Run `npm run build` in `packages/cli` first, then from the repository root run
`node scripts/cli-tui/paste-drive.mjs`. It starts a local fake provider (no key,
no paid model), runs the built CLI in a real terminal through `script -q`, and
drives pasted text through the composer. `node scripts/cli-tui/stream-drive.mjs`
uses the same setup to check streaming: the answer is drawn by its final
renderer while it arrives and does not reflow when it lands. `node
scripts/cli-tui/stop-drive.mjs` checks a long tool and a stop: the running line
names the tool and ticks, the stop is acknowledged at once, and the part of the
answer that arrived is kept. `node scripts/cli-tui/queue-drive.mjs` checks a
line typed during a run: the composer stays live, Enter queues it, and queued
lines and commands run in order when the run ends. `node
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
editor's one sentence. `--cli <path>` runs the same checks against another
build.

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
