import { Platform } from 'react-native'

/**
 * Where the API lives: empty in the production web build (same origin behind App Platform ingress), the Compose API in dev,
 * `EXPO_PUBLIC_API_ORIGIN` for a device on the LAN. Shared by {@link orpc} and {@link authClient}.
 */
export const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://localhost:8080' : '')

// A native release build has no same-origin fallback: fail at boot naming the variable, not on the first fetch with a relative URL.
if (!__DEV__ && Platform.OS !== 'web' && API_ORIGIN === '')
  throw new Error(
    'EXPO_PUBLIC_API_ORIGIN is required for native release builds',
  )
