/**
 * Verify slash commands are registered in Discord.
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);

(async () => {
  const cmds = await rest.get(
    Routes.applicationGuildCommands('1533128810869030992', process.env.DISCORD_GUILD_ID!),
  ) as any[];
  console.log(`\n${cmds.length} slash commands registered in Discord:\n`);
  for (const c of cmds) {
    const opts = c.options || [];
    const optStr = opts.length > 0
      ? opts.map((o: any) => `${o.name}${o.required ? '' : '?'}`).join(', ')
      : '(no options)';
    console.log(`  /${c.name}  — ${c.description}`);
    console.log(`    Options: ${optStr}`);
    console.log('');
  }
})().catch((e) => { console.error(e); process.exit(1); });
