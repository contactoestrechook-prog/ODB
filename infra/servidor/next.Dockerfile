# Panel (apps/admin) y tienda (apps/web), Next.js, para el servidor propio.
# Contexto de compilación: la carpeta de la app. Fuera de la app por lo mismo
# que el del servidor (Railway no tiene que verlo).
FROM node:22-bookworm-slim AS compilar
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# el panel versiona sus estáticos con RAILWAY_DEPLOYMENT_ID (next.config.ts) y
# /api/version avisa «hay una actualización»: acá se usa el commit publicado
ARG VERSION=desconocida
ENV RAILWAY_DEPLOYMENT_ID=$VERSION RAILWAY_GIT_COMMIT_SHA=$VERSION NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG VERSION=desconocida
ENV NODE_ENV=production TZ=America/Argentina/Buenos_Aires NEXT_TELEMETRY_DISABLED=1 \
    RAILWAY_DEPLOYMENT_ID=$VERSION RAILWAY_GIT_COMMIT_SHA=$VERSION PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=compilar --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS -o /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["npx", "next", "start", "-p", "3000"]
