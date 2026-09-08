import { serve } from '@hono/node-server'

import { app } from './app'
import { env } from './env'

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})

// Docker and App Platform stop containers with SIGTERM: stop accepting, drain in-flight requests, exit.
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
