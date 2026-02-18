# ── mdpage Dockerfile ────────────────────────────────────────────────────────
#
# Multi-stage build: build the React frontend, then package server + dist.
#
# Build:
#   docker build -t mdpage .
#
# Run (basic):
#   docker run -p 3456:3456 -v $(pwd)/data:/app/data mdpage
#
# Run with docker-compose (recommended):
#   docker-compose up
#
# Environment variables (see API.md for full list):
#   PORT                   Server port (default 3456)
#   NODE_ENV               Set to "production" for prod mode
#   LC_MIN_AGE_DAYS        Days before free post enters lifecycle evaluation (default 30)
#   LC_UNIQUE_VIEW_THRESHOLD  Min 30-day views to stay healthy (default 10)
#   LC_AT_RISK_WINDOW_DAYS Days before expiry once at-risk (default 7)
#   LIFECYCLE_INTERVAL_MS  Sweep interval in ms (default 86400000 = 24h)
#   RATE_PUBLISH_MAX       Max publish req/IP/window (default 5)
#   RATE_PUBLISH_WIN       Publish window in seconds (default 3600)
#   RATE_VIEW_MAX          Max view req/IP/window (default 60)
#   RATE_VIEW_WIN          View window in seconds (default 60)
#   LOG_LEVEL              Log level: debug|info|warn|error (default info in prod)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps (leverage layer cache)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Non-root user for security
RUN addgroup -S mdpage && adduser -S mdpage -G mdpage

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server source and built frontend
COPY server.js ./
COPY lib/ ./lib/
COPY --from=builder /app/dist ./dist/

# Data directory — mount a volume here in production to persist articles
RUN mkdir -p /app/data/articles /app/data/views && \
    chown -R mdpage:mdpage /app/data

USER mdpage

EXPOSE 3456

ENV NODE_ENV=production
ENV PORT=3456

# Liveness probe used by Docker healthcheck and docker-compose
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
