/**
 * This device's IANA zone, read at each call rather than once at load, so a device that moved while the app stayed open answers
 * its new zone. {@link useDeviceZone}'s snapshot, re-read whenever the app comes back to the foreground.
 * @example deviceZone() // 'Asia/Tokyo'
 */
export function deviceZone(): string {
  // Browsers and Hermes both answer with the device's IANA zone; JS has no other source for it.
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
