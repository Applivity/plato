# CLI terminal checks

Run `npm run build` in `packages/cli` first, then from the repository root run
`node scripts/cli-tui/paste-drive.mjs`. It starts a local fake provider (no key,
no paid model), runs the built CLI in a real terminal through `script -q`, and
drives pasted text through the composer. `--cli <path>` runs the same checks
against another build.

A pass means every line printed says PASS and `paste-capture.txt` is written
next to the driver. The capture holds the frames and the request bodies: a
pasted block shows the line the cursor is on, nothing is sent until Enter, the
body carries exactly the lines the capture shows, and Backspace removes the
block whole. Captures are evidence, not source, and are not committed.
