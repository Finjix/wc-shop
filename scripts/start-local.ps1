$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Get-Listener([int]$port) {
  @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-ProjectListener([int]$port, [string]$signature) {
  foreach ($pidToStop in (Get-Listener $port)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToStop"
    if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch $signature) {
      throw "Port $port is occupied by another process (PID $pidToStop). Close it manually and retry."
    }

    Write-Host "Stopping old process on port $port (PID $pidToStop)..."
    Stop-Process -Id $pidToStop -Force
  }

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Get-Listener $port)) { return }
    Start-Sleep -Milliseconds 200
  }
  throw "Port $port did not become available."
}

function Wait-ForListener([int]$port, [string]$name) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Get-Listener $port) {
      Write-Host "$name ready: http://127.0.0.1:$port/"
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$name did not start on port $port. Check its console window."
}

Set-Location -LiteralPath $root
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\typescript'))) {
  throw 'Root dependencies are missing. Run npm install first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'admin\node_modules\vite'))) {
  throw 'Admin dependencies are missing. Run npm --prefix admin install first.'
}

Write-Host 'Building local backend...'
& npm.cmd run build:cloudfunction
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }

Stop-ProjectListener 8787 'scripts[\\/]local-backend\.js'
Stop-ProjectListener 5173 'vite[\\/]bin[\\/]vite\.js'

Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$root`" && node scripts\local-backend.js" -WorkingDirectory $root
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$root\admin`" && npm run dev -- --host 127.0.0.1 --port 5173" -WorkingDirectory (Join-Path $root 'admin')

Wait-ForListener 8787 'Local backend'
Wait-ForListener 5173 'Admin frontend'
