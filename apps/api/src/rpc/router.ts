import { os } from '@orpc/server'

// Per-request context handed to every procedure; MVP-05 reads the session from these headers.
const base = os.$context<{ headers: Headers }>()

export const router = {
  ping: base.handler(() => ({ ok: true, now: new Date().toISOString() })),
}

/** Type-only contract for apps/app; importing the value would pull server code into Metro. */
export type AppRouter = typeof router
