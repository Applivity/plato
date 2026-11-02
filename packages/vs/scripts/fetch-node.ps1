<#
    Stage the bundled Node.js runtime for the Visual Studio sidecar.

    Pinned runtime:
        Node.js 22.20.0 LTS, Windows x64
        https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip
        SHA-256 bb819d6eb8f5bfda294bbc83a7e4ec6539da67c4233d54b0d655b9248b15e29d
        (from https://nodejs.org/dist/v22.20.0/SHASUMS256.txt)

    The archive is checked against the constant below before anything is
    extracted, so a changed or truncated download stops the build. The staged
    files are:
        <sidecar>\node.exe   the runtime the sidecar starts
        <sidecar>\LICENSE    Node's own licence text, shipped beside node.exe

    Offline builds: pass -LocalZip with a copy of the pinned archive. It is
    checked against the same hash, so an offline build is no less strict.

    The version and hash are recorded here and in packages/vs/README.md.
#>
param(
    [string]$Version = "22.20.0",
    [string]$Sha256 = "bb819d6eb8f5bfda294bbc83a7e4ec6539da67c4233d54b0d655b9248b15e29d",
    [string]$LocalZip,
    [string]$Sidecar = (Join-Path (Split-Path -Parent $PSScriptRoot) "src\Plato.Vs\sidecar")
)

$ErrorActionPreference = "Stop"

$Name = "node-v$Version-win-x64"
$Url = "https://nodejs.org/dist/v$Version/$Name.zip"
$CacheDirectory = Join-Path $env:LOCALAPPDATA "Plato\build-cache"
$CachedZip = Join-Path $CacheDirectory "$Name.zip"

function Assert-Hash([string]$Path) {
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Path`n  expected $Sha256`n  actual   $actual"
    }
    Write-Host "verified $Name.zip SHA-256 $actual"
}

if ($LocalZip) {
    if (-not (Test-Path $LocalZip)) {
        throw "Local Node archive was not found at $LocalZip"
    }

    Write-Host "== using local Node archive $LocalZip =="
    Assert-Hash $LocalZip
    $Archive = (Resolve-Path $LocalZip).Path
} else {
    if (Test-Path $CachedZip) {
        try {
            Assert-Hash $CachedZip
            $Archive = $CachedZip
        } catch {
            Write-Host "cached archive is not the pinned build; downloading again"
            Remove-Item $CachedZip -Force
        }
    }

    if (-not $Archive) {
        New-Item -ItemType Directory -Force $CacheDirectory | Out-Null
        Write-Host "== download $Url =="
        $partial = "$CachedZip.partial"
        Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
        Assert-Hash $partial
        Move-Item -Path $partial -Destination $CachedZip -Force
        $Archive = $CachedZip
    }
}

$Extract = Join-Path ([System.IO.Path]::GetTempPath()) ("plato-$Name-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force $Extract | Out-Null
    Expand-Archive -Path $Archive -DestinationPath $Extract -Force

    $Source = Join-Path $Extract $Name
    $NodeExe = Join-Path $Source "node.exe"
    $NodeLicense = Join-Path $Source "LICENSE"
    foreach ($required in @($NodeExe, $NodeLicense)) {
        if (-not (Test-Path $required)) {
            throw "$Name.zip does not contain $required"
        }
    }

    New-Item -ItemType Directory -Force $Sidecar | Out-Null
    Copy-Item $NodeExe (Join-Path $Sidecar "node.exe") -Force
    Copy-Item $NodeLicense (Join-Path $Sidecar "LICENSE") -Force

    $staged = (Get-FileHash -Path (Join-Path $Sidecar "node.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "== staged Node $Version in $Sidecar =="
    Write-Host "  node.exe SHA-256 $staged"
    Write-Host "  LICENSE  $(Join-Path $Sidecar 'LICENSE')"
}
finally {
    Remove-Item $Extract -Recurse -Force -ErrorAction SilentlyContinue
}
