param(
  [string]$Version = '0830a'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Version) -or $Version -notmatch '^[A-Za-z0-9._-]+$') {
  throw "Invalid output folder name: $Version"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudRoot = Join-Path $repoRoot 'cloudfunctions'
$adminRoot = Join-Path $repoRoot 'admin'
$distRoot = Join-Path $repoRoot 'dist'
$releaseRoot = Join-Path $distRoot $Version
$stageRoot = Join-Path $distRoot ".package-staging-$Version"
$compiledEntry = Join-Path $cloudRoot '.build\wc-shop-function\index.js'
$runtimeEntry = Join-Path $cloudRoot 'wc-shop-function\index.js'
$npmCommand = (Get-Command npm -ErrorAction Stop).Source
$tscCommand = Join-Path $adminRoot 'node_modules\.bin\tsc.cmd'

if (-not (Test-Path -LiteralPath $tscCommand)) {
  throw "TypeScript compiler not found at $tscCommand. Run npm --prefix admin install first."
}

if (-not (Test-Path -LiteralPath $distRoot)) {
  New-Item -ItemType Directory -Path $distRoot | Out-Null
}
if (-not (Test-Path -LiteralPath $releaseRoot)) {
  New-Item -ItemType Directory -Path $releaseRoot | Out-Null
}
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Label
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Copy-FunctionPackage {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Entrypoint
  )

  $stage = Join-Path $stageRoot $Name
  $stageFunction = Join-Path $stage 'wc-shop-function'
  New-Item -ItemType Directory -Path $stageFunction -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'package.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'package-lock.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'shared') -Destination $stage -Recurse
  Copy-Item -LiteralPath $runtimeEntry -Destination (Join-Path $stageFunction 'index.js')
  Copy-Item -LiteralPath (Join-Path $cloudRoot $Entrypoint) -Destination (Join-Path $stage 'index.js')

  $zip = Join-Path $releaseRoot "$Name.zip"
  if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
  }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  return $zip
}

try {
  Invoke-Checked -Command $npmCommand -Arguments @('--prefix', $adminRoot, 'run', 'build') -Label 'admin build'
  Invoke-Checked -Command $tscCommand -Arguments @('-p', (Join-Path $cloudRoot 'tsconfig.json')) -Label 'cloud function TypeScript build'

  if (-not (Test-Path -LiteralPath $compiledEntry)) {
    throw "Compiled cloud function entry not found at $compiledEntry"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeEntry) -Force | Out-Null
  Copy-Item -LiteralPath $compiledEntry -Destination $runtimeEntry -Force

  $functionZip = Copy-FunctionPackage -Name 'wc-shop-function' -Entrypoint 'wc-shop-function-deploy-index.js'

  $staticStage = Join-Path $stageRoot 'wc-shop-admin-static'
  New-Item -ItemType Directory -Path $staticStage | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $adminRoot 'dist\index.html'))) {
    throw 'Admin static build did not produce admin/dist/index.html'
  }
  Copy-Item -Path (Join-Path $adminRoot 'dist\*') -Destination $staticStage -Recurse -Force
  $staticZip = Join-Path $releaseRoot 'wc-shop-admin-static.zip'
  if (Test-Path -LiteralPath $staticZip) {
    Remove-Item -LiteralPath $staticZip -Force
  }
  Compress-Archive -Path (Join-Path $staticStage '*') -DestinationPath $staticZip -CompressionLevel Optimal
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}

$finalReleaseRoot = Join-Path $distRoot $Version
Write-Output "function: $(Join-Path $finalReleaseRoot 'wc-shop-function.zip')  (Handler: index.main)"
Write-Output "web:      $(Join-Path $finalReleaseRoot 'wc-shop-admin-static.zip')"
