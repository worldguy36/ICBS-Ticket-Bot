#!/bin/bash
# Start the ticket bot in live mode, wait for it to become ready,
# post the ticket panel via /setup-panel, then leave the bot running
# in the background so the user can interact with it.
set -e
cd /home/z/my-project/mini-services/icbs-ticket-bot

# Source env so we can use ICBS_WEBHOOK_SECRET below
set -a
source .env
set +a

echo "=== Starting 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 in live mode ==="
echo "    Port: $ICBS_BOT_PORT"
echo "    Guild: $DISCORD_GUILD_ID"
echo "    Panel channel: $TICKET_PANEL_CHANNEL_ID"
echo ""

# Start the bot in the background, log to a file
LOG_FILE=/tmp/icbs-ticket-bot.log
bun index.ts > "$LOG_FILE" 2>&1 &
BOT_PID=$!
echo "    Bot PID: $BOT_PID"
echo "    Log file: $LOG_FILE"
echo ""

# Wait for "Ready" in the log
echo "=== Waiting for bot to become ready (up to 20s) ==="
for i in $(seq 1 20); do
  if grep -q "Ready. Listening on port" "$LOG_FILE" 2>/dev/null; then
    echo "    ✅ Bot is ready (after ${i}s)"
    break
  fi
  if ! kill -0 $BOT_PID 2>/dev/null; then
    echo "    ❌ Bot process exited early. Log:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Bot log so far ==="
cat "$LOG_FILE"
echo ""

# Give the slash command registration a moment
sleep 2

echo "=== Calling /health ==="
curl -s --max-time 5 http://localhost:${ICBS_BOT_PORT}/health | python3 -m json.tool 2>/dev/null | head -40
echo ""

echo "=== Posting the ticket panel via /setup-panel ==="
RESPONSE=$(curl -s --max-time 10 -X POST http://localhost:${ICBS_BOT_PORT}/setup-panel \
  -H "x-icbs-secret: ${ICBS_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

echo "=== Final /health check ==="
curl -s --max-time 5 http://localhost:${ICBS_BOT_PORT}/health | python3 -m json.tool 2>/dev/null | head -50
echo ""

# Leave the bot running
echo "=== Bot is running in background (PID $BOT_PID) ==="
echo "    To stop: kill $BOT_PID"
echo "    To tail logs: tail -f $LOG_FILE"
echo "    Health: curl http://localhost:${ICBS_BOT_PORT}/health"

# Detach the bot so this script can exit without killing it
disown $BOT_PID 2>/dev/null || true
exit 0
