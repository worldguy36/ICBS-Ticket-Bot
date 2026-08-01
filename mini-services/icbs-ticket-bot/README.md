# 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡

Advanced Discord ticket system for the **ICBS** server. Mirrors the architecture of **𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑚𝑒𝑠** news bot (`mini-services/icbs-bot/`) — same shape, different domain logic.

Users pick a category from a panel → a private channel is created → staff claim/close/reopen → transcripts are saved.

---

## What it does

- **Ticket panel**: a single embed + Discord **String Select Menu** posted in `#ticket-panel`.
- **6 default categories**: General, Bug Report, Billing/Nitro, Partnership, Staff Application, Ban Appeal (each with its own emoji, color, and staff role).
- **Per-ticket channels** created under a Discord Channel Category, with strict permissions (`@everyone` hidden, opener + staff + admin allowed).
- **Buttons**: 📋 Claim · 🔒 Close · 🔴 Close with Reason (modal) · ↩️ Reopen (60-second window before deletion).
- **Transcripts** saved as `.txt` attachments, posted to `#ticket-logs` and DM'd to the opener.
- **Cooldowns**: 1 ticket / 60s / user; max 3 open tickets per user.
- **`/ticket-stats`** slash command (staff only): total/open/closed/avg-close-time/per-category breakdown.
- **State** persisted to `tickets.json` so counts and history survive restarts.
- **Demo mode**: when `DISCORD_BOT_TOKEN` is unset, the Discord client does NOT connect — but the HTTP server still runs so the dashboard can display status.

---

## File layout

```
mini-services/icbs-ticket-bot/
├── index.ts          # discord.js client + HTTP server + all ticket logic
├── package.json
├── .env.example
├── README.md         # this file
└── tickets.json      # auto-created at runtime — do NOT commit
```

---

## Setup (local)

### 1. Install dependencies

```bash
cd mini-services/icbs-ticket-bot
bun install
```

(Bun is required — `bun --hot` is used for dev. Install it from <https://bun.sh>.)

### 2. Configure environment

```bash
cp .env.example .env
# edit .env and fill in the values
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Token for **this** bot (a different token from the news bot). |
| `DISCORD_GUILD_ID` | The server ID where the bot operates. |
| `TICKET_PANEL_CHANNEL_ID` | Channel where the panel message is posted. |
| `TICKET_LOG_CHANNEL_ID` | `#ticket-logs` channel — receives open/close logs + transcripts. |
| `TICKET_CATEGORY_ID` | Discord Channel Category that ticket channels are created under. |
| `TICKET_ADMIN_ROLE_ID` | Role with full access to ALL tickets. |
| `TICKET_STAFF_ROLE_IDS` | Comma-separated default staff roles (per-category roles can override). |
| `ICBS_BOT_PORT` | HTTP port. Default `3040` (news bot uses `3030`). **Do NOT use `process.env.PORT`** — that belongs to the Next.js web service on Render and will cause `EADDRINUSE`. |
| `ICBS_WEBHOOK_SECRET` | Shared secret with the web app — must match the web app's `ICBS_WEBHOOK_SECRET`. Used to authenticate `POST /setup-panel`. |

Optional:

| Variable | Purpose |
| --- | --- |
| `ICBS_BRAND_ICON_URL` | Icon used in embed author/footer. |
| `TICKET_CATEGORY_ROLES` | JSON map of category id → staff role id (overrides `TICKET_STAFF_ROLE_IDS` per category). |

### 3. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Add a **Bot**. Copy the token into `DISCORD_BOT_TOKEN`.
3. Under **Privileged Gateway Intents**, enable:
   - **SERVER MEMBERS INTENT** (per-user permission management)
   - **MESSAGE CONTENT INTENT** (transcripts)
   - (Presence intent is optional.)
4. Invite URL (OAuth2 → URL Generator):
   - Scopes: `bot`, `applications.commands`
   - Permissions: Manage Channels, Manage Roles, Manage Messages, Send Messages, Embed Links, Attach Files, Read Message History, View Channels, Add Reactions.

### 4. Create the Discord-side channels & roles

- Channel `#ticket-panel` → copy ID → `TICKET_PANEL_CHANNEL_ID`
- Channel `#ticket-logs` → copy ID → `TICKET_LOG_CHANNEL_ID`
- Channel Category `Tickets` → copy ID → `TICKET_CATEGORY_ID`
- Role `Ticket Admin` → copy ID → `TICKET_ADMIN_ROLE_ID`
- Roles `Support Staff`, `Billing`, `Partnerships`, … → comma-joined → `TICKET_STAFF_ROLE_IDS`

(Enable Developer Mode in Discord → Settings → Advanced to copy IDs.)

### 5. Run it

```bash
bun run dev     # hot-reload dev mode
bun run start   # production
```

You should see:

```
[ticket-bot] 🌐 HTTP server listening on http://localhost:3040
[ticket-bot]    GET  /health
[ticket-bot]    POST /setup-panel   (auth: x-icbs-secret)
[ticket-bot] ✅ Logged in as ...
[ticket-bot] ✅ Ready. Listening on port 3040
```

### 6. Post the ticket panel

Either:

- Call `POST http://localhost:3040/setup-panel` with header `x-icbs-secret: <your-secret>` and body:
  ```json
  {
    "title": "𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Support Desk",
    "description": "Select a category below to open a private support ticket with our staff team.",
    "categories": [
      { "id": "general", "emoji": "🟥", "label": "General Support", "description": "Anything not listed below.", "color": 4881459 },
      { "id": "bug",     "emoji": "🟧", "label": "Bug Report",     "description": "Report a bug.",                  "color": 15102754 }
    ]
  }
  ```
- **Or** use the dashboard's "Ticket Panel Setup" form (see below) which calls the same endpoint via the web app.

---

## HTTP API

### `GET /health`

Always returns 200. Used by the Next.js dashboard's status panel and by UptimeRobot (via the web app's `/api/ticket-ping` route).

