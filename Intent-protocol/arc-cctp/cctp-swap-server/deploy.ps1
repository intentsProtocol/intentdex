<#
.SYNOPSIS
  Deploy cctp-swap-server (mainnet, testnet, or both) + optional frontend.

.DESCRIPTION
  Launches the swap server in one or more modes on separate ports with isolated
  data directories. Each instance runs all enabled modules (CCTP, Jupiter,
  BCH 1Click, Liquidium Lend) appropriate for its network.

  Mainnet → port 3012, data in ./data-mainnet
  Testnet → port 3013, data in ./data

.PARAMETER Mode
  Which instances to start: mainnet | testnet | both (default: both)

.PARAMETER Frontend
  Also start the Vite frontend dev server (default: false)

.PARAMETER Watch
  Run with tsx watch for hot-reload (default: false, uses tsx directly)

.EXAMPLE
  .\deploy.ps1                          # both servers
  .\deploy.ps1 -Mode mainnet            # mainnet only
  .\deploy.ps1 -Mode testnet            # testnet only
  .\deploy.ps1 -Mode both -Frontend     # both + frontend
  .\deploy.ps1 -Mode mainnet -Watch     # mainnet with hot-reload
#>

param(
    [ValidateSet("mainnet", "testnet", "both")]
    [string]$Mode = "both",
    [switch]$Frontend,
    [switch]$Watch
)

# ── Paths ─────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ServerDir  = $ScriptDir                 # cctp-swap-server root
$FrontendDir = Resolve-Path (Join-Path $ScriptDir "..\..\frontend") -ErrorAction SilentlyContinue

# ── Colors ────────────────────────────────────────────────────────────────────
function Write-Header($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)     { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg)   { Write-Host "  --> $msg" -ForegroundColor DarkGray }
function Write-Warn($msg)   { Write-Host "  [!] $msg" -ForegroundColor Yellow }

# ── Module matrix ─────────────────────────────────────────────────────────────
Write-Header "BCH Intents - Deployment"
Write-Host ""
Write-Host "  Module              Mainnet    Testnet" -ForegroundColor DarkGray
Write-Host "  ───────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  CCTP (USDC)           YES        YES" -ForegroundColor White
Write-Host "  Solana / Jupiter      YES         NO" -ForegroundColor White
Write-Host "  BCH / 1Click          YES         NO" -ForegroundColor White
Write-Host "  Lend / Liquidium      YES         NO" -ForegroundColor White
Write-Host "  LendBCH / Paryon      YES    chipnet" -ForegroundColor White
Write-Host ""

# ── Port configuration ────────────────────────────────────────────────────────
$MainnetPort  = 3012
$TestnetPort  = 3013
$FrontendPort = 5173

# ── Collect processes to manage ───────────────────────────────────────────────
$jobs = @()

