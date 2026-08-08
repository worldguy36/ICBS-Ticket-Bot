/**
 * Fetch the enhanced panel message from Discord and pretty-print its structure.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once(Events.ClientReady, async (client) => {
  const g = await client.guilds.fetch(process.env.DISCORD_GUILD_ID!);
  const ch = await g.channels.fetch(process.env.TICKET_PANEL_CHANNEL_ID!);
  if (!ch || !ch.isTextBased()) { console.error('bad channel'); process.exit(1); }
  const msg = await ch.messages.fetch('1533209509135257874');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ENHANCED PANEL MESSAGE — Discord verification');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Message ID: ${msg.id}`);
  console.log(`Author: ${msg.author.tag}`);
  console.log();
  console.log('--- EMBED ---');
  for (const e of msg.embeds) {
    console.log(`  Title:       ${e.title}`);
    console.log(`  Description:`);
    (e.description || '').split('\n').forEach((l) => console.log(`    ${l}`));
    console.log(`  Author:      ${e.author?.name || '(none)'}`);
    console.log(`  Footer:      ${e.footer?.text || '(none)'}`);
    console.log(`  Color:       #${(e.color || 0).toString(16).padStart(6, '0')}`);
    console.log(`  Thumbnail:   ${e.thumbnail?.url || '(none)'}`);
    console.log(`  Timestamp:   ${e.timestamp?.toISOString() || '(none)'}`);
    console.log(`  Fields (${e.fields.length}):`);
    for (const f of e.fields) {
      console.log(`    ── ${f.name} ${f.inline ? '[inline]' : ''}`);
      (f.value || '').split('\n').forEach((l) => console.log(`       ${l}`));
    }
  }
  console.log();
  console.log('--- COMPONENTS ---');
  for (const row of msg.components) {
    for (const comp of row.components) {
      // @ts-ignore
      console.log(`  ${comp.constructor.name} customId=${comp.data?.custom_id || comp.customId || '-'} placeholder=${comp.data?.placeholder || comp.placeholder || '-'}`);
      // @ts-ignore
      if (comp.options) {
        // @ts-ignore
        for (const opt of comp.options) {
          // @ts-ignore
          console.log(`    option: ${opt.emoji?.name || ''} ${opt.label} (value=${opt.value})`);
        }
      }
    }
  }
  await c.destroy();
  process.exit(0);
});
c.login(process.env.DISCORD_BOT_TOKEN);
setTimeout(() => process.exit(1), 10000).unref();
