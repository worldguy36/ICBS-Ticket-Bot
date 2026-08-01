/**
 * ============================================================================
 *  𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Advanced Discord Ticket System
 * ----------------------------------------------------------------------------
 *  Standalone micro-service that mirrors the architecture of "𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑚𝑒𝑠"
 *  news bot. Same shape:
 *    - discord.js v14 client
 *    - tiny HTTP server (node:http) with /health and /setup-panel endpoints
 *    - demo-mode when DISCORD_BOT_TOKEN is unset
 *    - reads ICBS_BOT_PORT (default 3040) — NEVER process.env.PORT
 *    - persisted state in a local JSON file (tickets.json)
 *
 *  Run:   bun --hot index.ts   (dev)   |   bun index.ts   (prod)
 * ============================================================================
 */

import 'dotenv/config';

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder,
  type Guild,
  type TextChannel,
  type Interaction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
  type User,
  type OverwriteResolvable,
} from 'discord.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, 'tickets.json');

// ---------------------------------------------------------------------------
// Branding (the special italic Unicode letters — same as the news bot)
// ---------------------------------------------------------------------------
const BRAND = '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆';
const BRAND_TICKET = '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡';
const FOOTER = '𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 — Support Delivered';
const BRAND_ICON =
  process.env.ICBS_BRAND_ICON_URL ||
  'https://cdn.discordapp.com/embed/avatars/0.png';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID || '';
const LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '';
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '';
const ADMIN_ROLE_ID = process.env.TICKET_ADMIN_ROLE_ID || '';
const STAFF_ROLE_IDS = (process.env.TICKET_STAFF_ROLE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Render web services set PORT automatically. Use it when present so the
// service binds to the port Render expects. Otherwise fall back to
// ICBS_BOT_PORT (default 3040) for local dev / detached-child mode.
// Note: in detached-child mode, ticket-client.ts sets PORT=undefined in the
// child env, so this still respects ICBS_BOT_PORT there.
const HTTP_PORT = Number(process.env.PORT || process.env.ICBS_BOT_PORT || 3040);
const WEBHOOK_SECRET = process.env.ICBS_WEBHOOK_SECRET || '';

const DEMO_MODE = !TOKEN;

// ---------------------------------------------------------------------------
// Default ticket categories (configurable via /setup-panel body)
// ---------------------------------------------------------------------------
interface Category {
  id: string;
  emoji: string;
  label: string;
  description: string;
  color: number;
  staffRoleId?: string;
}

const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'general',
    emoji: '🟥',
    label: 'General Support',
    description: 'General questions, account help, anything not listed below.',
    color: 0x4b4b4b,
  },
  {
    id: 'bug',
    emoji: '🟧',
    label: 'Bug Report',
    description: 'Report a bug or unexpected behaviour in the server or bot.',
    color: 0xe67e22,
  },
  {
    id: 'billing',
    emoji: '🟨',
    label: 'Billing / Nitro',
    description: 'Payment, subscription, Nitro, or boost issues.',
    color: 0xc5a017,
  },
  {
    id: 'partnership',
    emoji: '🟩',
    label: 'Partnership / Affiliation',
    description: 'Server partnerships, affiliation, cross-promotion.',
    color: 0x2ecc71,
  },
  {
    id: 'staff',
    emoji: '🟦',
    label: 'Staff Application',
    description: 'Apply to join the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 staff team.',
    color: 0x4b4b4b,
  },
  {
    id: 'appeal',
    emoji: '🟪',
    label: 'Appeal a Ban',
    description: 'Appeal a ban or other moderation action.',
    color: 0x9b59b6,
  },
];

// Per-category staff role overrides (from env)
let categoryRoles: Record<string, string> = {};
try {
  categoryRoles = JSON.parse(process.env.TICKET_CATEGORY_ROLES || '{}');
} catch {
  categoryRoles = {};
}

// Categories are mutable so /setup-panel can replace them at runtime.
let categories: Category[] = [...DEFAULT_CATEGORIES];

function categoryStaffRoleId(cat: Category): string | undefined {
  return cat.staffRoleId || categoryRoles[cat.id] || STAFF_ROLE_IDS[0];
}

// ---------------------------------------------------------------------------
// Persisted state (tickets.json)
// ---------------------------------------------------------------------------
interface TicketRecord {
  id: number;
  channelId: string | null;
  openerId: string;
  openerTag: string;
  categoryId: string;
  categoryLabel: string;
  openedAt: number;
  closedAt: number | null;
  closerId: string | null;
  closerTag: string | null;
  claimedById: string | null;
  claimedByTag: string | null;
  closeReason: string | null;
  messageCount: number;
  status: 'open' | 'closed' | 'reopened';
  reopenWindowUntil: number | null; // epoch ms — channel can be reopened before this
}

interface PersistedState {
  count: number;
  tickets: TicketRecord[];
  panelMessageId: string | null;
  panelChannelId: string | null;
}

function loadState(): PersistedState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        count: parsed.count || 0,
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        panelMessageId: parsed.panelMessageId || null,
        panelChannelId: parsed.panelChannelId || null,
      };
    }
  } catch (err) {
    console.warn('[ticket-bot] failed to load tickets.json, starting fresh:', err);
  }
  return { count: 0, tickets: [], panelMessageId: null, panelChannelId: null };
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[ticket-bot] failed to save tickets.json:', err);
  }
}

const state: PersistedState = loadState();

