param(
    [string]$Configuration = "Release",
    [string]$NodeExe = "C:\Users\DummyUser\AppData\Local\nvm\v22.20.0\node.exe",
    [string]$MSBuild = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
)

$ErrorActionPreference = "Stop"

$VsRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $VsRoot "src\Plato.Vs\Plato.Vs.csproj"
$Sidecar = Join-Path $VsRoot "src\Plato.Vs\sidecar"

if (-not (Test-Path $NodeExe)) {
    throw "Node 22 LTS was not found at $NodeExe"
}

$NodeDirectory = Split-Path -Parent $NodeExe
$env:PATH = "$NodeDirectory;$env:PATH"

Write-Host "== build the sidecar bundle =="
& node (Join-Path $VsRoot "scripts\gen-defaults.mjs")
if ($LASTEXITCODE -ne 0) { throw "gen-defaults failed" }
& node (Join-Path $VsRoot "esbuild.mjs")
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

Write-Host "== stage node.exe and plato-host.cjs =="
New-Item -ItemType Directory -Force $Sidecar | Out-Null
Copy-Item $NodeExe (Join-Path $Sidecar "node.exe") -Force
Copy-Item (Join-Path $VsRoot "dist\plato-host.cjs") (Join-Path $Sidecar "plato-host.cjs") -Force

Write-Host "== build the VSIX =="
& $MSBuild $Project /p:Configuration=$Configuration /p:Platform=x64 /v:m /nologo
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed" }

Get-ChildItem (Join-Path $VsRoot "src\Plato.Vs\bin") -Recurse -Filter *.vsix |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 FullName, Length
