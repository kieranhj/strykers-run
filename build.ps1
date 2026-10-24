# Build Stryker's Run (Enhanced) -> build/strykers.ssd
#
#   .\build.ps1                        assemble (not compared: step 2's code differs from the reference)
#   .\build.ps1 -Compare               then check every file against the reference disc
#   .\build.ps1 -Release               RELEASE=1: the build for other people (no DEBUG_ flags)
#   .\build.ps1 -NoCompare             accepted, and the default: no check
#   .\build.ps1 -Define DEBUG_LIVES    a debug flag on (repeatable); the name joins the file name
#   .\build.ps1 -Shift 256             the relocation test: the game assembled 256 bytes lower,
#                                      each bank's contents a page higher (src/main.6502)
#   .\build.ps1 -Shift 256 -ShiftEnd   its control: the same padding where it moves nothing
#   .\build.ps1 -Gameplay              every GAMEPLAY_ flag (decisions 43-50): the gameplay disc,
#                                      build\strykers-gameplay.ssd (with -Release for testers)
#   .uild.ps1 -ReleaseDisc           both, -Release, behind the original release's menu (tools/releasedisc.py):
#                                      build\strykers-release.ssd, 1 the original in O., 2 Redux in R.
#
# Every -D symbol the source reads is passed on every build (Baron cannot default one).
# The Makefile is the same build for POSIX systems and produces the same image; a change to the
# pipeline has to land in both. The original disc is the tag step1-byte-identical-rebuild (README.md).
# Tools: baron from $env:BARON, then bin\baron.exe, then the PATH. Put machine-specific paths in
# local.ps1 beside this file (gitignored); it is run first if it exists.
param([switch]$Release, [switch]$Compare, [switch]$NoCompare, [int]$Shift = 0, [switch]$ShiftEnd, [string[]]$Define = @(), [switch]$Gameplay, [switch]$ReleaseDisc)
if ($ReleaseDisc) {
    & $PSCommandPath -Release
    & $PSCommandPath -Release -Gameplay
    Push-Location $PSScriptRoot
    try {
        & python tools\releasedisc.py build\strykers.ssd build\strykers-gameplay.ssd build\strykers-release.ssd
        if ($LASTEXITCODE -ne 0) { throw "releasedisc.py failed ($LASTEXITCODE)" }
        (Get-FileHash 'build\strykers-release.ssd' -Algorithm SHA256).Hash.ToLower() | ForEach-Object { "       sha256 $_" }
    } finally { Pop-Location }
    return
}
if ($Gameplay) { $Define += @('GAMEPLAY_SHIELD', 'GAMEPLAY_LIVES', 'GAMEPLAY_TIMER', 'GAMEPLAY_OPTIONS', 'GAMEPLAY_RUN', 'GAMEPLAY_JUMP', 'GAMEPLAY_FIRE', 'GAMEPLAY_ARMOUR', 'DITHER_HILLS', 'HUD_RUPTURE') }

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
# zx02 (tools/packdisc.py packs the disc's files): bin\zx02.exe, $ZX02 or the PATH, else built
# from tools\zx02src (v3, vendored: its VENDORED.md) by a C compiler on the PATH, as make builds it
$zx02 = $env:ZX02
if (-not $zx02) { $zx02 = Join-Path $root 'bin\zx02.exe' }
if (-not (Test-Path $zx02)) {
    $onPath = Get-Command zx02 -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { $zx02 = $onPath.Source }
    else {
        $cc = Get-Command cc, gcc, clang -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $cc) { throw "zx02 not found and no C compiler (cc, gcc, clang) to build it from tools\zx02src: set ZX02, or put a zx02.exe built from that source in bin\" }
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'bin') | Out-Null
        $srcs = 'compress', 'optimize', 'memory', 'zx02' | ForEach-Object { Join-Path $root "tools\zx02src\src\$_.c" }
        & $cc.Source -O -o $zx02 @srcs
        if ($LASTEXITCODE -ne 0) { throw "building zx02 failed ($LASTEXITCODE)" }
    }
}

