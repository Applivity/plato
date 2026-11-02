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