function Start-Server {
    param(
        [string]$Network,
        [int]$Port
    )
    
    $runner = if ($Watch) { "tsx watch" } else { "tsx" }
    
    Write-Header "$($Network.ToUpper()) Server - port $Port"
    
    # Environment overrides for this instance
    $envVars = @{
        CCTP_NETWORK = $Network
        PORT         = $Port.ToString()
    }
    
    # Testnet: disable mainnet-only modules explicitly
    if ($Network -eq "testnet") {
        $envVars["JUPITER_ENABLED"] = "false"
        $envVars["BCH_SWAPS_ENABLED"] = "false"
        $envVars["LEND_ENABLED"] = "false"
        $envVars["LENDBCH_ENABLED"] = "false"
        Write-Info "CCTP only (Jupiter, BCH, Lend, LendBCH are mainnet-only)"
    } else {
        Write-Info "All modules: CCTP + Jupiter + BCH 1Click + Lend + LendBCH"
    }
    
    Write-Info "Data dir: $(if ($Network -eq 'mainnet') { './data-mainnet' } else { './data' })"
    Write-Info "Runner: $runner"
    
    # Build the env string for the process
    $envString = ($envVars.GetEnumerator() | ForEach-Object {
        "`$env:$($_.Key) = '$($_.Value)'"
    }) -join "; "
    
    $scriptBlock = [scriptblock]::Create(@"
        Set-Location '$ServerDir'
        $envString
        & $runner src/index.ts
"@)
    
    $job = Start-Job -ScriptBlock $scriptBlock -Name "$Network-server"
    $script:jobs += $job
    
    Write-Ok "Started $Network server (Job: $($job.Id))"
}

# ── Launch servers ────────────────────────────────────────────────────────────

if ($Mode -eq "mainnet" -or $Mode -eq "both") {
    Start-Server -Network "mainnet" -Port $MainnetPort
}

if ($Mode -eq "testnet" -or $Mode -eq "both") {
    Start-Server -Network "testnet" -Port $TestnetPort
}

# ── Frontend ──────────────────────────────────────────────────────────────────
if ($Frontend) {
    if (-not $FrontendDir) {
        Write-Warn "Frontend directory not found at expected path. Skipping."
    } else {
        Write-Header "Frontend - Vite dev server"
        Write-Info "Dir: $FrontendDir"
        
        $frontendJob = Start-Job -Name "frontend" -ScriptBlock {
            param($dir)
            Set-Location $dir
            npm run dev
        } -ArgumentList $FrontendDir.Path
        
        $jobs += $frontendJob
        Write-Ok "Started frontend (Job: $($frontendJob.Id))"
    }
}

# ── Health checks ─────────────────────────────────────────────────────────────
Write-Header "Waiting for servers to boot..."
Start-Sleep -Seconds 4

function Test-Health($name, $port) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:$port/health" -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($resp.status -eq "ok") {
            $chains = ($resp.chains -join ", ")
            Write-Ok "$name health OK - network: $($resp.network), chains: $chains"
            
            if ($resp.solanaSwaps.enabled) {
                Write-Info "  Jupiter: $($resp.solanaSwaps.tokens) tokens, fee $($resp.solanaSwaps.referralFeeBps) bps"
            }
            if ($resp.bchSwaps.enabled) {
                Write-Info "  BCH 1Click: $($resp.bchSwaps.tokens) tokens, fee $($resp.bchSwaps.feeBps) bps"
            }
            return $true
        }
    } catch {}
    Write-Warn "$name not responding yet on port $port"
    return $false
}

if ($Mode -eq "mainnet" -or $Mode -eq "both") {
    Test-Health "Mainnet" $MainnetPort
}
if ($Mode -eq "testnet" -or $Mode -eq "both") {
    Test-Health "Testnet" $TestnetPort
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Header "Deployment Summary"

$summary = @()
if ($Mode -eq "mainnet" -or $Mode -eq "both") {
    $summary += "  Mainnet : http://localhost:$MainnetPort  (CCTP + Jupiter + BCH + Lend)"
}
if ($Mode -eq "testnet" -or $Mode -eq "both") {
    $summary += "  Testnet : http://localhost:$TestnetPort  (CCTP only)"
}
if ($Frontend -and $FrontendDir) {
    $summary += "  Frontend: http://localhost:$FrontendPort"
}
$summary | ForEach-Object { Write-Host $_ -ForegroundColor White }

Write-Host ""
Write-Host "  Admin (mainnet): http://localhost:$MainnetPort/admin" -ForegroundColor DarkCyan
Write-Host "  Health (mainnet): http://localhost:$MainnetPort/health" -ForegroundColor DarkCyan
if ($Mode -eq "testnet" -or $Mode -eq "both") {
    Write-Host "  Admin (testnet):  http://localhost:$TestnetPort/admin" -ForegroundColor DarkCyan
    Write-Host "  Health (testnet): http://localhost:$TestnetPort/health" -ForegroundColor DarkCyan
}

Write-Host ""
Write-Host "  Press Ctrl+C to stop all servers" -ForegroundColor Yellow
Write-Host ""

# ── Keep alive + tail logs ────────────────────────────────────────────────────
try {
    while ($true) {
        foreach ($job in $jobs) {
            # Stream any new output
            Receive-Job -Job $job -ErrorAction SilentlyContinue | ForEach-Object {
                $prefix = "[$($job.Name)]"
                Write-Host "$prefix $_" -ForegroundColor $(
                    if ($job.Name -match "mainnet") { "Green" }
                    elseif ($job.Name -match "testnet") { "Magenta" }
                    else { "Cyan" }
                )
            }
            
            # Check if any job died
            if ($job.State -eq "Failed") {
                Write-Warn "$($job.Name) has crashed!"
                Receive-Job -Job $job -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Seconds 2
    }
} finally {
    # ── Graceful shutdown ─────────────────────────────────────────────────────
    Write-Header "Shutting down..."
    foreach ($job in $jobs) {
        Write-Info "Stopping $($job.Name)..."
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    
    # Also kill any node processes on our ports
    @($MainnetPort, $TestnetPort) | ForEach-Object {
        $port = $_
        $proc = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
            Write-Info "Killed process on port $port (PID: $proc)"
        }
    }
    
    Write-Ok "All servers stopped."
}
