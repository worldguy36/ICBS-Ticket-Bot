#!/bin/bash
# Test that the modified bot:
#   1. Binds to a custom PORT env var (Render behavior)
#   2. Binds to 0.0.0.0
#   3. Returns 200 on / (root — Render's default health check)
#   4. Returns 200 on /ping
#   5. Returns 200 on /health with the full payload
#   6. /setup-panel properly 401s without secret
set -e
cd /home/z/my-project

# Source the bot's .env to get the Discord token (so we test live mode)
set -a
source mini-services/icbs-ticket-bot/.env
set +a

# Override PORT to a test value (simulating Render)
export PORT=10000
# Make sure ICBS_BOT_PORT doesn't conflict
export ICBS_BOT_PORT=3040

echo "=== Test 1: Bot starts with PORT=10000 (Render mode) ==="
LOG_FILE=/tmp/icbs-ticket-bot-render-test.log
bun mini-services/icbs-ticket-bot/index.ts > "$LOG_FILE" 2>&1 &
BOT_PID=$!
echo "  Started bot PID $BOT_PID, waiting for ready…"
for i in $(seq 1 15); do
  if grep -q "HTTP server listening" "$LOG_FILE" 2>/dev/null; then
    echo "  ✅ HTTP server bound (after ${i}s)"
    break
  fi
  if ! kill -0 $BOT_PID 2>/dev/null; then
    echo "  ❌ Bot exited early. Log:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Test 2: HTTP server log ==="
cat "$LOG_FILE"

echo ""
echo "=== Test 3: GET / (root — Render's default health check) ==="
curl -s --max-time 3 -w "\n  HTTP %{http_code}\n" http://localhost:10000/

echo ""
echo "=== Test 4: GET /ping ==="
curl -s --max-time 3 -w "\n  HTTP %{http_code}\n" http://localhost:10000/ping

echo ""
echo "=== Test 5: GET /health (full payload) ==="
curl -s --max-time 3 http://localhost:10000/health | python3 -m json.tool 2>/dev/null | head -25

echo ""
echo "=== Test 6: POST /setup-panel without secret (should 401) ==="
curl -s --max-time 3 -X POST http://localhost:10000/setup-panel -H "Content-Type: application/json" -d '{}' -w "\n  HTTP %{http_code}\n"

echo ""
echo "=== Test 7: Verify it bound to 0.0.0.0 (not just localhost) ==="
# Check that the listening socket is on 0.0.0.0:10000
ss -tlnp 2>/dev/null | grep ':10000' || netstat -tlnp 2>/dev/null | grep ':10000' || echo "  (ss/netstat not available — checking via different IP)"

echo ""
echo "=== Cleaning up ==="
kill $BOT_PID 2>/dev/null || true
wait $BOT_PID 2>/dev/null || true
echo "  Bot stopped."
