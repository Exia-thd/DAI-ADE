<#
.SYNOPSIS
  One-file installer for the DAI stack: the ADE, the harness and the memory layer.

.DESCRIPTION
  Installs into %LOCALAPPDATA%\dai-ade by default -- no administrator rights, no
  PATH surgery, nothing written outside your profile. Re-running it updates in
  place; every step is skipped when it is already done.

  What it will NOT do, by design:
    * touch ~/.claude/settings.json. On a machine running Orca those hooks
      belong to Orca. Claude Code merges user-level and project-level hooks, so
      this installs at project level and composes beside whatever is there.
    * modify the harness or memory repositories. The ADE reads what they
      already write, so updating one never breaks the other.

.PARAMETER Root
  Where the three repositories live. Default: %LOCALAPPDATA%\dai-ade

.PARAMETER Project
  The project the ADE should watch and wire hooks into. Default: current folder.

.PARAMETER SkipMemory
  Skip the memory layer entirely. Its setup downloads an embedding model and is
  the slowest part of this script by a wide margin.

.PARAMETER SkipModel
  Install the memory layer's code but not its model. The layer will refuse to
  run until `node bin/setup.mjs` is completed later; everything else works.

.PARAMETER NoLaunch
  Do not start the ADE when finished.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Project C:\code\my-repo
#>

[CmdletBinding()]
param(
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'dai-ade'),
  [string]$Project = (Get-Location).Path,
  [switch]$SkipMemory,
  [switch]$SkipModel,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$Repos = @{
  ade     = 'https://github.com/Exia-thd/DAI-ADE.git'
  harness = 'https://github.com/Exia-thd/DAI-harness.git'
  memory  = 'https://github.com/Exia-thd/DAI-memory-layer-plugin.git'
}

$script:Warnings = @()

