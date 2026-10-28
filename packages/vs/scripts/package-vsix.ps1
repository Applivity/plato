param(
    [string]$Configuration = "Release",
    [string]$LocalNodeZip = "",
    [string]$MSBuild = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
)

$ErrorActionPreference = "Stop"

$VsRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $VsRoot "src\Plato.Vs\Plato.Vs.csproj"
$Sidecar = Join-Path $VsRoot "src\Plato.Vs\sidecar"

Write-Host "== fetch the pinned Node 22 runtime =="
# The runtime is obtained from nodejs.org and its SHA-256 is checked against
# the constant in fetch-node.ps1. There is no dev-machine Node path.
$fetch = @{ Sidecar = $Sidecar }
if ($LocalNodeZip) { $fetch.LocalZip = $LocalNodeZip }
& (Join-Path $PSScriptRoot "fetch-node.ps1") @fetch

$Node = Join-Path $Sidecar "node.exe"
$env:PATH = "$Sidecar;$env:PATH"

Write-Host "== build the sidecar bundle =="
& $Node (Join-Path $VsRoot "scripts\gen-defaults.mjs")
if ($LASTEXITCODE -ne 0) { throw "gen-defaults failed" }
& $Node (Join-Path $VsRoot "esbuild.mjs")
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

Write-Host "== stage plato-host.cjs =="
Copy-Item (Join-Path $VsRoot "dist\plato-host.cjs") (Join-Path $Sidecar "plato-host.cjs") -Force

Write-Host "== build the VSIX =="
# /restore matters: without it an incremental tree keeps the package versions
# resolved by the last build, so a changed PackageReference is silently ignored
# and the VSIX ships the old assembly binding.
& $MSBuild $Project /restore /p:Configuration=$Configuration /p:Platform=x64 /v:m /nologo
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed" }

Get-ChildItem (Join-Path $VsRoot "src\Plato.Vs\bin") -Recurse -Filter *.vsix |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 FullName, Length
