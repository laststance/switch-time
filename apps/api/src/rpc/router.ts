import { ORPCError, os, type RouterClient } from '@orpc/server'
import { z } from 'zod'

import { auth } from '../auth'

// Per-request context handed to every procedure; the session is read from these headers.
const base = os.$context<{ headers: Headers }>()

// Resolves the Better Auth session (cookie, or the bearer token the Expo client sends) once per call.
const withSession = base.use(async ({ context, next }) =>
  next({
    context: {
      session: await auth.api.getSession({ headers: context.headers }),
    },
  }),
)

// Builder for procedures that need a signed-in user; anonymous calls stop here.
const authed = withSession.use(({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

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
}

/** Type-only contract for apps/app; importing the value would pull server code into Metro. */
export type AppRouter = typeof router
/** Client-side shape of {@link AppRouter}; exported here so apps/app never depends on @orpc/server itself. */
export type AppRouterClient = RouterClient<AppRouter>
