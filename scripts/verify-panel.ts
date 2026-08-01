/**
 * Verify the ticket panel message actually posted to Discord by fetching it.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN!;
const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID!;
const PANEL_MESSAGE_ID = process.argv[2] || '1533131560260468820';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = await c.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(PANEL_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    console.error('Panel channel not found or not text-based');
    process.exit(1);
  }
  console.log(`\nFetched channel: #${channel.name} (${channel.id})`);
  const msg = await channel.messages.fetch(PANEL_MESSAGE_ID);
  console.log(`\nPanel message fetched: ${msg.id}`);
  console.log(`Author: ${msg.author.tag}`);
  console.log(`Posted at: ${msg.createdAt.toISOString()}`);
  console.log(`Components (rows): ${msg.components.length}`);
  for (const row of msg.components) {
    console.log(`  Row ${row.type}:`);
    for (const comp of row.components) {
      // @ts-ignore
      console.log(`    - ${comp.type} customId=${comp.data?.custom_id || comp.customId || '-'} placeholder=${comp.data?.placeholder || comp.placeholder || '-'}`);
      // @ts-ignore
      if (comp.options) {
        // @ts-ignore
        for (const opt of comp.options) {
          // @ts-ignore
          console.log(`        option: value=${opt.value} label=${opt.label} emoji=${opt.emoji?.name || '-'}`);
        }
      }
    }
  }
  console.log(`\nEmbeds: ${msg.embeds.length}`);
  for (const e of msg.embeds) {
    console.log(`  Embed:`);
    console.log(`    Title: ${e.title}`);
    console.log(`    Description: ${(e.description || '').slice(0, 120)}…`);
    console.log(`    Author: ${e.author?.name}`);
    console.log(`    Footer: ${e.footer?.text}`);
    console.log(`    Color: #${e.color?.toString(16).padStart(6, '0')}`);
    console.log(`    Fields: ${e.fields.length}`);
    for (const f of e.fields) {
      console.log(`      - ${f.name}: ${f.value.slice(0, 80)}${f.value.length > 80 ? '…' : ''}`);
    }
  }
  await client.destroy();
  process.exit(0);
});

client.login(TOKEN);
setTimeout(() => process.exit(2), 15000).unref();
