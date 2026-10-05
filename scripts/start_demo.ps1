<#
  Runs the whole SBDI demo from this laptop and shares it through a free Cloudflare quick tunnel.
  One server (FastAPI) serves both the website and the API, so there is a single public URL.

  .\scripts\start_demo.ps1              build the site if needed, start backend + tunnel
  .\scripts\start_demo.ps1 -Rebuild     force a fresh website build first
  .\scripts\start_demo.ps1 -NoTunnel    local only: http://localhost:8000 (no cloudflared needed)

  Stop everything with Ctrl+C.
#>
param(
    [switch]$Rebuild,
    [switch]$NoTunnel,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $root '.venv\Scripts\python.exe'
$frontend = Join-Path $root 'web\frontend'
$indexHtml = Join-Path $frontend 'dist\index.html'
$log = Join-Path $env:TEMP 'sbdi_backend.log'

if (-not (Test-Path $python)) {
    throw "Python virtualenv not found at $python. Create it first (see README: python -m venv .venv; pip install -r requirements.txt)."
}
# cloudflared can be installed system-wide, or simply dropped into <project>\tools\cloudflared.exe.
$cloudflared = $null
$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cmd) { $cloudflared = $cmd.Source }
elseif (Test-Path (Join-Path $root 'tools\cloudflared.exe')) { $cloudflared = Join-Path $root 'tools\cloudflared.exe' }
if (-not $NoTunnel -and -not $cloudflared) {
    throw "cloudflared not found. Put cloudflared.exe in $root\tools\ (see DEPLOY_FREE.md), or use -NoTunnel."
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Stop the other server (for example 'npm run dev') or pass -Port 8001."
}

if ($Rebuild -or -not (Test-Path $indexHtml)) {
    Write-Host 'Building the website (about 30 s)...' -ForegroundColor Cyan
    # Empty value = the site calls the API on its own origin, which is what a tunnel needs.
    $env:VITE_API_BASE_URL = ''
    # Run from inside the folder: passing a path with a space (D:\FY Project) to npm.cmd breaks.
    Push-Location $frontend
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Website build failed.' }
    } finally {
        Pop-Location
    }
}

# A tunnel makes the demo reachable by anyone with the link, so switch off the endpoints that
# overwrite model files or retrain (the Upload Model page then reports "disabled").
if ($NoTunnel) { $env:PUBLIC_DEMO = '0' } else { $env:PUBLIC_DEMO = '1' }

Write-Host "Starting backend on port $Port (log: $log)..." -ForegroundColor Cyan
$backend = Start-Process -FilePath $python -WorkingDirectory $root -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" `
    -ArgumentList @('-m', 'uvicorn', 'main:app', '--app-dir', 'ml_service', '--host', '127.0.0.1', '--port', $Port)

try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($backend.HasExited) { break }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($health.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) {
        Write-Host (Get-Content "$log.err" -Tail 15 -ErrorAction SilentlyContinue | Out-String)
        throw 'Backend did not start. See the log above.'
    }

    Write-Host "Backend ready. CAN model loaded: $($health.can_model_loaded), USB model loaded: $($health.model_loaded)" -ForegroundColor Green
    Write-Host "Local address: http://localhost:$Port" -ForegroundColor Green

    if ($NoTunnel) {
        Write-Host 'Running without a tunnel. Press Ctrl+C to stop.'
        Wait-Process -Id $backend.Id
    } else {
        Write-Host ''
        Write-Host 'Starting the tunnel. Your public link is the https://<random-words>.trycloudflare.com line below.' -ForegroundColor Yellow
        Write-Host 'The link changes every time you start this script. Keep this window open during the demo.' -ForegroundColor Yellow
        Write-Host ''
        & $cloudflared tunnel --url "http://127.0.0.1:$Port"
    }
}
finally {
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
        Write-Host 'Backend stopped.'
    }
}