function Say    ($m) { Write-Host "  $m" }
function Step   ($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok     ($m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn   ($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow; $script:Warnings += $m }
function Fail   ($m) { Write-Host "  [fail] $m" -ForegroundColor Red; throw $m }

function Have ($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($null -eq $c) { return $false }
  return $true
}

# Run a native command and fail loudly. PowerShell does not stop on a non-zero
# exit code from an external program, which is how half-finished installs
# happen and then get reported as "it just does not work".
function Run ($exe, $argumentList, $workDir) {
  Push-Location $workDir
  try {
    & $exe @argumentList
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($argumentList -join ' ')  (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}

Write-Host ''
Write-Host '  DAI ADE installer' -ForegroundColor White
Write-Host '  the agent development environment, its harness and its memory' -ForegroundColor DarkGray

# ---------------------------------------------------------------- preflight --
Step 'Checking prerequisites'

if (-not (Have 'git')) { Fail 'git is required. Install it from https://git-scm.com and run this again.' }
Ok "git $((git --version) -replace 'git version ','')"

if (-not (Have 'node')) { Fail 'Node.js 20.11+ is required. Install it from https://nodejs.org and run this again.' }
$nodeVersion = (node -v) -replace '^v',''
$nodeParts = $nodeVersion.Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if (($nodeMajor -lt 20) -or (($nodeMajor -eq 20) -and ($nodeMinor -lt 11))) {
  Fail "Node 20.11+ is required; found $nodeVersion"
}
Ok "node $nodeVersion"

# The harness runs on Python through the `py` launcher on Windows. `python3` is
# a Microsoft Store stub here and exits 9009 without running anything, which
# looks like success to a script that does not check.
$pythonCmd = $null
if (Have 'py') { $pythonCmd = 'py' }
elseif (Have 'python') { $pythonCmd = 'python' }
if ($null -eq $pythonCmd) {
  Warn 'No Python found. The ADE and memory layer work without it; the harness gates do not.'
} else {
  Ok "python via '$pythonCmd'"
}

# Git for Windows ships bash but does not put it on PATH, so a plain PowerShell
# session reports it missing. The first version of this script trusted that and
# silently skipped the entire harness setup -- on a machine that had bash all
# along. Derive it from git, which is already a hard requirement.
function Find-Bash {
  $onPath = Get-Command bash -ErrorAction SilentlyContinue
  if ($null -ne $onPath) { return $onPath.Source }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $git) {
    $gitRoot = Split-Path (Split-Path $git.Source -Parent) -Parent
    foreach ($rel in @('bin\bash.exe', 'usr\bin\bash.exe')) {
      $candidate = Join-Path $gitRoot $rel
      if (Test-Path $candidate) { return $candidate }
    }
  }
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe'))) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

$bashExe = Find-Bash
$hasBash = $null -ne $bashExe
if ($hasBash) { Ok "bash at $bashExe" }
else { Warn 'No bash found (Git for Windows provides it). The harness setup script will be skipped.' }

if (-not (Test-Path $Project)) { Fail "Project folder does not exist: $Project" }
$Project = (Resolve-Path $Project).Path
Ok "project to watch: $Project"

# ------------------------------------------------------------------- clone --
Step "Fetching repositories into $Root"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Sync-Repo ($name, $url) {
  $dest = Join-Path $Root $name
  if (Test-Path (Join-Path $dest '.git')) {
    Say "$name -- updating"
    Push-Location $dest
    try {
      git fetch --quiet origin
      # Never discard local work: if the checkout is dirty, leave it and say so.
      $dirty = git status --porcelain
      if ([string]::IsNullOrWhiteSpace($dirty)) {
        git merge --quiet --ff-only '@{u}' 2>$null
        if ($LASTEXITCODE -ne 0) { Warn "$name has diverged from origin; left as it is" }
      } else {
        Warn "$name has uncommitted changes; left as it is"
      }
    } finally { Pop-Location }
  } else {
    Say "$name -- cloning"
    Run 'git' @('clone', '--quiet', $url, $dest) $Root
  }
  Ok "$name at $dest"
  return $dest
}

$adeDir = Sync-Repo 'ade' $Repos.ade
$harnessDir = Sync-Repo 'harness' $Repos.harness
$memoryDir = $null
if (-not $SkipMemory) { $memoryDir = Sync-Repo 'memory' $Repos.memory }

# --------------------------------------------------------------------- ade --
Step 'Installing the ADE'
Say 'npm install (this downloads Electron, around 100 MB on a first run)'
Run 'npm' @('install', '--no-audit', '--no-fund', '--loglevel=error') $adeDir
Ok 'dependencies installed'

Say 'running the test suite'
Push-Location $adeDir
try {
  node --test "tests/*.test.js" 2>&1 | Select-String -Pattern '^. (pass|fail) ' | ForEach-Object { Say $_.Line.Trim() }
  if ($LASTEXITCODE -ne 0) { Warn 'ADE tests did not all pass -- continuing, but check `npm test`' } else { Ok 'tests pass' }
} finally { Pop-Location }

# ------------------------------------------------------------------ memory --
if (-not $SkipMemory) {
  Step 'Installing the memory layer'
  # pnpm must run from the repository root: the install-script permissions four
  # native dependencies need are declared in pnpm-workspace.yaml, which pnpm
  # only reads there. Installing from a subdirectory silently skips them and
  # the database binding then fails to load at runtime.
  if (-not (Have 'pnpm')) {
    Say 'enabling pnpm through corepack'
    corepack enable pnpm 2>$null | Out-Null
  }
  if (Have 'pnpm') {
    if ($SkipModel) {
      Say 'pnpm install (model download skipped by request)'
      Run 'pnpm' @('install', '--silent') $memoryDir
      Warn 'Memory layer installed without its model. It will refuse to run until you finish: node bin/setup.mjs'
    } else {
      Say 'node bin/setup.mjs -- dependencies, build and embedding model'
      Say 'this is the slow part; several minutes on a first run'
      Push-Location $memoryDir
      try {
        node bin/setup.mjs
        if ($LASTEXITCODE -ne 0) {
          Warn 'Memory setup did not finish. Re-run it later: node bin/setup.mjs (it resumes where it stopped)'
        } else { Ok 'memory layer ready' }
      } finally { Pop-Location }
    }
  } else {
    Warn 'pnpm unavailable and corepack could not enable it; memory layer skipped'
    $memoryDir = $null
  }
}

# ----------------------------------------------------------------- harness --
Step 'Setting up the harness in the project'
if ($hasBash) {
  $setup = Join-Path $harnessDir 'scripts/bootstrap/daiharness-setup.sh'
  if (Test-Path $setup) {
    $setupPosix = $setup -replace '\\', '/'
    $projectPosix = $Project -replace '\\', '/'
    Say 'running the harness project setup'
    # The setup script resolves its own location relatively, so it must run
    # from the harness checkout: launched from anywhere else it reported
    # `DAI Harness: .` and then failed to find ./scripts/mcp/...
    Push-Location $harnessDir
    try { & $bashExe $setupPosix $projectPosix } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Warn "harness setup exited $LASTEXITCODE -- the ADE still works; harness gates may not" }
    else { Ok 'harness configured for this project' }
  } else {
    Warn "harness setup script not found at $setup"
  }
} else {
  Warn 'skipped: needs bash'
}

# -------------------------------------------------------------------- wire --
Step 'Wiring the project'

Say 'installing the ADE event emitter (project hooks only)'
Run 'node' @('packages/shell/src/cli.js', 'install-hooks', '--project', $Project) $adeDir

# MCP servers are registered per project in .mcp.json. Merge rather than
# replace: this file may already name servers that have nothing to do with us.
$mcpPath = Join-Path $Project '.mcp.json'
$mcp = $null
if (Test-Path $mcpPath) {
  try { $mcp = Get-Content $mcpPath -Raw | ConvertFrom-Json } catch { Warn "$mcpPath is not valid JSON; left untouched" }
}
if ($null -eq $mcp) { $mcp = [pscustomobject]@{} }
if ($null -eq $mcp.PSObject.Properties['mcpServers']) {
  $mcp | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{})
}

function Set-Server ($servers, $name, $value) {
  if ($null -ne $servers.PSObject.Properties[$name]) { $servers.PSObject.Properties.Remove($name) }
  $servers | Add-Member -NotePropertyName $name -NotePropertyValue $value
}

$harnessServer = Join-Path $harnessDir 'mcp/server.py'
if ((Test-Path $harnessServer) -and ($null -ne $pythonCmd)) {
  $pyArgs = @()
  if ($pythonCmd -eq 'py') { $pyArgs = @('-3', ($harnessServer -replace '\\','/')) }
  else { $pyArgs = @(($harnessServer -replace '\\','/')) }
  Set-Server $mcp.mcpServers 'dai-harness' ([pscustomobject]@{ command = $pythonCmd; args = $pyArgs })
  Ok 'registered MCP server: dai-harness'
}

if ($null -ne $memoryDir) {
  $memEntry = Join-Path $memoryDir 'bin/dai-memory.mjs'
  if (Test-Path $memEntry) {
    Set-Server $mcp.mcpServers 'dai-memory' ([pscustomobject]@{
      command = 'node'
      args = @(($memEntry -replace '\\','/'), 'serve')
      env = [pscustomobject]@{ MEMORY_LAYER_LOG_LEVEL = 'warn' }
    })
    Ok 'registered MCP server: dai-memory'
  }
}

$mcp | ConvertTo-Json -Depth 12 | Set-Content -Path $mcpPath -Encoding utf8
Ok "wrote $mcpPath"

# ---------------------------------------------------------------- launcher --
Step 'Creating the launcher'
$launcher = Join-Path $Root 'ade.cmd'
$launcherLines = @(
  '@echo off',
  'rem DAI ADE launcher, written by install.ps1',
  ('cd /d "' + $adeDir + '"'),
  'if "%~1"=="" (',
  '  npm start',
  ') else (',
  '  node packages/shell/src/cli.js %*',
  ')'
)
Set-Content -Path $launcher -Value $launcherLines -Encoding ascii
Ok "launcher: $launcher"

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DAI ADE.lnk'
try {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($startMenu)
  $link.TargetPath = $launcher
  $link.WorkingDirectory = $adeDir
  $link.Description = 'DAI Agent Development Environment'
  $link.Save()
  Ok 'Start Menu shortcut created'
} catch {
  Warn 'Could not create the Start Menu shortcut (not fatal)'
}

# ------------------------------------------------------------------ doctor --
Step 'Checking the result'
Push-Location $adeDir
try { node packages/shell/src/cli.js doctor --project $Project } finally { Pop-Location }

# Bridge whatever the harness has already recorded, so the first launch has
# something real in it rather than an empty window.
Push-Location $adeDir
try {
  node scripts/bridge-sync.js $Project
} catch { Warn 'harness bridge produced nothing yet' } finally { Pop-Location }

# ------------------------------------------------------------------- done ---
Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host ''
Say "ADE        $adeDir"
Say "harness    $harnessDir"
if ($null -ne $memoryDir) { Say "memory     $memoryDir" }
Say "watching   $Project"
Write-Host ''
Say 'Launch the window:        ade'
Say 'Follow events in a shell: ade tail'
Say 'See what is wired up:     ade doctor'
Write-Host ''
Say 'Restart Claude Code in that project so the hooks take effect.'

if ($script:Warnings.Count -gt 0) {
  Write-Host ''
  Write-Host "  $($script:Warnings.Count) warning(s):" -ForegroundColor Yellow
  foreach ($w in $script:Warnings) { Write-Host "    - $w" -ForegroundColor Yellow }
}

if (-not $NoLaunch) {
  Write-Host ''
  Say 'Starting the ADE...'
  Start-Process -FilePath $launcher -WorkingDirectory $adeDir
}
