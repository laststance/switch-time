import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

import { app } from '../app'
import type { AppRouterClient } from '../rpc/router'

/** Registers `email` through the real sign-up endpoint (so the seed hook runs) and returns the raw response. */
export const signUp = async (email: string) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Raphtalia',
      email,
      password: 'correct horse battery staple',
    }),
  })

/** What a browser would send back: every Set-Cookie pair, attributes stripped. */
export const cookieJar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

/** In-process RPC client; a `cookie` from {@link cookieJar} makes it act as that user. */
export const rpc = (cookie = '') =>
  createORPCClient<AppRouterClient>(
    new RPCLink({
      url: 'http://localhost/api/rpc',
      headers: { cookie },
      fetch: async (request) => app.request(request),
    }),
  )

/** A freshly signed-up user's client: the one-liner most domain tests start with. */
export const signedIn = async (email: string) =>
  rpc(cookieJar(await signUp(email)))
