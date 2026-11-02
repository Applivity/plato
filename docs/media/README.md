# README images

These are copies of the website's captures, not originals:

- `vs-chat.png`, `vs-approval.png` and `vs-duo.png` are byte-identical to
  `plato-website/assets/shots/vs/`.
- `vscode-chat.png`, `vscode-guidance.png` and `vscode-approval.png` are
  byte-identical to `plato-website/assets/shots/`.

There is no build step keeping the two sets together, so **they must be updated
in step**. If the extension's UI changes, re-capture both sets — and by the rule
in D49co, capture each at its own display width rather than scaling one from the
other. The site's copies stay 1000×500; these are the same files shown at
GitHub's column width (about 830 px), so they are displayed slightly smaller
than they were captured, deliberately, rather than re-captured for this page.

**The copies are not frozen.** They track the site. Drift is detectable without
trusting anyone's memory — compare the served bytes against these files:

```sh
for p in vs-chat:vs-01-chat-1000 vs-approval:vs-02-approval-1000 \
         vs-duo:vs-06-duo-1000; do
  curl -sL "https://plato.applivity.com/assets/shots/vs/${p#*:}.png" -o /tmp/live.png
  curl -sL "https://raw.githubusercontent.com/Applivity/plato/main/docs/media/${p%%:*}.png" -o /tmp/repo.png
  echo "${p%%:*}: $(shasum -a 256 /tmp/live.png /tmp/repo.png | awk '{print $1}' | sort -u | wc -l | tr -d ' ') hash(es)"
done
```

`1 hash(es)` means in step; `2` means the site and this folder have diverged.

The Visual Studio captures are the **real-model set of 2026-11-02**: Windows 10,
Visual Studio 2026 18.11, extension 0.1.4, DeepSeek `deepseek-flash`, window
exactly 1000 × 500. They supersede the scripted-model set of 2026-10-28, whose
panel header read `stub-model`. The originals are in `C:\src\real-shots\` on the
Windows 10 box; the superseded set is kept in
`plato-artifacts/superseded/vs-shots-2026-10-29/`.

Two limits of the new set, so nobody re-adds them to the page by accident:
`vs-02` shows the approval card's heading and diff, but the three choices sit
just below the panel's log viewport (the status strip reads *waiting for your
approval*); `vs-06` shows a Duo run in which Aristotle checked seven times and
did not intervene.

The website copy of the same six files is `plato-website/vs-shots/`, served from
`plato-website/assets/shots/vs/`; the Marketplace set is
`plato-artifacts/listing-1000/`.
