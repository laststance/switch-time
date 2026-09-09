# Switch Time

Tap to switch what you are doing; the app keeps the clock. Universal Expo app (Web first, iOS/Android later) with a Hono + oRPC API on DigitalOcean.

Roadmap and decisions live in the epic [#1](https://github.com/laststance/switch-time/issues/1). Design sources live in `design/` (pen.dev file is the source of truth) and `design-system/` (`styles.css` + `theme.json`); the app never reformats or lints them.

## Workspace

| Path              | Package               | Purpose                                                                                                                                              |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app`        | `@switch-time/app`    | Expo SDK 57 universal app (Expo Router, `src/app/`), `expo export -p web` → `dist/` for the DigitalOcean static site                                 |
| `apps/api`        | `@switch-time/api`    | Hono 4 + oRPC 1.15 API: `GET /api/healthz`, RPC at `/api/rpc/*`, Better Auth at `/api/auth/*`, Drizzle ORM 1.0 RC + `pg`                             |
| `packages/shared` | `@switch-time/shared` | Activity palette, default activities and Zod schemas for app and API (consumed from MVP-08/MVP-13 on); pinned to `design-system/theme.json` by tests |

## Prerequisites

- Node.js `24.20.0` (`.node-version`; use fnm/nodenv/Volta)
- pnpm `12.3.4` — pinned in `packageManager`. pnpm 10+ downloads and runs the pinned version by default ([`pmOnFail: download`](https://pnpm.io/settings/cli#pmonfail)); if yours does not, install it explicitly with `npm install -g pnpm@12.3.4` or run `corepack enable`. CI installs it through `pnpm/setup` in `.github/actions/prepare`.
- Docker with Compose v2.24+ (`compose.yaml` uses `env_file: required: false`) — only for the local backend below

```sh
pnpm install --frozen-lockfile
pnpm check
```

## Scripts

| Command                                         | What it does                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                | `tsc` in every workspace package (TypeScript `~6.0.3`, same pin as Expo SDK 57)       |
| `pnpm lint`                                     | ESLint 10 flat config: `eslint-config-ts-prefixer` + React Compiler-aware React rules |
| `pnpm format:check`                             | Prettier (`singleQuote`, no semicolons); `pnpm format` writes                         |
| `pnpm test`                                     | Vitest in every package                                                               |
| `pnpm build`                                    | Every workspace `build` script (API bundle, `expo export -p web`) as they land        |
| `pnpm sherif`                                   | Monorepo hygiene (consistent dependency versions, private root, …)                    |
| `pnpm dead-code` / `pnpm dupes` / `pnpm health` | [Fallow](https://docs.fallow.tools) dead code, duplication and health checks          |
| `pnpm check`                                    | Everything above, in the order CI runs it                                             |

`git commit` runs `lint-staged` (Prettier on staged files) through Husky.

## Local backend

```sh
cp .env.example .env          # DATABASE_URL, TEST_DATABASE_URL, PORT, APP_ORIGIN, BETTER_AUTH_SECRET
pnpm dev:backend              # docker compose up --build: Postgres 18 + the API (tsx watch) on http://localhost:8080
pnpm db:psql                  # psql into the switchtime database
pnpm db:reset                 # docker compose down -v: drop the volume, next `up` starts from an empty database
```

`compose.yaml` builds the `dev` target of `apps/api/Dockerfile` and bind-mounts `apps/api/src`, so editing a file restarts the API inside the container. Postgres 18 matches the newest major DigitalOcean Managed Databases offers; `docker/postgres/init.sql` also creates `switchtime_test` for Vitest. Inside Compose the database host is `db` (set on the `api` service); `.env` keeps `localhost` so `pnpm --filter api dev` on the host reaches the same Postgres. `apps/api/src/env.ts` loads the repo-root `.env` when it exists, so every `pnpm --filter api …` script sees it.

### Database (Drizzle ORM 1.0 RC)

`drizzle-orm` and `drizzle-kit` are pinned to the same `1.0.0-rc.N` (no caret; re-pin deliberately). Driver is `pg`; `DATABASE_CA_CERT` (PEM) switches the pool to TLS for DigitalOcean Managed Postgres and is required when `NODE_ENV=production` (no silent fallback to plain TCP). Local Compose stays plain TCP: `compose.yaml` overrides `DATABASE_URL` for the container and therefore blanks `DATABASE_CA_CERT` too; on the host both come from the same `.env`, so keep them describing the same database.

```sh
pnpm --filter api db:generate   # schema (src/db/schema/*.ts) → SQL under apps/api/drizzle — review it, commit it
pnpm --filter api db:migrate    # tsx src/db/migrate.ts: the dev container runs it on start; App Platform's PRE_DEPLOY job runs the same script as `node dist/db/migrate.js`
pnpm --filter api db:check      # drizzle-kit check: migration folder consistency
pnpm --filter api db:studio     # Drizzle Studio against DATABASE_URL
```

`drizzle-kit push` is never run against production. Tests (`pnpm --filter api test`) need `TEST_DATABASE_URL`: the Vitest global setup migrates that database, every test starts by truncating every `public` table, and files run serially because they share the database. CI provides the database as a `postgres:18` service in `.github/workflows/test.yml`.

### Auth (Better Auth 1.7)

Email + password only, served by the same Hono process at `/api/auth/*` (`apps/api/src/auth.ts`): `@better-auth/drizzle-adapter/relations-v2` on the Drizzle instance, the `@better-auth/expo` server plugin, adapter writes in one transaction, `baseURL` = the API's own origin (`APP_ORIGIN` in production, `http://localhost:$PORT` otherwise), `trustedOrigins` = `APP_ORIGIN` plus `switchtime://` (and `exp://**` in development). Rate limiting keeps Better Auth's default (production only) and needs `advanced.ipAddress.trustedProxies` once deployed behind App Platform (MVP-09). `BETTER_AUTH_SECRET` is required (`openssl rand -base64 32`), and in production `APP_ORIGIN` must be `https://` (the cookie `Secure` flag derives from it). Every `/api/*` request body is capped at 100 KB.

- Auth tables come from the CLI, never by hand: `npx auth@1.7.3 generate --config src/auth.ts --output src/db/schema/auth.ts -y` (CLI pinned to the runtime version) (run from `apps/api`), then `pnpm --filter api db:generate` for the SQL.
- oRPC procedures read the session from the request headers (`src/rpc/router.ts`): `authed` procedures throw `UNAUTHORIZED` without one; `me` returns the current user.
- Dev cookies: `localhost:8081` → `localhost:8080` is same-site, so the defaults (`sameSite: lax`) work; the client sends `credentials: 'include'`. Production is same-origin (MVP-09).

## App (`apps/app`)

```sh
pnpm --filter app dev         # expo start (press i / a / w, or scan the QR code)
pnpm --filter app web         # expo start --web → http://localhost:8081
pnpm --filter app build:web   # expo export -p web → apps/app/dist (`build` aliases it, so `pnpm build` / CI run it too)
cd apps/app && npx expo-doctor
```

Scaffolded from `expo-template-default@sdk-57` (`src/app/` routes, typed routes, React Compiler); `create-expo-app` is broken on npm 12, so unpack the template tarball instead. Routes stay platform-UI only: no `expo-font`, no `fontFamily`. Expo packages are pinned like everything else, so `minimumReleaseAge` may hold them one patch behind what `expo-doctor` expects for a day — bump when the release is 24h old. `pnpm` isolated `node_modules` works with Metro here without `node-linker=hoisted`; `react-native-web` is reached through Metro's platform aliasing and is therefore listed in `.fallowrc.json#ignoreDependencies`. The app imports only `type { AppRouter }` from `@switch-time/api` (from MVP-08 on), which Metro erases.

## API (`apps/api`)

```sh
pnpm --filter api dev        # tsx watch, http://localhost:8080 (env is Zod-validated at boot: src/db/env.ts for the database, src/env.ts for the server)
curl localhost:8080/api/healthz
pnpm --filter api build      # tsdown → dist/server.js (workspace packages inlined, npm deps external)
docker build -f apps/api/Dockerfile -t switch-time-api .   # build context = repo root
# Joins the Compose network to reach its Postgres as `db` (the host port is loopback-only, unreachable from a container on Docker Engine).
# --env-file supplies BETTER_AUTH_SECRET; NODE_ENV=development because the image defaults to production, which refuses a database without DATABASE_CA_CERT.
docker run --rm --network switch-time_default -p 8080:8080 --env-file .env -e NODE_ENV=development -e DATABASE_CA_CERT= -e DATABASE_URL=postgres://switchtime:switchtime@db:5432/switchtime switch-time-api
```

The API owns the `/api` prefix (`/api/healthz`, `/api/rpc/*`, later `/api/auth/*`); App Platform ingress routes `/api` to it without stripping the prefix. CORS is enabled only outside production, for the Expo web dev server at `APP_ORIGIN` (default `http://localhost:8081`). `apps/app` imports only `type { AppRouter }` from `@switch-time/api`, so no server code reaches the Metro bundle.

## Conventions

- **React Compiler is on.** `apps/app` sets `experiments.reactCompiler: true` explicitly (the SDK 57 template ships it; the SDK itself defaults to off). Lint uses `eslint-plugin-react-hooks@7` (compiler rules included) and the "React Compiler Setup" of `@laststance/react-next-eslint-plugin`, so do not hand-write `useMemo`/`useCallback`/`React.memo`.
- **Design tokens come from `design-system/theme.json`.** Change the JSON first, then `packages/shared`; `packages/shared/src/activity-palette.test.ts` fails when they drift.
- **Dependencies are pinned** and `minimumReleaseAge: 1440` refuses releases younger than 24h. New install scripts must be allow-listed in `pnpm-workspace.yaml#allowBuilds`.
- Tests: `test` over `it`, AAA comments, hard-coded expected values, names describe observable behaviour.

## CI

Separate GitHub Actions workflows (Lint, TypeCheck, Format, Test, Build, Fallow, Security, Scorecard) mirror `pnpm check`; all actions are pinned to commit SHAs and run with read-only tokens. Security = CodeQL + Dependency Review + `pnpm audit --prod`.
