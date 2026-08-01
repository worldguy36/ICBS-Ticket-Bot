# 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡

Advanced Discord ticket system for the **ICBS** server. Standalone micro-service that mirrors the architecture of **𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑚𝑒𝑠** news bot — same shape (discord.js v14 + tiny HTTP server + demo-mode fallback), different domain logic.

Users pick a category from a panel → a private channel is created → staff claim/close/reopen → transcripts are saved.

---

## Repo layout

```
.
├── mini-services/
│   └── icbs-ticket-bot/         # the standalone bot service
│       ├── index.ts             # discord.js client + HTTP server + all ticket logic
│       ├── package.json         # discord.js v14, dotenv; scripts: dev (bun --hot), start
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
│   └── smoke-test-ticket-bot.sh # demo-mode smoke test
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
| GET    | `/health`      | none                | Status JSON — used by dashboard + ping.  |
| POST   | `/setup-panel` | `x-icbs-secret` hdr | Create / post the ticket panel message.  |

## Deployment (Render)

See [`mini-services/icbs-ticket-bot/README.md`](mini-services/icbs-ticket-bot/README.md) for the full Render deployment guide. TL;DR:

- **Option A (recommended)** — spawn the bot as a detached child of the Next.js web service. No separate Render service needed. The first `/api/ticket-health` call spawns it.
- **Option B** — run the bot as its own Render Background Worker. Set `ICBS_TICKET_BOT_URL` on the web service to point at it.
- Keep-alive: UptimeRobot → `https://your-web-app.onrender.com/api/ticket-ping`.

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
