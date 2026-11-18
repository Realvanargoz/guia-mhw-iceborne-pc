# Auditoría S4 del instalador: instala en silencio (por usuario, en una carpeta temporal), ejecuta la comprobación
# --smoke con datos temporales, desinstala en silencio y compara el sistema antes / durante / después.
#   pwsh scripts/footprint-installer.ps1 -Setup dist\GuiaMHW-0.1.0-setup.exe
# No toca tu partida ni el juego; la carpeta de datos real (%LOCALAPPDATA%\GuiaMHW) no se crea ni se borra.
param([Parameter(Mandatory)][string]$Setup)
$ErrorActionPreference = "Stop"
# Protección: el instalador usa un AppId fijo, así que instalar/desinstalar aquí PISARÍA una instalación real tuya
# (clave de desinstalación y acceso del menú Inicio) y CloseApplications cerraría la app si la estás usando.
if (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F0B3C52-7A1D-4E55-9C0E-2B8D4A1F7E31}_is1") { throw "Guía MHW ya está instalada en este usuario. Desinstálala primero (o usa otro PC/usuario/Windows Sandbox): esta prueba no debe tocar tu instalación." }
if (Get-Process -Name GuiaMHW -ErrorAction SilentlyContinue) { throw "Hay un GuiaMHW en ejecución. Ciérralo antes de la prueba." }
$Setup = (Resolve-Path $Setup).Path
$dir = Join-Path $env:TEMP ("guiamhw-inst-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$smokeData = Join-Path $env:TEMP ("guiamhw-instdata-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$log = Join-Path $env:TEMP "guiamhw-setup.log"
function Names($p) { if (Test-Path $p) { (Get-ChildItem $p -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName } | Sort-Object) -join "|" } else { "" } }
function Snap {
  [ordered]@{
    "HKCU\Software"        = Names "HKCU:\Software"
    "HKCU\Uninstall"       = Names "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    "HKLM\Uninstall"       = Names "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    "HKCU\Run"             = ((Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object Name -notmatch '^PS' | ForEach-Object Name) -join "|"
    "Servicios"            = (Get-Service | ForEach-Object { "$($_.Name):$($_.StartType)" }) -join "|"
    "Tareas programadas"   = (Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskPath + $_.TaskName }) -join "|"
    "Reglas de firewall"   = (Get-NetFirewallRule -ErrorAction SilentlyContinue | Measure-Object).Count
    "PATH usuario"         = [Environment]::GetEnvironmentVariable("Path","User")
    "PATH máquina"         = [Environment]::GetEnvironmentVariable("Path","Machine")
    "LocalAppData"         = Names $env:LOCALAPPDATA
    "Programs"             = Names "$env:LOCALAPPDATA\Programs"
    "AppData"              = Names $env:APPDATA
    "Menú Inicio"          = Names "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    "Escritorio"           = Names "$env:USERPROFILE\Desktop"
    "Program Files"        = Names $env:ProgramFiles
  }
}
function Compare-Snap($a, $b) {
  foreach ($k in $a.Keys) {
    if ("$($a[$k])" -ne "$($b[$k])") {
      if ($a[$k] -is [string] -and $b[$k] -is [string]) {
        $x = $a[$k] -split '\|'; $y = $b[$k] -split '\|'
        "  $k  +[$((($y | Where-Object { $_ -notin $x }) -join ', '))]  -[$((($x | Where-Object { $_ -notin $y }) -join ', '))]"
      } else { "  $k  $($a[$k]) -> $($b[$k])" }
    }
  }
}
$s0 = Snap
"== Instalando en silencio en $dir =="
$p = Start-Process $Setup -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/CURRENTUSER","/DIR=`"$dir`"","/LOG=`"$log`"" -Wait -PassThru
"código de salida del instalador: $($p.ExitCode)"
$s1 = Snap
"== Cambios tras INSTALAR (esperado: solo la clave de desinstalación y el acceso del menú Inicio) =="
$d1 = Compare-Snap $s0 $s1; if ($d1) { $d1 } else { "  ninguno" }
$exe = Join-Path $dir "GuiaMHW.exe"
"exe instalado: $(Test-Path $exe); portable.txt presente: $(Test-Path (Join-Path $dir 'portable.txt')); avisos de licencias: $(Test-Path (Join-Path $dir 'THIRD_PARTY_NOTICES.txt'))"
"tamaño instalado: {0:N1} MB" -f ((Get-ChildItem $dir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
$sm = Start-Process $exe -ArgumentList "--smoke","--data-dir","`"$smokeData`"" -Wait -PassThru -NoNewWindow
"smoke de la app instalada: código $($sm.ExitCode)"
"== Desinstalando en silencio =="
$unins = Get-ChildItem $dir -Filter "unins*.exe" | Select-Object -First 1
$u = Start-Process $unins.FullName -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART" -Wait -PassThru
"código de salida del desinstalador: $($u.ExitCode)"
Start-Sleep -Seconds 3
$s2 = Snap
"== Cambios tras DESINSTALAR respecto al estado inicial (esperado: ninguno) =="
$d2 = Compare-Snap $s0 $s2; if ($d2) { $d2 } else { "  ninguno" }
"carpeta de instalación restante: $(if (Test-Path $dir) { (Get-ChildItem $dir -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object).Count.ToString() + ' elementos' } else { 'ninguna' })"
"carpeta de datos real creada o tocada (%LOCALAPPDATA%\GuiaMHW): $(Test-Path (Join-Path $env:LOCALAPPDATA 'GuiaMHW'))"
"datos de la comprobación (borrables): $smokeData ; registro del instalador: $log"
