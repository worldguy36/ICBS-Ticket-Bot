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
// Public URL of the bot service (set on Render). Used to serve the local
// brand-icon.webp file as the embed thumbnail/author icon.
const PUBLIC_URL = (process.env.ICBS_PUBLIC_URL || '').replace(/\/+$/, '');

// Brand icon — priority:
//   1. ICBS_BRAND_ICON_URL env var (if set explicitly)
//   2. {ICBS_PUBLIC_URL}/brand-icon.webp (served by this bot's HTTP server)
//   3. Discord default avatar fallback
const BRAND_ICON =
  process.env.ICBS_BRAND_ICON_URL ||
  (PUBLIC_URL ? `${PUBLIC_URL}/brand-icon.webp` : '') ||
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
// Initial staff role IDs from env. This is mutable at runtime via /ticket-staff
// command — changes persist to tickets.json and override the env var.
const INITIAL_STAFF_ROLE_IDS = (process.env.TICKET_STAFF_ROLE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Mutable — updated by /ticket-staff add/remove. Loaded from state file on
// startup, falling back to the env var on first boot.
let staffRoleIds: string[] = [...INITIAL_STAFF_ROLE_IDS];
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
  return cat.staffRoleId || categoryRoles[cat.id] || staffRoleIds[0];
}

// ---------------------------------------------------------------------------
// Per-category modal field configuration
// ---------------------------------------------------------------------------
// When a user picks a category from the panel, the bot shows a Discord MODAL
// with the fields defined here. Each category has its own set of fields
// relevant to that ticket type. Discord allows max 5 fields per modal.
interface ModalField {
  customId: string;       // unique within the modal
  label: string;          // shown above the input (max 45 chars)
  style: TextInputStyle; // Short (1-line) or Paragraph (multi-line)
  required: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}

const CATEGORY_MODAL_FIELDS: Record<string, ModalField[]> = {
  general: [
    {
      customId: 'subject',
      label: 'What do you need help with?',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'Brief subject line, e.g. "Can\'t verify my account"',
      maxLength: 100,
    },
    {
      customId: 'description',
      label: 'Describe your issue in detail',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: 'Include any error messages, what you were doing when it happened, and what you\'ve already tried.',
      maxLength: 1500,
    },
  ],
  bug: [
    {
      customId: 'bug_title',
      label: 'Bug title',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'Short summary of the bug, e.g. "Bot crashes on /ticket-stats"',
      maxLength: 100,
    },
    {
      customId: 'steps',
      label: 'Steps to reproduce',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: '1. ...\n2. ...\n3. ...\nWhat steps cause the bug to happen?',
      maxLength: 1000,
    },
    {
      customId: 'expected',
      label: 'What did you expect to happen?',
      style: TextInputStyle.Short,
      required: false,
      placeholder: 'What SHOULD have happened?',
      maxLength: 200,
    },
    {
      customId: 'actual',
      label: 'What actually happened?',
      style: TextInputStyle.Short,
      required: false,
      placeholder: 'What did happen instead?',
      maxLength: 200,
    },
  ],
  billing: [
    {
      customId: 'transaction_id',
      label: 'Transaction / Order ID',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'From your Discord billing or payment receipt',
      maxLength: 100,
    },
    {
      customId: 'issue',
      label: 'Describe the billing issue',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: 'What\'s wrong with the charge / subscription / Nitro / boost?',
      maxLength: 1000,
    },
    {
      customId: 'email',
      label: 'Account email (optional)',
      style: TextInputStyle.Short,
      required: false,
      placeholder: 'The email on your Discord account',
      maxLength: 200,
    },
  ],
  partnership: [
    {
      customId: 'server_name',
      label: 'Your server / community name',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'e.g. "Gaming Hub"',
      maxLength: 100,
    },
    {
      customId: 'member_count',
      label: 'Approximate member count',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'e.g. "1500"',
      maxLength: 20,
    },
    {
      customId: 'invite_link',
      label: 'Server invite link',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'discord.gg/xxxx or full URL',
      maxLength: 200,
    },
    {
      customId: 'why_partner',
      label: 'Why do you want to partner with us?',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: 'Tell us about your community and what you bring to a partnership.',
      maxLength: 1000,
    },
  ],
  appeal: [
    {
      customId: 'username',
      label: 'Your Discord username',
      style: TextInputStyle.Short,
      required: true,
      placeholder: 'e.g. worldguy36',
      maxLength: 100,
    },
    {
      customId: 'ban_reason',
      label: 'Why were you banned? (your best guess)',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: 'If you don\'t know, write "Not sure".',
      maxLength: 500,
    },
    {
      customId: 'appeal_text',
      label: 'Why should we unban you?',
      style: TextInputStyle.Paragraph,
      required: true,
      placeholder: 'Make your case. Apologise if appropriate. Explain what\'s changed.',
      maxLength: 1500,
    },
  ],
};

function modalFieldsForCategory(catId: string): ModalField[] {
  return CATEGORY_MODAL_FIELDS[catId] || CATEGORY_MODAL_FIELDS.general;
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
  firstResponseAt: number | null; // when staff first replied (null = no response yet)
  firstResponderId: string | null;
  firstResponderTag: string | null;
  lastActivityAt: number; // last message in the ticket channel (epoch ms)
  inactivityWarnedAt: number | null; // when the bot warned about inactivity (null = not warned)
}

interface PersistedState {
  count: number;
  tickets: TicketRecord[];
  panelMessageId: string | null;
  panelChannelId: string | null;
  staffRoleIds?: string[]; // optional — falls back to env var if absent
  blacklistedUserIds?: string[]; // users blocked from opening tickets
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
        staffRoleIds: Array.isArray(parsed.staffRoleIds) ? parsed.staffRoleIds : undefined,
        blacklistedUserIds: Array.isArray(parsed.blacklistedUserIds) ? parsed.blacklistedUserIds : [],
      };
    }
  } catch (err) {
    console.warn('[ticket-bot] failed to load tickets.json, starting fresh:', err);
  }
  return { count: 0, tickets: [], panelMessageId: null, panelChannelId: null, blacklistedUserIds: [] };
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[ticket-bot] failed to save tickets.json:', err);
  }
}

const state: PersistedState = loadState();

// If the state file has a saved staffRoleIds list, use it (overrides env var).
// Otherwise fall back to the env var value (INITIAL_STAFF_ROLE_IDS).
if (Array.isArray(state.staffRoleIds) && state.staffRoleIds.length >= 0) {
  staffRoleIds = state.staffRoleIds;
  console.log(`[ticket-bot] 📋 Loaded ${staffRoleIds.length} staff role(s) from tickets.json (overrides env var).`);
} else {
  console.log(`[ticket-bot] 📋 Using ${staffRoleIds.length} staff role(s) from TICKET_STAFF_ROLE_IDS env var.`);
}

// In-memory cooldowns (not persisted — that's fine, they reset on restart)
const openCooldowns = new Map<string, number>(); // userId -> epoch ms of last open

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isStaff(member: { roles: { cache: { has: (id: string) => boolean } } } | null | undefined): boolean {
  if (!member) return false;
  if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
  return staffRoleIds.some((r) => member.roles.cache.has(r));
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
    ['TICKET_PANEL_CHANNEL_ID', !!PANEL_CHANNEL_ID, 'Channel where the ticket panel is posted'],
    ['TICKET_LOG_CHANNEL_ID', !!LOG_CHANNEL_ID, 'Channel for ticket open/close logs + transcripts'],
    ['TICKET_CATEGORY_ID', !!TICKET_CATEGORY_ID, 'Discord category ticket channels are created under'],
    ['TICKET_ADMIN_ROLE_ID', !!ADMIN_ROLE_ID, 'Role with full access to ALL tickets'],
    ['TICKET_STAFF_ROLE_IDS', staffRoleIds.length > 0, `Comma-separated staff role IDs (${staffRoleIds.length} loaded — use /ticket-staff to manage)`],
    ['ICBS_WEBHOOK_SECRET', !!WEBHOOK_SECRET, 'Secret for /setup-panel auth (REQUIRED)'],
  ];
  for (const [key, ok, hint] of configChecks) {
    console.log(`  ${ok ? '✅' : '⚠️ '} ${key.padEnd(28)} ${ok ? 'set' : 'NOT SET'}  — ${hint}`);
  }
  console.log('─'.repeat(60));
  if (!PANEL_CHANNEL_ID || !LOG_CHANNEL_ID || !TICKET_CATEGORY_ID || !ADMIN_ROLE_ID || !staffRoleIds.length) {
    console.log('💡 Configure the missing IDs in your Render web service → Environment tab.');
    console.log('   To find a Discord ID: enable Developer Mode (Discord settings → Advanced),');
    console.log('   then right-click the channel/category/role → Copy ID.');
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
  const now = Date.now();
  t.messageCount += 1;
  t.lastActivityAt = now;

  // Track first staff response (opener doesn't count)
  if (t.firstResponseAt === null && msg.author.id !== t.openerId) {
    // Check if the author is staff (best-effort — fetch member)
    try {
      const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
      if (member && isStaff(member)) {
        t.firstResponseAt = now;
        t.firstResponderId = msg.author.id;
        t.firstResponderTag = msg.author.tag;
        saveState();
        console.log(`[ticket-bot] 📝 Ticket #${t.id}: first response by ${msg.author.tag} after ${formatDuration(now - t.openedAt)}`);
      }
    } catch {
      // ignore — don't let member fetch failures break message tracking
    }
  }
});

