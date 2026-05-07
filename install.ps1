#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstraps the pi-config portable coding-agent configuration on a new machine.

.DESCRIPTION
  1. Sets PI_CODING_AGENT_DIR as a user-level environment variable pointing to this repo.
  2. Migrates auth.json from the old default location (~/.pi/agent/) if it exists and
     no auth.json is already present in this repo.
  3. Validates Node.js, npm, and PI prerequisites.
  4. Runs `pi update` to reinstall any packages listed in settings.json.
  5. Builds and installs the PI Assistant VSCode extension from extension/.

.NOTES
  Run once after cloning the repo on a new machine:
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
    .\install.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot

Write-Host "==> Setting PI_CODING_AGENT_DIR to '$repoRoot'"
[System.Environment]::SetEnvironmentVariable(
  'PI_CODING_AGENT_DIR',
  $repoRoot,
  [System.EnvironmentVariableTarget]::User
)
# Apply immediately for the current process too
$env:PI_CODING_AGENT_DIR = $repoRoot

function Assert-Command($name, $installHint) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "$name is required but was not found on PATH. $installHint"
  }

  return $cmd
}

Write-Host "==> Validating prerequisites"
Assert-Command 'node' 'Install a standalone Node.js runtime first: https://nodejs.org/' | Out-Null
Assert-Command 'npm' 'Install npm together with Node.js: https://nodejs.org/' | Out-Null
$piCmd = Assert-Command 'pi' 'Install the PI SDK globally first: npm install -g @mariozechner/pi-coding-agent'

# Migrate auth.json from the old default location if needed
$oldAuth = Join-Path $env:USERPROFILE '.pi\agent\auth.json'
$newAuth = Join-Path $repoRoot 'auth.json'
if ((Test-Path $oldAuth) -and -not (Test-Path $newAuth)) {
  Write-Host "==> Migrating auth.json from '$oldAuth'"
  Copy-Item $oldAuth $newAuth
} elseif (Test-Path $newAuth) {
  Write-Host "==> auth.json already present in repo — skipping migration"
} else {
  Write-Host "==> No existing auth.json found — you will need to authenticate PI on first run"
}

# Reinstall any packages listed in settings.json
if ($piCmd) {
  Write-Host "==> Running 'pi update' to restore packages from settings.json"
  pi update
} else {
  Write-Warning "'pi' command not found on PATH — install @mariozechner/pi-coding-agent globally first: npm install -g @mariozechner/pi-coding-agent"
}

Write-Host ""
Write-Host "Done. Open a new terminal so PI_CODING_AGENT_DIR takes effect, then run: pi"

# Build and install the PI Assistant VSCode extension
Write-Host ""
Write-Host "==> Building PI Assistant VSCode extension"
$extensionDir = Join-Path $repoRoot 'extension'

Push-Location $extensionDir
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed in extension/" }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed in extension/" }

  npm run package
  if ($LASTEXITCODE -ne 0) { throw "vsce package failed in extension/" }

  $vsix = Get-ChildItem -Filter '*.vsix' | Select-Object -First 1
  if ($vsix) {
    # Use code.cmd (the CLI wrapper) rather than Code.exe (the GUI) for --install-extension
    $codeCli = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'
    if (-not (Test-Path $codeCli)) { $codeCli = 'code' }
    Write-Host "==> Installing $($vsix.Name) into VSCode"
    & $codeCli --install-extension $vsix.FullName
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "code CLI failed — install manually: code --install-extension $($vsix.FullName)"
    }
  } else {
    Write-Warning "No .vsix found after packaging — check vsce output above"
  }
} catch {
  Write-Warning "Extension build failed: $_"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "All done. Reload VSCode to activate the PI Assistant panel."
