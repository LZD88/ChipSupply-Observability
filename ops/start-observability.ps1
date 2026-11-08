param(
    [string]$PythonPath,
    [string]$RuntimePath = (Join-Path $env:LOCALAPPDATA 'ChipSupply\observability')
)

$ErrorActionPreference = 'Stop'
$dashboardRoot = Split-Path -Parent $PSScriptRoot
$stackRoot = Split-Path -Parent $dashboardRoot
$configPath = Join-Path $PSScriptRoot 'prometheus\prometheus.local.yml'
$version = '2.55.1'
$archiveName = "prometheus-$version.windows-amd64.zip"
$archiveSha256 = 'c1a3b8c0c305d7d4d9aaf836425653945a4aad4839bab32114bfe4ad97ff84ba'
$downloadRoot = Join-Path $RuntimePath 'downloads'
$binaryRoot = Join-Path $RuntimePath "prometheus-$version.windows-amd64"
$prometheusExe = Join-Path $binaryRoot 'prometheus.exe'
$logRoot = Join-Path $RuntimePath 'logs'
$dataRoot = Join-Path $RuntimePath 'data'
New-Item -ItemType Directory -Path $downloadRoot,$logRoot,$dataRoot -Force | Out-Null

if (-not $PythonPath) {
    $PythonPath = Join-Path $stackRoot 'ChipChain-Procurement-Agent\.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $PythonPath)) {
        $PythonPath = (Get-Command python -ErrorAction Stop).Source
    }
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python not found: $PythonPath" }

function Test-Ready([string]$Url) {
    try {
        $result = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $result.StatusCode -eq 200
    } catch { return $false }
}

function Wait-Ready([string]$Url, [System.Diagnostics.Process]$Service) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Ready $Url) { return }
        $Service.Refresh()
        if ($Service.HasExited) { throw "Service exited; inspect $logRoot" }
        Start-Sleep -Milliseconds 500
    }
    throw "Service did not become ready: $Url; inspect $logRoot"
}

if (-not (Test-Ready 'http://127.0.0.1:9090/-/ready')) {
    if (-not (Test-Path -LiteralPath $prometheusExe)) {
        $archivePath = Join-Path $downloadRoot $archiveName
        if (-not (Test-Path -LiteralPath $archivePath)) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Write-Host "Downloading Prometheus $version..."
            Invoke-WebRequest -Uri "https://github.com/prometheus/prometheus/releases/download/v$version/$archiveName" -OutFile $archivePath -UseBasicParsing -TimeoutSec 180
        }
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSha256) {
            throw "Prometheus archive checksum mismatch: $archivePath"
        }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $RuntimePath -Force
    }
    & (Join-Path $binaryRoot 'promtool.exe') check config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Prometheus configuration is invalid' }
    $prometheusArgs = @(
        ('--config.file="{0}"' -f $configPath),
        ('--storage.tsdb.path="{0}"' -f $dataRoot),
        '--storage.tsdb.retention.time=15d',
        '--web.listen-address=127.0.0.1:9090'
    )
    $service = Start-Process -FilePath $prometheusExe -ArgumentList $prometheusArgs -WorkingDirectory $RuntimePath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logRoot 'prometheus.out.log') -RedirectStandardError (Join-Path $logRoot 'prometheus.err.log')
    Wait-Ready 'http://127.0.0.1:9090/-/ready' $service
}

if (-not (Test-Ready 'http://127.0.0.1:3002/healthz')) {
    $dashboardArgs = @('"' + (Join-Path $dashboardRoot 'serve.py') + '"', '--host', '127.0.0.1', '--port', '3002', '--agent-api-url', 'http://127.0.0.1:8090', '--tempo-url', 'http://127.0.0.1:3200')
    $service = Start-Process -FilePath $PythonPath -ArgumentList $dashboardArgs -WorkingDirectory $dashboardRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logRoot 'dashboard.out.log') -RedirectStandardError (Join-Path $logRoot 'dashboard.err.log')
    Wait-Ready 'http://127.0.0.1:3002/healthz' $service
}

if (-not (Test-Ready 'http://127.0.0.1:3002/prometheus/api/v1/query?query=up')) {
    throw "Dashboard proxy is unavailable; inspect $logRoot"
}
Write-Host 'Dashboard:  http://localhost:3002'
Write-Host 'Prometheus: http://localhost:9090'
Write-Host "Logs:       $logRoot"
