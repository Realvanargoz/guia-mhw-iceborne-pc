<#
.SYNOPSIS
  Extrae solo nativePC\ui\ de los chunk*.bin de MHW Iceborne a data/raw/game/ (solo lectura del juego).

.DESCRIPTION
  Usa tools/bin/WorldChunkTool.exe (compilado desde el codigo fuente con tools/worldchunktool/Dockerfile).
  - Nunca escribe en la carpeta del juego: los chunk se abren con FileAccess.Read.
  - Copia la DLL de Oodle a tools/bin/ si falta (copia, no mueve ni modifica el original).
  - -Test: procesa un solo chunk (el mas pequeno, o el indicado con -Chunk) como prueba.
  - Sin -Test: procesa todos los chunk*.bin en orden numerico (-UnpackAll); los posteriores sobrescriben
    a los anteriores, que es como el juego aplica los parches.

.EXAMPLE
  ./scripts/extract-ui.ps1 -Test
  ./scripts/extract-ui.ps1 -Test -Chunk chunkG9.bin
  ./scripts/extract-ui.ps1
#>
param(
  [string]$GameDir = '',
  [string]$Out = (Join-Path $PSScriptRoot '..\data\raw\game'),
  [string]$Dll = (Join-Path $PSScriptRoot '..\tools\bin\oo2core_9_win64.dll'),
  [string]$DllSource = '',
  [string]$Filter = 'nativePC\ui\',
  [switch]$Test,
  [string]$Chunk
)
$ErrorActionPreference = 'Stop'

# Sin -GameDir: se busca la instalación del juego en las bibliotecas de Steam (solo lectura del registro).
if (-not $GameDir) {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) {
      $libs += (Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\\\', '\' })
    }
  }
  foreach ($lib in ($libs | Select-Object -Unique)) {
    $cand = Join-Path $lib 'steamapps\common\Monster Hunter World'
    if (Test-Path (Join-Path $cand 'chunk')) { $GameDir = $cand; break }
  }
  if (-not $GameDir) { throw 'No se encontró Monster Hunter World en tus bibliotecas de Steam. Indica la carpeta con -GameDir.' }
}
$binDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\tools\bin'))
$exe = Join-Path $binDir 'WorldChunkTool.exe'
$Out = [IO.Path]::GetFullPath($Out)
$Dll = [IO.Path]::GetFullPath($Dll)
$chunkDir = Join-Path $GameDir 'chunk'

if (-not (Test-Path $exe)) {
  throw "No existe $exe. Compilalo con: docker build --output type=local,dest=tools/bin tools/worldchunktool"
}
if (-not (Test-Path $chunkDir)) { throw "No existe $chunkDir" }

# Salvaguarda: la salida no puede estar dentro de la carpeta del juego.
$gameFull = [IO.Path]::GetFullPath($GameDir).TrimEnd('\') + '\'
if ($Out.StartsWith($gameFull, [StringComparison]::OrdinalIgnoreCase)) { throw "La salida ($Out) no puede estar dentro de la carpeta del juego." }

if (Get-Process -Name 'MonsterHunterWorld' -ErrorAction SilentlyContinue) {
  Write-Warning 'MonsterHunterWorld.exe esta abierto. Leer los chunk no le afecta, pero se recomienda cerrarlo (mas rapido y sin bloqueos).'
}

# DLL de Oodle: se copia a tools/bin si falta (nunca se mueve ni modifica el original).
if (-not (Test-Path $Dll)) {
  if (-not $DllSource -or -not (Test-Path $DllSource)) {
    throw "Falta $Dll. La biblioteca Oodle (oo2core_9_win64.dll) es propietaria y no se distribuye: copiala desde un juego que poseas que la incluya a tools\bin, o indicala con -DllSource."
  }
  Copy-Item -LiteralPath $DllSource -Destination $binDir
  Write-Host "DLL copiada: $DllSource -> $binDir"
}
# El exe resuelve OODLE_DLL junto a si mismo (nombre) o como ruta absoluta.
$env:OODLE_DLL = $Dll

New-Item -ItemType Directory -Force -Path $Out | Out-Null

if ($Test) {
  if ($Chunk) { $target = Join-Path $chunkDir $Chunk }
  else { $target = (Get-ChildItem -LiteralPath $chunkDir -Filter 'chunkG*.bin' | Sort-Object Length | Select-Object -First 1).FullName }
  Write-Host "Prueba con un solo chunk: $target"
  & $exe $target -Filter $Filter -Out $Out -AutoConfirm
} else {
  Write-Host "Extraccion completa de '$Filter' desde $chunkDir"
  & $exe $chunkDir -UnpackAll -Filter $Filter -Out $Out -AutoConfirm
}
$code = $LASTEXITCODE
Write-Host "WorldChunkTool termino con codigo $code"
exit $code
