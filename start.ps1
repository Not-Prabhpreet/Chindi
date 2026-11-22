param([switch]$SkipInstall, [switch]$Dev)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot 'backend'
$frontendPath = Join-Path $projectRoot 'frontend'
$runtimePath = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 24 or newer, then run this script again.' }
$env:Path = (Split-Path $nodePath) + ';' + $env:Path
$npmCli = Join-Path (Split-Path $nodePath) 'node_modules\npm\bin\npm-cli.js'
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
if (-not $SkipInstall -or -not (Test-Path -LiteralPath $pythonPath)) {
    $uvCommand = Get-Command uv -ErrorAction SilentlyContinue
    $uvPath = if ($uvCommand) { $uvCommand.Source } else { Join-Path (Split-Path $projectRoot) '.tools\bin\uv.exe' }
    if (-not (Test-Path -LiteralPath $uvPath)) { throw 'Install uv (https://docs.astral.sh/uv/), then run this script again.' }
    Push-Location $backendPath
    try { & $uvPath sync --frozen; if ($LASTEXITCODE) { throw 'Backend dependency installation failed.' } } finally { Pop-Location }
}
if (-not $SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $frontendPath 'node_modules'))) {
    Push-Location $frontendPath
    try { & $nodePath $npmCli ci; if ($LASTEXITCODE) { throw 'Frontend dependency installation failed.' } } finally { Pop-Location }
}
$processes = @()
foreach ($port in @(8000,5173)) {
    $probe = New-Object System.Net.Sockets.TcpClient
    $occupied = $false
    try { $occupied = $probe.ConnectAsync('127.0.0.1', $port).Wait(500) -and $probe.Connected } catch {} finally { $probe.Dispose() }
    if ($occupied) {
        throw "Port $port is already in use. Stop the existing server before starting Chindi."
    }
}
if (-not $Dev) {
    Push-Location $frontendPath
    try { & $nodePath $npmCli run build; if ($LASTEXITCODE) { throw 'Frontend build failed.' } } finally { Pop-Location }
}
Push-Location $backendPath
try { & $pythonPath -m alembic upgrade head; if ($LASTEXITCODE) { throw 'Database migration failed.' } } finally { Pop-Location }
$api = Start-Process -FilePath $pythonPath -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'api.log') -RedirectStandardError (Join-Path $runtimePath 'api-error.log') -PassThru
$processes += @{ id=$api.Id; started=$api.StartTime.ToUniversalTime().ToString('o') }
try {
    $viteCli = Join-Path $frontendPath 'node_modules\vite\bin\vite.js'
    $webArguments = @(('"'+$viteCli+'"'))
    if (-not $Dev) { $webArguments += 'preview' }
    $webArguments += @('--host','127.0.0.1','--port','5173','--strictPort')
    $web = Start-Process -FilePath $nodePath -ArgumentList $webArguments -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'web.log') -RedirectStandardError (Join-Path $runtimePath 'web-error.log') -PassThru
    $processes += @{ id=$web.Id; started=$web.StartTime.ToUniversalTime().ToString('o') }
    $processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'processes.json')
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        $api.Refresh()
        $web.Refresh()
        if ($api.HasExited -or $web.HasExited) { throw 'A server exited early. Inspect .runtime logs.' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2
            $page = Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
            if ($health.status -eq 'ok' -and $page.StatusCode -eq 200) { $ready=$true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Servers did not become ready. Inspect .runtime logs.' }
    Write-Host "Chindi is running: http://localhost:5173/"
    Write-Host "Create your first account in the app. Stop with .\stop.ps1."
} catch {
    foreach ($entry in $processes) { & taskkill.exe /PID $entry.id /T /F 2>$null | Out-Null }
    throw
}
