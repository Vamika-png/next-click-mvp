# Builds web/public/next-click-extension.zip: the extension, pointed at the LIVE server.
# Run it from the project folder:   powershell -ExecutionPolicy Bypass -File scripts\build-extension-zip.ps1
# Then commit and push; Vercel redeploys and the Download button on the home page starts working.
# To point at another server: add  -ApiBase https://your-address.vercel.app  (no slash at the end).
param(
  [string]$ApiBase = "https://web-topaz-theta-65.vercel.app"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "extension"
$out = Join-Path $root "web\public\next-click-extension.zip"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("next-click-zip-" + [guid]::NewGuid().ToString("N"))

if (-not (Test-Path (Join-Path $src "manifest.json"))) { throw "Could not find extension\manifest.json under $root" }
if ($ApiBase -notmatch '^https://[^/\s]+$') { throw "ApiBase must look like https://something.vercel.app (https, no slash at the end)" }

New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Copy-Item -Path (Join-Path $src "*") -Destination $tmp -Recurse

  # Point the copy (not your working folder) at the live server.
  $config = Join-Path $tmp "config.js"
  $text = @"
// Where the helper server lives. This download is pointed at the live server.
const API_BASE = "$ApiBase";
"@
  Set-Content -Path $config -Value $text -Encoding ascii

  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  if (Test-Path $out) { Remove-Item $out -Force }
  # tar writes forward slashes inside the zip, which every operating system understands.
  tar.exe -a -c -f $out -C $tmp .
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
  $kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
  Write-Host "Built $out ($kb KB), pointed at $ApiBase"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
