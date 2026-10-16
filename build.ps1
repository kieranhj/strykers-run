# Build Stryker's Run (Enhanced) -> build/strykers.ssd
#
#   .\build.ps1                        assemble, then check every file against the reference disc
#   .\build.ps1 -Release               RELEASE=1: the build for other people (no DEBUG_ flags)
#   .\build.ps1 -NoCompare             skip the byte-for-byte check (once the code changes)
#   .\build.ps1 -Define DEBUG_LIVES    a debug flag on (repeatable); the name joins the file name
#   .\build.ps1 -Shift 256             the relocation test: the game assembled 256 bytes lower,
#                                      each bank's contents a page higher (src/main.6502)
#   .\build.ps1 -Shift 256 -ShiftEnd   its control: the same padding where it moves nothing
#
# Every -D symbol the source reads is passed on every build (Baron cannot default one).
# Tools: baron from $env:BARON, then bin\baron.exe, then the PATH. Put machine-specific paths in
# local.ps1 beside this file (gitignored); it is run first if it exists.
param([switch]$Release, [switch]$NoCompare, [int]$Shift = 0, [switch]$ShiftEnd, [string[]]$Define = @())

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$local = Join-Path $root 'local.ps1'
if (Test-Path $local) { . $local }

function Find-Tool([string]$name) {
    $fromEnv = [Environment]::GetEnvironmentVariable($name.ToUpper())
    if ($fromEnv) { return $fromEnv }
    $inBin = Join-Path $root "bin\$name.exe"
    if (Test-Path $inBin) { return $inBin }
    $onPath = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { return $onPath.Source }
    throw "$name not found: set $($name.ToUpper()), or put $name.exe in bin\ or on the PATH"
}
$baron = Find-Tool 'baron'

$relDef = if ($Release) { 'RELEASE=1' } else { 'RELEASE=0' }
$endDef = if ($ShiftEnd) { 'SHIFT_END=1' } else { 'SHIFT_END=0' }
$stem = 'strykers' + $(if ($Shift) { "-shift$Shift" + $(if ($ShiftEnd) { 'end' } else { '' }) } else { '' })
# -Define DEBUG_LIVES=1 (repeatable): extra -D symbols, which also mark the build's name
$flags = [ordered]@{ DEBUG_LIVES = '0' }
foreach ($d in $Define) {
    $k, $v = $d -split '=', 2
    if (-not $flags.Contains($k)) { throw "unknown flag $k (known: $($flags.Keys -join ', '))" }
    $flags[$k] = $(if ($v) { $v } else { '1' })
    $stem += '-' + $k.ToLower()
}
$extra = @(); $stampFlags = @()
foreach ($k in $flags.Keys) { $extra += @('-D', "$k=$($flags[$k])"); $stampFlags += "$k=$($flags[$k])" }

Push-Location $root
try {
    New-Item -ItemType Directory -Force -Path build | Out-Null
    & python tools\build_stamp.py build "$stem.config" $relDef "SHIFT=$Shift"
    if ($LASTEXITCODE -ne 0) { throw "build_stamp.py failed ($LASTEXITCODE)" }

    & $baron --warn 2 -o "build\$stem.ssd" --title 'STRYKERS RUN' --opt 2 -D $relDef -D "SHIFT=$Shift" -D $endDef @extra `
        --symbols "build\$stem.symbols.json" -v src\main.6502 | Out-File -FilePath "build\$stem.lst" -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Remove-Item "build\$stem.ssd", "build\$stem.symbols.json" -ErrorAction SilentlyContinue
        throw "baron failed ($LASTEXITCODE)"
    }
    "Built  build\$stem.ssd"
    (Get-FileHash "build\$stem.ssd" -Algorithm SHA256).Hash.ToLower() | ForEach-Object { "       sha256 $_" }

    $reference = 'reference\sth\StrykersRun.ssd'
    if (-not $NoCompare -and -not $Shift -and -not $Define -and -not (Test-Path $reference)) {
        "       (no ${reference}: not compared - README.md says where it comes from)"
    } elseif (-not $NoCompare -and -not $Shift -and -not $Define) {
        & python tools\compare.py "build\$stem.ssd"
        if ($LASTEXITCODE -ne 0) { throw 'the build is not byte-identical to the reference (use -NoCompare once that is intended)' }
    }
} finally { Pop-Location }