// In-memory cooldowns (not persisted — that's fine, they reset on restart)
const openCooldowns = new Map<string, number>(); // userId -> epoch ms of last open

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isStaff(member: { roles: { cache: { has: (id: string) => boolean } } } | null | undefined): boolean {
  if (!member) return false;
  if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
  return STAFF_ROLE_IDS.some((r) => member.roles.cache.has(r));
}

function categoryById(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

function openTicketCountForUser(userId: string): number {
  return state.tickets.filter((t) => t.openerId === userId && t.status !== 'closed').length;
}

function ticketByChannel(channelId: string): TicketRecord | undefined {
  return state.tickets.find((t) => t.channelId === channelId);
}

function shortCatLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'ticket';
}

function brandEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: BRAND_TICKET, iconURL: BRAND_ICON })
    .setFooter({ text: FOOTER, iconURL: BRAND_ICON })
    .setTimestamp();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeDm(user: User | undefined | null, content: string | EmbedBuilder, files?: AttachmentBuilder[]): Promise<void> {
  if (!user) return;
  try {
    const dm = await user.createDM(true);
    if (typeof content === 'string') {
      await dm.send({ content, files });
    } else {
      await dm.send({ embeds: [content], files });
    }
  } catch {
    // DMs closed or user blocked the bot — skip silently
  }
}

async function sendToLogChannel(guild: Guild | undefined, payload: { embeds?: EmbedBuilder[]; files?: AttachmentBuilder[]; content?: string }): Promise<void> {
  if (!LOG_CHANNEL_ID || !guild) return;
  try {
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    await (ch as TextChannel).send(payload);
  } catch (err) {
    console.warn('[ticket-bot] failed to post to log channel:', err);
  }
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

let ready = false;
let guild: Guild | undefined;

client.once(Events.ClientReady, async (c) => {
  console.log(`[ticket-bot] ✅ Logged in as ${c.user.tag}`);
  if (GUILD_ID) {
    try {
      guild = await c.guilds.fetch(GUILD_ID);
      console.log(`[ticket-bot] ✅ Guild resolved: ${guild.name}`);
    } catch (err) {
      console.warn('[ticket-bot] could not fetch guild:', err);
    }
  } else {
    console.warn('[ticket-bot] ⚠️ DISCORD_GUILD_ID not set — bot cannot operate. Set it in Render env vars.');
  }

  // Print a clear config report so the user knows what's missing.
  console.log('');
  console.log('─'.repeat(60));
  console.log('📋 Configuration report');
  console.log('─'.repeat(60));
  const configChecks: Array<[string, boolean, string]> = [
    ['DISCORD_BOT_TOKEN', !!TOKEN, 'Bot token (REQUIRED)'],
    ['DISCORD_GUILD_ID', !!GUILD_ID, 'Server ID (REQUIRED)'],
    ['TICKET_PANEL_CHANNEL_ID', !!PANEL_CHANNEL_ID, 'Channel for the ticket panel — leave empty to auto-create via POST /setup-guild'],
    ['TICKET_LOG_CHANNEL_ID', !!LOG_CHANNEL_ID, 'Channel for ticket logs — leave empty to auto-create via POST /setup-guild'],
    ['TICKET_CATEGORY_ID', !!TICKET_CATEGORY_ID, 'Discord category for ticket channels — leave empty to auto-create via POST /setup-guild'],
    ['TICKET_ADMIN_ROLE_ID', !!ADMIN_ROLE_ID, 'Role with full ticket access — leave empty to auto-create via POST /setup-guild'],
    ['TICKET_STAFF_ROLE_IDS', STAFF_ROLE_IDS.length > 0, 'Comma-separated staff role IDs — leave empty to auto-create via POST /setup-guild'],
    ['ICBS_WEBHOOK_SECRET', !!WEBHOOK_SECRET, 'Secret for /setup-panel and /setup-guild auth (REQUIRED)'],
  ];
  for (const [key, ok, hint] of configChecks) {
    console.log(`  ${ok ? '✅' : '⚠️ '} ${key.padEnd(28)} ${ok ? 'set' : 'NOT SET'}  — ${hint}`);
  }
  console.log('─'.repeat(60));
  if (!PANEL_CHANNEL_ID || !LOG_CHANNEL_ID || !TICKET_CATEGORY_ID || !ADMIN_ROLE_ID || !STAFF_ROLE_IDS.length) {
    console.log('💡 Tip: Call POST /setup-guild to auto-create missing channels + roles.');
    console.log('   curl -X POST <BOT_URL>/setup-guild -H "x-icbs-secret: $ICBS_WEBHOOK_SECRET" -d \'{"postPanel":true}\'');
    console.log('─'.repeat(60));
  }
  console.log('');

  // Register the /ticket-stats slash command
  try {
    await registerSlashCommands();
    console.log('[ticket-bot] ✅ Slash commands registered');
  } catch (err) {
    console.warn('[ticket-bot] slash command registration failed:', err);
  }
  ready = true;
  console.log(`[ticket-bot] ✅ Ready. Listening on port ${HTTP_PORT}`);
});

client.on(Events.Error, (err) => console.error('[ticket-bot] client error:', err));
client.on(Events.Warn, (msg) => console.warn('[ticket-bot] client warn:', msg));

// ---------------------------------------------------------------------------
// Message tracking (for transcripts + stats)
// ---------------------------------------------------------------------------
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (!msg.guild) return;
  const t = ticketByChannel(msg.channelId);
  if (!t) return;
  t.messageCount += 1;
  // Don't save on every message — periodic save below
});

setInterval(() => {
  saveState();
}, 15_000).unref();

