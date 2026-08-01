#!/bin/bash
# Start the bot, verify slash commands register, test /ticket-panel (simulate).
cd /home/z/my-project/mini-services/icbs-ticket-bot

pkill -9 -f "bun index.ts" 2>/dev/null
sleep 2

setsid bash -c 'ICBS_PUBLIC_URL=http://localhost:3040 exec bun index.ts' > /tmp/icbs-ticket-bot.log 2>&1 < /dev/null &
disown

echo "Bot started. Waiting for ready..."
for i in $(seq 1 20); do
  if grep -q "Slash commands registered" /tmp/icbs-ticket-bot.log 2>/dev/null; then
    echo "✅ Slash commands registered (after ${i}s)"
    break
  fi
  if ! pgrep -f "bun index.ts" > /dev/null; then
    echo "❌ Bot died. Log:"
    cat /tmp/icbs-ticket-bot.log
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Startup log (first 25 lines) ==="
head -25 /tmp/icbs-ticket-bot.log

echo ""
echo "=== /health (verify commands registered) ==="
curl -s --max-time 5 http://localhost:3040/health | python3 -c "
import json,sys
h=json.load(sys.stdin)
print(f\"mode={h['mode']} ready={h['ready']}\")
print(f\"bot={h['bot']['tag'] if h['bot'] else 'null'}\")
print(f\"panel={'posted' if h['panel'] else 'none'}\")
"