// When a ticket channel is deleted (manually by staff OR by the bot itself),
// mark the ticket as closed so it doesn't show up as "open" forever.
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  const t = ticketByChannel(channel.id);
  if (!t) return;
  // Only act if the ticket is still marked open (the bot's own close flow
  // already handles state — this catches manual staff deletions).
  if (t.status === 'closed') return;
  console.log(`[ticket-bot] 🗑️ Ticket channel #${channel.name} was deleted externally — marking ticket #${t.id} as closed.`);
  t.status = 'closed';
  t.closedAt = Date.now();
  t.closerId = null;
  t.closerTag = 'channel deleted (external)';
  t.closeReason = 'Channel deleted manually (no transcript generated).';
  t.channelId = null;
  t.reopenWindowUntil = null;
  saveState();

  // Log it
  const logEmbed = brandEmbed()
    .setTitle(`🗑️ Ticket #${t.id} Channel Deleted`)
    .setColor(0x2b2b2b)
    .setThumbnail(BRAND_ICON)
    .setDescription(`The channel for ticket #${t.id} was deleted (manually or externally). The ticket has been auto-marked as closed. No transcript was generated.`)
    .addFields(
      { name: '👤 Opener', value: `<@${t.openerId}>\n\`${t.openerTag}\``, inline: true },
      { name: '📂 Category', value: t.categoryLabel, inline: true },
      { name: '⏰ Opened at', value: `<t:${Math.floor(t.openedAt / 1000)}:F>`, inline: true },
      { name: '📋 Claimed by', value: t.claimedByTag ? `\`${t.claimedByTag}\`` : '— *unclaimed* —', inline: true },
      { name: '💬 Messages', value: String(t.messageCount), inline: true },
    );
  await sendToLogChannel(channel.guild, { embeds: [logEmbed] });
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
    new SlashCommandBuilder()
      .setName('ticket-panel')
      .setDescription('Post the ticket panel in THIS channel (admin only).')
      .addStringOption((opt) =>
        opt.setName('title').setDescription('Custom title for the panel embed.').setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Custom description for the panel.').setRequired(false),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-close')
      .setDescription('Close a ticket by its ID (admin only). Works from any channel.')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('The ticket ID number (e.g. 5 for #5).').setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('reason').setDescription('Reason for closing (shown in logs + DM).').setRequired(false),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-add')
      .setDescription('Add a user to the current ticket channel (admin only).')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('The user to add to this ticket.').setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-help')
      .setDescription('Show all ticket bot commands (staff only).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-staff')
      .setDescription('Manage which roles count as ticket support staff (admin only).')
      .addStringOption((opt) =>
        opt
          .setName('action')
          .setDescription('add, remove, or list staff roles')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' },
          ),
      )
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('The role to add or remove (required for add/remove).').setRequired(false),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-rename')
      .setDescription('Rename the current ticket channel (staff only).')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('New channel name (no spaces, use dashes).').setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-info')
      .setDescription('Show details about a ticket by its ID (staff only).')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('The ticket ID number (e.g. 5 for #5).').setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-blacklist')
      .setDescription('Block a user from opening tickets (admin only).')
      .addStringOption((opt) =>
        opt
          .setName('action')
          .setDescription('add, remove, or list blacklisted users')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' },
          ),
      )
      .addUserOption((opt) =>
        opt.setName('user').setDescription('The user to block/unblock (required for add/remove).').setRequired(false),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
      switch (interaction.commandName) {
        case 'ticket-stats':
          await handleStatsCommand(interaction);
          return;
        case 'ticket-panel':
          await handlePanelCommand(interaction);
          return;
        case 'ticket-close':
          await handleCloseCommand(interaction);
          return;
        case 'ticket-add':
          await handleAddCommand(interaction);
          return;
        case 'ticket-help':
          await handleHelpCommand(interaction);
          return;
        case 'ticket-staff':
          await handleStaffCommand(interaction);
          return;
        case 'ticket-rename':
          await handleRenameCommand(interaction);
          return;
        case 'ticket-info':
          await handleInfoCommand(interaction);
          return;
        case 'ticket-blacklist':
          await handleBlacklistCommand(interaction);
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

  // Blacklist check (fail fast — before showing the modal)
  const blacklist = state.blacklistedUserIds || [];
  if (blacklist.includes(userId)) {
    await interaction.reply({
      content: '🚫 You are blocked from opening tickets. If you believe this is a mistake, please contact a staff member directly.',
      ephemeral: true,
    });
    return;
  }

  // Cooldown check (fail fast — before showing the modal)
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

  // Build + show the category-specific modal
  const fields = modalFieldsForCategory(catId);
  const modal = new ModalBuilder()
    .setCustomId(`ticket_open_modal_${catId}`)
    .setTitle(`${cat.emoji} ${cat.label}`);

  for (const f of fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.customId)
      .setLabel(f.label)
      .setStyle(f.style)
      .setRequired(f.required);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (f.minLength !== undefined) input.setMinLength(f.minLength);
    if (f.maxLength !== undefined) input.setMaxLength(f.maxLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  await interaction.showModal(modal);
}

// ---------------------------------------------------------------------------
// Modal submit — handles BOTH the ticket-open modal AND the close-reason modal
// ---------------------------------------------------------------------------
async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guild) return;

  // --- Close-reason modal (existing) ---
  if (interaction.customId.startsWith('ticket_close_modal_')) {
    if (!interaction.channel) return;
    const ticketId = Number(interaction.customId.replace('ticket_close_modal_', ''));
    const ticket = state.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      await interaction.reply({ content: '⚠️ Ticket not found.', ephemeral: true });
      return;
    }
    const reason = interaction.fields.getTextInputValue('close_reason').trim();
    await closeTicket(interaction, ticket, reason);
    return;
  }

  // --- Ticket-open modal (new) ---
  if (interaction.customId.startsWith('ticket_open_modal_')) {
    await createTicketFromModal(interaction);
    return;
  }
}

// ---------------------------------------------------------------------------
// Create a ticket from a submitted modal
// ---------------------------------------------------------------------------
async function createTicketFromModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild) return;
  const userId = interaction.user.id;
  const catId = interaction.customId.replace('ticket_open_modal_', '');
  const cat = categoryById(catId);
  if (!cat) {
    await interaction.reply({ content: '⚠️ Unknown ticket category.', ephemeral: true });
    return;
  }

  // Re-check cooldown (user might have opened another ticket while the modal was open)
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

  // Re-check open ticket limit
  const openCount = openTicketCountForUser(userId);
  if (openCount >= 3) {
    await interaction.reply({
      content: `🚫 You already have **${openCount}** open tickets. Please close one before opening another.`,
      ephemeral: true,
    });
    return;
  }

  // Extract the form answers
  const fields = modalFieldsForCategory(catId);
  const answers: { label: string; value: string }[] = [];
  for (const f of fields) {
    let val: string;
    try {
      val = interaction.fields.getTextInputValue(f.customId).trim();
    } catch {
      val = '';
    }
    if (val || f.required) {
      answers.push({ label: f.label, value: val || '_(not provided)_' });
    }
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
    firstResponseAt: null,
    firstResponderId: null,
    firstResponderTag: null,
    lastActivityAt: now,
    inactivityWarnedAt: null,
  };
  state.tickets.push(ticket);
  openCooldowns.set(userId, now);
  saveState();

  // Build the submission summary for the embed (Discord limits field values
  // to 1024 chars — truncate safely if the user wrote a lot).
  const MAX_FIELD = 1000; // leave headroom for the truncation notice
  let submissionSummary = answers
    .map((a) => `**${a.label}**\n${a.value}`)
    .join('\n\n');
  if (submissionSummary.length > MAX_FIELD) {
    submissionSummary = submissionSummary.slice(0, MAX_FIELD - 50) + '\n\n*(...truncated — see full message above)*';
  }

  // Build the opening embed + buttons (enhanced UI)
  const embed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} — ${cat.emoji} ${cat.label}`)
    .setDescription(
      [
        `👋 **Welcome to your support ticket, <@${userId}>!**`,
        '',
        `A member of the ${BRAND} staff team will be with you shortly. Your submission details are below — feel free to add more context, screenshots, or follow-up info.`,
        '',
        `┌──────────────────────────────────────┐`,
        `│  🎫 **Ticket ID:** #${ticket.id}`,
        `│  📂 **Category:** ${cat.emoji} ${cat.label}`,
        `│  👤 **Opened by:** <@${userId}>`,
        `│  ⏰ **Opened at:** <t:${Math.floor(now / 1000)}:F>`,
        `└──────────────────────────────────────┘`,
      ].join('\n'),
    )
    .setColor(cat.color)
    .setThumbnail(BRAND_ICON)
    .addFields(
      {
        name: '📋 Current Status',
        value: '🟢 **Unclaimed** — waiting for a staff member to claim this ticket.',
        inline: false,
      },
      {
        name: '📝 Your Submission',
        value: submissionSummary,
        inline: false,
      },
      {
        name: '⚠️ Ticket Rules',
        value: [
          '• Be respectful to staff and other members.',
          '• Don\'t ping staff — they are notified automatically.',
          '• Stay on topic — keep the discussion relevant.',
          '• One issue per ticket — open a new one for unrelated problems.',
        ].join('\n'),
        inline: false,
      },
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim_${ticket.id}`)
      .setLabel('Claim Ticket')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticket.id}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_close_reason_${ticket.id}`)
      .setLabel('Close + Reason')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket_reopen_${ticket.id}`)
      .setLabel('Reopen')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );

  const staffRole = categoryStaffRoleId(cat);
  const mentions = [staffRole ? `<@&${staffRole}>` : '', ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : ''].filter(Boolean).join(' ');
  await channel.send({ content: `👋 <@${userId}> ${mentions}`, embeds: [embed], components: [row] });

  // DM the opener — enhanced confirmation
  const dmEmbed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} Opened`)
    .setDescription(
      [
        `Your support ticket has been opened in **${interaction.guild.name}**.`,
        '',
        `📂 **Category:** ${cat.emoji} ${cat.label}`,
        `🔗 **Channel:** [Jump to ticket](${channel.url})`,
        `⏰ **Opened at:** <t:${Math.floor(now / 1000)}:F>`,
        '',
        'A staff member will respond shortly. You can continue the conversation in the ticket channel.',
      ].join('\n'),
    )
    .setColor(cat.color)
    .setThumbnail(BRAND_ICON);
  await safeDm(interaction.user, dmEmbed);

  // Log channel — enhanced open log
  const logEmbed = brandEmbed()
    .setTitle(`🟢 Ticket #${ticket.id} Opened`)
    .setColor(cat.color)
    .setThumbnail(BRAND_ICON)
    .setDescription(`A new ticket has been opened in the **${cat.label}** category.`)
    .addFields(
      { name: '👤 Opener', value: `<@${userId}>\n\`${openerTag}\``, inline: true },
      { name: '📂 Category', value: `${cat.emoji} ${cat.label}`, inline: true },
      { name: '⏰ Opened at', value: `<t:${Math.floor(now / 1000)}:F>\n(<t:${Math.floor(now / 1000)}:R>)`, inline: true },
      { name: '🎫 Ticket Channel', value: `**#${channel.name}**\n[🔗 Jump to ticket](${channel.url})`, inline: false },
    );
  await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });

  await interaction.editReply({ content: `✅ **Ticket opened:** ${channel}\n\n🎫 A private channel has been created for you. Check it out — our staff team has been notified.` });
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

