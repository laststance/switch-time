# Switch Time

Tap to switch what you are doing; the app keeps the clock. Universal Expo app (Web first, iOS/Android later) with a Hono + oRPC API on DigitalOcean.

Roadmap and decisions live in the epic [#1](https://github.com/laststance/switch-time/issues/1). Design sources live in `design/` (pen.dev file is the source of truth) and `design-system/` (`styles.css` + `theme.json`); the app never reformats or lints them.

## Workspace

| Path              | Package               | Purpose                                                                                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/app`        | `@switch-time/app`    | Expo SDK 57 universal app (placeholder until MVP-06, [#7](https://github.com/laststance/switch-time/issues/7))               |
| `apps/api`        | `@switch-time/api`    | Hono + oRPC + Better Auth + Drizzle API (placeholder until MVP-02, [#3](https://github.com/laststance/switch-time/issues/3)) |
| `packages/shared` | `@switch-time/shared` | Activity palette, default activities and Zod schemas shared by app and API; pinned to `design-system/theme.json` by tests    |

## Prerequisites

- Node.js `24.20.0` (`.node-version`; use fnm/nodenv/Volta)
- pnpm `12.3.4` — pinned in `packageManager`; any pnpm ≥ 10 (or Corepack) switches to it automatically

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

## Conventions

- **React Compiler is on.** `apps/app` keeps `experiments.reactCompiler: true` (Expo SDK 57 default). Lint uses `eslint-plugin-react-hooks@7` (compiler rules included) and the "React Compiler Setup" of `@laststance/react-next-eslint-plugin`, so do not hand-write `useMemo`/`useCallback`/`React.memo`.
- **Design tokens come from `design-system/theme.json`.** Change the JSON first, then `packages/shared`; `packages/shared/src/activity-palette.test.ts` fails when they drift.
- **Dependencies are pinned** and `minimumReleaseAge: 1440` refuses releases younger than 24h. New install scripts must be allow-listed in `pnpm-workspace.yaml#allowBuilds`.
- Tests: `test` over `it`, AAA comments, hard-coded expected values, names describe observable behaviour.

## CI

Separate GitHub Actions workflows (Lint, TypeCheck, Format, Test, Build, Fallow, Security, Scorecard) mirror `pnpm check`; all actions are pinned to commit SHAs and run with read-only tokens. Security = CodeQL + Dependency Review + `pnpm audit --prod`.
