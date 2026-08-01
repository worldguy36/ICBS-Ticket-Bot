/**
 * ============================================================================
 *  scripts/discover-guild.ts
 * ----------------------------------------------------------------------------
 *  Connects to Discord with the bot token, lists every guild the bot is in,
 *  and for each guild dumps:
 *    - all text channels (id, name, parent category)
 *    - all channel categories
 *    - all roles (id, name)
 *
 *  Then auto-detects likely candidates for the ticket-bot env vars:
 *    TICKET_PANEL_CHANNEL_ID  ← channel named "ticket-panel" (or contains "panel")
 *    TICKET_LOG_CHANNEL_ID    ← channel named "ticket-logs" / "ticket-log"
 *    TICKET_CATEGORY_ID       ← category named "tickets" / "ticket"
 *    TICKET_ADMIN_ROLE_ID     ← role named "ticket admin" / "admin"
 *    TICKET_STAFF_ROLE_IDS    ← roles named "staff" / "support" / "mod"
 *
 *  Prints a ready-to-paste .env snippet at the end.
 *
 *  Run:  cd mini-services/icbs-ticket-bot && bun ../../scripts/discover-guild.ts
 * ============================================================================
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, Events } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not set in .env');
  process.exit(1);
}

const ENV_FILE = path.resolve(process.cwd(), '.env');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`\n✅ Logged in as ${c.user.tag}\n`);
  console.log(`Bot is in ${c.guilds.cache.size} guild(s):\n`);

  const guilds = [...c.guilds.cache.values()];

  for (const g of guilds) {
    console.log('═'.repeat(80));
    console.log(`  GUILD:  ${g.name}`);
    console.log(`  ID:     ${g.id}`);
    console.log(`  Owner:  ${g.ownerId}`);
    console.log(`  Members: ${g.memberCount}`);
    console.log('═'.repeat(80));

    // Fetch all channels (cache may be partial)
    let channels;
    try {
      channels = await g.channels.fetch();
    } catch (err) {
      console.warn(`  ⚠️ could not fetch channels: ${err}`);
      channels = g.channels.cache;
    }

    const categories: { id: string; name: string }[] = [];
    const textChannels: { id: string; name: string; parentId: string | null }[] = [];
    const voiceChannels: { id: string; name: string }[] = [];

    for (const ch of channels.values()) {
      if (!ch) continue;
      if (ch.type === ChannelType.GuildCategory) {
        categories.push({ id: ch.id, name: ch.name });
      } else if (ch.type === ChannelType.GuildText) {
        textChannels.push({ id: ch.id, name: ch.name, parentId: ch.parentId });
      } else if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
        voiceChannels.push({ id: ch.id, name: ch.name });
      }
    }

    console.log('\n📂 Channel Categories:');
    if (categories.length === 0) console.log('  (none)');
    categories.forEach((c) => console.log(`  ${c.id}  ${c.name}`));

    console.log('\n#️⃣ Text Channels (with parent category):');
    if (textChannels.length === 0) console.log('  (none)');
    textChannels.forEach((c) => {
      const parent = categories.find((cat) => cat.id === c.parentId);
      console.log(`  ${c.id}  #${c.name}${parent ? `   [under: ${parent.name}]` : ''}`);
    });

    if (voiceChannels.length > 0) {
      console.log('\n🔊 Voice Channels:');
      voiceChannels.forEach((c) => console.log(`  ${c.id}  🔊 ${c.name}`));
    }

    // Fetch all roles
    let roles;
    try {
      roles = await g.roles.fetch();
    } catch (err) {
      console.warn(`  ⚠️ could not fetch roles: ${err}`);
      roles = g.roles.cache;
    }
    const roleList = [...roles.values()]
      .filter((r) => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position);

    console.log('\n🏷️  Roles (by position, highest first):');
    if (roleList.length === 0) console.log('  (none)');
    roleList.forEach((r) => {
      const perms = r.permissions.toArray();
      const adminPerms = perms.filter((p) => p.includes('Administrator') || p.includes('ManageGuild') || p.includes('ManageChannels'));
      console.log(`  ${r.id}  @${r.name}${adminPerms.length > 0 ? `   [perms: ${adminPerms.join(',')}]` : ''}`);
    });

    // ---- Auto-detect ----
    console.log('\n🤖 Auto-detection:');

    const findText = (patterns: RegExp[]): { id: string; name: string } | null => {
      for (const p of patterns) {
        const hit = textChannels.find((c) => p.test(c.name.toLowerCase()));
        if (hit) return { id: hit.id, name: hit.name };
      }
      return null;
    };
    const findCategory = (patterns: RegExp[]): { id: string; name: string } | null => {
      for (const p of patterns) {
        const hit = categories.find((c) => p.test(c.name.toLowerCase()));
        if (hit) return { id: hit.id, name: hit.name };
      }
      return null;
    };
    const findRole = (patterns: RegExp[]): { id: string; name: string } | null => {
      for (const p of patterns) {
        const hit = roleList.find((r) => p.test(r.name.toLowerCase()));
        if (hit) return { id: hit.id, name: hit.name };
      }
      return null;
    };
    const findRoles = (patterns: RegExp[]): { id: string; name: string }[] => {
      const hits = new Map<string, { id: string; name: string }>();
      for (const p of patterns) {
        for (const r of roleList) {
          if (p.test(r.name.toLowerCase())) hits.set(r.id, { id: r.id, name: r.name });
        }
      }
      return [...hits.values()];
    };

    const panel = findText([/^ticket[-_ ]?panel$/, /panel/]);
    const logs = findText([/^ticket[-_ ]?logs?$/, /ticket[-_ ]?log/, /logs?/]);
    const category = findCategory([/^tickets?$/, /ticket/]);
    const admin = findRole([/^ticket[-_ ]?admin$/, /^admin$/, /administrator/]);
    const staff = findRoles([/^ticket[-_ ]?staff$/, /^staff$/, /^support$/, /^mod(?:erator)?$/, /^helper$/]);

    const lines: string[] = [];
    lines.push(`DISCORD_GUILD_ID=${g.id}`);
    if (panel) {
      lines.push(`TICKET_PANEL_CHANNEL_ID=${panel.id}  # #${panel.name}`);
      console.log(`  ✅ TICKET_PANEL_CHANNEL_ID = ${panel.id}  (#${panel.name})`);
    } else {
      console.log(`  ❌ TICKET_PANEL_CHANNEL_ID — no channel matched "ticket-panel" / "panel"`);
    }
    if (logs) {
      lines.push(`TICKET_LOG_CHANNEL_ID=${logs.id}  # #${logs.name}`);
      console.log(`  ✅ TICKET_LOG_CHANNEL_ID = ${logs.id}  (#${logs.name})`);
    } else {
      console.log(`  ❌ TICKET_LOG_CHANNEL_ID — no channel matched "ticket-logs" / "log"`);
    }
    if (category) {
      lines.push(`TICKET_CATEGORY_ID=${category.id}  # category: ${category.name}`);
      console.log(`  ✅ TICKET_CATEGORY_ID = ${category.id}  (category: ${category.name})`);
    } else {
      console.log(`  ❌ TICKET_CATEGORY_ID — no category matched "tickets" / "ticket"`);
    }
    if (admin) {
      lines.push(`TICKET_ADMIN_ROLE_ID=${admin.id}  # @${admin.name}`);
      console.log(`  ✅ TICKET_ADMIN_ROLE_ID = ${admin.id}  (@${admin.name})`);
    } else {
      console.log(`  ❌ TICKET_ADMIN_ROLE_ID — no role matched "ticket admin" / "admin"`);
    }
    if (staff.length > 0) {
      const ids = staff.map((s) => s.id).join(',');
      const names = staff.map((s) => `@${s.name}`).join(', ');
      lines.push(`TICKET_STAFF_ROLE_IDS=${ids}  # ${names}`);
      console.log(`  ✅ TICKET_STAFF_ROLE_IDS = ${ids}  (${names})`);
    } else {
      console.log(`  ❌ TICKET_STAFF_ROLE_IDS — no role matched "staff" / "support" / "mod"`);
    }

    console.log('\n📋 Ready-to-paste .env snippet for this guild:');
    console.log('─'.repeat(60));
    lines.forEach((l) => console.log(l));
    console.log('─'.repeat(60));
  }

  // If exactly one guild, offer to auto-write to .env
  if (guilds.length === 1) {
    const g = guilds[0];
    console.log(`\n✏️  Single guild detected (${g.name}). Auto-updating .env with discovered IDs…`);

    const channels = await g.channels.fetch();
    const roles = await g.roles.fetch();
    const cats = [...channels.values()].filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name }));
    const texts = [...channels.values()].filter((c): c is NonNullable<typeof c> => !!c && c.type === ChannelType.GuildText).map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
    const roleList = [...roles.values()].filter((r) => r && r.name !== '@everyone');

    const findText = (patterns: RegExp[]) => {
      for (const p of patterns) {
        const hit = texts.find((c) => p.test(c.name.toLowerCase()));
        if (hit) return hit;
      }
      return null;
    };
    const findCat = (patterns: RegExp[]) => {
      for (const p of patterns) {
        const hit = cats.find((c) => p.test(c.name.toLowerCase()));
        if (hit) return hit;
      }
      return null;
    };
    const findRole = (patterns: RegExp[]) => {
      for (const p of patterns) {
        const hit = roleList.find((r) => p && p.test(r.name.toLowerCase()));
        if (hit) return hit;
      }
      return null;
    };
    const findRoles = (patterns: RegExp[]) => {
      const hits = new Map();
      for (const p of patterns) {
        for (const r of roleList) {
          if (p && p.test(r.name.toLowerCase())) hits.set(r.id, r);
        }
      }
      return [...hits.values()];
    };

    const panel = findText([/^ticket[-_ ]?panel$/, /panel/]);
    const logs = findText([/^ticket[-_ ]?logs?$/, /ticket[-_ ]?log/, /logs?/]);
    const category = findCat([/^tickets?$/, /ticket/]);
    const admin = findRole([/^ticket[-_ ]?admin$/, /^admin$/]);
    const staff = findRoles([/^ticket[-_ ]?staff$/, /^staff$/, /^support$/, /^mod(?:erator)?$/, /^helper$/]);

    const updates: Record<string, string> = { DISCORD_GUILD_ID: g.id };
    if (panel) updates.TICKET_PANEL_CHANNEL_ID = panel.id;
    if (logs) updates.TICKET_LOG_CHANNEL_ID = logs.id;
    if (category) updates.TICKET_CATEGORY_ID = category.id;
    if (admin) updates.TICKET_ADMIN_ROLE_ID = admin.id;
    if (staff.length > 0) updates.TICKET_STAFF_ROLE_IDS = staff.map((s) => s.id).join(',');

    // Read existing .env and update only the discovered keys
    let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
    for (const [key, value] of Object.entries(updates)) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      if (re.test(envContent)) {
        envContent = envContent.replace(re, `${key}=${value}`);
      } else {
        envContent += `${envContent.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
      }
    }
    fs.writeFileSync(ENV_FILE, envContent);
    console.log(`\n✅ Updated ${ENV_FILE} with ${Object.keys(updates).length} keys:`);
    Object.entries(updates).forEach(([k, v]) => {
      const display = v.length > 50 ? v.slice(0, 50) + '…' : v;
      console.log(`     ${k}=${display}`);
    });
  } else {
    console.log(`\n⚠️  Bot is in ${guilds.length} guilds — not auto-writing .env. Pick one guild above and set DISCORD_GUILD_ID manually.`);
  }

  console.log('\n👋 Done. Disconnecting…');
  await client.destroy();
  process.exit(0);
});

client.login(TOKEN).catch((err) => {
  console.error('❌ Login failed:', err?.message || err);
  if (err?.code === 'TokenInvalid' || /token/i.test(String(err?.message || ''))) {
    console.error('   The DISCORD_BOT_TOKEN is invalid or has been revoked.');
  }
  process.exit(1);
});

// Safety timeout — if Discord is silent for 30s, exit
setTimeout(() => {
  console.error('⏰ Timeout: Discord did not become ready in 30s.');
  process.exit(2);
}, 30_000).unref();
