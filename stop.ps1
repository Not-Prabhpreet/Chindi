$ErrorActionPreference = 'Stop'
$processFile = Join-Path $PSScriptRoot '.runtime\processes.json'
if (-not (Test-Path -LiteralPath $processFile)) { Write-Host 'No Chindi process record found.'; exit }
foreach ($entry in (Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json)) {
    $running = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().ToString('o') -eq $entry.started) {
        # Stop only this recorded process tree, after checking the process start time.
        & taskkill.exe /PID $entry.id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Windows refused to stop a Chindi process tree. Run this script from your normal user terminal.' }
    }
}
Write-Host 'Chindi stopped. Your data is kept in backend/chindi.db.'
