#!/usr/bin/env bash
# =============================================================================
# cashtoken-relayer — Live monitoring script
#
# Railway service: 1a24e5d2-4aaf-4684-89b3-050fce8a537f
# Project:        d7a79df3-e15f-4f91-a281-f5d3973745e1 (cozy-passion)
# URL:            https://cashtoken-relayer-production.up.railway.app
# Network:        BCH chipnet (CashToken swaps: limit orders, Dutch auctions)
#
# Usage:
#   ./monitor.sh           # all logs
#   ./monitor.sh orders    # order fill events
#   ./monitor.sh errors    # errors only
#   ./monitor.sh health    # one-shot health check
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

MODE=${1:-all}

health_check() {
    echo "=== cashtoken-relayer health ==="
    curl -s https://cashtoken-relayer-production.up.railway.app/health 2>/dev/null | \
        node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
            console.log('Status:', d.status || JSON.stringify(d));" 2>/dev/null || \
        echo "(health endpoint not available)"
    echo ""
}

case "$MODE" in
    health)
        health_check
        ;;
    orders)
        echo "=== Watching order events ==="
        railway logs --filter "filled OR expired OR cancelled OR claimed OR DutchAuction OR LimitOrder OR solver"
        ;;
    errors)
        echo "=== Watching errors ==="
        railway logs --filter "@level:error OR @level:warn OR FAILED OR rejected"
        ;;
    all|*)
        health_check
        echo "=== Streaming all logs (Ctrl+C to stop) ==="
        railway logs
        ;;
esac
