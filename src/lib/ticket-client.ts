/**
 * ============================================================================
 *  src/lib/ticket-client.ts
 * ----------------------------------------------------------------------------
 *  Web-app-side client for the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 micro-service.
 *
 *  Mirrors src/lib/bot-client.ts:
 *    - ensureTicketBotRunning() — detached spawn in dev/combined mode,
 *                                  no-op when ICBS_TICKET_BOT_URL is set
 *                                  (split deploy).
 *    - getTicketBotHealth()     — GET /health
 *    - setupPanel(opts)         — POST /setup-panel  (auth: x-icbs-secret)
 *
 *  The bot listens on ICBS_TICKET_BOT_PORT (default 3040 — NOT 3030, which
 *  is the news bot, and NOT process.env.PORT, which belongs to the Next.js
 *  web service on Render).
 * ============================================================================
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Set this on the web service's env to talk to a separately-deployed bot. */
const TICKET_BOT_URL = process.env.ICBS_TICKET_BOT_URL || '';

/** Port the bot listens on (must match the bot's ICBS_BOT_PORT). */
const TICKET_BOT_PORT = Number(process.env.ICBS_TICKET_BOT_PORT || 3040);

/** Shared secret. Must match the bot's ICBS_WEBHOOK_SECRET. */
const WEBHOOK_SECRET = process.env.ICBS_WEBHOOK_SECRET || '';

/** Path to the bot's index.ts — used when spawning as a detached child. */
const BOT_INDEX_TS = path.resolve(
  process.cwd(),
  'mini-services',
  'icbs-ticket-bot',
  'index.ts',
);

// ---------------------------------------------------------------------------
// Detached child process management (combined / dev deploy only)
// ---------------------------------------------------------------------------

let botChild: ChildProcess | null = null;
let spawnPromise: Promise<void> | null = null;

/**
 * Spawn the ticket bot as a detached child of this Next.js process.
 *
 * - Skipped entirely when ICBS_TICKET_BOT_URL is set (split-deploy mode —
 *   the bot is running as its own Render service).
 * - Skipped when there is no bot/index.ts on disk (e.g. the web service is
 *   deployed without the mini-services folder).
 * - Idempotent: if a child is already running, returns immediately.
 */
export function ensureTicketBotRunning(): Promise<void> {
  // Split-deploy mode: bot is hosted elsewhere.
  if (TICKET_BOT_URL) return Promise.resolve();

  // No bot source on disk — can't spawn.
  if (!fs.existsSync(BOT_INDEX_TS)) return Promise.resolve();

  if (botChild && !botChild.killed) return Promise.resolve();
  if (spawnPromise) return spawnPromise;

  spawnPromise = (async () => {
    try {
      console.log('[ticket-client] spawning ticket bot as detached child…');
      const child = spawn('bun', [BOT_INDEX_TS], {
        env: {
          ...process.env,
          // Make sure the child does NOT inherit any PORT the web service set.
          PORT: undefined,
        },
        cwd: path.dirname(BOT_INDEX_TS),
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: false,
      });

      child.on('exit', (code, signal) => {
        console.warn(
          `[ticket-client] ticket bot exited (code=${code} signal=${signal}) — will respawn on next call`,
        );
        botChild = null;
        spawnPromise = null;
      });
      child.on('error', (err) => {
        console.error('[ticket-client] ticket bot spawn error:', err);
        botChild = null;
        spawnPromise = null;
      });

      botChild = child;

      // Give it a moment to bind its HTTP port before the caller pings /health.
      await new Promise((r) => setTimeout(r, 1500));
      console.log('[ticket-client] ticket bot spawned');
    } catch (err) {
      console.error('[ticket-client] failed to spawn ticket bot:', err);
      spawnPromise = null;
    }
  })();

  return spawnPromise;
}

// ---------------------------------------------------------------------------
// Base URL helper
// ---------------------------------------------------------------------------

function baseUrl(): string {
  if (TICKET_BOT_URL) return TICKET_BOT_URL.replace(/\/+$/, '');
  return `http://localhost:${TICKET_BOT_PORT}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketBotHealth {
  ok: boolean;
  service: string;
  mode: 'demo' | 'live';
  ready: boolean;
  uptime: number;
  bot: { tag: string; id: string } | null;
  guild: { id: string; name: string } | null;
  configured: {
    discordToken: boolean;
    guildId: boolean;
    panelChannel: boolean;
    logChannel: boolean;
    ticketCategory: boolean;
    adminRole: boolean;
    staffRoles: number;
    webhookSecret: boolean;
  };
  stats: {
    totalTickets: number;
    openTickets: number;
    closedTickets: number;
    nextTicketId: number;
    categories: number;
  };
  panel: { messageId: string; channelId: string } | null;
}

export interface SetupPanelOptions {
  title?: string;
  description?: string;
  categories?: Array<{
    id: string;
    emoji?: string;
    label?: string;
    description?: string;
    color?: number;
    staffRoleId?: string;
  }>;
}

export interface SetupPanelResult {
  ok: boolean;
  messageId?: string;
  channelId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * GET /health on the ticket bot. If the bot is unreachable, attempts to
 * spawn it first (combined-deploy mode), then retries once.
 *
 * Returns null if the bot still can't be reached after the retry.
 */
export async function getTicketBotHealth(): Promise<TicketBotHealth | null> {
  await ensureTicketBotRunning();

  const tryFetch = async (): Promise<TicketBotHealth | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl()}/health`, {
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      return (await res.json()) as TicketBotHealth;
    } catch {
      return null;
    }
  };

  let health = await tryFetch();
  if (!health) {
    // Maybe the spawn hasn't bound yet — wait and retry once.
    await new Promise((r) => setTimeout(r, 1500));
    health = await tryFetch();
  }
  return health;
}

/**
 * POST /setup-panel on the ticket bot. Requires ICBS_WEBHOOK_SECRET to be
 * set on the web app and to match the bot's secret.
 */
export async function setupPanel(opts: SetupPanelOptions): Promise<SetupPanelResult> {
  await ensureTicketBotRunning();

  if (!WEBHOOK_SECRET) {
    return {
      ok: false,
      error: 'ICBS_WEBHOOK_SECRET is not set on the web app — cannot authenticate to the ticket bot.',
    };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${baseUrl()}/setup-panel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-icbs-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(opts),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = (await res.json().catch(() => ({}))) as SetupPanelResult;
    if (!res.ok && !data.error) {
      data.error = `HTTP ${res.status}`;
    }
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Convenience: is the ticket bot currently up and in live mode?
 */
export async function isTicketBotLive(): Promise<boolean> {
  const h = await getTicketBotHealth();
  return !!h && h.ready && h.mode === 'live';
}
