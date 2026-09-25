import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

import { app } from '../app'
import type { AppRouterClient } from '../rpc/router'

/** The password {@link signUp} registers with and {@link signIn} uses by default. */
const PASSWORD = 'correct horse battery staple'

/** Registers `email` through the real sign-up endpoint (so the seed hook runs) and returns the raw response; it carries no session (`autoSignIn: false`). */
export const signUp = async (email: string, password = PASSWORD) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Raphtalia', email, password }),
  })

/** Signs `email` in through the real sign-in endpoint and returns the raw response, whose Set-Cookie carries the session. */
export const signIn = async (email: string, password = PASSWORD) =>
  app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
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

/** A freshly signed-up and signed-in user's client: the one-liner most domain tests start with. */
export const signedIn = async (email: string) => {
  await signUp(email)
  return rpc(cookieJar(await signIn(email)))
}