```json
{
  "ok": true,
  "service": "icbs-ticket-bot",
  "mode": "live",
  "ready": true,
  "uptime": 12.34,
  "bot": { "tag": "ICBS Ticket#1234", "id": "..." },
  "guild": { "id": "...", "name": "ICBS" },
  "configured": {
    "discordToken": true, "guildId": true, "panelChannel": true,
    "logChannel": true, "ticketCategory": true, "adminRole": true,
    "staffRoles": 2, "webhookSecret": true
  },
  "stats": {
    "totalTickets": 17, "openTickets": 2, "closedTickets": 15,
    "nextTicketId": 18, "categories": 6
  },
  "panel": { "messageId": "...", "channelId": "..." }
}
```

### `POST /setup-panel`

Auth: header `x-icbs-secret: <ICBS_WEBHOOK_SECRET>`.

Body (all optional — defaults are used if omitted):

```json
{ "title": "...", "description": "...", "categories": [ { "id": "...", "emoji": "...", "label": "...", "description": "...", "color": 0, "staffRoleId": "..." } ] }
```

Returns `{ ok, messageId, channelId }` or `{ ok: false, error }`.

---

## Deployment (Render)

This service deploys exactly like the news bot. Two supported patterns:

### Option A — Detached child of the Next.js web service (recommended)

This is the simplest and matches the news bot:

1. The Next.js web service on Render starts normally.
2. The first time the dashboard hits `/api/ticket-health` (or any `ticket-*` route), the web app's `src/lib/ticket-client.ts` spawns this bot as a detached child process via `bun mini-services/icbs-ticket-bot/index.ts`.
3. The child keeps running alongside the web service until the parent exits.

This means you do **not** need to create a separate Render service — just make sure:

- The repo has Bun available in the Render environment (the existing Dockerfile already installs it for the news bot).
- The ticket bot's env vars (`DISCORD_BOT_TOKEN` for the **ticket** bot, channel/role IDs, `ICBS_WEBHOOK_SECRET` matching the web app) are set on the **web service** in the Render dashboard (the child inherits them).

### Option B — Second Render service

If you'd rather run the ticket bot as its own Render service:

1. Create a new **Background Worker** (or **Web Service**) on Render.
2. Build command: `cd mini-services/icbs-ticket-bot && bun install`
3. Start command: `bun mini-services/icbs-ticket-bot/index.ts`
4. Set all env vars from `.env.example` on this new service.
5. Set `ICBS_TICKET_BOT_URL` on the **web service** to point at this new service's internal URL (e.g. `https://icbs-ticket-bot.onrender.com`).

### Keep-alive

UptimeRobot should hit the **web app's** public `/api/ticket-ping` route (which in turn calls the bot's `/health`). That keeps both services warm.

```
https://your-web-app.onrender.com/api/ticket-ping
```

---

## Web dashboard integration

The Next.js web app talks to this bot via `src/lib/ticket-client.ts`, which exposes:

- `ensureTicketBotRunning()` — spawns the bot as a detached child if running in dev/combined mode; no-op if `ICBS_TICKET_BOT_URL` is set (split-deploy mode).
- `getTicketBotHealth()` — calls `GET /health`.
- `setupPanel(opts)` — calls `POST /setup-panel` with the secret header.

API routes the dashboard uses:

- `GET  /api/ticket-health` (authed) → proxies to the bot's `/health`.
- `GET  /api/ticket-ping` (public) → returns 200 if the bot answered `/health`, else 503. Used by UptimeRobot.
- `POST /api/ticket-setup` (authed) → proxies to the bot's `/setup-panel`.

---

## Notes for maintainers

- **State** lives in `tickets.json` (auto-created next to `index.ts`). It stores the ticket count, all ticket records, and the panel message ID. The file is rewritten every 15s and on every state change.
- **Cooldowns** (60s/user, 3 open tickets/user) are in-memory only and reset on restart — that's intentional.
- **Reopen window** is 60s after close; during that window, the channel still exists and the reopen button works. After deletion the ticket record is kept (for stats) but `channelId` is set to `null`.
- **Transcripts** fetch the last 100 messages, oldest first, and skip the ticket-opening embed itself.
- All embeds use the special italic Unicode letters (`𝑇ℎ𝑒 𝐼𝐶𝐵𝑆`) for branding, matching the news bot.
- Every interaction handler is wrapped in `try/catch` — the bot never crashes on a bad interaction.
- The bot **never** responds to its own messages (filtered in the `MessageCreate` listener).
