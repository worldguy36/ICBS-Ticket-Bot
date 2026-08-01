/**
 * ============================================================================
 *  scripts/setup-guild.ts
 * ----------------------------------------------------------------------------
 *  Creates the Discord-side resources the ticket bot needs, then writes their
 *  IDs into .env. Idempotent — if a resource already exists (matched by name),
 *  reuses it instead of creating a duplicate.
 *
 *  Creates:
 *    - "🎫 Tickets" channel category          → TICKET_CATEGORY_ID
 *    - #ticket-panel text channel              → TICKET_PANEL_CHANNEL_ID
 *    - #ticket-logs text channel               → TICKET_LOG_CHANNEL_ID
 *
 *  Reuses existing roles:
 *    - @ICBS Ticket Bot  (has Administrator)   → TICKET_ADMIN_ROLE_ID
 *    - @Support Staff                          → TICKET_STAFF_ROLE_IDS
 *
 *  Run:  cd mini-services/icbs-ticket-bot && bun ../../scripts/setup-guild.ts
 * ============================================================================
 */

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  Events,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN || !GUILD_ID) {
  console.error('❌ DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must both be set in .env');
  process.exit(1);
}

const ENV_FILE = path.resolve(process.cwd(), '.env');

// Names of the resources we'll create / look for
const TICKET_CATEGORY_NAME = '🎫 Tickets';
const PANEL_CHANNEL_NAME = 'ticket-panel';
const LOGS_CHANNEL_NAME = 'ticket-logs';
const ADMIN_ROLE_NAME = 'ICBS Ticket Bot';
const STAFF_ROLE_NAME = 'Support Staff';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

