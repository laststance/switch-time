# syntax=docker/dockerfile:1
# Build context is the repository root: `docker build -f apps/api/Dockerfile .`

FROM node:24-slim AS deps
# HUSKY=0 skips the root `prepare` hook; CI=true makes pnpm non-interactive.
ENV CI=true HUSKY=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @switch-time/api...

# Local backend (compose.yaml): migrate, then tsx watch over the bind-mounted apps/api/src.
FROM deps AS dev
WORKDIR /repo/apps/api
EXPOSE 8080
CMD ["sh", "-c", "pnpm db:migrate && exec pnpm dev"]

FROM deps AS build
RUN pnpm --filter @switch-time/api build
# Self-contained copy with production node_modules only.
# `--legacy` keeps the workspace on symlinks in dev instead of requiring injectWorkspacePackages.
RUN pnpm deploy --filter @switch-time/api --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
# node:24-slim has no curl; fetch() is enough for the same-container probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? '8080') + '/api/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]
