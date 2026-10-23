# Staged sidecar

`node.exe` (Node 22 LTS, Windows x64) and `plato-host.cjs` are copied here by
`packages/vs/scripts/package-vsix.ps1` before the VSIX is built. They are not
committed: the Node runtime is large, and the bundle is a build artifact.

The extension looks for them beside `Plato.Vs.dll` under `sidecar\`.
