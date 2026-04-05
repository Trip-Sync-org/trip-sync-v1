# Uses portable Node 20 (no admin) so it wins over Node 24 in Program Files.
$ErrorActionPreference = "Stop"
$nodeRoot = Join-Path $env:LOCALAPPDATA "node-v20\node-v20.20.2-win-x64"
$nodeExe = Join-Path $nodeRoot "node.exe"
if (-not (Test-Path $nodeExe)) {
  Write-Host "Portable Node 20 not found at: $nodeRoot" -ForegroundColor Red
  Write-Host "Download: https://nodejs.org/dist/v20.20.2/node-v20.20.2-win-x64.zip"
  Write-Host "Extract to: $([IO.Path]::Combine($env:LOCALAPPDATA, 'node-v20'))"
  exit 1
}
$env:PATH = "$nodeRoot;$env:PATH"
# Gradle must use JDK 17 for RN/Expo; newer JDK on PATH causes "Unsupported class file major version 69"
$jdk17 = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
if (Test-Path (Join-Path $jdk17 "bin\java.exe")) {
  $env:JAVA_HOME = $jdk17
}
$mobileRoot = Join-Path $PSScriptRoot ".."
$androidDir = Join-Path $mobileRoot "android"
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (Test-Path $sdk) {
  $env:ANDROID_HOME = $sdk
  $localProps = Join-Path $androidDir "local.properties"
  if (-not (Test-Path $localProps)) {
    $sdkDir = ($sdk -replace "\\", "/")
    Set-Content -Path $localProps -Encoding ascii -Value "sdk.dir=$sdkDir"
    Write-Host ('Wrote sdk.dir to local.properties (' + $sdkDir + ')')
  }
} else {
  Write-Host -ForegroundColor Yellow ('Android SDK not found at ' + $sdk + '. Install Android Studio SDK or set ANDROID_HOME.')
}
Set-Location $mobileRoot
Write-Host ('Using Node: ' + (& $nodeExe -v) + ' from ' + $nodeRoot)
$npx = Join-Path $nodeRoot "npx.cmd"
& $npx expo run:android @args
exit $LASTEXITCODE
