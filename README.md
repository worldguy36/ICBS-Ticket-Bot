# 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡

Advanced Discord ticket system for the **ICBS** server. Standalone micro-service that mirrors the architecture of **𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑚𝑒𝑠** news bot — same shape (discord.js v14 + tiny HTTP server + demo-mode fallback), different domain logic.

Users pick a category from a panel → a private channel is created → staff claim/close/reopen → transcripts are saved.

---

## Repo layout

```
.
├── package.json                 # ROOT — deps + start script (Render deploys from here)
├── render.yaml                  # Render Blueprint — one-click deploy
├── Dockerfile                   # Backup deploy method (Docker runtime)
├── .dockerignore
├── bun.lock                     # lockfile for reproducible installs
├── mini-services/
│   └── icbs-ticket-bot/         # the standalone bot service
│       ├── index.ts             # discord.js client + HTTP server + all ticket logic
│       ├── package.json         # for local dev inside the folder
│       ├── .env.example         # template — copy to .env and fill in
│       └── README.md            # full bot setup + deployment docs
├── src/                         # Next.js web-app integration (drop into your existing app)
│   ├── lib/
│   │   └── ticket-client.ts     # ensureTicketBotRunning / getTicketBotHealth / setupPanel
│   └── app/
│       ├── api/
│       │   ├── ticket-health/   # authed GET → bot's /health
│       │   ├── ticket-ping/     # PUBLIC GET → 200/503 (for UptimeRobot)
│       │   └── ticket-setup/    # authed POST → bot's /setup-panel
│       └── page.tsx             # dashboard with Ticket Bot Status + Panel Setup form
├── scripts/
│   ├── smoke-test-ticket-bot.sh # demo-mode smoke test
│   ├── discover-guild.ts        # list guild channels + roles, auto-detect IDs
│   ├── setup-guild.ts           # create Discord resources + write IDs to .env
│   └── test-render-mode.sh      # verify the bot works with PORT env (Render mode)
├── worklog.md                   # build/deploy log
└── .gitignore
```

## Quick start

```bash
# 1. Install + configure the bot
cd mini-services/icbs-ticket-bot
bun install
cp .env.example .env
# edit .env — fill in DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, channel IDs, role IDs, ICBS_WEBHOOK_SECRET

# 2. Run it
bun run dev     # hot-reload dev mode
# or
bun run start   # production

# 3. Post the ticket panel (once the bot is READY)
curl -X POST http://localhost:3040/setup-panel \
  -H "x-icbs-secret: $ICBS_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
# → posts the default 6-category panel to your TICKET_PANEL_CHANNEL_ID

# 4. (Optional) Wire up the dashboard
#    Copy src/lib/ticket-client.ts and src/app/api/ticket-*/ into your Next.js app.
#    Set ICBS_WEBHOOK_SECRET on the web app to match the bot's.
#    Set ICBS_TICKET_BOT_URL on the web app if the bot is deployed separately.
```

## Features

- **Ticket panel**: embed + Discord **String Select Menu** in `#ticket-panel`.
- **6 default categories**: 🟥 General · 🟧 Bug Report · 🟨 Billing/Nitro · 🟩 Partnership · 🟦 Staff Application · 🟪 Ban Appeal (each with own emoji, color, and staff role).
- **Per-ticket channels** under a Discord Channel Category with strict permissions.
- **Buttons**: 📋 Claim · 🔒 Close · 🔴 Close with Reason (modal) · ↩️ Reopen (60-second window before deletion).
- **Transcripts** saved as `.txt`, posted to `#ticket-logs` and DM'd to the opener.
- **Cooldowns**: 1 ticket / 60s / user; max 3 open tickets per user.
- **`/ticket-stats`** slash command (staff only): total / open / closed / avg-close-time / per-category breakdown.
- **State** persisted to `tickets.json` — survives restarts.
- **Demo mode**: when `DISCORD_BOT_TOKEN` is unset, the Discord client does NOT connect but the HTTP server still runs (dashboard shows "DEMO" badge).

## HTTP API (the bot itself)

