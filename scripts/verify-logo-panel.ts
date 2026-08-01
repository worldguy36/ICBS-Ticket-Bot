/**
 * Verify the enhanced panel now uses the brand-icon.webp URL as the thumbnail.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once(Events.ClientReady, async (client) => {
  const g = await client.guilds.fetch(process.env.DISCORD_GUILD_ID!);
  const ch = await g.channels.fetch(process.env.TICKET_PANEL_CHANNEL_ID!);
  if (!ch || !ch.isTextBased()) { console.error('bad channel'); process.exit(1); }
  const msg = await ch.messages.fetch('1533214729516879973');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PANEL MESSAGE — verifying logo + categories');
  console.log('═══════════════════════════════════════════════════════════');
  for (const e of msg.embeds) {
    console.log(`Title:     ${e.title}`);
    console.log(`Author:    ${e.author?.name}  (icon: ${e.author?.iconURL || '(none)'})`);
    console.log(`Footer:    ${e.footer?.text}  (icon: ${e.footer?.iconURL || '(none)'})`);
    console.log(`Thumbnail: ${e.thumbnail?.url || '(none)'}`);
    console.log(`Color:     #${(e.color || 0).toString(16).padStart(6, '0')}`);
    console.log(`Fields:    ${e.fields.length}`);
  }
  console.log();
  console.log('--- Select menu options ---');
  for (const row of msg.components) {
    for (const comp of row.components) {
      // @ts-ignore
      if (comp.options) {
        // @ts-ignore
        for (const opt of comp.options) {
          // @ts-ignore
          console.log(`  ${opt.emoji?.name || ''} ${opt.label} (value=${opt.value})`);
        }
      }
    }
  }
  await c.destroy();
  process.exit(0);
});
c.login(process.env.DISCORD_BOT_TOKEN);
setTimeout(() => process.exit(1), 10000).unref();
