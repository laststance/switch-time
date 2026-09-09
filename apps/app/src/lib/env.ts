/**
 * Where the API lives: empty in the production web build (same origin behind App Platform ingress), the Compose API in dev,
 * `EXPO_PUBLIC_API_ORIGIN` for a device on the LAN. Shared by {@link orpc} and {@link authClient}.
 */
export const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://localhost:8080' : '')