| Method | Path           | Auth                | Purpose                                  |
|--------|----------------|---------------------|------------------------------------------|
| GET    | `/`            | none                | Tiny 200 — Render's default health check.|
| GET    | `/ping`        | none                | Lightweight status — for UptimeRobot.    |
| GET    | `/health`      | none                | Full status JSON — used by dashboard.    |
| POST   | `/setup-panel` | `x-icbs-secret` hdr | Create / post the ticket panel message.  |

## Deployment on Render (as a Web Service)

The bot runs as a **standalone Render Web Service**. It binds to `0.0.0.0:$PORT` (Render sets `PORT` automatically) and exposes `/` for Render's default health check.

### Option A — One-click Blueprint (recommended)

1. Push this repo to GitHub (already done: <https://github.com/worldguy36/ICBS-Ticket-Bot>).
2. Go to <https://dashboard.render.com/blueprints> and click **New Blueprint Instance**.
3. Select the `worldguy36/ICBS-Ticket-Bot` repo. Render reads `render.yaml` and creates the service automatically.
4. You'll be prompted for two secrets:
   - `DISCORD_BOT_TOKEN` — your bot token
   - `ICBS_WEBHOOK_SECRET` — any random string (used to auth `/setup-panel` calls)
5. The other env vars (guild ID, channel IDs, role IDs) are pre-filled in `render.yaml` from your Discord server.
6. Click **Apply**. Render builds + deploys. First deploy takes ~1 min.
7. Once live, your bot is at `https://icbs-ticket-bot.onrender.com` (or your chosen subdomain).

### Option B — Manual setup via Render dashboard

1. Go to <https://dashboard.render.com> → **New +** → **Web Service**.
2. Connect your GitHub repo `worldguy36/ICBS-Ticket-Bot`.
3. Configure:
   - **Runtime:** Bun
   - **Build Command:** `bun install`
   - **Start Command:** `bun mini-services/icbs-ticket-bot/index.ts`
   - **Health Check Path:** `/` (the root endpoint returns 200)
   - **Plan:** Free (or paid for always-on)
4. Add environment variables (see `render.yaml` for the full list — copy all of them into the Render dashboard).
5. Click **Create Web Service**.

### Option C — Docker runtime (fallback)

If Render's native Bun runtime has issues, switch the service runtime to **Docker** and leave the `Dockerfile` at the repo root. Render will build + run it.

### Keeping it awake (Free plan)

Render's Free plan spins down after 15 min of inactivity. To keep the bot awake:

1. Sign up at <https://uptimerobot.com> (free).
2. Add an HTTP monitor:
   - URL: `https://icbs-ticket-bot.onrender.com/ping`
   - Interval: 5 minutes
3. UptimeRobot will ping every 5 min, keeping the service warm.

### Posting the ticket panel

Once the service is live, post the ticket panel to your `#ticket-panel` Discord channel:

```bash
curl -X POST https://icbs-ticket-bot.onrender.com/setup-panel \
  -H "x-icbs-secret: YOUR_ICBS_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

(Use `{}` for the default 6-category panel, or pass a custom body — see `mini-services/icbs-ticket-bot/README.md`.)

### Checking status

- `GET https://icbs-ticket-bot.onrender.com/` — tiny status (Render health check).
- `GET https://icbs-ticket-bot.onrender.com/health` — full status JSON with config checks + ticket stats.
- `GET https://icbs-ticket-bot.onrender.com/ping` — lightweight, for UptimeRobot.

## Discord setup

1. Create a Discord application at <https://discord.com/developers/applications> → add a Bot.
2. Enable **Privileged Gateway Intents**: Server Members + Message Content.
3. Invite with scopes `bot` + `applications.commands` and permissions: Manage Channels, Manage Roles, Manage Messages, Send Messages, Embed Links, Attach Files, Read Message History, View Channels, Add Reactions.
4. Create the Discord-side resources: `#ticket-panel` channel, `#ticket-logs` channel, `Tickets` channel category, `Ticket Admin` role, `Support Staff` role(s).
5. Copy their IDs into `.env`.

## Branding

All user-facing text uses the special italic Unicode letters (`𝑇ℎ𝑒 𝐼𝐶𝐵𝑆`) — same convention as the news bot. Embed author: `𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡`. Footer: `𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 — Support Delivered`.

## License

UNLICENSED — private to the ICBS project.
