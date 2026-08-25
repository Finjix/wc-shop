$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudRoot = Join-Path $repoRoot 'cloudfunctions'
$adminRoot = Join-Path $repoRoot 'admin'
$distRoot = Join-Path $repoRoot 'dist'
$stageRoot = Join-Path $distRoot '.package-staging'

if (-not (Test-Path -LiteralPath $distRoot)) {
  New-Item -ItemType Directory -Path $distRoot | Out-Null
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

function Copy-FunctionPackage {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FunctionDirectory,
    [Parameter(Mandatory = $true)][string]$Entrypoint
  )

  $stage = Join-Path $stageRoot $Name
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'package.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'package-lock.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $cloudRoot 'shared') -Destination $stage -Recurse
  Copy-Item -LiteralPath (Join-Path $cloudRoot $FunctionDirectory) -Destination $stage -Recurse
  Copy-Item -LiteralPath (Join-Path $cloudRoot $Entrypoint) -Destination (Join-Path $stage 'index.js')

  $zip = Join-Path $distRoot "$Name.zip"
  if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
  }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  return $zip
}

$shopZip = Copy-FunctionPackage -Name 'shop-cloudfunction' -FunctionDirectory 'shop' -Entrypoint 'shop-deploy-index.js'
$adminZip = Copy-FunctionPackage -Name 'admin-cloudfunction' -FunctionDirectory 'admin' -Entrypoint 'admin-deploy-index.js'

$staticStage = Join-Path $stageRoot 'wc-shop-admin-static'
New-Item -ItemType Directory -Path $staticStage | Out-Null
Copy-Item -Path (Join-Path $adminRoot 'dist\*') -Destination $staticStage -Recurse
$staticZip = Join-Path $distRoot 'wc-shop-admin-static.zip'
if (Test-Path -LiteralPath $staticZip) {
  Remove-Item -LiteralPath $staticZip -Force
}
Compress-Archive -Path (Join-Path $staticStage '*') -DestinationPath $staticZip -CompressionLevel Optimal

Remove-Item -LiteralPath $stageRoot -Recurse -Force

Write-Output "shop:  $shopZip  (Handler: index.main)"
Write-Output "admin: $adminZip  (Handler: index.main)"
Write-Output "web:   $staticZip"