$relDef = if ($Release) { 'RELEASE=1' } else { 'RELEASE=0' }
$endDef = if ($ShiftEnd) { 'SHIFT_END=1' } else { 'SHIFT_END=0' }
$stem = 'strykers' + $(if ($Shift) { "-shift$Shift" + $(if ($ShiftEnd) { 'end' } else { '' }) } else { '' })
# -Define DEBUG_LIVES=1 (repeatable): extra -D symbols, which also mark the build's name
$flags = [ordered]@{ DEBUG_LIVES = '0'; DEBUG_FULLREDRAW = '0'; GAMEPLAY_SHIELD = '0'; GAMEPLAY_LIVES = '0'; GAMEPLAY_TIMER = '0'; GAMEPLAY_OPTIONS = '0'; GAMEPLAY_RUN = '0'; GAMEPLAY_JUMP = '0'; GAMEPLAY_FIRE = '0'; GAMEPLAY_ARMOUR = '0'; SKY_HELI = '1'; DITHER_HILLS = '0'; HUD_RUPTURE = '0' }   # SKY_HELI on unless -Define SKY_HELI=0 (decision 61)
foreach ($d in $Define) {
    $k, $v = $d -split '=', 2
    if (-not $flags.Contains($k)) { throw "unknown flag $k (known: $($flags.Keys -join ', '))" }
    $flags[$k] = $(if ($v) { $v } else { '1' })
    $stem += '-' + $k.ToLower() + $(if ($flags[$k] -ne '1') { $flags[$k] } else { '' })   # a value other than 1 named too (GAMEPLAY_TIMER=2)
}
if ($Gameplay -and $Define.Count -eq 10 -and -not $Shift) { $stem = 'strykers-gameplay' }   # the gameplay disc by its own name
$extra = @(); $stampFlags = @()
foreach ($k in $flags.Keys) { $extra += @('-D', "$k=$($flags[$k])"); $stampFlags += "$k=$($flags[$k])" }

Push-Location $root
try {
    New-Item -ItemType Directory -Force -Path build | Out-Null
    # every flag, so the .config changes whenever the image would (the Makefile writes the same)
    & python tools\build_stamp.py build "$stem.config" $relDef "SHIFT=$Shift" $endDef @stampFlags
    if ($LASTEXITCODE -ne 0) { throw "build_stamp.py failed ($LASTEXITCODE)" }
    & python tools\scrolltext.py src\scrolltext.txt build\scrolltext.6502   # the title's scroll text (bank5.6502 INCLUDEs it)
    if ($LASTEXITCODE -ne 0) { throw "scrolltext.py failed ($LASTEXITCODE)" }

    & $baron --warn 2 -o "build\$stem.ssd" --title 'STRYKERS RUN' --opt 2 -D $relDef -D "SHIFT=$Shift" -D $endDef @extra `
        --symbols "build\$stem.symbols.json" -v src/main.6502 | Out-File -FilePath "build\$stem.lst" -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Remove-Item "build\$stem.ssd", "build\$stem.symbols.json" -ErrorAction SilentlyContinue
        throw "baron failed ($LASTEXITCODE)"
    }
    # SCREEN, DATA1-4 and MGAME packed (ZX02, SRRUN unpacks them), the files in the order the boot
    # reads them, so no load seeks back (Baron writes them in source order)
    & python tools\packdisc.py "build\$stem.ssd" $zx02
    if ($LASTEXITCODE -ne 0) { Remove-Item "build\$stem.ssd"; throw "packdisc.py failed ($LASTEXITCODE)" }
    "Built  build\$stem.ssd"
    (Get-FileHash "build\$stem.ssd" -Algorithm SHA256).Hash.ToLower() | ForEach-Object { "       sha256 $_" }

    $reference = 'reference\sth\StrykersRun.ssd'
    $check = $Compare -and -not $NoCompare
    if ($check -and -not $Shift -and -not $Define -and -not (Test-Path $reference)) {
        "       (no ${reference}: not compared - README.md says where it comes from)"
    } elseif ($check -and -not $Shift -and -not $Define) {
        & python tools\compare.py "build\$stem.ssd"
        if ($LASTEXITCODE -ne 0) { throw 'the build is not byte-identical to the reference (build without -Compare once that is intended)' }
    }
} finally { Pop-Location }
