<#
.SYNOPSIS  Prints sizes of build\stage parts, dist\GuiaMHW top-level folders and the portable zip(s). Read-only.
#>
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-MB($p) {
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    $i = Get-Item -LiteralPath $p
    if (-not $i.PSIsContainer) { return [math]::Round($i.Length / 1MB, 2) }
    $s = (Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum
    return [math]::Round(([double]$s) / 1MB, 2)
}

Write-Host '--- build\stage ---'
foreach ($n in 'web', 'icons', 'catalog.db', 'research') {
    $v = Get-MB (Join-Path $Root "build\stage\$n")
    '{0,-12} {1,9}' -f $n, $(if ($null -eq $v) { '-' } else { "$v MB" })
}
$app = Join-Path $Root 'dist\GuiaMHW'
if (Test-Path $app) {
    Write-Host '--- dist\GuiaMHW ---'
    '{0,-28} {1,9} MB' -f 'TOTAL', (Get-MB $app)
    foreach ($d in Get-ChildItem $app -Force) {
        if ($d.PSIsContainer -and $d.Name -eq '_internal') {
            foreach ($s in Get-ChildItem $d.FullName -Force) { '{0,-28} {1,9} MB' -f "_internal\$($s.Name)", (Get-MB $s.FullName) }
        } else { '{0,-28} {1,9} MB' -f $d.Name, (Get-MB $d.FullName) }
    }
}
Get-ChildItem (Join-Path $Root 'dist') -Filter '*.zip' -ErrorAction SilentlyContinue | ForEach-Object {
    '{0,-28} {1,9} MB  (zip)' -f $_.Name, (Get-MB $_.FullName)
}
