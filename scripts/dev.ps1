# Arranca la guía en local, sin Docker: API FastAPI + SQLite sirviendo también la web y los iconos.
#   pwsh scripts/dev.ps1                # arranque normal (http://127.0.0.1:8765)
#   pwsh scripts/dev.ps1 -RebuildCatalog  # vuelve a generar build/catalog.db desde las semillas y la caché
#   pwsh scripts/dev.ps1 -RebuildWeb      # vuelve a compilar web/dist
# Escucha SOLO en 127.0.0.1. Tus datos: data/user.db. La partida de Steam solo se lee con el botón «Actualizar perfil».
param([switch]$RebuildCatalog, [switch]$RebuildWeb, [int]$Port = 8765)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Creando entorno .venv..."
  python -m venv .venv
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet -r api\requirements.txt -r etl\requirements.txt
}

if ($RebuildWeb -or -not (Test-Path "web\dist\index.html")) {
  Write-Host "Compilando la web..."
  Push-Location web; npm ci; npm run build; Pop-Location
}

if ($RebuildCatalog -or -not (Test-Path "build\catalog.db")) {
  Write-Host "Generando build\catalog.db..."
  New-Item -ItemType Directory -Force build | Out-Null
  Push-Location etl; & $py -m mhw_etl load --out ..\build\catalog.db; Pop-Location
}

$env:MHW_CATALOG_DB = Join-Path $root "build\catalog.db"
$env:MHW_WEB_DIST   = Join-Path $root "web\dist"
$env:MHW_ICONS_DIR  = Join-Path $root "data\icons"
$env:MHW_PORT       = "$Port"
Set-Location api
Write-Host "Guía MHW en http://127.0.0.1:$Port  (Ctrl+C para salir)"
& $py -m app
