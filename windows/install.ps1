if ($PSVersionTable.PSVersion.Major -lt 5 -or ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1)) {
    Write-Host "OpenCode Zenith requires Windows PowerShell 5.1 or higher." -ForegroundColor Red
    return
}
<#
  OpenCode setup for Windows 10/11.

  Installs (only what is missing): Git, Node.js, Python, ripgrep, fd, OpenCode, OmniRoute.
  Copies the OpenCode rules, agents, commands, skills and plugins, the model
  ranking harness, and registers the background parts:
    - OmniRoute gateway and the model sentinel start hidden at every login
    - the model benchmark runs daily at 04:00 (or as soon as the PC is on after that)
  API keys are typed by you during setup and stored only on this PC, as user
  environment variables. Nothing from the person who built this bundle is included.

  Run it through install.bat. Options:
    -SkipPrograms   do not install missing programs (only copy and configure)
    -NoOmniRoute    skip the OmniRoute part
#>
$SkipPrograms = $false
$NoOmniRoute = $false

if ($env:ZENITH_SKIP_PROGRAMS -eq '1' -or $env:SKIP_PROGRAMS -eq '1') { $SkipPrograms = $true }
if ($env:ZENITH_NO_OMNIROUTE -eq '1' -or $env:NO_OMNIROUTE -eq '1') { $NoOmniRoute = $true }

if ($args) {
    foreach ($arg in $args) {
        if ($arg -match '^[-/]?SkipPrograms$') { $SkipPrograms = $true }
        if ($arg -match '^[-/]?NoOmniRoute$') { $NoOmniRoute = $true }
    }
}

try { Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue } catch {}

# Not 'Stop': Windows PowerShell 5.1 turns any stderr line of a redirected native
# program (npm/node/opencode notices) into a fatal error. Steps that must not fail
# use -ErrorAction Stop explicitly and every native call checks $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Here = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { (Get-Location).ProviderPath } else { $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($Here)) { $Here = $env:TEMP }

$ConfigSrc = Join-Path $Here '..\config'
$TempDownload = $null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path (Join-Path $ConfigSrc 'opencode.json.template'))) {
    Write-Host "    [+] Fetching latest Opencode Zenith release..." -ForegroundColor Cyan
    $TempZip = Join-Path $env:TEMP "opencode-zenith-$Stamp.zip"
    $TempFolder = Join-Path $env:TEMP "opencode-zenith-$Stamp"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://github.com/Mimogu/opencode-zenith/archive/refs/heads/main.zip" -OutFile $TempZip
        Expand-Archive -Path $TempZip -DestinationPath $TempFolder -Force
        Remove-Item -Force $TempZip -ErrorAction SilentlyContinue

        $found = Get-ChildItem -Path $TempFolder -Filter 'opencode.json.template' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $ConfigSrc = $found.DirectoryName
        } else {
            $ConfigSrc = Join-Path $TempFolder "opencode-zenith-main\config"
        }
        $TempDownload = $TempFolder
    } catch {
        Write-Host "    FAIL Could not download Opencode Zenith release: $($_.Exception.Message)" -ForegroundColor Red
        if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
            throw "Installation failed: $($_.Exception.Message)"
        } else {
            exit 1
        }
    }
}

$OmniRouteVersion = 'latest'
$OmniPort = 20128
$LogFile = Join-Path $env:TEMP "opencode-setup-$Stamp.log"
Start-Transcript -Path $LogFile -Append | Out-Null

function Step($m)  { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "    OK   $m" -ForegroundColor Green }
function Info($m)  { Write-Host "         $m" }
function Warn($m)  { Write-Host "    WARN $m" -ForegroundColor Yellow }
function Fail($m)  {
    Write-Host "    FAIL $m" -ForegroundColor Red
    Write-Host "    Full log: $LogFile"
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        throw "Setup stopped: $m"
    } else {
        exit 1
    }
}
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Ask-YesNo([string]$q, [bool]$default = $true) {
    if (-not [Environment]::UserInteractive -or $env:ZENITH_NON_INTERACTIVE -eq '1') { return $default }
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $a = (Read-Host "    $q $hint").Trim().ToLower()
        if ($a -eq '') { return $default }
        if ($a -in @('y', 'yes')) { return $true }
        if ($a -in @('n', 'no')) { return $false }
    }
}
function Read-Secret([string]$prompt) {
    if (-not [Environment]::UserInteractive -or $env:ZENITH_NON_INTERACTIVE -eq '1') { return '' }
    try {
        $s = Read-Host -AsSecureString "    $prompt"
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } catch {
        return ''
    }
}
function Refresh-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$u;$m"
    foreach ($extra in @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links",
        "$env:APPDATA\npm",
        "$env:ProgramFiles\nodejs"
    )) {
        if ((Test-Path $extra) -and ($env:Path -notlike "*$extra*")) {
            $env:Path = "$extra;" + $env:Path
        }
    }
}
function npm {
    $c = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $c -and (Test-Path "$env:ProgramFiles\nodejs\npm.cmd")) {
        $c = Get-Item "$env:ProgramFiles\nodejs\npm.cmd"
    }
    if ($c) {
        $exe = if ($c.Source) { $c.Source } else { $c.FullName }
        & $exe @args
    } else {
        & (Get-Command npm -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1) @args
    }
}
function npx {
    $c = (Get-Command npx.cmd -ErrorAction SilentlyContinue)
    if (-not $c -and (Test-Path "$env:ProgramFiles\nodejs\npx.cmd")) {
        $c = Get-Item "$env:ProgramFiles\nodejs\npx.cmd"
    }
    if ($c) {
        $exe = if ($c.Source) { $c.Source } else { $c.FullName }
        & $exe @args
    } else {
        & (Get-Command npx -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1) @args
    }
}
function Get-NpmRoot {
    try {
        $r = (& npm root -g 2>$null | Select-Object -First 1)
        if ($r -and (Test-Path $r.Trim())) { return $r.Trim() }
    } catch {}
    $appData = [Environment]::GetFolderPath('ApplicationData')
    $fallback = Join-Path $appData 'npm\node_modules'
    if (Test-Path $fallback) { return $fallback }
    $progFiles = Join-Path $env:ProgramFiles 'nodejs\node_modules'
    if (Test-Path $progFiles) { return $progFiles }
    return $null
}
function Set-UserEnv([string]$name, [string]$value) {
    [Environment]::SetEnvironmentVariable($name, $value, 'User')
    Set-Item -Path "Env:$name" -Value $value
}
function Add-UserPath([string]$dir, [switch]$Prepend) {
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($u -split ';' | Where-Object { $_ -and $_ -ne $dir })
    if ($Prepend) {
        $parts = @($dir) + $parts
    } elseif ($parts -notcontains $dir) {
        $parts = $parts + @($dir)
    }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
    Refresh-Path
}