function updateEnvFile(updates: Record<string, string>) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      content += `${content.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
    }
  }
  fs.writeFileSync(ENV_FILE, content);
  console.log(`   ✏️  .env updated: ${Object.keys(updates).join(', ')}`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`\n✅ Logged in as ${c.user.tag}`);
  console.log(`🎯 Target guild: ${GUILD_ID}\n`);

  const guild = await c.guilds.fetch(GUILD_ID).catch((err) => {
    console.error(`❌ Could not fetch guild ${GUILD_ID}:`, err?.message || err);
    process.exit(1);
  });
  console.log(`   Guild name: ${guild.name}\n`);

  // ---- Fetch everything ----
  const [channels, roles] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);

  const existingCategories = [...channels.values()].filter(
    (c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildCategory,
  );
  const existingTextChannels = [...channels.values()].filter(
    (c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildText,
  );
  const existingRoles = [...roles.values()].filter((r) => r && r.name !== '@everyone');

  // ---- 1. Ticket Category ----
  console.log('─'.repeat(60));
  console.log('1️⃣  Ticket channel category');
  let ticketCategory = existingCategories.find(
    (c) => c.name.toLowerCase() === TICKET_CATEGORY_NAME.toLowerCase() || /^tickets?$/i.test(c.name),
  );
  if (ticketCategory) {
    console.log(`   ♻️  Reusing existing category: "${ticketCategory.name}" (${ticketCategory.id})`);
  } else {
    try {
      ticketCategory = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: 'Ticket bot setup — category for ticket channels',
      });
      console.log(`   ✨ Created category: "${ticketCategory.name}" (${ticketCategory.id})`);
    } catch (err: any) {
      console.error(`   ❌ Failed to create category: ${err?.message || err}`);
      if (err?.code === 50013) {
        console.error('      → Bot lacks Manage Channels permission. Re-invite with the permissions in the README.');
      }
      process.exit(1);
    }
  }

  // ---- 2. #ticket-panel channel ----
  console.log('─'.repeat(60));
  console.log('2️⃣  #ticket-panel channel');
  let panelChannel = existingTextChannels.find(
    (c) => c.name.toLowerCase() === PANEL_CHANNEL_NAME,
  );
  if (panelChannel) {
    console.log(`   ♻️  Reusing existing channel: #${panelChannel.name} (${panelChannel.id})`);
  } else {
    try {
      panelChannel = await guild.channels.create({
        name: PANEL_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        topic: '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Support Desk. Select a category to open a ticket.',
        reason: 'Ticket bot setup — panel channel',
      });
      console.log(`   ✨ Created channel: #${panelChannel.name} (${panelChannel.id})`);
    } catch (err: any) {
      console.error(`   ❌ Failed to create #ticket-panel: ${err?.message || err}`);
      process.exit(1);
    }
  }

  // ---- 3. #ticket-logs channel ----
  console.log('─'.repeat(60));
  console.log('3️⃣  #ticket-logs channel');
  let logsChannel = existingTextChannels.find(
    (c) => c.name.toLowerCase() === LOGS_CHANNEL_NAME,
  );
  if (logsChannel) {
    console.log(`   ♻️  Reusing existing channel: #${logsChannel.name} (${logsChannel.id})`);
  } else {
    try {
      logsChannel = await guild.channels.create({
        name: LOGS_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        topic: '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — ticket open/close logs and transcripts.',
        // Only staff/admin can see the logs channel
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
        reason: 'Ticket bot setup — logs channel',
      });
      console.log(`   ✨ Created channel: #${logsChannel.name} (${logsChannel.id})`);
    } catch (err: any) {
      console.error(`   ❌ Failed to create #ticket-logs: ${err?.message || err}`);
      process.exit(1);
    }
  }

  // ---- 4. Admin role (reuse @ICBS Ticket Bot if it exists) ----
  console.log('─'.repeat(60));
  console.log('4️⃣  Admin role');
  let adminRole = existingRoles.find(
    (r) => r.name.toLowerCase() === ADMIN_ROLE_NAME.toLowerCase(),
  );
  if (adminRole) {
    console.log(`   ♻️  Reusing existing role: @${adminRole.name} (${adminRole.id})`);
    if (!adminRole.permissions.has(PermissionFlagsBits.Administrator)) {
      console.warn(`   ⚠️  This role does NOT have Administrator permission. Ticket admin actions may fail.`);
    }
  } else {
    try {
      adminRole = await guild.roles.create({
        name: ADMIN_ROLE_NAME,
        permissions: PermissionFlagsBits.Administrator,
        color: 0x2b2b2b,
        reason: 'Ticket bot setup — admin role',
      });
      console.log(`   ✨ Created role: @${adminRole.name} (${adminRole.id})`);
    } catch (err: any) {
      console.error(`   ❌ Failed to create admin role: ${err?.message || err}`);
      process.exit(1);
    }
  }

  // ---- 5. Staff role (reuse @Support Staff if it exists) ----
  console.log('─'.repeat(60));
  console.log('5️⃣  Staff role');
  let staffRole = existingRoles.find(
    (r) => r.name.toLowerCase() === STAFF_ROLE_NAME.toLowerCase(),
  );
  if (staffRole) {
    console.log(`   ♻️  Reusing existing role: @${staffRole.name} (${staffRole.id})`);
  } else {
    try {
      staffRole = await guild.roles.create({
        name: STAFF_ROLE_NAME,
        color: 0x2ecc71,
        reason: 'Ticket bot setup — staff role',
      });
      console.log(`   ✨ Created role: @${staffRole.name} (${staffRole.id})`);
    } catch (err: any) {
      console.error(`   ❌ Failed to create staff role: ${err?.message || err}`);
      process.exit(1);
    }
  }

  // ---- 6. Write to .env ----
  console.log('─'.repeat(60));
  console.log('6️⃣  Writing IDs to .env');
  updateEnvFile({
    DISCORD_GUILD_ID: guild.id,
    TICKET_PANEL_CHANNEL_ID: panelChannel.id,
    TICKET_LOG_CHANNEL_ID: logsChannel.id,
    TICKET_CATEGORY_ID: ticketCategory.id,
    TICKET_ADMIN_ROLE_ID: adminRole.id,
    TICKET_STAFF_ROLE_IDS: staffRole.id,
  });

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Setup complete! .env now has all required IDs.');
  console.log('═'.repeat(60));
  console.log(`   Guild:              ${guild.name} (${guild.id})`);
  console.log(`   Panel channel:      #${panelChannel.name} (${panelChannel.id})`);
  console.log(`   Logs channel:       #${logsChannel.name} (${logsChannel.id})`);
  console.log(`   Ticket category:    ${ticketCategory.name} (${ticketCategory.id})`);
  console.log(`   Admin role:         @${adminRole.name} (${adminRole.id})`);
  console.log(`   Staff role:         @${staffRole.name} (${staffRole.id})`);
  console.log('═'.repeat(60));
  console.log('\nNext steps:');
  console.log('  1. Start the bot:    bun run dev');
  console.log('  2. Post the panel:   curl -X POST http://localhost:3040/setup-panel \\');
  console.log('                         -H "x-icbs-secret: $ICBS_WEBHOOK_SECRET" \\');
  console.log('                         -H "Content-Type: application/json" -d "{}"');
  console.log('');

  await client.destroy();
  process.exit(0);
});

client.login(TOKEN).catch((err) => {
  console.error('❌ Login failed:', err?.message || err);
  process.exit(1);
});

setTimeout(() => {
  console.error('⏰ Timeout: Discord did not become ready in 30s.');
  process.exit(2);
}, 30_000).unref();