// ---------------------------------------------------------------------------
// Slash command registration
// ---------------------------------------------------------------------------
async function registerSlashCommands() {
  if (!TOKEN || !GUILD_ID || !client.user) return;
  const commands = [
    new SlashCommandBuilder()
      .setName('ticket-stats')
      .setDescription('Show ticket statistics (staff only).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: commands,
  });
}

// ---------------------------------------------------------------------------
// Interaction: Select Menu (open ticket from panel)
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'icbs_ticket_panel') {
        await handlePanelSelect(interaction);
        return;
      }
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticket-stats') {
        await handleStatsCommand(interaction);
        return;
      }
    }
  } catch (err) {
    console.error('[ticket-bot] interaction error:', err);
    try {
      const payload = { content: '⚠️ Something went wrong handling that interaction.', ephemeral: true };
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
    } catch {
      /* noop */
    }
  }
});

// ---------------------------------------------------------------------------
// Panel select → open ticket
// ---------------------------------------------------------------------------
async function handlePanelSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild) return;
  const userId = interaction.user.id;
  const catId = interaction.values[0];
  const cat = categoryById(catId);
  if (!cat) {
    await interaction.reply({ content: '⚠️ Unknown ticket category.', ephemeral: true });
    return;
  }

  // Cooldown check
  const lastOpen = openCooldowns.get(userId) || 0;
  const now = Date.now();
  if (now - lastOpen < 60_000) {
    const wait = Math.ceil((60_000 - (now - lastOpen)) / 1000);
    await interaction.reply({
      content: `⏳ You're opening tickets too quickly. Please wait **${wait}s** before opening another.`,
      ephemeral: true,
    });
    return;
  }

  // Max open tickets check
  const openCount = openTicketCountForUser(userId);
  if (openCount >= 3) {
    await interaction.reply({
      content: `🚫 You already have **${openCount}** open tickets. Please close one before opening another.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const openerTag = member?.user.tag || interaction.user.tag;

  // Create the channel
  let channel: TextChannel;
  try {
    channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}-${shortCatLabel(cat.label)}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID || undefined,
      topic: `Ticket for ${openerTag} — ${cat.label}. Opened <t:${Math.floor(now / 1000)}:R>.`,
      permissionOverwrites: buildTicketPermissions(interaction.guild, userId, cat),
      reason: `Ticket opened by ${openerTag} (${cat.label})`,
    });
  } catch (err) {
    console.error('[ticket-bot] channel create failed:', err);
    await interaction.editReply({ content: '⚠️ Could not create a ticket channel. Please contact staff.' });
    return;
  }

  // Record the ticket
  state.count += 1;
  const ticket: TicketRecord = {
    id: state.count,
    channelId: channel.id,
    openerId: userId,
    openerTag,
    categoryId: cat.id,
    categoryLabel: cat.label,
    openedAt: now,
    closedAt: null,
    closerId: null,
    closerTag: null,
    claimedById: null,
    claimedByTag: null,
    closeReason: null,
    messageCount: 0,
    status: 'open',
    reopenWindowUntil: null,
  };
  state.tickets.push(ticket);
  openCooldowns.set(userId, now);
  saveState();

  // Build the opening embed + buttons
  const embed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} — ${cat.emoji} ${cat.label}`)
    .setDescription(
      [
        `Thank you for contacting ${BRAND} support team. A staff member will be with you shortly.`,
        '',
        `**Opened by:** <@${userId}> (\`${openerTag}\`)`,
        `**Category:** ${cat.emoji} ${cat.label}`,
        `**Opened at:** <t:${Math.floor(now / 1000)}:F>`,
        '',
        'Describe your issue in as much detail as possible. Spamming, abuse, or off-topic chatter may result in a warning.',
      ].join('\n'),
    )
    .setColor(cat.color)
    .addFields({
      name: 'Status',
      value: '🟢 **Unclaimed** — waiting for a staff member to claim.',
      inline: false,
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket_claim_${ticket.id}`).setLabel('Claim').setEmoji('📋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket_close_${ticket.id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_close_reason_${ticket.id}`).setLabel('Close with Reason').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket_reopen_${ticket.id}`).setLabel('Reopen').setEmoji('↩️').setStyle(ButtonStyle.Success).setDisabled(true),
  );

  const staffRole = categoryStaffRoleId(cat);
  const mentions = [staffRole ? `<@&${staffRole}>` : '', ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : ''].filter(Boolean).join(' ');
  await channel.send({ content: `<@${userId}> ${mentions}`, embeds: [embed], components: [row] });

  // DM the opener
  const dmEmbed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} opened`)
    .setDescription(`Your ticket has been opened in **${interaction.guild.name}**.`)
    .addFields(
      { name: 'Category', value: `${cat.emoji} ${cat.label}`, inline: true },
      { name: 'Channel', value: `[Jump to ticket](${channel.url})`, inline: true },
    )
    .setColor(cat.color);
  await safeDm(interaction.user, dmEmbed);

  // Log channel
  const logEmbed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} opened`)
    .setColor(cat.color)
    .addFields(
      { name: 'Opener', value: `<@${userId}> (\`${openerTag}\`)`, inline: true },
      { name: 'Category', value: `${cat.emoji} ${cat.label}`, inline: true },
      { name: 'Channel', value: `${channel.name} — [jump](${channel.url})`, inline: false },
      { name: 'Opened at', value: `<t:${Math.floor(now / 1000)}:F>`, inline: false },
    );
  await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });

  await interaction.editReply({ content: `✅ Ticket opened: ${channel}` });
}

