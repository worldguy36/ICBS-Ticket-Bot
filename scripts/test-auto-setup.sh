#!/bin/bash
# Test the auto-setup flow:
#   1. Start the bot with ONLY token + guild + secret (no channel/role IDs)
#   2. Verify /health shows config warnings
#   3. Call POST /setup-guild — should auto-create or reuse the Discord resources
#   4. Verify the response contains the IDs
#   5. Call POST /setup-guild with postPanel:true — should also post the panel
set -e
cd /home/z/my-project/mini-services/icbs-ticket-bot

# Create a test .env with ONLY the required vars (no channel/role IDs)
cat > .env.test << 'EOF'
DISCORD_BOT_TOKEN=MTUzMzEyODgxMDg2OTAzMDk5Mg.GZ3VO7.U6U5uFAv-jBXYMtONNG8zY-nIixeiG5EI8LksY
DISCORD_GUILD_ID=1509170609760763964
ICBS_BOT_PORT=3042
ICBS_WEBHOOK_SECRET=e6f71b539f56bae5c56d5a4b96e5426fc4650e26fe63c879
EOF

echo "=== Test 1: Start bot with only token + guild + secret (no channel/role IDs) ==="
LOG_FILE=/tmp/icbs-ticket-bot-autosetup.log
# Use the test env file
cp .env .env.orig
cp .env.test .env
bun index.ts > "$LOG_FILE" 2>&1 &
BOT_PID=$!
echo "  Started bot PID $BOT_PID (port 3042), waiting for ready…"
for i in $(seq 1 20); do
  if grep -q "Ready. Listening on port" "$LOG_FILE" 2>/dev/null; then
    echo "  ✅ Bot ready (after ${i}s)"
    break
  fi
  if ! kill -0 $BOT_PID 2>/dev/null; then
    echo "  ❌ Bot exited early. Log:"
    cat "$LOG_FILE"
    cp .env.orig .env && rm -f .env.test .env.orig
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Bot startup log (showing config report) ==="
cat "$LOG_FILE"

echo ""
echo "=== Test 2: GET /health (should show missing config) ==="
curl -s --max-time 5 http://localhost:3042/health | python3 -m json.tool 2>/dev/null | head -30

echo ""
echo "=== Test 3: POST /setup-guild (auto-create resources) ==="
RESPONSE=$(curl -s --max-time 30 -X POST http://localhost:3042/setup-guild \
  -H "x-icbs-secret: e6f71b539f56bae5c56d5a4b96e5426fc4650e26fe63c879" \
  -H "Content-Type: application/json" \
  -d '{"postPanel":true}')
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "=== Test 4: GET /health again (panel should now be posted) ==="
curl -s --max-time 5 http://localhost:3042/health | python3 -m json.tool 2>/dev/null | head -40

echo ""
echo "=== Cleanup ==="
kill $BOT_PID 2>/dev/null || true
wait $BOT_PID 2>/dev/null || true
# Restore original .env
cp .env.orig .env
rm -f .env.test .env.orig
echo "  Restored original .env. Bot stopped."
