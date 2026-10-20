# syntax=docker/dockerfile:1
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# Install only production dependencies. package-lock.json pins exact versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# All app data (SQLite database and uploaded files) is written to /data.
# docker-compose.yml bind-mounts a host folder there, so the data survives restarts and image upgrades.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