function buildTicketPermissions(
  guild: Guild,
  openerId: string,
  cat: Category,
): OverwriteResolvable[] {
  const staffRoleId = categoryStaffRoleId(cat);
  const overwrites: OverwriteResolvable[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: openerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  if (ADMIN_ROLE_ID) {
    overwrites.push({
      id: ADMIN_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  // Also grant the bot itself full access (always implied, but explicit is safer)
  if (client.user) {
    overwrites.push({
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  return overwrites;
}

// ---------------------------------------------------------------------------
// Buttons: claim / close / close-with-reason / reopen
// ---------------------------------------------------------------------------
async function handleButton(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.channel) return;

  // Parse customId. Patterns:
  //   ticket_claim_{id}
  //   ticket_close_{id}
  //   ticket_close_reason_{id}
  //   ticket_reopen_{id}
  const customId = interaction.customId;
  const reasonCloseMatch = customId.match(/^ticket_close_reason_(\d+)$/);
  const claimMatch = customId.match(/^ticket_claim_(\d+)$/);
  const closeMatch = customId.match(/^ticket_close_(\d+)$/);
  const reopenMatch = customId.match(/^ticket_reopen_(\d+)$/);

  const ticketId = reasonCloseMatch
    ? Number(reasonCloseMatch[1])
    : claimMatch
    ? Number(claimMatch[1])
    : closeMatch
    ? Number(closeMatch[1])
    : reopenMatch
    ? Number(reopenMatch[1])
    : NaN;

  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ Ticket not found.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const staff = isStaff(member);

  if (claimMatch) {
    if (!staff) {
      await interaction.reply({ content: '🚫 Only staff can claim tickets.', ephemeral: true });
      return;
    }
    if (ticket.claimedById) {
      await interaction.reply({ content: `⚠️ Already claimed by <@${ticket.claimedById}>.`, ephemeral: true });
      return;
    }
    ticket.claimedById = interaction.user.id;
    ticket.claimedByTag = interaction.user.tag;
    saveState();

    await updateTicketMessage(interaction.channel as TextChannel, ticket);
    await interaction.reply({ content: `📋 <@${interaction.user.id}> has claimed this ticket.` });
    return;
  }

  if (reasonCloseMatch) {
    if (!staff) {
      await interaction.reply({ content: '🚫 Only staff can close with a reason.', ephemeral: true });
      return;
    }
    await showCloseReasonModal(interaction, ticket);
    return;
  }

  if (closeMatch) {
    if (!staff && interaction.user.id !== ticket.openerId) {
      await interaction.reply({ content: '🚫 Only staff or the opener can close this ticket.', ephemeral: true });
      return;
    }
    await closeTicket(interaction, ticket, null);
    return;
  }

  if (reopenMatch) {
    await reopenTicket(interaction, ticket);
    return;
  }
}

async function showCloseReasonModal(interaction: ButtonInteraction, ticket: TicketRecord) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_close_modal_${ticket.id}`)
    .setTitle(`Close Ticket #${ticket.id} with Reason`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('close_reason')
    .setLabel('Reason for closing')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Explain to the user why this ticket is being closed…')
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !interaction.channel) return;
  if (!interaction.customId.startsWith('ticket_close_modal_')) return;
  const ticketId = Number(interaction.customId.replace('ticket_close_modal_', ''));
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ Ticket not found.', ephemeral: true });
    return;
  }
  const reason = interaction.fields.getTextInputValue('close_reason').trim();
  await closeTicket(interaction, ticket, reason);
}

// ---------------------------------------------------------------------------
// Close ticket — generate transcript, post to log, DM opener, delete channel
// ---------------------------------------------------------------------------
async function closeTicket(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  ticket: TicketRecord,
  reason: string | null,
) {
  if (!interaction.guild || !interaction.channel) return;
  const channel = interaction.channel as TextChannel;
  const now = Date.now();

  await interaction.deferReply();

  // Build transcript
  const transcript = await buildTranscript(channel, ticket, interaction.user, reason);
  const attachment = new AttachmentBuilder(Buffer.from(transcript.content, 'utf-8'), {
    name: `transcript-${ticket.id}.txt`,
  });

  ticket.closedAt = now;
  ticket.closerId = interaction.user.id;
  ticket.closerTag = interaction.user.tag;
  ticket.closeReason = reason;
  ticket.status = 'closed';
  ticket.reopenWindowUntil = now + 60_000; // 60-second reopen window
  saveState();

  // Re-enable the reopen button on the original ticket message
  await updateTicketMessage(channel, ticket);

  // Countdown
  await interaction.editReply({ content: '🔒 Generating transcript and notifying opener…' });
  await sleep(800);

  // DM the opener
  const opener = await client.users.fetch(ticket.openerId).catch(() => null);
  const dmEmbed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} closed`)
    .setDescription(`Your ticket in **${interaction.guild.name}** has been closed.`)
    .setColor(ticket.categoryId ? categoryById(ticket.categoryId)?.color || 0x4b4b4b : 0x4b4b4b)
    .addFields(
      { name: 'Category', value: categoryById(ticket.categoryId)?.label || ticket.categoryLabel, inline: true },
      { name: 'Closed by', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
      { name: 'Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: 'Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: 'Reason', value: reason as string, inline: false }] : []),
    );
  await safeDm(opener, dmEmbed, [attachment]);

  // Post to log channel
  const logEmbed = brandEmbed()
    .setTitle(`🔒 Ticket #${ticket.id} closed`)
    .setColor(0x2b2b2b)
    .addFields(
      { name: 'Opener', value: `<@${ticket.openerId}> (\`${ticket.openerTag}\`)`, inline: true },
      { name: 'Closed by', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
      { name: 'Claimed by', value: ticket.claimedByTag ? `<@${ticket.claimedById}> (\`${ticket.claimedByTag}\`)` : '— unclaimed —', inline: true },
      { name: 'Category', value: categoryById(ticket.categoryId)?.label || ticket.categoryLabel, inline: true },
      { name: 'Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: 'Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: 'Reason', value: reason as string, inline: false }] : []),
    );
  await sendToLogChannel(interaction.guild, { embeds: [logEmbed], files: [attachment] });

  // Countdown message + delete
  await channel.send('⚠️ This channel will be deleted in **5 seconds**…');
  await sleep(1000);
  await channel.send('4…');
  await sleep(1000);
  await channel.send('3…');
  await sleep(1000);
  await channel.send('2…');
  await sleep(1000);
  await channel.send('1…');
  await sleep(1000);

  // Keep the channel ID null after deletion so reopen won't find it
  try {
    await channel.delete(`Ticket #${ticket.id} closed by ${interaction.user.tag}`);
  } catch (err) {
    console.warn('[ticket-bot] channel delete failed:', err);
  }
  ticket.channelId = null;
  // After deletion, reopen window is moot — clear it
  ticket.reopenWindowUntil = null;
  saveState();
}

async function reopenTicket(interaction: ButtonInteraction, ticket: TicketRecord) {
  if (!interaction.guild || !interaction.channel) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can reopen tickets.', ephemeral: true });
    return;
  }
  if (!ticket.reopenWindowUntil || Date.now() > ticket.reopenWindowUntil) {
    await interaction.reply({ content: '⚠️ This ticket can no longer be reopened (the 60-second reopen window has elapsed).', ephemeral: true });
    return;
  }
  ticket.status = 'reopened';
  ticket.closedAt = null;
  ticket.closerId = null;
  ticket.closerTag = null;
  ticket.closeReason = null;
  ticket.reopenWindowUntil = null;
  saveState();

  await updateTicketMessage(interaction.channel as TextChannel, ticket);
  await interaction.reply({ content: `↩️ Ticket reopened by <@${interaction.user.id}>.` });
}

