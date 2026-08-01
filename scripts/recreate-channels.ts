/**
 * Recreate the 🎫 Tickets category, #ticket-panel, and #ticket-logs channels.
 * Used because they were deleted from Discord.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once(Events.ClientReady, async (client) => {
  const g = await client.guilds.fetch(process.env.DISCORD_GUILD_ID!);
  console.log(`Guild: ${g.name}`);

  // 1. Create the category
  const cat = await g.channels.create({
    name: '🎫 Tickets',
    type: ChannelType.GuildCategory,
    reason: 'Recreating ticket category',
  });
  console.log(`✅ Created category: ${cat.name} (${cat.id})`);

  // 2. Create #ticket-panel under it
  const panel = await g.channels.create({
    name: 'ticket-panel',
    type: ChannelType.GuildText,
    parent: cat.id,
    topic: '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Support Desk. Select a category to open a ticket.',
    reason: 'Recreating panel channel',
  });
  console.log(`✅ Created channel: #${panel.name} (${panel.id})`);

  // 3. Create #ticket-logs under it (hidden from @everyone)
  const logs = await g.channels.create({
    name: 'ticket-logs',
    type: ChannelType.GuildText,
    parent: cat.id,
    topic: '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — ticket open/close logs and transcripts.',
    permissionOverwrites: [
      { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ],
    reason: 'Recreating logs channel',
  });
  console.log(`✅ Created channel: #${logs.name} (${logs.id})`);

  // 4. Update .env with the new IDs
  const envPath = path.resolve(process.cwd(), '.env');
  let env = fs.readFileSync(envPath, 'utf-8');
  const updates: [string, string][] = [
    ['TICKET_CATEGORY_ID', cat.id],
    ['TICKET_PANEL_CHANNEL_ID', panel.id],
    ['TICKET_LOG_CHANNEL_ID', logs.id],
  ];
  for (const [k, v] of updates) {
    env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
  }
  fs.writeFileSync(envPath, env);
  console.log('✅ Updated .env with new IDs');

  await c.destroy();
  process.exit(0);
});

c.login(process.env.DISCORD_BOT_TOKEN);
setTimeout(() => process.exit(1), 15000).unref();
