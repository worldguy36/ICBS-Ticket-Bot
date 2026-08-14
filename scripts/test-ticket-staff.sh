#!/bin/bash
cd /home/z/my-project/mini-services/icbs-ticket-bot

pkill -9 -f "bun index.ts" 2>/dev/null
sleep 2

setsid bash -c 'ICBS_PUBLIC_URL=http://localhost:3040 exec bun index.ts' > /tmp/icbs-ticket-bot.log 2>&1 < /dev/null &
disown

echo "Bot started. Waiting for slash commands to register..."
for i in $(seq 1 20); do
  if grep -q "Slash commands registered" /tmp/icbs-ticket-bot.log 2>/dev/null; then
    echo "✅ Slash commands registered (after ${i}s)"
    break
  fi
  sleep 1
done

echo ""
echo "=== Verify all slash commands in Discord ==="
cat > /tmp/verify-slash.ts << 'EOF'
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);
(async () => {
  const cmds = await rest.get(Routes.applicationGuildCommands('1533128810869030992', process.env.DISCORD_GUILD_ID!)) as any[];
  console.log(`\n${cmds.length} slash commands registered:\n`);
  for (const c of cmds) {
    const opts = c.options || [];
    const optStr = opts.length > 0 ? opts.map((o: any) => `${o.name}${o.required ? '' : '?'}`).join(', ') : '(no options)';
    console.log(`  /${c.name}  — ${c.description}`);
    console.log(`    Options: ${optStr}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
EOF
cp /tmp/verify-slash.ts ./verify-slash.ts
bun verify-slash.ts 2>&1
rm -f verify-slash.ts
