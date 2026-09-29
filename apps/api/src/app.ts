import { onError, ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { DrizzleQueryError } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'

import { auth } from './auth'
import { requestDeadline, startRequestClock } from './db/client'
import { env } from './env'
import { mailer } from './mail'
import { router } from './rpc/router'

const rpc = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      // 4xx (UNAUTHORIZED, BAD_REQUEST, …) is the client's problem and already in the response body.
      if (error instanceof ORPCError && error.status < 500) return
      // DrizzleQueryError.message embeds the SQL and its params (session tokens); the driver error is enough.
      const cause =
        error instanceof DrizzleQueryError && error.cause instanceof Error
          ? error.cause
          : error
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'rpc',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }),
  ],
})

export const app = new Hono()

// Nothing here takes a body bigger than a small JSON document; without this, Node/Hono accept unbounded bodies on the unauthenticated auth routes.
// ponytail: raise (or scope per route) when an upload endpoint appears.
// `DAY_ROWS_MAX` and `UNDO_ROWS_MAX` (packages/shared) are sized so the largest 「元に戻す」 fits; app.test.ts sends those requests through this limit.
app.use('/api/*', bodyLimit({ maxSize: 100 * 1024 }))

// App Platform puts its CDN in front of the whole app once a static site is attached; a cached session response would leak
// between users, so every API response opts out.
app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

// Dev only: Expo web (:4101) calls the API (:4100) cross-origin. Production is same-origin behind App Platform ingress.
if (env.NODE_ENV !== 'production') {
  app.use('/api/*', cors({ origin: env.APP_ORIGIN, credentials: true }))
}

app.get('/api/healthz', (c) => c.json({ status: 'ok' }))

// What the app may offer on the auth screens: with a mail server an address is confirmed by mail and a password can be reset by mail.
// Nothing account-specific, so it is open to everyone ({@link authConfigSchema}).
app.get('/api/auth-config', (c) =>
  c.json({ emailVerification: mailer !== null }),
)

// Better Auth owns /api/auth/*, mounted before the RPC handler so both share one origin and cookie jar.
// It runs under a request clock like the RPC calls, so its statements and transactions stop at the request's deadline.
app.on(['GET', 'POST'], '/api/auth/*', async (c) =>
  requestDeadline.run(startRequestClock(Date.now()), async () =>
    auth.handler(c.req.raw),
  ),
)

// The API owns the `/api` prefix: App Platform ingress routes `/api` here without stripping it (MVP-09).
app.use('/api/rpc/*', async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: '/api/rpc',
    context: { headers: c.req.raw.headers },
  })
  if (matched) return c.newResponse(response.body, response)
  await next()
})
