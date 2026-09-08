import { DEFAULT_ACTIVITIES } from '@switch-time/shared'

// Placeholder entry: MVP-02 (#3) replaces this with the Hono + oRPC server.
// It imports the shared package on purpose so `pnpm typecheck` proves the workspace wiring.
export const seedActivityCount = DEFAULT_ACTIVITIES.length
