<#
.SYNOPSIS
  Builds the portable Windows ZIP of Guia MHW (PyInstaller --onedir).
.EXAMPLE
  .\scripts\build-windows.ps1 -Version 1.0.0 [-OptimizeIcons] [-RebuildCatalog] [-SkipWeb] [-DryRun]
.NOTES
  Stages: 0 venv, 1 staging (web/catalog/icons/research -> build\stage), 2 PyInstaller, 3 allowlist check,
  4 zip + SHA256SUMS. -DryRun stops after staging (no PyInstaller).
  Only build\stage and dist\GuiaMHW are ever deleted, after path assertions. Nothing from data\saves, .env,
  Steam folders, build\backup, build\golden, tools\bin, data\raw, ~/.config or scripts\notebook_mcp.py is read.
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+([-.+][0-9A-Za-z.]+)?$')][string]$Version,
    [switch]$OptimizeIcons,
    [switch]$RebuildCatalog,
    [switch]$SkipWeb,
    [switch]$RefreshLock,
    [switch]$DryRun,
    [switch]$SkipInstaller
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Stage = Join-Path $Root 'build\stage'
$Dist = Join-Path $Root 'dist'
$AppDist = Join-Path $Dist 'GuiaMHW'
$Venv = Join-Path $Root '.venv-build'
$Py = Join-Path $Venv 'Scripts\python.exe'

# Only these icon folders are ever packaged (NEVER data\icons\ui: ~710 MB, unused).
$IconDirs = @('monsters', 'items', 'decorations', 'equip', 'ingredients', 'ui-named')
# Runtime research files read by api/app (builds.py: solo_rules + <goal>_rules; melder.py: melder + melder_data).
$ResearchFiles = @('builds\solo_rules.json', 'builds\gathering_rules.json', 'builds\loot_rules.json',
    'melder\melder.json', 'melder\melder_data.json')

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments, [string]$WorkDir = $Root)
    Push-Location $WorkDir
    try {
        & $Exe @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Exe $($Arguments -join ' ')" }
    }
    finally { Pop-Location }
}
function Remove-OwnedDir {
    # Deletes ONLY <repo>\build\stage or <repo>\dist\GuiaMHW, after resolving to an absolute path.
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $okSuffix = $full.EndsWith('\build\stage') -or $full.EndsWith('\dist\GuiaMHW')
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not $okSuffix) {
        throw "Refusing to delete '$full' (must be <repo>\build\stage or <repo>\dist\GuiaMHW)"
    }
    if ((Test-Path -LiteralPath $full) -and ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to delete reparse point '$full'"
    }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}
