# ── Stage 1: Build pipeline TypeScript (src/ → dist/) ─────────────────
FROM node:22-alpine AS pipeline-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npx tsc

# ── Stage 2: Build Vite client (web/client/ → dist/client/) ───────────
FROM node:22-alpine AS client-build
WORKDIR /app
COPY package*.json vite.config.ts ./
RUN npm ci
COPY web/client/ ./web/client/
# Include src/ for TypeScript imports from client code
COPY src/ ./src/
RUN npx vite build

# ── Stage 3: Build server TypeScript (web/server/ → dist/server/) ─────
FROM node:22-alpine AS server-build
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.server.json ./
RUN npm ci
COPY src/ ./src/
COPY web/server/ ./web/server/
RUN npx tsc -p tsconfig.server.json

# ── Stage 4: Runtime image ─────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled artifacts
COPY --from=pipeline-build /app/dist/ ./dist/
COPY --from=client-build   /app/dist/client/ ./dist/client/
COPY --from=server-build   /app/dist/server/ ./dist/server/

# Data directory for SQLite — owned by the non-root `node` user that
# ships with the official node:alpine image. Running the container as
# root is an unnecessary privilege bump; a compromise of the express
# process should not give an attacker UID 0 inside the container.
RUN mkdir -p /data && chown -R node:node /data /app

ENV PORT=3000 \
    DB_PATH=/data/reviews.db \
    NODE_ENV=production

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

VOLUME ["/data"]

USER node

CMD ["node", "dist/server/web/server/index.js"]
