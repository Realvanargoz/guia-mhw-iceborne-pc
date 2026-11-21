<#
.SYNOPSIS
  Compila el cargador (bootloader) de PyInstaller desde su código fuente y lo instala en .venv-build.
.DESCRIPTION
  Los .exe hechos con el cargador precompilado de PyInstaller son los que más detectan los antivirus (falsos
  positivos). Compilarlo uno mismo da una huella distinta. Pasos:
    1. descarga el sdist de PyInstaller (misma versión que el venv) y comprueba su SHA256 fijado abajo;
    2. lo compila con MinGW-w64 (gcc) con `waf all --gcc`;
    3. copia run.exe / runw.exe a PyInstaller\bootloader\Windows-64bit-intel del venv de compilación.
  Solo escribe dentro de .venv-build y de build\bootloader (carpeta de trabajo). Requiere gcc en el PATH:
    winget install BrechtSanders.WinLibs.POSIX.UCRT
  Si cambias la versión de PyInstaller en api\requirements.lock.txt, actualiza $Expected (suma publicada en
  https://pypi.org/pypi/pyinstaller/<versión>/json, campo "digests" del sdist).
.EXAMPLE
  .\scripts\build-bootloader.ps1
#>
param([string]$Version = '6.22.3')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Py = Join-Path $Root '.venv-build\Scripts\python.exe'
$Work = Join-Path $Root 'build\bootloader'
$Expected = @{ '6.22.3' = '05eb2f5615503e72939a7224d68b4aff572c6b0438ee4a17d0a4b481f399362d' }

if (-not (Test-Path $Py)) { throw 'Falta .venv-build: ejecuta antes scripts\build-windows.ps1 una vez.' }
if (-not $Expected.ContainsKey($Version)) { throw "No hay suma fijada para PyInstaller ${Version}: añádela a `$Expected." }
$installed = & $Py -c "import PyInstaller;print(PyInstaller.__version__)"
if ($installed -ne $Version) { throw "El venv tiene PyInstaller ${installed}, no ${Version}." }
if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) { throw 'gcc no está en el PATH (winget install BrechtSanders.WinLibs.POSIX.UCRT).' }

# Solo se borra la carpeta de trabajo propia, tras comprobar que cuelga de build\.
if (Test-Path $Work) {
    $full = (Resolve-Path $Work).Path
    if (-not $full.StartsWith((Join-Path $Root 'build') + '\')) { throw "Ruta inesperada: $full" }
    Remove-Item $full -Recurse -Force
}
New-Item -ItemType Directory -Force $Work | Out-Null

& $Py -m pip download "pyinstaller==$Version" --no-binary ':all:' --no-deps -d $Work --disable-pip-version-check -q
if ($LASTEXITCODE -ne 0) { throw 'pip download falló' }
$tar = Join-Path $Work "pyinstaller-$Version.tar.gz"
$hash = (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $Expected[$Version]) { throw "SHA256 del código fuente no coincide ($hash)." }
& $Py -I -c "import tarfile,sys; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter='data')" $tar $Work
if ($LASTEXITCODE -ne 0) { throw 'no se pudo extraer el código fuente' }

$src = Join-Path $Work "pyinstaller-$Version"
Push-Location (Join-Path $src 'bootloader')
try {
    & $Py ./waf distclean all --gcc
    if ($LASTEXITCODE -ne 0) { throw 'la compilación del cargador falló' }
} finally { Pop-Location }

$built = Join-Path $src 'PyInstaller\bootloader\Windows-64bit-intel'
$dest = & $Py -c "import PyInstaller,os;print(os.path.join(os.path.dirname(PyInstaller.__file__),'bootloader','Windows-64bit-intel'))"
foreach ($n in 'run.exe', 'runw.exe') {
    $f = Join-Path $built $n
    if (-not (Test-Path $f)) { throw "No se generó $n" }
    Copy-Item $f (Join-Path $dest $n) -Force
    '{0}  {1}  {2} bytes' -f $n, (Get-FileHash $f -Algorithm SHA256).Hash.ToLower(), (Get-Item $f).Length
}
Write-Host "Cargador propio instalado en $dest" -ForegroundColor Green