function Copy-Filtered {
    # Copy files from $From to $To keeping the relative layout; skips names matching $Exclude (wildcards).
    param([string]$From, [string]$To, [string[]]$Exclude = @())
    $fromFull = (Resolve-Path -LiteralPath $From).Path.TrimEnd('\')
    $n = 0
    foreach ($f in Get-ChildItem -LiteralPath $fromFull -Recurse -File -Force) {
        $skip = $false
        foreach ($x in $Exclude) { if ($f.Name -like $x) { $skip = $true; break } }
        if ($skip) { continue }
        $rel = $f.FullName.Substring($fromFull.Length).TrimStart('\')
        $dest = Join-Path $To $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $dest
        $n++
    }
    return $n
}
function Get-DirMB($p) {
    if (-not (Test-Path -LiteralPath $p)) { return 0 }
    $s = (Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum
    if ($null -eq $s) { return 0 }
    return [math]::Round($s / 1MB, 2)
}

# ------------------------------------------------------------------ 0. build venv
Step "0. build venv (.venv-build, CPython 3.14)"
if (-not (Test-Path $Py)) {
    $created = $false
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.14 -m venv $Venv
        if ($LASTEXITCODE -eq 0) { $created = $true }
    }
    if (-not $created) { & python -m venv $Venv; if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' } }
}
$pyver = & $Py -c "import sys;print('%d.%d' % sys.version_info[:2])"
if ($pyver -ne '3.14') { throw "Build venv must be CPython 3.14 (found $pyver). Delete .venv-build and retry." }
$lock = Join-Path $Root 'api\requirements.lock.txt'
if ($RefreshLock -or -not (Test-Path $lock)) {
    # Plain install first (to get a resolvable set), then regenerate the hashed lock.
    Invoke-Native $Py @('-m', 'pip', 'install', '-q', '-r', 'api\requirements.txt', '-r', 'api\requirements-build.txt')
    Invoke-Native $Py @('scripts\make_lock.py')
}
# --require-hashes: every wheel is verified against api\requirements.lock.txt (win_amd64 / cp314).
Invoke-Native $Py @('-m', 'pip', 'install', '-q', '--disable-pip-version-check', '--require-hashes', '-r', 'api\requirements.lock.txt')

# ------------------------------------------------------------------ 1. staging
Step "1. staging -> build\stage"
Remove-OwnedDir $Stage
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

# 1a. web
$WebDir = Join-Path $Root 'web'
if (-not $SkipWeb) {
    # Textos legales visibles en la página «Acerca de» (/legal/...): se toman de la raíz, que es la fuente única.
    New-Item -ItemType Directory -Force -Path (Join-Path $WebDir 'public\legal') | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root 'LICENSE') -Destination (Join-Path $WebDir 'public\legal\LICENSE.txt') -Force
    Copy-Item -LiteralPath (Join-Path $Root 'THIRD_PARTY_NOTICES.txt') -Destination (Join-Path $WebDir 'public\legal\THIRD_PARTY_NOTICES.txt') -Force
    Invoke-Native 'npm' @('ci') $WebDir
    Invoke-Native 'npm' @('run', 'build') $WebDir
}
$WebDist = Join-Path $WebDir 'dist'
if (-not (Test-Path (Join-Path $WebDist 'index.html'))) { throw 'web\dist\index.html missing (build the web app or drop -SkipWeb)' }
$css = (Get-ChildItem (Join-Path $WebDist 'assets') -Filter *.css | Get-Content -Raw) -join "`n"
if ($css -notmatch '\.woff2') { throw 'dist CSS does not reference woff2: refusing to strip *.woff' }
$n = Copy-Filtered $WebDist (Join-Path $Stage 'web') @('*.woff', '*.map')
Write-Host "web: $n files"

# 1b. catalog
$Catalog = Join-Path $Root 'build\catalog.db'
if ($RebuildCatalog -or -not (Test-Path $Catalog)) {
    Write-Host 'building catalog.db with the ETL ...'
    Invoke-Native $Py @('-m', 'mhw_etl', 'load', '--out', '..\build\catalog.db') (Join-Path $Root 'etl')
}
if (-not (Test-Path $Catalog)) { throw 'build\catalog.db missing' }
Copy-Item -LiteralPath $Catalog -Destination (Join-Path $Stage 'catalog.db')

# 1c. icons (explicit allowlist of folders)
foreach ($d in $IconDirs) {
    $src = Join-Path $Root "data\icons\$d"
    if (-not (Test-Path $src)) { throw "missing icon folder $src" }
    $n = Copy-Filtered $src (Join-Path $Stage "icons\$d") @('*.db', '*.json', '*.txt', '*.map')
    Write-Host "icons\${d}: $n files"
}
if ($OptimizeIcons) {
    Write-Host 're-encoding staged webp icons (lossy q85, staging copy only) ...'
    $code = @'
import sys
from pathlib import Path
from PIL import Image
stage = Path(sys.argv[1]).resolve()
assert stage.name == "icons" and stage.parent.name == "stage", stage
before = after = 0
for p in stage.rglob("*.webp"):
    b = p.stat().st_size
    with Image.open(p) as im:
        im.load()
        if getattr(im, "is_animated", False):
            continue
        im2 = im.copy()
    tmp = p.with_suffix(".tmp")
    im2.save(tmp, "WEBP", quality=85, method=4)
    a = tmp.stat().st_size
    if a < b:
        tmp.replace(p); after += a
    else:
        tmp.unlink(); after += b
    before += b
print("optimized: %.2f MB -> %.2f MB" % (before / 1e6, after / 1e6))
'@
    $code | & $Py - (Join-Path $Stage 'icons')
    if ($LASTEXITCODE -ne 0) { throw 'icon optimization failed' }
}

# 1d. research (only the runtime files)
foreach ($rf in $ResearchFiles) {
    $src = Join-Path $Root "research\$rf"
    if (-not (Test-Path $src)) { throw "missing research file $src" }
    $dst = Join-Path $Stage "research\$rf"
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst
    # Sin identificadores internos del notebook de investigación (no son credenciales, pero no hace falta repartirlos).
    $raw = Get-Content -LiteralPath $dst -Raw -Encoding UTF8
    $clean = [regex]::Replace($raw, '(?m)^[ \t]*"notebook":[^\r\n]*\r?\n', '')
    if ($clean -ne $raw) {
        $null = $clean | ConvertFrom-Json   # debe seguir siendo JSON válido
        [System.IO.File]::WriteAllText($dst, $clean, (New-Object System.Text.UTF8Encoding($false)))
    }
}
# 1e. savereader data is package data of `app` (taken from api\app\savereader\data by the spec).

Write-Host ("staged MB: web={0} icons={1} catalog={2} research={3}" -f (Get-DirMB (Join-Path $Stage 'web')),
    (Get-DirMB (Join-Path $Stage 'icons')), [math]::Round((Get-Item (Join-Path $Stage 'catalog.db')).Length / 1MB, 2),
    (Get-DirMB (Join-Path $Stage 'research')))

if ($DryRun) { Step 'DryRun: stopping after staging'; & (Join-Path $PSScriptRoot 'size-report.ps1'); return }

# ------------------------------------------------------------------ 2. PyInstaller
Step "2. PyInstaller (onedir)"
foreach ($req in @('installer\entry.py', 'api\app\launcher.py', 'api\app\version.py')) {
    if (-not (Test-Path (Join-Path $Root $req))) { throw "Missing $req - cannot build the final package yet." }
}
Remove-OwnedDir $AppDist
$env:MHW_VERSION = $Version
Invoke-Native $Py @('-m', 'PyInstaller', 'installer\guiamhw.spec', '--noconfirm', '--clean',
    '--distpath', 'dist', '--workpath', 'build\pyi')
if (-not (Test-Path (Join-Path $AppDist 'GuiaMHW.exe'))) { throw 'GuiaMHW.exe was not produced' }

# ------------------------------------------------------------------ 3. allowlist check (fails the build)
Step "3. allowlist / forbidden-pattern / size check"
Invoke-Native $Py @('scripts\check_package.py', $AppDist, '--max-zip-mb', '45')

# ------------------------------------------------------------------ 4. zip + checksums
Step "4. zip + SHA256SUMS"
$Zip = Join-Path $Dist "GuiaMHW-$Version-portable.zip"
if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
$zcode = @'
import sys, zipfile
from pathlib import Path
src, out, notices = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
FIXED = (2026, 1, 1, 0, 0, 0)
def add(z, arc, data):
    zi = zipfile.ZipInfo(arc, FIXED); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
    z.writestr(zi, data, compresslevel=9)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    files = sorted(p for p in src.rglob("*") if p.is_file())
    for p in files:
        add(z, "GuiaMHW/" + p.relative_to(src).as_posix(), p.read_bytes())
    add(z, "GuiaMHW/portable.txt", b"")            # portable marker next to GuiaMHW.exe
    if notices.is_file():
        add(z, "GuiaMHW/THIRD_PARTY_NOTICES.txt", notices.read_bytes())
    lic = notices.parent / "LICENSE"
    if lic.is_file():
        add(z, "GuiaMHW/LICENSE.txt", lic.read_bytes())
    chg = notices.parent / "CHANGELOG.txt"
    if chg.is_file():
        add(z, "GuiaMHW/CHANGELOG.txt", chg.read_bytes())
print("zip: %.2f MB" % (out.stat().st_size / 1e6))
'@
$zcode | & $Py - $AppDist $Zip (Join-Path $Root 'THIRD_PARTY_NOTICES.txt')
if ($LASTEXITCODE -ne 0) { throw 'zip failed' }
$sums = Join-Path $Dist 'SHA256SUMS.txt'
$lines = foreach ($f in Get-ChildItem $Dist -Filter 'GuiaMHW-*-portable.zip' | Sort-Object Name) {
    "{0} *{1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLower(), $f.Name
}
Set-Content -LiteralPath $sums -Value $lines -Encoding ascii
Get-Content $sums

# ------------------------------------------------------------------ 5. Instalador (Inno Setup, opcional)
# Reutiliza dist\GuiaMHW tal cual (ya validado por check_package.py) y NO lleva portable.txt: los datos van a %LOCALAPPDATA%\GuiaMHW.
if (-not $SkipInstaller) {
    $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($iscc) {
        Step '5. Inno Setup (instalador)'
        & $iscc (Join-Path $Root 'installer\GuiaMHW.iss') "/DAppVersion=$Version" | Select-Object -Last 6
        if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
        $lines = foreach ($f in (Get-ChildItem $Dist -Filter "GuiaMHW-$Version-*" | Where-Object { $_.Name -match 'portable\.zip$|setup\.exe$' } | Sort-Object Name)) {
            "{0} *{1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLower(), $f.Name
        }
        Set-Content -LiteralPath $sums -Value $lines -Encoding ascii
        Get-Content $sums
    } else {
        Write-Host 'Inno Setup no encontrado: se omite el instalador (winget install JRSoftware.InnoSetup).' -ForegroundColor Yellow
    }
}

Step 'size report'
& (Join-Path $PSScriptRoot 'size-report.ps1')
Write-Host "`nOK: $Zip" -ForegroundColor Green
