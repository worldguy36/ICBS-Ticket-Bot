#!/bin/bash
# Quick smoke test of the ticket bot's HTTP server in demo mode.
set -e
cd /home/z/my-project/mini-services/icbs-ticket-bot

# Start the bot in background
bun index.ts &
BOT_PID=$!
sleep 3

echo "--- GET /health ---"
curl -s --max-time 3 http://localhost:3040/health | python3 -m json.tool 2>/dev/null | head -40

echo
echo "--- POST /setup-panel (no secret - should 401) ---"
curl -s --max-time 3 -X POST http://localhost:3040/setup-panel -H "Content-Type: application/json" -d '{}'

echo
echo "--- 404 test ---"
curl -s --max-time 3 http://localhost:3040/nonexistent

echo
kill $BOT_PID 2>/dev/null || true
wait $BOT_PID 2>/dev/null || true
echo "--- done ---"