# ----------------------------------------------------------------- checks
Step 'Checking the bundle'
if (-not (Test-Path $ConfigSrc)) {
    Fail "Configuration bundle could not be found at $ConfigSrc. Extract the whole zip, then run install.bat from the extracted folder."
}
if (Test-Path $ConfigSrc) { Get-ChildItem -Path $ConfigSrc -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue }
Ok "bundle found at $ConfigSrc"
Info "log file: $LogFile"

# ----------------------------------------------------------------- programs
function Find-Python {
    # the python.org launcher knows the real interpreter; "python" may be the Microsoft Store stub
    if (Have 'py') {
        try {
            $p = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
            if ($p -and (Test-Path $p)) { return $p }
        } catch {}
    }
    foreach ($c in @(Get-Command python -All -ErrorAction SilentlyContinue)) {
        if ($c.Source -notmatch 'WindowsApps') { return $c.Source }
    }
    return $null
}
function Node-Major {
    if (-not (Have 'node')) { return 0 }
    try { return [int]((& node --version) -replace '^v(\d+).*', '$1') } catch { return 0 }
}

$Programs = @(
    @{ Name = 'Git (includes Git Bash)'; Id = 'Git.Git';                  Test = { Have 'git' } },
    @{ Name = 'Node.js LTS';            Id = 'OpenJS.NodeJS.LTS';        Test = { $n = Node-Major; ($n -ge 22 -and $n -ne 23 -and $n -lt 27) } },
    @{ Name = 'Python 3';               Id = 'Python.Python.3.13';       Test = { [bool](Find-Python) };
       Override = '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0' },
    @{ Name = 'ripgrep (rg)';           Id = 'BurntSushi.ripgrep.MSVC';  Test = { Have 'rg' } },
    @{ Name = 'fd';                     Id = 'sharkdp.fd';               Test = { Have 'fd' } }
)

Step 'Checking required programs'
Refresh-Path
$missing = @($Programs | Where-Object { -not (& $_.Test) })
foreach ($p in $Programs) {
    if ($missing -contains $p) { Warn "$($p.Name): missing" } else { Ok "$($p.Name)" }
}
if ($missing.Count -gt 0) {
    if ($SkipPrograms) { Fail 'Programs are missing and -SkipPrograms was given.' }
    if (-not (Have 'winget')) {
        Fail "winget is not available. Install 'App Installer' from the Microsoft Store, then run install.bat again."
    }
    if (-not (Ask-YesNo "Install the missing programs now with winget? (Windows may ask for permission)")) {
        Fail 'The missing programs are required.'
    }
    foreach ($p in $missing) {
        Info "installing $($p.Name) ..."
        $wgArgs = @('install', '--id', $p.Id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
        if ($p.Override) { $wgArgs += @('--override', $p.Override) }
        & winget @wgArgs
        Refresh-Path
        if (& $p.Test) { Ok "$($p.Name) installed" }
        else { Fail "$($p.Name) did not install correctly (winget exit $LASTEXITCODE). Install it manually and run install.bat again." }
    }
}
$Python = Find-Python
if (-not $Python) { Fail 'Python was installed but cannot be found. Open a new window and run install.bat again.' }
Add-UserPath (Split-Path $Python)
$PythonW = Join-Path (Split-Path $Python) 'pythonw.exe'
if (-not (Test-Path $PythonW)) { $PythonW = $Python }
Ok "Python: $Python"

# Ensure graphify CLI is available for on-demand knowledge graph extraction
if (-not (Have 'graphify')) {
    Info "installing Graphify CLI for on-demand codebase knowledge graphs..."
    try {
        & $Python -m pip install -q --user graphifyy 2>$null
        Refresh-Path
    } catch {}
}
if (Have 'graphify') { Ok "Graphify CLI ready (on-demand /graphify skill)" }

# ----------------------------------------------------------------- opencode
Step 'OpenCode'

function Get-OpenCodeVer([string]$cmdPath = 'opencode') {
    try {
        $vStr = (& $cmdPath --version 2>$null | Select-Object -First 1)
        if ($vStr -match 'v?(\d+)\.(\d+)\.(\d+)') {
            return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
        }
    } catch {}
    return $null
}

function Find-ValidOpenCode {
    $candidates = @()
    foreach ($cmdName in @('opencode2', 'opencode')) {
        foreach ($c in @(Get-Command $cmdName -All -ErrorAction SilentlyContinue)) {
            $v = Get-OpenCodeVer $c.Source
            if ($v) { $candidates += @{ Name = $cmdName; Path = $c.Source; Version = $v } }
        }
    }
    $wellKnown = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\opencode.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\opencode2.exe",
        "$env:APPDATA\npm\opencode.cmd",
        "$env:APPDATA\npm\opencode"
    )
    foreach ($p in $wellKnown) {
        if (Test-Path $p) {
            $v = Get-OpenCodeVer $p
            if ($v) { $candidates += @{ Name = 'opencode'; Path = $p; Version = $v } }
        }
    }
    $v2 = @($candidates | Where-Object { $_.Version.Major -ge 2 } | Sort-Object { $_.Version } -Descending)
    if ($v2.Count -gt 0) { return $v2[0] }
    if ($candidates.Count -gt 0) { return ($candidates | Sort-Object { $_.Version } -Descending)[0] }
    return $null
}

