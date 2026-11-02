# Staged sidecar

`node.exe` (Node 22 LTS, Windows x64), Node's `LICENSE`, and `plato-host.cjs`
are staged here by `packages/vs/scripts/package-vsix.ps1` before the VSIX is
built. They are not committed: the Node runtime is large, and the bundle is a
build artifact.

`packages/vs/scripts/fetch-node.ps1` obtains the pinned runtime from
nodejs.org and checks its SHA-256 against a constant in that script.

The extension looks for `node.exe` and `plato-host.cjs` beside `Plato.Vs.dll`
under `sidecar\`.
