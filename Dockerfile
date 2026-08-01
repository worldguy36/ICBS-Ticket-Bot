# =============================================================================
# Dockerfile — 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡
# ----------------------------------------------------------------------------
# Backup deploy method for Render (or any container host).
# Render's native Bun runtime is preferred (see render.yaml), but if you'd
# rather deploy via Docker, set:
#   - Runtime: Docker
#   - Dockerfile path: ./Dockerfile
# =============================================================================

# Bun's official image — small + fast + matches the local dev runtime.
FROM oven/bun:1.1 AS base

WORKDIR /app

# Install deps first (cached layer)
COPY package.json ./
# If you commit bun.lock, copy it too for reproducible installs:
# COPY bun.lock ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy the rest of the source
COPY . .

# Render sets PORT automatically; the bot reads process.env.PORT.
# Default to 10000 to match Render's default if PORT isn't set.
ENV PORT=10000
ENV NODE_ENV=production

# Bun runs the bot directly — no transpile step needed.
EXPOSE 10000

# Healthcheck: hit the root endpoint (returns 200 if alive).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 10000) + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "mini-services/icbs-ticket-bot/index.ts"]
