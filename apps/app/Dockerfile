# syntax=docker/dockerfile:1
# Build context is the repository root: `docker build -f apps/app/Dockerfile .`
# App Platform builds the `web` static site from this file and copies /repo/apps/app/dist out of the image (.do/app.yaml):
# its Node.js buildpack runs `pnpm install --prod=false`, which pnpm 12 rejects (pnpm/pnpm#14553), so buildpacks are out.

FROM node:24-slim
# HUSKY=0 skips the root `prepare` hook; CI=true makes pnpm and Expo non-interactive.
ENV CI=true HUSKY=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
# The app's devDependency on the api (router types) keeps apps/api in the install set.
COPY apps/api ./apps/api
COPY apps/app ./apps/app
# `audit:web` reads the design tokens.
COPY design-system/theme.json ./design-system/theme.json
RUN pnpm install --frozen-lockfile --filter @switch-time/app...
# Same-origin API: EXPO_PUBLIC_API_ORIGIN stays unset, so the export falls back to '' (apps/app/src/lib/env.ts).
RUN pnpm --filter @switch-time/app build:web && pnpm --filter @switch-time/app audit:web
