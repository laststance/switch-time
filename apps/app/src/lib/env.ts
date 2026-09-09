import { Platform } from 'react-native'

/**
 * Where the API lives: empty in the production web build (same origin behind App Platform ingress), the Compose API in dev,
 * `EXPO_PUBLIC_API_ORIGIN` for a device on the LAN. Shared by {@link orpc} and {@link authClient}.
 */
export const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://localhost:8080' : '')

// A native release build replays the SecureStore session as a Cookie header on every request: the origin must be set (no
// same-origin fallback exists there) and must be https, or the session travels in cleartext. Dev keeps http for a LAN device.
if (!__DEV__ && Platform.OS !== 'web' && !API_ORIGIN.startsWith('https://'))
  throw new Error(
    'EXPO_PUBLIC_API_ORIGIN must be an https:// origin in native release builds',
  )
