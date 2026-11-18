# Auditoría S4: huella de la app portable en el PC. SOLO LECTURA sobre el sistema y la carpeta de Steam.
#   pwsh scripts/footprint.ps1 -Zip dist\GuiaMHW-0.1.0-portable.zip [-NoWindow]
# Extrae el zip en una carpeta temporal, toma una foto del sistema, ejecuta la app (ventana real de Edge salvo -NoWindow),
# comprueba puertos y conexiones, cierra la ventana, comprueba que el servidor se apaga, y compara las fotos.
param([Parameter(Mandatory)][string]$Zip, [switch]$NoWindow, [int]$WaitSeconds = 12)
$ErrorActionPreference = "Stop"
# Protección: esta prueba NUNCA debe tocar una copia de la app que ya estés usando.
if (Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue) { throw "Ya hay un GuiaMHW en ejecución (¿lo estás usando?). Ciérralo y vuelve a lanzar la prueba: no toco procesos ajenos." }
$Zip = (Resolve-Path $Zip).Path
$work = Join-Path $env:TEMP ("guiamhw-s4-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory $work | Out-Null
Expand-Archive -Path $Zip -DestinationPath $work -Force
$app = Join-Path $work "GuiaMHW"
$exe = Join-Path $app "GuiaMHW.exe"

function Snap {
  $s = [ordered]@{}
  $reg = { param($p) if (Test-Path $p) { (Get-ChildItem $p -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName }) -join "|" } else { "" } }
  $s["HKCU\Software"]           = & $reg "HKCU:\Software"
  $s["HKLM\Software"]           = & $reg "HKLM:\SOFTWARE"
  $s["HKCU\Run"]                = ((Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object Name -notmatch '^PS' | ForEach-Object Name) -join "|"
  $s["HKLM\Run"]                = ((Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object Name -notmatch '^PS' | ForEach-Object Name) -join "|"
  $s["Uninstall HKCU"]          = & $reg "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  $s["Uninstall HKLM"]          = & $reg "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  $s["Servicios"]               = (Get-Service | ForEach-Object { "$($_.Name):$($_.StartType)" }) -join "|"
  $s["Tareas programadas"]      = (Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskPath + $_.TaskName }) -join "|"
  $s["Reglas de firewall"]      = (Get-NetFirewallRule -ErrorAction SilentlyContinue | Measure-Object).Count
  $s["PATH usuario"]            = [Environment]::GetEnvironmentVariable("Path","User")
  $s["PATH máquina"]            = [Environment]::GetEnvironmentVariable("Path","Machine")
  foreach ($d in @($env:LOCALAPPDATA, $env:APPDATA, "$env:USERPROFILE\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
    if ($d -and (Test-Path $d)) { $s["Carpeta $d"] = (Get-ChildItem $d -Force -ErrorAction SilentlyContinue | ForEach-Object Name | Sort-Object) -join "|" }
  }
  # Steam: SOLO metadatos (nombre, tamaño, fecha) de la carpeta de la partida y de las estadísticas; no se lee ningún contenido.
  $steam = (Get-ItemProperty "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue).SteamPath
  if ($steam) {
    foreach ($sub in @("userdata", "appcache\stats")) {
      $root = Join-Path $steam $sub
      if (Test-Path $root) {
        $s["Steam $sub (metadatos)"] = (Get-ChildItem $root -Recurse -Force -File -ErrorAction SilentlyContinue |
          Where-Object { $_.FullName -match '582010' } | Sort-Object FullName |
          ForEach-Object { "$($_.FullName.Substring($root.Length)):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" }) -join "|"
      }
    }
  }
  $gameDir = Join-Path $steam "steamapps\common\Monster Hunter World"
  if ($steam -and (Test-Path $gameDir)) {
    $s["Juego (metadatos)"] = (Get-ChildItem $gameDir -Force -File -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { "$($_.Name):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" }) -join "|"
  }
  $s
}

"== Foto previa =="
$before = Snap
"entradas: $($before.Count)"

$report = [ordered]@{}
if ($NoWindow) { $proc = Start-Process $exe -ArgumentList "--no-browser" -PassThru } else { $proc = Start-Process $exe -PassThru }
Start-Sleep -Seconds $WaitSeconds
$guia = Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue
$report["procesos GuiaMHW"] = ($guia | Measure-Object).Count
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $guia.Id -contains $_.OwningProcess }
$report["escucha"] = ($listen | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ", "
$conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $guia.Id -contains $_.OwningProcess -and $_.State -ne "Listen" }
$report["conexiones de GuiaMHW"] = ($conns | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)->$($_.RemoteAddress):$($_.RemotePort) $($_.State)" }) -join "; "
$nonLoop = $conns | Where-Object { $_.RemoteAddress -notin @("127.0.0.1","::1","0.0.0.0","::") }
$report["conexiones NO locales"] = ($nonLoop | Measure-Object).Count
$port = if ($listen) { ($listen | Select-Object -First 1).LocalPort } else { 0 }
try { $h = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5; $report["health"] = $h.StatusCode } catch { $report["health"] = "ERROR $($_.Exception.Message)" }
# Sesión con token: sin cookie la API debe dar 401; con el token del arranque (visible en la línea de comandos de Edge,
# solo para el mismo usuario) debe dar 302 + cookie y luego 200.
try { Invoke-WebRequest "http://127.0.0.1:$port/api/stats" -UseBasicParsing -TimeoutSec 5 | Out-Null; $report["API sin cookie"] = "200 (MAL)" } catch { $report["API sin cookie"] = [int]$_.Exception.Response.StatusCode }
$tokenCheck = "no comprobado (sin ventana)"
if (-not $NoWindow) {
  $edgeId = $null
  $inst0 = Join-Path (Join-Path $app "data") "instance.json"
  if (Test-Path $inst0) { try { $edgeId = (Get-Content $inst0 -Raw | ConvertFrom-Json).edge_pid } catch {} }
  $cmd = if ($edgeId) { (Get-CimInstance Win32_Process -Filter "ProcessId=$edgeId" -ErrorAction SilentlyContinue).CommandLine } else { $null }
  if ($cmd -match '\?t=([A-Za-z0-9_\-]+)') {
    $tok = $Matches[1]
    $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try { Invoke-WebRequest "http://127.0.0.1:$port/?t=$tok" -UseBasicParsing -WebSession $sess -MaximumRedirection 0 -ErrorAction Stop | Out-Null } catch { $r1 = [int]$_.Exception.Response.StatusCode }
    $c = $sess.Cookies.GetCookies("http://127.0.0.1:$port/") | Where-Object Name -eq "mhw_session"
    $r2 = try { (Invoke-WebRequest "http://127.0.0.1:$port/api/stats" -UseBasicParsing -WebSession $sess -TimeoutSec 5).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
    $bad = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $bad.Cookies.Add((New-Object System.Net.Cookie("mhw_session","incorrecta","/","127.0.0.1")))
    $r3 = try { (Invoke-WebRequest "http://127.0.0.1:$port/api/stats" -UseBasicParsing -WebSession $bad -TimeoutSec 5).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
    $tokenCheck = "entrada con token -> $r1, cookie HttpOnly=$($c.HttpOnly), API con cookie -> $r2, API con cookie falsa -> $r3"
  } else { $tokenCheck = "no se encontró el token en la línea de comandos de Edge" }
}
$report["token de sesión"] = $tokenCheck
$data = Join-Path $app "data"
$report["datos en carpeta portable"] = (Test-Path (Join-Path $data "user.db"))
$inst = Join-Path $data "instance.json"
$edgePid = $null
if (Test-Path $inst) { try { $edgePid = (Get-Content $inst -Raw | ConvertFrom-Json).edge_pid } catch {} }
$report["edge_pid"] = $edgePid

if (-not $NoWindow -and $edgePid) {
  # Cierra la ventana de la app (solo ese proceso de Edge, el del perfil propio) y espera a que el servidor se apague.
  Stop-Process -Id $edgePid -ErrorAction SilentlyContinue
} else {
  Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
}
$sw = [Diagnostics.Stopwatch]::StartNew()
while ((Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) }) -and $sw.Elapsed.TotalSeconds -lt 70) { Start-Sleep -Seconds 1 }
$report["servidor apagado tras cerrar (s)"] = if (Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) }) { "NO (>70 s)" } else { [int]$sw.Elapsed.TotalSeconds }
Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue  # solo el de la carpeta de prueba