// (handleModalSubmit is defined earlier — handles both ticket_open_modal_* and ticket_close_modal_*)

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

  // DM the opener — enhanced close notification
  const opener = await client.users.fetch(ticket.openerId).catch(() => null);
  const cat = categoryById(ticket.categoryId);
  const dmEmbed = brandEmbed()
    .setTitle(`🔒 Ticket #${ticket.id} Closed`)
    .setDescription(
      [
        `Your support ticket in **${interaction.guild.name}** has been closed.`,
        '',
        '📄 **A transcript of your ticket is attached to this message** — keep it for your records.',
        '',
        'If you need further help, feel free to open a new ticket from the support panel.',
      ].join('\n'),
    )
    .setColor(cat?.color || 0x4b4b4b)
    .setThumbnail(BRAND_ICON)
    .addFields(
      { name: '📂 Category', value: `${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`, inline: true },
      { name: '👤 Closed by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      { name: '⏱️ Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: '💬 Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: '📝 Close Reason', value: reason as string, inline: false }] : []),
    );
  await safeDm(opener, dmEmbed, [attachment]);

  // Post to log channel — enhanced close log
  const logEmbed = brandEmbed()
    .setTitle(`🔒 Ticket #${ticket.id} Closed`)
    .setColor(0x2b2b2b)
    .setThumbnail(BRAND_ICON)
    .setDescription(`A ticket has been closed. Transcript is attached.`)
    .addFields(
      { name: '👤 Opener', value: `<@${ticket.openerId}>\n\`${ticket.openerTag}\``, inline: true },
      { name: '🔨 Closed by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      { name: '📋 Claimed by', value: ticket.claimedByTag ? `<@${ticket.claimedById}>\n\`${ticket.claimedByTag}\`` : '— *unclaimed* —', inline: true },
      { name: '📂 Category', value: `${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`, inline: true },
      { name: '⏱️ Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: '💬 Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: '📝 Close Reason', value: reason as string, inline: false }] : []),
    );
  await sendToLogChannel(interaction.guild, { embeds: [logEmbed], files: [attachment] });

  // Countdown message + delete
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription('⚠️ **This channel will be deleted in 5 seconds…**')
        .setFooter({ text: 'Transcript has been saved and sent to the opener.' }),
    ],
  });
  await sleep(1000);
  await channel.send('⏳ **4…**');
  await sleep(1000);
  await channel.send('⏳ **3…**');
  await sleep(1000);
  await channel.send('⏳ **2…**');
  await sleep(1000);
  await channel.send('⏳ **1…**');
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

    // Determine status display
    let statusField: string;
    if (ticket.status === 'closed') {
      statusField = `🔴 **Closed** by <@${ticket.closerId}>\n\`${ticket.closerTag}\`\n⏰ Closed at <t:${Math.floor((ticket.closedAt || Date.now()) / 1000)}:F>`;
    } else if (ticket.claimedById) {
      statusField = `✅ **Claimed** by <@${ticket.claimedById}>\n\`${ticket.claimedByTag}\``;
    } else {
      statusField = '🟢 **Unclaimed** — waiting for a staff member to claim.';
    }

    // Replace the first field (status) and keep the rest
    embed.spliceFields(0, 1, { name: '📋 Current Status', value: statusField, inline: false });

    // Color shift based on status
    if (ticket.status === 'closed') {
      embed.setColor(0x2b2b2b);
    } else if (ticket.claimedById) {
      embed.setColor(0x2ecc71); // green when claimed
    } else {
      embed.setColor(cat?.color || 0x4b4b4b);
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_claim_${ticket.id}`)
        .setLabel(ticket.claimedById ? `✅ Claimed by ${ticket.claimedByTag?.split('#')[0] || 'staff'}` : 'Claim Ticket')
        .setEmoji('📋')
        .setStyle(ticket.claimedById ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(!!ticket.claimedById || ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_close_${ticket.id}`)
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_close_reason_${ticket.id}`)
        .setLabel('Close + Reason')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(ticket.status === 'closed'),
      new ButtonBuilder()
        .setCustomId(`ticket_reopen_${ticket.id}`)
        .setLabel('Reopen Ticket')
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
  lines.push('╔══════════════════════════════════════════════════════════════════════╗');
  lines.push('║                                                                      ║');
  lines.push(`║   ${BRAND_TICKET} — Transcript`);
  lines.push('║                                                                      ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push('┌──────────────────────────────────────────────────────────────────────┐');
  lines.push(`│  🎫 Ticket ID:    #${ticket.id}`);
  lines.push(`│  📂 Category:     ${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`);
  lines.push(`│  👤 Opened by:    ${ticket.openerTag}`);
  lines.push(`│  🔨 Closed by:    ${closer.tag}`);
  if (ticket.claimedByTag) lines.push(`│  📋 Claimed by:   ${ticket.claimedByTag}`);
  lines.push(`│  ⏰ Opened at:    ${new Date(ticket.openedAt).toISOString()}`);
  lines.push(`│  ⏰ Closed at:    ${new Date().toISOString()}`);
  lines.push(`│  ⏱️  Duration:     ${formatDuration(Date.now() - ticket.openedAt)}`);
  lines.push(`│  💬 Messages:     ${ticket.messageCount}`);
  if (reason) {
    lines.push('├──────────────────────────────────────────────────────────────────────┤');
    lines.push(`│  📝 Close Reason: ${reason}`);
  }
  lines.push('└──────────────────────────────────────────────────────────────────────┘');
  lines.push('');
  lines.push('═════════════════════════════════════════════════════════════════════════');
  lines.push('                          CONVERSATION TRANSCRIPT                       ');
  lines.push('═════════════════════════════════════════════════════════════════════════');
  lines.push('');

  try {
    // Fetch up to 500 messages (5 pages of 100) so longer tickets are fully captured.
    const allMessages: Message[] = [];
    let lastId: string | undefined;
    for (let page = 0; page < 5; page++) {
      const batch = await channel.messages.fetch({ limit: 100, before: lastId });
      if (batch.size === 0) break;
      allMessages.push(...batch.values());
      lastId = batch.last()?.id;
      if (batch.size < 100) break;
    }
    // oldest first
    const ordered = allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    lines.push(`(Showing ${ordered.length} messages)\n`);
    for (const m of ordered) {
      if (m.author.bot && m.author.id === client.user?.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫 Ticket')) {
        continue; // skip the ticket-opening embed itself
      }
      const time = new Date(m.createdTimestamp).toISOString().slice(11, 19); // HH:MM:SS
      const date = new Date(m.createdTimestamp).toISOString().slice(0, 10); // YYYY-MM-DD
      const author = m.author.bot ? `${m.author.tag} [BOT]` : m.author.tag;
      let body = m.content || '';
      if (m.attachments.size > 0) {
        const urls = [...m.attachments.values()].map((a) => a.url).join(' ');
        body = body ? `${body}\n  [attachments: ${urls}]` : `[attachments: ${urls}]`;
      }
      if (m.embeds.length > 0) {
        body = body ? `${body}\n  [embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || '(no title)'}]` : `[embed: ${m.embeds[0].title || m.embeds[0].description?.slice(0, 80) || '(no title)'}]`;
      }
      lines.push(`[${date} ${time}] ${author}: ${body}`);
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
// /ticket-panel slash command — post the panel in the CURRENT channel
// ---------------------------------------------------------------------------
async function handlePanelCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({ content: '⚠️ This command can only be used in a server text channel.', ephemeral: true });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const title = interaction.options.getString('title') || undefined;
  const description = interaction.options.getString('description') || undefined;

  const result = await setupPanel({
    title,
    description,
    targetChannelId: interaction.channelId,
  });

  if (result.ok) {
    await interaction.editReply({
      content: `✅ **Ticket panel posted in <#${result.channelId}>.**\n\nMessage ID: \`${result.messageId}\`\n\nUsers can now select a category to open a ticket.`,
    });
  } else {
    await interaction.editReply({ content: `❌ Failed to post panel: ${result.error}` });
  }
}

// ---------------------------------------------------------------------------
// /ticket-close slash command — close any ticket by ID
// ---------------------------------------------------------------------------
async function handleCloseCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  const ticketId = interaction.options.getInteger('id', true);
  const reason = interaction.options.getString('reason');
  const ticket = state.tickets.find((t) => t.id === ticketId);

  if (!ticket) {
    await interaction.reply({ content: `⚠️ Ticket #${ticketId} not found.`, ephemeral: true });
    return;
  }

  if (ticket.status === 'closed') {
    await interaction.reply({ content: `⚠️ Ticket #${ticketId} is already closed.`, ephemeral: true });
    return;
  }

  if (!ticket.channelId) {
    // Channel already deleted — just mark as closed
    ticket.status = 'closed';
    ticket.closedAt = Date.now();
    ticket.closerId = interaction.user.id;
    ticket.closerTag = interaction.user.tag;
    ticket.closeReason = reason;
    saveState();
    await interaction.reply({ content: `✅ Ticket #${ticketId} marked as closed (channel was already deleted).` });
    return;
  }

  await interaction.deferReply();

  // Fetch the channel + fake a ButtonInteraction-like object for closeTicket
  try {
    const channel = await interaction.guild.channels.fetch(ticket.channelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({ content: `⚠️ Ticket #${ticketId}'s channel is gone or not text.` });
      return;
    }
    await closeTicketFromCommand(interaction, ticket, channel as TextChannel, reason);
  } catch (err: any) {
    await interaction.editReply({ content: `❌ Failed to close ticket: ${err?.message || err}` });
  }
}

