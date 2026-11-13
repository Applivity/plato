# CLI terminal checks

Run `npm run build` in `packages/cli` first, then from the repository root run
`node scripts/cli-tui/paste-drive.mjs`. It starts a local fake provider (no key,
no paid model), runs the built CLI in a real terminal through `script -q`, and
drives pasted text through the composer. `node scripts/cli-tui/stream-drive.mjs`
uses the same setup to check streaming: the answer is drawn by its final
renderer while it arrives and does not reflow when it lands. `--cli <path>` runs
the same checks against another build.

A pass means every line printed says PASS and `paste-capture.txt` is written
next to the driver. The capture holds the frames and the request bodies: a
pasted block shows the line the cursor is on, nothing is sent until Enter, the
body carries exactly the lines the capture shows, and Backspace removes the
block whole; the streaming check adds that the last live frame and the committed
row carry the same lines. Captures are evidence, not source, and are not
committed.
