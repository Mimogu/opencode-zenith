#Requires -Version 5.1
<#
  Removes what install.ps1 set up: the login launcher, the daily benchmark task,
  the running sentinel/OmniRoute processes, and (after confirmation) the OpenCode
  config folder and the saved API keys. Programs installed with winget/npm
  (Git, Node.js, Python, OpenCode, OmniRoute) are left installed.
#>
$ErrorActionPreference = 'Continue'
function Ask-YesNo([string]$q) { (Read-Host "    $q [y/N]").Trim().ToLower() -in @('y', 'yes') }

Write-Host '==> Stopping background parts' -ForegroundColor Cyan
$launcher = Join-Path ([Environment]::GetFolderPath('Startup')) 'OpenCode-background.vbs'
if (Test-Path $launcher) { Remove-Item $launcher -Force; Write-Host '    removed login launcher' }
& schtasks.exe /Delete /F /TN 'OpenCode Model Lab' 2>$null | Out-Null
Write-Host '    removed daily benchmark task (if present)'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'sentinel\.py|omniroute\.mjs' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "    stopped $($_.Name) ($($_.ProcessId))" }

$configDir = $null
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    foreach ($line in (& opencode debug paths 2>$null)) { if ($line -match '^\s*config\s+(.+?)\s*$') { $configDir = $Matches[1] } }
}
if (-not $configDir) { $configDir = Join-Path $env:USERPROFILE '.config\opencode' }

Write-Host ''
if ((Test-Path $configDir) -and (Ask-YesNo "Delete the OpenCode config folder $configDir ?")) {
    Remove-Item $configDir -Recurse -Force
    Write-Host '    deleted'
}
if (Ask-YesNo 'Remove the saved OPENROUTER_API_KEY and OMNIROUTE_API_KEY?') {
    foreach ($k in @('OPENROUTER_API_KEY', 'OMNIROUTE_API_KEY')) { [Environment]::SetEnvironmentVariable($k, $null, 'User') }
    Write-Host '    removed'
}
Write-Host ''
Write-Host 'Done. Git, Node.js, Python, OpenCode and OmniRoute are still installed; remove them from'
Write-Host 'Settings > Apps (or "npm uninstall -g @opencode/cli opencode-ai omniroute") if you no longer want them.'