// Helper: closeTicket variant that works from a ChatInputCommandInteraction
// (closeTicket expects a ButtonInteraction/ModalSubmitInteraction with a channel)
async function closeTicketFromCommand(
  interaction: ChatInputCommandInteraction,
  ticket: TicketRecord,
  channel: TextChannel,
  reason: string | null,
) {
  const now = Date.now();
  const cat = categoryById(ticket.categoryId);

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
  ticket.reopenWindowUntil = null;
  saveState();

  // DM the opener
  const opener = await client.users.fetch(ticket.openerId).catch(() => null);
  const dmEmbed = brandEmbed()
    .setTitle(`🔒 Ticket #${ticket.id} Closed`)
    .setDescription(
      [
        `Your support ticket in **${interaction.guild!.name}** has been closed by a staff member.`,
        '',
        '📄 **A transcript of your ticket is attached** — keep it for your records.',
        '',
        'If you need further help, feel free to open a new ticket from the support panel.',
      ].join('\n'),
    )
    .setColor(cat?.color || 0x4b4b4b)
    .setThumbnail(BRAND_ICON)
    .addFields(
      { name: '📂 Category', value: `${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`, inline: true },
      { name: '🔨 Closed by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      { name: '⏱️ Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: '💬 Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: '📝 Close Reason', value: reason, inline: false }] : []),
    );
  await safeDm(opener, dmEmbed, [attachment]);

  // Log channel
  const logEmbed = brandEmbed()
    .setTitle(`🔒 Ticket #${ticket.id} Closed`)
    .setColor(0x2b2b2b)
    .setThumbnail(BRAND_ICON)
    .setDescription(`Ticket closed via \`/ticket-close\` command. Transcript attached.`)
    .addFields(
      { name: '👤 Opener', value: `<@${ticket.openerId}>\n\`${ticket.openerTag}\``, inline: true },
      { name: '🔨 Closed by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      { name: '📋 Claimed by', value: ticket.claimedByTag ? `<@${ticket.claimedById}>\n\`${ticket.claimedByTag}\`` : '— *unclaimed* —', inline: true },
      { name: '📂 Category', value: `${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`, inline: true },
      { name: '⏱️ Duration', value: formatDuration(now - ticket.openedAt), inline: true },
      { name: '💬 Messages', value: String(ticket.messageCount), inline: true },
      ...(reason ? [{ name: '📝 Close Reason', value: reason, inline: false }] : []),
    );
  await sendToLogChannel(interaction.guild, { embeds: [logEmbed], files: [attachment] });

  // Countdown + delete
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(`⚠️ **This ticket has been closed by <@${interaction.user.id}> via \`/ticket-close\`. Channel will be deleted in 5 seconds…**`)
        .setFooter({ text: 'Transcript has been saved and sent to the opener.' }),
    ],
  });
  await sleep(1000);
  await channel.send('⏳ **4…**');
  await sleep(1000);
  await channel.send('⏳ **3…**');
  await sleep(1000);
  await channel.send('⏳ **2…**');
  await sleep(1000);
  await channel.send('⏳ **1…**');
  await sleep(1000);

  try {
    await channel.delete(`Ticket #${ticket.id} closed via /ticket-close by ${interaction.user.tag}`);
  } catch (err) {
    console.warn('[ticket-bot] channel delete failed:', err);
  }
  ticket.channelId = null;
  saveState();

  await interaction.editReply({ content: `✅ **Ticket #${ticket.id} closed.** Channel deleted, transcript sent to opener + log channel.` });
}

