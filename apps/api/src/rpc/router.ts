import type { RouterClient } from '@orpc/server'
import { z } from 'zod'

import { activitiesRouter } from './activities'
import { authed, base } from './base'
import { excludedDaysRouter } from './excluded-days'
import { settingsRouter } from './settings'
import { statsRouter } from './stats'
import { switchesRouter } from './switches'

export const router = {
  ping: base.handler(() => ({ ok: true, now: new Date().toISOString() })),
  // Explicit output: columns Better Auth adds to `user` later must not reach clients by accident.
  me: authed
    .output(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.email(),
        emailVerified: z.boolean(),
        image: z.string().nullish(),
      }),
    )
    .handler(({ context }) => context.user),
  activities: activitiesRouter,
  switches: switchesRouter,
  stats: statsRouter,
  excludedDays: excludedDaysRouter,
  settings: settingsRouter,
}

/** Type-only contract for apps/app; importing the value would pull server code into Metro. */
export type AppRouter = typeof router
/** Client-side shape of {@link AppRouter}; exported here so apps/app never depends on @orpc/server itself. */
export type AppRouterClient = RouterClient<AppRouter>