"== Foto posterior =="
$after = Snap
$diffs = @()
foreach ($k in $before.Keys) {
  if ("$($before[$k])" -ne "$($after[$k])") {
    if ($before[$k] -is [string] -and $after[$k] -is [string] -and $k -notlike "Reglas*") {
      $b = $before[$k] -split '\|'; $a = $after[$k] -split '\|'
      $add = $a | Where-Object { $_ -notin $b }; $del = $b | Where-Object { $_ -notin $a }
      $diffs += "$k  +[$($add -join ', ')]  -[$($del -join ', ')]"
    } else { $diffs += "$k  $($before[$k]) -> $($after[$k])" }
  }
}
"== Informe =="
$report.GetEnumerator() | ForEach-Object { "{0,-36} {1}" -f $_.Key, $_.Value }
"== Archivos creados por la app dentro de su carpeta (portable) =="
Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'edge-profile' } | ForEach-Object { "{0} {1}" -f $_.FullName.Substring($app.Length), $_.Length }
"edge-profile: {0} archivos" -f (Get-ChildItem (Join-Path $data "edge-profile") -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
"== Diferencias del sistema (solo lo esperado debería aparecer: Edge actualiza sus propias claves) =="
if ($diffs.Count) { $diffs } else { "ninguna" }
"Carpeta de prueba (puedes borrarla): $work"
