#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Start cctp-swap-server (mainnet, testnet, or both) + frontend
#
# Usage:
#   ./deploy.sh                     # both mainnet + testnet
#   ./deploy.sh mainnet             # mainnet only (all 4 modules)
#   ./deploy.sh testnet             # testnet only (CCTP only)
#   ./deploy.sh both frontend       # both + frontend dev server
#   ./deploy.sh mainnet watch       # mainnet with hot-reload
# ──────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/../../frontend" 2>/dev/null && pwd || echo "")"

MODE="${1:-both}"
EXTRA="${2:-}"

MAINNET_PORT=3012
TESTNET_PORT=3013
FRONTEND_PORT=5173

PIDS=()

# ── Colors ────────────────────────────────────────────────────────────────────
C_CYAN="\033[36m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_MAGENTA="\033[35m"
C_GRAY="\033[90m"
C_WHITE="\033[97m"
C_RESET="\033[0m"

header()  { echo -e "\n${C_CYAN}=== $1 ===${C_RESET}"; }
ok()      { echo -e "  ${C_GREEN}[OK]${C_RESET} $1"; }
info()    { echo -e "  ${C_GRAY}-->  $1${C_RESET}"; }
warn()    { echo -e "  ${C_YELLOW}[!]${C_RESET} $1"; }

# ── Module matrix ─────────────────────────────────────────────────────────────
header "BCH Intents - Deployment"
echo ""
echo -e "  ${C_GRAY}Module              Mainnet    Testnet${C_RESET}"
echo -e "  ${C_GRAY}───────────────────────────────────────${C_RESET}"
echo -e "  ${C_WHITE}CCTP (USDC)           YES        YES${C_RESET}"
echo -e "  ${C_WHITE}Solana / Jupiter      YES         NO${C_RESET}"
echo -e "  ${C_WHITE}BCH / 1Click          YES         NO${C_RESET}"
echo -e "  ${C_WHITE}Lend / Liquidium      YES         NO${C_RESET}"
echo -e "  ${C_WHITE}LendBCH / Paryon      YES    chipnet${C_RESET}"
echo ""

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
    header "Shutting down..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            info "Stopping PID $pid"
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null
    ok "All servers stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# ── Kill stale processes on a port ────────────────────────────────────────────
kill_port() {
    local port="$1"
    # Works on both Git Bash (Windows) and Linux/macOS
    if command -v netstat &>/dev/null; then
        # Windows / Git Bash
        local pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep "LISTENING" | awk '{print $5}' | head -1)
        if [[ -n "$pid" && "$pid" != "0" ]]; then
            warn "Port $port in use by PID $pid — killing it"
            taskkill //F //PID "$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
            sleep 1
        fi
    elif command -v lsof &>/dev/null; then
        # macOS / Linux
        local pid=$(lsof -ti ":$port" 2>/dev/null | head -1)
        if [[ -n "$pid" ]]; then
            warn "Port $port in use by PID $pid — killing it"
            kill "$pid" 2>/dev/null || true
            sleep 1
        fi
    fi
}

# ── Start a server instance ──────────────────────────────────────────────────
start_server() {
    local network="$1"
    local port="$2"
    local runner="npx tsx"

    if [[ "$EXTRA" == "watch" ]]; then
        runner="npx tsx watch"
    fi

    header "$(echo "$network" | tr '[:lower:]' '[:upper:]') Server - port $port"

    local env_prefix="CCTP_NETWORK=$network PORT=$port"

    if [[ "$network" == "testnet" ]]; then
        env_prefix="$env_prefix JUPITER_ENABLED=false BCH_SWAPS_ENABLED=false LEND_ENABLED=false LENDBCH_ENABLED=false"
        info "CCTP only (Jupiter, BCH, Lend, LendBCH are mainnet-only)"
    else
        info "All modules: CCTP + Jupiter + BCH 1Click + Lend + LendBCH"
    fi

    local datadir="./data"
    [[ "$network" == "mainnet" ]] && datadir="./data-mainnet"
    info "Data dir: $datadir"
    info "Runner: $runner"

    kill_port "$port"

    cd "$SERVER_DIR"
    eval "$env_prefix $runner src/index.ts" &
    PIDS+=($!)
    ok "Started $network server (PID: ${PIDS[-1]})"
}

# ── Launch servers ────────────────────────────────────────────────────────────
if [[ "$MODE" == "mainnet" || "$MODE" == "both" ]]; then
    start_server "mainnet" "$MAINNET_PORT"
fi

if [[ "$MODE" == "testnet" || "$MODE" == "both" ]]; then
    start_server "testnet" "$TESTNET_PORT"
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
if [[ "$EXTRA" == "frontend" ]]; then
    if [[ -z "$FRONTEND_DIR" ]]; then
        warn "Frontend directory not found. Skipping."
    else
        header "Frontend - Vite dev server"
        info "Dir: $FRONTEND_DIR"
        cd "$FRONTEND_DIR"
        npm run dev &
        PIDS+=($!)
        ok "Started frontend (PID: ${PIDS[-1]})"
    fi
fi

# ── Health checks ─────────────────────────────────────────────────────────────
header "Waiting for servers to boot..."

health_check() {
    local name="$1"
    local port="$2"
    local attempts=15
    local resp=""
    for ((i=1; i<=attempts; i++)); do
        resp=$(curl -s "http://localhost:$port/health" 2>/dev/null || echo "")
        if echo "$resp" | grep -q '"status":"ok"'; then
            local network=$(echo "$resp" | grep -o '"network":"[^"]*"' | head -1 | cut -d'"' -f4)
            ok "$name health OK - network: $network (ready in ~${i}s)"
            return 0
        fi
        sleep 1
    done
    warn "$name not responding yet on port $port after ${attempts}s (may still be booting)"
    return 0
}

if [[ "$MODE" == "mainnet" || "$MODE" == "both" ]]; then
    health_check "Mainnet" "$MAINNET_PORT"
fi
if [[ "$MODE" == "testnet" || "$MODE" == "both" ]]; then
    health_check "Testnet" "$TESTNET_PORT"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
header "Deployment Summary"
echo ""
if [[ "$MODE" == "mainnet" || "$MODE" == "both" ]]; then
    echo -e "  ${C_WHITE}Mainnet : http://localhost:$MAINNET_PORT  (CCTP + Jupiter + BCH + Lend)${C_RESET}"
fi
if [[ "$MODE" == "testnet" || "$MODE" == "both" ]]; then
    echo -e "  ${C_WHITE}Testnet : http://localhost:$TESTNET_PORT  (CCTP only)${C_RESET}"
fi
if [[ "$EXTRA" == "frontend" && -n "$FRONTEND_DIR" ]]; then
    echo -e "  ${C_WHITE}Frontend: http://localhost:$FRONTEND_PORT${C_RESET}"
fi
echo ""
echo -e "  ${C_CYAN}Press Ctrl+C to stop all servers${C_RESET}"
echo ""

# ── Keep alive ────────────────────────────────────────────────────────────────
wait