async function updateTicketMessage(channel: TextChannel, ticket: TicketRecord) {
  try {
    // Find the bot's own message containing the ticket embed (the first one
    // posted when the ticket was opened).
    const messages = await channel.messages.fetch({ limit: 50 });
    const ticketMsg = messages.find(
      (m) => m.author.id === client.user?.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫 Ticket'),
    );
    if (!ticketMsg) return;

    const cat = categoryById(ticket.categoryId);
    const embed = EmbedBuilder.from(ticketMsg.embeds[0]);
    const statusField = ticket.claimedById
      ? `✅ **Claimed** by <@${ticket.claimedById}> (\`${ticket.claimedByTag}\`)`
      : '🟢 **Unclaimed** — waiting for a staff member to claim.';
    embed.spliceFields(0, embed.data.fields?.length || 0, { name: 'Status', value: statusField, inline: false });

    if (ticket.status === 'closed') {
      embed.addFields({
        name: 'Closed',
        value: `🔒 Closed by <@${ticket.closerId}> at <t:${Math.floor((ticket.closedAt || Date.now()) / 1000)}:F>`,
        inline: false,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_claim_${ticket.id}`)
        .setLabel(ticket.claimedById ? `Claimed by ${ticket.claimedByTag?.split('#')[0] || 'staff'}` : 'Claim')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!!ticket.claimedById || ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_close_${ticket.id}`)
        .setLabel('Close')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_close_reason_${ticket.id}`)
        .setLabel('Close with Reason')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_reopen_${ticket.id}`)
        .setLabel('Reopen')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Success)
        .setDisabled(ticket.status !== 'closed'),
    );

    await ticketMsg.edit({ embeds: [embed], components: [row] });
  } catch (err) {
    console.warn('[ticket-bot] failed to update ticket message:', err);
  }
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------
async function buildTranscript(
  channel: TextChannel,
  ticket: TicketRecord,
  closer: User,
  reason: string | null,
): Promise<{ content: string }> {
  const cat = categoryById(ticket.categoryId);
  const lines: string[] = [];
  lines.push('========================================');
  lines.push(`${BRAND_TICKET} — Transcript`);
  lines.push(`Ticket: #${ticket.id} | Category: ${cat?.label || ticket.categoryLabel}`);
  lines.push(`Opened by: ${ticket.openerTag} | Closed by: ${closer.tag}`);
  if (ticket.claimedByTag) lines.push(`Claimed by: ${ticket.claimedByTag}`);
  if (reason) lines.push(`Close reason: ${reason}`);
  lines.push(`Opened: ${new Date(ticket.openedAt).toISOString()}`);
  lines.push(`Closed:  ${new Date().toISOString()}`);
  lines.push(`Duration: ${formatDuration(Date.now() - ticket.openedAt)}`);
  lines.push('========================================');
  lines.push('');

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    // oldest first
    const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const m of ordered) {
      if (m.author.bot && m.author.id === client.user?.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫 Ticket')) {
        continue; // skip the ticket-opening embed itself
      }
      const time = new Date(m.createdTimestamp).toISOString().slice(11, 19); // HH:MM:SS
      const author = m.author.bot ? `${m.author.tag} [BOT]` : m.author.tag;
      let body = m.content || '';
      if (m.attachments.size > 0) {
        const urls = [...m.attachments.values()].map((a) => a.url).join(' ');
        body = body ? `${body}\n  [attachments: ${urls}]` : `[attachments: ${urls}]`;
      }
      if (m.embeds.length > 0) {
        body = body ? `${body}\n  [embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || '(no title)'}]` : `[embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || '(no title)'}]`;
      }
      lines.push(`[${time}] ${author}: ${body}`);
    }
  } catch (err) {
    lines.push('⚠️ Could not fetch message history for transcript.');
    console.warn('[ticket-bot] transcript fetch failed:', err);
  }
  lines.push('');
  lines.push('========================================');
  lines.push('End of transcript');
  lines.push('========================================');
  return { content: lines.join('\n') };
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// /ticket-stats slash command
// ---------------------------------------------------------------------------
async function handleStatsCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Staff only.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  const total = state.tickets.length;
  const open = state.tickets.filter((t) => t.status !== 'closed').length;
  const closed = state.tickets.filter((t) => t.status === 'closed').length;
  const reopened = state.tickets.filter((t) => t.status === 'reopened').length;

  // Average close time (only closed tickets with closedAt set)
  const closedWithTime = state.tickets.filter((t) => t.status === 'closed' && t.closedAt);
  const avgMs = closedWithTime.length
    ? closedWithTime.reduce((acc, t) => acc + ((t.closedAt as number) - t.openedAt), 0) / closedWithTime.length
    : 0;

  // Per-category counts
  const perCat = categories.map((c) => {
    const all = state.tickets.filter((t) => t.categoryId === c.id);
    return {
      label: `${c.emoji} ${c.label}`,
      total: all.length,
      open: all.filter((t) => t.status !== 'closed').length,
      closed: all.filter((t) => t.status === 'closed').length,
    };
  });

  const embed = brandEmbed()
    .setTitle('📊 Ticket Statistics')
    .setColor(0x4b4b4b)
    .addFields(
      { name: 'Total tickets', value: String(total), inline: true },
      { name: 'Currently open', value: String(open), inline: true },
      { name: 'Closed', value: String(closed), inline: true },
      { name: 'Reopened (active)', value: String(reopened), inline: true },
      { name: 'Avg. close time', value: avgMs ? formatDuration(avgMs) : '—', inline: true },
      { name: 'Next ticket #', value: String(state.count + 1), inline: true },
    );

  perCat.forEach((c) => {
    embed.addFields({
      name: c.label,
      value: `Total: ${c.total} • Open: ${c.open} • Closed: ${c.closed}`,
      inline: false,
    });
  });

  await interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Panel creation (POST /setup-panel)
