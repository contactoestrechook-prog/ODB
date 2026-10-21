# Servidor de ODB (NestJS) para el servidor propio (21/10/2026).
# Contexto de compilación: apps/api. Vive fuera de apps/api a propósito: si
# hubiera un Dockerfile ahí, Railway lo usaría y cambiaría cómo compila hoy.
FROM node:22-bookworm-slim AS compilar
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=America/Argentina/Buenos_Aires
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# las tarjetas y los PDF leen las fuentes de node_modules (process.cwd())
COPY --from=compilar --chown=node:node /app/node_modules ./node_modules
COPY --from=compilar --chown=node:node /app/dist ./dist
COPY --from=compilar --chown=node:node /app/package.json ./
ARG VERSION=desconocida
ENV ODB_VERSION=$VERSION
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3001/salud || exit 1
CMD ["node", "dist/main.js"]
