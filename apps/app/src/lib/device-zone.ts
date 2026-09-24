import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// One entry per account, so a second account signed in on this device still gets its zone written once. SecureStore keys
// take only letters, digits, `.`, `-` and `_`.
const keyFor = (accountId: string): string =>
  `switch-time.synced-zone.${accountId.replace(/[^\w.-]/g, '_')}`

/**
 * The zone this device last wrote (or found) in the account's settings, kept on the device: `localStorage` on the web,
 * SecureStore on native. Read by {@link useTimeZoneSync} on every settings change.
 * @param accountId - The signed-in account, undefined while signed out.
 * @returns The zone, or null when the device never synced this account (or its storage cannot be read)
 * @example readSyncedZone(session?.user.id) // 'Asia/Tokyo'
 */
export function readSyncedZone(accountId: string | undefined): string | null {
  if (!accountId) return null
  try {
    return Platform.OS === 'web'
      ? localStorage.getItem(keyFor(accountId))
      : SecureStore.getItem(keyFor(accountId))
  } catch {
    // Storage off (a private window, a locked keychain): the device syncs as if it never had.
    return null
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
  try {
    if (Platform.OS === 'web') localStorage.setItem(keyFor(accountId), zone)
    else SecureStore.setItem(keyFor(accountId), zone)
  } catch {
    // Not kept: the next launch writes the zone once more, as before this record existed.
  }
}
