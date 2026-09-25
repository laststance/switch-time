import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * This device's IANA zone, read at each call rather than once at load, so a device that moved while the app stayed open answers
 * its new zone. {@link useDeviceZone}'s snapshot, re-read whenever the app comes back to the foreground.
 * @example deviceZone() // 'Asia/Tokyo'
 */
export function deviceZone(): string {
  // Browsers and Hermes both answer with the device's IANA zone; JS has no other source for it.
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// One entry per account, so a second account signed in on this device still gets its zone written once. SecureStore keys
// take only letters, digits, `.`, `-` and `_`.
const keyFor = (accountId: string): string =>
  `switch-time.synced-zone.${accountId.replace(/[^\w.-]/g, '_')}`

// This session's copy, per account id: where storage fails (a private window, a locked keychain) the device still knows what
// it synced until the app restarts, instead of writing its zone again on every settings refetch.
const syncedThisSession = new Map<string, string>()

/**
 * The zone this device last wrote (or found) in the account's settings, kept on the device: `localStorage` on the web,
 * SecureStore on native. Read by {@link useTimeZoneSync} on every settings change.
 * @param accountId - The signed-in account, undefined while signed out.
 * @returns The zone, or null when the device never synced this account (in storage, or this session when storage fails)
 * @example readSyncedZone(session?.user.id) // 'Asia/Tokyo'
 */
export function readSyncedZone(accountId: string | undefined): string | null {
  if (!accountId) return null
  const sessionZone = syncedThisSession.get(accountId) ?? null
  try {
    const storedZone =
      Platform.OS === 'web'
        ? localStorage.getItem(keyFor(accountId))
        : SecureStore.getItem(keyFor(accountId))
    return storedZone ?? sessionZone
  } catch {
    // Storage off: only this session's copy is known.
    return sessionZone
  }
}

/**
 * Remembers the zone the account now holds from this device, once the write has landed or the account already held it.
 * Called by {@link useTimeZoneSync}.
 * @param accountId - The signed-in account, undefined while signed out (nothing is kept).
 * @param zone - The device's IANA zone.
 * @example rememberSyncedZone(session?.user.id, 'Asia/Tokyo')
 */
export function rememberSyncedZone(
  accountId: string | undefined,
  zone: string,
): void {
  if (!accountId) return
  syncedThisSession.set(accountId, zone)
  try {
    if (Platform.OS === 'web') localStorage.setItem(keyFor(accountId), zone)
    else SecureStore.setItem(keyFor(accountId), zone)
  } catch {
    // Kept for this session only: the next launch writes the zone once more.
  }
}
