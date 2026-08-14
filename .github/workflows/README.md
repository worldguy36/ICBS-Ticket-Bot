# GitHub Actions Workflows

## `keep-alive.yml`

Pings the bot's `/uptime` endpoint every 5 minutes to prevent Render's free tier from spinning down the service after 15 minutes of inactivity.

### Cost

- **Public repos:** Free (unlimited minutes)
- **Private repos:** ~144 minutes/month used out of 2,000 free minutes (well within limit)

### Setup (one-time, 30 seconds)

1. Go to <https://github.com/worldguy36/ICBS-Ticket-Bot/settings/secrets/actions>
2. Click **New repository secret**
3. **Name:** `BOT_URL`
4. **Value:** `https://icbs-ticket-bot.onrender.com` (or your bot's URL — Render, Fly, Koyeb, etc.)
5. Click **Add secret**

### How it works

Every 5 minutes, GitHub Actions runs a tiny job that:
1. `curl`s `https://your-bot-url.onrender.com/uptime`
2. If it returns HTTP 200 with body `OK`, logs ✅ and exits
3. If it fails, waits 30 seconds (in case of cold start) and retries once
4. Also fetches `/health` and logs the bot's current status (mode, ready, ticket counts)

The 5-minute interval is well under Render's 15-minute spin-down threshold, so the service stays warm indefinitely.

### Manual trigger

To test the workflow without waiting for the next scheduled run:
1. Go to <https://github.com/worldguy36/ICBS-Ticket-Bot/actions/workflows/keep-alive.yml>
2. Click **Run workflow** (top right)
3. Click the green **Run workflow** button
4. Refresh — you'll see the run appear within a few seconds

### Viewing logs

1. Go to <https://github.com/worldguy36/ICBS-Ticket-Bot/actions>
2. Click on any **Keep Alive** run
3. Click the **ping** job
4. Expand the **Ping /uptime endpoint** step to see the curl output

### Stopping it

To pause the keep-alive:
1. Go to <https://github.com/worldguy36/ICBS-Ticket-Bot/actions/workflows/keep-alive.yml>
2. Click the **•••** menu (top right)
3. Click **Disable workflow**

To resume, click **Enable workflow**.

### Notes

- GitHub Actions cron is "best effort" — runs may be delayed a few minutes during peak load. For keep-alive purposes this is fine (a 5-min ping is well under Render's 15-min threshold).
- If you switch from Render to another host (Fly, Koyeb, etc.), just update the `BOT_URL` secret — no code changes needed.
- The workflow does NOT fail the build if the ping fails (it just logs a warning). This is intentional — we don't want GitHub alerting on every transient cold start.