$oc = Find-ValidOpenCode

# Detect if legacy OpenCode 1.x is present in PATH and attempt cleanup
foreach ($c in @(Get-Command opencode -All -ErrorAction SilentlyContinue)) {
    $v = Get-OpenCodeVer $c.Source
    if ($v -and ($v.Major -lt 2)) {
        Warn "Detected legacy OpenCode $($v) at $($c.Source). OpenCode Zenith requires OpenCode 2.x."
        if ($c.Source -like '*chocolatey*') {
            Info 'Removing outdated Chocolatey opencode package...'
            if (Have 'choco') {
                try { & choco uninstall opencode -y 2>$null | Out-Null } catch {}
            }
            if (Test-Path $c.Source) {
                Remove-Item $c.Source -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# If missing or outdated (e.g. legacy OpenCode 1.x like 1.18.30 from Chocolatey)
if (-not $oc -or ($oc.Version.Major -lt 2)) {
    Info 'Installing/upgrading to OpenCode 2 (@opencode/cli) ...'
    $installed = $false

    if (Have 'winget') {
        try {
            & winget install --id Anomaly.OpenCode -e --silent --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
            Refresh-Path
            $oc = Find-ValidOpenCode
            if ($oc -and ($oc.Version.Major -ge 2)) { $installed = $true }
        } catch {}
    }

    if (-not $installed -and (Have 'npm')) {
        & npm uninstall -g opencode-ai 2>$null | Out-Null
        & npm install -g @opencode/cli@latest
        Refresh-Path
        $npmBin = (& npm prefix -g 2>$null).Trim()
        if ($npmBin) {
            Add-UserPath $npmBin -Prepend
            $env:Path = "$npmBin;" + $env:Path
        }
        $oc = Find-ValidOpenCode
    }
}

if (-not $oc) { Fail 'OpenCode is not on PATH after installing. Open a new window and run install.bat again.' }
if ($oc.Version.Major -lt 2) {
    Fail "OpenCode 2.x is required for Zenith (found $($oc.Version) at $($oc.Path)). Run 'npm install -g @opencode/cli@latest' to update."
}

$OpenCodeExe = $oc.Path
$ocDir = Split-Path $OpenCodeExe
if ($ocDir) {
    Add-UserPath $ocDir -Prepend
    $env:Path = "$ocDir;" + $env:Path
}

# npm installs a .cmd shim; arguments through cmd.exe get mangled, so the harness
# calls the real entry point (node + the package's bin script) when there is one
$OpenCodeCmd = @($OpenCodeExe)
try {
    $npmRoot = Get-NpmRoot
    if ($npmRoot) {
        $ocPkg = Join-Path $npmRoot '@opencode\cli\package.json'
        if (-not (Test-Path $ocPkg)) {
            $ocPkg = Join-Path $npmRoot 'opencode-ai\package.json'
        }
        if (Test-Path $ocPkg) {
            $pkg = Get-Content $ocPkg -Raw | ConvertFrom-Json
            $bin = if ($pkg.bin -is [string]) { $pkg.bin } else { $pkg.bin.opencode }
            $binPath = Join-Path (Split-Path $ocPkg) $bin
            if ($bin -and (Test-Path $binPath)) {
                if ($binPath -match '\.exe$') { $OpenCodeCmd = @($binPath) }
                else { $OpenCodeCmd = @((Get-Command node).Source, $binPath) }
            }
        }
    }
} catch {}
Ok "OpenCode $($oc.Version) at $OpenCodeExe"

# where this OpenCode keeps its config and data
$paths = @{}
foreach ($line in (& $OpenCodeExe debug paths 2>$null)) {
    if ($line -match '^\s*(\w+)\s+(.+?)\s*$') { $paths[$Matches[1]] = $Matches[2] }
}
$ConfigDir = if ($paths['config']) { $paths['config'] } else { Join-Path $env:USERPROFILE '.config\opencode' }
$DataDir = if ($paths['data']) { $paths['data'] } else { Join-Path $env:USERPROFILE '.local\share\opencode' }
$LogDir = if ($paths['log']) { $paths['log'] } else { Join-Path $DataDir 'log' }
Ok "config folder: $ConfigDir"

# ----------------------------------------------------------------- config files
Step 'Installing rules, agents, skills and plugins'
if ((Test-Path $ConfigDir) -and (Get-ChildItem $ConfigDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    $backup = "$ConfigDir.backup-$Stamp"
    Copy-Item -Path $ConfigDir -Destination $backup -Recurse -Force -ErrorAction Stop
    Ok "existing config backed up to $backup"
}
try {
    New-Item -ItemType Directory -Force -Path $ConfigDir -ErrorAction Stop | Out-Null
    Copy-Item -Path (Join-Path $ConfigSrc '*') -Destination $ConfigDir -Recurse -Force -ErrorAction Stop
    $pycache = Join-Path $ConfigDir '__pycache__'
    if (Test-Path $pycache) { Remove-Item $pycache -Recurse -Force -ErrorAction SilentlyContinue }
    $testPycache = Join-Path $ConfigDir 'tests\__pycache__'
    if (Test-Path $testPycache) { Remove-Item $testPycache -Recurse -Force -ErrorAction SilentlyContinue }
    $targetVbs = Join-Path $ConfigDir 'run-hidden.vbs'
    $vbsCandidates = @(
        (Join-Path $Here 'run-hidden.vbs'),
        (Join-Path $Here 'windows\run-hidden.vbs'),
        (Join-Path (Split-Path $ConfigSrc) 'windows\run-hidden.vbs')
    )
    $foundVbs = $vbsCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($foundVbs) {
        Copy-Item -Path $foundVbs -Destination $targetVbs -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $targetVbs)) {
        $vbsCode = @'
' Start a program with no console window (used by the scheduled tasks).
' Usage: wscript.exe run-hidden.vbs <program> [args...]
Set shell = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
    arg = WScript.Arguments(i)
    If InStr(arg, " ") > 0 Then arg = Chr(34) & arg & Chr(34)
    cmd = cmd & arg & " "
Next
shell.Run Trim(cmd), 0, False
'@
        [IO.File]::WriteAllText($targetVbs, $vbsCode, (New-Object System.Text.UTF8Encoding $false))
    }
    Info 'Setting up OpenCode Browse (real browser automation)...'
    $localBin = Join-Path $env:USERPROFILE '.local\bin'
    Add-UserPath $localBin -Prepend
    if (-not (Have 'browse')) {
        try {
            & ([scriptblock]::Create((irm https://opencode.ai/browse/install.ps1))) -a opencode --no-wait
            Refresh-Path
        } catch {
            Warn "Could not automatically download browse CLI: $_"
        }
    } else {
        try {
            & browse install -a opencode --no-wait
        } catch {}
    }

    $tpl = Join-Path $ConfigDir 'opencode.json.template'
    if (Test-Path $tpl) {
        $posixConfig = $ConfigDir.Replace('\', '/')
        $targetJson = (Join-Path $ConfigDir 'opencode.json').Replace('\', '/')
        $posixTpl = $tpl.Replace('\', '/')

        $pyCode = @"
import json, os, urllib.request

p = r'$targetJson'
tpl = r'$posixTpl'
with open(tpl, 'r', encoding='utf-8') as f:
    text = f.read().replace('{{CONFIG_DIR}}', r'$posixConfig').replace('\"python3\"', '\"python\"')
    data = json.loads(text)

mcp = data.get('mcp', {})
if 'servers' in mcp:
    mcp = mcp['servers']

# Graphify is strictly operated on-demand via the /graphify skill (not as a persistent MCP server)
# to avoid token-taxing tool schema bloat on every turn, single-project locking, and port conflicts.
if 'graphify' in mcp:
    del mcp['graphify']

# Remove legacy persistent browser MCP servers (replaced by official browse extension MCP)
for legacy in ['my-browser', 'my-firefox', 'camofox']:
    if legacy in mcp:
        del mcp[legacy]

if 'browse' not in mcp:
    mcp['browse'] = {
        'type': 'local',
        'command': ['browse', 'mcp'],
        'enabled': True,
        'timeout': 60000
    }

if os.path.isfile(p):
    try:
        with open(p, 'r', encoding='utf-8') as ef:
            old_data = json.load(ef)
            for k, v in old_data.items():
                if k not in ('permission', 'permissions'):
                    data[k] = v
    except Exception:
        pass

with open(p, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
"@
        try {
            & $Python -c $pyCode 2>$null
        } catch {}

        $targetConfig = Join-Path $ConfigDir 'opencode.json'
        if (-not (Test-Path $targetConfig)) {
            $content = Get-Content $tpl -Raw
            $content = $content.Replace('{{CONFIG_DIR}}', $posixConfig).Replace('"python3"', '"python"')
            [IO.File]::WriteAllText($targetConfig, $content, (New-Object System.Text.UTF8Encoding $false))
        }
    }
} catch { Fail "could not copy the config into ${ConfigDir}: $($_.Exception.Message)" }
$pathsJson = @{
    config = $ConfigDir; data = $DataDir; log = $LogDir
    db = (Join-Path $DataDir 'opencode.db'); bin = $OpenCodeExe; cmd = $OpenCodeCmd
} | ConvertTo-Json
# Windows PowerShell's -Encoding UTF8 adds a BOM; write plain UTF-8 instead
[IO.File]::WriteAllText((Join-Path $ConfigDir 'paths.json'), $pathsJson, (New-Object System.Text.UTF8Encoding $false))

# Install opencode and opencode2 command shims in $ConfigDir\bin
$binDir = Join-Path $ConfigDir 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$shimContent = "@echo off`r`n`"$OpenCodeExe`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $binDir 'opencode.cmd'), $shimContent, [System.Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $binDir 'opencode2.cmd'), $shimContent, [System.Text.Encoding]::ASCII)
Add-UserPath $binDir -Prepend
$env:Path = "$binDir;" + $env:Path

New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir 'state') | Out-Null
$skillCount = @(Get-ChildItem (Join-Path $ConfigDir 'skills') -Directory).Count
Ok "installed $skillCount skills, agents, commands and plugins"

$debugOut = @(& $OpenCodeExe debug config --standalone 2>&1)
if ($LASTEXITCODE -ne 0) {
    $debugOut = @(& $OpenCodeExe debug config 2>&1)
}
if ($LASTEXITCODE -ne 0) {
    Write-Host ($debugOut -join "`n") -ForegroundColor Red
    Fail 'OpenCode rejected the installed config (opencode debug config failed).'
}
Ok 'OpenCode accepts the config'

# ----------------------------------------------------------------- omniroute
$OmniMjs = $null
if (-not $NoOmniRoute) {
    Step "OmniRoute gateway ($OmniRouteVersion)"
    Refresh-Path
    $npmRoot = Get-NpmRoot
    $OmniMjs = if ($npmRoot) { Join-Path $npmRoot 'omniroute\bin\omniroute.mjs' } else { $null }
    if (-not $OmniMjs -or -not (Test-Path $OmniMjs)) {
        Info 'installing OmniRoute (npm) ...'
        & npm install -g "omniroute@$OmniRouteVersion"
        Refresh-Path
        $npmRoot = Get-NpmRoot
        $OmniMjs = if ($npmRoot) { Join-Path $npmRoot 'omniroute\bin\omniroute.mjs' } else { $null }
        if (-not $OmniMjs -or -not (Test-Path $OmniMjs)) { Fail 'OmniRoute did not install (npm install -g omniroute failed).' }
    }
    Ok "OmniRoute at $OmniMjs"

    function Omni { & node $OmniMjs @args }
    function Omni-Up {
        try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$OmniPort/" | Out-Null; return $true }
        catch { return [bool]($_.Exception.Response) }  # any HTTP answer means it is listening
    }
    if (-not (Omni-Up)) {
        $vbs = Join-Path $ConfigDir 'run-hidden.vbs'
        if (Test-Path $vbs) {
            Start-Process -FilePath 'wscript.exe' -ArgumentList @("`"$vbs`"", 'node', "`"$OmniMjs`"", 'serve', '--no-open')
        } else {
            Start-Process -FilePath 'node.exe' -ArgumentList @("`"$OmniMjs`"", 'serve', '--no-open') -WindowStyle Hidden
        }
        Info 'starting OmniRoute ...'
        $up = $false
        for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if (Omni-Up) { $up = $true; break } }
        if (-not $up) { Warn 'OmniRoute did not answer within 30 seconds; it will start at the next login. Continuing.' }
    }
    if (Omni-Up) { Ok "OmniRoute is running on http://localhost:$OmniPort" }

    Step 'OmniRoute keys'
    $omniDb = Join-Path $env:USERPROFILE '.omniroute\storage.sqlite'
    if ((Test-Path $omniDb) -or (Omni-Up)) {
        Ok 'Existing OmniRoute setup detected'
        $pw1 = Read-Secret 'OmniRoute admin password (Enter = keep current password)'
        if ($pw1) {
            if ($pw1.Length -lt 8) {
                Warn 'Password must be at least 8 characters. Keeping current password.'
            } else {
                Omni setup --non-interactive --password $pw1
                if ($LASTEXITCODE -eq 0) { Ok 'admin password updated' } else { Warn "could not update password; keeping current" }
            }
        } else {
            Ok 'Current OmniRoute admin password preserved'
        }
        $pw1 = $null
    } else {
        Info 'Choose an admin password for the OmniRoute dashboard (typing is hidden).'
        while ($true) {
            $pw1 = Read-Secret 'OmniRoute admin password (Enter = skip)'
            if (-not $pw1) {
                Info 'Skipped setting admin password (set it in the dashboard anytime).'
                break
            }
            if ($pw1.Length -lt 8) { Warn 'Use at least 8 characters.'; continue }
            $pw2 = Read-Secret 'Repeat the password'
            if ($pw1 -ne $pw2) { Warn 'The passwords do not match.'; continue }
            break
        }
        if ($pw1) {
            Omni setup --non-interactive --password $pw1
            if ($LASTEXITCODE -eq 0) { Ok 'admin password set' } else { Warn "could not set the password (exit $LASTEXITCODE); set it in the dashboard instead" }
        }
        $pw1 = $null; $pw2 = $null
    }

    # Detect existing keys from free-models.env or user environment
    $envFile = Join-Path $ConfigDir 'free-models.env'
    $envMap = @{}
    if (Test-Path $envFile) {
        foreach ($line in (Get-Content $envFile)) {
            if ($line -match '^\s*([A-Za-z0-9_]+)=(.*)$') {
                $val = $Matches[2].Trim()
                if ($val -and -not $val.StartsWith('sk-your-') -and -not $val.StartsWith('nvapi-your-') -and -not $val.StartsWith('omni-your-')) {
                    $envMap[$Matches[1]] = $val
                }
            }
        }
    }

    function Mask-Key($k) {
        if (-not $k -or $k.Length -le 8) { return '***' }
        return ($k.Substring(0, [Math]::Min(6, $k.Length)) + '...' + $k.Substring($k.Length - [Math]::Min(4, $k.Length)))
    }

    $existingNv = [Environment]::GetEnvironmentVariable('NVIDIA_API_KEY', 'User')
    if (-not $existingNv -and $envMap.ContainsKey('NVIDIA_API_KEY')) {
        $existingNv = $envMap['NVIDIA_API_KEY']
        Set-UserEnv 'NVIDIA_API_KEY' $existingNv
    }
    Write-Host ''
    if ($existingNv) {
        $m = Mask-Key $existingNv
        Info "Existing NVIDIA_API_KEY detected ($m)."
        $nvKey = Read-Secret 'NVIDIA API key (Enter = keep current key)'
        if ($nvKey) {
            $existingNv = $nvKey
            Set-UserEnv 'NVIDIA_API_KEY' $nvKey
            $env:NVIDIA_API_KEY = $nvKey
            Ok 'NVIDIA_API_KEY updated for OpenCode'
            Omni setup --non-interactive --add-provider --provider nvidia --provider-name 'NVIDIA NIM' --api-key $nvKey 2>$null | Out-Null
        } else {
            Ok 'Current NVIDIA_API_KEY preserved'
        }
        $nvKey = $null
    } else {
        Info 'NVIDIA NIM powers the flagship Nemotron 3.5 Super VL model (free tier).'
        Info 'Create a free key at https://build.nvidia.com, or press Enter to skip.'
        $nvKey = Read-Secret 'NVIDIA API key (Enter = skip)'
        if ($nvKey) {
            $existingNv = $nvKey
            Set-UserEnv 'NVIDIA_API_KEY' $nvKey
            $env:NVIDIA_API_KEY = $nvKey
            Ok 'NVIDIA_API_KEY saved for OpenCode'
            Omni setup --non-interactive --add-provider --provider nvidia --provider-name 'NVIDIA NIM' --api-key $nvKey 2>$null | Out-Null
        } else { Info 'skipped NVIDIA (existing settings preserved)' }
        $nvKey = $null
    }

    $existingOr = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')
    if (-not $existingOr -and $envMap.ContainsKey('OPENROUTER_API_KEY')) {
        $existingOr = $envMap['OPENROUTER_API_KEY']
        Set-UserEnv 'OPENROUTER_API_KEY' $existingOr
    }
    Write-Host ''
    if ($existingOr) {
        $m = Mask-Key $existingOr
        Info "Existing OPENROUTER_API_KEY detected ($m)."
        $orKey = Read-Secret 'OpenRouter API key (Enter = keep current key)'
        if ($orKey) {
            $existingOr = $orKey
            Set-UserEnv 'OPENROUTER_API_KEY' $orKey
            $env:OPENROUTER_API_KEY = $orKey
            Ok 'OPENROUTER_API_KEY updated for OpenCode'
            Omni setup --non-interactive --add-provider --provider openrouter --provider-name OpenRouter --api-key $orKey --test-provider
            if ($LASTEXITCODE -eq 0) { Ok 'OpenRouter connected to OmniRoute' } else { Warn 'could not add OpenRouter to OmniRoute; add it in the dashboard' }
        } else {
            Ok 'Current OPENROUTER_API_KEY preserved'
        }
        $orKey = $null
    } else {
        Info 'OpenRouter gives free fallback models when the OpenCode free allowance runs out.'
        Info 'Create a free key at https://openrouter.ai/keys, or press Enter to skip.'
        $orKey = Read-Secret 'OpenRouter API key (Enter = skip)'
        if ($orKey) {
            $existingOr = $orKey
            Set-UserEnv 'OPENROUTER_API_KEY' $orKey
            $env:OPENROUTER_API_KEY = $orKey
            Ok 'OPENROUTER_API_KEY saved for OpenCode'
            Omni setup --non-interactive --add-provider --provider openrouter --provider-name OpenRouter --api-key $orKey --test-provider
            if ($LASTEXITCODE -eq 0) { Ok 'OpenRouter connected to OmniRoute' } else { Warn 'could not add OpenRouter to OmniRoute; add it in the dashboard' }
        } else { Info 'skipped OpenRouter (existing settings preserved)' }
        $orKey = $null
    }

    $existingOmni = [Environment]::GetEnvironmentVariable('OMNIROUTE_API_KEY', 'User')
    if (-not $existingOmni -and $envMap.ContainsKey('OMNIROUTE_API_KEY')) {
        $existingOmni = $envMap['OMNIROUTE_API_KEY']
        Set-UserEnv 'OMNIROUTE_API_KEY' $existingOmni
    }
    Write-Host ''
    if ($existingOmni) {
        $m = Mask-Key $existingOmni
        Info "Existing OMNIROUTE_API_KEY detected ($m)."
        $omniKey = Read-Secret 'OmniRoute API key (Enter = keep current key)'
        if ($omniKey) {
            $existingOmni = $omniKey
            Set-UserEnv 'OMNIROUTE_API_KEY' $omniKey
            $env:OMNIROUTE_API_KEY = $omniKey
            Ok 'OMNIROUTE_API_KEY updated for OpenCode'
        } else {
            Ok 'Current OMNIROUTE_API_KEY preserved'
        }
        $omniKey = $null
    } else {
        Info "Now the OmniRoute dashboard opens in your browser (http://localhost:$OmniPort)."
        Info '  1. Log in with your admin password.'
        Info '  2. Optional: Providers -> add the AI accounts you want to route through OmniRoute'
        Info '     (for example Antigravity / Google login). The combos below use those models.'
        Info '  3. API Keys -> create a key, copy it, and come back to this window.'
        Start-Process "http://localhost:$OmniPort"
        $omniKey = Read-Secret 'Paste the OmniRoute API key (Enter = skip)'
        if ($omniKey) {
            $existingOmni = $omniKey
            Set-UserEnv 'OMNIROUTE_API_KEY' $omniKey
            $env:OMNIROUTE_API_KEY = $omniKey
            Ok 'OMNIROUTE_API_KEY saved for OpenCode'
        } else { Warn 'no OmniRoute key: OpenCode can only use OmniRoute after you set OMNIROUTE_API_KEY' }
        $omniKey = $null
    }

    Step 'OmniRoute combos'
    $combosFile = Join-Path $ConfigSrc 'omniroute-combos.json'
    if (Test-Path $combosFile) {
        if ($env:OMNIROUTE_API_KEY) {
            $existing = @()
            try {
                $rawList = & Omni combo list --output json 2>$null | Out-String
                if (-not $rawList) { $rawList = & Omni combo list --json 2>$null | Out-String }
                if ($rawList -match '(?s)(\{.*\})') {
                    $parsed = $Matches[1] | ConvertFrom-Json
                    if ($parsed -is [Array]) { $existing = @($parsed | ForEach-Object { $_.name }) }
                    elseif ($parsed.combos) { $existing = @($parsed.combos | ForEach-Object { $_.name }) }
                }
            } catch {}
            foreach ($c in (Get-Content $combosFile -Raw | ConvertFrom-Json)) {
                if ($existing -contains $c.name) { Ok "combo $($c.name) already exists"; continue }
                $createRes = & Omni combo create $c.name --strategy $c.strategy --models ($c.models -join ',') 2>&1 | Out-String
                if ($LASTEXITCODE -eq 0 -or $createRes -match 'already exists') {
                    Ok "combo $($c.name) ready"
                } else {
                    Warn "could not create $($c.name); create it in the dashboard (models: $($c.models -join ', '))"
                }
            }
        } else { Info 'skipped (requires OMNIROUTE_API_KEY)' }
    } else { Info 'skipped (no combos file)' }

    $envFile = Join-Path $ConfigDir 'free-models.env'
    $envLines = @()
    if (Test-Path $envFile) { $envLines = @(Get-Content $envFile) }
    foreach ($pair in @(
        @{ K = 'NVIDIA_API_KEY'; V = $existingNv },
        @{ K = 'OPENROUTER_API_KEY'; V = $existingOr },
        @{ K = 'OMNIROUTE_API_KEY'; V = $existingOmni }
    )) {
        if ($pair.V) {
            $found = $false
            for ($i = 0; $i -lt $envLines.Count; $i++) {
                if ($envLines[$i] -match "^$($pair.K)=") {
                    $envLines[$i] = "$($pair.K)=$($pair.V)"
                    $found = $true
                    break
                }
            }
            if (-not $found) {
                $envLines += "$($pair.K)=$($pair.V)"
            }
        }
    }
    if ($envLines.Count -gt 0) {
        [IO.File]::WriteAllText($envFile, ($envLines -join [Environment]::NewLine), (New-Object System.Text.UTF8Encoding $false))
    }
}

# ----------------------------------------------------------------- local embedding
Step 'Checking local embedding AI (Ollama)'
if (Have 'ollama') {
    Ok 'Ollama found'
    $ollamaUp = $false
    try {
        $res = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($res.StatusCode -eq 200) { $ollamaUp = $true }
    } catch {}

    if (-not $ollamaUp) {
        Info 'Ollama service is not running. Attempting to start Ollama background service...'
        try {
            Start-Process -FilePath 'ollama.exe' -ArgumentList 'serve' -WindowStyle Hidden
            for ($i = 0; $i -lt 4; $i++) {
                Start-Sleep -Seconds 1
                try {
                    $res = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
                    if ($res.StatusCode -eq 200) { $ollamaUp = $true; break }
                } catch {}
            }
        } catch {}
    }

    if ($ollamaUp) {
        $models = @()
        try { $models = @(& ollama list 2>$null) } catch {}
        if ($models -notmatch 'embeddinggemma') {
            if (Ask-YesNo 'Download recommended local embedding model (embeddinggemma, ~620MB)?' $true) {
                Info 'Pulling recommended local embedding model (embeddinggemma, ~620MB)...'
                & ollama pull embeddinggemma
                if ($LASTEXITCODE -eq 0) { Ok 'embeddinggemma pulled successfully' } else { Warn 'could not pull embeddinggemma; you can run "ollama pull embeddinggemma" later' }
            } else {
                Info 'Skipping embeddinggemma download. You can run "ollama pull embeddinggemma" anytime.'
            }
        } else {
            Ok 'embeddinggemma model is ready'
        }
    } else {
        Warn 'Ollama is installed but the background service is not running on http://127.0.0.1:11434.'
        Info 'Zenith will use built-in BM25 keyword matching for skills and memory.'
        Info 'To enable semantic embeddings anytime: start Ollama and run "ollama pull embeddinggemma". Continuing.'
    }
} else {
    Write-Host ''
    if (Ask-YesNo 'Ollama is not installed. Would you like to install Ollama and download embeddinggemma (~620MB) for vector search?' $false) {
        Step 'Installing Ollama via winget'
        & winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
        Refresh-Path
        if (Have 'ollama') {
            Ok 'Ollama installed successfully'
            try { Start-Process -FilePath 'ollama.exe' -ArgumentList 'serve' -WindowStyle Hidden } catch {}
            $wingetOllamaUp = $false
            for ($i = 0; $i -lt 5; $i++) {
                Start-Sleep -Seconds 1
                try {
                    $res = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
                    if ($res.StatusCode -eq 200) { $wingetOllamaUp = $true; break }
                } catch {}
            }
            if ($wingetOllamaUp) {
                Info 'Pulling embeddinggemma model...'
                & ollama pull embeddinggemma
                if ($LASTEXITCODE -eq 0) { Ok 'embeddinggemma model is ready' }
            } else {
                Warn 'Ollama service was not ready in time. You can run "ollama pull embeddinggemma" once started.'
            }
        } else {
            Warn 'Ollama was installed; open a new terminal or reboot to use it'
        }
    } else {
        Info 'Skipping Ollama. Zenith will use fast built-in BM25 keyword matching for skills and memory.'
        Info 'To enable semantic vector embeddings anytime: install Ollama and run "ollama pull embeddinggemma"'
    }
}

# ----------------------------------------------------------------- background
Step 'Background: sentinel, OmniRoute at login, daily model benchmark'
$vbs = Join-Path $ConfigDir 'run-hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'OpenCode-background.vbs'
$lines = @(
    "' Started at login by the OpenCode setup. Delete this file to stop it.",
    'Set shell = CreateObject("WScript.Shell")',
    ('shell.Run """' + $PythonW + '"" ""' + (Join-Path $ConfigDir 'sentinel.py') + '""", 0, False')
)
if ($OmniMjs) { $lines += ('shell.Run "node ""' + $OmniMjs + '"" serve --no-open", 0, False') }
Set-Content -Path $launcher -Value $lines -Encoding ASCII
Ok "login launcher: $launcher"

Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'sentinel\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath $PythonW -ArgumentList @("`"$(Join-Path $ConfigDir 'sentinel.py')`"") -WorkingDirectory $ConfigDir -WindowStyle Hidden
Ok 'sentinel started'
Get-Process -Name 'opencode-cli', 'OpenCode' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
try {
    $svcStatus = (& $OpenCodeExe service status 2>$null | Select-Object -First 1)
    if ($svcStatus -and $svcStatus -match '^https?://') {
        & $OpenCodeExe service restart 2>$null | Out-Null
    }
} catch {}

$taskName = 'OpenCode Model Lab'
try {
    $action = New-ScheduledTaskAction -Execute $PythonW -Argument "`"$(Join-Path $ConfigDir 'model_lab.py')`"" -WorkingDirectory $ConfigDir
    $trigger = New-ScheduledTaskTrigger -Daily -At 4am
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Ranks the free AI models for OpenCode (uses about 14 free messages a day).' -Force | Out-Null
    Ok "scheduled task '$taskName' (daily 04:00, catches up if the PC was off)"
} catch {
    & schtasks.exe /Create /F /SC DAILY /ST 04:00 /TN $taskName /TR "`"$PythonW`" `"$(Join-Path $ConfigDir 'model_lab.py')`"" | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "scheduled task '$taskName' (daily 04:00)" } else { Warn "could not create the daily benchmark task: $($_.Exception.Message)" }
}

# ----------------------------------------------------------------- verify
Step 'Verifying'
Push-Location $ConfigDir
try {
    & $Python -c "import oclib, model_lab, sentinel, lab_tasks; print('harness imports OK')"
    if ($LASTEXITCODE -ne 0) { Warn 'the Python harness failed to import' } else { Ok 'Python harness' }
    $graderOut = @(& $Python (Join-Path $ConfigDir 'tests\test_lab_tasks.py') 2>&1)
    if ($LASTEXITCODE -eq 0) { Ok 'offline grader tests pass' } else { Info ($graderOut -join "`n"); Warn 'offline grader tests failed (see log)' }
    $cands = @(& $Python model_lab.py --list 2>$null | Where-Object { $_ -match '/' })
    Ok "$($cands.Count) models available for ranking"
} finally { Pop-Location }
$agents = (& $OpenCodeExe debug agents 2>$null | Out-String)
if ($agents -match '"build"') { Ok 'OpenCode loads the agents' } else { Warn 'could not confirm the agents loaded' }

$mcpOut = @(& $OpenCodeExe mcp list 2>&1)
if ($mcpOut.Count -gt 0) {
    Ok "MCP servers ready ($($mcpOut.Count) configured):"
    foreach ($m in $mcpOut) { Info "       $m" }
} else {
    Warn 'No MCP servers listed yet. Run /reload inside OpenCode or restart the terminal.'
}

Write-Host ''
if (Ask-YesNo 'Run a quick model test now? (uses about 3 free messages, takes a few minutes)' $false) {
    Push-Location $ConfigDir
    & $Python model_lab.py --smoke
    Pop-Location
}

Write-Host ''
Write-Host '==========================================================================' -ForegroundColor Cyan
Write-Host '               🌐 OpenCode Browser Extension Setup Guide                 ' -ForegroundColor Cyan
Write-Host '==========================================================================' -ForegroundColor Cyan
Write-Host "OpenCode uses the official 'OpenCode Browse' extension to drive your real"
Write-Host 'browser without port conflicts or losing your login sessions.'
Write-Host ''
Write-Host '1. Install the Extension (Chrome Web Store):'
Write-Host '   https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg' -ForegroundColor Yellow
Write-Host ''
Write-Host '2. Browser Compatibility:'
Write-Host '   • Google Chrome & Chromium : Click "Add to Chrome"'
Write-Host '   • Brave                    : Click "Add to Brave"'
Write-Host '   • Microsoft Edge           : Click "Allow extensions from other stores",'
Write-Host '                                then click "Add to Edge"'
Write-Host '   • Opera / Vivaldi / Arc    : Installs directly from Chrome Web Store'
Write-Host ''
Write-Host '   * Note for Firefox users: Firefox does not support Chromium extensions.'
Write-Host '     Keep a Chromium-based browser (Edge, Chrome, Brave) installed for'
Write-Host '     OpenCode browser automation tasks.'
Write-Host ''
Write-Host '3. Activation:'
Write-Host '   Once installed, click the OpenCode Browse icon in your browser toolbar'
Write-Host '   once to connect it to OpenCode.'
Write-Host ''
Write-Host '4. Recommended Extension Settings:'
Write-Host '   • Right-click the Browse extension icon -> Options:'
Write-Host "     - Set 'Collapse agent groups' to 'Never' to keep tabs expanded and visible"
Write-Host '       in your tab strip (otherwise Chromium folds them into a collapsed dot).'
Write-Host "     - 'Where agents open their tabs': 'Your window' (shared) or 'Own window'."
Write-Host '==========================================================================' -ForegroundColor Cyan
Write-Host ''

if ([Environment]::UserInteractive) {
    if (Ask-YesNo 'Open the extension link in your default browser now?' $true) {
        Start-Process 'https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg'
    }
}

# ----------------------------------------------------------------- done
Step 'Done'
Info 'Open a NEW terminal window (so the new keys and PATH apply) and run:  opencode'
Info "Config folder:      $ConfigDir"
Info "Model ranking:      runs daily at 04:00 (task '$taskName'); status:  python `"$(Join-Path $ConfigDir 'oc-status.py')`""
Info "Background at login: $launcher"
if ($OmniMjs) { Info "OmniRoute dashboard: http://localhost:$OmniPort" }
Info "Setup log:          $LogFile"
Info 'To remove everything later, run uninstall.bat from this folder.'
if ($TempDownload -and (Test-Path $TempDownload)) {
    Remove-Item -Path $TempDownload -Recurse -Force -ErrorAction SilentlyContinue
}
Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    exit 0
}
