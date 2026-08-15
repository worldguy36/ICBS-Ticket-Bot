#!/bin/bash
cd /home/z/my-project/mini-services/icbs-ticket-bot

pkill -9 -f "bun index.ts" 2>/dev/null
sleep 2

setsid bash -c 'exec bun index.ts' > /tmp/icbs-ticket-bot.log 2>&1 < /dev/null &
disown

echo "Bot started. Waiting for slash commands to register..."
for i in $(seq 1 25); do
  if grep -q "Slash commands registered" /tmp/icbs-ticket-bot.log 2>/dev/null; then
    echo "✅ Slash commands registered (after ${i}s)"
    break
  fi
  if ! pgrep -f "bun index.ts" > /dev/null; then
    echo "❌ Bot died. Log:"
    tail -30 /tmp/icbs-ticket-bot.log
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Startup log (top 25 lines) ==="
head -25 /tmp/icbs-ticket-bot.log

echo ""
echo "=== Verify all slash commands in Discord ==="
cat > ./verify-slash.ts << 'EOF'
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);
(async () => {
  const cmds = await rest.get(Routes.applicationGuildCommands('1533128810869030992', process.env.DISCORD_GUILD_ID!)) as any[];
  console.log(`\n${cmds.length} slash commands registered:\n`);
  for (const c of cmds) {
    const opts = c.options || [];
    const optStr = opts.length > 0 ? opts.map((o: any) => `${o.name}${o.required ? '' : '?'}${o.choices ? `[${o.choices.map((ch:any)=>ch.name).join('|')}]` : ''}`).join(', ') : '(no options)';
    console.log(`  /${c.name}  — ${c.description}`);
    console.log(`    Options: ${optStr}`);
    console.log('');
  }
})().catch((e) => { console.error(e); process.exit(1); });
EOF
bun verify-slash.ts 2>&1 | tail -50
rm -f verify-slash.ts
