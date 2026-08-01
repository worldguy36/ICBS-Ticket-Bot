#!/bin/bash
# Start the ticket bot in live mode with ICBS_PUBLIC_URL set, fully detached.
cd /home/z/my-project/mini-services/icbs-ticket-bot

# Kill any existing instance
pkill -9 -f "bun index.ts" 2>/dev/null
sleep 2

# Start fully detached (double-fork via setsid)
LOG=/tmp/icbs-ticket-bot.log
setsid bash -c 'ICBS_PUBLIC_URL=http://localhost:3040 exec bun index.ts' > "$LOG" 2>&1 < /dev/null &
disown

echo "Bot started. Waiting for ready..."
for i in $(seq 1 15); do
  if grep -q "Ready. Listening on port" "$LOG" 2>/dev/null; then
    echo "✅ Bot ready (after ${i}s)"
    break
  fi
  sleep 1
done

# Quick health check
echo ""
echo "=== /health ==="
curl -s --max-time 3 http://localhost:3040/health | python3 -c "
import json,sys
try:
  h=json.load(sys.stdin)
  print(f\"mode={h['mode']} ready={h['ready']} bot={h['bot']['tag'] if h['bot'] else 'null'} panel={'posted' if h['panel'] else 'none'}\")
except: print('FAILED')
"

echo ""
echo "=== /brand-icon.webp ==="
curl -s -o /tmp/test-logo.webp -w "HTTP %{http_code} | Content-Type: %{content_type} | Size: %{size_download} bytes\n" http://localhost:3040/brand-icon.webp

echo ""
echo "=== Posting panel ==="
curl -s --max-time 15 -X POST http://localhost:3040/setup-panel \
  -H "x-icbs-secret: e6f71b539f56bae5c56d5a4b96e5426fc4650e26fe63c879" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

echo ""
echo "Bot PID: $(pgrep -f 'bun index.ts' | head -1)"
echo "Log: tail -f /tmp/icbs-ticket-bot.log"
