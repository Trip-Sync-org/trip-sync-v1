# Runs EAS from a temp copy of ONLY repo/mobile/ (not the whole monorepo).
# Why: (1) EAS "Compressing project files" uses tar; OneDrive paths often return
#   Permission denied and the upload is truncated. Server: package.json missing under build/mobile.
# (2) A git worktree into Temp can still tie reads back to the OneDrive checkout.
# (3) A slim archive (no api/, no root Vercel) is smaller and more reliable.
#
# Expo (expo.dev): Project -> General -> "Project root directory" MUST be "packages/mobile"
# (not "mobile"). EAS workers extract with "tar --strip-components 1"; an extra top-level
# folder fixes layout so build/mobile/package.json exists. This staging path does not change
# your real repo (still Trip-Sync/mobile/); only the temp git tree uses packages/mobile/.
# Do not set GIT_DIR / GIT_WORK_TREE: EAS runs "git clone file://.../staging" and that
# fails (128) if those env vars point at a repo. Use INIT_CWD + CWD under staging only;
# eas-with-staging.cjs spawns PS from %TEMP%, not OneDrive, so walk-up finds Temp\.git.
# EAS is started via node scripts/invoke-eas-build.cjs so npx's cwd/INIT_CWD are the staged app root.
# Usage: -BuildProfile preview|production|development  [-- extra eas args]
param(
  [ValidateSet("preview", "production", "development")]
  [string] $BuildProfile = "preview",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $EASExtra
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SourceMobile = Join-Path $RepoRoot "mobile"
$Pj = Join-Path $SourceMobile "package.json"
if (-not (Test-Path $Pj)) { throw "Missing $Pj" }

# Staging: always robocopy (no git worktree on Windows for EAS)
$stagingId = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$WorkDir = Join-Path $env:LOCALAPPDATA "Temp\ts-eas-staging-$stagingId"
# Must match Expo project root (see header). Robocopy app -> .../packages/mobile for EAS tar strip.
$DestMobile = Join-Path $WorkDir "packages\mobile"

$exit = 0
try {
  $null = New-Item -ItemType Directory -Path $WorkDir -Force
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $DestMobile) -Force

  $roboArgs = @(
    $SourceMobile, $DestMobile, "*", "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/R:3", "/W:1"
  )
  foreach ($d in @("node_modules", ".expo", ".git", ".cursor", "dist", "coverage", "eas-archive-inspect", ".idea", ".vscode", "ios", "web-build")) {
    $roboArgs += "/XD"
    $roboArgs += $d
  }
  & robocopy.exe @roboArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy from OneDrive/clone failed (exit $LASTEXITCODE). Retry or clone repo to e.g. C:\dev" }

  $rootEas = Join-Path $RepoRoot ".easignore"
  if (Test-Path $rootEas) {
    Copy-Item -LiteralPath $rootEas -Destination (Join-Path $WorkDir ".easignore") -Force
  }

  git -C $WorkDir init
  if ($LASTEXITCODE -ne 0) { throw "git init failed" }
  git -C $WorkDir config user.email "eas-staging@local"
  git -C $WorkDir config user.name "EAS Staging"
  git -C $WorkDir add -A
  git -C $WorkDir commit -m "EAS staging (mobile only)" --no-verify 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw "git commit in staging failed" }

  $stagedPj = Join-Path $DestMobile "package.json"
  if (-not (Test-Path $stagedPj)) { throw "Staged path missing: $stagedPj" }
  if ((Get-Item $stagedPj).Length -lt 20) { throw "Staged package.json is too small; copy is corrupt." }
  $fileCount = (Get-ChildItem -Path $DestMobile -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($fileCount -lt 20) {
    throw "Staged mobile/ has only $fileCount files. Source: $SourceMobile dest: $DestMobile"
  }

  Push-Location -LiteralPath $DestMobile
  $st = (Get-Item -LiteralPath (Get-Location).Path).FullName
  $env:INIT_CWD = $st
  $env:npm_config_local_prefix = $st
  $env:PWD = $st
  Write-Host "EAS/ npm project root (INIT_CWD): $st"
  Write-Host "Expo dashboard: set Project root directory to 'packages/mobile' (required for this staging layout)." -ForegroundColor Yellow
  try {
    Write-Host "Running npm ci in staged copy (not OneDrive)..."
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE) in $DestMobile" }

    $env:INIT_CWD = $st
    $env:npm_config_local_prefix = $st
    # EAS does "git clone" internally; inherited GIT_DIR breaks that (exit 128).
    foreach ($k in "GIT_DIR", "GIT_WORK_TREE") {
      if (Test-Path -Path "Env:\$k") { Remove-Item -Path "Env:\$k" -ErrorAction SilentlyContinue }
    }
    # Node launcher: child cwd + INIT_CWD from __dirname under staged mobile/ only (not npx on PATH resolving from OneDrive).
    $invoke = Join-Path $DestMobile "scripts\invoke-eas-build.cjs"
    if (-not (Test-Path -LiteralPath $invoke)) { throw "Missing $invoke" }
    $nodeArgs = @($invoke, $BuildProfile)
    if ($EASExtra) { $nodeArgs += $EASExtra }
    Write-Host "Starting EAS (npx eas-cli). Upload step runs next - let it finish. Profile: $BuildProfile"
    & node @nodeArgs
    $nodeExit = $LASTEXITCODE
    if ($null -ne $nodeExit -and $nodeExit -ne 0) { throw "EAS launcher failed (node exit $nodeExit). See EAS output above." }
    $exit = $nodeExit
  } finally {
    Pop-Location
  }
} catch {
  Write-Error $_.Exception.Message
  $exit = 1
} finally {
  if (Test-Path $WorkDir) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $WorkDir
  }
}
exit $exit
