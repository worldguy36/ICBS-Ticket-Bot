#!/bin/bash
# Start the bot, then test the HTML status page + /uptime endpoint.
cd /home/z/my-project/mini-services/icbs-ticket-bot

pkill -9 -f "bun index.ts" 2>/dev/null
sleep 2

setsid bash -c 'ICBS_PUBLIC_URL=http://localhost:3040 exec bun index.ts' > /tmp/icbs-ticket-bot.log 2>&1 < /dev/null &
disown

echo "Bot started. Waiting for ready..."
for i in $(seq 1 15); do
  if grep -q "Ready. Listening on port" /tmp/icbs-ticket-bot.log 2>/dev/null; then
    echo "✅ Bot ready (after ${i}s)"
    break
  fi
  sleep 1
done

echo ""
echo "=== Startup log ==="
head -15 /tmp/icbs-ticket-bot.log

echo ""
echo "=== GET / (HTML status page) ==="
RESPONSE=$(curl -s --max-time 5 http://localhost:3040/)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3040/)
CONTENT_TYPE=$(curl -s -o /dev/null -w "%{content_type}" --max-time 5 http://localhost:3040/)
echo "HTTP $HTTP_CODE | Content-Type: $CONTENT_TYPE"
echo "Page length: ${#RESPONSE} chars"
echo ""
echo "--- First 40 lines of HTML ---"
echo "$RESPONSE" | head -40

echo ""
echo "=== GET /uptime (plain text for UptimeRobot) ==="
curl -sv --max-time 5 http://localhost:3040/uptime 2>&1 | grep -E "^< |^> |HTTP/" | head -10

echo ""
echo "=== GET /status (alias) ==="
curl -s -o /dev/null -w "HTTP %{http_code} | Content-Type: %{content_type} | Size: %{size_download} bytes\n" --max-time 5 http://localhost:3040/status

echo ""
echo "=== GET /dashboard (alias) ==="
curl -s -o /dev/null -w "HTTP %{http_code} | Content-Type: %{content_type} | Size: %{size_download} bytes\n" --max-time 5 http://localhost:3040/dashboard

echo ""
echo "=== GET /health (JSON — still works) ==="
curl -s --max-time 3 http://localhost:3040/health | python3 -c "import json,sys; h=json.load(sys.stdin); print(f\"mode={h['mode']} ready={h['ready']} totalTickets={h['stats']['totalTickets']}\")"

echo ""
echo "=== Verify HTML contains key elements ==="
echo "$RESPONSE" | grep -oE '(𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡|LIVE|DEMO|Total Tickets|Configuration Checks|brand-icon.webp)' | sort -u | head -10

echo ""
echo "Bot PID: $(pgrep -f 'bun index.ts' | head -1)"
