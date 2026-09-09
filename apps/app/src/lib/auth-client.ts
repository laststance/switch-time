import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/react'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { API_ORIGIN } from './env'

/**
 * Better Auth client. Web rides on the first-party session cookie; native keeps the session in SecureStore and replays it
 * as a `Cookie` header ({@link orpc} does the same for RPC calls).
 * @example const { data: session, isPending } = authClient.useSession()
 */
export const authClient = createAuthClient({
  // Empty origin = current origin (production web); Better Auth appends /api/auth itself.
  baseURL: API_ORIGIN || undefined,
  plugins:
    Platform.OS === 'web'
      ? []
      : [
          expoClient({
            scheme: 'switchtime',
            storagePrefix: 'switchtime',
            storage: SecureStore,
          }),
        ],
})
