import { onError, ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { DrizzleQueryError } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'

import { auth } from './auth'
import { env } from './env'
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
app.use('/api/*', bodyLimit({ maxSize: 100 * 1024 }))

// Dev only: Expo web (:8081) calls the API (:8080) cross-origin. Production is same-origin behind App Platform ingress.
if (env.NODE_ENV !== 'production') {
  app.use('/api/*', cors({ origin: env.APP_ORIGIN, credentials: true }))
}

app.get('/api/healthz', (c) => c.json({ status: 'ok' }))

// Better Auth owns /api/auth/*, mounted before the RPC handler so both share one origin and cookie jar.
app.on(['GET', 'POST'], '/api/auth/*', async (c) => auth.handler(c.req.raw))

// The API owns the `/api` prefix: App Platform ingress routes `/api` here without stripping it (MVP-09).
app.use('/api/rpc/*', async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: '/api/rpc',
    context: { headers: c.req.raw.headers },
  })
  if (matched) return c.newResponse(response.body, response)
  await next()
})
