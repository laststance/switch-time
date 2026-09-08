import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { env } from './env'
import { router } from './rpc/router'

const rpc = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'rpc',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }),
  ],
})

export const app = new Hono()

// Dev only: Expo web (:8081) calls the API (:8080) cross-origin. Production is same-origin behind App Platform ingress.
if (env.NODE_ENV !== 'production') {
  app.use('/api/*', cors({ origin: env.APP_ORIGIN, credentials: true }))
}

app.get('/api/healthz', (c) => c.json({ status: 'ok' }))

// The API owns the `/api` prefix: App Platform ingress routes `/api` here without stripping it (MVP-09).
app.use('/api/rpc/*', async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: '/api/rpc',
    context: { headers: c.req.raw.headers },
  })
  if (matched) return c.newResponse(response.body, response)
  await next()
})