// ---------------------------------------------------------------------------
// /ticket-add slash command — add a user to the current ticket channel
// ---------------------------------------------------------------------------
async function handleAddCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({ content: '⚠️ This command can only be used in a server text channel.', ephemeral: true });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  const ticket = ticketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ This command can only be used inside a ticket channel.', ephemeral: true });
    return;
  }

  const userToAdd = interaction.options.getUser('user', true);
  const channel = interaction.channel as TextChannel;

  try {
    await channel.permissionOverwrites.edit(userToAdd.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
    await interaction.reply({
      content: `✅ <@${userToAdd.id}> (\`${userToAdd.tag}\`) has been added to this ticket by <@${interaction.user.id}>.`,
      allowedMentions: { users: [userToAdd.id] },
    });
  } catch (err: any) {
    await interaction.reply({ content: `❌ Failed to add user: ${err?.message || err}`, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// /ticket-help slash command — list all commands
// ---------------------------------------------------------------------------
async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  const embed = brandEmbed()
    .setTitle('📖 Ticket Bot Commands')
    .setColor(0x4b4b4b)
    .setThumbnail(BRAND_ICON)
    .setDescription(`Here are all the staff commands available for **${BRAND_TICKET}**.`)
    .addFields(
      {
        name: '🎫 `/ticket-panel`',
        value: 'Post the ticket panel in the **current channel**. Optional: `title` and `description` parameters to customise.',
        inline: false,
      },
      {
        name: '📊 `/ticket-stats`',
        value: 'Show ticket statistics: total, open, closed, average close time, per-category breakdown.',
        inline: false,
      },
      {
        name: '🔒 `/ticket-close`',
        value: 'Close any ticket by its ID number. Works from ANY channel. Optional: `reason` parameter.\nExample: `/ticket-close id:5 reason:"Issue resolved"`',
        inline: false,
      },
      {
        name: '➕ `/ticket-add`',
        value: 'Add a user to the **current ticket channel**. Run inside a ticket channel.\nExample: `/ticket-add user:@someone`',
        inline: false,
      },
      {
        name: '📖 `/ticket-help`',
        value: 'Show this help message.',
        inline: false,
      },
      {
        name: '👥 `/ticket-staff` (admin only)',
        value: 'Manage which roles count as ticket support staff. Actions: `add`, `remove`, `list`.\nExamples:\n• `/ticket-staff action:add role:@Support`\n• `/ticket-staff action:remove role:@Support`\n• `/ticket-staff action:list`\n\nChanges are persisted and survive restarts.',
        inline: false,
      },
      {
        name: '✏️ `/ticket-rename`',
        value: 'Rename the current ticket channel. Run inside a ticket channel.\nExample: `/ticket-rename name:urgent-bug`',
        inline: false,
      },
      {
        name: 'ℹ️ `/ticket-info`',
        value: 'Show details about any ticket by ID — opener, status, claimer, first response time, last activity, close reason.\nExample: `/ticket-info id:5`',
        inline: false,
      },
      {
        name: '🚫 `/ticket-blacklist` (admin only)',
        value: 'Block a user from opening tickets. Actions: `add`, `remove`, `list`.\nExamples:\n• `/ticket-blacklist action:add user:@spammer`\n• `/ticket-blacklist action:remove user:@spammer`\n• `/ticket-blacklist action:list`',
        inline: false,
      },
      {
        name: '📋 Button Actions (in ticket channels)',
        value: [
          '• **📋 Claim Ticket** — claim the ticket (staff only).',
          '• **🔒 Close Ticket** — close immediately (staff or opener).',
          '• **🔴 Close + Reason** — close with a reason modal (staff only).',
          '• **↩️ Reopen Ticket** — reopen within 60s of closing (staff only).',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⏰ Auto-Close (inactivity)',
        value: [
          '• Tickets with **no staff response** for 7 days → bot posts a warning.',
          '• If still no response 3 days later → auto-close + delete channel.',
          '• Tickets with no response for 14 days → immediate auto-close.',
          '• All auto-closes are logged in #ticket-logs.',
        ].join('\n'),
        inline: false,
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /ticket-staff slash command — manage which roles count as support staff
// ---------------------------------------------------------------------------
async function handleStaffCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;

  // Only admins (TICKET_ADMIN_ROLE_ID) can manage staff roles.
  // Falls back to ManageRoles permission if no admin role is configured.
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = (ADMIN_ROLE_ID && member?.roles.cache.has(ADMIN_ROLE_ID)) || (member?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false);
  if (!isAdmin) {
    await interaction.reply({
      content: '🚫 Only ticket admins can manage staff roles.',
      ephemeral: true,
    });
    return;
  }

  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role');

  if (action === 'list') {
    if (staffRoleIds.length === 0) {
      await interaction.reply({
        content: '📋 **No staff roles are currently configured.**\n\nUse `/ticket-staff action:add role:@SomeRole` to add one.',
        ephemeral: true,
      });
      return;
    }
    // Resolve role IDs to names (best-effort — some may have been deleted)
    const lines: string[] = [];
    for (const id of staffRoleIds) {
      try {
        const r = await interaction.guild.roles.fetch(id);
        lines.push(`• ${r ? `<@&${r.id}> (\`${r.name}\`)` : `~~deleted role~~ (\`${id}\`)`}`);
      } catch {
        lines.push(`• ~~deleted role~~ (\`${id}\`)`);
      }
    }
    const embed = brandEmbed()
      .setTitle('📋 Current Staff Roles')
      .setColor(0x2ecc71)
      .setThumbnail(BRAND_ICON)
      .setDescription(`${staffRoleIds.length} role(s) currently count as ticket support staff:\n\n${lines.join('\n')}`)
      .addFields({
        name: '💡 Manage',
        value: '• `/ticket-staff action:add role:@Role` — add a staff role\n• `/ticket-staff action:remove role:@Role` — remove a staff role\n• `/ticket-staff action:list` — show this list',
        inline: false,
      });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // add or remove
  if (!role) {
    await interaction.reply({
      content: '⚠️ You must specify a role. Example: `/ticket-staff action:add role:@Support`',
      ephemeral: true,
    });
    return;
  }

  if (action === 'add') {
    if (staffRoleIds.includes(role.id)) {
      await interaction.reply({
        content: `⚠️ <@&${role.id}> (\`${role.name}\`) is already a staff role.`,
        ephemeral: true,
      });
      return;
    }
    staffRoleIds.push(role.id);
    state.staffRoleIds = staffRoleIds;
    saveState();

    const embed = brandEmbed()
      .setTitle('✅ Staff Role Added')
      .setColor(0x2ecc71)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@&${role.id}> (\`${role.name}\`) is now a ticket support staff role.`)
      .addFields(
        { name: '📊 Total staff roles', value: String(staffRoleIds.length), inline: true },
        { name: '👤 Added by', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'Changes are persisted to tickets.json and survive restarts.' });
    await interaction.reply({ embeds: [embed] });

    // Log it
    const logEmbed = brandEmbed()
      .setTitle('➕ Staff Role Added')
      .setColor(0x2ecc71)
      .setThumbnail(BRAND_ICON)
      .setDescription(`A new staff role was added by <@${interaction.user.id}>.`)
      .addFields(
        { name: 'Role', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
        { name: 'Added by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
        { name: 'Total staff roles', value: String(staffRoleIds.length), inline: true },
      );
    await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });
    return;
  }

  if (action === 'remove') {
    const idx = staffRoleIds.indexOf(role.id);
    if (idx === -1) {
      await interaction.reply({
        content: `⚠️ <@&${role.id}> (\`${role.name}\`) is not currently a staff role.`,
        ephemeral: true,
      });
      return;
    }
    staffRoleIds.splice(idx, 1);
    state.staffRoleIds = staffRoleIds;
    saveState();

    const embed = brandEmbed()
      .setTitle('🗑️ Staff Role Removed')
      .setColor(0xe74c3c)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@&${role.id}> (\`${role.name}\`) is no longer a ticket support staff role.`)
      .addFields(
        { name: '📊 Remaining staff roles', value: String(staffRoleIds.length), inline: true },
        { name: '👤 Removed by', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'Changes are persisted to tickets.json and survive restarts.' });
    await interaction.reply({ embeds: [embed] });

    // Log it
    const logEmbed = brandEmbed()
      .setTitle('➖ Staff Role Removed')
      .setColor(0xe74c3c)
      .setThumbnail(BRAND_ICON)
      .setDescription(`A staff role was removed by <@${interaction.user.id}>.`)
      .addFields(
        { name: 'Role', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
        { name: 'Removed by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
        { name: 'Remaining staff roles', value: String(staffRoleIds.length), inline: true },
      );
    await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });
    return;
  }
}

// ---------------------------------------------------------------------------
// /ticket-rename slash command — rename the current ticket channel
// ---------------------------------------------------------------------------
async function handleRenameCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({ content: '⚠️ This command can only be used in a server text channel.', ephemeral: true });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  const ticket = ticketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ This command can only be used inside a ticket channel.', ephemeral: true });
    return;
  }

  const newName = interaction.options.getString('name', true).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').slice(0, 100);
  if (!newName) {
    await interaction.reply({ content: '⚠️ Invalid name. Use letters, numbers, dashes, and underscores only.', ephemeral: true });
    return;
  }

  const channel = interaction.channel as TextChannel;
  try {
    const oldName = channel.name;
    await channel.setName(newName, `Renamed by ${interaction.user.tag} via /ticket-rename`);
    await interaction.reply({
      content: `✅ Ticket channel renamed from \`${oldName}\` to \`${newName}\` by <@${interaction.user.id}>.`,
    });
  } catch (err: any) {
    await interaction.reply({ content: `❌ Failed to rename: ${err?.message || err}`, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// /ticket-info slash command — show details about a ticket by ID
// ---------------------------------------------------------------------------
async function handleInfoCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member)) {
    await interaction.reply({ content: '🚫 Only staff can use this command.', ephemeral: true });
    return;
  }

  const ticketId = interaction.options.getInteger('id', true);
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    await interaction.reply({ content: `⚠️ Ticket #${ticketId} not found.`, ephemeral: true });
    return;
  }

  const cat = categoryById(ticket.categoryId);
  const now = Date.now();
  const duration = ticket.closedAt ? ticket.closedAt - ticket.openedAt : now - ticket.openedAt;
  const firstResponseMs = ticket.firstResponseAt ? ticket.firstResponseAt - ticket.openedAt : null;

  const embed = brandEmbed()
    .setTitle(`🎫 Ticket #${ticket.id} Info`)
    .setColor(ticket.status === 'closed' ? 0x2b2b2b : cat?.color || 0x4b4b4b)
    .setThumbnail(BRAND_ICON)
    .addFields(
      { name: '📂 Category', value: `${cat?.emoji || '🎫'} ${cat?.label || ticket.categoryLabel}`, inline: true },
      { name: '🔴 Status', value: ticket.status.toUpperCase(), inline: true },
      { name: '⏱️ Duration', value: formatDuration(duration), inline: true },
      { name: '👤 Opener', value: `<@${ticket.openerId}>\n\`${ticket.openerTag}\``, inline: true },
      { name: '📋 Claimed by', value: ticket.claimedByTag ? `<@${ticket.claimedById}>\n\`${ticket.claimedByTag}\`` : '— *unclaimed* —', inline: true },
      { name: '📝 First response', value: firstResponseMs !== null ? `\`${formatDuration(firstResponseMs)}\` by <@${ticket.firstResponderId}>\n\`${ticket.firstResponderTag}\`` : '— *no staff response* —', inline: true },
      { name: '⏰ Opened', value: `<t:${Math.floor(ticket.openedAt / 1000)}:F>\n(<t:${Math.floor(ticket.openedAt / 1000)}:R>)`, inline: true },
      ...(ticket.closedAt ? [{ name: '🔒 Closed', value: `<t:${Math.floor(ticket.closedAt / 1000)}:F>\n(<t:${Math.floor(ticket.closedAt / 1000)}:R>)`, inline: true }] : []),
      ...(ticket.closerId ? [{ name: '🔨 Closed by', value: `<@${ticket.closerId}>\n\`${ticket.closerTag}\``, inline: true }] : []),
      { name: '💬 Messages', value: String(ticket.messageCount), inline: true },
      { name: '🕐 Last activity', value: `<t:${Math.floor(ticket.lastActivityAt / 1000)}:R>`, inline: true },
      ...(ticket.channelId ? [{ name: '🎫 Channel', value: `<#${ticket.channelId}>`, inline: true }] : []),
      ...(ticket.closeReason ? [{ name: '📝 Close reason', value: ticket.closeReason, inline: false }] : []),
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /ticket-blacklist slash command — block users from opening tickets
// ---------------------------------------------------------------------------
async function handleBlacklistCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;

  // Admin-only
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = (ADMIN_ROLE_ID && member?.roles.cache.has(ADMIN_ROLE_ID)) || (member?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false);
  if (!isAdmin) {
    await interaction.reply({ content: '🚫 Only admins can manage the blacklist.', ephemeral: true });
    return;
  }

  const action = interaction.options.getString('action', true);
  const user = interaction.options.getUser('user');

  const blacklist = state.blacklistedUserIds || [];

  if (action === 'list') {
    if (blacklist.length === 0) {
      await interaction.reply({ content: '📋 **No users are currently blacklisted.**', ephemeral: true });
      return;
    }
    const lines: string[] = [];
    for (const id of blacklist) {
      try {
        const u = await client.users.fetch(id).catch(() => null);
        lines.push(`• ${u ? `<@${u.id}> (\`${u.tag}\`)` : `~~deleted user~~ (\`${id}\`)`}`);
      } catch {
        lines.push(`• ~~deleted user~~ (\`${id}\`)`);
      }
    }
    const embed = brandEmbed()
      .setTitle('🚫 Blacklisted Users')
      .setColor(0xe74c3c)
      .setThumbnail(BRAND_ICON)
      .setDescription(`${blacklist.length} user(s) are blocked from opening tickets:\n\n${lines.join('\n')}`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (!user) {
    await interaction.reply({ content: '⚠️ You must specify a user. Example: `/ticket-blacklist action:add user:@someone`', ephemeral: true });
    return;
  }

  // Don't let admins blacklist themselves or other staff
  if (user.id === interaction.user.id) {
    await interaction.reply({ content: '⚠️ You cannot blacklist yourself.', ephemeral: true });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (targetMember && isStaff(targetMember)) {
    await interaction.reply({ content: '⚠️ You cannot blacklist a staff member. Remove their staff role first.', ephemeral: true });
    return;
  }

  if (action === 'add') {
    if (blacklist.includes(user.id)) {
      await interaction.reply({ content: `⚠️ <@${user.id}> is already blacklisted.`, ephemeral: true });
      return;
    }
    blacklist.push(user.id);
    state.blacklistedUserIds = blacklist;
    saveState();

    const embed = brandEmbed()
      .setTitle('🚫 User Blacklisted')
      .setColor(0xe74c3c)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@${user.id}> (\`${user.tag}\`) can no longer open tickets.`)
      .addFields(
        { name: '👤 Blacklisted by', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
        { name: '📊 Total blacklisted', value: String(blacklist.length), inline: true },
      );
    await interaction.reply({ embeds: [embed] });

    // Log it
    const logEmbed = brandEmbed()
      .setTitle('➕ User Blacklisted')
      .setColor(0xe74c3c)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@${user.id}> was blocked from opening tickets.`)
      .addFields(
        { name: 'User', value: `<@${user.id}>\n\`${user.tag}\``, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      );
    await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });
    return;
  }

  if (action === 'remove') {
    const idx = blacklist.indexOf(user.id);
    if (idx === -1) {
      await interaction.reply({ content: `⚠️ <@${user.id}> is not currently blacklisted.`, ephemeral: true });
      return;
    }
    blacklist.splice(idx, 1);
    state.blacklistedUserIds = blacklist;
    saveState();

    const embed = brandEmbed()
      .setTitle('✅ User Unblacklisted')
      .setColor(0x2ecc71)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@${user.id}> (\`${user.tag}\`) can now open tickets again.`)
      .addFields(
        { name: '👤 Unblacklisted by', value: `<@${interaction.user.id}>`, inline: true },
        { name: '📊 Total blacklisted', value: String(blacklist.length), inline: true },
      );
    await interaction.reply({ embeds: [embed] });

    const logEmbed = brandEmbed()
      .setTitle('➖ User Unblacklisted')
      .setColor(0x2ecc71)
      .setThumbnail(BRAND_ICON)
      .setDescription(`<@${user.id}> was unblocked from opening tickets.`)
      .addFields(
        { name: 'User', value: `<@${user.id}>\n\`${user.tag}\``, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>\n\`${interaction.user.tag}\``, inline: true },
      );
    await sendToLogChannel(interaction.guild, { embeds: [logEmbed] });
    return;
  }
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

  // Average first-response time (tickets where staff responded)
  const respondedTickets = state.tickets.filter((t) => t.firstResponseAt !== null);
  const avgResponseMs = respondedTickets.length
    ? respondedTickets.reduce((acc, t) => acc + ((t.firstResponseAt as number) - t.openedAt), 0) / respondedTickets.length
    : 0;
  const unrespondedOpen = state.tickets.filter((t) => t.status !== 'closed' && t.firstResponseAt === null).length;

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
    .setThumbnail(BRAND_ICON)
    .setDescription(`**${BRAND} Ticket Bot — Live Statistics**\n\nReal-time ticket activity for this server.`)
    .addFields(
      { name: '🎫 Total Tickets', value: `\`${total}\``, inline: true },
      { name: '🟢 Currently Open', value: `\`${open}\``, inline: true },
      { name: '🔒 Closed', value: `\`${closed}\``, inline: true },
      { name: '↩️ Reopened', value: `\`${reopened}\``, inline: true },
      { name: '⏱️ Avg. Close Time', value: avgMs ? `\`${formatDuration(avgMs)}\`` : '`—`', inline: true },
      { name: '🔢 Next Ticket #', value: `\`${state.count + 1}\``, inline: true },
      { name: '⚡ Avg. First Response', value: avgResponseMs ? `\`${formatDuration(avgResponseMs)}\`` : '`—`', inline: true },
      { name: '⚠️ Unresponded (open)', value: `\`${unrespondedOpen}\``, inline: true },
      { name: '🚫 Blacklisted users', value: `\`${(state.blacklistedUserIds || []).length}\``, inline: true },
    );

  // Per-category breakdown with a visual bar
  embed.addFields({
    name: '📂 Per-Category Breakdown',
    value: perCat
      .map((c) => {
        const pct = c.total > 0 ? Math.round((c.closed / c.total) * 100) : 0;
        return `${c.label}\n   └ Total: **${c.total}** • Open: **${c.open}** • Closed: **${c.closed}** • Close rate: **${pct}%**`;
      })
      .join('\n\n'),
    inline: false,
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
  targetChannelId?: string; // override PANEL_CHANNEL_ID (used by /ticket-panel slash command)
}): Promise<{ ok: boolean; messageId?: string; channelId?: string; error?: string }> {
  if (DEMO_MODE) {
    return { ok: false, error: 'Bot is in demo mode (no DISCORD_BOT_TOKEN).' };
  }
  if (!guild) return { ok: false, error: 'Guild not resolved.' };
  const targetChannelId = opts.targetChannelId || PANEL_CHANNEL_ID;
  if (!targetChannelId) return { ok: false, error: 'No target channel — set TICKET_PANEL_CHANNEL_ID or use /ticket-panel in a channel.' };

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
    [
      `Welcome to the **${BRAND}** support desk.`,
      '',
      'Select a category from the dropdown below to open a private ticket with our staff team. Our moderators will respond as soon as possible.',
      '',
      `📂 **${categories.length} categories available** • ⏱️ **24/7 support** • 🔒 **Private channels**`,
    ].join('\n');

  // Build the categories list with cleaner formatting
  const categoryList = categories
    .map((c) => `${c.emoji}  **${c.label}**\n     └ *${c.description}*`)
    .join('\n\n');

  const embed = brandEmbed()
    .setTitle(`🎫 ${title}`)
    .setDescription(description)
    .setColor(0x2b2b2b)
    .setThumbnail(BRAND_ICON)
    .addFields(
      {
        name: '📋 Available Categories',
        value: categoryList,
        inline: false,
      },
      {
        name: '⚠️ Before Opening a Ticket',
        value: [
          '• **One ticket per issue** — don\'t spam multiple tickets.',
          '• **Be detailed** — include screenshots, steps, and context.',
          '• **Don\'t ping staff** — they are notified automatically.',
          '• **Stay on topic** — keep the discussion relevant to your issue.',
          '• **Abuse** may result in a temporary or permanent ticket ban.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📊 Live Stats',
        value: [
          `🎫 Total opened: **${state.tickets.length}**`,
          `🟢 Currently open: **${state.tickets.filter((t) => t.status !== 'closed').length}**`,
          `🔒 Closed: **${state.tickets.filter((t) => t.status === 'closed').length}**`,
        ].join('\n'),
        inline: false,
      },
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('icbs_ticket_panel')
    .setPlaceholder('🎫 Select a ticket category…')
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
    const channel = await guild.channels.fetch(targetChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return { ok: false, error: 'Target channel not found or not a text channel.' };
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
// HTML status page — served at GET / (and /status, /dashboard)
// ---------------------------------------------------------------------------
// A proper website showing the bot's live status. This replaces the old
// tiny JSON response at /. The JSON status is still available at /health.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function generateStatusPage(): string {
  const uptime = process.uptime();
  const mode = DEMO_MODE ? 'demo' : 'live';
  const statusLabel = ready ? (mode === 'live' ? 'LIVE' : 'DEMO') : 'STARTING';
  const statusColor = ready && mode === 'live' ? '#2ecc71' : mode === 'demo' ? '#f1c40f' : '#e74c3c';
  const statusEmoji = ready && mode === 'live' ? '🟢' : mode === 'demo' ? '🟡' : '🔴';

  const totalTickets = state.tickets.length;
  const openTickets = state.tickets.filter((t) => t.status !== 'closed').length;
  const closedTickets = state.tickets.filter((t) => t.status === 'closed').length;
  const nextTicketId = state.count + 1;

  const configChecks: Array<[string, boolean, string]> = [
    ['DISCORD_BOT_TOKEN', !!TOKEN, 'Bot token'],
    ['DISCORD_GUILD_ID', !!GUILD_ID, 'Server ID'],
    ['TICKET_PANEL_CHANNEL_ID', !!PANEL_CHANNEL_ID, 'Panel channel'],
    ['TICKET_LOG_CHANNEL_ID', !!LOG_CHANNEL_ID, 'Log channel'],
    ['TICKET_CATEGORY_ID', !!TICKET_CATEGORY_ID, 'Ticket category'],
    ['TICKET_ADMIN_ROLE_ID', !!ADMIN_ROLE_ID, 'Admin role'],
    ['TICKET_STAFF_ROLE_IDS', staffRoleIds.length > 0, `Staff roles (${staffRoleIds.length} loaded)`],
    ['ICBS_WEBHOOK_SECRET', !!WEBHOOK_SECRET, 'Webhook secret'],
    ['ICBS_PUBLIC_URL', !!PUBLIC_URL, 'Public URL (for logo)'],
  ];

  const recentTickets = [...state.tickets]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 8);

  const logoUrl = PUBLIC_URL ? `${PUBLIC_URL}/brand-icon.webp` : '/brand-icon.webp';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Status</title>
  <link rel="icon" type="image/webp" href="${logoUrl}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #0a0a0a;
      color: #e8e8e8;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 24px 0;
      border-bottom: 1px solid #2b2b2b;
      margin-bottom: 32px;
    }
    header img {
      width: 72px;
      height: 72px;
      border-radius: 12px;
      border: 2px solid #2b2b2b;
    }
    header h1 {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    header .subtitle {
      color: #888;
      font-size: 14px;
      margin-top: 4px;
    }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-left: auto;
      background: ${statusColor};
      color: #0a0a0a;
    }
    .section {
      background: #141414;
      border: 1px solid #2b2b2b;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .section h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #888;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
    }
    .stat {
      background: #1a1a1a;
      border: 1px solid #2b2b2b;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat .value {
      font-size: 32px;
      font-weight: 700;
      color: #e8e8e8;
      font-family: 'Consolas', 'Monaco', monospace;
    }
    .stat .label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #666;
      margin-top: 6px;
    }
    .stat.open .value { color: #2ecc71; }
    .stat.closed .value { color: #95a5a6; }
    .stat.next .value { color: #f1c40f; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      background: #1a1a1a;
      border: 1px solid #2b2b2b;
      border-radius: 6px;
      font-size: 14px;
    }
    .info-item .key { color: #888; }
    .info-item .val { color: #e8e8e8; font-family: 'Consolas', monospace; }
    .config-table { width: 100%; border-collapse: collapse; }
    .config-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #1f1f1f;
      font-size: 14px;
    }
    .config-table td:first-child { font-family: 'Consolas', monospace; color: #bbb; }
    .config-table td:nth-child(2) { text-align: center; width: 40px; }
    .config-table td:last-child { color: #666; font-size: 13px; }
    .check-yes { color: #2ecc71; font-size: 18px; }
    .check-no { color: #e74c3c; font-size: 18px; }
    .ticket-row {
      display: grid;
      grid-template-columns: 60px 1fr 120px 100px 80px;
      gap: 12px;
      padding: 10px 14px;
      background: #1a1a1a;
      border: 1px solid #2b2b2b;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 13px;
      align-items: center;
    }
    .ticket-row .id { font-family: 'Consolas', monospace; color: #f1c40f; font-weight: 700; }
    .ticket-row .cat { color: #bbb; }
    .ticket-row .opener { color: #888; font-size: 12px; }
    .ticket-row .status { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-align: center; padding: 3px 8px; border-radius: 4px; }
    .ticket-row .status.open { background: #1e3a1e; color: #2ecc71; }
    .ticket-row .status.closed { background: #2b2b2b; color: #95a5a6; }
    .ticket-row .status.reopened { background: #2e2717; color: #f1c40f; }
    .ticket-row .time { color: #666; font-size: 11px; text-align: right; }
    .no-tickets { text-align: center; color: #555; padding: 24px; font-style: italic; }
    .categories {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .cat-chip {
      background: #1a1a1a;
      border: 1px solid #2b2b2b;
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 13px;
    }
    .cat-chip .emoji { margin-right: 6px; }
    footer {
      text-align: center;
      padding: 32px 0 16px;
      color: #444;
      font-size: 12px;
      border-top: 1px solid #1a1a1a;
      margin-top: 32px;
    }
    footer a { color: #666; text-decoration: none; }
    footer a:hover { color: #aaa; }
    .pulse {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${statusColor};
      margin-right: 6px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    @media (max-width: 600px) {
      header { flex-direction: column; text-align: center; gap: 12px; }
      .badge { margin-left: 0; }
      .info-grid { grid-template-columns: 1fr; }
      .ticket-row { grid-template-columns: 50px 1fr 80px; font-size: 12px; }
      .ticket-row .opener, .ticket-row .time { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <img src="${logoUrl}" alt="ICBS Logo" onerror="this.style.display='none'">
      <div>
        <h1>𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡</h1>
        <div class="subtitle">Advanced Discord Ticket System — Status Page</div>
      </div>
      <span class="badge"><span class="pulse"></span>${statusEmoji} ${statusLabel}</span>
    </header>

    <div class="section">
      <h2>📊 Ticket Statistics</h2>
      <div class="stats-grid">
        <div class="stat"><div class="value">${totalTickets}</div><div class="label">Total Tickets</div></div>
        <div class="stat open"><div class="value">${openTickets}</div><div class="label">Open</div></div>
        <div class="stat closed"><div class="value">${closedTickets}</div><div class="label">Closed</div></div>
        <div class="stat next"><div class="value">#${nextTicketId}</div><div class="label">Next Ticket</div></div>
        <div class="stat"><div class="value">${categories.length}</div><div class="label">Categories</div></div>
      </div>
    </div>

    <div class="section">
      <h2>🤖 Bot Information</h2>
      <div class="info-grid">
        <div class="info-item"><span class="key">Bot Tag</span><span class="val">${escapeHtml(client.user?.tag || '— not connected —')}</span></div>
        <div class="info-item"><span class="key">Bot ID</span><span class="val">${escapeHtml(client.user?.id || '—')}</span></div>
        <div class="info-item"><span class="key">Guild</span><span class="val">${escapeHtml(guild?.name || '— not resolved —')}</span></div>
        <div class="info-item"><span class="key">Guild ID</span><span class="val">${escapeHtml(guild?.id || '—')}</span></div>
        <div class="info-item"><span class="key">Mode</span><span class="val">${mode.toUpperCase()}</span></div>
        <div class="info-item"><span class="key">Ready</span><span class="val">${ready ? '✅ Yes' : '❌ No'}</span></div>
        <div class="info-item"><span class="key">Uptime</span><span class="val">${formatUptime(uptime)}</span></div>
        <div class="info-item"><span class="key">Port</span><span class="val">${HTTP_PORT}</span></div>
      </div>
    </div>

    <div class="section">
      <h2>📋 Configuration Checks</h2>
      <table class="config-table">
        ${configChecks.map(([key, ok, hint]) => `
        <tr>
          <td>${key}</td>
          <td>${ok ? '<span class="check-yes">✅</span>' : '<span class="check-no">❌</span>'}</td>
          <td>${hint}${ok ? '' : ' — NOT SET'}</td>
        </tr>`).join('')}
      </table>
    </div>

    <div class="section">
      <h2>📂 Ticket Categories</h2>
      <div class="categories">
        ${categories.map((c) => `<span class="cat-chip"><span class="emoji">${c.emoji}</span>${escapeHtml(c.label)}</span>`).join('')}
      </div>
    </div>

    ${state.panelMessageId ? `
    <div class="section">
      <h2>🎫 Ticket Panel</h2>
      <div class="info-grid">
        <div class="info-item"><span class="key">Panel Message ID</span><span class="val">${escapeHtml(state.panelMessageId)}</span></div>
        <div class="info-item"><span class="key">Panel Channel ID</span><span class="val">${escapeHtml(state.panelChannelId || '—')}</span></div>
      </div>
    </div>` : ''}

    <div class="section">
      <h2>🕐 Recent Tickets</h2>
      ${recentTickets.length === 0 ? '<div class="no-tickets">No tickets have been opened yet.</div>' : recentTickets.map((t) => `
        <div class="ticket-row">
          <div class="id">#${t.id}</div>
          <div>
            <div class="cat">${escapeHtml(t.categoryLabel)}</div>
            <div class="opener">by ${escapeHtml(t.openerTag)}</div>
          </div>
          <div class="opener">${escapeHtml(t.claimedByTag ? '📋 ' + t.claimedByTag : '— unclaimed —')}</div>
          <div class="status ${t.status}">${t.status}</div>
          <div class="time">${new Date(t.openedAt).toLocaleString()}</div>
        </div>`).join('')}
    </div>

    <footer>
      <p>𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 — Support Delivered</p>
      <p style="margin-top:8px;">
        Auto-refreshes every 30 seconds ·
        <a href="/health">JSON API</a> ·
        <a href="/ping">Ping</a> ·
        <a href="/uptime">Uptime</a> ·
        <a href="/brand-icon.webp">Logo</a>
      </p>
      <p style="margin-top:8px;">Last updated: ${new Date().toISOString()}</p>
    </footer>
  </div>
</body>
</html>`;
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

  // --- GET /  (the HTML status website — Render's default health check too) ---
  // Returns a full HTML page showing the bot's live status. This is what
  // appears when you visit the bot's URL in a browser. Also works as
  // Render's health check (returns 200 OK).
  if (req.method === 'GET' && (pathname === '/' || pathname === '/status' || pathname === '/dashboard')) {
    const html = generateStatusPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // --- GET /uptime  (plain text — simplest possible for UptimeRobot) ---
  // Returns "OK" as plain text. Some uptime monitors struggle with JSON or
  // HTML; this endpoint returns the simplest possible 200 response so any
  // monitor can detect the service is alive.
  // Point UptimeRobot at: https://icbs-ticket-bot.onrender.com/uptime
  if (req.method === 'GET' && pathname === '/uptime') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK');
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

  // --- GET /brand-icon.webp  (the ICBS logo — used as embed thumbnail) ---
  if (req.method === 'GET' && (pathname === '/brand-icon.webp' || pathname === '/logo.webp' || pathname === '/icon.webp')) {
    const logoPath = path.join(__dirname, 'brand-icon.webp');
    try {
      const data = fs.readFileSync(logoPath);
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'brand-icon.webp not found on disk.' }));
    }
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
        staffRoles: staffRoleIds.length,
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

  // --- 404 ---
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: `Not found: ${req.method} ${pathname}` }));
});

// Bind to 0.0.0.0 so the service is reachable from outside the container
// (Render requires this — listening on localhost only won't pass health checks).
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[ticket-bot] 🌐 HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[ticket-bot]    GET  /                (HTML status website — visit in browser)`);
  console.log(`[ticket-bot]    GET  /uptime          (plain text "OK" — for UptimeRobot)`);
  console.log(`[ticket-bot]    GET  /ping            (lightweight JSON, no auth)`);
  console.log(`[ticket-bot]    GET  /health          (full JSON status payload)`);
  console.log(`[ticket-bot]    GET  /brand-icon.webp (the ICBS logo — used as embed thumbnail)`);
  console.log(`[ticket-bot]    POST /setup-panel    (auth: x-icbs-secret — post the ticket panel)`);
  if (PUBLIC_URL) {
    console.log(`[ticket-bot] 🌍 Public URL: ${PUBLIC_URL}`);
    console.log(`[ticket-bot] 🎨 Brand icon:  ${PUBLIC_URL}/brand-icon.webp`);
    console.log(`[ticket-bot] 📊 Status page: ${PUBLIC_URL}/`);
    console.log(`[ticket-bot] ⏱️  Uptime monitor: ${PUBLIC_URL}/uptime`);
  } else {
    console.log(`[ticket-bot] ⚠️  ICBS_PUBLIC_URL not set — embeds will fall back to Discord default avatar.`);
    console.log(`[ticket-bot]    Set ICBS_PUBLIC_URL to your Render URL (e.g. https://icbs-ticket-bot.onrender.com) to use the ICBS logo.`);
  }
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

// ---------------------------------------------------------------------------
// Inactivity auto-close checker — runs every hour.
// Tickets open for >7 days with no staff response → warn in channel.
// Tickets open for >14 days with no staff response → auto-close with reason.
// Tickets warned but still inactive for 3 more days → auto-close.
// ---------------------------------------------------------------------------
const INACTIVITY_WARN_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const INACTIVITY_CLOSE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const INACTIVITY_CLOSE_AFTER_WARN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days after warn

setInterval(async () => {
  if (!guild) return;
  const now = Date.now();
  for (const t of state.tickets) {
    if (t.status === 'closed' || !t.channelId) continue;
    if (t.firstResponseAt !== null) continue; // staff responded, don't auto-close
    const idleMs = now - t.lastActivityAt;

    // Auto-close if open >14 days with no staff response
    if (idleMs >= INACTIVITY_CLOSE_MS) {
      try {
        const channel = await guild.channels.fetch(t.channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          await (channel as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle(`⏰ Ticket #${t.id} auto-closed (inactivity)`)
                .setDescription('This ticket has been open for 14+ days with no staff response and is being auto-closed. Please open a new ticket if you still need help.')
                .setFooter({ text: 'Auto-close — 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 Ticket Bot' }),
            ],
          });
          // Run the standard close flow with the inactivity reason
          // (but without staff — mark as closed by system)
          t.status = 'closed';
          t.closedAt = now;
          t.closerId = null;
          t.closerTag = 'system (inactivity auto-close)';
          t.closeReason = 'Auto-closed after 14 days of inactivity with no staff response.';
          saveState();
          console.log(`[ticket-bot] ⏰ Auto-closed ticket #${t.id} after 14 days of inactivity.`);

          // Log it
          const logEmbed = brandEmbed()
            .setTitle(`⏰ Ticket #${t.id} Auto-Closed (Inactivity)`)
            .setColor(0xe74c3c)
            .setThumbnail(BRAND_ICON)
            .setDescription(`Ticket auto-closed after 14 days with no staff response.`)
            .addFields(
              { name: '👤 Opener', value: `<@${t.openerId}>\n\`${t.openerTag}\``, inline: true },
              { name: '📂 Category', value: t.categoryLabel, inline: true },
              { name: '⏰ Opened', value: `<t:${Math.floor(t.openedAt / 1000)}:R>`, inline: true },
            );
          await sendToLogChannel(guild, { embeds: [logEmbed] });

          // Delete the channel after a 10-second delay (gives user time to read)
          setTimeout(async () => {
            try {
              await channel.delete('Auto-close: 14 days of inactivity');
            } catch (err) {
              console.warn('[ticket-bot] auto-close channel delete failed:', err);
            }
            t.channelId = null;
            saveState();
          }, 10_000).unref();
        }
      } catch (err) {
        console.warn(`[ticket-bot] auto-close failed for ticket #${t.id}:`, err);
      }
      continue;
    }

    // Warn if open >7 days with no staff response and not yet warned
    if (idleMs >= INACTIVITY_WARN_MS && t.inactivityWarnedAt === null) {
      try {
        const channel = await guild.channels.fetch(t.channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          t.inactivityWarnedAt = now;
          saveState();
          await (channel as TextChannel).send({
            content: `<@${t.openerId}>`,
            embeds: [
              new EmbedBuilder()
                .setColor(0xf1c40f)
                .setTitle(`⚠️ Inactivity warning`)
                .setDescription(`This ticket has been open for 7+ days with no staff response. If you still need help, please reply here. Otherwise, the ticket will be auto-closed in 3 days.`)
                .setFooter({ text: 'Inactivity warning — 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 Ticket Bot' }),
            ],
          });
          console.log(`[ticket-bot] ⚠️ Warned ticket #${t.id} about inactivity.`);
        }
      } catch (err) {
        console.warn(`[ticket-bot] inactivity warn failed for ticket #${t.id}:`, err);
      }
      continue;
    }

    // Auto-close if warned 3+ days ago and still no response
    if (t.inactivityWarnedAt !== null && (now - t.inactivityWarnedAt) >= INACTIVITY_CLOSE_AFTER_WARN_MS) {
      try {
        const channel = await guild.channels.fetch(t.channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          await (channel as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle(`⏰ Ticket #${t.id} auto-closed (no response after warning)`)
                .setDescription('This ticket is being auto-closed because no response was received after the inactivity warning. Please open a new ticket if you still need help.')
                .setFooter({ text: 'Auto-close — 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 Ticket Bot' }),
            ],
          });
          t.status = 'closed';
          t.closedAt = now;
          t.closerId = null;
          t.closerTag = 'system (inactivity auto-close)';
          t.closeReason = 'Auto-closed: no response 3 days after inactivity warning.';
          saveState();
          console.log(`[ticket-bot] ⏰ Auto-closed ticket #${t.id} (no response after warning).`);

          const logEmbed = brandEmbed()
            .setTitle(`⏰ Ticket #${t.id} Auto-Closed (Post-Warning)`)
            .setColor(0xe74c3c)
            .setThumbnail(BRAND_ICON)
            .setDescription(`Auto-closed: no response 3 days after inactivity warning.`)
            .addFields(
              { name: '👤 Opener', value: `<@${t.openerId}>\n\`${t.openerTag}\``, inline: true },
              { name: '⏰ Opened', value: `<t:${Math.floor(t.openedAt / 1000)}:R>`, inline: true },
            );
          await sendToLogChannel(guild, { embeds: [logEmbed] });

          setTimeout(async () => {
            try {
              await channel.delete('Auto-close: no response after warning');
            } catch (err) {
              console.warn('[ticket-bot] auto-close channel delete failed:', err);
            }
            t.channelId = null;
            saveState();
          }, 10_000).unref();
        }
      } catch (err) {
        console.warn(`[ticket-bot] post-warning auto-close failed for ticket #${t.id}:`, err);
      }
    }
  }
}, 60 * 60 * 1000).unref(); // every hour
