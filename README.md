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

### Styling (Uniwind + Tailwind v4)

`src/global.css` is the only place the app spells a colour: the design-system tokens (`design-system/styles.css`, `theme.json`) are re-declared there as Tailwind theme variables, both bands under `@layer theme` with `@variant dark` / `@variant light`, and the web-only overrides under `@variant web`. Uniwind compiles that file inside Metro (`metro.config.js`, no native code, so Expo Go works) and gives every React Native component a `className`; `uniwind.d.ts` supplies the prop types because `tsc` runs without Metro (Metro regenerates the same file as the gitignored `uniwind-types.d.ts`). Activity colours are data (`activities.color`, always a palette entry), so components receive them as `style` values, never as classes. Ticking digits take the `tabular` utility. `components.json` + `src/lib/utils.ts` (`cn`) are the React Native Reusables set-up; its CLI only scaffolds new projects, so components are vendored by hand into `src/components/ui` when first used. `pnpm --filter app audit:web` (also in the Build workflow) fails the web export on CSS react-native-web cannot draw (`grid`, `sticky`, `backdrop-filter`, `filter`, gradients, pseudo-elements) and on any hex colour outside `theme.json`.

### Data layer (oRPC + TanStack Query + Redux Toolkit)

- `src/lib/orpc.ts` builds the typed oRPC client from `AppRouterClient` (a type-only import from `@switch-time/api`, so Metro never bundles server code) and exposes `orpc.<procedure>.queryOptions()` for TanStack Query. Server data lives in TanStack Query only; it is never copied into Redux.
- `EXPO_PUBLIC_API_ORIGIN` selects the API origin: unset means `http://localhost:8080` in dev and same-origin (`''`) in the production web build. For a physical device point it at the machine's LAN IP, e.g. `EXPO_PUBLIC_API_ORIGIN=http://192.168.1.10:8080 pnpm --filter app dev`.
- `src/store` holds client-only state: `clock` (ticks every second while the app is active, pauses in background), `ui` (open sheet, selected day) and `preferences` (theme `auto|light|dark` resolved by `resolveTheme`, `showSecondHand`). Components use `useAppSelector` / `useAppDispatch` from `@/store`; the root layout runs `useClock` and `useThemeSync`.
- `/debug` (dev only) renders the `ping` query and the clock. `pnpm --filter app test` runs the Vitest unit tests in `src/**/*.test.ts`.

### Auth (Better Auth client)

- `src/lib/auth-client.ts`: `createAuthClient` from `better-auth/react`; on native the Expo plugin keeps the session in `expo-secure-store` and `src/lib/orpc.ts` replays it as a `Cookie` header, on web the first-party cookie does the work.
- Route groups: `(auth)/sign-in`, `(auth)/sign-up` (Zod schemas `signInSchema` / `signUpSchema` from `@switch-time/shared`, first issue per field inline, Better Auth's message above the form) and `(app)/…` guarded in `(app)/_layout.tsx`: anonymous visitors are redirected to `/sign-in?next=<path>` and return there after signing in. `useSignOut` ends the session, clears the TanStack cache, dispatches `resetApp` and shows sign-in.
- Playwright (web): `pnpm --filter app test:e2e` exports the site with `EXPO_PUBLIC_API_ORIGIN=http://localhost:8080`, then serves it on :8081 next to the API bundle (`node ../api/dist/server.js`, reused when the Compose API already listens on :8080). CI runs the same in the `e2e` job with a Postgres service.

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

## Deploy (DigitalOcean App Platform)

One app, region `sgp` (no Tokyo region; ≈ 75–80 ms from Tokyo), described by `.do/app.yaml`:

| Component        | Kind               | Source                                          | Route                        |
| ---------------- | ------------------ | ----------------------------------------------- | ---------------------------- |
| `api`            | Docker service     | `apps/api/Dockerfile`, context `/`              | `/api` (prefix preserved)    |
| `db-migrate`     | `PRE_DEPLOY` job   | same image, `node dist/db/migrate.js`           | —                            |
| `web`            | static site        | `pnpm --filter app build:web` → `apps/app/dist` | `/` (catch-all `index.html`) |
| `switch-time-pg` | Managed PostgreSQL | attached by `cluster_name`                      | —                            |

`/` and `/api` share one origin, so the Better Auth cookie is first-party and CORS stays off. The web export is a single-page bundle (`web.output: "single"`) so deep links such as `/history` resolve through the catch-all on any static host. `doctl apps spec validate --schema-only .do/app.yaml` checks the spec without a token.

First deploy (needs the team's DigitalOcean token):

1. `brew install doctl && doctl auth init && doctl account get`
2. Database: `doctl databases options versions --engine pg`, then `doctl databases create switch-time-pg --engine pg --version <newest> --region sgp1 --size db-s-1vcpu-2gb --num-nodes 1`, `doctl databases db create <cluster-id> switchtime`, `doctl databases user create <cluster-id> switchtime_app`. Pin `compose.yaml` to the same major.
3. App: `doctl apps create --spec .do/app.yaml`, authorise the GitHub repository in the DigitalOcean console on first use, then set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) under the app's environment variables. Run `doctl apps spec get <app-id> > .do/app.yaml` afterwards so the committed spec carries the encrypted secret; never put the plaintext in the file.
4. Verify: the deployment log shows `db-migrate` running the Drizzle migrations, `curl https://<app>.ondigitalocean.app/api/healthz` returns `{"status":"ok"}`, `/api/auth/ok` answers through the ingress, and `/` renders the web build.

After that every push to `main` builds `api` and `web`, runs the migration job and deploys (`deploy_on_push: true`). Alerts fire on `DEPLOYMENT_FAILED` and `DOMAIN_FAILED`.

## Conventions

- **React Compiler is on.** `apps/app` sets `experiments.reactCompiler: true` explicitly (the SDK 57 template ships it; the SDK itself defaults to off). Lint uses `eslint-plugin-react-hooks@7` (compiler rules included) and the "React Compiler Setup" of `@laststance/react-next-eslint-plugin`, so do not hand-write `useMemo`/`useCallback`/`React.memo`.
- **Design tokens come from `design-system/theme.json`.** Change the JSON first, then `packages/shared`; `packages/shared/src/activity-palette.test.ts` fails when they drift.
- **Dependencies are pinned** and `minimumReleaseAge: 1440` refuses releases younger than 24h. New install scripts must be allow-listed in `pnpm-workspace.yaml#allowBuilds`.
- Tests: `test` over `it`, AAA comments, hard-coded expected values, names describe observable behaviour.

## CI

Separate GitHub Actions workflows (Lint, TypeCheck, Format, Test, Build, Fallow, Security, Scorecard) mirror `pnpm check`; all actions are pinned to commit SHAs and run with read-only tokens. Security = CodeQL + Dependency Review + `pnpm audit --prod`. Build also runs `docker build -f apps/api/Dockerfile .` (the App Platform image, never pushed). Dependabot opens one grouped npm PR and one grouped Actions PR weekly (Monday 09:00 JST, two-day cooldown to clear `minimumReleaseAge`). A ruleset on `main` requires a pull request, the `build`, `docker`, `lint`, `typecheck`, `format`, `test`, `dupes`, `dead-code` and `health` checks, and blocks force-pushes and deletion.