// ---------------------------------------------------------------------------
async function setupPanel(opts: {
  title?: string;
  description?: string;
  categories?: Array<Partial<Category> & { id: string }>;
}): Promise<{ ok: boolean; messageId?: string; channelId?: string; error?: string }> {
  return setupPanelWithIds(PANEL_CHANNEL_ID, opts);
}

// Variant that takes an explicit panel channel ID — used by /setup-guild when
// the channel was just created and PANEL_CHANNEL_ID env var isn't set yet.
async function setupPanelWithIds(
  panelChannelId: string,
  opts: {
    title?: string;
    description?: string;
    categories?: Array<Partial<Category> & { id: string }>;
  },
): Promise<{ ok: boolean; messageId?: string; channelId?: string; error?: string }> {
  if (DEMO_MODE) {
    return { ok: false, error: 'Bot is in demo mode (no DISCORD_BOT_TOKEN).' };
  }
  if (!guild) return { ok: false, error: 'Guild not resolved.' };
  if (!panelChannelId) return { ok: false, error: 'No panel channel ID provided (set TICKET_PANEL_CHANNEL_ID or call /setup-guild first).' };

  // Optionally replace categories
  if (Array.isArray(opts.categories) && opts.categories.length > 0) {
    categories = opts.categories.map((c) => {
      const base = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
      return {
        id: c.id,
        emoji: c.emoji || base?.emoji || '🎫',
        label: c.label || base?.label || c.id,
        description: c.description || base?.description || '',
        color: typeof c.color === 'number' ? c.color : base?.color || 0x4b4b4b,
        staffRoleId: c.staffRoleId,
      };
    });
  }

  const title = opts.title || `${BRAND_TICKET} — Support Desk`;
  const description =
    opts.description ||
    `Select a category below to open a private support ticket with the ${BRAND} staff team. Our team will respond as soon as possible.`;

  const embed = brandEmbed()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x2b2b2b)
    .addFields(
      { name: '🎫 Categories', value: categories.map((c) => `${c.emoji} **${c.label}** — ${c.description}`).join('\n'), inline: false },
      { name: '📋 Rules', value: '• One ticket per issue.\n• Do not ping staff unnecessarily.\n• Abuse may result in a ban from opening future tickets.', inline: false },
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('icbs_ticket_panel')
    .setPlaceholder('Select a ticket category…')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      categories.map(
        (c) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.label)
            .setDescription(c.description.slice(0, 100))
            .setValue(c.id)
            .setEmoji(c.emoji),
      ),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  try {
    const channel = await guild.channels.fetch(panelChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return { ok: false, error: 'Panel channel not found or not a text channel.' };
    }
    const msg = await (channel as TextChannel).send({ embeds: [embed], components: [row] });
    state.panelMessageId = msg.id;
    state.panelChannelId = msg.channelId;
    saveState();
    return { ok: true, messageId: msg.id, channelId: msg.channelId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Auto-setup — creates the Discord-side resources (category, channels, roles)
// if they don't exist yet, OR reuses existing ones matched by name. Returns
// the IDs so the caller can paste them into Render's env vars.
//
// This is invoked by POST /setup-guild. It lets you deploy the bot with ONLY
// DISCORD_BOT_TOKEN + DISCORD_GUILD_ID + ICBS_WEBHOOK_SECRET configured, then
// call /setup-guild once to create everything else.
// ---------------------------------------------------------------------------
interface SetupGuildResult {
  ok: boolean;
  created?: string[];
  reused?: string[];
  ids?: {
    TICKET_CATEGORY_ID: string;
    TICKET_PANEL_CHANNEL_ID: string;
    TICKET_LOG_CHANNEL_ID: string;
    TICKET_ADMIN_ROLE_ID: string;
    TICKET_STAFF_ROLE_IDS: string;
  };
  error?: string;
}

async function setupGuild(opts: {
  categoryName?: string;
  panelChannelName?: string;
  logsChannelName?: string;
  adminRoleName?: string;
  staffRoleName?: string;
  postPanel?: boolean;
}): Promise<SetupGuildResult> {
  if (DEMO_MODE) {
    return { ok: false, error: 'Bot is in demo mode (no DISCORD_BOT_TOKEN).' };
  }
  if (!guild) return { ok: false, error: 'Guild not resolved — set DISCORD_GUILD_ID.' };

  const categoryName = opts.categoryName || '🎫 Tickets';
  const panelName = opts.panelChannelName || 'ticket-panel';
  const logsName = opts.logsChannelName || 'ticket-logs';
  const adminName = opts.adminRoleName || 'ICBS Ticket Bot';
  const staffName = opts.staffRoleName || 'Support Staff';

  const created: string[] = [];
  const reused: string[] = [];

  try {
    // Fetch everything
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

    // 1. Category
    let ticketCategory = existingCategories.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
    );
    if (ticketCategory) {
      reused.push(`category "${ticketCategory.name}" (${ticketCategory.id})`);
    } else {
      ticketCategory = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        reason: 'Ticket bot auto-setup — ticket channel category',
      });
      created.push(`category "${ticketCategory.name}" (${ticketCategory.id})`);
    }

    // 2. Panel channel
    let panelChannel = existingTextChannels.find(
      (c) => c.name.toLowerCase() === panelName.toLowerCase(),
    );
    if (panelChannel) {
      reused.push(`channel #${panelChannel.name} (${panelChannel.id})`);
    } else {
      panelChannel = await guild.channels.create({
        name: panelName,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        topic: `${BRAND_TICKET} — Support Desk. Select a category to open a ticket.`,
        reason: 'Ticket bot auto-setup — panel channel',
      });
      created.push(`channel #${panelChannel.name} (${panelChannel.id})`);
    }

    // 3. Logs channel
    let logsChannel = existingTextChannels.find(
      (c) => c.name.toLowerCase() === logsName.toLowerCase(),
    );
    if (logsChannel) {
      reused.push(`channel #${logsChannel.name} (${logsChannel.id})`);
    } else {
      logsChannel = await guild.channels.create({
        name: logsName,
        type: ChannelType.GuildText,
        parent: ticketCategory.id,
        topic: `${BRAND_TICKET} — ticket open/close logs and transcripts.`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
        reason: 'Ticket bot auto-setup — logs channel',
      });
      created.push(`channel #${logsChannel.name} (${logsChannel.id})`);
    }

    // 4. Admin role
    let adminRole = existingRoles.find(
      (r) => r.name.toLowerCase() === adminName.toLowerCase(),
    );
    if (adminRole) {
      reused.push(`role @${adminRole.name} (${adminRole.id})`);
    } else {
      adminRole = await guild.roles.create({
        name: adminName,
        permissions: PermissionFlagsBits.Administrator,
        color: 0x2b2b2b,
        reason: 'Ticket bot auto-setup — admin role',
      });
      created.push(`role @${adminRole.name} (${adminRole.id})`);
    }

    // 5. Staff role
    let staffRole = existingRoles.find(
      (r) => r.name.toLowerCase() === staffName.toLowerCase(),
    );
    if (staffRole) {
      reused.push(`role @${staffRole.name} (${staffRole.id})`);
    } else {
      staffRole = await guild.roles.create({
        name: staffName,
        color: 0x2ecc71,
        reason: 'Ticket bot auto-setup — staff role',
      });
      created.push(`role @${staffRole.name} (${staffRole.id})`);
    }

    return {
      ok: true,
      created,
      reused,
      ids: {
        TICKET_CATEGORY_ID: ticketCategory.id,
        TICKET_PANEL_CHANNEL_ID: panelChannel.id,
        TICKET_LOG_CHANNEL_ID: logsChannel.id,
        TICKET_ADMIN_ROLE_ID: adminRole.id,
        TICKET_STAFF_ROLE_IDS: staffRole.id,
      },
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://localhost:${HTTP_PORT}`);
  const pathname = url.pathname;

  // CORS headers (for the Next.js dashboard calling from a different origin in split-deploy)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-icbs-secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- GET /  (root — Render's default health check pings this) ---
  // Returns a tiny 200 OK so Render marks the service as "live" without
  // needing to configure a custom Health Check Path. Use /health for the
  // full status payload.
  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'icbs-ticket-bot',
        mode: DEMO_MODE ? 'demo' : 'live',
        ready,
        uptime: process.uptime(),
      }),
    );
    return;
  }

  // --- GET /ping  (alias — lightweight, no auth) ---
  if (req.method === 'GET' && pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'icbs-ticket-bot',
        mode: DEMO_MODE ? 'demo' : 'live',
        ready,
      }),
    );
    return;
  }

  // --- GET /health ---
  if (req.method === 'GET' && pathname === '/health') {
    const payload = {
      ok: true,
      service: 'icbs-ticket-bot',
      mode: DEMO_MODE ? 'demo' : 'live',
      ready,
      uptime: process.uptime(),
      bot: client.user ? { tag: client.user.tag, id: client.user.id } : null,
      guild: guild ? { id: guild.id, name: guild.name } : null,
      configured: {
        discordToken: !!TOKEN,
        guildId: !!GUILD_ID,
        panelChannel: !!PANEL_CHANNEL_ID,
        logChannel: !!LOG_CHANNEL_ID,
        ticketCategory: !!TICKET_CATEGORY_ID,
        adminRole: !!ADMIN_ROLE_ID,
        staffRoles: STAFF_ROLE_IDS.length,
        webhookSecret: !!WEBHOOK_SECRET,
      },
      stats: {
        totalTickets: state.tickets.length,
        openTickets: state.tickets.filter((t) => t.status !== 'closed').length,
        closedTickets: state.tickets.filter((t) => t.status === 'closed').length,
        nextTicketId: state.count + 1,
        categories: categories.length,
      },
      panel: state.panelMessageId
        ? { messageId: state.panelMessageId, channelId: state.panelChannelId }
        : null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  // --- POST /setup-panel ---
  if (req.method === 'POST' && pathname === '/setup-panel') {
    // Auth
    const secret = req.headers['x-icbs-secret'];
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: invalid or missing x-icbs-secret.' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed: any = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body.' }));
      return;
    }

    const result = await setupPanel({
      title: parsed.title,
      description: parsed.description,
      categories: parsed.categories,
    });
    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  // --- POST /setup-guild ---
  // Auto-creates the Discord-side resources (category, channels, roles) and
  // returns their IDs. Lets you deploy the bot with only DISCORD_BOT_TOKEN +
  // DISCORD_GUILD_ID + ICBS_WEBHOOK_SECRET configured, then call this once to
  // create everything else. Paste the returned IDs into Render's env vars.
  //
  // Body (all optional — defaults are used if omitted):
  //   { categoryName?, panelChannelName?, logsChannelName?,
  //     adminRoleName?, staffRoleName?, postPanel?: true }
  if (req.method === 'POST' && pathname === '/setup-guild') {
    const secret = req.headers['x-icbs-secret'];
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: invalid or missing x-icbs-secret.' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed: any = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body.' }));
      return;
    }

    const result = await setupGuild({
      categoryName: parsed.categoryName,
      panelChannelName: parsed.panelChannelName,
      logsChannelName: parsed.logsChannelName,
      adminRoleName: parsed.adminRoleName,
      staffRoleName: parsed.staffRoleName,
    });

    // If setup succeeded and the caller asked to auto-post the panel, do that too.
    if (result.ok && result.ids && parsed.postPanel) {
      // Temporarily use the discovered IDs for panel posting
      const panelResult = await setupPanelWithIds(result.ids.TICKET_PANEL_CHANNEL_ID, {
        title: parsed.title,
        description: parsed.description,
        categories: parsed.categories,
      });
      (result as any).panel = panelResult;
    }

    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  // --- 404 ---
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: `Not found: ${req.method} ${pathname}` }));
});

