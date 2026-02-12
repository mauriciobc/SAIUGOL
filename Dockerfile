# Use Node.js 18 Alpine as the base image (minimal footprint)
# Alpine images are compatible with ARM32/v7 architectures
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy app source (respecting .dockerignore)
COPY src/ ./src/

# Create data directory for state persistence
RUN mkdir -p /app/data && chown -R node:node /app/data

# Volume for persistent state
VOLUME ["/app/data"]

# All env vars (defaults); override at runtime for secrets and per-environment.
# See repository-instructions.md and .env.example.
ENV MASTODON_INSTANCE=https://mastodon.social
ENV MASTODON_ACCESS_TOKEN=
ENV DEFAULT_LANGUAGE=pt-BR
ENV LEAGUE_CODES=bra.1
ENV POLL_INTERVAL_MS=60000
ENV DRY_RUN=false
ENV SPORTDB_API_KEY=
ENV STATE_DIR=/app/data
ENV TIMEZONE=America/Sao_Paulo
ENV ESPN_USE_PT_DESCRIPTIONS=true

# Use a non-root user for security
USER node

# Healthcheck - verify the process is still running
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "node.*index.js" || exit 1

# Start the bot
CMD ["npm", "start"]
