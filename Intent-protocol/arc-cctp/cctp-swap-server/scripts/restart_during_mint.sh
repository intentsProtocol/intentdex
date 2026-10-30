#!/usr/bin/env bash
# restart_during_mint.sh — the "restart never double-mints" property, live.
# Starts a transfer, stops the server the moment the relayer has broadcast the mint (MINT_SUBMITTED),
# starts it again, and checks the transfer completes with exactly one mint and the right balance change.
#   SRC=solana-devnet DST=eth-sepolia bash scripts/restart_during_mint.sh
# Windows (Git Bash): the server is stopped through PowerShell; start it again yourself when the script says so.
set -u
cd "$(dirname "$0")/.."
URL=${RELAYER_URL:-http://localhost:3012}
SRC=${SRC:-solana-devnet}; DST=${DST:-eth-sepolia}

server_pid() { powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3012 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -First 1" | tr -d '\r'; }

pid=$(server_pid)
[ -n "$pid" ] || { echo "no server on 3012"; exit 1; }
start=$(SRC=$SRC DST=$DST npx tsx scripts/start_transfer.ts 2>/dev/null | tail -1)
id=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$start")
echo "transfer $id ($SRC -> $DST), server pid $pid"

# poll fast (no node per iteration) and stop the server the moment the mint is broadcast
state=""
for i in $(seq 1 3000); do
  state=$(curl -s -m 2 "$URL/transfers/$id" | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4)
  case "$state" in MINT_SUBMITTED) taskkill //F //PID "$pid" >/dev/null 2>&1; stopped_ms=$(node -e "console.log(Date.now())"); break;; COMPLETED|COMPLETED_EXTERNAL|FAILED) break;; esac
  sleep 0.1
done
echo "state when stopping: $state"
if [ "$state" != "MINT_SUBMITTED" ]; then echo "RESULT missed-window (state $state): rerun"; exit 2; fi
echo "server $pid stopped at $(date +%T)"
# start the server again from another shell (on Windows: node --import tsx src/index.ts); this waits up to 5 min
echo "WAITING FOR RESTART"
for i in $(seq 1 300); do curl -s -m 2 "$URL/health" >/dev/null && break; sleep 1; done
echo "server back at $(date +%T)"

for i in $(seq 1 180); do
  t=$(curl -s -m 3 "$URL/transfers/$id")
  st=$(node -e "console.log(JSON.parse(process.argv[1]).status)" "$t" 2>/dev/null)
  case "$st" in COMPLETED|COMPLETED_EXTERNAL|FAILED|EXPIRED) break;; esac
  sleep 2
done
node -e "
const t=JSON.parse(process.argv[1]); const s=JSON.parse(process.argv[2]); const stopped=Number(process.argv[3]);
const afterStop = t.completedAt > stopped;
console.log('final', t.status, '| mint broadcasts', (t.mintTxHashes||[]).length, '| received', t.display.received, '| completed', afterStop ? 'after the restart' : 'BEFORE the stop (window missed)');
console.log('RESULT', (t.status==='COMPLETED'||t.status==='COMPLETED_EXTERNAL') && (t.mintTxHashes||[]).length===1 && afterStop ? 'PASS' : 'FAIL', JSON.stringify({id:t.id, mint:t.mintTxHash, recipient:s.recipient, before:s.before, received:t.received}));
" "$t" "$start" "$stopped_ms"