// Bind to 0.0.0.0 so the service is reachable from outside the container
// (Render requires this — listening on localhost only won't pass health checks).
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[ticket-bot] 🌐 HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[ticket-bot]    GET  /             (root health check — Render default)`);
  console.log(`[ticket-bot]    GET  /ping         (lightweight, no auth)`);
  console.log(`[ticket-bot]    GET  /health       (full status payload)`);
  console.log(`[ticket-bot]    POST /setup-guild  (auth: x-icbs-secret — auto-create channels + roles)`);
  console.log(`[ticket-bot]    POST /setup-panel  (auth: x-icbs-secret — post the ticket panel)`);
});

// ---------------------------------------------------------------------------
// Login or demo mode
// ---------------------------------------------------------------------------
if (DEMO_MODE) {
  console.warn('');
  console.warn('============================================================');
  console.warn(` ${BRAND_TICKET} — DEMO MODE`);
  console.warn(' No DISCORD_BOT_TOKEN set. The Discord client will NOT connect.');
  console.warn(' The HTTP server still runs so the dashboard can show status.');
  console.warn(' Set DISCORD_BOT_TOKEN (and other env vars) to enable live mode.');
  console.warn('============================================================');
  console.warn('');
} else {
  client.login(TOKEN).catch((err) => {
    console.error('[ticket-bot] Discord login failed:', err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(sig: string) {
  console.log(`[ticket-bot] received ${sig}, shutting down…`);
  saveState();
  try {
    server.close();
  } catch {
    /* noop */
  }
  if (!DEMO_MODE) {
    client.destroy().catch(() => {});
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Periodic cleanup of expired reopen windows (best-effort)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const t of state.tickets) {
    if (t.reopenWindowUntil && t.reopenWindowUntil < now) {
      t.reopenWindowUntil = null;
      changed = true;
    }
  }
  if (changed) saveState();
}, 60_000).unref();
